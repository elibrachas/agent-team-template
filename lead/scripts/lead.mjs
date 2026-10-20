#!/usr/bin/env node
/**
 * lead.mjs — CLI del Project Lead.
 *
 * Lo usa el lead (Claude) para LEER el tablero de forma compacta y para
 * ESCRIBIR sus conclusiones con validación, en vez de editar JSON a mano.
 *
 *   status                      panorama del día (lo primero que se lee cada mañana)
 *   shipped [--team=K] [--days=N] [--grep=texto] [--all]
 *                               lo que ya salió en cada app (PRs mergeados y commits): contra esto se verifica
 *   brief                       la materia prima de la charla con el owner, con los links ya armados:
 *                               seguridad primero, los números de cada proyecto, y después las tareas
 *   inbox  [--team=K] [--class=work|record|flow] [--kind=k] [--all] [--limit=N] [--offset=N]
 *                               lo que falta triar (o cambió desde el último triage)
 *   show   <ID> [<ID>…]         ficha completa de uno o más issues
 *   triage --file=<json>        fusiona veredictos (array) en el ledger
 *   plan   --file=<json>        instala el plan de hoy (archiva el anterior)
 *   records [--archive]         registros: cuáles leer hoy y cuáles archivar
 *   alfred --file=<json>        fusiona recomendaciones para Alfred
 *   mark   <n|ID> <estado>      marca un item del plan resuelto por chat («dispatched» abre la tarea)
 *   follow                      las tareas en marcha: dónde está cada una y qué paso sigue
 *   task   <ID> <etapa>         mueve una tarea (--pr=<url> --note="…"); «done» y «dropped» la cierran
 *   task   <ID> dispatched --agent=<a> --actor=owner [--comment="…"]
 *                               abre una tarea que salió por chat y no estaba en el plan
 *   log    <ID> <acción> [nota] registra algo hecho por chat (--actor=lead si fue por cuenta del lead)
 *   paths                       dónde vive el estado y dónde dejar borradores
 *
 * No toca Linear: solo lee lead/state/snapshot.json y escribe el estado local.
 * Lo que sale hacia Linear va por act.mjs (cierres) o por el conector.
 */

import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import {
  AGENTS,
  TRIGGER_RE,
  BOT_RE,
  daysBetween,
  loadConfig,
  localDate,
  readJson,
  readJsonl,
  statePath,
  stateDir,
  writeJson,
} from "./lib.mjs"
import { CLOSE_AS, PLAN_TYPES, SECURITY_LEVELS, VERDICTS, contentSig, isMetricRecord, isSecurity, laneOf, securityLevel, seriesOf } from "./model.mjs"
import { logDecision, reflectClose } from "./state.mjs"
import { OPEN_STAGES, TASK_STAGES, loadTasks, moveTask, openTasks, startTask, taskSignals } from "./tasks.mjs"

const argv = process.argv.slice(2)
const cmd = argv[0]
const flags = {}
const pos = []
for (const a of argv.slice(1)) {
  const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a)
  if (m) flags[m[1]] = m[2] ?? true
  else pos.push(a)
}

const die = (msg) => {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

const cfg = loadConfig()
const loadSnapshot = () => readJson(statePath("snapshot.json")) ?? die("No hay snapshot todavía. Corre: node lead/scripts/sync.mjs")
const loadTriage = () => readJson(statePath("triage.json"), { version: 1, items: {} })
const loadPlan = () => readJson(statePath("plan.json"), null)
const loadAlfred = () => readJson(statePath("alfred.json"), { version: 1, items: [] })

// ---------------------------------------------------------------------------
// Vocabulario
// ---------------------------------------------------------------------------

const OWNERS = [...Object.keys(AGENTS), "code", "owner"]
const DEFAULT_MINUTES = 5
const OBJECTIVES = Object.keys(cfg.objectives ?? {})

const projectOf = (team) => cfg.projects.find((p) => p.teamKey === team)

/**
 * Puntaje 0-100 para ORDENAR dentro de «hacer». No decide nada por sí solo: es
 * impacto × evidencia ÷ esfuerzo, pesado por cuánto le importa ese objetivo al
 * proyecto y, más suave, por cuánta atención recibe ese proyecto (para que a
 * igual mérito gane el que más pesa). Lo urgente va siempre arriba.
 */
const maxShare = Math.max(...cfg.projects.map((p) => p.attentionShare ?? 0), 0.01)
function scoreOf(v, team) {
  if (v.verdict !== "do" && v.verdict !== "decide") return null
  if (v.urgent) return 100
  const project = projectOf(team)
  const impact = v.impact ?? 2
  const conf = { 1: 0.6, 2: 0.8, 3: 1 }[v.confidence ?? 2]
  const effort = { 1: 1, 2: 2, 3: 3.5 }[v.effort ?? 2]
  const weight = project?.objectiveWeights?.[v.objective] ?? 0.5
  const share = 0.6 + 0.4 * ((project?.attentionShare ?? 0) / maxShare)
  return Math.min(99, Math.round(((impact * conf) / effort / 3) * weight * share * 100))
}

// ---------------------------------------------------------------------------
// ¿Qué necesita triage?
// ---------------------------------------------------------------------------

function triageNeed(issue, entry, today) {
  if (!issue.open) return null
  if (!entry) return "nuevo"
  if (issue.comments?.lastHumanAt && issue.comments.lastHumanAt > entry.triagedAt) return "comentaste después del triage"
  if (issue.comments?.lastBotAt && issue.comments.lastBotAt > entry.triagedAt) return "un agente respondió después del triage"
  if (entry.verdict === "later" && entry.until && entry.until <= today) return "venció el «después»"
  if (entry.stateAtTriage && entry.stateAtTriage !== issue.state) return `cambió de estado (${entry.stateAtTriage} → ${issue.state})`
  // Alguien editó el issue sin comentar: el veredicto se dio sobre otro texto.
  if (entry.sig && entry.sig !== contentSig(issue)) return "cambió el título, el cuerpo o los labels"
  return null
}

const ago = (iso) => {
  if (!iso) return "—"
  const d = daysBetween(iso)
  if (d < 1 / 24) return `${Math.max(1, Math.round(d * 1440))}min`
  if (d < 1) return `${Math.round(d * 24)}h`
  return `${Math.round(d)}d`
}
const cut = (s, n) => {
  const flat = String(s ?? "").replace(/\s+/g, " ").trim()
  return flat.length > n ? flat.slice(0, n - 1) + "…" : flat
}

// ---------------------------------------------------------------------------
// Registros (reportes, planes, ticks): no se trían uno por uno
// ---------------------------------------------------------------------------

/**
 * Un registro no pide una decisión: se lee y, a los `minAgeDays` días, se archiva.
 * Devuelve, por serie, cuál es el más nuevo y cuáles se pueden cerrar.
 *
 * El owner lee los reportes en el Backlog: nacen abiertos y se cierran al cumplir esa
 * edad (limits.recordAutoArchiveDays), también el más nuevo de su serie. La excepción
 * es el `[Plan]` de Capi: el de la semana queda abierto hasta que llega el siguiente,
 * porque ahí van las decisiones que le pide y los comentarios de mitad de semana.
 *
 * El más nuevo de una serie puede estar cerrado, porque el owner lo leyó y lo cerró: hay
 * que leerlo igual, así que la serie se arma con los abiertos y con los que terminaron
 * en Done. Un registro cancelado o duplicado es uno que alguien descartó, y no cuenta.
 *
 * Solo se cierran registros en Backlog: si alguien movió uno a mano, se respeta.
 */
function recordSeries(snap, { minAgeDays = 2 } = {}) {
  const groups = new Map()
  for (const i of snap.issues) {
    if (i.class !== "record") continue
    if (!i.open && i.stateType !== "completed") continue
    const key = `${i.team}|${i.kind}|${seriesOf(i.title)}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(i)
  }
  const series = []
  for (const [key, list] of groups) {
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const [latest, ...older] = list
    const open = list.filter((i) => i.open)
    const keepsLatest = latest.kind === "plan"
    const closable = open.filter((i) => i.stateType === "backlog" && i.ageDays >= minAgeDays && !(keepsLatest && i === latest))
    series.push({ key, team: latest.team, latest, older, open, closable, keepsLatest })
  }
  return series.sort((a, b) => a.key.localeCompare(b.key))
}

function cmdRecords() {
  const snap = loadSnapshot()
  const triage = loadTriage()
  const plan = loadPlan()
  const since = plan?.generatedAt ?? "1970-01-01"
  const minAgeDays = Number(flags["min-age"] ?? cfg.limits?.recordAutoArchiveDays ?? 2)
  const series = recordSeries(snap, { minAgeDays })

  const fresh = series.filter((s) => s.latest.createdAt > since)
  // Una serie que ya no tiene nada abierto ni nada nuevo no hace falta mirarla.
  const shown = series.filter((s) => s.open.length || s.latest.createdAt > since)
  console.log(`# Registros — ${series.filter((s) => s.open.length).length} series con issues abiertos · ${series.reduce((a, s) => a + s.closable.length, 0)} issues archivables`)
  console.log(`\n## Para leer hoy: el último de cada serie con novedad desde el plan anterior (${fresh.length})`)
  for (const s of fresh) console.log(`${s.latest.id} | ${s.latest.source} | ${s.latest.ageDays}d | ${cut(s.latest.title, 150)}${s.latest.open ? "" : " · ya cerrado"}`)
  console.log(`\n## Series (un reporte se archiva a los ${minAgeDays} días; el [Plan] de la semana queda hasta que llega el siguiente)`)
  for (const s of shown) console.log(`${String(s.open.length).padStart(3)} abiertos · ${s.key} · último ${s.latest.id} (${s.latest.ageDays}d${s.latest.open ? "" : ", ya cerrado"}) · archivables ${s.closable.length}`)

  if (flags.archive) {
    // Veredicto «archive» para todos los registros abiertos: no entran a la bandeja de triage.
    const now = new Date().toISOString()
    let n = 0
    for (const s of series)
      for (const i of s.open) {
        if (triage.items[i.id]) continue
        triage.items[i.id] = {
          verdict: "archive",
          why: s.keepsLatest && i === s.latest ? "Plan de la semana: queda abierto hasta que llegue el siguiente." : `Registro: queda abierto para leerlo y se archiva a los ${minAgeDays} días.`,
          triagedAt: now,
          basis: i.updatedAt,
          stateAtTriage: i.state,
          auto: true,
        }
        n++
      }
    triage.updatedAt = now
    writeJson(statePath("triage.json"), triage)
    console.log(`\n✓ ${n} registro(s) marcados como «archivar» en el ledger`)
  }
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

function cmdStatus() {
  const snap = loadSnapshot()
  const triage = loadTriage()
  const plan = loadPlan()
  const today = localDate()
  const open = snap.issues.filter((i) => i.open)
  const out = []

  const ageMin = Math.round(daysBetween(snap.generatedAt) * 1440)
  out.push(`# Estado — ${today} · snapshot de hace ${ageMin < 90 ? ageMin + " min" : ago(snap.generatedAt)} (${snap.source})`)
  if (snap.source !== "linear-api") out.push("> ⚠ Snapshot parcial: sin descripciones, comentarios ni «de quién es la pelota». Falta una LINEAR_API_KEY válida.")
  if (ageMin > 60 * 20) out.push("> ⚠ El snapshot tiene más de 20 h. Corre el sync antes de priorizar.")

  // Primero lo que ya está aprobado: empujarlo vale más que proponer algo nuevo.
  const flying = openTasks()
  out.push(`\n## En marcha: ${flying.length} de ${cfg.limits?.tasksInFlight ?? 3} tareas aprobadas («lead follow» da el detalle y el paso que sigue)`)
  for (const t of flying) out.push(`- ${t.id} · ${AGENTS[t.agent]?.name ?? t.agent} · ${TASK_STAGES[t.stage]} hace ${ago(t.stageAt)} — ${cut(t.title, 80)}`)

  out.push("\n## Por proyecto")
  for (const t of snap.teams) {
    const s = snap.stats.byTeam[t.key]
    const need = open.filter((i) => i.team === t.key && triageNeed(i, triage.items[i.id], today)).length
    const states = Object.entries(s.openByState).map(([k, v]) => `${k} ${v}`).join(" · ")
    const cls = s.openByClass ?? {}
    out.push(
      `- **${t.key}** ${t.name}: ${s.open} abiertos (${states}) — trabajo ${cls.work ?? 0} · registros ${cls.record ?? 0} · flujo ${cls.flow ?? 0}` +
        ` | 7d, sin registros: +${s.created7d} creados, ${s.done7d} hechos, ${s.canceled7d} cancelados · ${s.records7d ?? 0} reportes nuevos | quietos ≥30d: ${s.stale30} | sin triar: ${need}`,
    )
  }

  const prs = (snap.prs?.open ?? []).filter((p) => !p.draft)
  out.push(`\n## PRs abiertos esperando review/merge (${prs.length})`)
  for (const p of prs.sort((a, b) => b.ageDays - a.ageDays))
    out.push(`- ${p.repo}#${p.number} · ${p.ageDays}d · checks ${p.checks} · ${p.author ?? "?"}${p.issue ? " · " + p.issue : ""} — ${cut(p.title, 90)}`)
  if (snap.prs?.errors?.length) out.push(`- (GitHub: ${snap.prs.errors.join(" | ")})`)

  // Solo trabajo vivo: en un reporte, que el último comentario sea de un agente no significa
  // que alguien espere algo (suele ser «te sumo como seguidora» o un seguimiento).
  const waiting = open
    .filter((i) => i.class === "work" && i.ball?.with === "owner" && i.comments?.lastKind === "bot")
    .filter((i) => !["close", "archive"].includes(triage.items[i.id]?.verdict))
    .sort((a, b) => b.ball.since.localeCompare(a.ball.since))
  out.push(`\n## Trabajo donde el último en hablar fue un agente (${waiting.length}) — mira si te preguntó algo`)
  for (const i of waiting.slice(0, 20))
    out.push(`- ${i.id} · ${AGENTS[i.ball.agent]?.name ?? "agente"} hace ${ago(i.ball.since)} · ${i.state} · ${triage.items[i.id]?.verdict ?? "sin triar"} — ${cut(i.title, 70)}\n    ↳ ${cut(i.comments.tail.at(-1)?.text, 180)}`)
  if (waiting.length > 20) out.push(`- … y ${waiting.length - 20} más`)

  const silent = open.filter((i) => i.ball?.with === "agent" && daysBetween(i.ball.since) > 3 / 24)
  out.push(`\n## Disparos sin respuesta > 3 h — probable corrida fallida (${silent.length})`)
  for (const i of silent) out.push(`- ${i.id} · «${AGENTS[i.ball.agent]?.name ?? "?"}:» hace ${ago(i.ball.since)} — ${cut(i.title, 80)}`)

  const wip = open.filter((i) => i.stateType === "started" || i.stateType === "unstarted")
  out.push(`\n## En curso / aceptado (${wip.length})`)
  for (const i of wip) out.push(`- ${i.id} · ${i.state} · quieto ${i.idleDays}d — ${cut(i.title, 90)}`)

  // Triage
  const counts = {}
  for (const i of open) {
    const v = triage.items[i.id]?.verdict ?? "sin-triar"
    counts[v] = (counts[v] ?? 0) + 1
  }
  out.push(`\n## Ledger de triage (issues abiertos)`)
  out.push("- " + Object.entries(counts).map(([k, v]) => `${VERDICTS[k] ?? k}: ${v}`).join(" · "))
  const top = open
    .filter((i) => triage.items[i.id]?.verdict === "do")
    .sort((a, b) => (triage.items[b.id].score ?? 0) - (triage.items[a.id].score ?? 0))
    .slice(0, 12)
  if (top.length) {
    out.push("- Top «hacer» por puntaje:")
    for (const i of top) {
      const v = triage.items[i.id]
      out.push(`  - ${String(v.score).padStart(3)} · ${i.id} · ${v.objective} · ${v.owner} — ${cut(i.title, 80)}`)
    }
  }

  // Plan anterior + decisiones
  if (plan) {
    const done = plan.items.filter((x) => ["done", "dispatched"].includes(x.status)).length
    out.push(`\n## Último plan: ${plan.date} — ${done}/${plan.items.length} resueltos`)
    for (const x of plan.items.filter((x) => !["done", "dispatched"].includes(x.status)))
      out.push(`- pendiente [${x.type}] ${x.id ?? ""} — ${cut(x.title, 80)}${x.status === "skipped" ? " (salteado)" : ""}`)
    const batch = (plan.closeBatch ?? []).filter((c) => c.status === "pending")
    if (batch.length)
      out.push(`- lote de cierre pendiente: ${batch.filter((c) => c.lane === "auto").length} de bajo riesgo (act.mjs close --lane=auto) · ${batch.filter((c) => c.lane !== "auto").length} que esperan su sí`)
    const since = plan.generatedAt
    const decisions = readJsonl(statePath("decisions.jsonl")).filter((d) => d.at > since && !d.dryRun)
    const hers = decisions.filter((d) => d.actor !== "lead")
    const mine = decisions.filter((d) => d.actor === "lead")
    out.push(`\n## Decisiones del owner desde ese plan (${hers.length})`)
    for (const d of hers.slice(-40)) out.push(`- ${d.at.slice(0, 16).replace("T", " ")} · ${d.action} · ${d.issue ?? ""}${d.detail ? " — " + cut(typeof d.detail === "string" ? d.detail : JSON.stringify(d.detail), 110) : ""}`)
    // Lo que va en «Hice» del brief: contado, no listado.
    const tally = {}
    for (const d of mine) tally[d.action] = (tally[d.action] ?? 0) + 1
    out.push(`\n## Hecho por el lead por su cuenta desde ese plan (${mine.length})${mine.length ? ": " + Object.entries(tally).map(([k, n]) => `${k} ${n}`).join(" · ") : ""}`)
  } else {
    out.push("\n## Último plan: ninguno todavía")
  }

  const recs = loadAlfred().items.filter((r) => r.status === "draft")
  out.push(`\n## Recomendaciones para Alfred en borrador: ${recs.length}`)
  for (const r of recs) out.push(`- ${r.id} · ${r.agent} — ${cut(r.title, 90)}`)

  console.log(out.join("\n"))
}

// ---------------------------------------------------------------------------
// inbox
// ---------------------------------------------------------------------------

function cmdInbox() {
  const snap = loadSnapshot()
  const triage = loadTriage()
  const today = localDate()
  let items = snap.issues.filter((i) => i.open)
  if (flags.team) items = items.filter((i) => i.team === String(flags.team).toUpperCase())
  if (flags.kind) items = items.filter((i) => i.kind === flags.kind)
  if (flags.class) items = items.filter((i) => i.class === flags.class)
  if (flags.source) items = items.filter((i) => i.source === flags.source)

  const rows = []
  for (const i of items) {
    const need = triageNeed(i, triage.items[i.id], today)
    if (need || flags.all) rows.push({ i, need })
  }
  // Orden estable: team, clase (trabajo primero), tipo, más nuevo primero.
  const classRank = { work: 0, flow: 1, record: 2 }
  rows.sort(
    (a, b) =>
      a.i.team.localeCompare(b.i.team) ||
      classRank[a.i.class] - classRank[b.i.class] ||
      a.i.kind.localeCompare(b.i.kind) ||
      b.i.createdAt.localeCompare(a.i.createdAt),
  )

  const offset = Number(flags.offset ?? 0)
  const limit = Number(flags.limit ?? 400)
  const page = rows.slice(offset, offset + limit)
  console.log(`# Bandeja — ${rows.length} issue(s)${flags.all ? "" : " por triar"}${rows.length > page.length ? ` · mostrando ${offset + 1}-${offset + page.length}` : ""}`)
  console.log("Formato: ID | tipo | origen | edad/quieto | estado | labels | título")

  let head = ""
  for (const { i, need } of page) {
    const h = `${i.team} · ${i.class} · ${i.kind}`
    if (h !== head) {
      head = h
      console.log(`\n## ${h}`)
    }
    const labels = i.labels.filter((l) => !/^agent-(proposal|report)$/.test(l)).join(",") || "-"
    const prev = triage.items[i.id] ? ` · antes: ${triage.items[i.id].verdict}` : ""
    console.log(`${i.id} | ${i.source} | ${i.ageDays}d/${i.idleDays}d | ${i.state} | ${labels} | ${cut(i.title, 170)}${need && need !== "nuevo" ? `  ⟵ ${need}${prev}` : ""}`)
    if (flags.detail) {
      const gist = i.sections?.propuesta || i.summary
      if (gist) console.log(`    ↳ ${cut(gist, 260)}`)
      const last = i.comments?.tail?.at(-1)
      if (last) console.log(`    💬 ${last.kind}${last.agent ? ":" + last.agent : ""} hace ${ago(last.at)}: ${cut(last.text, 160)}`)
    }
  }
}

// ---------------------------------------------------------------------------
// show
// ---------------------------------------------------------------------------

function cmdShow() {
  if (pos.length === 0) die("Uso: lead show <ID> [<ID>…]")
  const snap = loadSnapshot()
  const triage = loadTriage()
  for (const raw of pos) {
    const id = raw.toUpperCase()
    const i = snap.issues.find((x) => x.id === id)
    if (!i) {
      console.log(`\n## ${id} — no está en el snapshot (¿cerrado hace más de ${snap.window?.closedDays ?? 45} días, u otro team?)`)
      continue
    }
    console.log(`\n## ${i.id} — ${i.title}`)
    console.log(`${i.url}`)
    console.log(`tipo ${i.kind} (${i.class}) · origen ${i.source} · estado ${i.state} · prioridad ${i.priority} · labels ${i.labels.join(", ") || "-"}`)
    console.log(`creado hace ${i.ageDays}d · quieto ${i.idleDays}d${i.project ? " · project " + i.project : ""}${i.parent ? " · parent " + i.parent : ""}`)
    if (i.ball) console.log(`pelota: ${i.ball.with}${i.ball.agent ? " (" + i.ball.agent + ")" : ""} desde hace ${ago(i.ball.since)}`)
    if (i.prUrls?.length) console.log(`PRs: ${i.prUrls.join(" ")}`)
    for (const [k, v] of Object.entries(i.sections ?? {})) console.log(`\n[${k}] ${v}`)
    if (!Object.keys(i.sections ?? {}).length && i.summary) console.log(`\n${i.summary}`)
    for (const c of i.comments?.tail ?? []) console.log(`\n💬 ${c.kind}${c.agent ? ":" + c.agent : ""} · hace ${ago(c.at)}\n   ${c.text}`)
    const v = triage.items[i.id]
    if (v) console.log(`\ntriage: ${JSON.stringify(v)}`)
  }
}

// ---------------------------------------------------------------------------
// triage
// ---------------------------------------------------------------------------

function readInput() {
  if (typeof flags.file !== "string") die("Falta --file=<ruta al JSON>")
  if (!existsSync(flags.file)) die(`No existe ${flags.file}`)
  return readJson(flags.file)
}

function cmdTriage() {
  const input = readInput()
  if (!Array.isArray(input)) die("El archivo de triage debe ser un array de veredictos")
  const snap = loadSnapshot()
  const triage = loadTriage()
  const byId = new Map(snap.issues.map((i) => [i.id, i]))
  const now = new Date().toISOString()
  const errors = []
  const tally = {}

  for (const [n, v] of input.entries()) {
    const where = `#${n + 1} ${v?.id ?? "(sin id)"}`
    if (!v?.id) {
      errors.push(`${where}: falta id`)
      continue
    }
    const id = String(v.id).toUpperCase()
    const issue = byId.get(id)
    if (!issue) {
      errors.push(`${where}: no está en el snapshot`)
      continue
    }
    if (!(v.verdict in VERDICTS)) {
      errors.push(`${where}: verdict inválido «${v.verdict}» (válidos: ${Object.keys(VERDICTS).join(", ")})`)
      continue
    }
    if (!v.why) errors.push(`${where}: falta «why» (una oración: por qué este veredicto)`)
    if (v.verdict === "do") {
      if (!OBJECTIVES.includes(v.objective)) errors.push(`${where}: objective inválido «${v.objective}» (válidos: ${OBJECTIVES.join(", ")})`)
      if (!OWNERS.includes(v.owner)) errors.push(`${where}: owner inválido «${v.owner}» (válidos: ${OWNERS.join(", ")})`)
      for (const k of ["impact", "effort"]) if (![1, 2, 3].includes(v[k])) errors.push(`${where}: ${k} debe ser 1, 2 o 3`)
    }
    if (v.verdict === "close" && !CLOSE_AS.includes(v.closeAs)) errors.push(`${where}: closeAs debe ser ${CLOSE_AS.join(" | ")}`)
    if (v.closeAs === "duplicate" && !v.dupOf) errors.push(`${where}: un duplicado necesita dupOf`)
    if (v.verdict === "decide" && !v.question) errors.push(`${where}: «decide» necesita question (la pregunta concreta para el owner)`)
    if (v.confidence != null && ![1, 2, 3].includes(v.confidence)) errors.push(`${where}: confidence debe ser 1, 2 o 3`)
    // Un veredicto que el owner corrigió no se pisa en silencio.
    const prev = triage.items[id]
    const theirs = prev?.overriddenBy === "owner"
    if (theirs && prev.verdict !== v.verdict && !flags["over-owner"])
      errors.push(`${where}: el owner corrigió este veredicto a «${VERDICTS[prev.verdict]}»${prev.overrideNote ? ` («${prev.overrideNote}»)` : ""}. Si cambió algo que lo justifique, repite con --over-owner y cuéntaselo en el brief`)

    const entry = {
      verdict: v.verdict,
      objective: v.objective ?? null,
      impact: v.impact ?? null,
      effort: v.effort ?? null,
      confidence: v.confidence ?? null,
      urgent: v.urgent === true,
      owner: v.owner ?? null,
      why: v.why ?? "",
      next: v.next ?? null,
      cluster: v.cluster ?? null,
      closeAs: v.closeAs ?? null,
      dupOf: v.dupOf ?? null,
      question: v.question ?? null,
      blockedBy: v.blockedBy ?? null,
      until: v.until ?? null,
      signal: v.signal ?? null,
      triagedAt: now,
      basis: issue.updatedAt,
      stateAtTriage: issue.state,
      sig: contentSig(issue),
      ...(theirs && prev.verdict === v.verdict ? { overriddenBy: "owner", overrideNote: prev.overrideNote ?? null, overriddenFrom: prev.overriddenFrom ?? null } : {}),
    }
    entry.score = scoreOf(entry, issue.team)
    triage.items[id] = entry
    tally[v.verdict] = (tally[v.verdict] ?? 0) + 1
  }

  if (errors.length) {
    console.error(`✗ ${errors.length} problema(s) — no guardé nada:`)
    for (const e of errors) console.error(`  - ${e}`)
    process.exit(1)
  }
  triage.updatedAt = now
  writeJson(statePath("triage.json"), triage)
  console.log(`✓ triage: ${input.length} veredicto(s) guardados — ` + Object.entries(tally).map(([k, v]) => `${VERDICTS[k]}: ${v}`).join(" · "))
}

// ---------------------------------------------------------------------------
// plan
// ---------------------------------------------------------------------------

/**
 * Lo que el triage dejó abierto a propósito: un «hacer», o un «después» cuya fecha no llegó.
 * Sin esto, la rutina puede proponer cancelar con otro motivo un issue que días antes se le
 * dijo al owner que quedaba, y su «sí, ciérralas» lo cancelaría. Para cancelar algo así,
 * primero cambia el veredicto, y con él el motivo.
 */
function keptOpen(entry, today) {
  if (entry?.verdict === "do") return `el triage dice «hacer» («${entry.why}»)`
  if (entry?.verdict === "later" && entry.until && entry.until > today) return `el triage lo dejó para después del ${entry.until} («${entry.why}»)`
  return null
}

function cmdPlan() {
  const input = readInput()
  if (!input || !Array.isArray(input.items)) die("El plan debe ser un objeto con «items»: []")
  const snap = loadSnapshot()
  const byId = new Map(snap.issues.map((i) => [i.id, i]))
  const errors = []
  const flying = new Set(openTasks().map((t) => t.id))
  const ledger = loadTriage().items
  const today = localDate()
  const cancelsKept = (id, as) => (as === "canceled" ? keptOpen(ledger[String(id ?? "").toUpperCase()], today) : null)
  const KEPT_HINT = "Si cambió algo, primero cambia el veredicto con «lead triage» y cuéntale al owner por qué"

  const items = input.items.map((x, n) => {
    const where = `item ${n + 1}`
    const issue = x.id ? byId.get(String(x.id).toUpperCase()) : null
    if (!PLAN_TYPES.includes(x.type)) errors.push(`${where}: type inválido «${x.type}» (válidos: ${PLAN_TYPES.join(", ")})`)
    if (!x.why) errors.push(`${where}: falta «why»`)
    if (x.type === "dispatch") {
      if (!(x.agent in AGENTS)) errors.push(`${where}: agent inválido «${x.agent}»`)
      if (!x.id) errors.push(`${where}: un dispatch necesita el id del issue donde se comenta`)
      // El snapshot trae también lo cerrado en los últimos 45 días, y el listener no mira el
      // estado del issue: un «Cody: …» en uno cerrado arranca trabajo sobre algo que ya se cerró.
      else if (!issue) errors.push(`${where}: ${x.id} no está en el snapshot. No se pide trabajo sobre un issue que no se ve`)
      else if (!issue.open) errors.push(`${where}: ${x.id} está cerrado (${issue.state}). Un pedido ahí arrancaría trabajo sobre algo que ya se cerró`)
      // Lo que ya se pidió no se vuelve a proponer: reinstalar el plan con el mismo pedido
      // adentro dejaría un botón «Enviar a Cody» para una corrida que ya está andando.
      else if (flying.has(String(x.id).toUpperCase())) errors.push(`${where}: ${x.id} ya es una tarea en marcha. No se vuelve a proponer: se sigue con «lead follow»`)
      const body = String(x.comment ?? "")
      if (!TRIGGER_RE.test(body)) errors.push(`${where}: «comment» debe empezar con «<Agente>:» — si no, el listener no dispara`)
      else if (TRIGGER_RE.exec(body)[1].toLowerCase() !== x.agent) errors.push(`${where}: el comentario invoca a otro agente que «agent»`)
      if (BOT_RE.test(body)) errors.push(`${where}: el comentario no puede empezar con 🤖 (el listener lo ignora)`)
      // El 2026-10-07 dos de tres tareas propuestas estaban mal: una ya estaba en main y la otra
      // partía de un dato de dos días atrás que ya no era cierto. Sin verificación propia, no se propone.
      if (!String(x.checked ?? "").trim())
        errors.push(`${where}: falta «checked»: qué verificaste HOY contra la fuente (el código en main, la base, la página en producción) y qué viste. El dato de un reporte de un agente no alcanza`)
    }
    if (x.type === "code" && !x.prompt) errors.push(`${where}: un item «code» necesita «prompt» (lo que se pega en una sesión de Claude Code)`)
    if (x.type === "close") {
      if (!x.id) errors.push(`${where}: un cierre necesita el id del issue`)
      if (!CLOSE_AS.includes(x.closeAs)) errors.push(`${where}: closeAs debe ser ${CLOSE_AS.join(" | ")}`)
      const kept = cancelsKept(x.id, x.closeAs)
      if (kept) errors.push(`${where}: propone cancelar ${x.id}, y ${kept}. ${KEPT_HINT}`)
    }
    if (x.type === "decide") {
      if (!Array.isArray(x.options) || x.options.length < 2) errors.push(`${where}: una decisión necesita al menos 2 «options» ({label, comment?})`)
      for (const o of x.options ?? []) {
        if (!o?.label) errors.push(`${where}: cada opción necesita «label»`)
        if (o?.comment && BOT_RE.test(o.comment)) errors.push(`${where}: el comentario de una opción no puede empezar con 🤖`)
        if (o?.comment && !x.id) errors.push(`${where}: una opción con comentario necesita el id del issue donde se publica`)
        else if (o?.comment && !issue?.open) errors.push(`${where}: la opción «${o.label}» publica un comentario en ${x.id}, que ${issue ? `está cerrado (${issue.state})` : "no está en el snapshot"}`)
      }
      // Una opción que le pide trabajo a un agente es un pedido: lleva la misma verificación.
      if ((x.options ?? []).some((o) => TRIGGER_RE.test(String(o?.comment ?? ""))) && !String(x.checked ?? "").trim())
        errors.push(`${where}: una de las opciones le pide trabajo a un agente, así que falta «checked» (qué verificaste hoy contra la fuente)`)
    }
    if (x.minutes != null && !(Number.isFinite(x.minutes) && x.minutes >= 0)) errors.push(`${where}: «minutes» son los minutos del owner: un número, 0 o más`)
    for (const l of x.links ?? []) if (!/^https:\/\/(linear\.app|github\.com)\//.test(l?.url ?? "")) errors.push(`${where}: link no permitido (solo linear.app y github.com): ${l?.url}`)
    if (!x.title && !issue) errors.push(`${where}: falta title (y el id no está en el snapshot para tomarlo de ahí)`)
    return {
      n: n + 1,
      id: x.id ? String(x.id).toUpperCase() : null,
      team: x.team ?? issue?.team ?? null,
      title: x.title ?? issue.title,
      url: x.url ?? issue?.url ?? null,
      type: x.type,
      agent: x.agent ?? null,
      comment: x.comment ?? null,
      prompt: x.prompt ?? null,
      question: x.question ?? null,
      options: x.options ?? null,
      steps: x.steps ?? null,
      links: x.links ?? null,
      closeAs: x.closeAs ?? null,
      dupOf: x.dupOf ?? null,
      why: x.why,
      checked: x.checked ?? null,
      objective: x.objective ?? null,
      // Sin dato, 5 minutos: lo mismo que muestra el tablero, así las dos cuentas coinciden.
      minutes: x.minutes ?? DEFAULT_MINUTES,
      urgent: x.urgent === true,
      related: x.related ?? [],
      status: "pending",
    }
  })

  // Los topes existen para que el plan se cumpla: se validan, no se sugieren.
  const limits = cfg.limits ?? {}
  const mins = items.reduce((a, x) => a + (Number.isFinite(x.minutes) ? x.minutes : 0), 0)
  if (limits.planItemsMax && items.length > limits.planItemsMax)
    errors.push(`el plan tiene ${items.length} acciones y el tope es ${limits.planItemsMax} (limits.planItemsMax). Lo que no entra queda en la bandeja o en «notes»`)
  if (limits.ownerMinutesPerDay && mins > limits.ownerMinutesPerDay)
    errors.push(`el plan le pide ${mins} minutos al owner y el tope es ${limits.ownerMinutesPerDay} (limits.ownerMinutesPerDay)`)
  const room = Math.max(0, (limits.tasksInFlight ?? 3) - openTasks().length)
  const asks = items.filter((x) => x.type === "dispatch" && !x.urgent).length
  if (asks > room)
    errors.push(`${asks} pedidos a agentes y lugar para ${room}: el tope es ${limits.tasksInFlight ?? 3} tareas en marcha a la vez (limits.tasksInFlight). Lo roto o expuesto entra igual con "urgent": true`)

  // «closeRecords»: el lead no lista los registros viejos a mano; el CLI los expande.
  const closeBatchInput = [...(input.closeBatch ?? [])]
  if (input.closeRecords) {
    const listed = new Set(closeBatchInput.map((c) => String(c.id).toUpperCase()))
    // El piso es el de la config: el owner lee los reportes en el Backlog y quedan abiertos
    // recordAutoArchiveDays días. Un plan puede esperar más, nunca menos.
    const floorDays = Number(cfg.limits?.recordAutoArchiveDays ?? 2)
    const minAgeDays = Math.max(Number(input.closeRecords.minAgeDays ?? floorDays), floorDays)
    for (const s of recordSeries(snap, { minAgeDays }))
      for (const i of s.closable)
        if (!listed.has(i.id)) closeBatchInput.push({ id: i.id, as: "done", why: `Registro ya leído: tiene ${i.ageDays} días y se archivan a los ${minAgeDays}.` })
  }

  const seenIds = new Set()
  for (const [n, c] of closeBatchInput.entries()) {
    const id = String(c.id ?? "").toUpperCase()
    if (!c.id || !CLOSE_AS.includes(c.as)) errors.push(`closeBatch ${n + 1}: necesita id y as (${CLOSE_AS.join(" | ")})`)
    else if (!byId.get(id)?.open) errors.push(`closeBatch ${n + 1}: ${c.id} no está abierto en el snapshot`)
    if (c.as === "duplicate" && !c.dupOf) errors.push(`closeBatch ${n + 1}: un duplicado necesita dupOf`)
    const kept = cancelsKept(id, c.as)
    if (kept) errors.push(`closeBatch ${n + 1}: propone cancelar ${c.id}, y ${kept}. ${KEPT_HINT}`)
    if (c.verified === true && !String(c.why ?? "").trim()) errors.push(`closeBatch ${n + 1}: ${c.id} dice «verified» sin «why». La evidencia va escrita: el PR, la línea en main, quién lo verificó`)
    // El mismo issue dos veces terminaría en el estado del último: una sola intención por issue.
    if (id && seenIds.has(id)) errors.push(`closeBatch ${n + 1}: ${c.id} está dos veces en el lote`)
    seenIds.add(id)
  }

  if (errors.length) {
    console.error(`✗ ${errors.length} problema(s) — no instalé el plan:`)
    for (const e of errors) console.error(`  - ${e}`)
    process.exit(1)
  }

  const date = input.date ?? localDate()
  const prevPath = statePath("plan.json")
  // Reinstalar el plan del mismo día no borra lo que ya pasó: lo que el owner hizo o salteó
  // y lo que ya se cerró sigue marcado. (Los pedidos que salieron son tareas: ya no vienen aquí.)
  const carried = { items: new Map(), batch: new Map() }
  if (existsSync(prevPath)) {
    const prev = readJson(prevPath)
    if (prev?.date) copyFileSync(prevPath, statePath("history", `plan-${prev.date}.json`))
    if (prev?.date === date) {
      const key = (x) => [x.type, x.id ?? "", x.title ?? ""].join("|")
      for (const x of prev.items ?? []) if (x.status !== "pending") carried.items.set(key(x), x)
      for (const c of prev.closeBatch ?? []) if (c.status !== "pending") carried.batch.set(c.id, c.status)
      for (const x of items) {
        const old = carried.items.get(key(x))
        if (old) Object.assign(x, { status: old.status, ...(old.decision ? { decision: old.decision } : {}) })
      }
    }
  }
  const plan = {
    date,
    generatedAt: new Date().toISOString(),
    headline: input.headline ?? "",
    focus: input.focus ?? [],
    items,
    closeBatch: closeBatchInput.map((c) => {
      const issue = byId.get(String(c.id).toUpperCase())
      return {
        id: String(c.id).toUpperCase(),
        as: c.as,
        dupOf: c.dupOf ?? null,
        why: c.why ?? "",
        verified: c.verified === true,
        // La vía queda guardada con el plan: «auto» lo cierra el lead y avisa, «ask» espera al owner.
        lane: laneOf(c, issue, cfg.autonomy),
        title: issue?.title ?? c.title ?? "",
        url: issue?.url ?? null,
        team: issue?.team ?? null,
        status: carried.batch.get(String(c.id).toUpperCase()) ?? "pending",
      }
    }),
    signals: input.signals ?? [],
    notes: input.notes ?? "",
  }
  writeJson(prevPath, plan)
  writeJson(statePath("history", `plan-${date}.json`), plan)
  const auto = plan.closeBatch.filter((c) => c.lane === "auto").length
  console.log(
    `✓ plan ${date}: ${items.length} acción(es)${mins ? ` (~${mins} min tuyos)` : ""} · ${plan.closeBatch.length} para cerrar en lote (${auto} de bajo riesgo, ${plan.closeBatch.length - auto} esperan su sí) · ${plan.signals.length} señal(es)`,
  )
}

// ---------------------------------------------------------------------------
// alfred
// ---------------------------------------------------------------------------

function cmdAlfred() {
  const input = readInput()
  if (!Array.isArray(input)) die("El archivo debe ser un array de recomendaciones")
  const store = loadAlfred()
  const errors = []
  for (const [n, r] of input.entries()) {
    const where = `rec ${n + 1} ${r?.id ?? ""}`
    for (const k of ["id", "agent", "title", "pattern", "proposal"]) if (!r?.[k]) errors.push(`${where}: falta ${k}`)
    if (r?.agent && !(r.agent in AGENTS) && r.agent !== "todos") errors.push(`${where}: agent inválido «${r.agent}»`)
    if (!Array.isArray(r?.evidence) || r.evidence.length === 0) errors.push(`${where}: sin «evidence» (issues concretos) no es una recomendación, es una opinión`)
  }
  if (errors.length) {
    console.error(`✗ ${errors.length} problema(s) — no guardé nada:`)
    for (const e of errors) console.error(`  - ${e}`)
    process.exit(1)
  }
  const now = new Date().toISOString()
  let added = 0
  let updated = 0
  for (const r of input) {
    const i = store.items.findIndex((x) => x.id === r.id)
    const base = i >= 0 ? store.items[i] : { status: "draft", createdAt: now, linearIssue: null }
    // Una recomendación ya enviada o descartada no se pisa: sería reabrir una decisión del owner.
    if (i >= 0 && base.status !== "draft") continue
    const rec = {
      ...base,
      id: r.id,
      agent: r.agent,
      title: r.title,
      pattern: r.pattern,
      evidence: r.evidence,
      artifact: r.artifact ?? null,
      proposal: r.proposal,
      expected: r.expected ?? null,
      scope: r.scope ?? "core",
      updatedAt: now,
    }
    if (i >= 0) {
      store.items[i] = rec
      updated++
    } else {
      store.items.push(rec)
      added++
    }
  }
  store.updatedAt = now
  writeJson(statePath("alfred.json"), store)
  console.log(`✓ alfred: ${added} nueva(s), ${updated} actualizada(s) · ${store.items.filter((x) => x.status === "draft").length} en borrador`)
}

// ---------------------------------------------------------------------------
// log / paths
// ---------------------------------------------------------------------------

function cmdLog() {
  const [issue, action, ...note] = pos
  if (!issue || !action) die("Uso: lead log <ID> <acción> [nota] --actor=owner|lead")
  const id = issue.toUpperCase()
  const actor = requireActor()
  logDecision({ actor, via: flags.via ?? (actor === "lead" ? "auto" : "chat"), action, issue: id, detail: note.join(" ") || null })
  // Un cierre hecho por el conector tiene que verse igual que uno hecho desde el tablero.
  const as = /^close-(done|canceled|duplicate)$/.exec(action)?.[1]
  if (as) reflectClose([id], as)
  console.log(`✓ registrado: ${action} ${id}`)
}

/**
 * Marca un item del plan de hoy cuando la acción se hizo por chat (por ejemplo,
 * el lead publicó el comentario con el MCP de Linear porque el owner dijo «sí»).
 * Deja el plan y el registro igual que si hubiera sido un click en el tablero.
 */
/**
 * El registro dice quién decidió cada cosa, y el brief sale de ahí. Si no se
 * dice, no se asume: anotar a nombre del owner algo que hizo el lead por su
 * cuenta sería peor que no anotarlo.
 */
function requireActor() {
  if (!["owner", "lead"].includes(flags.actor)) die("Falta --actor=owner (lo pidió o lo aprobó el owner) o --actor=lead (lo hiciste por tu cuenta, dentro de lo que autonomy permite).")
  return flags.actor
}

function cmdMark() {
  const [ref, status = "done"] = pos
  if (!ref || !["pending", "done", "dispatched", "skipped"].includes(status)) die("Uso: lead mark <n | ID> <done|dispatched|skipped|pending> --actor=owner|lead [--note=…]")
  const actor = requireActor()
  const plan = loadPlan() ?? die("No hay plan instalado")
  const matches = plan.items.filter((x) => String(x.n) === ref || x.id === ref.toUpperCase())
  if (matches.length === 0) die(`«${ref}» no está en el plan de ${plan.date}`)
  if (matches.length > 1) die(`«${ref}» aparece en ${matches.length} items (${matches.map((x) => x.n).join(", ")}): usa el número`)
  const [item] = matches
  item.status = status
  writeJson(statePath("plan.json"), plan)
  writeJson(statePath("history", `plan-${plan.date}.json`), plan)
  logDecision({
    actor,
    via: "chat",
    action: status === "dispatched" ? "dispatch" : `plan-${status}`,
    issue: item.id,
    detail: { title: item.title, type: item.type, agent: item.agent ?? null, note: typeof flags.note === "string" ? flags.note : null },
  })
  console.log(`✓ plan ${plan.date} · ${item.n}. ${cut(item.title, 70)} → ${status}`)
  // Un pedido que salió es una tarea que hay que seguir hasta que esté hecha.
  if (status === "dispatched" && item.type === "dispatch" && item.id) {
    startTask({ id: item.id, agent: item.agent, comment: item.comment, title: item.title, url: item.url, team: item.team, via: "chat" })
    console.log(`  en seguimiento: ${item.id} («lead follow»)`)
  }
}

// ---------------------------------------------------------------------------
// follow / task — las tareas aprobadas, hasta que estén hechas
// ---------------------------------------------------------------------------

function cmdFollow() {
  const snap = loadSnapshot()
  const flying = openTasks()
  const cap = cfg.limits?.tasksInFlight ?? 3
  console.log(`# En marcha — ${flying.length} de ${cap} tareas · snapshot de hace ${ago(snap.generatedAt)}`)
  if (!flying.length) console.log(`Ninguna tarea en seguimiento. Hay lugar para proponer ${cap}.`)
  for (const t of flying) {
    const s = taskSignals(t, snap)
    console.log(`\n## ${t.id} · ${AGENTS[t.agent]?.name ?? t.agent} · ${TASK_STAGES[t.stage]} hace ${ago(t.stageAt)}`)
    console.log(cut(t.title, 110))
    if (t.url) console.log(t.url)
    console.log(`aprobada hace ${ago(t.approvedAt)} · ${t.dispatches} pedido(s)${s.issue ? ` · issue en ${s.issue.state}` : ""}`)
    for (const p of s.openPrs) console.log(`PR abierto: ${p.url} · checks ${p.checks} · +${p.size?.add ?? "?"}/−${p.size?.del ?? "?"} en ${p.size?.files ?? "?"} archivo(s)${p.draft ? " · borrador" : ""}`)
    for (const p of s.mergedPrs) console.log(`PR mergeado: ${p.url} · hace ${ago(p.mergedAt)}`)
    if (t.pr && !s.openPrs.length && !s.mergedPrs.length) console.log(`PR anotado: ${t.pr}`)
    if (s.last) console.log(`último comentario: ${s.last.kind}${s.last.agent ? ":" + s.last.agent : ""} hace ${ago(s.last.at)} — ${cut(s.last.text, 200)}`)
    for (const n of t.notes.slice(-2)) console.log(`nota de hace ${ago(n.at)}: ${cut(n.text, 160)}`)
    console.log(`→ ${s.hint}`)
  }
  const recent = loadTasks().items.filter((t) => !OPEN_STAGES.includes(t.stage) && t.doneAt && daysBetween(t.doneAt) < 7)
  if (recent.length) {
    console.log(`\n## Cerradas en los últimos 7 días (${recent.length})`)
    for (const t of recent) console.log(`- ${t.id} · ${TASK_STAGES[t.stage]} hace ${ago(t.doneAt)} — ${cut(t.title, 90)}`)
  }
}

function cmdTask() {
  const [ref, stage] = pos
  if (!ref || !stage) die(`Uso: lead task <ID> <${Object.keys(TASK_STAGES).join("|")}> [--pr=<url>] [--note="…"]`)
  const id = ref.toUpperCase()
  const note = typeof flags.note === "string" ? flags.note : null
  // Un pedido que salió por chat y no estaba en el plan: la respuesta a una decisión, o un issue recién creado.
  if (stage === "dispatched" && typeof flags.agent === "string" && !openTasks().some((t) => t.id === id)) {
    if (flags.actor !== "owner") die("Una tarea nueva nace con el sí del owner: repite con --actor=owner.")
    // «local»: la hace una sesión de Claude Code en la máquina del owner, no un agente del server.
    // No hay comentario que dispare ni corrida que pueda fallar, pero se sigue igual hasta producción.
    if (flags.agent !== "local" && !(flags.agent in AGENTS)) die(`Agente inválido «${flags.agent}» (válidos: ${Object.keys(AGENTS).join(", ")}, local)`)
    const issue = loadSnapshot().issues.find((i) => i.id === id) ?? die(`${id} no está en el snapshot: corre el sync antes`)
    if (!issue.open) die(`${id} está cerrado (${issue.state})`)
    const title = typeof flags.title === "string" ? flags.title : issue.title
    startTask({ id, agent: flags.agent, comment: typeof flags.comment === "string" ? flags.comment : "", title, url: issue.url, team: issue.team, via: "chat" })
    logDecision({ actor: "owner", via: "chat", action: "dispatch", issue: id, detail: { agent: flags.agent, title, note } })
    console.log(`✓ ${id} en seguimiento («lead follow»)`)
    return
  }
  try {
    const t = moveTask(id, stage, { pr: typeof flags.pr === "string" ? flags.pr : null, note, waitingOn: typeof flags.waiting === "string" ? flags.waiting : null })
    logDecision({ actor: flags.actor ?? "lead", via: "follow", action: `task-${stage}`, issue: id, detail: { title: t.title, pr: t.pr, note } })
    console.log(`✓ ${id} → ${TASK_STAGES[stage]}`)
  } catch (err) {
    die(err.message)
  }
}

// ---------------------------------------------------------------------------
// shipped / brief — lo que la charla necesita: qué cambió en las apps, y los links
// ---------------------------------------------------------------------------

/** Issues abiertos que un cambio ya mergeado nombra: candidatos a «ya está hecho». */
function openButShipped(snap, items) {
  const byId = new Map(snap.issues.map((i) => [i.id, i]))
  const named = new Map()
  for (const x of items)
    for (const id of x.issues) {
      const issue = byId.get(id)
      if (!issue?.open) continue
      if (!named.has(id)) named.set(id, { issue, changes: [] })
      named.get(id).changes.push(x)
    }
  return [...named.values()]
}

const repoName = (repo) => repo.split("/")[1]
const mdIssue = (id, url) => (url ? `[${id}](${url})` : id)
const mdPr = (url) => {
  const m = /github\.com\/[\w.-]+\/([\w.-]+)\/pull\/(\d+)/.exec(url ?? "")
  return m ? `[${m[1]}#${m[2]}](${url})` : (url ?? "")
}

function cmdShipped() {
  const snap = loadSnapshot()
  const sh = snap.shipped
  if (!sh?.items) die("Este snapshot no trae los cambios de las apps. Corre: node lead/scripts/sync.mjs")
  const team = typeof flags.team === "string" ? flags.team.toUpperCase() : null
  const days = Number(flags.days) || sh.days
  const grep = typeof flags.grep === "string" ? flags.grep.toLowerCase() : null
  const since = Date.now() - days * 86_400_000
  const items = sh.items.filter((x) => (!team || x.team === team) && Date.parse(x.at) >= since && (!grep || x.title.toLowerCase().includes(grep)))

  console.log(`# Lo que salió en las apps — últimos ${days} días${team ? ` · ${team}` : ""} · snapshot de hace ${ago(snap.generatedAt)}`)
  if (sh.errors?.length) console.log(`! GitHub: ${sh.errors.join(" | ")}`)
  if (days > sh.days) console.log(`! El snapshot guarda ${sh.days} días (sync.shippedDays).`)

  const named = openButShipped(snap, items)
  if (named.length) {
    console.log(`\n## Siguen abiertos en Linear y un cambio mergeado los nombra (${named.length}) — mira si ya están hechos`)
    for (const { issue, changes } of named)
      console.log(`- ${issue.id} · ${issue.state} — ${cut(issue.title, 80)}\n    ↳ ${changes.map((c) => `${repoName(c.repo)} ${c.ref} (${c.at.slice(0, 10)}) ${cut(c.title, 70)}`).join("\n    ↳ ")}`)
  }

  const perRepo = Number(flags.limit) || (flags.all ? Infinity : 40)
  const repos = [...new Set(items.map((x) => x.repo))]
  for (const repo of repos) {
    const list = items.filter((x) => x.repo === repo)
    const prs = list.filter((x) => x.kind === "pr").length
    console.log(`\n## ${repo} — ${prs} PRs mergeados · ${list.length - prs} commits directos`)
    for (const x of list.slice(0, perRepo)) console.log(`- ${x.at.slice(0, 10)} · ${x.ref} · ${cut(x.title, 120)}${x.issues.length ? ` · ${x.issues.join(", ")}` : ""}`)
    if (list.length > perRepo) console.log(`  … y ${list.length - perRepo} más (--all, o --grep=<texto> para buscar)`)
  }
  if (!items.length) console.log("\nNada en ese período.")
}

const LEVEL_ORDER = { alta: 0, media: 1, baja: 2, "sin nivel": 3 }
const SOURCE_ORDER = { numa: 0, greta: 1, qualy: 2 }
const bareTitle = (t) => String(t ?? "").replace(/^\s*\[[^\]]+\]\s*/, "").replace(/^(🔴|🟡|🟢|⚪)\s*/u, "")
const agentName = (key) => AGENTS[key]?.name ?? key

/**
 * Seguridad va primero en la charla (pedido del owner): lo abierto de lo más grave a lo
 * menos, lo que se resolvió en la semana, y lo último que Qualy dejó en Linear por proyecto.
 * Nunca se omite: «nada abierto» también es lo que el owner quiere saber.
 */
function securitySection(snap, triage, flyingIds) {
  const L = []
  const days = 7
  const tri = (i) => triage.items[i.id]
  const open = snap.issues
    .filter((i) => i.open && isSecurity(i, tri(i)))
    .sort((a, b) => LEVEL_ORDER[securityLevel(a)] - LEVEL_ORDER[securityLevel(b)] || a.createdAt.localeCompare(b.createdAt))
  const solved = snap.issues
    .filter((i) => i.stateType === "completed" && i.completedAt && daysBetween(i.completedAt) <= days && isSecurity(i, tri(i)))
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
  const levels = Object.keys(LEVEL_ORDER).filter((lvl) => open.some((i) => securityLevel(i) === lvl))
  const breakdown = levels.map((lvl) => `${SECURITY_LEVELS[lvl]} ${lvl} ${open.filter((i) => securityLevel(i) === lvl).length}`).join(" · ")
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`
  L.push(`\n## Seguridad — ${n(open.length, "abierto", "abiertos")}${breakdown ? ` (${breakdown})` : ""} · ${n(solved.length, "resuelto", "resueltos")} en ${days} días`)
  L.push("Va primero en la charla, aunque no haya nada grave.")
  for (const i of open) {
    const t = tri(i)
    const verdict = t ? `${VERDICTS[t.verdict] ?? t.verdict}${t.until ? ` hasta ${t.until}` : ""}` : "sin triar"
    const marks = [i.ageDays < 1 ? "nuevo" : null, flyingIds.has(i.id) ? "en marcha" : null].filter(Boolean)
    L.push(`- ${SECURITY_LEVELS[securityLevel(i)]} ${mdIssue(i.id, i.url)} · ${agentName(i.source)} · ${i.ageDays}d · ${i.state} · ${verdict}${marks.length ? ` · ${marks.join(" · ")}` : ""} — ${cut(bareTitle(i.title), 110)}`)
    if (t?.why) L.push(`  - ${cut(t.why, 240)}`)
  }
  if (solved.length) L.push(`Resueltos en ${days} días: ${solved.map((i) => mdIssue(i.id, i.url)).join(" · ")}`)
  // La revisión de logs de Qualy no deja rastro en Linear cuando sale limpia: solo abre un
  // issue por un hallazgo nuevo o comenta el que ya existe (scripts/run-qualy.ps1 -Job log-review).
  // Lo último que dejó en cada proyecto dice que está corriendo, no que revisó todo.
  // El sync baja los últimos 8 comentarios de cada issue: uno de Qualy más viejo no se ve.
  const lastQualy = snap.teams.map(({ key: team }) => {
    let best = null
    for (const i of snap.issues) {
      if (i.team !== team) continue
      // `source` puede venir del primer agente que comentó; «abrió» es solo el autor del issue.
      if ((i.openedBy ?? i.source) === "qualy" && (!best || i.createdAt > best.at)) best = { at: i.createdAt, issue: i, how: "abrió" }
      // Un snapshot viejo no trae agentLastAt: ahí solo se sabe si Qualy fue la última en comentar.
      const c = i.comments
      const commented = c?.agentLastAt?.qualy ?? (c?.lastAgent === "qualy" ? c.lastBotAt : null)
      if (commented && (!best || commented > best.at)) best = { at: commented, issue: i, how: "comentó" }
    }
    return best ? `${team}: ${best.how} ${mdIssue(best.issue.id, best.issue.url)} el ${localDate(new Date(best.at))}` : `${team}: nada en la ventana del snapshot`
  })
  L.push(`Lo último de Qualy en Linear (una revisión limpia no deja rastro, así que esto no prueba que revisó todo): ${lastQualy.join(" · ")}`)
  return L
}

/**
 * Los números de cada proyecto: el último reporte de cada serie con números (Numa, Greta y los
 * reportes de salud de Qualy) y el anterior, para ver hacia dónde va. Los títulos traen el número
 * principal; cuando no, va el resumen. Es materia prima: lo que se cite «de hoy» se repite
 * contra la base.
 */
function numbersSection(snap, maxAgeDays = 10) {
  const L = []
  L.push(`\n## Números por proyecto — el último reporte de cada serie (${maxAgeDays} días) y el anterior`)
  L.push("Lo que cites como de hoy, repítelo contra la base; si no, di de quién es el número y de qué fecha.")
  const series = recordSeries(snap).filter((s) => isMetricRecord(s.latest) && s.latest.ageDays <= maxAgeDays)
  const fewNumbers = (title) => (String(title).replace(/\d{4}-\d{2}-\d{2}/g, "").match(/\d+/g) ?? []).length < 2
  for (const project of cfg.projects) {
    const team = project.teamKey
    const s = snap.stats?.byTeam?.[team]
    L.push(`### ${project.name} (${team})${project.northStar ? ` — ${cut(project.northStar, 120)}` : ""}`)
    if (s) L.push(`- tablero: ${s.open} abiertos · 7 días: ${s.done7d} hechos, ${s.created7d} nuevos, ${s.canceled7d} cancelados`)
    const mine = series
      .filter((x) => x.team === team)
      .sort((a, b) => (SOURCE_ORDER[a.latest.source] ?? 9) - (SOURCE_ORDER[b.latest.source] ?? 9) || b.latest.createdAt.localeCompare(a.latest.createdAt))
    for (const { latest, older } of mine) {
      // La fecha va entera: «hace 2d» no alcanza para escribir «según Numa, al 17-oct».
      const day = (iso) => localDate(new Date(iso))
      L.push(`- ${mdIssue(latest.id, latest.url)} · ${agentName(latest.source)} · ${day(latest.createdAt)} — ${cut(bareTitle(latest.title), 220)}`)
      if (fewNumbers(latest.title) && latest.summary) L.push(`  - resumen: ${cut(latest.summary.replace(/\*\*/g, ""), 260)}`)
      const prev = older[0]
      if (prev) L.push(`  - antes: ${mdIssue(prev.id, prev.url)} · ${day(prev.createdAt)} — ${cut(bareTitle(prev.title), 160)}`)
    }
    if (!mine.length) L.push(`- Sin reportes con números en los últimos ${maxAgeDays} días.`)
  }
  return L
}

/**
 * Todo lo que va en la charla con el owner, con los links ya armados. No decide
 * nada ni redacta por ti: es la materia prima, para no escribir un link a mano.
 */
function cmdBrief() {
  const snap = loadSnapshot()
  const plan = loadPlan()
  const triage = loadTriage()
  const byId = new Map(snap.issues.map((i) => [i.id, i]))
  const cap = cfg.limits?.tasksInFlight ?? 3
  const flying = openTasks()
  const L = []
  L.push(`# Para la charla — ${localDate()} · snapshot de hace ${ago(snap.generatedAt)}`)
  L.push("Los links salen de aquí: no armes ninguno a mano.")

  L.push(...securitySection(snap, triage, new Set(flying.map((t) => t.id))))
  L.push(...numbersSection(snap))

  L.push(`\n## En marcha (${flying.length} de ${cap})`)
  const taskPrs = new Set()
  for (const t of flying) {
    const s = taskSignals(t, snap)
    const prs = [
      ...s.openPrs.map((p) => `${mdPr(p.url)} · checks ${p.checks} · +${p.size?.add ?? "?"}/−${p.size?.del ?? "?"}`),
      ...s.mergedPrs.map((p) => `${mdPr(p.url)} · mergeado hace ${ago(p.mergedAt)}`),
    ]
    if (!prs.length && t.pr) prs.push(mdPr(t.pr))
    for (const p of [...s.openPrs, ...s.mergedPrs]) taskPrs.add(p.url)
    if (t.pr) taskPrs.add(t.pr)
    L.push(`- ${mdIssue(t.id, t.url)} · ${AGENTS[t.agent]?.name ?? t.agent} · ${TASK_STAGES[t.stage]} hace ${ago(t.stageAt)} — ${cut(t.title, 100)}`)
    for (const p of prs) L.push(`  - PR: ${p}`)
    const note = t.notes.at(-1)
    if (note) L.push(`  - nota: ${cut(note.text, 320)}`)
    L.push(`  - paso: ${s.hint}`)
  }
  if (!flying.length) L.push(`Ninguna. Hay lugar para ${cap}.`)

  const waiting = snap.prs.open.filter((p) => !taskPrs.has(p.url) && !p.draft)
  if (waiting.length) {
    L.push(`\n## PRs abiertos fuera de las tareas (${waiting.length})`)
    for (const p of waiting) L.push(`- ${mdPr(p.url)} · ${p.ageDays}d · checks ${p.checks} · ${p.author} — ${cut(p.title, 100)}`)
  }

  const pending = (plan?.items ?? []).filter((x) => x.status === "pending")
  if (pending.length) {
    L.push(`\n## Del plan de ${plan.date}, sin resolver (${pending.length})`)
    for (const x of pending) {
      L.push(`${x.n}. [${x.type}] ${x.id ? mdIssue(x.id, x.url) + " · " : ""}${x.title}${x.agent ? ` → ${AGENTS[x.agent]?.name ?? x.agent}` : ""}`)
      if (x.why) L.push(`   - por qué: ${cut(x.why, 260)}`)
      if (x.checked) L.push(`   - verificado: ${cut(x.checked, 320)}`)
      if (x.question) L.push(`   - pregunta: ${cut(x.question, 220)}`)
      for (const [k, o] of (x.options ?? []).entries()) L.push(`   - ${String.fromCharCode(65 + k)}) ${cut(o.label ?? o, 160)}`)
    }
  }

  const batch = (plan?.closeBatch ?? []).filter((c) => c.status === "pending")
  if (batch.length) {
    const groups = [
      ["Por tu cuenta (bajo riesgo)", batch.filter((c) => c.lane === "auto")],
      ["Esperan su sí", batch.filter((c) => c.lane !== "auto")],
    ]
    L.push(`\n## Cierres sin hacer (${batch.length})`)
    for (const [label, list] of groups) {
      if (!list.length) continue
      const records = list.filter((c) => byId.get(c.id)?.class === "record")
      const rest = list.filter((c) => byId.get(c.id)?.class !== "record")
      L.push(`### ${label}: ${list.length}`)
      if (records.length) {
        const perTeam = {}
        for (const c of records) perTeam[c.team] = (perTeam[c.team] ?? 0) + 1
        L.push(`- ${records.length} reportes ya leídos (${Object.entries(perTeam).map(([k, n]) => `${k} ${n}`).join(" · ")}); los de menos de ${cfg.limits?.recordAutoArchiveDays ?? 2} días siguen abiertos`)
      }
      for (const c of rest) L.push(`- ${mdIssue(c.id, c.url)} · ${CLOSE_AS[c.as] ?? c.as}${c.dupOf ? ` de ${mdIssue(c.dupOf, byId.get(c.dupOf)?.url)}` : ""} — ${cut(c.title, 70)}\n  - ${cut(c.why, 220)}`)
    }
  }

  const named = openButShipped(snap, snap.shipped?.items ?? [])
  if (named.length) {
    L.push(`\n## Abiertos que un cambio mergeado nombra (${named.length}) — ¿ya están hechos?`)
    for (const { issue, changes } of named)
      L.push(`- ${mdIssue(issue.id, issue.url)} · ${issue.state} — ${cut(issue.title, 80)}\n  - ${changes.map((c) => `[${repoName(c.repo)} ${c.ref}](${c.url}) ${c.at.slice(0, 10)}`).join(" · ")}`)
  }

  // Viejos: trabajo abierto que nadie tocó en mucho tiempo y que no está en ningún lote.
  const staleDays = cfg.limits?.proposalStaleDays ?? 45
  const inBatch = new Set(batch.map((c) => c.id))
  const inFlight = new Set(flying.map((t) => t.id))
  const old = snap.issues
    .filter((i) => i.open && i.class === "work" && i.idleDays >= staleDays && !inBatch.has(i.id) && !inFlight.has(i.id))
    .sort((a, b) => b.idleDays - a.idleDays)
  // Un «después» con fecha es una decisión: hasta ese día no es un viejo sin decidir.
  const today = localDate()
  const waits = (i) => triage.items[i.id]?.verdict === "later" && (triage.items[i.id].until ?? "") > today
  const stale = old.filter((i) => !waits(i))
  if (stale.length) {
    L.push(`\n## Viejos sin decisión: ${stale.length} sin actividad hace ${staleDays} días o más — o se verifican y se hacen, o se cierran`)
    for (const i of stale) L.push(`- ${mdIssue(i.id, i.url)} · ${i.idleDays}d quieto · veredicto ${triage.items[i.id]?.verdict ?? "sin triar"} — ${cut(i.title, 90)}`)
  }
  const keptOnPurpose = old.filter(waits)
  if (keptOnPurpose.length) {
    L.push(`\n## Viejos que quedaron abiertos a propósito (${keptOnPurpose.length}) — no se proponen para cerrar antes de su fecha`)
    for (const i of keptOnPurpose) L.push(`- ${mdIssue(i.id, i.url)} · hasta ${triage.items[i.id].until} — ${cut(triage.items[i.id].why, 160)}`)
  }
  console.log(L.join("\n"))
}

function cmdPaths() {
  mkdirSync(statePath("tmp"), { recursive: true })
  console.log(`estado:   ${stateDir()}`)
  console.log(`borradores (JSON para triage/plan/alfred): ${statePath("tmp")}`)
  console.log("  Si tu sesión corre en un worktree y no te deja escribir ahí, usa el scratchpad de la sesión: --file acepta cualquier ruta.")
  for (const f of ["snapshot.json", "triage.json", "plan.json", "alfred.json", "decisions.jsonl"])
    console.log(`  ${existsSync(statePath(f)) ? "✓" : "·"} ${f}`)
}

const commands = { status: cmdStatus, brief: cmdBrief, shipped: cmdShipped, inbox: cmdInbox, records: cmdRecords, show: cmdShow, triage: cmdTriage, plan: cmdPlan, alfred: cmdAlfred, mark: cmdMark, follow: cmdFollow, task: cmdTask, log: cmdLog, paths: cmdPaths }
if (!(cmd in commands)) {
  console.log("Uso: node lead/scripts/lead.mjs <status|brief|shipped|inbox|records|show|triage|plan|alfred|mark|follow|task|log|paths> [opciones]")
  process.exit(cmd ? 1 : 0)
}
commands[cmd]()
