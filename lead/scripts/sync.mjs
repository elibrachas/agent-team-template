#!/usr/bin/env node
/**
 * sync.mjs — baja el estado real de Linear (+ PRs de GitHub) a lead/state/snapshot.json.
 *
 * Es 100% determinístico: no llama a ningún modelo. Lo corre la rutina de la
 * mañana antes de que el lead priorice, y el dashboard cuando tocas «Actualizar».
 *
 *   node lead/scripts/sync.mjs              sync completo
 *   node lead/scripts/sync.mjs --no-github  solo Linear
 *   node lead/scripts/sync.mjs --raw=<path> además vuelca la respuesta cruda (debug)
 *
 * Códigos de salida: 0 ok · 2 Linear rechazó la key (hay que rotarla) · 1 otro error.
 * Nunca imprime secretos. La key sale del entorno o de .env.local.age vía op-env.
 */

import {
  AGENTS,
  AGENT_NAMES,
  BOT_RE,
  TRIGGER_RE,
  daysBetween,
  ensureEnv,
  isoDaysAgo,
  linear,
  loadConfig,
  statePath,
  writeJson,
} from "./lib.mjs"
import { fetchPullRequests, fetchShipped } from "./github.mjs"
import { OPEN_TYPES, buildStats, classOf, excerpt, kindOf, sectionsOf, sourceFromBody, sourceFromTitle, sourceOf } from "./model.mjs"

ensureEnv(["LINEAR_API_KEY"], import.meta.url)

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a)
    return m ? [m[1], m[2] ?? true] : [a, true]
  }),
)

const cfg = loadConfig()
const teamKeys = cfg.projects.map((p) => p.teamKey)

// ---------------------------------------------------------------------------
// Linear
// ---------------------------------------------------------------------------

const ISSUES_QUERY = /* GraphQL */ `
  query LeadIssues($filter: IssueFilter, $after: String) {
    issues(filter: $filter, first: 50, after: $after, orderBy: updatedAt) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id identifier title url priority estimate
        createdAt updatedAt completedAt canceledAt startedAt
        description
        team { key }
        state { name type }
        assignee { name }
        project { name }
        parent { identifier }
        labels(first: 10) { nodes { name } }
        attachments(first: 5) { nodes { title url sourceType } }
        comments(last: 8) { nodes { createdAt body user { name } } }
      }
    }
  }
`

const STATES_QUERY = /* GraphQL */ `
  query LeadStates($keys: [String!]) {
    workflowStates(filter: { team: { key: { in: $keys } } }, first: 100) {
      nodes { id name type team { key } }
    }
  }
`

async function fetchIssues(filter) {
  const out = []
  let after = null
  do {
    const data = await linear(ISSUES_QUERY, { filter, after })
    out.push(...data.issues.nodes)
    after = data.issues.pageInfo.hasNextPage ? data.issues.pageInfo.endCursor : null
  } while (after)
  return out
}

// ---------------------------------------------------------------------------
// Normalización
// ---------------------------------------------------------------------------

const agentKey = (name) => {
  const k = String(name ?? "").toLowerCase()
  return k in AGENTS ? k : null
}

const BOT_NAME_RE = new RegExp(`^\\s*🤖\\s*(${AGENT_NAMES.join("|")})`, "iu")

function classifyComment(c) {
  const body = c.body ?? ""
  if (BOT_RE.test(body)) return { kind: "bot", agent: agentKey(BOT_NAME_RE.exec(body)?.[1]) }
  const t = TRIGGER_RE.exec(body)
  if (t) return { kind: "trigger", agent: agentKey(t[1]) }
  return { kind: "human", agent: null }
}

const PR_URL_RE = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g

function normalize(node, now) {
  const labels = node.labels.nodes.map((l) => l.name)
  const open = OPEN_TYPES.includes(node.state.type)

  const comments = node.comments.nodes
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((c) => ({ at: c.createdAt, ...classifyComment(c), body: c.body ?? "" }))

  const last = comments.at(-1) ?? null
  const lastHuman = comments.filter((c) => c.kind !== "bot").at(-1) ?? null
  const lastBot = comments.filter((c) => c.kind === "bot").at(-1) ?? null

  // ¿De quién es la pelota? Solo tiene sentido en issues abiertos.
  //  - último comentario = `Cody: ...` sin respuesta  → la tiene el agente
  //  - último comentario = 🤖 (el agente respondió)   → la tiene el owner
  //  - sin comentarios                                → la tiene el owner (decidir)
  let ball = null
  if (open) {
    if (last?.kind === "trigger") ball = { with: "agent", agent: last.agent, since: last.at }
    else if (last?.kind === "bot") ball = { with: "owner", agent: last.agent, since: last.at }
    else ball = { with: "owner", agent: null, since: last?.at ?? node.createdAt }
  }

  const prUrls = new Set()
  for (const a of node.attachments.nodes) if (/github\.com\/.+\/pull\/\d+/.test(a.url ?? "")) prUrls.add(a.url)
  for (const c of comments) for (const u of c.body.match(PR_URL_RE) ?? []) prUrls.add(u)

  const body = node.description ?? ""
  const kind = kindOf(node.title, labels)
  const klass = classOf(kind)
  // Los cerrados solo alimentan estadísticas y no hace falta cargar su texto, salvo un
  // reporte reciente que terminó en Done: el owner pudo cerrarlo después de leerlo y el
  // lead lo tiene que leer igual, así que guarda el mismo resumen que un abierto.
  const readable = open || (klass === "record" && node.state.type === "completed" && daysBetween(node.createdAt, now) <= recordReadDays)
  return {
    id: node.identifier,
    uuid: node.id,
    team: node.team.key,
    title: node.title,
    url: node.url,
    kind,
    class: klass,
    source: sourceOf({
      title: node.title,
      labels,
      body,
      firstBotAgent: comments.find((c) => c.kind === "bot" && c.agent)?.agent,
    }),
    // Quién lo abrió, sin el respaldo del primer agente que comentó: `source` lo usa para
    // atribuir, pero «abrió» tiene que ser el autor del issue.
    openedBy: sourceFromBody(body) ?? sourceFromTitle(node.title, labels),
    state: node.state.name,
    stateType: node.state.type,
    open,
    priority: node.priority ?? 0,
    estimate: node.estimate ?? null,
    labels,
    project: node.project?.name ?? null,
    parent: node.parent?.identifier ?? null,
    assignee: node.assignee?.name ?? null,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    startedAt: node.startedAt,
    completedAt: node.completedAt,
    canceledAt: node.canceledAt,
    ageDays: Math.floor(daysBetween(node.createdAt, now)),
    idleDays: Math.floor(daysBetween(node.updatedAt, now)),
    summary: excerpt(body, readable ? 420 : 160),
    sections: readable ? sectionsOf(body) : {},
    bodyChars: body.length,
    prUrls: [...prUrls],
    ball,
    comments: {
      count: comments.length, // últimos 8 como máximo
      lastAt: last?.at ?? null,
      lastKind: last?.kind ?? null,
      lastAgent: last?.agent ?? null,
      lastHumanAt: lastHuman?.at ?? null,
      lastBotAt: lastBot?.at ?? null,
      // Último comentario de cada agente (entre los 8 que se bajan): una respuesta humana
      // después no lo borra, como pasa con lastAgent.
      agentLastAt: Object.fromEntries(comments.filter((c) => c.kind === "bot" && c.agent).map((c) => [c.agent, c.at])),
      tail: comments.slice(-3).map((c) => ({ at: c.at, kind: c.kind, agent: c.agent, text: excerpt(c.body, readable ? 360 : 120) })),
    },
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const t0 = Date.now()
const now = new Date().toISOString()
const closedDays = Number(args["closed-days"] ?? cfg.sync?.closedDays ?? 45)
// Cuántos días un reporte que ya está en Done conserva su resumen completo (ver normalize).
// Más que los dos días que tarda en archivarse: cubre una semana sin rutina de la mañana.
const recordReadDays = Number(cfg.sync?.recordReadDays ?? 7)
const teamFilter = { team: { key: { in: teamKeys } } }

let openRaw, closedRaw, statesRaw
try {
  ;[openRaw, closedRaw, statesRaw] = await Promise.all([
    fetchIssues({ ...teamFilter, state: { type: { in: OPEN_TYPES } } }),
    fetchIssues({ ...teamFilter, state: { type: { nin: OPEN_TYPES } }, updatedAt: { gt: isoDaysAgo(closedDays) } }),
    linear(STATES_QUERY, { keys: teamKeys }),
  ])
} catch (err) {
  if (/authentication|not authenticated|unauthori[sz]ed/i.test(err.message)) {
    console.error("✗ Linear rechazó la API key (LINEAR_API_KEY inválida o revocada).")
    console.error("  1. Crea una key nueva en Linear → Settings → Security & access → Personal API keys.")
    console.error("  2. Reemplázala donde guardas los secretos: con el esquema de scripts/op-env.mjs, en el campo LINEAR_API_KEY del item de 1Password;")
    console.error("     si la defines en el entorno, ahí.")
    console.error("  3. Con op-env, desde la raíz del repo: npm run env:encrypt   (pide biometría una vez).")
    console.error("  El snapshot anterior queda intacto; el dashboard lo sigue mostrando, marcado como viejo.")
    process.exit(2)
  }
  console.error(`✗ ${err.message}`)
  process.exit(1)
}

if (typeof args.raw === "string") writeJson(args.raw, { open: openRaw, closed: closedRaw })

const issues = [...openRaw, ...closedRaw].map((n) => normalize(n, now))
const prs = args["no-github"] ? { open: [], merged: [], errors: ["omitido (--no-github)"] } : fetchPullRequests(cfg, now)
// Lo que ya salió en cada app: contra esto se verifica una propuesta antes de pedirla.
const shipped = args["no-github"] ? { days: 0, since: now, items: [], errors: ["omitido (--no-github)"] } : fetchShipped(cfg, now)

// Ids de los estados por team: los usa el dashboard para mover issues.
const states = {}
for (const s of statesRaw.workflowStates.nodes) (states[s.team.key] ??= {})[s.name] = { id: s.id, type: s.type }

const snapshot = {
  generatedAt: now,
  source: "linear-api",
  window: { closedDays },
  teams: cfg.projects.map((p) => ({ key: p.teamKey, slug: p.slug, name: p.name })),
  states,
  stats: buildStats(issues, teamKeys, now),
  prs,
  shipped,
  issues,
}

writeJson(statePath("snapshot.json"), snapshot)

const openCount = issues.filter((i) => i.open).length
console.log(
  `✓ snapshot: ${openCount} abiertos + ${issues.length - openCount} cerrados (últimos ${closedDays}d) · ` +
    `${prs.open.length} PRs abiertos · ${shipped.items.length} cambios en las apps (${shipped.days}d) · ${((Date.now() - t0) / 1000).toFixed(1)}s`,
)
for (const key of teamKeys) {
  const s = snapshot.stats.byTeam[key]
  console.log(`  ${key}: ${s.open} abiertos ${JSON.stringify(s.openByState)}`)
}
if (prs.errors.length || shipped.errors.length) console.log(`  ! GitHub: ${[...prs.errors, ...shipped.errors].join(" | ")}`)
console.log(`  → ${statePath("snapshot.json")}`)
