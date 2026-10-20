/**
 * github.mjs — PRs abiertos y recién mergeados de los repos de cada producto.
 *
 * Es la señal más directa de «qué está esperando al owner»: un PR de Cody o de
 * Alfred abierto es trabajo terminado que no llega a prod hasta que el owner lo mira.
 *
 * Usa el CLI `gh` con la sesión que ya tiene la máquina. Es opcional: si `gh`
 * no está o no tiene sesión, devuelve el error y el sync sigue sin PRs.
 */

import { spawnSync } from "node:child_process"
import { daysBetween, loadProjectBundle } from "./lib.mjs"

function gh(argv) {
  // windowsHide: el sync también corre desde el tablero en segundo plano, que no tiene consola.
  const r = spawnSync("gh", argv, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
  if (r.error || r.status !== 0) return { ok: false, error: (r.stderr || r.error?.message || "").trim().split("\n")[0] }
  try {
    return { ok: true, data: JSON.parse(r.stdout) }
  } catch {
    return { ok: false, error: "salida no-JSON de gh" }
  }
}

const repoSlug = (url) => /github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url ?? "")?.[1] ?? null

/**
 * Repos donde el owner revisa y mergea: los del producto (no los de solo lectura) + el de
 * agentes. Salen de projects/<slug>/project.json (`productRepos[]` o `productRepoUrl`).
 */
export function reposInScope(cfg) {
  const repos = []
  for (const p of cfg.projects) {
    const bundle = loadProjectBundle(p.slug)
    if (!bundle) continue
    const list = bundle.productRepos?.length
      ? bundle.productRepos.filter((r) => !r.readOnly).map((r) => ({ url: r.repoUrl, key: r.key }))
      : [{ url: bundle.productRepoUrl, key: "app" }]
    for (const r of list) {
      const slug = repoSlug(r.url)
      if (slug) repos.push({ repo: slug, project: p.slug, team: p.teamKey, key: r.key })
    }
  }
  if (cfg.agentsRepo) repos.push({ repo: cfg.agentsRepo, project: "agents", team: null, key: "agents" })
  return repos
}

function checksOf(rollup) {
  const states = (rollup ?? []).map((c) => (c.conclusion || c.state || c.status || "").toUpperCase())
  if (states.length === 0) return "none"
  if (states.some((s) => ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED"].includes(s))) return "failing"
  if (states.some((s) => ["PENDING", "IN_PROGRESS", "QUEUED", "EXPECTED", ""].includes(s))) return "pending"
  return "passing"
}

export function fetchPullRequests(cfg, now = new Date().toISOString()) {
  const teamKeys = cfg.projects.map((p) => p.teamKey)
  const refRe = new RegExp(`\\b(${teamKeys.join("|")})-(\\d+)\\b`, "i")
  const issueRef = (...texts) => {
    for (const t of texts) {
      const m = refRe.exec(t ?? "")
      if (m) return `${m[1].toUpperCase()}-${m[2]}`
    }
    return null
  }

  const open = []
  const merged = []
  const errors = []
  const since = Date.now() - (cfg.sync?.mergedPrDays ?? 14) * 86_400_000

  for (const r of reposInScope(cfg)) {
    const o = gh([
      "pr", "list", "--repo", r.repo, "--state", "open", "--limit", "60", "--json",
      "number,title,url,headRefName,createdAt,updatedAt,isDraft,reviewDecision,mergeable,statusCheckRollup,author,additions,deletions,changedFiles",
    ])
    if (!o.ok) {
      errors.push(`${r.repo}: ${o.error}`)
      continue
    }
    for (const pr of o.data) {
      open.push({
        repo: r.repo,
        project: r.project,
        team: r.team,
        number: pr.number,
        title: pr.title,
        url: pr.url,
        branch: pr.headRefName,
        author: pr.author?.login ?? null,
        draft: pr.isDraft,
        review: pr.reviewDecision || null,
        mergeable: pr.mergeable,
        checks: checksOf(pr.statusCheckRollup),
        size: { add: pr.additions, del: pr.deletions, files: pr.changedFiles },
        createdAt: pr.createdAt,
        updatedAt: pr.updatedAt,
        ageDays: Math.floor(daysBetween(pr.createdAt, now)),
        // Solo rama y título: el cuerpo de un PR suele nombrar otros issues de pasada.
        issue: issueRef(pr.headRefName, pr.title),
      })
    }

    const m = gh(["pr", "list", "--repo", r.repo, "--state", "merged", "--limit", "40", "--json", "number,title,url,headRefName,mergedAt,author"])
    if (m.ok) {
      for (const pr of m.data) {
        if (new Date(pr.mergedAt).getTime() < since) continue
        merged.push({
          repo: r.repo,
          project: r.project,
          team: r.team,
          number: pr.number,
          title: pr.title,
          url: pr.url,
          mergedAt: pr.mergedAt,
          author: pr.author?.login ?? null,
          issue: issueRef(pr.headRefName, pr.title),
        })
      }
    }
  }
  return { open, merged, errors }
}

/** Como `gh`, para una salida de un JSON por línea (`gh api --paginate --jq`). */
function ghLines(argv) {
  const r = spawnSync("gh", argv, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
  if (r.error || r.status !== 0) return { ok: false, error: (r.stderr || r.error?.message || "").trim().split("\n")[0] }
  const data = []
  for (const line of r.stdout.split("\n")) {
    if (!line.trim()) continue
    try {
      data.push(JSON.parse(line))
    } catch {
      return { ok: false, error: "salida no-JSON de gh" }
    }
  }
  return { ok: true, data }
}

/**
 * Los issues que nombra un texto («ACM-123», «acm-68»), sin repetir.
 *
 * Las barras van dobles: dentro de un template literal, `\b` es un retroceso y `\d` una «d».
 * Con barras simples esta expresión no encuentra nada, y ningún cambio mergeado queda
 * asociado a su issue sin que nada falle (lo encontró una revisión de código).
 */
export function issueRefs(teamKeys, ...texts) {
  const re = new RegExp(`\\b(${teamKeys.join("|")})-(\\d+)\\b`, "gi")
  const found = new Set()
  for (const t of texts) for (const m of (t ?? "").matchAll(re)) found.add(`${m[1].toUpperCase()}-${m[2]}`)
  return [...found]
}

/**
 * Lo que ya salió en cada app: PRs mergeados y commits de la rama principal.
 *
 * Un issue cuenta lo que un agente vio el día que lo escribió. Esto es lo que
 * cambió desde entonces, y es contra lo que se verifica una propuesta antes de
 * pedirla: sin esto, un pedido puede salir hablando de un proveedor de email que
 * la app ya había reemplazado semanas antes.
 */
export function fetchShipped(cfg, now = new Date().toISOString()) {
  const days = cfg.sync?.shippedDays ?? 45
  const since = new Date(Date.parse(now) - days * 86_400_000).toISOString()
  const teamKeys = cfg.projects.map((p) => p.teamKey)
  const refsOf = (...texts) => issueRefs(teamKeys, ...texts)

  const items = []
  const errors = []
  for (const r of reposInScope(cfg)) {
    if (!r.team) continue // el repo de agentes no es una app
    const base = { repo: r.repo, project: r.project, team: r.team }

    const prs = gh([
      "pr", "list", "--repo", r.repo, "--state", "merged", "--search", `merged:>=${since.slice(0, 10)}`,
      "--limit", "300", "--json", "number,title,url,headRefName,mergedAt",
    ])
    if (!prs.ok) errors.push(`${r.repo}: ${prs.error}`)
    else
      for (const pr of prs.data)
        items.push({ ...base, kind: "pr", ref: `#${pr.number}`, title: pr.title, url: pr.url, at: pr.mergedAt, issues: refsOf(pr.headRefName, pr.title) })

    // Lo que entró a la rama principal sin PR (los merge commits ya están contados arriba).
    const commits = ghLines([
      "api", "--paginate", `repos/${r.repo}/commits?since=${since}&per_page=100`,
      "--jq", '.[] | {sha: .sha[0:7], at: .commit.committer.date, url: .html_url, parents: (.parents | length), msg: (.commit.message | split("\n")[0])}',
    ])
    if (!commits.ok) errors.push(`${r.repo} (commits): ${commits.error}`)
    else
      for (const c of commits.data) {
        if (c.parents > 1 || /\(#\d+\)$/.test(c.msg)) continue
        items.push({ ...base, kind: "commit", ref: c.sha, title: c.msg, url: c.url, at: c.at, issues: refsOf(c.msg) })
      }
  }
  items.sort((a, b) => (a.at < b.at ? 1 : -1))
  return { days, since, items, errors }
}
