#!/usr/bin/env node
/**
 * act.mjs — lo que el lead ejecuta en Linear, por su cuenta o con un sí del owner.
 *
 *   close --lane=auto [--dry-run]                    cierra lo de bajo riesgo del lote del plan de hoy
 *   close --ids=A,B --approved="sí, ciérralas"      cierra lo que el owner aprobó por chat
 *   reopen --ids=A,B --actor=owner|lead              deshace un cierre: el issue vuelve al estado que tenía
 *   start --ids=A,B --actor=owner|lead               pasa a In Progress lo que un agente ya tiene
 *   fuse --file=<json> --approved="fúndelas"         funde varios issues en uno (el que queda suma lo que piden los otros)
 *   retro --recs=all|a,b --approved="mándalas"       crea el [Retro] de cada recomendación para Alfred que el owner aprobó
 *
 * `--approved` lleva la frase del owner tal cual la dijo (en tuteo, en voseo o como sea):
 * no se interpreta, se anota en el registro como prueba de su sí.
 *
 * `close` solo cambia el ESTADO de issues que ya están en el lote del plan. Lo
 * demás va por el conector de Linear: los pedidos a agentes (un comentario), un
 * duplicado suelto (necesita la relación «duplicado de») y la prioridad.
 *
 * Qué entra en la vía «auto» sale de lead.config.json → autonomy. El plan guarda
 * la vía de cada cierre cuando se instala (laneOf, en model.mjs), pero aquí se
 * vuelve a calcular: si el owner apagó un permiso después, el plan viejo no manda.
 */

import { AGENTS, daysBetween, dropUnneededSecrets, ensureEnv, linear, loadConfig, localDate, readJson, readJsonl, statePath, writeJson } from "./lib.mjs"
import { alfredTeamOf, laneOf, retroIssue, retroTrigger } from "./model.mjs"
import { logDecision, reflectClose, reflectMove, reflectReopen } from "./state.mjs"
import { openTasks } from "./tasks.mjs"

const die = (msg) => {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

// Un flag mal escrito no puede pasar por alto: «--dryrun» ignorado sería un cierre de verdad.
const KNOWN = new Set(["lane", "ids", "approved", "dry-run", "actor", "file", "recs"])
const argv = process.argv.slice(2)
const cmd = argv[0]
const flags = {}
for (const a of argv.slice(1)) {
  const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a)
  if (!m || !KNOWN.has(m[1])) die(`No conozco «${a}». Flags: ${[...KNOWN].map((k) => "--" + k).join(", ")}`)
  flags[m[1]] = m[2] ?? true
}
if ("dry-run" in flags && flags["dry-run"] !== true && flags["dry-run"] !== "true") die("--dry-run no lleva valor")
const DRY = "dry-run" in flags

const COMMANDS = { close, reopen, start, fuse, retro }
if (!(cmd in COMMANDS)) {
  console.log('Uso: node lead/scripts/act.mjs close --lane=auto [--dry-run] | close --ids=A,B --approved="<su frase>" | reopen --ids=A,B --actor=owner|lead | start --ids=A,B --actor=owner|lead | fuse --file=<json> --approved="<su frase>" | retro --recs=all|<id>,<id> --approved="<su frase>"')
  process.exit(cmd ? 1 : 0)
}
if (!DRY) {
  ensureEnv(["LINEAR_API_KEY"], import.meta.url)
  dropUnneededSecrets(["LINEAR_API_KEY"])
}

const cfg = loadConfig()
const snap = readJson(statePath("snapshot.json")) ?? die("No hay snapshot. Corre: node lead/scripts/sync.mjs")
const byId = new Map(snap.issues.map((i) => [i.id, i]))
const STATE_NAME = { done: "Done", canceled: "Canceled", duplicate: "Duplicate" }
const WORD = { done: "hecho", canceled: "cancelado" }
const CLOSED_TYPES = ["completed", "canceled", "duplicate"]
const idsFlag = () =>
  String(flags.ids ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)

async function stateFor(team, name) {
  const cached = snap.states?.[team]?.[name]
  if (cached?.id) return { name, ...cached }
  const d = await linear(
    "query($team: String!, $name: String!) { workflowStates(filter: { team: { key: { eq: $team } }, name: { eqIgnoreCase: $name } }) { nodes { id name type } } }",
    { team, name },
  )
  return d.workflowStates.nodes[0] ?? null
}

const LIVE = "query($id: String!) { issue(id: $id) { state { name type } updatedAt } }"
const UPDATE = "mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { identifier state { name type } } } }"
const pause = (ms) => new Promise((r) => setTimeout(r, ms))

// ----------------------------------------------------------------- close

async function close() {
  const plan = readJson(statePath("plan.json")) ?? die("No hay plan instalado: los cierres salen del lote del plan.")
  const pending = (plan.closeBatch ?? []).filter((c) => c.status === "pending")
  const auto = flags.lane === "auto" && !flags.ids
  let wanted
  let who
  if (flags.ids) {
    if (typeof flags.approved !== "string" || !flags.approved.trim()) die('--ids necesita --approved="<lo que dijo el owner>". Sin su sí, solo sale lo de la vía auto.')
    const ids = idsFlag()
    wanted = pending.filter((c) => ids.includes(c.id))
    const missing = ids.filter((id) => !wanted.some((c) => c.id === id))
    if (missing.length) die(`No están pendientes en el lote del plan: ${missing.join(", ")}`)
    who = { actor: "owner", via: "chat" }
  } else if (auto) {
    // Por su cuenta, solo sobre el plan de hoy y con datos frescos.
    if (plan.date !== localDate()) die(`El plan instalado es del ${plan.date}. Por mi cuenta solo cierro lo del plan de hoy: ármalo de nuevo.`)
    const ageMin = daysBetween(snap.generatedAt) * 1440
    if (ageMin > 60) die(`El snapshot tiene ${Math.round(ageMin)} min. Corre el sync antes: no cierro sobre datos viejos.`)
    wanted = pending.filter((c) => c.lane === "auto")
    who = { actor: "lead", via: "auto" }
  } else die('Uso: act.mjs close --lane=auto | close --ids=A,B --approved="<su frase>"')

  const skipped = []
  const todo = []
  for (const c of wanted) {
    const issue = byId.get(c.id)
    if (c.as === "duplicate") skipped.push([c.id, `duplicado de ${c.dupOf}: va por el conector (save_issue con duplicateOf) y después «lead log ${c.id} close-duplicate --actor=…»`])
    else if (!STATE_NAME[c.as]) skipped.push([c.id, `cierre «${c.as}» desconocido`])
    else if (!issue) skipped.push([c.id, "no está en el snapshot"])
    else if (!issue.open) skipped.push([c.id, `ya está cerrado (${issue.state})`])
    else if (!cfg.projects.some((p) => p.teamKey === issue.team)) skipped.push([c.id, `${issue.team} no es un team del lead`])
    // La vía se recalcula con el autonomy de AHORA: lo guardado en el plan no alcanza.
    else if (auto && laneOf(c, issue, cfg.autonomy) !== "auto") skipped.push([c.id, "con el autonomy de hoy ya no es de bajo riesgo: espera el sí del owner"])
    else if (auto && !["backlog", "unstarted", "triage"].includes(issue.stateType)) skipped.push([c.id, `está en «${issue.state}»: alguien lo movió a mano y se respeta`])
    // Dos cosas que el lead no cierra solo aunque el plan lo diga: la cola de Alfred
    // (solo barre lo abierto) y una alerta fresca (el health check la busca abierta).
    else if (auto && issue.labels?.includes("alfred")) skipped.push([c.id, "está en la cola de Alfred"])
    else if (auto && issue.kind === "alert" && issue.ageDays < 1) skipped.push([c.id, "es una alerta de menos de 24 h"])
    else todo.push({ c, issue })
  }

  console.log(`# Cierres ${auto ? "de bajo riesgo (por cuenta del lead)" : "aprobados por el owner"}${DRY ? " — simulación" : ""}`)
  if (DRY) {
    const tally = {}
    for (const { c, issue } of todo) tally[`${issue.team} · ${issue.class} · ${WORD[c.as]}`] = (tally[`${issue.team} · ${issue.class} · ${WORD[c.as]}`] ?? 0) + 1
    for (const [k, n] of Object.entries(tally)) console.log(`  ${String(n).padStart(3)} · ${k}`)
    for (const { c, issue } of todo.filter((t) => t.issue.class !== "record")) console.log(`  ${c.id} → ${WORD[c.as]} · ${issue.title.slice(0, 70)} — ${c.why}`)
    for (const [id, why] of skipped) console.log(`  saltado ${id}: ${why}`)
    console.log(`\nCerraría ${todo.length}; saltaría ${skipped.length}. Nada salió hacia Linear (tampoco se consultó el estado en vivo).`)
    return
  }

  const done = { done: [], canceled: [] }
  const unsaved = { done: [], canceled: [] }
  const failed = []
  // Se anota de a tandas: si esto se corta a la mitad, lo ya cerrado no se vuelve a intentar.
  const flush = () => {
    for (const as of Object.keys(unsaved)) if (unsaved[as].length) reflectClose(unsaved[as].splice(0), as)
  }
  try {
    for (const { c, issue } of todo) {
      try {
        // El snapshot puede tener una hora: antes de cerrar, cómo está AHORA en Linear.
        const live = (await linear(LIVE, { id: issue.uuid })).issue
        if (!live) throw new Error("ya no existe en Linear")
        if (CLOSED_TYPES.includes(live.state.type)) {
          skipped.push([c.id, `ya está cerrado en Linear (${live.state.name})`])
          continue
        }
        if (live.state.name !== issue.state) {
          skipped.push([c.id, `en Linear está en «${live.state.name}» y el snapshot decía «${issue.state}»: alguien lo movió`])
          continue
        }
        if (auto && live.updatedAt > issue.updatedAt) {
          skipped.push([c.id, "cambió en Linear después del último sync: lo miro de nuevo antes de cerrarlo"])
          continue
        }
        const target = await stateFor(issue.team, STATE_NAME[c.as])
        if (!target) throw new Error(`el team ${issue.team} no tiene un estado «${STATE_NAME[c.as]}»`)
        const d = await linear(UPDATE, { id: issue.uuid, input: { stateId: target.id } })
        const now = d.issueUpdate?.issue?.state
        // Lo que cuenta es lo que Linear dice que quedó, no que la llamada no haya fallado.
        if (!d.issueUpdate?.success || now?.name !== STATE_NAME[c.as]) throw new Error(`Linear lo dejó en «${now?.name ?? "?"}»`)
        done[c.as].push(c.id)
        unsaved[c.as].push(c.id)
        logDecision({ ...who, action: `close-${c.as}`, issue: c.id, detail: { from: issue.state, why: c.why, batch: true, ...(flags.approved ? { approved: String(flags.approved) } : {}) } })
        if (unsaved.done.length + unsaved.canceled.length >= 10) flush()
      } catch (err) {
        failed.push([c.id, err.message])
        if (/authentication|not authenticated|unauthori[sz]ed/i.test(err.message)) break
      }
      await pause(120)
    }
  } finally {
    flush()
  }

  const total = done.done.length + done.canceled.length
  console.log(`✓ ${total} cerrados (${done.done.length} como hecho, ${done.canceled.length} como cancelado) · ${skipped.length} saltados · ${failed.length} fallaron`)
  for (const [id, why] of skipped) console.log(`  saltado ${id}: ${why}`)
  for (const [id, why] of failed) console.log(`  FALLÓ ${id}: ${why}`)
  if (failed.length) process.exit(1)
}

// ------------------------------------------------------------------ fuse

const LIVE_FULL = "query($id: String!) { issue(id: $id) { description state { name type } } }"
const RELATE = "mutation($input: IssueRelationCreateInput!) { issueRelationCreate(input: $input) { success } }"

/**
 * Funde varios issues en uno: el que queda suma en su descripción una línea por
 * cada issue absorbido, y los absorbidos se marcan como duplicados de ese.
 * Siempre con el sí del owner, porque cambia el alcance de un issue.
 *
 * El archivo: [{ keep: "ACM-769", heading?: "Incluye también", includes: [{ id: "ACM-392", text: "qué pide, en una línea" }] }]
 */
async function fuse() {
  if (typeof flags.approved !== "string" || !flags.approved.trim()) die('fuse necesita --approved="<lo que dijo el owner>": fundir cambia el alcance de un issue.')
  const groups = typeof flags.file === "string" ? readJson(flags.file) : null
  if (!Array.isArray(groups) || !groups.length) die('Uso: act.mjs fuse --file=<json> --approved="<su frase>". El archivo: [{ keep, heading?, includes: [{ id, text }] }]')

  // Primero se valida todo: una fusión a medias es peor que ninguna.
  const errors = []
  const seen = new Set()
  for (const g of groups) {
    const keep = byId.get(String(g.keep ?? "").toUpperCase())
    if (!keep) {
      errors.push(`${g.keep}: no está en el snapshot`)
      continue
    }
    if (!keep.open) errors.push(`${keep.id}: el que queda está cerrado (${keep.state})`)
    if (!Array.isArray(g.includes) || !g.includes.length) errors.push(`${keep.id}: falta «includes»`)
    for (const inc of g.includes ?? []) {
      const id = String(inc?.id ?? "").toUpperCase()
      const issue = byId.get(id)
      if (!issue) errors.push(`${id || "(sin id)"}: no está en el snapshot`)
      else if (issue.team !== keep.team) errors.push(`${id}: es de otro team que ${keep.id}`)
      else if (id === keep.id) errors.push(`${id}: no se funde consigo mismo`)
      if (!String(inc?.text ?? "").trim()) errors.push(`${id}: falta «text» (qué pide, en una línea)`)
      if (seen.has(id)) errors.push(`${id}: aparece dos veces`)
      seen.add(id)
    }
  }
  if (errors.length) die(`No fundí nada:\n  - ${errors.join("\n  - ")}`)

  console.log(`# Fusiones aprobadas por el owner${DRY ? " — simulación" : ""}`)
  let bad = 0
  for (const g of groups) {
    const keep = byId.get(String(g.keep).toUpperCase())
    const heading = String(g.heading ?? "Incluye también")
    const incs = g.includes.map((x) => ({ issue: byId.get(String(x.id).toUpperCase()), text: String(x.text).trim() })).filter((x) => x.issue.open)
    if (!incs.length) {
      console.log(`  ${keep.id}: lo que iba a absorber ya está cerrado`)
      continue
    }
    if (DRY) {
      console.log(`  ${incs.map((x) => x.issue.id).join(" + ")} → quedaría ${keep.id}`)
      continue
    }
    try {
      const live = (await linear(LIVE_FULL, { id: keep.uuid })).issue
      if (!live) throw new Error("ya no existe en Linear")
      if (CLOSED_TYPES.includes(live.state.type)) throw new Error(`en Linear está cerrado (${live.state.name})`)
      const dup = await stateFor(keep.team, STATE_NAME.duplicate)
      if (!dup) throw new Error(`el team ${keep.team} no tiene un estado «${STATE_NAME.duplicate}»`)

      // El que queda dice qué absorbió antes de que los otros se cierren. No se reescribe lo que ya decía.
      const body = live.description ?? ""
      // Se busca la línea que escribe este comando, no cualquier mención: el texto original
      // puede nombrar al otro issue en negrita («complementa a **X**») sin haberlo absorbido.
      const fresh = incs.filter((x) => !body.includes(`- **${x.issue.id}** — `))
      if (fresh.length) {
        const lines = fresh.map((x) => `- **${x.issue.id}** — ${x.text}`).join("\n")
        const next = body.includes(`## ${heading}`) ? `${body.trimEnd()}\n${lines}\n` : `${body.trimEnd()}\n\n## ${heading}\n\n${lines}\n`
        const d = await linear(UPDATE, { id: keep.uuid, input: { description: next } })
        if (!d.issueUpdate?.success) throw new Error("Linear no guardó la descripción")
      }
      // El que queda es el que se va a pedir: que se vea con qué prioridad.
      if ([1, 2, 3, 4].includes(g.priority)) {
        const d = await linear(UPDATE, { id: keep.uuid, input: { priority: g.priority } })
        if (!d.issueUpdate?.success) throw new Error("Linear no guardó la prioridad")
      }

      const absorbed = []
      for (const x of incs) {
        const now = (await linear(LIVE, { id: x.issue.uuid })).issue
        if (!now || CLOSED_TYPES.includes(now.state.type)) {
          console.log(`  saltado ${x.issue.id}: ya está cerrado en Linear`)
          continue
        }
        const rel = await linear(RELATE, { input: { issueId: x.issue.uuid, relatedIssueId: keep.uuid, type: "duplicate" } })
        if (!rel.issueRelationCreate?.success) throw new Error(`Linear no relacionó ${x.issue.id} con ${keep.id}`)
        const d = await linear(UPDATE, { id: x.issue.uuid, input: { stateId: dup.id } })
        if (!d.issueUpdate?.success || d.issueUpdate.issue?.state?.name !== STATE_NAME.duplicate) throw new Error(`Linear dejó ${x.issue.id} en «${d.issueUpdate?.issue?.state?.name ?? "?"}»`)
        reflectClose([x.issue.id], "duplicate")
        logDecision({ actor: "owner", via: "chat", action: "close-duplicate", issue: x.issue.id, detail: { from: x.issue.state, dupOf: keep.id, fused: true, approved: String(flags.approved) } })
        absorbed.push(x.issue.id)
        await pause(120)
      }
      logDecision({ actor: "owner", via: "chat", action: "fuse", issue: keep.id, detail: { absorbed, approved: String(flags.approved) } })
      console.log(`✓ ${absorbed.join(" + ")} → queda ${keep.id}`)
    } catch (err) {
      console.log(`  FALLÓ ${keep.id}: ${err.message}`)
      bad++
    }
  }
  if (bad) process.exit(1)
}

// ----------------------------------------------------------------- start

/**
 * Pasa a «In Progress» un issue que un agente ya tiene. Si un issue con un agente
 * adentro sigue en Backlog, desde Linear no se ve en qué se está trabajando.
 */
async function start() {
  const ids = idsFlag()
  if (!ids.length) die("Uso: act.mjs start --ids=A,B --actor=owner|lead")
  if (!["owner", "lead"].includes(flags.actor)) die("Falta --actor=owner (lo pidió el owner) o --actor=lead (es una tarea que el owner ya aprobó): queda en el registro.")
  const flying = new Set(openTasks().map((t) => t.id))
  let bad = 0
  for (const id of ids) {
    const issue = byId.get(id)
    if (!issue) {
      console.log(`  ${id}: no está en el snapshot`)
      bad++
      continue
    }
    // Por su cuenta, el lead solo mueve lo que el owner ya aprobó como tarea.
    if (flags.actor === "lead" && !flying.has(id)) {
      console.log(`  ${id}: no es una tarea en marcha; por mi cuenta solo muevo esas`)
      bad++
      continue
    }
    if (DRY) {
      console.log(`  ${id} pasaría a «In Progress»`)
      continue
    }
    try {
      const live = (await linear(LIVE, { id: issue.uuid })).issue
      if (!live) throw new Error("ya no existe en Linear")
      if (CLOSED_TYPES.includes(live.state.type)) throw new Error(`está cerrado en Linear (${live.state.name})`)
      if (live.state.type === "started") {
        reflectMove(id, live.state.name, "started")
        console.log(`  ${id}: ya está en «${live.state.name}»`)
        continue
      }
      const target = await stateFor(issue.team, "In Progress")
      if (!target) throw new Error(`el team ${issue.team} no tiene un estado «In Progress»`)
      const d = await linear(UPDATE, { id: issue.uuid, input: { stateId: target.id } })
      if (!d.issueUpdate?.success || d.issueUpdate.issue?.state?.name !== "In Progress") throw new Error("Linear no lo movió")
      reflectMove(id, "In Progress", "started")
      logDecision({ actor: flags.actor, via: flags.actor === "lead" ? "follow" : "chat", action: "start", issue: id, detail: { from: live.state.name } })
      console.log(`✓ ${id} pasó a «In Progress»`)
    } catch (err) {
      console.log(`  FALLÓ ${id}: ${err.message}`)
      bad++
    }
    await pause(120)
  }
  if (bad) process.exit(1)
}

// ---------------------------------------------------------------- reopen

async function reopen() {
  const ids = idsFlag()
  if (!ids.length) die("Uso: act.mjs reopen --ids=A,B --actor=owner|lead")
  if (!["owner", "lead"].includes(flags.actor)) die("Falta --actor=owner (lo pidió el owner) o --actor=lead (corriges un cierre tuyo): queda en el registro.")
  const log = readJsonl(statePath("decisions.jsonl"))
  let bad = 0
  for (const id of ids) {
    const issue = byId.get(id)
    if (!issue) {
      console.log(`  ${id}: no está en el snapshot`)
      bad++
      continue
    }
    const last = log.filter((d) => d.issue === id && /^close-/.test(d.action)).at(-1)
    const back = last?.detail?.from ?? "Backlog"
    if (DRY) {
      console.log(`  ${id} volvería a «${back}»`)
      continue
    }
    try {
      // Reabrir es para algo cerrado: un issue abierto no se manda de vuelta a Backlog.
      const live = (await linear(LIVE, { id: issue.uuid })).issue
      if (!live) throw new Error("ya no existe en Linear")
      if (!CLOSED_TYPES.includes(live.state.type)) throw new Error(`no está cerrado: en Linear está en «${live.state.name}»`)
      const target = await stateFor(issue.team, back)
      if (!target) throw new Error(`el team ${issue.team} no tiene un estado «${back}»`)
      const d = await linear(UPDATE, { id: issue.uuid, input: { stateId: target.id } })
      if (!d.issueUpdate?.success || d.issueUpdate.issue?.state?.name !== back) throw new Error("Linear no lo reabrió")
      reflectReopen(id, back, target.type)
      logDecision({ actor: flags.actor, via: "chat", action: "reopen", issue: id, detail: { to: back } })
      console.log(`✓ ${id} volvió a «${back}»`)
    } catch (err) {
      console.log(`  FALLÓ ${id}: ${err.message}`)
      bad++
    }
    await pause(120)
  }
  if (bad) process.exit(1)
}

// ----------------------------------------------------------------- retro

const RETRO_META = 'query($team: String!) { teams(filter: { key: { eq: $team } }) { nodes { id } } issueLabels(filter: { name: { eqIgnoreCase: "alfred" } }) { nodes { id team { key } } } }'
const CREATE = "mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier url } } }"
const COMMENT = "mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success } }"

/**
 * Manda a Alfred las recomendaciones que el owner aprobó por chat: un issue
 * `[Retro]` con label `alfred` por cada una, en el team que barre Alfred
 * (lead.config.json → alfred.teamKey), ya en In Progress, y UN comentario
 * «Alfred: …» que lo dispara. Sin ese comentario no arranca nadie: un [Retro]
 * creado en Backlog y sin comentario se queda esperando un barrido. Siempre con
 * su sí: cada una termina en un PR que el owner revisa.
 */
async function retro() {
  if (typeof flags.approved !== "string" || !flags.approved.trim()) die('retro necesita --approved="<lo que dijo el owner>": cada recomendación termina en un PR que el owner tiene que revisar.')
  const want = String(flags.recs ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  if (!want.length) die('Uso: act.mjs retro --recs=all|<id>,<id> --approved="<su frase>" [--dry-run]')
  const path = statePath("alfred.json")
  const store = readJson(path) ?? { items: [] }
  // Dos casos: borradores (hay que crear el issue) y enviadas a las que les faltó el comentario
  // que dispara a Alfred. Estas no se vuelven a crear: solo se reintenta el comentario.
  const untriggered = (r) => r.status === "sent" && r.triggerPending && r.linearIssueId
  const all = want.includes("all") ? store.items.filter((r) => r.status === "draft" || untriggered(r)) : want.map((id) => store.items.find((r) => r.id === id) ?? die(`No hay una recomendación «${id}»`))
  const bad = all.filter((r) => r.status !== "draft" && !untriggered(r))
  if (bad.length) die(`Ya enviada, enviándose o descartada: ${bad.map((r) => r.id).join(", ")}`)
  const picked = all.filter((r) => r.status === "draft")
  const pending = all.filter(untriggered)
  const nameOf = (r) => (r.agent === "todos" ? "Equipo" : (AGENTS[r.agent]?.name ?? r.agent))
  const patch = (ids, fn) => {
    // Se vuelve a leer antes de escribir: el tablero puede haber tocado el archivo mientras tanto.
    const fresh = readJson(path) ?? store
    for (const item of fresh.items) if (ids.includes(item.id)) fn(item)
    writeJson(path, fresh)
  }

  console.log(`# Recomendaciones para Alfred${DRY ? " — simulación" : ""}`)
  if (!all.length) return console.log("No hay ninguna en borrador.")
  if (DRY) {
    for (const r of picked) console.log(`  crearía «${retroIssue(r, nameOf(r)).title}»`)
    for (const r of pending) console.log(`  dispararía a Alfred por ${r.linearIssue}, que ya existe`)
    return
  }

  const team = alfredTeamOf(cfg) ?? die("No sé en qué team crear el [Retro]: falta lead.config.json → alfred.teamKey (o algún proyecto)")
  const meta = await linear(RETRO_META, { team })
  const teamId = meta.teams.nodes[0]?.id ?? die(`No encontré el team ${team} en Linear`)
  const label = meta.issueLabels.nodes.find((l) => !l.team || l.team.key === team) ?? die(`No existe el label «alfred» en ${team}: sin él, el barrido diario de Alfred no ve el issue`)
  // Lo que se le manda a un agente se ve In Progress desde que sale, nunca en Backlog.
  const started = (await stateFor(team, "In Progress")) ?? die(`El team ${team} no tiene un estado «In Progress»`)

  let sent = 0
  let failed = 0
  const created = []
  for (const r of picked) {
    try {
      const { title, description } = retroIssue(r, nameOf(r), "la charla")
      const d = await linear(CREATE, { input: { teamId, title, description, labelIds: [label.id], stateId: started.id } })
      if (!d.issueCreate?.success) throw new Error("Linear no creó el issue")
      const issue = d.issueCreate.issue
      // Nace con el disparo pendiente y se le saca cuando el comentario sale: si el proceso se
      // corta en el medio, volver a correrlo dispara a Alfred sin crear otro [Retro].
      patch([r.id], (item) => Object.assign(item, { status: "sent", linearIssue: issue.identifier ?? null, linearIssueId: issue.id ?? null, sentAt: new Date().toISOString(), triggerPending: true }))
      logDecision({ actor: "owner", via: "chat", action: "alfred-send", issue: issue.identifier ?? null, detail: { rec: r.id, title: r.title, approved: String(flags.approved) } })
      console.log(`  ✓ ${issue.identifier} — ${title}\n    ${issue.url}`)
      created.push({ rec: r.id, id: issue.id, identifier: issue.identifier })
      sent++
    } catch (err) {
      console.log(`  ✗ ${r.id}: ${err.message}`)
      failed++
    }
    await pause(200)
  }
  const toTrigger = [...pending.map((r) => ({ rec: r.id, id: r.linearIssueId, identifier: r.linearIssue })), ...created]
  if (toTrigger.length) {
    try {
      const d = await linear(COMMENT, { input: { issueId: toTrigger[0].id, body: retroTrigger(toTrigger.map((i) => i.identifier)) } })
      if (!d.commentCreate?.success) throw new Error("Linear no guardó el comentario")
      patch(toTrigger.map((i) => i.rec), (item) => delete item.triggerPending)
      logDecision({ actor: "owner", via: "chat", action: "alfred-trigger", issue: toTrigger[0].identifier ?? null, detail: { issues: toTrigger.map((i) => i.identifier), approved: String(flags.approved) } })
      console.log(`  ✓ Alfred disparado con un comentario en ${toTrigger[0].identifier}`)
    } catch (err) {
      console.log(`  ✗ Los issues existen pero NO se disparó a Alfred (${err.message}). Vuelve a correr el mismo comando: reintenta el comentario sin crear nada.`)
      failed++
    }
  }
  console.log(`✓ ${sent} enviada(s) · ${failed} fallaron`)
  if (failed) process.exit(1)
}

await COMMANDS[cmd]()
