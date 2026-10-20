/**
 * model.mjs — cómo el lead ENTIENDE un issue de Linear.
 *
 * Clasificación (qué tipo de cosa es, qué agente la generó), vocabulario del
 * triage y estadísticas. Todo determinístico y sin red: lo usan el sync, el CLI
 * y el dashboard, así los tres leen el tablero con el mismo criterio.
 */

import { AGENTS, AGENT_NAMES, daysBetween } from "./lib.mjs"

export const OPEN_TYPES = ["triage", "backlog", "unstarted", "started"]

export const excerpt = (s, n) => {
  const flat = String(s ?? "").replace(/\s+/g, " ").trim()
  return flat.length > n ? flat.slice(0, n - 1) + "…" : flat
}

// ---------------------------------------------------------------------------
// Vocabulario del triage y del plan (una sola definición para CLI y dashboard)
// ---------------------------------------------------------------------------

export const VERDICTS = {
  do: "hacer",
  decide: "decidir (solo el owner)",
  later: "después",
  blocked: "bloqueado",
  close: "cerrar",
  archive: "archivar (registro ya leído)",
}
export const CLOSE_AS = ["canceled", "duplicate", "done"]
export const PLAN_TYPES = ["dispatch", "decide", "review", "code", "close", "you"]

/**
 * Huella del contenido de un issue: título, largo del cuerpo y labels. El triage la guarda
 * para notar cuando alguien editó el issue sin comentar ni cambiarlo de estado. No incluye
 * la prioridad ni la fecha de actualización: esas las mueve el propio lead.
 */
export const contentSig = (issue) => [issue.title ?? "", issue.bodyChars ?? 0, [...(issue.labels ?? [])].sort().join(",")].join("|")

/**
 * Por qué vía sale un cierre del lote: "auto" lo ejecuta el lead y avisa; "ask"
 * espera el sí del owner. Lo que el lead puede hacer solo es CONSTATAR: un
 * registro ya leído, un duplicado con su original, algo que ya está en
 * producción (`verified`, con la evidencia en el `why`). Decidir NO hacer algo
 * (`canceled`) es siempre del owner, prenda lo que prenda en `autonomy`.
 */
export function laneOf(entry, issue, autonomy = {}) {
  if (!issue || entry.lane === "ask" || entry.as === "canceled") return "ask"
  if (entry.as === "duplicate") return entry.dupOf && autonomy.closeObviousDuplicates ? "auto" : "ask"
  if (issue.class === "record") return autonomy.archiveRecords ? "auto" : "ask"
  // «Ya está hecho» sin decir de dónde sale no es evidencia.
  return entry.verified === true && String(entry.why ?? "").trim() && autonomy.closeVerifiedDone ? "auto" : "ask"
}

/**
 * El team donde viven los `[Retro]` para Alfred: el que barre su corrida diaria
 * (`run-alfred.ps1 -Job sweep`). Sale de `lead.config.json → alfred.teamKey`; sin
 * ese dato, el del primer proyecto.
 */
export const alfredTeamOf = (cfg) => cfg.alfred?.teamKey ?? cfg.projects?.[0]?.teamKey ?? null

// ---------------------------------------------------------------------------
// Tipo de issue
// ---------------------------------------------------------------------------

const KIND_ALIAS = {
  propuesta: "proposal",
  reporte: "report",
  alerta: "alert",
  diseño: "design",
}

/** `[Proposal] (AEO) Foo` → "proposal". Sin prefijo → según label, o "task". */
export function kindOf(title, labels = []) {
  const m = /^\s*\[([^\]]+)\]/.exec(title ?? "")
  if (m) {
    const k = m[1].trim().toLowerCase()
    const kind = (KIND_ALIAS[k] ?? k).replace(/\s+/g, "-")
    // Tres avisos llevan prefijo de registro o de flujo pero le piden algo a alguien. No se
    // archivan solos: un «Banco de topics vacío» cerrado se vuelve a crear cada día mientras
    // siga vacío, y un `[Topics] … con preguntas` es una pregunta pendiente para el owner.
    if (kind === "topics" && /con preguntas/i.test(title)) return "topics-question"
    if (kind === "refresh" && /\bREVISAR\b/.test(title)) return "refresh-failed"
    if (kind === "content" && /vac[ií]o|fall[oó]/i.test(title)) return "content-notice"
    return kind
  }
  const lower = labels.map((l) => l.toLowerCase())
  if (lower.includes("bug") || /^\s*bug\b/i.test(title ?? "")) return "bug"
  // Los reportes de verdad siempre llevan prefijo ([Report], [Plan], [Tick]…). Un issue de
  // agente sin prefijo es un hallazgo suelto («Credential stuffing detectado»): pide acción.
  if (lower.includes("agent-report") || lower.includes("agent-proposal")) return "finding"
  return "task"
}

/**
 * Los tipos se agrupan en tres clases, que es lo que de verdad cambia cómo se
 * trata un issue:
 *   - work:   pide una decisión o una acción (propuestas, bugs, hallazgos, tareas).
 *   - record: deja constancia de algo que ya pasó (reportes, planes, ticks). No
 *             se "hace": se lee, se le saca la señal y se cierra.
 *   - flow:   pieza de un pipeline que se cierra sola (contenido agendado).
 */
const RECORD_KINDS = new Set(["report", "plan", "digest", "changelog", "tick", "topics", "resumen", "status"])
const FLOW_KINDS = new Set(["content", "refresh", "post", "publish"])

export function classOf(kind) {
  if (RECORD_KINDS.has(kind)) return "record"
  if (FLOW_KINDS.has(kind)) return "flow"
  return "work"
}

/**
 * Serie de un registro: «[Report] Free→paid oct 2026 — día 5…» y el del día 6
 * son la misma serie. Sirve para quedarse con el último de cada una y archivar
 * el resto sin leerlos uno por uno.
 */
export function seriesOf(title) {
  // El tick de publicación de Leda cambia de título casi en cada corrida: es una sola serie.
  if (/publish[- ]tick|tick\b.*publish/i.test(title ?? "")) return "tick de publicación del blog"
  return String(title ?? "")
    .replace(/\d{4}-\d{2}-\d{2}.*$/, "")
    .replace(/\b(semana|d[ií]a)\b.*$/i, "")
    .replace(/\b(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\.? \d{4}.*$/i, "")
    .replace(/\s[—–-]\s.*$/, "")
    .replace(/[\s:·—–-]+$/, "")
    .trim()
    .toLowerCase()
}

// ---------------------------------------------------------------------------
// Quién lo generó
// ---------------------------------------------------------------------------

const agentKey = (name) => {
  const k = String(name ?? "").toLowerCase()
  return k in AGENTS ? k : null
}

/**
 * Skill → agente, para atribuir issues que solo nombran la skill que los generó.
 * Si sumas una skill o un job nuevo que abre issues, agrégalo aquí.
 */
const SKILL_AGENT = [
  [/product-idea-scan|product-shipped-digest/i, "pico"],
  [/tech-debt-scan/i, "cody"],
  [/funnel-monitor|signup-to-paid|daily-pulse/i, "numa"],
  [/seo-weekly-review|aeo-weekly-review/i, "greta"],
  [/pm-progress-review|pm-weekly-digest/i, "capi"],
  [/content-|blog-publish|topic-scan/i, "leda"],
  [/log-review|prod-smoke|front-review|qualy/i, "qualy"],
]

const AGENT_SIG_RE = new RegExp(`🤖\\s*(${AGENT_NAMES.join("|")})`, "giu")
const AGENT_WORD_RE = new RegExp(`\\b(${AGENT_NAMES.join("|")})\\b`, "i")

/** Firma en el body: «Generado por 🤖 Numa 📊» o la skill que lo creó. */
export function sourceFromBody(body) {
  if (!body) return null
  const sigs = [...body.matchAll(AGENT_SIG_RE)]
  if (sigs.length) return agentKey(sigs.at(-1)[1])

  const gen = /generado por[\s\S]{0,400}/i.exec(body)?.[0] ?? ""
  const named = AGENT_WORD_RE.exec(gen)
  if (named) return agentKey(named[1])
  for (const [re, agent] of SKILL_AGENT) if (re.test(gen)) return agent
  for (const [re, agent] of SKILL_AGENT) if (re.test(body.slice(-600))) return agent
  return null
}

/**
 * Sin body a mano (o sin firma), el título y los labels alcanzan casi siempre:
 * cada cron tiene un formato de título propio. Orden: de lo más específico a lo
 * más genérico; la primera regla que matchea gana. Cuando nada matchea queda
 * «agente» (desconocido): preferimos no atribuir antes que atribuir mal, porque
 * estas cuentas alimentan las recomendaciones para Alfred.
 */
const TITLE_RULES = [
  [/^\[retro\]/i, "alfred-inbox"], // escalación hacia Alfred, la escribe otro agente
  [/^\[(content|refresh|topics|post)\]/i, "leda"],
  [/tick\b.*publish|publish[- ]tick/i, "leda"],
  [/^\[(qa|ops|sec|security|seguridad|log|smoke)[^\]]*\]/i, "qualy"],
  [/log[- ]review|prod[- ]smoke/i, "qualy"],
  [/^\[alert\]\s*health check/i, "sistema"], // scripts/run-health-check.ps1, no es un agente
  [/^\[design\]/i, "daly"],
  [/^\[plan\]|check de avance|digest semanal de agentes/i, "capi"],
  [/qu[eé] se actualiz[oó]|shipped|changelog/i, "pico"],
  [/\((seo|aeo)[^)]*\)/i, "greta"],
  [/^\[alert\]|free\s*→\s*paid|\bfunnel\b|\bpulse\b/i, "numa"],
  // El tech-debt-scan de Cody siempre nombra el archivo o el error de compilación.
  [
    /\btipar\b|\bany\b|tests? (de integraci[oó]n|unitarios)|smoke test|\brefactor|timeout|abortsignal|time budget|tech[- ]debt|deuda t[eé]cnica|\bTS\d{4}\b|\b(lib|app|apps|packages|scripts)\/[\w.\/[\]()-]+|\.tsx?\b|console\.log|tsconfig|N\+1|\bdeps\b|npm audit|error boundary|\bstub\b/i,
    "cody",
  ],
]

export function sourceFromTitle(title, labels = []) {
  const lower = labels.map((l) => l.toLowerCase())
  for (const [re, agent] of TITLE_RULES) if (re.test(title ?? "")) return agent
  if (lower.includes("seo") || lower.includes("aeo")) return "greta"
  if (lower.includes("qa")) return "qualy"
  if (lower.includes("alfred")) return "alfred-inbox"
  if (lower.some((l) => ["agent-proposal", "agent-report", "agent"].includes(l))) return "agente"
  return "human"
}

export function sourceOf({ title, labels, body, firstBotAgent }) {
  return sourceFromBody(body) ?? (firstBotAgent || null) ?? sourceFromTitle(title, labels)
}

// ---------------------------------------------------------------------------
// Seguridad y números: dos secciones fijas de la charla. El owner quiere ver los
// números de cada proyecto y, primero que nada, lo que va reportando Qualy de seguridad.
// ---------------------------------------------------------------------------

const SECURITY_KINDS = new Set(["qa-sec", "security", "seguridad", "sec", "qa-rls", "vuln"])
// Qualy no usa el mismo prefijo en todos los proyectos ([QA] en uno, [QA-sec] en otro), y los
// avisos de abuso llegan como [Alert], [Log] o sin prefijo: en esos tipos decide el título.
// «RLS» va con borde de palabra: «URLs» no es un hallazgo.
const SECURITY_KINDS_BY_TITLE = new Set(["qa", "qa-log", "qa-logs", "log", "alert", "finding", "bug", "task"])
const SECURITY_WORDS =
  /\b(CVE-\d+|GHSA-[\w-]+|RCE|XSS|SQLi|CSRF|SSRF|vulnerab\w*|credential stuffing|brute[- ]force|fuerza bruta|rate[- ]limit\w*|RLS|SECURITY DEFINER|path traversal|open redirect|sanitiz\w*|Content-Security-Policy|CSP|p?npm audit)\b/i

/**
 * ¿Es un hallazgo de seguridad? Lo que reporta Qualy con prefijo de seguridad, lo que el
 * triage del lead marcó con objetivo «security», y los avisos sin ese prefijo cuyo título
 * nombra una vulnerabilidad o un abuso. Solo trabajo: un reporte no pide nada.
 */
export function isSecurity(issue, entry) {
  if (classOf(issue.kind) !== "work") return false
  if (SECURITY_KINDS.has(issue.kind) || entry?.objective === "security") return true
  if ((issue.labels ?? []).some((l) => /secur|seguridad|vuln/i.test(l))) return true
  return SECURITY_KINDS_BY_TITLE.has(issue.kind) && SECURITY_WORDS.test(issue.title ?? "")
}

/**
 * Gravedad, para ordenar. Manda el semáforo que Qualy pone en el título (🔴 / 🟡): es su
 * veredicto sobre el riesgo real, y un «🟡 14 HIGH» en dependencias de build no es alta.
 * Sin semáforo, deciden las palabras del título y la prioridad del issue.
 */
export function securityLevel(issue) {
  const t = issue.title ?? ""
  if (/🔴/u.test(t)) return "alta"
  if (/🟡/u.test(t)) return "media"
  if (/\b(CRITICAL|RCE)\b|cr[ií]tic[ao]/i.test(t) || issue.priority === 1 || issue.priority === 2) return "alta"
  if (issue.priority === 3) return "media"
  if (issue.priority === 4) return "baja"
  return "sin nivel"
}
export const SECURITY_LEVELS = { alta: "🔴", media: "🟡", baja: "⚪", "sin nivel": "⚪" }

/**
 * Registros que traen números del producto: los de Numa (conversión, funnel), los de Greta
 * (SEO, AEO) y los reportes de salud de Qualy. Sus títulos llevan el número principal, así
 * que el último de cada serie es la foto del proyecto. Quedan afuera los ticks, los planes,
 * los changelogs y los log reviews (esos van a seguridad).
 */
export function isMetricRecord(issue) {
  if (classOf(issue.kind) !== "record" || issue.kind === "plan") return false
  if (!["numa", "greta", "qualy"].includes(issue.source)) return false
  return !/tick|log[- ]review|digest semanal|qu[eé] se actualiz/i.test(issue.title ?? "")
}

// ---------------------------------------------------------------------------
// Secciones canónicas del body de un [Proposal] (ver memory/CLAUDE.md)
// ---------------------------------------------------------------------------

export function sectionsOf(body) {
  if (!body) return {}
  const out = {}
  const heads = [...body.matchAll(/^#{1,3}\s+(.+?)\s*$/gm)]
  heads.forEach((h, i) => {
    const name = h[1].toLowerCase()
    // La última sección llega hasta el final del body: se corta en la línea «---»
    // para no arrastrar la firma («Generado por 🤖 …»).
    const text = body
      .slice(h.index + h[0].length, heads[i + 1]?.index ?? body.length)
      .split(/\n-{3,}[ \t]*(?:\n|$)/)[0]
      .trim()
    const key = /contexto/.test(name)
      ? "contexto"
      : /hip[oó]tesis/.test(name)
        ? "hipotesis"
        : /propuesta/.test(name)
          ? "propuesta"
          : /m[eé]trica/.test(name)
            ? "metrica"
            : /riesgo/.test(name)
              ? "riesgos"
              : null
    if (key && !out[key]) out[key] = excerpt(text, 700)
  })
  return out
}

// ---------------------------------------------------------------------------
// Estadísticas
// ---------------------------------------------------------------------------

const countBy = (arr, fn) => arr.reduce((acc, i) => ((acc[fn(i)] = (acc[fn(i)] ?? 0) + 1), acc), {})

export function buildStats(issues, teamKeys, now = new Date().toISOString()) {
  const within = (iso, days) => Boolean(iso) && daysBetween(iso, now) <= days

  const byTeam = {}
  for (const key of teamKeys) {
    const mine = issues.filter((i) => i.team === key)
    const open = mine.filter((i) => i.open)
    // Lo que entra y lo que sale se cuenta sin los registros: un reporte nace cerrado (o se
    // archiva al leerlo) y contarlo como «hecho» infla la semana sin que haya salido nada.
    const work = mine.filter((i) => classOf(i.kind) !== "record")
    byTeam[key] = {
      open: open.length,
      openByState: countBy(open, (i) => i.state),
      openByKind: countBy(open, (i) => i.kind),
      openByClass: countBy(open, (i) => classOf(i.kind)),
      openBySource: countBy(open, (i) => i.source),
      created7d: work.filter((i) => within(i.createdAt, 7)).length,
      done7d: work.filter((i) => within(i.completedAt, 7)).length,
      canceled7d: work.filter((i) => within(i.canceledAt, 7)).length,
      created30d: work.filter((i) => within(i.createdAt, 30)).length,
      done30d: work.filter((i) => within(i.completedAt, 30)).length,
      canceled30d: work.filter((i) => within(i.canceledAt, 30)).length,
      records7d: mine.filter((i) => classOf(i.kind) === "record" && within(i.createdAt, 7)).length,
      stale30: open.filter((i) => i.idleDays >= 30).length,
      ballOwner: open.filter((i) => i.ball?.with === "owner" && i.comments?.lastKind === "bot").length,
      ballAgent: open.filter((i) => i.ball?.with === "agent").length,
    }
  }

  // Rendimiento por agente: de lo que pide trabajo, ¿cuánto termina hecho y cuánto
  // se descarta? Los reportes no cuentan: no piden una decisión.
  const byAgent = {}
  for (const i of issues) {
    if (!(i.source in AGENTS) || classOf(i.kind) !== "work") continue
    const a = (byAgent[i.source] ??= { open: 0, created30d: 0, done: 0, canceled: 0, duplicate: 0, staleOpen: 0, ages: [] })
    if (within(i.createdAt, 30)) a.created30d++
    if (i.open) {
      a.open++
      a.ages.push(i.ageDays)
      if (i.idleDays >= 21) a.staleOpen++
    } else if (i.stateType === "completed") a.done++
    else if (/duplic/i.test(i.state)) a.duplicate++
    else a.canceled++
  }
  for (const a of Object.values(byAgent)) {
    const decided = a.done + a.canceled + a.duplicate
    a.decided = decided
    a.acceptRate = decided ? Math.round((a.done / decided) * 100) : null
    a.dupRate = decided ? Math.round((a.duplicate / decided) * 100) : null
    a.ages.sort((x, y) => x - y)
    a.medianOpenAgeDays = a.ages.length ? a.ages[Math.floor(a.ages.length / 2)] : null
    delete a.ages
  }

  // Registros abiertos por agente: cuánto ruido deja cada cron en el Backlog.
  const recordsBySource = countBy(
    issues.filter((i) => i.open && classOf(i.kind) === "record"),
    (i) => i.source,
  )

  return { byTeam, byAgent, recordsBySource }
}

// ---------------------------------------------------------------------------
// Recomendaciones para Alfred
// ---------------------------------------------------------------------------

/**
 * El issue `[Retro]` que Alfred barre cada mañana. Es el mismo texto salga del
 * tablero o de la charla: lo que cambia es la última línea, que dice por dónde lo mandó el owner.
 */
export function retroIssue(rec, agentName, via = "el tablero") {
  return {
    title: `[Retro] ${agentName}: ${rec.title}`,
    description: [
      "## Qué se observa (patrón, no un caso)",
      rec.pattern,
      "",
      "## Evidencia",
      ...(rec.evidence ?? []).map((e) => `- ${e}`),
      "",
      "## Artefacto sospechado",
      rec.artifact ? `\`${rec.artifact}\`` : "(a diagnosticar)",
      "",
      "## Cambio propuesto",
      rec.proposal,
      ...(rec.expected ? ["", "## Cómo sabríamos que funcionó", rec.expected] : []),
      "",
      "---",
      `Recomendación del Project Lead, enviada por el owner desde ${via}. No hay cita textual del owner: la base es el patrón medido arriba.`,
    ].join("\n"),
  }
}

/**
 * El comentario que dispara a Alfred. El listener solo mira comentarios que empiezan con
 * «<Agente>:»: un issue creado, por sí solo, no arranca a nadie.
 * Va UNO solo aunque sean varios issues: Alfred trabaja sobre un único clon del repo y dos
 * corridas a la vez se pisarían. En una corrida los procesa uno por uno.
 */
export function retroTrigger(identifiers) {
  if (identifiers.length === 1) return "Alfred: procesa ahora este `[Retro]`. No esperes al barrido de mañana."
  return [
    `Alfred: procesa ahora, en esta misma corrida y uno por uno, los ${identifiers.length} [Retro] que te mandó el owner: ${identifiers.join(", ")}. No esperes al barrido de mañana.`,
    "",
    "Un PR por issue, salvo que dos toquen el mismo archivo. En cada issue deja tu comentario con el PR, como siempre. Si se te acaba el tiempo, corta entre un issue y otro, no en el medio, y di aquí cuáles quedaron sin hacer.",
  ].join("\n")
}
