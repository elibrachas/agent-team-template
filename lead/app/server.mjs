#!/usr/bin/env node
/**
 * server.mjs — el tablero del Project Lead, servido en local.
 *
 *   node lead/app/server.mjs            http://127.0.0.1:4747
 *   node lead/app/server.mjs --open     además lo abre en el navegador
 *   node lead/app/server.mjs --replace  si ya hay uno corriendo, lo reemplaza
 *
 * Para dejarlo corriendo en segundo plano: node lead/scripts/start-dashboard.mjs
 *   node lead/app/server.mjs --dry-run  simulación sobre una copia del estado: no escribe en Linear
 *   node lead/app/server.mjs --port=5000
 *
 * Lee lead/state/*.json y, cuando el owner decide algo con un click, lo ejecuta en
 * Linear con SU key (la misma que usan los agentes) y lo anota en decisions.jsonl.
 *
 * Seguridad, porque este proceso puede comentar en Linear y un comentario
 * «Cody: …» dispara trabajo real:
 *  - escucha solo en 127.0.0.1;
 *  - valida Host y Origin (corta DNS-rebinding y páginas de otros orígenes);
 *  - toda escritura exige un token que nace en cada arranque y solo viaja en la página;
 *  - CSP sin scripts inline, y el front nunca usa innerHTML con datos de Linear.
 *
 * Sin dependencias: solo Node.
 */

import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { cpSync, existsSync, mkdtempSync, readFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  AGENTS,
  BOT_RE,
  LEAD_DIR,
  TRIGGER_RE,
  appendJsonl,
  daysBetween,
  dropUnneededSecrets,
  ensureEnv,
  linear,
  loadConfig,
  readJson,
  readJsonl,
  statePath,
  stateDir,
  useStateDir,
  writeJson,
} from "../scripts/lib.mjs"
import { CLOSE_AS, VERDICTS, alfredTeamOf, retroIssue, retroTrigger } from "../scripts/model.mjs"
import { TASK_STAGES, loadTasks, openTasks, startTask } from "../scripts/tasks.mjs"

// La key es opcional: sin ella el tablero funciona en modo solo-lectura.
ensureEnv(["LINEAR_API_KEY"], import.meta.url, { optional: true })
// Este proceso queda vivo todo el día: se queda solo con la credencial que usa.
dropUnneededSecrets(["LINEAR_API_KEY"])

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "public")
const portArg = process.argv.find((a) => a.startsWith("--port="))?.slice(7)
const PORT = Number(portArg ?? process.env.LEAD_PORT ?? 4747)
const DRY_RUN = process.argv.includes("--dry-run") || process.env.LEAD_DRY_RUN === "1"
const TOKEN = randomBytes(24).toString("hex")
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`])

// La simulación trabaja sobre una COPIA del estado: se puede clickear todo sin
// que quede marcado como hecho algo que en realidad nunca salió hacia Linear.
if (DRY_RUN) {
  const real = stateDir()
  const sandbox = mkdtempSync(join(tmpdir(), "lead-simulacion-"))
  cpSync(real, sandbox, { recursive: true })
  process.env.LEAD_STATE_DIR = sandbox
  useStateDir(sandbox)
}

const cfg = loadConfig()
let linearStatus = { ok: false, reason: process.env.LINEAR_API_KEY ? "sin probar" : "sin key", viewer: null }

async function probeLinear() {
  if (!process.env.LINEAR_API_KEY) return (linearStatus = { ok: false, reason: "sin key", viewer: null })
  try {
    // Corto y sin reintentos: si Linear no contesta, el tablero arranca igual, en solo lectura.
    const d = await linear("{ viewer { name } }", {}, { timeoutMs: 8000, retries: 0 })
    linearStatus = { ok: true, reason: null, viewer: d.viewer.name }
  } catch (err) {
    const auth = /authentication|not authenticated|unauthori[sz]ed/i.test(err.message)
    linearStatus = { ok: false, reason: auth ? "key rechazada" : err.message, viewer: null }
  }
  return linearStatus
}

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

const load = {
  snapshot: () => readJson(statePath("snapshot.json"), null),
  triage: () => readJson(statePath("triage.json"), { version: 1, items: {} }),
  plan: () => readJson(statePath("plan.json"), null),
  alfred: () => readJson(statePath("alfred.json"), { version: 1, items: [] }),
}

function buildState() {
  const snap = load.snapshot()
  return {
    meta: {
      now: new Date().toISOString(),
      stateDir: stateDir(),
      dryRun: DRY_RUN,
      linear: linearStatus,
      snapshotAgeMinutes: snap ? Math.round(daysBetween(snap.generatedAt) * 1440) : null,
    },
    config: { linearWorkspace: cfg.linearWorkspace, projects: cfg.projects, objectives: cfg.objectives, limits: cfg.limits, autonomy: cfg.autonomy },
    agents: AGENTS,
    verdicts: VERDICTS,
    taskStages: TASK_STAGES,
    tasks: loadTasks().items,
    snapshot: snap && {
      generatedAt: snap.generatedAt,
      source: snap.source,
      teams: snap.teams,
      stats: snap.stats,
      prs: snap.prs,
      issues: snap.issues.filter((i) => i.open),
    },
    triage: load.triage(),
    plan: load.plan(),
    alfred: load.alfred(),
    decisions: readJsonl(statePath("decisions.jsonl")).slice(-300),
  }
}

function logDecision(action, issue, detail) {
  appendJsonl(statePath("decisions.jsonl"), {
    at: new Date().toISOString(),
    actor: "owner",
    via: "dashboard",
    action,
    issue: issue ?? null,
    detail: detail ?? null,
    ...(DRY_RUN ? { dryRun: true } : {}),
  })
}

/** Refleja en el snapshot local un cambio que Linear acaba de aceptar, para no esperar al próximo sync. */
function patchIssue(id, patch) {
  const snap = load.snapshot()
  const issue = snap?.issues.find((i) => i.id === id)
  if (!issue) return
  Object.assign(issue, patch, { patchedAt: new Date().toISOString() })
  writeJson(statePath("snapshot.json"), snap)
}

function patchPlan(fn) {
  const plan = load.plan()
  if (!plan) return
  fn(plan)
  writeJson(statePath("plan.json"), plan)
  writeJson(statePath("history", `plan-${plan.date}.json`), plan)
}

// ---------------------------------------------------------------------------
// Linear: las únicas tres escrituras que hace el tablero
// ---------------------------------------------------------------------------

class ActionError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

function requireLinear() {
  if (DRY_RUN) return
  if (!linearStatus.ok) {
    throw new ActionError(
      "linear-unavailable",
      linearStatus.reason === "sin key"
        ? "El tablero arrancó sin LINEAR_API_KEY: está en modo solo-lectura."
        : `Linear no aceptó la key (${linearStatus.reason}). Hay que rotarla y reiniciar el tablero.`,
    )
  }
}

const ISSUE_REF_RE = /^[A-Z]{2,6}-\d+$/

async function resolveIssue(identifier) {
  if (!ISSUE_REF_RE.test(identifier)) throw new ActionError("bad-request", `Identificador inválido: ${identifier}`)
  const team = identifier.split("-")[0]
  if (!cfg.projects.some((p) => p.teamKey === team)) throw new ActionError("bad-request", `${team} no es un team de este tablero`)
  if (DRY_RUN) return { id: `dry-${identifier}`, identifier, team: { key: team }, state: null }
  // Trae también el estado de AHORA: el snapshot puede tener horas.
  const d = await linear("query($id: String!) { issue(id: $id) { id identifier team { key } state { name type } } }", { id: identifier })
  if (!d.issue) throw new ActionError("not-found", `No encontré ${identifier} en Linear`)
  return d.issue
}

const CLOSED_TYPES = ["completed", "canceled", "duplicate"]

/**
 * Un pedido a un agente no sale dos veces: ni por un doble click, ni porque el
 * plan se reinstaló con el mismo pedido adentro. Pasadas 3 horas sin respuesta
 * se considera que la corrida falló y se puede reenviar.
 */
function assertNotAlreadyAsked(issueId) {
  const snap = load.snapshot()
  const known = snap?.issues.find((i) => i.id === issueId)
  const task = openTasks().find((t) => t.id === issueId && t.stage === "dispatched")
  const asked = [
    known?.ball?.with === "agent" ? known.ball.since : null,
    // Una tarea recién pedida, de la que el snapshot todavía no pudo traer la respuesta.
    task && (!snap?.generatedAt || task.stageAt > snap.generatedAt) ? task.stageAt : null,
  ]
    .filter(Boolean)
    .sort()
    .at(-1)
  if (!asked) return
  const minutes = Math.round((Date.now() - new Date(asked).getTime()) / 60_000)
  if (minutes < 180) throw new ActionError("bad-request", `Ya hay un pedido a un agente en ${issueId}, de hace ${minutes} min, sin respuesta. Si la corrida falló, se puede reenviar pasadas las 3 horas`)
}

/** El item del plan al que se refiere un click. La posición sola no alcanza: tiene que ser el mismo pedido y seguir pendiente. */
function planItemFor(n, { type, issue } = {}) {
  const item = load.plan()?.items.find((x) => x.n === n)
  if (!item) throw new ActionError("not-found", "Ese item no está en el plan de hoy")
  if ((type && item.type !== type) || (issue && item.id !== issue)) throw new ActionError("stale-plan", "Ese item del plan ya no es el que estabas mirando. Actualicé la página: revisa y vuelve a tocar")
  if (item.status !== "pending") throw new ActionError("bad-request", `Ese item ya figura como ${{ dispatched: "enviado", done: "hecho", skipped: "salteado" }[item.status] ?? item.status}`)
  return item
}

async function stateIdFor(teamKey, name) {
  const cached = load.snapshot()?.states?.[teamKey]?.[name]
  if (cached?.id) return cached
  if (DRY_RUN) return { id: `dry-state-${name}`, type: "dry" }
  const d = await linear(
    "query($team: String!, $name: String!) { workflowStates(filter: { team: { key: { eq: $team } }, name: { eqIgnoreCase: $name } }) { nodes { id name type } } }",
    { team: teamKey, name },
  )
  const s = d.workflowStates.nodes[0]
  if (!s) throw new ActionError("not-found", `El team ${teamKey} no tiene un estado «${name}»`)
  return s
}

async function postComment(identifier, body) {
  const text = String(body ?? "").trim()
  if (!text) throw new ActionError("bad-request", "El comentario está vacío")
  if (text.length > 6000) throw new ActionError("bad-request", "El comentario es demasiado largo")
  // El listener dispara por el texto del comentario, no por el estado del issue: un «Cody: …»
  // en un issue cerrado arrancaría trabajo sobre algo que ya se cerró.
  const known = load.snapshot()?.issues.find((i) => i.id === identifier)
  if (TRIGGER_RE.test(text) && known && !known.open) throw new ActionError("bad-request", `${identifier} está cerrado (${known.state}): no se le pide trabajo a un agente ahí`)
  requireLinear()
  const issue = await resolveIssue(identifier)
  // Y lo mismo contra Linear en vivo: puede haberse cerrado después del último sync.
  if (TRIGGER_RE.test(text) && CLOSED_TYPES.includes(issue.state?.type))
    throw new ActionError("bad-request", `${identifier} está cerrado en Linear (${issue.state.name}): no se le pide trabajo a un agente ahí. Actualiza los datos`)
  if (DRY_RUN) return { dryRun: true, wouldPost: text }
  const d = await linear("mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { url } } }", {
    input: { issueId: issue.id, body: text },
  })
  if (!d.commentCreate.success) throw new ActionError("linear", "Linear no creó el comentario")
  return { url: d.commentCreate.comment.url }
}

const STATE_NAMES = { todo: "Todo", backlog: "Backlog", canceled: "Canceled", done: "Done", duplicate: "Duplicate" }
const STATE_TYPES = { todo: "unstarted", backlog: "backlog", canceled: "canceled", done: "completed", duplicate: "duplicate" }

/**
 * «Duplicado de»: la relación de Linear, no solo el estado. Sin ella el duplicado queda
 * cerrado sin apuntar al issue que sigue vivo.
 */
async function relateDuplicate(issue, dupOf) {
  const canonical = await resolveIssue(dupOf)
  if (canonical.id === issue.id) throw new ActionError("bad-request", `${dupOf} no puede ser duplicado de sí mismo`)
  const d = await linear("mutation($input: IssueRelationCreateInput!) { issueRelationCreate(input: $input) { success } }", {
    input: { issueId: issue.id, relatedIssueId: canonical.id, type: "duplicate" },
  })
  if (!d.issueRelationCreate?.success) throw new ActionError("linear", `Linear no relacionó ${issue.identifier} con ${dupOf}`)
}

async function moveIssue(identifier, to, { dupOf = null } = {}) {
  const name = STATE_NAMES[to]
  if (!name) throw new ActionError("bad-request", `Estado destino inválido: ${to}`)
  if (to === "duplicate" && !dupOf) throw new ActionError("bad-request", `${identifier}: para cerrarlo como duplicado hace falta decir de cuál (dupOf)`)
  if (dupOf && !ISSUE_REF_RE.test(dupOf)) throw new ActionError("bad-request", `dupOf inválido: ${dupOf}`)
  requireLinear()
  const seen = load.snapshot()?.issues.find((i) => i.id === identifier)?.state ?? null
  const issue = await resolveIssue(identifier)
  // Si en Linear ya no está donde el tablero lo muestra, alguien lo movió después del sync
  // (por ejemplo, el owner lo pasó a In Progress): no se pisa esa decisión.
  if (seen && issue.state && issue.state.name !== seen)
    throw new ActionError("changed", `${identifier} está en «${issue.state.name}» en Linear y el tablero lo tenía en «${seen}». Actualiza los datos antes de moverlo`)
  const state = await stateIdFor(issue.team.key, name)
  if (!DRY_RUN) {
    // La relación va antes que el estado, y después de comprobar que nadie lo movió: si
    // Linear lo pasa solo a Duplicate al relacionarlo, el cambio de estado no hace nada.
    if (to === "duplicate") await relateDuplicate(issue, dupOf)
    const d = await linear("mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { state { name } } } }", {
      id: issue.id,
      input: { stateId: state.id },
    })
    // Lo que cuenta es lo que Linear dice que quedó, no que la llamada no haya fallado.
    if (!d.issueUpdate.success || d.issueUpdate.issue?.state?.name !== name) throw new ActionError("linear", `Linear no movió ${identifier}`)
  }
  patchIssue(identifier, { state: name, stateType: STATE_TYPES[to], open: to === "todo" || to === "backlog" })
  return { state: name, from: issue.state?.name ?? seen, ...(to === "duplicate" ? { duplicateOf: dupOf } : {}), ...(DRY_RUN ? { dryRun: true } : {}) }
}

/**
 * Lo que un agente ya tiene se ve «In Progress» en Linear: si no, no se sabe qué se está trabajando.
 * No frena el pedido si falla: el comentario ya salió, y `lead follow` avisa del estado.
 */
async function markStarted(identifier) {
  try {
    const issue = await resolveIssue(identifier)
    // En simulación no se consulta Linear: vale el estado del snapshot.
    const type = issue.state?.type ?? load.snapshot()?.issues.find((i) => i.id === identifier)?.stateType
    if (!["backlog", "unstarted", "triage"].includes(type)) return { state: issue.state?.name ?? null }
    const state = await stateIdFor(issue.team.key, "In Progress")
    if (!DRY_RUN) {
      const d = await linear("mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { state { name } } } }", {
        id: issue.id,
        input: { stateId: state.id },
      })
      if (!d.issueUpdate.success || d.issueUpdate.issue?.state?.name !== "In Progress") throw new Error("Linear no lo movió")
    }
    patchIssue(identifier, { state: "In Progress", stateType: "started" })
    return { state: "In Progress" }
  } catch (err) {
    return { state: null, stateError: err.message }
  }
}

async function createRetro(rec) {
  requireLinear()
  const team = alfredTeamOf(cfg)
  if (!team) throw new ActionError("bad-request", "No sé en qué team crear el [Retro]: falta lead.config.json → alfred.teamKey")
  const agentName = rec.agent === "todos" ? "Equipo" : (AGENTS[rec.agent]?.name ?? rec.agent)
  const { title, description } = retroIssue(rec, agentName, "el tablero")
  if (DRY_RUN) return { dryRun: true, wouldCreate: { title, description, state: "In Progress" }, wouldComment: retroTrigger(["(el issue nuevo)"]) }

  const meta = await linear(
    'query($team: String!) { teams(filter: { key: { eq: $team } }) { nodes { id } } issueLabels(filter: { name: { eqIgnoreCase: "alfred" } }) { nodes { id team { key } } } }',
    { team },
  )
  const teamId = meta.teams.nodes[0]?.id
  if (!teamId) throw new ActionError("not-found", `No encontré el team ${team} en Linear`)
  const label = meta.issueLabels.nodes.find((l) => !l.team || l.team.key === team)
  if (!label) throw new ActionError("not-found", `No existe el label «alfred» en ${team}: sin él, el barrido diario de Alfred no ve el issue`)
  // Lo que se le manda a un agente se ve In Progress desde que sale, y lo dispara un comentario:
  // el listener no mira issues nuevos, solo comentarios que empiezan con «<Agente>:».
  const started = await stateIdFor(team, "In Progress")
  const d = await linear("mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier url } } }", {
    input: { teamId, title, description, labelIds: [label.id], stateId: started.id },
  })
  if (!d.issueCreate.success) throw new ActionError("linear", "Linear no creó el issue")
  const issue = d.issueCreate.issue
  // El issue ya existe: si el comentario falla NO se tira un error, porque quien llama
  // volvería la recomendación a borrador y el reintento crearía otro [Retro].
  try {
    await triggerAlfred(issue.id, [issue.identifier])
  } catch (err) {
    return { ...issue, triggerError: err.message }
  }
  return issue
}

/** El comentario «Alfred: …» que lo dispara. Se puede reintentar sin crear nada. */
async function triggerAlfred(issueId, identifiers) {
  requireLinear()
  const c = await linear("mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success } }", {
    input: { issueId, body: retroTrigger(identifiers) },
  })
  if (!c.commentCreate?.success) throw new ActionError("linear", "Linear no guardó el comentario que dispara a Alfred")
}

// ---------------------------------------------------------------------------
// Acciones del tablero
// ---------------------------------------------------------------------------

const actions = {
  /** Despachar a un agente: comenta `<Agente>: …` en el issue. El listener de n8n hace el resto. */
  async dispatch({ issue, agent, comment, planItem }) {
    if (!(agent in AGENTS)) throw new ActionError("bad-request", `Agente inválido: ${agent}`)
    const body = String(comment ?? "").trim()
    const m = TRIGGER_RE.exec(body)
    if (!m || m[1].toLowerCase() !== agent) throw new ActionError("bad-request", `El comentario tiene que empezar con «${AGENTS[agent].name}:» para que el agente lo tome`)
    if (BOT_RE.test(body)) throw new ActionError("bad-request", "Un comentario que empieza con 🤖 no dispara a nadie")
    // El texto se puede retocar en el tablero, pero el issue y el agente son los del plan guardado.
    const item = planItem != null ? planItemFor(planItem, { type: "dispatch", issue }) : null
    if (item && item.agent !== agent) throw new ActionError("stale-plan", "Ese item del plan es para otro agente. Actualicé la página: revisa y vuelve a tocar")
    assertNotAlreadyAsked(issue)
    const result = await postComment(issue, body)
    if (item) patchPlan((p) => p.items.filter((x) => x.n === planItem).forEach((x) => (x.status = "dispatched")))
    patchIssue(issue, { ball: { with: "agent", agent, since: new Date().toISOString() } })
    logDecision("dispatch", issue, { agent, comment: body })
    // Un pedido que salió es una tarea que el lead sigue hasta que esté hecha.
    const known = load.snapshot()?.issues.find((i) => i.id === issue)
    startTask({ id: issue, agent, comment: body, title: item?.title ?? known?.title ?? "", url: known?.url ?? null, team: known?.team ?? null, via: "dashboard" })
    return { ...result, ...(await markStarted(issue)) }
  },

  /** Comentario libre (una respuesta del owner a un agente, una nota). */
  async comment({ issue, comment }) {
    if (TRIGGER_RE.test(String(comment ?? ""))) assertNotAlreadyAsked(issue)
    const result = await postComment(issue, comment)
    logDecision("comment", issue, { comment: String(comment).trim().slice(0, 500) })
    return result
  },

  /** Aceptar una propuesta: pasa a Todo. No dispara a nadie. */
  async accept({ issue }) {
    const result = await moveIssue(issue, "todo")
    logDecision("accept", issue, null)
    return result
  },

  /** Cerrar un issue (cancelado, duplicado o hecho), con nota opcional en el hilo. */
  async close({ issue, as, dupOf, note, planItem }) {
    if (!CLOSE_AS.includes(as)) throw new ActionError("bad-request", `as debe ser ${CLOSE_AS.join(" | ")}`)
    if (dupOf && !ISSUE_REF_RE.test(dupOf)) throw new ActionError("bad-request", `dupOf inválido: ${dupOf}`)
    if (planItem != null) planItemFor(planItem, { type: "close", issue })
    // Primero el estado (que verifica contra Linear en vivo) y después la nota: si el
    // cierre no pasa, no queda un «Duplicado de…» colgado en un issue que sigue abierto.
    const result = await moveIssue(issue, as, { dupOf: as === "duplicate" ? dupOf : null })
    if (planItem != null) patchPlan((p) => p.items.filter((x) => x.n === planItem).forEach((x) => (x.status = "done")))
    patchPlan((p) => (p.closeBatch ?? []).filter((c) => c.id === issue).forEach((c) => (c.status = "done")))
    logDecision(`close-${as}`, issue, { from: result.from ?? null, dupOf: dupOf ?? null, note: note ?? null })
    const parts = []
    if (as === "duplicate" && dupOf) parts.push(`Duplicado de ${dupOf}.`)
    if (note) parts.push(String(note).trim())
    // 🤖 al inicio: el listener lo ignora, así una nota de cierre nunca dispara a un agente.
    if (parts.length) await postComment(issue, `🤖 Lead: ${parts.join(" ")}`)
    return result
  },

  /** Cierre en lote: lo que el lead dejó listo en «para cerrar». Sigue aunque uno falle. */
  async closeBatch({ ids }) {
    const plan = load.plan()
    const wanted = (plan?.closeBatch ?? []).filter((c) => ids.includes(c.id) && c.status === "pending")
    if (wanted.length === 0) throw new ActionError("bad-request", "No hay nada pendiente para cerrar con esos ids")
    requireLinear()
    const done = []
    const failed = []
    for (const c of wanted) {
      try {
        const moved = await moveIssue(c.id, c.as, { dupOf: c.as === "duplicate" ? c.dupOf : null })
        // Se anota uno por uno: si el tablero se reinicia a mitad del lote, lo ya cerrado no se repite.
        done.push(c.id)
        patchPlan((p) => p.closeBatch.filter((x) => x.id === c.id).forEach((x) => (x.status = "done")))
        logDecision(`close-${c.as}`, c.id, { batch: true, from: moved.from ?? null, dupOf: c.dupOf ?? null, why: c.why })
        if (c.as === "duplicate" && c.dupOf) await postComment(c.id, `🤖 Lead: Duplicado de ${c.dupOf}.`)
      } catch (err) {
        if (!done.includes(c.id)) failed.push({ id: c.id, error: err.message })
        if (err.code === "linear-unavailable") break
      }
    }
    return { done, failed, ...(DRY_RUN ? { dryRun: true } : {}) }
  },

  /** Estado de un item del plan que no pasa por Linear (lo hizo el owner, o lo saltea hoy). */
  async planStatus({ planItem, status }) {
    if (!["pending", "done", "skipped"].includes(status)) throw new ActionError("bad-request", "status inválido")
    let item = null
    patchPlan((p) => p.items.filter((x) => x.n === planItem).forEach((x) => ((x.status = status), (item = x))))
    if (!item) throw new ActionError("not-found", "Ese item no está en el plan de hoy")
    logDecision(`plan-${status}`, item.id, { title: item.title, type: item.type })
    return { status }
  },

  /**
   * Una decisión que solo el owner puede tomar. Si la opción elegida trae un
   * comentario (por ejemplo «Cody: avanza con la opción B»), se publica en el issue.
   */
  async decide({ planItem, choice }) {
    const item = planItemFor(planItem, { type: "decide" })
    const option = (item.options ?? []).find((o) => o.label === choice)
    if (!option) throw new ActionError("bad-request", "Esa opción no está en el plan")
    // El comentario y el issue salen del plan guardado, no del pedido: el navegador solo elige la opción.
    const body = option.comment ? String(option.comment).trim() : null
    if (body && BOT_RE.test(body)) throw new ActionError("bad-request", "Un comentario que empieza con 🤖 no dispara a nadie")
    if (body && !item.id) throw new ActionError("bad-request", "Esa opción publica un comentario y el item no dice en qué issue")
    const asked = body ? TRIGGER_RE.exec(body)?.[1].toLowerCase() : null
    if (asked) assertNotAlreadyAsked(item.id)
    const result = body ? await postComment(item.id, body) : {}
    patchPlan((p) => p.items.filter((x) => x.n === planItem).forEach((x) => ((x.status = "done"), (x.decision = choice))))
    logDecision("decide", item.id ?? null, { choice, comment: body })
    // Una decisión que le pide trabajo a un agente abre una tarea, igual que un pedido directo.
    if (asked) {
      patchIssue(item.id, { ball: { with: "agent", agent: asked, since: new Date().toISOString() } })
      startTask({ id: item.id, agent: asked, comment: body, title: item.title ?? "", url: item.url ?? null, team: item.team ?? null, via: "dashboard" })
      Object.assign(result, await markStarted(item.id))
    }
    return { choice, ...result }
  },

  /** El owner no está de acuerdo con el veredicto del lead: queda anotado y el lead lo lee mañana. */
  async override({ issue, verdict, note }) {
    if (!(verdict in VERDICTS)) throw new ActionError("bad-request", "verdict inválido")
    if (!ISSUE_REF_RE.test(String(issue))) throw new ActionError("bad-request", `Identificador inválido: ${issue}`)
    const triage = load.triage()
    const prev = triage.items[issue]
    triage.items[issue] = {
      ...(prev ?? {}),
      verdict,
      overriddenBy: "owner",
      overrideNote: note ?? null,
      overriddenFrom: prev?.verdict ?? null,
      triagedAt: new Date().toISOString(),
    }
    writeJson(statePath("triage.json"), triage)
    logDecision("override", issue, { from: prev?.verdict ?? null, to: verdict, note: note ?? null })
    return { verdict }
  },

  async alfredSend({ rec }) {
    const store = load.alfred()
    const r = store.items.find((x) => x.id === rec)
    if (!r) throw new ActionError("not-found", "No encontré esa recomendación")
    // Crear el issue tarda segundos. Se marca antes, para que un segundo click no cree otro
    // [Retro], y se vuelve a leer después, para no pisar lo que haya cambiado mientras tanto.
    const mark = (fn) => {
      const fresh = load.alfred()
      const item = fresh.items.find((x) => x.id === rec)
      if (item) fn(item)
      writeJson(statePath("alfred.json"), fresh)
    }
    // El [Retro] ya existe y lo único que faltó fue dispararlo: se reintenta el comentario, no el issue.
    if (r.status === "sent" && r.triggerPending) {
      if (!r.linearIssueId) throw new ActionError("bad-request", `Falta el id de ${r.linearIssue}: comenta «Alfred: …» ahí a mano`)
      if (DRY_RUN) return { dryRun: true, wouldComment: retroTrigger([r.linearIssue]) }
      await triggerAlfred(r.linearIssueId, [r.linearIssue])
      mark((x) => delete x.triggerPending)
      logDecision("alfred-trigger", r.linearIssue ?? null, { rec })
      return { identifier: r.linearIssue, triggered: true }
    }
    if (r.status !== "draft") throw new ActionError("bad-request", "Esa recomendación ya fue enviada, se está enviando o fue descartada")
    mark((x) => (x.status = "sending"))
    let issue
    try {
      issue = await createRetro(r)
    } catch (err) {
      mark((x) => (x.status = "draft"))
      throw err
    }
    mark((x) =>
      Object.assign(x, {
        status: "sent",
        linearIssue: issue.identifier ?? null,
        linearIssueId: issue.id ?? null,
        sentAt: new Date().toISOString(),
        ...(issue.triggerError ? { triggerPending: true } : {}),
      }),
    )
    logDecision("alfred-send", issue.identifier ?? null, { rec, title: r.title, ...(issue.triggerError ? { triggerError: issue.triggerError } : {}) })
    return issue
  },

  async alfredDismiss({ rec, note }) {
    const store = load.alfred()
    const r = store.items.find((x) => x.id === rec)
    if (!r) throw new ActionError("not-found", "No encontré esa recomendación")
    r.status = "dismissed"
    r.dismissNote = note ?? null
    writeJson(statePath("alfred.json"), store)
    logDecision("alfred-dismiss", null, { rec, note: note ?? null })
    return { status: "dismissed" }
  },
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.css": ["app.css", "text/css; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
}

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "connect-src 'self'",
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ")

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  })
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on("data", (c) => {
      size += c.length
      if (size > 200_000) {
        reject(new ActionError("bad-request", "Body demasiado grande"))
        req.destroy()
      } else chunks.push(c)
    })
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {})
      } catch {
        reject(new ActionError("bad-request", "JSON inválido"))
      }
    })
    req.on("error", reject)
  })
}

let syncing = null
function runSync() {
  if (syncing) return syncing
  syncing = new Promise((resolve) => {
    const child = spawn(process.execPath, [join(LEAD_DIR, "scripts", "sync.mjs")], { env: process.env, windowsHide: true })
    let out = ""
    child.stdout.on("data", (d) => (out += d))
    child.stderr.on("data", (d) => (out += d))
    child.on("close", (code) => {
      syncing = null
      resolve({ ok: code === 0, code, output: out.trim().split("\n").slice(-12).join("\n") })
    })
    child.on("error", (err) => {
      syncing = null
      resolve({ ok: false, code: -1, output: err.message })
    })
  })
  return syncing
}

const server = createServer(async (req, res) => {
  try {
    if (!ALLOWED_HOSTS.has(req.headers.host ?? "")) return send(res, 403, { error: "host no permitido" })
    const url = new URL(req.url, `http://${req.headers.host}`)

    if (req.method === "GET") {
      if (url.pathname in STATIC) {
        const [file, type] = STATIC[url.pathname]
        const path = join(PUBLIC_DIR, file)
        if (!existsSync(path)) return send(res, 404, "no encontrado", "text/plain; charset=utf-8")
        let body = readFileSync(path, "utf8")
        if (file === "index.html") body = body.replace("__LEAD_TOKEN__", TOKEN)
        return send(res, 200, body, type)
      }
      if (url.pathname === "/api/state") return send(res, 200, buildState())
      // Sin datos: solo dice «soy el tablero» para que el lanzador sepa a quién reemplazar.
      if (url.pathname === "/api/ping") return send(res, 200, { app: "project-lead", pid: process.pid, dryRun: DRY_RUN, linear: linearStatus })
      return send(res, 404, { error: "no encontrado" })
    }

    if (req.method === "POST") {
      // Una página de otro origen no puede leer el token ni mandar este header sin preflight.
      const origin = req.headers.origin
      if (origin && !ALLOWED_HOSTS.has(origin.replace(/^https?:\/\//, ""))) return send(res, 403, { error: "origen no permitido" })
      if (req.headers["x-lead-token"] !== TOKEN) return send(res, 403, { error: "token inválido: recarga la página" })
      // El token frena a otra página, no a otro programa de esta máquina que lea el HTML.
      // Un navegador manda esta cabecera sola y un script no: que una escritura salga de
      // un click en la página, no de un curl.
      if (req.headers["sec-fetch-site"] !== "same-origin") return send(res, 403, { error: "este pedido no viene de la página del tablero" })

      if (url.pathname === "/api/sync") {
        const result = await runSync()
        if (result.ok) await probeLinear()
        return send(res, 200, { ...result, state: buildState() })
      }

      if (url.pathname === "/api/action") {
        const body = await readBody(req)
        const fn = actions[body.type]
        if (!fn) return send(res, 400, { error: `acción desconocida: ${body.type}` })
        // Los items del plan se nombran por su posición. Si el plan se reinstaló desde que
        // se abrió la página, la posición 3 es otra tarea: el click no vale.
        const usesPlan = body.planItem != null || body.type === "closeBatch"
        if (usesPlan && body.planAt !== (load.plan()?.generatedAt ?? null))
          return send(res, 200, { ok: false, code: "stale-plan", error: "El plan cambió desde que abriste esta página. Ya la actualicé: revisa y vuelve a tocar.", state: buildState() })
        try {
          const result = await fn(body)
          return send(res, 200, { ok: true, result, state: buildState() })
        } catch (err) {
          if (/authentication|not authenticated/i.test(err.message)) {
            linearStatus = { ok: false, reason: "key rechazada", viewer: null }
            return send(res, 200, { ok: false, code: "linear-unavailable", error: "Linear rechazó la key. Hay que rotarla y reiniciar el tablero.", state: buildState() })
          }
          return send(res, 200, { ok: false, code: err.code ?? "error", error: err.message, state: buildState() })
        }
      }
      return send(res, 404, { error: "no encontrado" })
    }

    send(res, 405, { error: "método no permitido" })
  } catch (err) {
    send(res, err instanceof ActionError ? 400 : 500, { error: err.message })
  }
})

const URL_LOCAL = `http://127.0.0.1:${PORT}`
const OPEN = process.argv.includes("--open")

/** Abre el tablero en el navegador por defecto (lo usa el lanzador de doble click). */
function openBrowser() {
  const [cmd, args] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", URL_LOCAL]] : process.platform === "darwin" ? ["open", [URL_LOCAL]] : ["xdg-open", [URL_LOCAL]]
  spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true }).on("error", () => {})
}

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    // Ya hay un tablero corriendo: con --open alcanza con llevarte a él.
    if (OPEN) {
      openBrowser()
      console.log(`El tablero ya estaba corriendo: lo abrí en ${URL_LOCAL}`)
      setTimeout(() => process.exit(0), 500)
      return
    }
    console.error(`✗ El puerto ${PORT} ya está en uso: el tablero probablemente ya está abierto en ${URL_LOCAL}`)
    process.exit(1)
  }
  throw err
})

/**
 * --replace: si ya hay un tablero en este puerto, lo cierra y toma su lugar.
 * Así la rutina de la mañana siempre deja corriendo el código y la key del día.
 * Solo cierra a un proceso que se identifica como este tablero.
 */
async function replaceRunning() {
  const ping = async () => (await fetch(`${URL_LOCAL}/api/ping`, { signal: AbortSignal.timeout(1200) })).json()
  let old
  try {
    old = await ping()
  } catch {
    return // no hay nada escuchando
  }
  if (old?.app !== "project-lead" || !Number.isInteger(old.pid) || old.pid === process.pid) return
  try {
    process.kill(old.pid)
  } catch {
    return
  }
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 150))
    try {
      await ping()
    } catch {
      return // el puerto quedó libre
    }
  }
}

if (process.argv.includes("--replace")) await replaceRunning()
// Una recomendación que quedó «enviándose» porque el tablero se cerró a mitad de camino
// vuelve a borrador: es mejor revisar si el [Retro] se creó que perderla.
{
  const store = load.alfred()
  if (store.items.some((x) => x.status === "sending")) {
    for (const x of store.items) if (x.status === "sending") x.status = "draft"
    writeJson(statePath("alfred.json"), store)
  }
}
await probeLinear()
server.listen(PORT, "127.0.0.1", () => {
  if (OPEN) openBrowser()
  console.log(`Project Lead · tablero en ${URL_LOCAL}`)
  console.log(`  estado:  ${stateDir()}`)
  console.log(
    `  Linear:  ${DRY_RUN ? "DRY-RUN (no escribe)" : linearStatus.ok ? `conectado como ${linearStatus.viewer}` : `solo lectura — ${linearStatus.reason}`}`,
  )
})
