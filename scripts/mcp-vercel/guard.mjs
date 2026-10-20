// Guard del MCP de Vercel: funciones PURAS (sin red) que definen qué puede pedir el agente y
// qué vuelve hacia él. Tests: node guard.test.mjs
//
// Tres trabajos:
//   1. PIN de proyectos — el agente solo nombra proyectos de la lista de la corrida
//      (project.json → vercel.projects); cualquier otro id se rechaza antes de salir a la red.
//   2. Validación de ids — todo lo que termina en un path de la API matchea un regex estricto
//      (nada de "../" ni query strings colados en un id).
//   3. Whitelist + redacción de la salida — de cada fila de log/deployment sale SOLO una lista
//      corta de campos; los mensajes y paths pasan por redact() (emails, tokens, IPs).

export const PROJECT_ID_RE = /^prj_[A-Za-z0-9]{10,48}$/;
export const DEPLOYMENT_ID_RE = /^dpl_[A-Za-z0-9]{10,48}$/;
export const TEAM_ID_RE = /^team_[A-Za-z0-9]{10,48}$/;
export const REQUEST_ID_RE = /^[A-Za-z0-9:_-]{6,160}$/;

export const LOG_LEVELS = ["error", "warn", "info", "fatal"];
export const DEPLOYMENT_STATES = ["READY", "ERROR", "BUILDING", "QUEUED", "INITIALIZING", "CANCELED"];

// VERCEL_PROJECTS = "site=prj_abc;app=prj_def" (lo arma project.ps1 desde project.json).
// VERCEL_PROJECT_ID = un solo id (legado / corrida local sin wrapper) → key "default".
// Lo que no tenga forma de prj_ se ignora: nunca se pinea algo que no sea un id de proyecto.
export function parseProjects(env = {}) {
  const out = new Map();
  for (const part of String(env.VERCEL_PROJECTS || "").split(/[;,\s]+/).map((s) => s.trim()).filter(Boolean)) {
    const i = part.indexOf("=");
    const key = (i > 0 ? part.slice(0, i) : "").trim().toLowerCase();
    const id = (i > 0 ? part.slice(i + 1) : part).trim();
    if (!PROJECT_ID_RE.test(id)) continue;
    if (key && !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(key)) continue;
    out.set(key || `p${out.size + 1}`, id);
  }
  const single = String(env.VERCEL_PROJECT_ID || "").trim();
  if (out.size === 0 && PROJECT_ID_RE.test(single)) out.set("default", single);
  return out;
}

// Acepta la key ("site") o el id (prj_...) de un proyecto PINEADO. Sin argumento = el primero.
export function resolveProject(arg, projects) {
  if (!projects || projects.size === 0) {
    throw new Error(
      "fuente Vercel no configurada: esta corrida no tiene proyectos de Vercel declarados (project.json → vercel.projects)"
    );
  }
  if (arg === undefined || arg === null || String(arg).trim() === "") {
    const [key, id] = projects.entries().next().value;
    return { key, id };
  }
  const a = String(arg).trim();
  const byKey = projects.get(a.toLowerCase());
  if (byKey) return { key: a.toLowerCase(), id: byKey };
  for (const [key, id] of projects) if (id === a) return { key, id };
  throw new Error(
    `proyecto '${a.slice(0, 60)}' fuera del alcance de esta corrida. Permitidos: ${[...projects.keys()].join(", ")}`
  );
}

export function isAllowedProjectId(id, projects) {
  for (const v of projects.values()) if (v === id) return true;
  return false;
}

// "30m" | "6h" | "2d" | "90s" | "now" | ISO 8601 | epoch ms → epoch ms.
export function parseTime(input, now = Date.now()) {
  if (input === undefined || input === null || input === "") throw new Error("tiempo vacío");
  if (typeof input === "number" && Number.isFinite(input)) return input;
  const s = String(input).trim();
  if (s.toLowerCase() === "now") return now;
  const rel = /^(\d+(?:\.\d+)?)\s*(s|m|h|d)$/i.exec(s);
  if (rel) {
    const unit = { s: 1e3, m: 60e3, h: 3600e3, d: 86400e3 }[rel[2].toLowerCase()];
    return Math.round(now - Number(rel[1]) * unit);
  }
  if (/^\d{12,14}$/.test(s)) return Number(s);
  const t = Date.parse(s);
  if (Number.isFinite(t)) return t;
  throw new Error(`tiempo inválido: '${s.slice(0, 40)}' (usa "30m", "6h", "1d" o una fecha ISO)`);
}

// El endpoint ignora en silencio un nivel que no conoce (devuelve todo o nada), así que aquí se
// valida. "warning" es el nombre que usa el CLI; el endpoint espera "warn".
export function normLevels(input) {
  if (input === undefined || input === null || input === "") return [];
  const list = (Array.isArray(input) ? input : String(input).split(",")).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  const out = [];
  for (const raw of list) {
    const l = raw === "warning" ? "warn" : raw;
    if (!LOG_LEVELS.includes(l)) throw new Error(`nivel inválido: '${raw.slice(0, 20)}' (válidos: ${LOG_LEVELS.join(", ")})`);
    if (!out.includes(l)) out.push(l);
  }
  return out;
}

// "500" | "404" | "5xx" | "4xx"
export function normStatus(input) {
  if (input === undefined || input === null || input === "") return "";
  const s = String(input).trim().toLowerCase();
  if (!/^[1-5](\d\d|xx)$/.test(s)) throw new Error(`statusCode inválido: '${s.slice(0, 10)}' (ej. "500", "404", "5xx")`);
  return s;
}

export function clampInt(v, def, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

// --- Redacción -------------------------------------------------------------------------------
// Los logs de runtime son texto libre que escribe la app: pueden traer emails de usuarios,
// tokens o IPs. Esto es la segunda línea (la primera es no loguear PII en el producto); es
// best-effort y deliberadamente agresivo: preferible tapar de más.
const REDACTIONS = [
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}/g, "[jwt]"],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [redacted]"],
  [/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}/g, "[stripe-key]"],
  [/\bwhsec_[A-Za-z0-9]{8,}/g, "[webhook-secret]"],
  [/\b(?:sbp|sb_secret|sb_publishable)_[A-Za-z0-9_-]{8,}/g, "[supabase-key]"],
  [/\bvc[a-z]_[A-Za-z0-9]{16,}/g, "[vercel-token]"],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, "[github-token]"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "[slack-token]"],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, "[google-key]"],
  [/\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, "[sendgrid-key]"],
  [/\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/g, "[api-key]"],
  [/\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{12,}/g, "[resend-key]"],
  [/\b(?:lin_api_[A-Za-z0-9]{20,}|(?:APP_USR|TEST)-[A-Za-z0-9-]{24,})/g, "[api-key]"],
  [
    /((?:pass(?:word|wd)?|secret|token|api[_-]?key|apikey|authorization|client[_-]?secret|cookie)["']?\s*[:=]\s*["']?)[^\s"'&,;}]{6,}/gi,
    "$1[redacted]",
  ],
  [/[A-Za-z0-9._%+-]+(?:@|%40)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]"],
];

export function redact(text) {
  let s = String(text ?? "");
  for (const [re, rep] of REDACTIONS) s = s.replace(re, rep);
  return s;
}

export function clip(text, max) {
  const s = String(text ?? "");
  return s.length > max ? `${s.slice(0, max)}… [+${s.length - max} chars]` : s;
}

// Path SIN query string ni fragmento (los search params pueden llevar tokens/emails) y redactado.
export function cleanPath(p) {
  const s = String(p ?? "");
  const cut = s.search(/[?#]/);
  return clip(redact(cut >= 0 ? s.slice(0, cut) : s), 300);
}

const iso = (ms) => (Number.isFinite(Number(ms)) && Number(ms) > 0 ? new Date(Number(ms)).toISOString() : undefined);
const firstLine = (s, max) => clip(redact(String(s ?? "").split(/\r?\n/)[0]), max);
const compact = (obj) => {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) delete obj[k];
  }
  return obj;
};

// Commit de un deployment: sha, mensaje, rama, login. NUNCA el email del autor.
function pickCommit(meta = {}) {
  const c = compact({
    sha: meta.githubCommitSha ? String(meta.githubCommitSha).slice(0, 10) : undefined,
    message: meta.githubCommitMessage ? firstLine(meta.githubCommitMessage, 140) : undefined,
    branch: meta.githubCommitRef,
    author: meta.githubCommitAuthorLogin,
    pr: meta.githubPrId,
  });
  return Object.keys(c).length ? c : undefined;
}

// Fila de GET /v6/deployments.
export function pickDeployment(d = {}) {
  return compact({
    id: d.uid || d.id,
    project: d.name,
    url: d.url,
    state: d.state || d.readyState,
    substate: d.readySubstate,
    target: d.target || "preview",
    createdAt: iso(d.created || d.createdAt),
    readyAt: iso(d.ready),
    source: d.source,
    commit: pickCommit(d.meta),
    errorCode: d.errorCode,
    errorMessage: d.errorMessage ? clip(redact(d.errorMessage), 400) : undefined,
    inspectorUrl: d.inspectorUrl,
  });
}

// GET /v13/deployments/{id}. La respuesta cruda trae env (nombres), build.env, projectSettings,
// oidcTokenClaims, routes, lambdas… nada de eso sale: solo estado, error, commit, alias y crons.
export function pickDeploymentDetail(d = {}) {
  return compact({
    ...pickDeployment(d),
    buildingAt: iso(d.buildingAt),
    errorStep: d.errorStep,
    errorLink: d.errorLink,
    aliasAssigned: typeof d.aliasAssigned === "boolean" ? d.aliasAssigned : iso(d.aliasAssigned) ? true : undefined,
    aliasError: d.aliasError?.message ? clip(redact(d.aliasError.message), 200) : undefined,
    alias: Array.isArray(d.alias) ? d.alias.slice(0, 8) : undefined,
    regions: Array.isArray(d.regions) ? d.regions.slice(0, 6) : undefined,
    checksState: d.checksState,
    checksConclusion: d.checksConclusion,
    crons: Array.isArray(d.crons) ? d.crons.slice(0, 40).map((c) => ({ path: c.path, schedule: c.schedule })) : undefined,
  });
}

// Fila de request-logs. Fuera a propósito: requestSearchParams, clientUserAgent, IP/ASN/geo,
// sessionId, referer, traceId. `levels` (opcional) filtra las líneas de log de la fila.
export function pickLogRow(row = {}, { maxMsg = 500, maxLines = 20, levels = [] } = {}) {
  const all = Array.isArray(row.logs) ? row.logs : [];
  const wanted = levels.length ? all.filter((l) => levels.includes(String(l.level))) : all;
  const logs = wanted.slice(0, maxLines).map((l) =>
    compact({ ts: l.timestamp, level: l.level, source: l.source, message: clip(redact(l.message), maxMsg) })
  );
  return compact({
    ts: row.timestamp,
    method: row.requestMethod,
    path: cleanPath(row.requestPath),
    route: row.route ? cleanPath(row.route) : undefined,
    status: row.statusCode,
    errorCode: row.errorCode,
    crashed: row.hasFunctionCrashed ? true : undefined,
    durationMs: typeof row.requestDurationMs === "number" ? Math.round(row.requestDurationMs) : undefined,
    env: row.environment,
    branch: row.branch,
    domain: row.domain,
    deploymentId: row.deploymentId,
    cache: row.cache,
    wafAction: row.wafAction,
    bot: row.botName ? compact({ name: row.botName, category: row.botCategory, verified: row.botVerified ? true : undefined }) : undefined,
    requestId: row.requestId,
    logs,
    moreLogLines: wanted.length > logs.length ? wanted.length - logs.length : undefined,
  });
}

// Mensaje "representativo" de una fila para agrupar: la primera línea de error (o, si no hay,
// de warning), sin los números/ids que cambian de un request a otro.
export function errorSignature(row = {}) {
  const logs = Array.isArray(row.logs) ? row.logs : [];
  const pick =
    logs.find((l) => l.level === "fatal") || logs.find((l) => l.level === "error") || logs.find((l) => l.level === "warn");
  if (!pick?.message) return { level: undefined, message: "", key: "" };
  const line = String(pick.message).split(/\r?\n/).map((s) => s.trim()).find(Boolean) || "";
  const message = clip(redact(line), 300);
  const key = message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "#")
    .replace(/\b[0-9a-f]{12,}\b/gi, "#")
    .replace(/\d{3,}/g, "#")
    .replace(/\s+/g, " ")
    .slice(0, 160);
  return { level: pick.level, message, key };
}

// Línea de build log (GET /v3/deployments/{id}/events).
export function pickBuildLine(ev = {}, maxMsg = 600) {
  return compact({ t: iso(ev.created || ev.date), type: ev.type, text: clip(redact(ev.text ?? ev.payload?.text ?? ""), maxMsg) });
}

export function looksLikeBuildProblem(ev = {}) {
  if (ev.type === "stderr") return true;
  return /\b(?:error|failed|failure|warn(?:ing)?|exception|cannot|unable|missing|deprecated|ELIFECYCLE)\b|✗|ERR!|exit code [1-9]/i.test(
    String(ev.text ?? "")
  );
}
