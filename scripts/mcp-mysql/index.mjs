#!/usr/bin/env node
// MCP server: MySQL READ-ONLY para el equipo de agentes.
// Para productos cuya base de la app es MySQL (además de, o en vez de, Supabase) — típicamente
// donde vive el funnel real: registro → cuenta → activación → pago.
// Lo usan Numa (data), Greta (growth) y Pico (product), siempre read-only y solo con agregados.
//
// Tools:
//   - mysql_query   → UNA sentencia de lectura (SELECT/WITH/SHOW/DESCRIBE/EXPLAIN); devuelve filas (con tope)
//   - mysql_schema  → tablas + columnas (information_schema), marcando las bloqueadas por secreto/PII
//
// Defensa en profundidad (3 capas):
//   1. El USUARIO de MySQL es read-only (GRANT SELECT acotado, sin columnas secretas) — la capa que manda.
//      SQL de alta (usuario + GRANTs por columna) en docs/mysql-readonly-source.md.
//   2. La sesión: SET SESSION TRANSACTION READ ONLY + MAX_EXECUTION_TIME.
//   3. guard.mjs: una sola sentencia, solo lectura, sin SELECT *, sin columnas de secreto/PII.
//
// Env (de .env.<slug>, NUNCA inline en el .mcp.json):
//   MYSQL_HOST, MYSQL_PORT (default 3306), MYSQL_DATABASE, MYSQL_USER, MYSQL_PASSWORD
//   MYSQL_ROW_LIMIT (default 500), MYSQL_TIMEOUT_MS (default 15000)
//   MYSQL_DENY_COLUMNS (opcional, csv) — columnas extra a bloquear además de las default
//
// Red: la DB no publica puerto a internet. El server de agentes llega por un túnel SSH
// (MYSQL_HOST=127.0.0.1 + MYSQL_PORT local del túnel; scripts\db-tunnel.ps1 lo arma y lo
// mantiene) — ver docs/mysql-readonly-source.md.
//
// Lanza con: node scripts/mcp-mysql/index.mjs   (el cliente MCP se conecta por stdio).

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import mysql from "mysql2/promise";
import { checkReadOnlySql, DEFAULT_DENY_COLUMNS } from "./guard.mjs";

const cfg = {
  host: process.env.MYSQL_HOST || "",
  port: Number(process.env.MYSQL_PORT || 3306),
  database: process.env.MYSQL_DATABASE || "",
  user: process.env.MYSQL_USER || "",
  password: process.env.MYSQL_PASSWORD || "",
};
const ROW_LIMIT = Math.max(1, Number(process.env.MYSQL_ROW_LIMIT || 500));
const TIMEOUT_MS = Math.max(1000, Number(process.env.MYSQL_TIMEOUT_MS || 15000));
const DENY = [
  ...DEFAULT_DENY_COLUMNS,
  ...(process.env.MYSQL_DENY_COLUMNS || "").split(",").map((s) => s.trim()).filter(Boolean),
];

// Sin config no abortamos el proceso: el MCP levanta y cada tool devuelve un error claro.
// Así la corrida del agente DEGRADA ("fuente no activa") en vez de romperse al arrancar.
const missing = ["host", "database", "user"].filter((k) => !cfg[k]);

let conn = null;

// La conexión se cierra sola tras IDLE_CLOSE_MS sin uso. Motivo: el usuario de agentes puede
// tener un cupo chico de conexiones (p. ej. MAX_USER_CONNECTIONS 2) y un MCP vive todo lo que
// dura la corrida del agente — sin esto, dos agentes a la vez agotan el cupo.
const IDLE_CLOSE_MS = Math.max(1000, Number(process.env.MYSQL_IDLE_CLOSE_MS || 10000));
let idleTimer = null;
function cancelIdleClose() { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } }
function scheduleIdleClose() {
  cancelIdleClose();
  idleTimer = setTimeout(() => {
    const c = conn;
    conn = null;
    if (c) c.end().catch(() => { /* ya cerrada */ });
  }, IDLE_CLOSE_MS);
  idleTimer.unref?.();
}

// Errores frecuentes → mensaje accionable para el agente (y para quien lea el reporte).
function explain(e) {
  const code = String(e?.code || "");
  const msg = String(e?.message || e);
  if (code === "ECONNREFUSED" || code === "ETIMEDOUT" || /ECONNREFUSED|connect ETIMEDOUT/.test(msg)) {
    return `no conecta a ${cfg.host}:${cfg.port} — si es un túnel SSH (scripts\\db-tunnel.ps1 -Project <slug> -Action status), está caído o no levantado. Declarar la fuente como no disponible; no reintentar en loop. (${msg})`;
  }
  if (code === "ER_TOO_MANY_USER_CONNECTIONS" || /max_user_connections/i.test(msg)) {
    return `el usuario de agentes llegó a su tope de conexiones simultáneas (otro agente está consultando). Reintenta UNA vez en ~1 minuto; si sigue, decláralo. (${msg})`;
  }
  if (code === "ER_COLUMNACCESS_DENIED_ERROR" || code === "ER_TABLEACCESS_DENIED_ERROR" || /command denied/i.test(msg)) {
    return `permiso denegado a propósito: esa tabla/columna está fuera del GRANT del usuario de agentes (lista vigente en el data-model del proyecto). No lo esquives con otra variante: usa solo columnas permitidas o di que el dato no es accesible. (${msg})`;
  }
  if (code === "ER_ACCESS_DENIED_ERROR") {
    return `usuario/password rechazados por MySQL (revisar MYSQL_USER/MYSQL_PASSWORD del .env del proyecto). (${msg})`;
  }
  return msg;
}

async function getConn() {
  cancelIdleClose();
  if (missing.length) {
    throw new Error(
      `fuente MySQL no configurada (faltan MYSQL_${missing.map((m) => m.toUpperCase()).join(", MYSQL_")} en el .env del proyecto)`
    );
  }
  if (conn) return conn;
  conn = await mysql.createConnection({
    ...cfg,
    connectTimeout: 10000,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    multipleStatements: false,
  });
  conn.on("error", () => { conn = null; });
  await conn.query("SET SESSION TRANSACTION READ ONLY");
  await conn.query(`SET SESSION MAX_EXECUTION_TIME = ${Math.floor(TIMEOUT_MS)}`);
  // Tope de filas del lado del SERVIDOR: el SELECT de nivel superior devuelve como mucho
  // ROW_LIMIT+1 filas (no afecta subqueries/CTEs, así que los agregados no cambian). Un LIMIT
  // explícito en la query le gana — por eso además el stream de runQuery corta en el cliente.
  await conn.query(`SET SESSION sql_select_limit = ${ROW_LIMIT + 1}`);
  return conn;
}

// Corre la query en STREAMING y deja de leer al pasar el tope: el resultado nunca se bufferea
// completo en memoria (un slice después de leer todo llega tarde). Si se pasa del
// tope, se corta la conexión (MySQL aborta la query al no poder escribir) y la próxima llamada
// reconecta.
function runQuery(sql) {
  return getConn().then((c) => new Promise((resolve, reject) => {
    const rows = [];
    let fields = [];
    let settled = false;
    const finish = (fn, v) => { if (!settled) { settled = true; fn(v); } };
    const q = c.connection.query({ sql, timeout: TIMEOUT_MS + 2000 });
    q.on("fields", (f) => { fields = f || []; });
    q.on("result", (row) => {
      if (settled) return;
      if (rows.length < ROW_LIMIT) { rows.push(row); return; }
      try { c.connection.destroy(); } catch { /* ya cerrada */ }
      conn = null;
      finish(resolve, { rows, fields, truncated: true });
    });
    q.on("error", (e) => {
      // conexión caída / timeout del driver → forzar reconexión en la próxima llamada
      if (/closed|PROTOCOL_|ECONNRESET|timeout/i.test(String(e?.code || e?.message))) conn = null;
      finish(reject, e);
    });
    q.on("end", () => finish(resolve, { rows, fields, truncated: false }));
  }));
}

function ok(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] };
}
function fail(msg) {
  return { isError: true, content: [{ type: "text", text: `[mcp-mysql] ${msg}` }] };
}

const server = new Server(
  { name: "mysql", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "mysql_query",
      description:
        "Corre UNA sentencia de LECTURA (SELECT/WITH/SHOW/DESCRIBE/EXPLAIN) contra la DB MySQL del proyecto y devuelve las filas " +
        `(tope ${ROW_LIMIT}; si se trunca, 'truncated: true'). Nombra las columnas (SELECT * está bloqueado) y trabaja con ids y ` +
        "agregados: las columnas de secretos/PII (email, password, tokens, ip...) están bloqueadas. Prefiere agregar en SQL (count, sum, group by) antes que traer filas.",
      inputSchema: {
        type: "object",
        properties: { sql: { type: "string", description: "Una sola sentencia de lectura." } },
        required: ["sql"],
      },
    },
    {
      name: "mysql_schema",
      description:
        "Lista tablas y columnas de la DB del proyecto (information_schema), con tipo y si la columna está bloqueada por secreto/PII. " +
        "Úsalo antes de escribir una query sobre una tabla que no conoces. Filtro opcional por tabla.",
      inputSchema: {
        type: "object",
        properties: { table: { type: "string", description: "Nombre exacto de una tabla (opcional)." } },
      },
    },
  ],
}));

// Las llamadas a tools se SERIALIZAN: una conexión compartida, una consulta a la vez. Sin esto,
// si dos llamadas se superponen, la primera en terminar programa el cierre por inactividad con
// la otra todavía corriendo → se abre una 2ª conexión (justo lo que un cupo chico de conexiones
// no soporta), y el corte por tope de filas de una puede matar la consulta de la otra.
// Serializado, el timer solo corre sin nada en vuelo y cada llamada lo cancela al empezar.
let lock = Promise.resolve();
function withLock(fn) {
  const run = lock.then(fn, fn);
  lock = run.catch(() => { /* el error ya lo recibe quien llamó */ });
  return run;
}

server.setRequestHandler(CallToolRequestSchema, (req) => withLock(() => handleTool(req)));

async function handleTool(req) {
  const { name, arguments: args = {} } = req.params;
  try {
    if (name === "mysql_query") {
      const check = checkReadOnlySql(args.sql, DENY);
      if (!check.ok) return fail(`query rechazada: ${check.reason}`);
      const { rows, fields, truncated } = await runQuery(check.sql);
      return ok({
        columns: (fields || []).map((f) => f.name),
        row_count: rows.length,
        truncated,
        rows,
      });
    }
    if (name === "mysql_schema") {
      const deny = new Set(DENY.map((d) => d.toLowerCase()));
      const params = [cfg.database];
      let where = "table_schema = ?";
      if (args.table) { where += " AND table_name = ?"; params.push(String(args.table)); }
      const c = await getConn();
      const [rows] = await c.query(
        `SELECT table_name AS t, column_name AS c, column_type AS type, is_nullable AS nullable
           FROM information_schema.columns WHERE ${where}
           ORDER BY table_name, ordinal_position
           LIMIT 10000`,   // LIMIT explícito: si no, sql_select_limit (el tope de filas) cortaría el listado
        params
      );
      const tables = {};
      for (const r of rows) {
        (tables[r.t] ||= []).push({
          column: r.c, type: r.type, nullable: r.nullable === "YES",
          ...(deny.has(String(r.c).toLowerCase()) ? { blocked: "secreto/PII — no consultable" } : {}),
        });
      }
      return ok({ database: cfg.database, tables });
    }
    return fail(`tool desconocida: ${name}`);
  } catch (e) {
    return fail(`${name} falló: ${explain(e)}`);
  } finally {
    if (conn) scheduleIdleClose();
  }
}

await server.connect(new StdioServerTransport());
