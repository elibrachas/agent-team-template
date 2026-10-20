#!/usr/bin/env node
/**
 * selftest.mjs — prueba de humo del Project Lead, sin red y sin tocar el estado real.
 *
 *   node lead/scripts/selftest.mjs
 *
 * Arma un estado de mentira en una carpeta temporal, pasa por el CLI (triage,
 * plan, registros, marcas) y levanta el tablero en simulación para verificar
 * las acciones y, sobre todo, lo que el tablero tiene que RECHAZAR: pedidos sin
 * token, de otro origen, o comentarios que no dispararían a nadie.
 *
 * Trabaja con su propia config (dos proyectos de mentira, Acme y Beta, vía
 * LEAD_CONFIG), así que pasa igual con la config que tengas en lead.config.json.
 *
 * Córrelo después de tocar lead.mjs, model.mjs o server.mjs.
 */

import { spawn, spawnSync } from "node:child_process"
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { request } from "node:http"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { alfredTeamOf, buildStats, classOf, isMetricRecord, isSecurity, kindOf, laneOf, securityLevel, seriesOf, sourceOf } from "./model.mjs"
import { taskSignals } from "./tasks.mjs"
import { issueRefs } from "./github.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const STATE = mkdtempSync(join(tmpdir(), "lead-selftest-"))
mkdirSync(join(STATE, "tmp"), { recursive: true })
const PORT = 4790

// La config de la prueba: dos proyectos, para cubrir el reparto de atención y lo que cruza teams.
const CONFIG_DIR = mkdtempSync(join(tmpdir(), "lead-selftest-config-"))
const CONFIG = join(CONFIG_DIR, "lead.config.json")
const weights = { revenue: 1.0, security: 0.9, traffic: 0.8, measurement: 0.7, reliability: 0.7, quality: 0.5, agents: 0.5, hygiene: 0.3 }
writeFileSync(
  CONFIG,
  JSON.stringify({
    linearWorkspace: "test",
    projects: [
      { slug: "acme", teamKey: "ACM", name: "Acme", attentionShare: 0.6, northStar: "Conversión free→paid.", objectiveWeights: weights },
      { slug: "beta", teamKey: "BET", name: "Beta", attentionShare: 0.4, northStar: "Tráfico orgánico.", objectiveWeights: { ...weights, revenue: 0.6, quality: 1.0 } },
    ],
    objectives: Object.fromEntries(Object.keys(weights).map((k) => [k, { label: k, hint: "" }])),
    limits: { tasksInFlight: 3, planItemsMax: 7, ownerMinutesPerDay: 60, codyDispatchesPerRepoPerDay: 2, openPrsBeforeNewDispatch: 3, proposalStaleDays: 45, recordAutoArchiveDays: 2 },
    autonomy: { archiveRecords: true, closeObviousDuplicates: true, closeVerifiedDone: true, setPriority: true, followThrough: true, dispatchReadOnlyAgents: false, dispatchCodingAgents: false, sendAlfredRecommendations: false },
    alfred: { teamKey: "ACM" },
    agentsRepo: "tu-org/agent-team-template",
    sync: { closedDays: 45, mergedPrDays: 14, shippedDays: 45 },
  }),
)
const env = { ...process.env, LEAD_STATE_DIR: STATE, LEAD_CONFIG: CONFIG, LINEAR_API_KEY: "", LEAD_ENV_REEXEC: "1" }

let failed = 0
const check = (name, ok, detail = "") => {
  if (!ok) failed++
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || !detail ? "" : ` — ${detail}`}`)
}

// --------------------------------------------------------- la config del repo

{
  // La config real no la usa ninguna otra prueba: esta solo mira que esté bien armada.
  let cfg = null
  let why = ""
  try {
    cfg = JSON.parse(readFileSync(join(HERE, "..", "lead.config.json"), "utf8").replace(/^﻿/, ""))
  } catch (err) {
    why = err.message
  }
  const projects = cfg?.projects ?? []
  const objectives = Object.keys(cfg?.objectives ?? {})
  const problems = [
    !projects.length && "sin proyectos",
    ...projects.flatMap((p) => [
      !(p.slug && p.teamKey && p.name) && `${p.slug ?? "?"}: falta slug, teamKey o name`,
      typeof p.attentionShare !== "number" && `${p.slug}: attentionShare no es un número`,
      ...Object.keys(p.objectiveWeights ?? {}).filter((k) => !objectives.includes(k)).map((k) => `${p.slug}: objetivo «${k}» no está en objectives`),
    ]),
    cfg?.limits && !("ownerMinutesPerDay" in cfg.limits) && "limits sin ownerMinutesPerDay",
  ].filter(Boolean)
  check("lead.config.json es JSON válido y sus proyectos están completos", Boolean(cfg) && !problems.length, why || problems.join("; "))
}

// ------------------------------------------------------------------ modelo

check("kindOf lee el prefijo", kindOf("[Proposal] (AEO) Algo", []) === "proposal")
check("un issue de agente sin prefijo es un hallazgo", kindOf("Credential stuffing detectado", ["agent-report"]) === "finding")
check("un reporte es un registro", classOf(kindOf("[Report] Free→paid oct 2026 — día 5", [])) === "record")
check("una alerta es trabajo", classOf(kindOf("[Alert] signups fuera de rango", [])) === "work")
check("un post agendado es flujo, pero un aviso del pipeline es trabajo", classOf(kindOf("[Content] Cómo elegir un plan", [])) === "flow" && classOf(kindOf("[Content] Banco de topics vacío — 2026-10-04", [])) === "work")
check("un [Topics] con preguntas no es un registro para archivar", classOf(kindOf("[Topics] semana 2026-10-05 · con preguntas", [])) === "work" && classOf(kindOf("[Topics] semana 2026-10-05 · 8 ideas", [])) === "record")
check("un [Refresh] que falló pide revisión", classOf(kindOf("[Refresh] REVISAR — guia-de-precios", [])) === "work" && classOf(kindOf("[Refresh] guia-de-precios", [])) === "flow")
check("la firma del cuerpo gana", sourceOf({ title: "[Proposal] x", labels: [], body: "…\n---\nGenerado por 🤖 Pico 🎯" }) === "pico")
check("sin firma, el título alcanza", sourceOf({ title: "[QA-sec] 🟡 Deps HIGH", labels: [], body: "" }) === "qualy")
check("los reportes diarios son una sola serie", seriesOf("[Report] Free→paid oct 2026 — día 5, 120 signups") === seriesOf("[Report] Free→paid oct 2026 — día 7, 180 signups"))
check(
  "seguridad: el prefijo de Qualy, el objetivo del triage y un [QA] con CVE cuentan; un título con «URLs» no",
  isSecurity({ kind: "qa-sec", title: "[QA-sec] 🟡 Deps HIGH" }) &&
    isSecurity({ kind: "proposal", title: "[Proposal] Validar el slug" }, { objective: "security" }) &&
    isSecurity({ kind: "qa", title: "[QA] 🔴 Next.js — CVE-2026-1234" }) &&
    !isSecurity({ kind: "alert", title: "[Alert] 3 URLs sin indexar" }) &&
    !isSecurity({ kind: "report", title: "[Report] Log review semanal" }),
)
check(
  "la gravedad la pone el semáforo de Qualy antes que las palabras",
  securityLevel({ title: "[QA-sec] 🟡 14 HIGH en pnpm audit", priority: 2 }) === "media" &&
    securityLevel({ title: "[Security] CRITICAL: Next.js RCE", priority: 0 }) === "alta" &&
    securityLevel({ title: "[Proposal] Validar el slug", priority: 0 }) === "sin nivel",
)
check(
  "los números salen de los reportes de Numa, Greta y Qualy, no de ticks ni log reviews",
  isMetricRecord({ kind: "report", source: "numa", title: "[Report] Free→paid oct 2026 — día 5" }) &&
    !isMetricRecord({ kind: "report", source: "leda", title: "[Report] Tick publish" }) &&
    !isMetricRecord({ kind: "report", source: "qualy", title: "[Report] Log review semanal — 2026-10-15" }) &&
    !isMetricRecord({ kind: "plan", source: "capi", title: "[Plan] Roadmap priorizado" }),
)
check("los ticks con título distinto son una sola serie", seriesOf("[Report] Tick blog-publish-tick — 0 posts") === seriesOf("[Report] content-blog-publish-tick — tick limpio 2026-10-04"))
check(
  "el [Retro] para Alfred va al team de alfred.teamKey, y sin ese dato al del primer proyecto",
  alfredTeamOf({ alfred: { teamKey: "ACM" }, projects: [{ teamKey: "BET" }] }) === "ACM" && alfredTeamOf({ projects: [{ teamKey: "BET" }, { teamKey: "ACM" }] }) === "BET",
)

{
  const on = { archiveRecords: true, closeObviousDuplicates: true, closeVerifiedDone: true }
  const rec = { class: "record" }
  const work = { class: "work" }
  check("vía: un registro leído lo cierra el lead", laneOf({ as: "done" }, rec, on) === "auto")
  check("vía: sin permiso, hasta un registro espera el sí", laneOf({ as: "done" }, rec, {}) === "ask")
  check(
    "issueRefs encuentra los issues que nombra un título o una rama, sin repetir",
    JSON.stringify(issueRefs(["ACM", "BET"], "BET-178: Write down the subscription", "cody/acm-68-imagenes", "Crear el plan (ACM-899) y ACM-899")) === JSON.stringify(["BET-178", "ACM-68", "ACM-899"]) &&
      issueRefs(["ACM"], "XACM-1 no cuenta, ni ACM-12x", null).length === 0,
  )
  check("vía: cancelar una propuesta es siempre del owner", laneOf({ as: "canceled", verified: true }, work, on) === "ask")
  check(
    "vía: «ya está hecho» sin evidencia escrita espera el sí",
    laneOf({ as: "done" }, work, on) === "ask" && laneOf({ as: "done", verified: true }, work, on) === "ask" && laneOf({ as: "done", verified: true, why: "PR #41 mergeado." }, work, on) === "auto",
  )
  check("vía: un duplicado sin original espera el sí", laneOf({ as: "duplicate" }, work, on) === "ask" && laneOf({ as: "duplicate", dupOf: "ACM-1" }, work, on) === "auto")
}

// -------------------------------------------- sync contra una API de mentira

const now = new Date().toISOString()
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString()

{
  const node = (identifier, title, extra = {}) => ({
    id: `uuid-${identifier}`, identifier, title, url: `https://linear.app/test/issue/${identifier}`, priority: 0, estimate: null,
    createdAt: daysAgo(5), updatedAt: daysAgo(1), completedAt: null, canceledAt: null, startedAt: null,
    description: "", team: { key: identifier.split("-")[0] }, state: { name: "Backlog", type: "backlog" },
    assignee: null, project: null, parent: null, labels: { nodes: [{ name: "agent-proposal" }] }, attachments: { nodes: [] }, comments: { nodes: [] },
    ...extra,
  })
  const open = [
    node("ACM-100", "[Proposal] Mejorar el checkout", {
      description: "## Contexto\nAlgo pasa.\n\n## Propuesta\nCambiar el botón.\n\n---\nGenerado por 🤖 Pico 🎯",
      comments: { nodes: [
        { createdAt: daysAgo(1), body: "🤖 Cody 💻: PR abierta → https://github.com/tu-org/acme-app/pull/999", user: { name: "Owner" } },
        { createdAt: daysAgo(2), body: "Cody: implementa esto", user: { name: "Owner" } },
      ] },
    }),
    node("BET-100", "[QA] 🟡 Algo en los logs", {
      comments: { nodes: [{ createdAt: new Date(Date.now() - 5 * 3600_000).toISOString(), body: "qualy: ¿se repite?", user: { name: "Owner" } }] },
    }),
    node("BET-101", "[Report] (SEO) semana 2026-10-05", { labels: { nodes: [{ name: "agent-report" }, { name: "seo" }] } }),
  ]
  // Dos reportes ya cerrados: uno de hoy, que el lead todavía tiene que leer, y uno de hace un mes.
  const reportBody = `## Headline\n${"Free→paid 3,20% (16 de 500). ".repeat(12)}\n\n## Detalle\nEl mes anterior cerró en 2,40%.`
  const bornDone = (identifier, title, age) =>
    node(identifier, title, { description: reportBody, labels: { nodes: [{ name: "agent-report" }] }, state: { name: "Done", type: "completed" }, createdAt: daysAgo(age), updatedAt: daysAgo(age), completedAt: daysAgo(age) })
  const closed = [
    node("ACM-90", "[Proposal] Ya hecho", { description: reportBody, state: { name: "Done", type: "completed" }, completedAt: daysAgo(2) }),
    bornDone("ACM-91", "[Report] Free→paid oct 2026 — día 10", 0.5),
    bornDone("ACM-92", "[Report] Free→paid sep 2026 — día 9", 30),
  ]
  const { createServer } = await import("node:http")
  const mock = createServer((req, res) => {
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      const { query, variables } = JSON.parse(body)
      const ok = req.headers.authorization === "selftest-key"
      const data = !ok
        ? null
        : /workflowStates/.test(query)
          ? { workflowStates: { nodes: [{ id: "s1", name: "Backlog", type: "backlog", team: { key: "ACM" } }, { id: "s2", name: "Done", type: "completed", team: { key: "ACM" } }] } }
          : { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: variables.filter.state.type.in ? open : closed } }
      res.writeHead(ok ? 200 : 401, { "Content-Type": "application/json" })
      res.end(JSON.stringify(ok ? { data } : { errors: [{ message: "Authentication required, not authenticated" }] }))
    })
  })
  await new Promise((r) => mock.listen(4791, "127.0.0.1", r))
  const syncDir = mkdtempSync(join(tmpdir(), "lead-selftest-sync-"))
  // Asíncrono a propósito: la API de mentira vive en este mismo proceso, y un
  // spawnSync le congelaría el event loop mientras el hijo espera su respuesta.
  const sync = (key, extra = {}) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [join(HERE, "sync.mjs"), "--no-github"], {
        env: { ...process.env, LEAD_STATE_DIR: syncDir, LEAD_CONFIG: CONFIG, LINEAR_API_KEY: key, LINEAR_API_URL: "http://127.0.0.1:4791/graphql", LEAD_ENV_REEXEC: "1", ...extra },
      })
      let stderr = ""
      child.stderr.on("data", (d) => (stderr += d))
      child.stdout.resume()
      const timer = setTimeout(() => child.kill(), 20_000)
      child.on("close", (status) => (clearTimeout(timer), resolve({ status, stderr })))
    })

  let s = await sync("key-vencida")
  check("sync sale con código 2 y pasos claros cuando Linear rechaza la key", s.status === 2 && /env:encrypt/.test(s.stderr), `${s.status} ${s.stderr}`)
  s = await sync("selftest-key")
  check("sync arma el snapshot", s.status === 0, s.stderr)
  if (s.status === 0) {
    const snap = JSON.parse(readFileSync(join(syncDir, "snapshot.json"), "utf8"))
    const by = Object.fromEntries(snap.issues.map((i) => [i.id, i]))
    check("sync: 3 abiertos + 3 cerrados, con los estados por team", snap.issues.length === 6 && snap.states.ACM?.Done?.id === "s2")
    check(
      "sync: un reporte reciente ya cerrado conserva su resumen; uno viejo y un cerrado de trabajo, no",
      by["ACM-91"].summary.length > 300 && by["ACM-92"].summary.length <= 160 && by["ACM-90"].summary.length <= 160,
      `${by["ACM-91"].summary.length} ${by["ACM-92"].summary.length} ${by["ACM-90"].summary.length}`,
    )
    check("sync: el autor sale de la firma del cuerpo", by["ACM-100"].source === "pico" && by["ACM-100"].sections.propuesta === "Cambiar el botón.")
    check("sync: si el agente respondió último, la pelota la tiene el owner", by["ACM-100"].ball.with === "owner" && by["ACM-100"].ball.agent === "cody" && by["ACM-100"].comments.lastKind === "bot")
    check("sync: encuentra el PR mencionado en el hilo", by["ACM-100"].prUrls[0] === "https://github.com/tu-org/acme-app/pull/999")
    check("sync: un disparo sin respuesta deja la pelota en el agente", by["BET-100"].ball.with === "agent" && by["BET-100"].ball.agent === "qualy")
    check("sync: un reporte es registro y un cerrado no está abierto", by["BET-101"].class === "record" && by["ACM-90"].open === false)
    check("sync: las estadísticas cuentan por team", snap.stats.byTeam.ACM.open === 1 && snap.stats.byTeam.BET.open === 2 && snap.stats.byTeam.ACM.done7d === 1)
    check("sync: un reporte cerrado no cuenta como trabajo hecho", snap.stats.byTeam.ACM.done7d === 1 && snap.stats.byTeam.ACM.records7d === 1, JSON.stringify(snap.stats.byTeam.ACM))
  }
  mock.close()

  // Un Linear que acepta la conexión y nunca contesta no puede dejar colgado el sync.
  const mute = createServer(() => {})
  await new Promise((r) => mute.listen(4793, "127.0.0.1", r))
  const t0 = Date.now()
  s = await sync("selftest-key", { LINEAR_API_URL: "http://127.0.0.1:4793/graphql", LINEAR_TIMEOUT_MS: "250" })
  check("sync corta si Linear no contesta, en vez de quedar colgado", s.status === 1 && /no respondió/.test(s.stderr) && Date.now() - t0 < 19_000, `${s.status} ${s.stderr}`)
  mute.closeAllConnections?.()
  mute.close()
  rmSync(syncDir, { recursive: true, force: true })
}

// ------------------------------------------------------------- estado falso

const issue = (id, title, extra = {}) => {
  const labels = extra.labels ?? ["agent-proposal"]
  const kind = kindOf(title, labels)
  const created = daysAgo(extra.age ?? 3)
  return {
    id, uuid: `uuid-${id}`, team: id.split("-")[0], title, url: `https://linear.app/test/issue/${id}`,
    kind, class: classOf(kind), source: sourceOf({ title, labels, body: "" }),
    state: extra.state ?? "Backlog", stateType: extra.stateType ?? "backlog", open: extra.open ?? true,
    priority: 0, estimate: null, labels, project: null, parent: null, assignee: null,
    createdAt: created, updatedAt: created, startedAt: null, completedAt: extra.completedAt ?? null, canceledAt: null,
    ageDays: extra.age ?? 3, idleDays: extra.age ?? 3, summary: "", sections: {}, bodyChars: 0, prUrls: [], ball: null,
    comments: { count: 0, lastAt: null, lastKind: null, lastAgent: null, lastHumanAt: null, lastBotAt: null, tail: [] },
  }
}
const issues = [
  issue("ACM-1", "[Proposal] Arreglar el checkout"),
  issue("ACM-2", "[Proposal] Lo mismo que ACM-1"),
  issue("ACM-3", "[QA-sec] 🟡 Abuso en el registro"),
  issue("BET-1", "[Proposal] (UX) Mover el botón de apoyo"),
  issue("ACM-10", "[Report] Free→paid oct 2026 — día 1", { labels: ["agent-report"], age: 9 }),
  issue("ACM-11", "[Report] Free→paid oct 2026 — día 2", { labels: ["agent-report"], age: 8 }),
  issue("ACM-12", "[Report] Free→paid oct 2026 — día 9", { labels: ["agent-report"], age: 1 }),
  issue("ACM-20", "[Proposal] Ya hecho", { open: false, state: "Done", stateType: "completed", completedAt: daysAgo(2) }),
  issue("ACM-30", "[Proposal] Tipar un wrapper que nadie pidió", { age: 60 }),
]
// Lo que salió en la app: un PR que nombra un issue todavía abierto, y un cambio que no nombra ninguno.
const shipped = {
  days: 45, since: daysAgo(45), errors: [],
  items: [
    { repo: "tu-org/acme-app", project: "acme", team: "ACM", kind: "pr", ref: "#9", title: "Checkout: flujo nuevo (ACM-1)", url: "https://github.com/tu-org/acme-app/pull/9", at: daysAgo(2), issues: ["ACM-1"] },
    { repo: "tu-org/acme-app", project: "acme", team: "ACM", kind: "commit", ref: "abc1234", title: "Emails: migrar de SendGrid a Resend", url: "https://github.com/tu-org/acme-app/commit/abc1234", at: daysAgo(20), issues: [] },
    { repo: "tu-org/beta-app", project: "beta", team: "BET", kind: "pr", ref: "#3", title: "Ranking por plataforma", url: "https://github.com/tu-org/beta-app/pull/3", at: daysAgo(50), issues: [] },
  ],
}
writeFileSync(
  join(STATE, "snapshot.json"),
  JSON.stringify({
    generatedAt: now, source: "selftest", window: { closedDays: 45 },
    teams: [{ key: "ACM", slug: "acme", name: "Acme" }, { key: "BET", slug: "beta", name: "Beta" }],
    states: {}, stats: buildStats(issues, ["ACM", "BET"], now), prs: { open: [], merged: [], errors: [] }, shipped, issues,
  }),
)

// --------------------------------------------------------------------- CLI

const cli = (...args) => spawnSync(process.execPath, [join(HERE, "lead.mjs"), ...args], { env, encoding: "utf8" })
const draft = (name, data) => {
  const p = join(STATE, "tmp", name)
  writeFileSync(p, JSON.stringify(data))
  return `--file=${p}`
}

let r = cli("triage", draft("bad.json", [{ id: "ACM-1", verdict: "do", why: "x" }]))
check("triage rechaza un «do» sin objetivo ni dueño", r.status === 1 && /objective inválido/.test(r.stderr), r.stderr)

r = cli("triage", draft("ok.json", [
  { id: "ACM-1", verdict: "do", objective: "revenue", impact: 3, effort: 1, confidence: 2, owner: "cody", why: "Mueve cobros.", next: "Cody: implementa este issue." },
  { id: "ACM-2", verdict: "close", closeAs: "duplicate", dupOf: "ACM-1", why: "Igual a ACM-1." },
  { id: "ACM-3", verdict: "decide", question: "¿Límite por IP?", why: "Volvió tres veces." },
  { id: "BET-1", verdict: "do", objective: "revenue", impact: 2, effort: 1, owner: "daly", why: "Es UI nueva." },
]))
check("triage guarda veredictos válidos", r.status === 0, r.stderr)
const triage = JSON.parse(readFileSync(join(STATE, "triage.json"), "utf8"))
check("el puntaje ordena: facturación de Acme (más impacto, más atención) arriba de Beta", triage.items["ACM-1"].score > triage.items["BET-1"].score)

{
  // Alguien edita un issue ya triado, sin comentar ni cambiarlo de estado.
  const snapPath = join(STATE, "snapshot.json")
  const snap = JSON.parse(readFileSync(snapPath, "utf8"))
  const edited = snap.issues.find((i) => i.id === "BET-1")
  const before = edited.title
  r = cli("inbox")
  const quiet = !/BET-1/.test(r.stdout)
  edited.title = "[Proposal] (UX) Mover el botón de apoyo y cambiarle el texto"
  writeFileSync(snapPath, JSON.stringify(snap))
  r = cli("inbox")
  check("un issue editado sin comentar vuelve a la bandeja", quiet && /BET-1/.test(r.stdout) && /cambió el título/.test(r.stdout), r.stdout)
  edited.title = before
  writeFileSync(snapPath, JSON.stringify(snap))
}

r = cli("records", "--archive")
check("records archiva los reportes de dos días o más y deja abierto el reciente", r.status === 0 && /archivables 2/.test(r.stdout), r.stdout)

{
  // El owner lee los reportes en el Backlog: quedan abiertos y se archivan a los dos días, también
  // el más nuevo de su serie. El [Plan] de la semana es la excepción. Un reporte que el owner cerró
  // después de leerlo se lista igual para que lo lea el lead; uno cancelado, no.
  const snapPath = join(STATE, "snapshot.json")
  const saved = readFileSync(snapPath, "utf8")
  const snap = JSON.parse(saved)
  snap.issues.push(
    issue("ACM-13", "[Report] Free→paid oct 2026 — día 10", { labels: ["agent-report"], age: 0.2, open: false, state: "Done", stateType: "completed", completedAt: daysAgo(0.1) }),
    issue("ACM-14", "[Report] Free→paid oct 2026 — día 11", { labels: ["agent-report"], age: 0.1, open: false, state: "Canceled", stateType: "canceled" }),
    issue("BET-20", "[Report] (SEO) semana 2026-10-05", { labels: ["agent-report"], age: 5 }),
    issue("ACM-40", "[Plan] Roadmap priorizado — semana 2026-10-05", { labels: ["agent-report"], age: 5 }),
    issue("ACM-41", "[Plan] Roadmap priorizado — semana 2026-09-28", { labels: ["agent-report"], age: 12 }),
  )
  writeFileSync(snapPath, JSON.stringify(snap))
  r = cli("records")
  const toRead = r.stdout.split("## Series")[0]
  check("records trae para leer un reporte que ya está cerrado, y no uno cancelado", r.status === 0 && /ACM-13 \|[^\n]*ya cerrado/.test(toRead) && !/ACM-14/.test(r.stdout), r.stdout + r.stderr)
  check("un reporte de dos días o más se archiva aunque sea el más nuevo de su serie", /BET\|report\|[^\n]*último BET-20 \(5d\) · archivables 1/.test(r.stdout), r.stdout)
  check("el [Plan] de la semana queda abierto y el anterior se archiva", /ACM\|plan\|[^\n]*último ACM-40 \(5d\) · archivables 1/.test(r.stdout), r.stdout)
  writeFileSync(snapPath, saved)
}

r = cli("plan", draft("plan-bad.json", { items: [{ id: "ACM-1", type: "dispatch", agent: "cody", comment: "implementa esto", why: "x" }] }))
check("plan rechaza un comentario que no dispara a nadie", r.status === 1 && /debe empezar con/.test(r.stderr), r.stderr)

r = cli("plan", draft("plan-sin-verificar.json", { items: [{ id: "ACM-1", type: "dispatch", agent: "cody", comment: "Cody: implementa este issue.", why: "Lo dice un reporte de hace dos días." }] }))
check("plan rechaza un pedido cuya premisa no se verificó hoy", r.status === 1 && /falta «checked»/.test(r.stderr), r.stderr)

r = cli("plan", draft("plan-cerrado.json", { items: [{ id: "ACM-20", type: "dispatch", agent: "cody", comment: "Cody: implementa este issue.", why: "x", checked: "Visto hoy." }] }))
check("plan rechaza un pedido sobre un issue cerrado", r.status === 1 && /está cerrado/.test(r.stderr), r.stderr)

r = cli("plan", draft("plan-largo.json", { items: Array.from({ length: 12 }, (_, n) => ({ type: "you", title: `Cosa ${n + 1}`, why: "x", minutes: 1 })) }))
check("plan rechaza más acciones que el tope del día", r.status === 1 && /planItemsMax/.test(r.stderr), r.stderr)

r = cli("plan", draft("plan-caro.json", { items: [{ type: "you", title: "Una tarde entera", why: "x", minutes: 600 }] }))
check("plan rechaza más minutos del owner que el tope del día", r.status === 1 && /ownerMinutesPerDay/.test(r.stderr), r.stderr)

r = cli("plan", draft("plan-cancela-hacer.json", { items: [], closeBatch: [{ id: "ACM-1", as: "canceled", why: "Lleva mucho quieto." }] }))
check("plan no propone cancelar lo que el triage dice que hay que hacer", r.status === 1 && /el triage dice «hacer»/.test(r.stderr), r.stderr)

{
  // Lo que se dejó abierto hasta una fecha tampoco vuelve al lote con otro motivo.
  const triagePath = join(STATE, "triage.json")
  const saved = readFileSync(triagePath, "utf8")
  const t = JSON.parse(saved)
  Object.assign(t.items["BET-1"], { verdict: "later", until: "2099-01-01", why: "Lo dejé abierto: achica los avisos." })
  writeFileSync(triagePath, JSON.stringify(t))
  r = cli("plan", draft("plan-cancela-despues.json", { items: [], closeBatch: [{ id: "BET-1", as: "canceled", why: "Higiene vieja." }] }))
  check("plan no propone cancelar lo que se dejó abierto hasta una fecha", r.status === 1 && /para después del 2099-01-01/.test(r.stderr), r.stderr)
  // …y el resumen del día deja de contarlo entre los viejos sin decidir.
  const snapPath = join(STATE, "snapshot.json")
  const snapSaved = readFileSync(snapPath, "utf8")
  const snap = JSON.parse(snapSaved)
  snap.issues.find((i) => i.id === "BET-1").idleDays = 60
  writeFileSync(snapPath, JSON.stringify(snap))
  r = cli("brief")
  check(
    "brief separa lo viejo que quedó abierto a propósito de lo viejo sin decidir",
    r.status === 0 && r.stdout.includes("abiertos a propósito (1)") && r.stdout.includes("hasta 2099-01-01") && !/Viejos sin decisión[^\n]*\n(- [^\n]*\n)*- \[BET-1\]/.test(r.stdout),
    r.stdout + r.stderr,
  )
  writeFileSync(snapPath, snapSaved)
  t.items["BET-1"].until = "2020-01-01"
  writeFileSync(triagePath, JSON.stringify(t))
  r = cli("plan", draft("plan-cancela-vencido.json", { items: [], closeBatch: [{ id: "BET-1", as: "canceled", why: "Venció y nadie lo pidió." }] }))
  check("un «después» vencido sí se puede proponer para cerrar", r.status === 0, r.stderr)
  writeFileSync(triagePath, saved)
}

r = cli("plan", draft("plan-ok.json", {
  headline: "Prueba.",
  items: [
    { id: "ACM-1", type: "dispatch", agent: "cody", title: "Que Cody arregle el checkout", why: "Mueve cobros.", checked: "main, hoy: el botón sigue apuntando al link viejo.", minutes: 2, comment: "Cody: implementa este issue." },
    { id: "ACM-3", type: "decide", title: "¿Límite por IP?", why: "Volvió tres veces.", checked: "Logs de auth, hoy: tres ráfagas en la semana.", question: "¿Lo construimos?", options: [{ label: "Sí", comment: "Cody: construye el límite por IP." }, { label: "No" }] },
    { type: "you", title: "Mira Stripe", why: "Solo tú entras.", steps: ["Abre el panel."] },
  ],
  // Pide archivar todo, sin edad mínima: el CLI igual deja abierto el reporte de ayer (ACM-12).
  closeRecords: { minAgeDays: 0 },
  closeBatch: [{ id: "ACM-2", as: "duplicate", dupOf: "ACM-1", why: "Igual a ACM-1." }],
}))
check("plan instala y expande los registros viejos, sin tocar los de menos de dos días", r.status === 0 && /3 para cerrar en lote/.test(r.stdout), r.stdout + r.stderr)

r = cli("mark", "3", "done")
check("mark no anota nada si no se dice quién decidió", r.status === 1 && /--actor/.test(r.stderr), r.stderr)
r = cli("mark", "3", "done", "--actor=owner")
check("mark deja el item hecho y lo registra", r.status === 0 && /"plan-done"/.test(readFileSync(join(STATE, "decisions.jsonl"), "utf8")), r.stderr)
// Las tareas aprobadas se siguen hasta que estén hechas.
const tasksFile = () => JSON.parse(readFileSync(join(STATE, "tasks.json"), "utf8")).items
const planFile = () => JSON.parse(readFileSync(join(STATE, "plan.json"), "utf8"))
r = cli("mark", "1", "dispatched", "--actor=owner")
check("un pedido que sale abre una tarea en seguimiento", r.status === 0 && tasksFile()[0]?.id === "ACM-1" && tasksFile()[0].stage === "dispatched", r.stderr)
r = cli("plan", `--file=${join(STATE, "tmp", "plan-ok.json")}`)
check("plan no vuelve a proponer un pedido que ya está en marcha", r.status === 1 && /ya es una tarea en marcha/.test(r.stderr), r.stderr)
r = cli("follow")
check("follow muestra la tarea y el paso que sigue", r.status === 0 && /ACM-1/.test(r.stdout) && /→ /.test(r.stdout), r.stdout + r.stderr)
// Una tarea que hace una sesión local de Claude Code se sigue igual, pero no hay pedido que reenviar.
r = cli("task", "BET-1", "dispatched", "--agent=local", "--actor=owner")
const localFollow = cli("follow")
check(
  "una tarea de una sesión local entra al seguimiento sin proponer reenviarla",
  r.status === 0 && tasksFile().some((t) => t.id === "BET-1" && t.agent === "local") && /sesión local de Claude Code/.test(localFollow.stdout),
  r.stderr + localFollow.stdout,
)
cli("task", "BET-1", "dropped", "--note=fin de la prueba")
r = cli("task", "ACM-1", "needs-owner", "--pr=https://github.com/tu-org/acme-app/pull/1", "--note=PR listo")
check("task mueve la etapa, anota el PR y deja la pelota en el owner", r.status === 0 && tasksFile()[0].stage === "needs-owner" && tasksFile()[0].waitingOn === "owner" && /pull\/1$/.test(tasksFile()[0].pr), r.stderr)
r = cli("brief")
check(
  "brief trae los links ya armados: el issue, el PR de la tarea y lo viejo sin decisión",
  r.status === 0 &&
    r.stdout.includes("[ACM-1](https://linear.app/test/issue/ACM-1)") &&
    r.stdout.includes("[acme-app#1](https://github.com/tu-org/acme-app/pull/1)") &&
    r.stdout.includes("## Viejos sin decisión: 1 ") &&
    r.stdout.includes("- [ACM-30](https://linear.app/test/issue/ACM-30)"),
  r.stdout + r.stderr,
)
{
  const sec = r.stdout.split("## Seguridad")[1]?.split("\n## ")[0] ?? ""
  const nums = r.stdout.split("## Números por proyecto")[1]?.split("\n## ")[0] ?? ""
  check(
    "brief abre con seguridad (el hallazgo de Qualy con su link) y sigue con los números de cada proyecto",
    r.stdout.indexOf("## Seguridad — 1 abierto (🟡 media 1)") > 0 &&
      r.stdout.indexOf("## Seguridad") < r.stdout.indexOf("## Números por proyecto") &&
      r.stdout.indexOf("## Números por proyecto") < r.stdout.indexOf("## En marcha") &&
      sec.includes("[ACM-3](https://linear.app/test/issue/ACM-3)") &&
      sec.includes("ACM: abrió [ACM-3](https://linear.app/test/issue/ACM-3)") &&
      sec.includes("BET: nada en la ventana del snapshot") &&
      nums.includes("### Acme (ACM)") &&
      nums.includes("### Beta (BET)") &&
      /\[ACM-12\]\(https:\/\/linear\.app\/test\/issue\/ACM-12\) · Numa · \d{4}-\d{2}-\d{2} — /.test(nums) &&
      nums.includes("antes: [ACM-11](https://linear.app/test/issue/ACM-11)"),
    r.stdout,
  )
}
{
  // Qualy comentó y después contestó una persona: el comentario de Qualy sigue contando. Y un
  // issue que Qualy solo comentó no figura como abierto por ella.
  const snapPath = join(STATE, "snapshot.json")
  const saved = readFileSync(snapPath, "utf8")
  const snap = JSON.parse(saved)
  const thread = snap.issues.find((i) => i.id === "ACM-1")
  Object.assign(thread.comments, { lastAgent: null, lastKind: "human", agentLastAt: { qualy: daysAgo(1) } })
  Object.assign(thread, { source: "qualy", openedBy: "human" })
  writeFileSync(snapPath, JSON.stringify(snap))
  const b = cli("brief")
  check(
    "lo último de Qualy toma su comentario aunque después haya contestado una persona",
    /ACM: comentó \[ACM-1\]\([^)]+\) el \d{4}-\d{2}-\d{2}/.test(b.stdout),
    b.stdout.split("\n").find((l) => l.startsWith("Lo último de Qualy")) ?? b.stdout,
  )
  writeFileSync(snapPath, saved)
}
check(
  "brief avisa de un issue abierto que un cambio mergeado nombra",
  r.stdout.includes("Abiertos que un cambio mergeado nombra (1)") && r.stdout.includes("[acme-app #9](https://github.com/tu-org/acme-app/pull/9)"),
  r.stdout,
)
r = cli("shipped")
check(
  "shipped lista lo que salió y marca los issues que siguen abiertos",
  r.status === 0 && r.stdout.includes("un cambio mergeado los nombra (1)") && r.stdout.includes("Resend") && !r.stdout.includes("Ranking por plataforma"),
  r.stdout + r.stderr,
)
r = cli("shipped", "--grep=resend")
check("shipped busca por texto", r.status === 0 && /Resend/.test(r.stdout) && !/flujo nuevo/.test(r.stdout), r.stdout)
{
  // El hilo de un pedido a Cody puede mencionar un PR de Alfred en el repo de agentes: no es el PR de la tarea.
  const agentsPr = { url: "https://github.com/tu-org/agent-team-template/pull/51", project: "agents", team: null, issue: null, checks: "none" }
  const productPr = { url: "https://github.com/tu-org/acme-app/pull/7", project: "acme", team: "ACM", issue: "ACM-1", checks: "passing" }
  const snap = { issues: [{ ...issues[0], prUrls: [agentsPr.url] }], prs: { open: [agentsPr, productPr], merged: [] } }
  const sig = taskSignals({ id: "ACM-1", team: "ACM", agent: "cody", stage: "dispatched", stageAt: now, pr: null }, snap)
  check("el PR de una tarea es el del repo de quien la hace, no cualquiera que nombre el hilo", sig.openPrs.length === 1 && sig.openPrs[0].url === productPr.url, JSON.stringify(sig.openPrs))
}
r = cli("task", "ACM-99", "done")
check("task rechaza un issue que no está en seguimiento", r.status === 1, r.stderr)
cli("task", "ACM-1", "dropped")
cli("mark", "1", "pending", "--actor=owner")
r = cli("plan", `--file=${join(STATE, "tmp", "plan-ok.json")}`)
check("reinstalar el plan del día conserva lo que ya estaba hecho", r.status === 0 && planFile().items[2].status === "done" && planFile().items[0].status === "pending", r.stdout + r.stderr)

r = cli("status")
check("status corre con todo el estado armado", r.status === 0 && /Último plan/.test(r.stdout) && /En marcha: 0 de/.test(r.stdout), r.stderr)

r = cli("alfred", draft("rec-bad.json", [{ id: "r1", agent: "qualy", title: "t", pattern: "p", proposal: "x", evidence: [] }]))
check("alfred rechaza una recomendación sin evidencia", r.status === 1, r.stderr)
r = cli("alfred", draft("rec-ok.json", [{ id: "r1", agent: "qualy", title: "Repite hallazgos", pattern: "p", proposal: "x", evidence: ["ACM-1", "ACM-2", "ACM-3"] }]))
check("alfred guarda una recomendación con evidencia", r.status === 0, r.stderr)

// ----------------------------------- act.mjs contra una API de mentira (cierres)

{
  const actDir = mkdtempSync(join(tmpdir(), "lead-selftest-act-"))
  cpSync(STATE, actDir, { recursive: true })
  const snapPath = join(actDir, "snapshot.json")
  const fake = JSON.parse(readFileSync(snapPath, "utf8"))
  fake.states = { ACM: { Done: { id: "st-done", type: "completed" }, Canceled: { id: "st-canceled", type: "canceled" }, Backlog: { id: "st-backlog", type: "backlog" }, Duplicate: { id: "st-dup", type: "duplicate" }, "In Progress": { id: "st-progress", type: "started" } } }
  writeFileSync(snapPath, JSON.stringify(fake))
  // ACM-11 se deja como «espera su sí». Los demás quedan en «auto», y act.mjs lo vuelve a
  // calcular con la config: la de esta prueba permite archivar registros.
  const planPath = join(actDir, "plan.json")
  const fakePlan = JSON.parse(readFileSync(planPath, "utf8"))
  for (const c of fakePlan.closeBatch) c.lane = c.id === "ACM-11" ? "ask" : "auto"
  writeFileSync(planPath, JSON.stringify(fakePlan))

  const stateNames = { "st-done": ["Done", "completed"], "st-canceled": ["Canceled", "canceled"], "st-backlog": ["Backlog", "backlog"], "st-dup": ["Duplicate", "duplicate"], "st-progress": ["In Progress", "started"] }
  const descriptions = {}
  const calls = []
  let failComment = false
  // Cómo está cada issue «en Linear» ahora: act.mjs lo consulta antes de cada cierre.
  const live = {}
  const { createServer } = await import("node:http")
  const mock = createServer((req, res) => {
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      const { query, variables } = JSON.parse(body)
      res.writeHead(200, { "Content-Type": "application/json" })
      if (/issueRelationCreate/.test(query)) {
        calls.push(variables)
        return res.end(JSON.stringify({ data: { issueRelationCreate: { success: true } } }))
      }
      if (/issueLabels/.test(query)) return res.end(JSON.stringify({ data: { teams: { nodes: [{ id: "team-acm" }] }, issueLabels: { nodes: [{ id: "lbl-alfred", team: { key: variables.team } }] } } }))
      if (/issueCreate/.test(query)) {
        calls.push(variables)
        return res.end(JSON.stringify({ data: { issueCreate: { success: true, issue: { id: "uuid-ACM-900", identifier: "ACM-900", url: "https://linear.app/test/issue/ACM-900" } } } }))
      }
      if (/commentCreate/.test(query)) {
        calls.push(variables)
        return res.end(JSON.stringify({ data: { commentCreate: { success: !failComment } } }))
      }
      if (!/issueUpdate/.test(query))
        return res.end(JSON.stringify({ data: { issue: { description: descriptions[variables.id] ?? "Texto original.", state: live[variables.id] ?? { name: "Backlog", type: "backlog" }, updatedAt: "2000-01-01T00:00:00.000Z" } } }))
      calls.push(variables)
      // Un cambio de descripción o de prioridad no mueve el issue de estado.
      if (variables.input?.description != null) descriptions[variables.id] = variables.input.description
      if (variables.input?.stateId) {
        const [name, type] = stateNames[variables.input.stateId] ?? ["?", "?"]
        live[variables.id] = { name, type }
      }
      const state = live[variables.id] ?? { name: "Backlog", type: "backlog" }
      res.end(JSON.stringify({ data: { issueUpdate: { success: true, issue: { identifier: String(variables.id).replace("uuid-", ""), state } } } }))
    })
  })
  await new Promise((r) => mock.listen(4792, "127.0.0.1", r))
  const act = (...args) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [join(HERE, "act.mjs"), ...args], {
        env: { ...process.env, LEAD_STATE_DIR: actDir, LEAD_CONFIG: CONFIG, LINEAR_API_KEY: "selftest-key", LINEAR_API_URL: "http://127.0.0.1:4792/graphql", LEAD_ENV_REEXEC: "1" },
      })
      let out = ""
      child.stdout.on("data", (d) => (out += d))
      child.stderr.on("data", (d) => (out += d))
      const timer = setTimeout(() => child.kill(), 20_000)
      child.on("close", (status) => (clearTimeout(timer), resolve({ status, out })))
    })
  const batch = (id) => JSON.parse(readFileSync(planPath, "utf8")).closeBatch.find((c) => c.id === id)
  const log = () => readFileSync(join(actDir, "decisions.jsonl"), "utf8")

  let a = await act("close", "--lane=auto", "--dry-run")
  check("act en simulación no llama a Linear", a.status === 0 && calls.length === 0 && /Cerraría 1/.test(a.out), a.out)
  a = await act("close", "--lane=auto", "--dryrun")
  check("act no corre con un flag mal escrito (un --dryrun ignorado sería un cierre real)", a.status === 1 && calls.length === 0 && /No conozco/.test(a.out), a.out)
  a = await act("close", "--lane=auto")
  check("act cierra solo lo de bajo riesgo y lo firma el lead", a.status === 0 && calls.length === 1 && calls[0].id === "uuid-ACM-10" && /"actor":"lead"/.test(log()) && batch("ACM-10").status === "done" && batch("ACM-11").status === "pending", a.out)
  check("act deja los duplicados para el conector", /ACM-2/.test(a.out) && /conector/.test(a.out) && batch("ACM-2").status === "pending", a.out)
  a = await act("close", "--ids=ACM-11")
  check("act no cierra a pedido sin la frase del owner", a.status === 1 && calls.length === 1, a.out)
  live["uuid-ACM-11"] = { name: "In Progress", type: "started" }
  a = await act("close", "--ids=ACM-11", "--approved=dale, cerralas")
  check("act no cierra algo que cambió de estado en Linear después del sync", calls.length === 1 && /alguien lo movió/.test(a.out) && batch("ACM-11").status === "pending", a.out)
  delete live["uuid-ACM-11"]
  a = await act("close", "--ids=ACM-11", "--approved=sí, ciérralas")
  check("act cierra lo aprobado y lo anota a nombre del owner, con su frase", a.status === 0 && calls.length === 2 && /"actor":"owner"/.test(log()) && /"approved":"sí, ciérralas"/.test(log()), a.out)
  a = await act("reopen", "--ids=ACM-10")
  check("act no reabre sin que quede dicho quién lo pidió", a.status === 1 && calls.length === 2, a.out)
  a = await act("reopen", "--ids=ACM-10", "--actor=owner")
  check("act deshace un cierre: el issue vuelve a donde estaba", a.status === 0 && calls[2]?.input.stateId === "st-backlog" && JSON.parse(readFileSync(snapPath, "utf8")).issues.find((i) => i.id === "ACM-10").open === true, a.out)
  a = await act("reopen", "--ids=ACM-10", "--actor=owner")
  check("act no manda a Backlog un issue que no está cerrado", a.status === 1 && calls.length === 3 && /no está cerrado/.test(a.out), a.out)

  // Fundir: el que queda suma lo que pide el otro, y el otro pasa a duplicado. Solo con su sí.
  const fusePath = join(actDir, "tmp", "fuse.json")
  writeFileSync(fusePath, JSON.stringify([{ keep: "ACM-1", priority: 3, includes: [{ id: "ACM-3", text: "Poner un límite por IP en el registro." }] }]))
  a = await act("fuse", `--file=${fusePath}`)
  check("act no funde sin la frase del owner", a.status === 1 && calls.length === 3, a.out)
  a = await act("fuse", `--file=${fusePath}`, "--approved=fúndelas", "--dry-run")
  check("fundir en simulación no llama a Linear", a.status === 0 && calls.length === 3 && /quedaría ACM-1/.test(a.out), a.out)
  // El texto original ya nombra al otro en negrita: eso no es haberlo absorbido, y la línea se agrega igual.
  descriptions["uuid-ACM-1"] = "Texto original. Complementa (no duplica) a **ACM-3**."
  a = await act("fuse", `--file=${fusePath}`, "--approved=fundilas")
  const fusedSnap = JSON.parse(readFileSync(snapPath, "utf8")).issues
  check(
    "fundir agrega lo absorbido al que queda sin pisar su texto, y marca el otro como duplicado",
    a.status === 0 &&
      descriptions["uuid-ACM-1"]?.startsWith("Texto original.") &&
      descriptions["uuid-ACM-1"].includes("## Incluye también") &&
      descriptions["uuid-ACM-1"].includes("- **ACM-3** — Poner un límite por IP en el registro.") &&
      calls.some((c) => c.input?.type === "duplicate" && c.input.issueId === "uuid-ACM-3" && c.input.relatedIssueId === "uuid-ACM-1") &&
      live["uuid-ACM-3"]?.name === "Duplicate" &&
      fusedSnap.find((i) => i.id === "ACM-3").open === false &&
      fusedSnap.find((i) => i.id === "ACM-1").open === true &&
      /"action":"fuse"/.test(log()),
    a.out,
  )
  // --approved no se interpreta: la frase del owner vale igual en tuteo o en voseo, y se anota tal cual.
  check("la frase del owner se anota tal cual, en tuteo o en voseo", /"approved":"sí, ciérralas"/.test(log()) && /"approved":"fundilas"/.test(log()))
  const before = calls.length
  a = await act("fuse", `--file=${fusePath}`, "--approved=fúndelas")
  check("fundir dos veces no repite nada", a.status === 0 && calls.length === before && /ya está cerrado/.test(a.out), a.out)

  // In Progress: lo que un agente ya tiene se tiene que ver como en curso.
  a = await act("start", "--ids=ACM-12", "--actor=lead")
  check("por su cuenta, el lead no pasa a In Progress algo que no es una tarea aprobada", a.status === 1 && calls.length === before && /no es una tarea en marcha/.test(a.out), a.out)
  a = await act("start", "--ids=ACM-12", "--actor=owner")
  check(
    "start pasa el issue a In Progress y lo refleja en el snapshot",
    a.status === 0 && live["uuid-ACM-12"]?.name === "In Progress" && JSON.parse(readFileSync(snapPath, "utf8")).issues.find((i) => i.id === "ACM-12").state === "In Progress" && /"action":"start"/.test(log()),
    a.out,
  )
  // Mandar a Alfred por chat: el mismo [Retro] que arma el tablero, y la recomendación deja de ser borrador.
  a = await act("retro", "--recs=all")
  check("act no le manda nada a Alfred sin la frase del owner", a.status === 1 && /--approved/.test(a.out), a.out)
  const beforeRetro = calls.length
  a = await act("retro", "--recs=all", "--approved=mándalas")
  const sentRec = JSON.parse(readFileSync(join(actDir, "alfred.json"), "utf8")).items.find((x) => x.id === "r1")
  check(
    "mandar a Alfred crea el [Retro] con su label y marca la recomendación como enviada",
    a.status === 0 &&
      calls.slice(beforeRetro).some((c) => /^\[Retro\] Qualy: /.test(c.input?.title ?? "") && c.input.labelIds?.[0] === "lbl-alfred" && /## Evidencia/.test(c.input.description)) &&
      sentRec?.status === "sent" &&
      sentRec.linearIssue === "ACM-900" &&
      /"action":"alfred-send"/.test(readFileSync(join(actDir, "decisions.jsonl"), "utf8")),
    a.out,
  )
  // Un issue creado no dispara a nadie: el listener solo mira comentarios. Y lo que sale a un agente no queda en Backlog.
  check(
    "el [Retro] nace In Progress y a Alfred lo dispara un comentario, uno solo",
    calls.slice(beforeRetro).some((c) => /^\[Retro\]/.test(c.input?.title ?? "") && c.input.stateId === "st-progress") &&
      calls.slice(beforeRetro).filter((c) => c.input?.issueId === "uuid-ACM-900" && /^Alfred: /.test(c.input.body ?? "")).length === 1,
    JSON.stringify(calls.slice(beforeRetro)).slice(0, 600),
  )
  a = await act("retro", "--recs=r1", "--approved=mandalas")
  check("una recomendación ya enviada no se manda dos veces", a.status === 1 && /Ya enviada/.test(a.out), a.out)

  // Si el comentario que dispara a Alfred falla, el [Retro] ya creado no se crea otra vez: se reintenta solo el comentario.
  const alfredPath = join(actDir, "alfred.json")
  const alfredStore = JSON.parse(readFileSync(alfredPath, "utf8"))
  alfredStore.items.push({ ...alfredStore.items.find((x) => x.id === "r1"), id: "r2", status: "draft", linearIssue: null, linearIssueId: null, sentAt: null })
  writeFileSync(alfredPath, JSON.stringify(alfredStore))
  const recAt = (id) => JSON.parse(readFileSync(alfredPath, "utf8")).items.find((x) => x.id === id)
  failComment = true
  a = await act("retro", "--recs=r2", "--approved=mándalas")
  check(
    "si falla el comentario, la recomendación queda enviada con el disparo pendiente",
    a.status === 1 && recAt("r2").status === "sent" && recAt("r2").triggerPending === true && recAt("r2").linearIssueId === "uuid-ACM-900",
    a.out,
  )
  failComment = false
  const beforeRetry = calls.length
  a = await act("retro", "--recs=r2", "--approved=mándalas")
  const retryCalls = calls.slice(beforeRetry)
  check(
    "el reintento dispara a Alfred sin crear otro [Retro]",
    a.status === 0 && !retryCalls.some((c) => c.input?.title) && retryCalls.filter((c) => /^Alfred: /.test(c.input?.body ?? "")).length === 1 && !("triggerPending" in recAt("r2")) && !("triggerPending" in recAt("r1")),
    a.out,
  )

  mock.close()
  rmSync(actDir, { recursive: true, force: true })
}

// ----------------------------------------------------------------- tablero

let second = null
const server = spawn(process.execPath, [join(HERE, "..", "app", "server.mjs"), "--dry-run", `--port=${PORT}`], { env, stdio: ["ignore", "pipe", "pipe"] })
await new Promise((resolve, reject) => {
  server.stdout.on("data", (d) => /tablero en/.test(String(d)) && resolve())
  server.stderr.on("data", (d) => reject(new Error(String(d))))
  setTimeout(() => reject(new Error("el tablero no arrancó en 8 s")), 8000)
})

const http = (method, path, { body, headers = {}, host = `127.0.0.1:${PORT}` } = {}) =>
  new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null
    const req = request({ host: "127.0.0.1", port: PORT, method, path, headers: { Host: host, ...(payload ? { "Content-Type": "application/json" } : {}), ...headers } }, (res) => {
      let data = ""
      res.on("data", (c) => (data += c))
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: data, json: () => JSON.parse(data) }))
    })
    req.on("error", reject)
    if (payload) req.write(payload)
    req.end()
  })

try {
  const home = await http("GET", "/")
  const token = /name="lead-token" content="([a-f0-9]+)"/.exec(home.text)?.[1]
  check("la página trae el token y una CSP sin scripts inline", Boolean(token) && /script-src 'self'/.test(home.headers["content-security-policy"] ?? ""))
  // Como la página: con el token, la cabecera que solo manda un navegador y la versión del plan que se está mirando.
  const planAt = (await http("GET", "/api/state")).json().plan.generatedAt
  const act = (body, extra = {}) =>
    http("POST", "/api/action", { body: { planAt, ...body }, headers: { "X-Lead-Token": token, "Sec-Fetch-Site": "same-origin", ...extra.headers }, host: extra.host })

  check("rechaza un Host ajeno (DNS rebinding)", (await http("GET", "/api/state", { host: "evil.example" })).status === 403)
  check("rechaza una escritura sin token", (await http("POST", "/api/action", { body: { type: "accept", issue: "ACM-1" }, headers: { "Sec-Fetch-Site": "same-origin" } })).status === 403)
  check("rechaza una escritura desde otro origen", (await act({ type: "accept", issue: "ACM-1" }, { headers: { Origin: "https://evil.example" } })).status === 403)
  check("rechaza una escritura que no sale de la página (un script con el token)", (await http("POST", "/api/action", { body: { type: "accept", issue: "ACM-1" }, headers: { "X-Lead-Token": token } })).status === 403)
  let stale = (await act({ type: "dispatch", issue: "ACM-1", agent: "cody", comment: "Cody: implementa este issue.", planItem: 1, planAt: "2000-01-01T00:00:00.000Z" })).json()
  check("no ejecuta un click hecho sobre un plan que ya cambió", stale.ok === false && stale.code === "stale-plan" && stale.state.plan.items[0].status === "pending", JSON.stringify(stale).slice(0, 200))
  stale = (await act({ type: "dispatch", issue: "ACM-3", agent: "cody", comment: "Cody: implementa este issue.", planItem: 1 })).json()
  check("no usa la posición de un item para mandar el pedido de otro issue", stale.ok === false && stale.code === "stale-plan", JSON.stringify(stale).slice(0, 200))

  let res = (await act({ type: "dispatch", issue: "ACM-1", agent: "cody", comment: "haz esto", planItem: 1 })).json()
  check("no publica un comentario que no empieza con el agente", res.ok === false, JSON.stringify(res).slice(0, 200))
  res = (await act({ type: "dispatch", issue: "ACM-1", agent: "cody", comment: "🤖 Cody: haz esto" })).json()
  check("no publica un comentario que empieza con 🤖", res.ok === false)
  res = (await act({ type: "dispatch", issue: "XXX-1", agent: "cody", comment: "Cody: haz esto" })).json()
  check("no actúa sobre un team que no es del tablero", res.ok === false)
  res = (await act({ type: "dispatch", issue: "ACM-20", agent: "cody", comment: "Cody: haz esto" })).json()
  check("no le pide trabajo a un agente en un issue cerrado", res.ok === false && /cerrado/.test(JSON.stringify(res)), JSON.stringify(res).slice(0, 200))

  res = (await act({ type: "dispatch", issue: "ACM-1", agent: "cody", comment: "Cody: implementa este issue.", planItem: 1 })).json()
  check("despacha (simulado) y marca el item del plan", res.ok && res.result.dryRun && res.state.plan.items[0].status === "dispatched", JSON.stringify(res).slice(0, 300))
  check("el pedido que salió queda como tarea en seguimiento", res.state.tasks.some((t) => t.id === "ACM-1" && t.stage === "dispatched"))
  check("el issue que recibe un agente pasa a In Progress", res.result.state === "In Progress" && res.state.snapshot.issues.find((i) => i.id === "ACM-1").state === "In Progress", JSON.stringify(res.result))
  res = (await act({ type: "dispatch", issue: "ACM-1", agent: "cody", comment: "Cody: implementa este issue.", planItem: 1 })).json()
  check("no manda dos veces el mismo pedido del plan", res.ok === false, JSON.stringify(res).slice(0, 200))
  res = (await act({ type: "dispatch", issue: "ACM-1", agent: "cody", comment: "Cody: implementa este issue." })).json()
  check("no manda otro pedido al mismo issue mientras el primero no tuvo respuesta", res.ok === false && /sin respuesta/.test(res.error), JSON.stringify(res).slice(0, 200))

  res = (await act({ type: "decide", planItem: 2, choice: "Sí", comment: "Cody: borra todo." })).json()
  check("una decisión publica el comentario DEL PLAN, no el que manda el navegador", res.ok && res.result.wouldPost === "Cody: construye el límite por IP.", JSON.stringify(res.result))
  res = (await act({ type: "decide", planItem: 1, choice: "Inventada" })).json()
  check("rechaza una opción que no está en el plan", res.ok === false)
  res = (await act({ type: "close", issue: "ACM-3", as: "duplicate" })).json()
  check("el tablero no cierra como duplicado sin decir de cuál", res.ok === false && /dupOf/.test(JSON.stringify(res)), JSON.stringify(res))

  res = (await act({ type: "accept", issue: "BET-1" })).json()
  check("aceptar pasa el issue a Todo, también en el segundo proyecto", res.ok && res.state.snapshot.issues.find((i) => i.id === "BET-1").state === "Todo")
  res = (await act({ type: "closeBatch", ids: ["ACM-2", "ACM-10", "ACM-11"] })).json()
  check("el cierre en lote cierra los tres", res.ok && res.result.done.length === 3 && !res.state.snapshot.issues.some((i) => i.id === "ACM-2"), JSON.stringify(res.result))
  res = (await act({ type: "override", issue: "ACM-3", verdict: "later", note: "ahora no" })).json()
  check("corregir un veredicto queda anotado a nombre del owner", res.ok && res.state.triage.items["ACM-3"].overriddenBy === "owner")
  res = (await act({ type: "alfredSend", rec: "r1" })).json()
  check("enviar a Alfred arma el [Retro] con label y evidencia", res.ok && /^\[Retro\] Qualy: /.test(res.result.wouldCreate.title) && /ACM-2/.test(res.result.wouldCreate.description))

  const real = JSON.parse(readFileSync(join(STATE, "plan.json"), "utf8"))
  check("la simulación no tocó el estado de origen", real.items[0].status === "pending" && real.closeBatch.every((c) => c.status === "pending"))

  // --replace: lo que usa la rutina de la mañana para dejar siempre el tablero del día.
  const before = (await http("GET", "/api/ping")).json()
  check("ping identifica al tablero sin exponer datos", before.app === "project-lead" && before.pid === server.pid && !("snapshot" in before))
  second = spawn(process.execPath, [join(HERE, "..", "app", "server.mjs"), "--dry-run", `--port=${PORT}`, "--replace"], { env, stdio: ["ignore", "pipe", "pipe"] })
  await new Promise((resolve, reject) => {
    second.stdout.on("data", (d) => /tablero en/.test(String(d)) && resolve())
    setTimeout(() => reject(new Error("el reemplazo no arrancó en 12 s")), 12000)
  })
  const after = (await http("GET", "/api/ping")).json()
  check("--replace cierra el tablero anterior y toma su puerto", after.pid === second.pid && after.pid !== before.pid, JSON.stringify(after))
} catch (err) {
  check("el tablero respondió a las pruebas", false, err.message)
} finally {
  server.kill()
  second?.kill()
  rmSync(STATE, { recursive: true, force: true })
  rmSync(CONFIG_DIR, { recursive: true, force: true })
}

console.log(failed ? `\n${failed} prueba(s) fallaron` : "\nTodo en orden")
process.exit(failed ? 1 : 0)
