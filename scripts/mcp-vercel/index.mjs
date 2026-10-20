#!/usr/bin/env node
// MCP server: Vercel READ-ONLY para el equipo de agentes.
// Deploys, build logs y logs de runtime de los proyectos de Vercel de CADA producto del roster.
// Lo usan Qualy (log-review, QA de previews), Cody (¿buildeó mi preview? ¿qué error tira prod?)
// y Numa/Greta/Pico (¿hubo un deploy o un pico de 5xx que explique este número?).
//
// Tools:
//   - vercel_projects      → proyectos de Vercel de esta corrida + último deploy de prod y último fallido
//   - vercel_deployments   → lista de deployments (estado, target, commit)
//   - vercel_build_logs    → estado + log de build de UN deployment
//   - vercel_logs_summary  → errores de runtime agrupados (5xx + logs de error) en una ventana
//   - vercel_request_logs  → filas de runtime con filtros (nivel, status, texto, deployment…)
//
// POR QUÉ un MCP y no curl: el token de Vercel NO puede ser read-only (Vercel solo deja acotarlo
// por team/proyecto y vencimiento). El mismo token que lee logs puede borrar proyectos, tocar
// dominios y LEER/DESCIFRAR las env vars de producción de todo el team. El "solo lectura" se
// impone aquí, en 4 capas:
//   1. Solo GET. vget() es la única función que sale a la red y el método está fijo.
//   2. Paths fijos. Cada tool arma su path desde una plantilla; los ids pasan un regex estricto.
//      No existe tool que llegue a /env, /v9/projects/{id} (trae env), tokens, dominios ni teams.
//   3. Pin de proyectos. Solo los ids de VERCEL_PROJECTS (project.json → vercel.projects); un
//      deployment de otro proyecto del team se rechaza aunque el token lo pueda ver.
//   4. Whitelist + redacción de la salida (guard.mjs): campos puntuales, sin query strings,
//      user agents, IPs ni emails.
//
// Env (el token de .env.server / .env.<slug>; el pin lo exporta scripts/project.ps1):
//   VERCEL_API_TOKEN    token de la cuenta (fallback: VERCEL_TOKEN). NUNCA inline en el .mcp.json.
//   VERCEL_TEAM_ID      team_... dueño de los proyectos (si falta, se deduce del token).
//   VERCEL_PROJECTS     "site=prj_...;app=prj_..." — proyectos permitidos en esta corrida.
//   VERCEL_PROJECT_ID   un solo prj_... (legado / corrida local sin wrapper).
//
// Sin token o sin proyectos el proceso NO aborta: levanta y cada tool devuelve "fuente Vercel no
// configurada", así el agente degrada declarándolo en vez de romper la corrida.
//
// Logs de runtime: salen del endpoint que usa el CLI oficial (`vercel logs`):
// https://vercel.com/api/logs/request-logs. El documentado en la REST API
// (/v1/projects/{id}/deployments/{id}/runtime-logs) es un STREAM en vivo: no trae historial y
// deja la conexión abierta — por eso un log-review por curl contra ese endpoint vuelve vacío.
// Retención: la del plan de Vercel (~24 h al escribir esto); una ventana entera fuera de eso da 400.
//
// Lanza con: node scripts/mcp-vercel/index.mjs   (el cliente MCP se conecta por stdio).

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  DEPLOYMENT_ID_RE,
  DEPLOYMENT_STATES,
  LOG_LEVELS,
  REQUEST_ID_RE,
  TEAM_ID_RE,
  clampInt,
  clip,
  cleanPath,
  errorSignature,
  isAllowedProjectId,
  looksLikeBuildProblem,
  normLevels,
  normStatus,
  parseProjects,
  parseTime,
  pickBuildLine,
  pickDeployment,
  pickDeploymentDetail,
  pickLogRow,
  redact,
  resolveProject,
} from "./guard.mjs";

const TOKEN = (process.env.VERCEL_API_TOKEN || process.env.VERCEL_TOKEN || "").trim();
const PROJECTS = parseProjects(process.env);
let teamId = TEAM_ID_RE.test((process.env.VERCEL_TEAM_ID || "").trim()) ? process.env.VERCEL_TEAM_ID.trim() : "";

const HOSTS = { api: "https://api.vercel.com", web: "https://vercel.com" };
const RETENTION_NOTE =
  "Los logs de runtime tienen la retención del plan de Vercel (~24 h hoy): lo anterior no existe en esta fuente. Deploys y build logs sí tienen historial.";
const SLOW_NOTE =
  "La búsqueda de logs de Vercel es lenta en ventanas anchas (hasta ~30 s) y cada llamada tiene un tope de ~1 minuto: si Vercel no " +
  "responde para toda la ventana, vuelve SOLO el tramo más reciente, marcado con coveredSince — lo anterior quedó sin mirar y se " +
  "completa repitiendo con until. Ventanas de pocas horas responden mucho más rápido. ";
const OUTPUT_BUDGET = 70000; // chars de filas por respuesta: el resto se pagina con nextUntil
const PAGE_CAP = 6; // páginas de 50 filas por consulta (cursor por tiempo)
// Tope de tiempo TOTAL por llamada a una tool. La búsqueda de logs de Vercel a veces tarda
// decenas de segundos o devuelve 504; sin tope, los reintentos por página se acumulaban y una
// sola llamada podía dejar al agente esperando varios minutos. Al vencer se
// devuelve lo que haya, marcado como parcial, o un error claro. VERCEL_TOOL_BUDGET_MS lo ajusta.
const TOOL_BUDGET_MS = clampInt(process.env.VERCEL_TOOL_BUDGET_MS, 55000, 1000, 120000);
const REQUEST_TIMEOUT_MS = 20000;
// La búsqueda de logs tarda más cuanto más ancha es la ventana (medido: 2-9 s con 1 h,
// 5-20 s con 24 h) y el gateway de Vercel la corta con 504 a los ~30 s. Se espera apenas más que
// eso para ver el 504 real en vez de abortar una consulta que estaba por responder.
const LOGS_TIMEOUT_MS = 32000;
const newDeadline = () => Date.now() + TOOL_BUDGET_MS;

class VercelError extends Error {}
// Vercel no contestó a tiempo o contestó 5xx/429: puede andar al reintentar más tarde.
class VercelUnavailable extends VercelError {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpError(status, body) {
  const code = String(body?.error?.code || body?.name || body?.code || "").slice(0, 60);
  const detail = body?.error?.message ? ` ${clip(redact(body.error.message), 160)}` : "";
  if (status === 401 || status === 403) {
    return new VercelError(
      `Vercel rechazó el pedido (${status}${code ? " " + code : ""}): token revocado/vencido, o el recurso no es de este team. Declarar la fuente como no disponible; no reintentar.`
    );
  }
  if (status === 400 && /ExceedsBillingLimit/i.test(code)) {
    return new VercelError(
      "la ventana pedida cae entera fuera de la retención de logs del plan (~24 h). Pide una ventana que termine dentro de las últimas 24 h; lo anterior no está disponible en esta fuente."
    );
  }
  if (status === 404) return new VercelError(`no existe o no es visible con este token (404${code ? " " + code : ""}).`);
  if (status === 429) return new VercelUnavailable("rate limit de Vercel (429). Reintenta UNA vez en ~1 minuto; si sigue, decláralo.");
  if (status >= 500) {
    return new VercelUnavailable(`Vercel respondió ${status}${code ? " " + code : ""} (error del lado de Vercel). Reintenta UNA vez más tarde o con una ventana más chica; si sigue, decláralo.`);
  }
  return new VercelError(`Vercel respondió ${status}${code ? " " + code : ""}.${detail}`);
}

const OUT_OF_TIME =
  "Vercel no respondió dentro del tiempo de la consulta. Reintenta UNA vez con una ventana más chica o más filtros; si sigue, declara la fuente como no disponible en esta corrida.";

// ÚNICA salida a la red. Método fijo (GET), hosts fijos, sin seguir redirects.
// `deadline` (epoch ms) es el tope de la llamada a la tool: ni el timeout ni los reintentos lo pasan.
async function vget(host, path, query = {}, { timeoutMs = REQUEST_TIMEOUT_MS, retries = 1, deadline = newDeadline() } = {}) {
  if (!TOKEN) {
    throw new VercelError("fuente Vercel no configurada (falta VERCEL_API_TOKEN en el env de la corrida)");
  }
  const url = new URL(HOSTS[host] + path);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const canRetry = (attempt, waitMs) => attempt < retries && deadline - Date.now() > waitMs + 5000;
  for (let attempt = 0; ; attempt++) {
    const left = deadline - Date.now();
    if (left < 500) throw new VercelUnavailable(OUT_OF_TIME);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), Math.min(timeoutMs, left));
    let res, text;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" },
        redirect: "error",
        signal: ac.signal,
      });
      text = await res.text();
    } catch (e) {
      clearTimeout(timer);
      if (canRetry(attempt, 1000)) { await sleep(1000); continue; }
      throw new VercelUnavailable(e?.name === "AbortError" ? OUT_OF_TIME : `error de red hablando con Vercel (${e?.name || "?"}).`);
    }
    clearTimeout(timer);
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* respuesta no-JSON */ }
    if (res.ok) return body;
    const wait = 1500 * (attempt + 1);
    if ((res.status >= 500 || res.status === 429) && canRetry(attempt, wait)) { await sleep(wait); continue; }
    throw httpError(res.status, body);
  }
}

// El endpoint de logs exige ownerId. Si el wrapper no lo pasó, se deduce del propio token.
async function getTeamId(deadline) {
  if (teamId) return teamId;
  const cur = await vget("api", "/v5/user/tokens/current", {}, { deadline }).catch(() => null);
  let t = cur?.token?.teamId || (cur?.token?.scopes || []).find((s) => s?.type === "team")?.teamId;
  if (!TEAM_ID_RE.test(String(t || ""))) {
    const user = await vget("api", "/v2/user", {}, { deadline });
    t = user?.user?.defaultTeamId;
  }
  if (!TEAM_ID_RE.test(String(t || ""))) throw new VercelError("no pude determinar el team de Vercel (define VERCEL_TEAM_ID).");
  teamId = t;
  return teamId;
}

// Logs de runtime, lo más nuevo primero. El endpoint devuelve 50 filas e IGNORA `page`
// (verificado): se pagina moviendo endDate al timestamp más viejo recibido.
//
// Devuelve { rows, hasMore, partial, coveredSince }:
//   - `partial` (texto): se cortó ANTES de recorrer toda la ventana (se acabó el tiempo de la
//     llamada, o Vercel dejó de responder a mitad del paginado).
//   - `coveredSince` (epoch ms): Vercel no respondió para la ventana completa y se cubrió solo el
//     tramo más reciente, desde ese instante. Lo anterior queda SIN mirar: quien llama lo tiene que
//     decir y, si hace falta, seguir con until = coveredSince.
// Sin reintento de la misma consulta: si tardó 30 s, volver a pedirla igual vuelve a tardar 30 s.
// Lo que sí ayuda es achicar la ventana.
async function fetchRequestLogs({ projectId, startMs, endMs, filters = {}, maxRows, deadline = newDeadline() }) {
  const ownerId = await getTeamId(deadline);
  const rows = [];
  const seen = new Set();
  let start = startMs;
  let end = endMs;
  let hasMore = false;
  let partial;
  let coveredSince;
  const fetchPage = () =>
    vget(
      "web",
      "/api/logs/request-logs",
      { projectId, ownerId, page: 0, startDate: Math.round(start), endDate: Math.round(end), ...filters },
      { timeoutMs: LOGS_TIMEOUT_MS, retries: 0, deadline }
    );
  for (let page = 0; page < PAGE_CAP && rows.length < maxRows; page++) {
    if (page > 0 && deadline - Date.now() < 3000) { partial = "se acabó el tiempo de la consulta antes de recorrer toda la ventana"; break; }
    let body;
    try {
      body = await fetchPage();
    } catch (e) {
      if (!(e instanceof VercelUnavailable)) throw e;
      if (page > 0) { partial = "Vercel dejó de responder a mitad del paginado"; break; }
      // Primera página sin respuesta: un intento con el cuarto más reciente de la ventana (mínimo 1 h).
      const span = end - start;
      const shorter = Math.max(3600e3, span / 4);
      if (span <= shorter || deadline - Date.now() < 12000) throw e;
      start = end - shorter;
      try {
        body = await fetchPage();
      } catch (e2) {
        throw e2 instanceof VercelUnavailable ? e : e2;
      }
      coveredSince = start;
      partial = "Vercel no respondió para la ventana completa: se cubrió solo el tramo más reciente";
    }
    const batch = Array.isArray(body?.rows) ? body.rows : [];
    hasMore = Boolean(body?.hasMoreRows);
    let oldest = Infinity;
    let fresh = 0;
    for (const r of batch) {
      const t = Date.parse(r?.timestamp);
      if (Number.isFinite(t)) oldest = Math.min(oldest, t);
      const k = `${r?.requestId}|${r?.timestamp}`;
      if (seen.has(k)) continue;
      seen.add(k);
      fresh++;
      rows.push(r);
    }
    if (!hasMore || fresh === 0 || !Number.isFinite(oldest)) break;
    end = oldest - 1;
    if (end <= start) { hasMore = false; break; }
  }
  const moreInWindow = hasMore || rows.length > maxRows; // quedan filas dentro del tramo que sí se consultó
  return { rows: rows.slice(0, maxRows), hasMore: moreInWindow || Boolean(partial), moreInWindow, partial, coveredSince };
}

function windowOf(args, defSince) {
  const now = Date.now();
  const startMs = parseTime(args.since ?? defSince, now);
  const endMs = args.until === undefined || args.until === null || args.until === "" ? now : parseTime(args.until, now);
  if (!(startMs < endMs)) throw new VercelError("ventana inválida: 'since' tiene que ser anterior a 'until'.");
  return { startMs, endMs, since: new Date(startMs).toISOString(), until: new Date(endMs).toISOString() };
}

function envFilter(v, def = "production") {
  const e = String(v ?? def).trim().toLowerCase();
  if (e === "all" || e === "") return undefined;
  if (e !== "production" && e !== "preview") throw new VercelError("environment inválido (production | preview | all).");
  return e;
}

// Un deployment solo se toca si pertenece a un proyecto pineado en esta corrida.
async function getPinnedDeployment(deploymentId, deadline) {
  const id = String(deploymentId || "").trim();
  if (!DEPLOYMENT_ID_RE.test(id)) throw new VercelError("deploymentId inválido: tiene que ser un id dpl_... (sácalo de vercel_deployments).");
  const d = await vget("api", `/v13/deployments/${id}`, { teamId: teamId || undefined }, { deadline });
  if (!isAllowedProjectId(d?.projectId, PROJECTS)) {
    throw new VercelError("ese deployment pertenece a un proyecto de Vercel fuera del alcance de esta corrida.");
  }
  return d;
}

const projectArg = {
  type: "string",
  description: "Proyecto de Vercel de esta corrida, por key (ej. 'site') o id prj_... Sin valor = el primero. Lista: vercel_projects.",
};
const sinceArg = (def) => ({
  type: "string",
  description: `Inicio de la ventana: relativo ("30m", "6h", "1d") o fecha ISO. Default "${def}". Retención de runtime ~24 h.`,
});
const untilArg = { type: "string", description: "Fin de la ventana (relativo o ISO). Default: ahora." };

const TOOLS = [
  {
    name: "vercel_projects",
    description:
      "Vercel (solo lectura) — qué proyectos de Vercel puede leer esta corrida y cómo están: último deploy de producción " +
      "(estado, fecha, commit) y último deploy FALLIDO de los últimos 7 días. Úsalo primero: es el chequeo barato de que la fuente responde.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "vercel_deployments",
    description:
      "Vercel (solo lectura) — lista deployments de un proyecto, lo más nuevo primero: estado (READY/ERROR/BUILDING…), target " +
      "(production/preview), fecha, rama y commit. Para '¿qué se deployó y cuándo?', '¿falló algún build esta semana?' " +
      "(state: 'ERROR') o encontrar el preview de una rama. Tiene historial (no depende de la retención de logs).",
    inputSchema: {
      type: "object",
      properties: {
        project: projectArg,
        target: { type: "string", enum: ["production", "preview", "all"], description: "Default 'all'." },
        state: { type: "string", enum: DEPLOYMENT_STATES, description: "Filtrar por estado. 'ERROR' = builds fallidos." },
        branch: { type: "string", description: "Solo deployments de esta rama de git (match exacto)." },
        since: { type: "string", description: 'Solo deployments creados desde ese instante: relativo ("7d") o ISO.' },
        limit: { type: "number", description: "Default 10, máximo 30." },
      },
    },
  },
  {
    name: "vercel_build_logs",
    description:
      "Vercel (solo lectura) — estado de UN deployment (error, alias, crons registrados) + las últimas líneas de su log de build. " +
      "Para diagnosticar un build fallido o confirmar que un preview buildeó. onlyErrors=true deja solo stderr y líneas con error/warning.",
    inputSchema: {
      type: "object",
      properties: {
        deploymentId: { type: "string", description: "Id dpl_... (de vercel_deployments)." },
        onlyErrors: { type: "boolean", description: "Solo stderr + líneas con error/warning. Default false." },
        limit: { type: "number", description: "Líneas a devolver (las últimas). Default 120, máximo 400." },
      },
      required: ["deploymentId"],
    },
  },
  {
    name: "vercel_logs_summary",
    description:
      "Vercel (solo lectura) — resumen de errores de RUNTIME de un proyecto en una ventana: requests con 5xx y requests cuyos logs " +
      "traen nivel error/fatal, AGRUPADOS por status + ruta + mensaje, con conteo, primera/última vez y un requestId de muestra. " +
      "Es el punto de partida de un review de logs. No cuenta tráfico total (solo lo que falló). Mira siempre `complete`: si es " +
      "false, `coverage` dice qué consulta falló o qué tramo cubrió, y el resumen NO vale como 'sin errores' para el resto. " +
      SLOW_NOTE + RETENTION_NOTE,
    inputSchema: {
      type: "object",
      properties: {
        project: projectArg,
        since: sinceArg("24h"),
        until: untilArg,
        environment: { type: "string", enum: ["production", "preview", "all"], description: "Default 'production'." },
        include4xx: { type: "boolean", description: "Sumar requests 4xx (ruidoso: 401/404 de bots). Default false." },
        includeWarnings: { type: "boolean", description: "Sumar requests con logs de nivel warn. Default false." },
      },
    },
  },
  {
    name: "vercel_request_logs",
    description:
      "Vercel (solo lectura) — filas de logs de runtime (un request por fila, con sus líneas de console/errores), lo más nuevo " +
      "primero. Filtra SIEMPRE (level, statusCode, search, requestId o deploymentId): sin filtro devuelve tráfico normal. " +
      "search busca texto (ej. '/api/cron' para ver si corrió un cron, o un mensaje de error). Los mensajes vienen redactados " +
      "(emails/tokens/IPs) y los paths sin query string. Si hasMore=true, repite con until=nextUntil. " + SLOW_NOTE + RETENTION_NOTE,
    inputSchema: {
      type: "object",
      properties: {
        project: projectArg,
        since: sinceArg("1h"),
        until: untilArg,
        level: {
          type: "array",
          items: { type: "string", enum: [...LOG_LEVELS, "warning"] },
          description: "Solo requests con logs de estos niveles (y solo esas líneas).",
        },
        statusCode: { type: "string", description: 'Status HTTP exacto o familia: "500", "404", "5xx", "4xx".' },
        environment: { type: "string", enum: ["production", "preview", "all"], description: "Default 'production'." },
        search: { type: "string", description: "Texto a buscar en el request/logs (ej. '/api/cron/rescore', 'TypeError')." },
        deploymentId: { type: "string", description: "Solo requests servidos por este deployment (dpl_...)." },
        requestId: { type: "string", description: "Un request puntual (de vercel_logs_summary o de un header x-vercel-id)." },
        limit: { type: "number", description: "Filas. Default 20, máximo 100." },
        expand: { type: "boolean", description: "Mensajes largos completos (stack traces). Default false." },
      },
    },
  },
];

function ok(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 1) }] };
}
function fail(msg) {
  return { isError: true, content: [{ type: "text", text: `[mcp-vercel] ${msg}` }] };
}

async function toolProjects(_args, deadline) {
  if (PROJECTS.size === 0) resolveProject(undefined, PROJECTS); // tira "no configurada"
  const out = [];
  const weekAgo = Date.now() - 7 * 86400e3;
  for (const [key, id] of PROJECTS) {
    const entry = { key, id };
    try {
      const prod = await vget("api", "/v6/deployments", { projectId: id, teamId: teamId || undefined, target: "production", limit: 1 }, { deadline });
      const bad = await vget("api", "/v6/deployments", { projectId: id, teamId: teamId || undefined, state: "ERROR", since: weekAgo, limit: 1 }, { deadline });
      const p = prod?.deployments?.[0];
      entry.name = p?.name;
      entry.lastProduction = p ? pickDeployment(p) : null;
      entry.lastFailed7d = bad?.deployments?.[0] ? pickDeployment(bad.deployments[0]) : null;
    } catch (e) {
      entry.error = e instanceof VercelError ? e.message : "error inesperado";
    }
    out.push(entry);
  }
  return ok({ readOnly: true, projects: out, note: RETENTION_NOTE });
}

async function toolDeployments(args, deadline) {
  const p = resolveProject(args.project, PROJECTS);
  const limit = clampInt(args.limit, 10, 1, 30);
  const target = String(args.target || "all").toLowerCase();
  if (!["production", "preview", "all"].includes(target)) throw new VercelError("target inválido (production | preview | all).");
  const state = args.state ? String(args.state).toUpperCase() : undefined;
  if (state && !DEPLOYMENT_STATES.includes(state)) throw new VercelError(`state inválido (${DEPLOYMENT_STATES.join(" | ")}).`);
  const branch = args.branch ? String(args.branch).trim() : "";
  const body = await vget("api", "/v6/deployments", {
    projectId: p.id,
    teamId: teamId || undefined,
    limit: branch ? 100 : limit,
    target: target === "all" ? undefined : target,
    state,
    since: args.since ? parseTime(args.since) : undefined,
  }, { deadline });
  let list = Array.isArray(body?.deployments) ? body.deployments : [];
  if (branch) list = list.filter((d) => d?.meta?.githubCommitRef === branch);
  return ok({ project: p.key, count: Math.min(list.length, limit), deployments: list.slice(0, limit).map(pickDeployment) });
}

async function toolBuildLogs(args, deadline) {
  if (PROJECTS.size === 0) resolveProject(undefined, PROJECTS);
  const d = await getPinnedDeployment(args.deploymentId, deadline);
  const limit = clampInt(args.limit, 120, 1, 400);
  const onlyErrors = Boolean(args.onlyErrors);
  const events = await vget(
    "api",
    `/v3/deployments/${d.id}/events`,
    { teamId: teamId || undefined, builds: 1, direction: "backward", limit: onlyErrors ? 2000 : limit },
    { timeoutMs: 30000, deadline }
  );
  let list = (Array.isArray(events) ? events : []).filter((e) => typeof (e?.text ?? e?.payload?.text) === "string");
  list.sort((a, b) => (a.created || 0) - (b.created || 0) || (a.serial || "").localeCompare(b.serial || ""));
  const total = list.length;
  if (onlyErrors) list = list.filter(looksLikeBuildProblem);
  const lines = list.slice(-limit).map((e) => pickBuildLine(e));
  return ok({
    deployment: pickDeploymentDetail(d),
    onlyErrors,
    lineCount: lines.length,
    note: onlyErrors ? `${list.length} líneas con señal de problema sobre las últimas ${total} del build.` : `Últimas ${lines.length} líneas del build.`,
    lines,
  });
}

async function toolLogsSummary(args, deadline) {
  const p = resolveProject(args.project, PROJECTS);
  const w = windowOf(args, "24h");
  const environment = envFilter(args.environment);
  const queries = [
    { name: "5xx", filters: { statusCode: "5xx" } },
    { name: "error-logs", filters: { level: "error,fatal" } },
  ];
  if (args.include4xx) queries.push({ name: "4xx", filters: { statusCode: "4xx" } });
  if (args.includeWarnings) queries.push({ name: "warn-logs", filters: { level: "warn" } });

  // Las consultas van EN PARALELO: cada una usa el tiempo completo de la llamada en vez de
  // repartírselo (una búsqueda de 24 h puede tardar ~20 s y son 2 a 4).
  const settled = await Promise.all(
    queries.map(async (q) => {
      try {
        return { q, r: await fetchRequestLogs({ projectId: p.id, startMs: w.startMs, endMs: w.endMs, filters: { ...q.filters, environment }, maxRows: PAGE_CAP * 50, deadline }) };
      } catch (e) {
        // Config, pin, 401/403 o ventana fuera de retención fallan igual para todas: se propagan.
        // Solo "Vercel no contestó" se anota por consulta, para no perder lo que sí respondió.
        if (!(e instanceof VercelUnavailable)) throw e;
        return { q, e };
      }
    })
  );
  const rows = new Map();
  const coverage = [];
  for (const { q, r, e } of settled) {
    if (e) { coverage.push({ query: q.name, rows: 0, failed: e.message }); continue; }
    coverage.push({
      query: q.name,
      rows: r.rows.length,
      truncated: r.hasMore,
      ...(r.partial ? { partial: r.partial } : {}),
      ...(r.coveredSince ? { coveredSince: new Date(r.coveredSince).toISOString() } : {}),
    });
    for (const row of r.rows) rows.set(`${row.requestId}|${row.timestamp}`, row);
  }
  // Si no respondió NINGUNA, no hay resumen: un objeto con ceros se leería como "sin errores".
  if (coverage.every((c) => c.failed)) throw settled[0].e;
  const failedQueries = coverage.filter((c) => c.failed).map((c) => c.query);
  const partialQueries = coverage.filter((c) => c.partial).map((c) => c.query);
  const shrunk = coverage.filter((c) => c.coveredSince);

  const groups = new Map();
  const byStatus = {};
  let crashes = 0;
  for (const row of rows.values()) {
    const sig = errorSignature(row);
    const route = cleanPath(row.route || row.requestPath);
    const key = [row.statusCode, row.requestMethod, route, row.errorCode || "", sig.key].join("|");
    byStatus[row.statusCode] = (byStatus[row.statusCode] || 0) + 1;
    if (row.hasFunctionCrashed) crashes++;
    let g = groups.get(key);
    if (!g) {
      g = { count: 0, status: row.statusCode, method: row.requestMethod, route, errorCode: row.errorCode || undefined, level: sig.level, message: sig.message || undefined, firstSeen: row.timestamp, lastSeen: row.timestamp, sampleRequestId: row.requestId, deployments: [] };
      groups.set(key, g);
    }
    g.count++;
    if (row.timestamp < g.firstSeen) g.firstSeen = row.timestamp;
    if (row.timestamp > g.lastSeen) { g.lastSeen = row.timestamp; g.sampleRequestId = row.requestId; }
    if (row.deploymentId && !g.deployments.includes(row.deploymentId) && g.deployments.length < 3) g.deployments.push(row.deploymentId);
  }
  const sorted = [...groups.values()].sort((a, b) => b.count - a.count || (a.lastSeen < b.lastSeen ? 1 : -1));
  return ok({
    project: p.key,
    window: { since: w.since, until: w.until },
    environment: environment || "all",
    complete: failedQueries.length === 0 && partialQueries.length === 0,
    requestsWithProblems: rows.size,
    functionCrashes: crashes,
    byStatus,
    groupCount: sorted.length,
    groups: sorted.slice(0, 25),
    coverage,
    note:
      (failedQueries.length ? `ATENCIÓN — resumen INCOMPLETO: Vercel no respondió la consulta ${failedQueries.join(", ")}. En esa parte NO es "sin errores": reintenta UNA vez con una ventana más chica y, si sigue, decláralo. ` : "") +
      (shrunk.length ? `ATENCIÓN — Vercel no respondió para la ventana completa: ${shrunk.map((c) => `${c.query} cubre solo desde ${c.coveredSince}`).join("; ")}. Lo anterior quedó SIN mirar: repite vercel_logs_summary con until igual a ese instante, y di en el reporte qué tramo cubriste. ` : "") +
      (partialQueries.length > shrunk.length ? `La consulta ${partialQueries.filter((n) => !shrunk.some((c) => c.query === n)).join(", ")} se cortó antes de recorrer toda la ventana: cubre lo más reciente. ` : "") +
      (coverage.some((c) => c.truncated) ? "Alguna consulta llegó al tope de filas: los conteos son un PISO, no el total. Acota la ventana para contar exacto. " : "") +
      "Detalle de un grupo: vercel_request_logs con requestId o con search + statusCode. " + RETENTION_NOTE,
  });
}

async function toolRequestLogs(args, deadline) {
  const p = resolveProject(args.project, PROJECTS);
  const w = windowOf(args, "1h");
  const levels = normLevels(args.level);
  const statusCode = normStatus(args.statusCode);
  const environment = envFilter(args.environment);
  const limit = clampInt(args.limit, 20, 1, 100);
  const expand = Boolean(args.expand);
  let deploymentId;
  if (args.deploymentId) deploymentId = (await getPinnedDeployment(args.deploymentId, deadline)).id;
  let requestId;
  if (args.requestId) {
    requestId = String(args.requestId).trim();
    if (!REQUEST_ID_RE.test(requestId)) throw new VercelError("requestId inválido.");
  }
  const search = args.search ? String(args.search).trim().slice(0, 200) : undefined;

  const r = await fetchRequestLogs({
    projectId: p.id,
    startMs: w.startMs,
    endMs: w.endMs,
    filters: { level: levels.length ? levels.join(",") : undefined, statusCode: statusCode || undefined, environment, deploymentId, requestId, search },
    maxRows: limit,
    deadline,
  });

  const out = [];
  let used = 0;
  let cut = false;
  for (const row of r.rows) {
    const picked = pickLogRow(row, { maxMsg: expand ? 3000 : 500, maxLines: expand ? 60 : 20, levels });
    const size = JSON.stringify(picked).length;
    if (out.length > 0 && used + size > OUTPUT_BUDGET) { cut = true; break; }
    used += size;
    out.push(picked);
  }
  // Para seguir: si quedan filas en el tramo consultado, desde la más vieja devuelta; si el tramo
  // se leyó entero pero era más corto que lo pedido, desde donde arranca lo que quedó sin mirar.
  const moreInWindow = r.moreInWindow || cut || Boolean(r.partial && !r.coveredSince);
  const hasMore = moreInWindow || Boolean(r.coveredSince);
  const oldest = out.length ? Date.parse(out[out.length - 1].ts) : NaN;
  const next = moreInWindow && Number.isFinite(oldest) ? oldest - 1 : r.coveredSince ? r.coveredSince - 1 : undefined;
  const coveredSince = r.coveredSince ? new Date(r.coveredSince).toISOString() : undefined;
  const unfiltered = !levels.length && !statusCode && !search && !requestId && !deploymentId;
  return ok({
    project: p.key,
    window: { since: w.since, until: w.until },
    filters: { level: levels, statusCode: statusCode || undefined, environment: environment || "all", search, deploymentId, requestId },
    count: out.length,
    hasMore,
    partial: r.partial,
    coveredSince,
    nextUntil: hasMore && next ? new Date(next).toISOString() : undefined,
    rows: out,
    note:
      (coveredSince ? `ATENCIÓN — Vercel no respondió para la ventana completa: estas filas cubren solo desde ${coveredSince}. Lo anterior quedó SIN mirar: sigue con until=nextUntil. ` : r.partial ? `Resultado PARCIAL (${r.partial}): hay más filas en la ventana; sigue con until=nextUntil o acota los filtros. ` : "") +
      (unfiltered ? "Sin filtros: esto es tráfico normal, lo más reciente. Para errores usa level/statusCode o vercel_logs_summary. " : "") +
      RETENTION_NOTE,
  });
}

const HANDLERS = {
  vercel_projects: toolProjects,
  vercel_deployments: toolDeployments,
  vercel_build_logs: toolBuildLogs,
  vercel_logs_summary: toolLogsSummary,
  vercel_request_logs: toolRequestLogs,
};

const server = new Server({ name: "vercel", version: "0.1.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  const handler = HANDLERS[name];
  if (!handler) return fail(`tool desconocida: ${name}`);
  try {
    return await handler(args || {}, newDeadline());
  } catch (e) {
    // Los mensajes propios (VercelError / guard) son seguros de mostrar; cualquier otra cosa se
    // reduce al nombre del error para no filtrar URLs ni headers en un stack.
    const known = e instanceof VercelError || /^(fuente Vercel|proyecto '|tiempo |nivel |statusCode )/.test(String(e?.message || ""));
    return fail(`${name} falló: ${known ? e.message : `error inesperado (${e?.name || "Error"})`}`);
  }
});

await server.connect(new StdioServerTransport());
