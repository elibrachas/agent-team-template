/**
 * lib.mjs — utilidades compartidas del Project Lead (sync, CLI y dashboard).
 *
 * Tres cosas que resuelve y que conviene no reimplementar en cada script:
 *
 *  1. DÓNDE vive el estado. Las sesiones de Claude Code corren en worktrees
 *     descartables; si el estado quedara relativo al worktree se perdería entre
 *     sesiones. Por eso se ancla al checkout PRINCIPAL del repo (vía
 *     `git rev-parse --git-common-dir`), salvo que LEAD_STATE_DIR diga otra cosa.
 *  2. CÓMO se obtienen los secretos. Si LINEAR_API_KEY ya está en el entorno, se
 *     usa esa. Si no, el script se re-ejecuta a sí mismo envuelto en
 *     `scripts/op-env.mjs exec`, que descifra `.env.local.age` a memoria: nunca
 *     se leen de disco en claro.
 *  3. La API de Linear (GraphQL) con un cliente mínimo que jamás imprime la key.
 */

import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const LEAD_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..")
export const REPO_ROOT = resolve(LEAD_DIR, "..")

/** Raíz del checkout principal (no del worktree). Cae a REPO_ROOT si git no responde. */
export function mainCheckoutRoot() {
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
    return common ? resolve(dirname(common)) : REPO_ROOT
  } catch {
    return REPO_ROOT
  }
}

let _stateDir
export function stateDir() {
  if (_stateDir) return _stateDir
  _stateDir = process.env.LEAD_STATE_DIR
    ? resolve(process.env.LEAD_STATE_DIR)
    : join(mainCheckoutRoot(), "lead", "state")
  mkdirSync(join(_stateDir, "history"), { recursive: true })
  return _stateDir
}

/** Redirige el estado a otra carpeta (lo usa la simulación del tablero para trabajar sobre una copia). */
export function useStateDir(dir) {
  _stateDir = resolve(dir)
  mkdirSync(join(_stateDir, "history"), { recursive: true })
}

export const statePath = (...parts) => join(stateDir(), ...parts)

// ---------------------------------------------------------------------------
// JSON / archivos
// ---------------------------------------------------------------------------

export function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""))
  } catch (err) {
    throw new Error(`JSON inválido en ${path}: ${err.message}`)
  }
}

/** Escritura atómica: un lector (el dashboard) nunca ve un archivo a medio escribir. */
export function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8")
  renameSync(tmp, path)
}

export function appendJsonl(path, record) {
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, JSON.stringify(record) + "\n", "utf8")
}

export function readJsonl(path) {
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        return [JSON.parse(l)]
      } catch {
        return [] // una línea corrupta no debe tumbar el dashboard
      }
    })
}

/**
 * Lee lead/lead.config.json. LEAD_CONFIG apunta a otro archivo: lo usa el selftest,
 * para probar con dos proyectos de mentira sin depender de cómo configuraste el tuyo.
 */
export function loadConfig() {
  const path = process.env.LEAD_CONFIG ? resolve(process.env.LEAD_CONFIG) : join(LEAD_DIR, "lead.config.json")
  const cfg = readJson(path)
  if (!cfg) throw new Error(`Falta ${process.env.LEAD_CONFIG ? path : "lead/lead.config.json"}`)
  return cfg
}

/** Lee projects/<slug>/project.json del repo (fuente de verdad del foco estratégico). */
export function loadProjectBundle(slug) {
  return readJson(join(REPO_ROOT, "projects", slug, "project.json"), null)
}

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

export const DAY_MS = 86_400_000
export const daysBetween = (a, b = Date.now()) => (new Date(b).getTime() - new Date(a).getTime()) / DAY_MS
export const isoDaysAgo = (n) => new Date(Date.now() - n * DAY_MS).toISOString()

/** Fecha local YYYY-MM-DD (la del usuario, no UTC): el plan del día se nombra así. */
export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// ---------------------------------------------------------------------------
// Secretos
// ---------------------------------------------------------------------------

/**
 * Garantiza que `vars` estén en process.env. Si no, re-ejecuta este mismo
 * script a través de op-env (age → memoria). Sin prompts: usa la clave de age
 * de la máquina, así que sirve para corridas desatendidas.
 *
 * Si no usas el esquema de op-env, alcanza con definir las variables en el
 * entorno antes de correr el script.
 */
export function ensureEnv(vars, scriptUrl, { optional = false } = {}) {
  const missing = vars.filter((v) => !process.env[v])
  if (missing.length === 0) return true

  if (process.env.LEAD_ENV_REEXEC === "1") {
    if (optional) return false
    console.error(`✗ Faltan variables aun después de descifrar el entorno: ${missing.join(", ")}`)
    console.error("  Agrégalas a .env.local y corre `npm run env:push` + `npm run env:encrypt` (con 1Password abierto), o defínelas en el entorno.")
    process.exit(1)
  }

  const opEnv = join(REPO_ROOT, "scripts", "op-env.mjs")
  const candidates = [join(REPO_ROOT, ".env.local.age"), join(mainCheckoutRoot(), ".env.local.age")]
  const enc = candidates.find((p) => existsSync(p))
  if (!enc || !existsSync(opEnv)) {
    if (optional) return false
    console.error(`✗ Falta ${missing.join(", ")} en el entorno y no encontré ${enc ? "scripts/op-env.mjs" : ".env.local.age (busqué en el worktree y en el checkout principal)"}.`)
    console.error("  Define la variable en el entorno, o genera .env.local.age con `npm run env:encrypt` desde la raíz del repo (pide 1Password una sola vez).")
    process.exit(1)
  }

  const r = spawnSync("node", [opEnv, "exec", `--enc=${enc}`, "--", "node", fileURLToPath(scriptUrl), ...process.argv.slice(2)], {
    stdio: "inherit",
    cwd: REPO_ROOT,
    env: { ...process.env, LEAD_ENV_REEXEC: "1" },
  })
  process.exit(r.status ?? 1)
}

/**
 * Descifrar `.env.local.age` trae TODAS las variables del repo (Stripe, Supabase,
 * el proveedor de email…). Un proceso que queda corriendo todo el día no debería
 * cargarlas: esto saca del entorno las que no están en `keep`. Los nombres salen
 * del template versionado, que solo tiene nombres y referencias, nunca valores.
 */
export function dropUnneededSecrets(keep = []) {
  const tpl = join(REPO_ROOT, ".env.local.tpl")
  if (!existsSync(tpl)) return
  for (const line of readFileSync(tpl, "utf8").split(/\r?\n/)) {
    const key = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1]
    if (key && !keep.includes(key)) delete process.env[key]
  }
}

// ---------------------------------------------------------------------------
// Linear
// ---------------------------------------------------------------------------

/**
 * La URL solo se puede cambiar por una de esta misma máquina (la usa el
 * selftest con una API de mentira). Cualquier otro valor se ignora: la key
 * nunca viaja a un host que no sea Linear.
 */
const LINEAR_URL = /^http:\/\/127\.0\.0\.1:\d+\//.test(process.env.LINEAR_API_URL ?? "") ? process.env.LINEAR_API_URL : "https://api.linear.app/graphql"

const LINEAR_TIMEOUT_MS = Number(process.env.LINEAR_TIMEOUT_MS) > 0 ? Number(process.env.LINEAR_TIMEOUT_MS) : 30_000

export async function linear(query, variables = {}, { timeoutMs = LINEAR_TIMEOUT_MS, retries = 3 } = {}) {
  const key = process.env.LINEAR_API_KEY
  if (!key) throw new Error("LINEAR_API_KEY no está en el entorno")
  // Una escritura que no contestó puede haber llegado igual: reintentarla podría publicar dos
  // veces un «Cody: …» y disparar dos corridas. Las lecturas sí se reintentan.
  const isMutation = /^\s*mutation\b/.test(query)
  const unsure = isMutation ? ". No se sabe si el cambio llegó: míralo en Linear antes de reintentar" : ""
  const backoff = (attempt) => new Promise((r) => setTimeout(r, 1500 * attempt))

  for (let attempt = 1; ; attempt++) {
    let res
    try {
      res = await fetch(LINEAR_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: key },
        body: JSON.stringify({ query, variables }),
        // Sin esto, un Linear que acepta la conexión y no contesta deja colgados el sync de
        // la mañana y el arranque del tablero.
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      if (!isMutation && attempt <= retries) {
        await backoff(attempt)
        continue
      }
      const why = err.name === "TimeoutError" || err.name === "AbortError" ? `sin respuesta en ${Math.round(timeoutMs / 1000)} s` : err.message
      throw new Error(`Linear no respondió (${why})${unsure}`)
    }

    // Rate limit / errores transitorios: reintento corto con backoff. Un 429 no se procesó, así
    // que también vale para una escritura; un 5xx de una escritura es ambiguo y no se reintenta.
    if ((res.status === 429 || (res.status >= 500 && !isMutation)) && attempt <= retries) {
      await backoff(attempt)
      continue
    }

    let json
    try {
      json = await res.json()
    } catch {
      // La respuesta se cortó o no era JSON: con una escritura, el cambio pudo haber llegado.
      throw new Error(`Linear respondió ${res.status} sin JSON${unsure}`)
    }
    if (!res.ok || json.errors?.length) {
      const msg = (json.errors ?? []).map((e) => e.message).join("; ") || `HTTP ${res.status}`
      // Un error que Linear explica (4xx, o errores de GraphQL) es un rechazo: no se aplicó.
      // Un 5xx no dice nada sobre si se aplicó.
      throw new Error(`Linear: ${msg}${res.status >= 500 ? unsure : ""}`)
    }
    return json.data
  }
}

// ---------------------------------------------------------------------------
// Roster — nombres de los agentes del equipo (coincide con scripts/agents.ps1)
// ---------------------------------------------------------------------------

export const AGENTS = {
  capi: { name: "Capi", emoji: "🫒", role: "PM / plan por proyecto" },
  numa: { name: "Numa", emoji: "📊", role: "Datos" },
  greta: { name: "Greta", emoji: "📈", role: "Growth · SEO/AEO" },
  pico: { name: "Pico", emoji: "🎯", role: "Producto" },
  cody: { name: "Cody", emoji: "💻", role: "Código" },
  qualy: { name: "Qualy", emoji: "🧪", role: "QA · seguridad de front" },
  daly: { name: "Daly", emoji: "🎨", role: "UX/UI" },
  leda: { name: "Leda", emoji: "📖", role: "Contenido" },
  alfred: { name: "Alfred", emoji: "🎩", role: "Mejora a los agentes" },
}

export const AGENT_NAMES = Object.values(AGENTS).map((a) => a.name)
export const AGENT_RE = new RegExp(`\\b(${AGENT_NAMES.join("|")})\\b`, "i")
/** Comentario de un humano que dispara a un agente: `Cody: ...` al inicio. */
export const TRIGGER_RE = new RegExp(`^\\s*(${AGENT_NAMES.join("|")})\\s*:`, "i")
/** Comentario escrito por un agente (guard anti-loop del listener). */
export const BOT_RE = /^\s*🤖/u
