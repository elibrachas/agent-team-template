// Guard de SQL del MCP mysql (read-only). Capa 3 de 3 — la que MANDA es la capa 1 (el usuario
// de MySQL con GRANT SELECT acotado). Esto es defensa en profundidad y, sobre todo, un freno
// para que un agente no pegue PII o secretos en un thread de Linear por accidente.
//
// Reglas:
//   - UNA sola sentencia, y de lectura: SELECT / WITH / SHOW / DESCRIBE / DESC / EXPLAIN.
//   - Nada de keywords de escritura/DDL/sesión ni funciones peligrosas (INTO OUTFILE, SLEEP...).
//   - Nada de `SELECT *` ni `alias.*` (obliga a nombrar columnas → no se cuelan secretos).
//   - Nada de columnas de la denylist (secretos + PII). El match es por NOMBRE de columna,
//     sin mirar la tabla: por eso la lista es de nombres inequívocos (email, password...).

// `name` NO está: un `companies.name` (o similar) puede hacer falta para excluir las cuentas de
// test. Los nombres de PERSONAS (users.name y parecidas) los corta la capa 1 (GRANT por columna).
// Las columnas propias de tu schema se suman con MYSQL_DENY_COLUMNS (csv) sin tocar este archivo.
export const DEFAULT_DENY_COLUMNS = [
  // secretos (nombres típicos de una app con usuarios, instancias, invitaciones y webhooks)
  "password", "pending_password", "remember_token", "two_factor_secret", "two_factor_recovery_codes",
  "db_password", "redis_password", "app_key", "storage_secret", "pending_admin_password",
  "platform_control_token", "token", "token_hash", "code_hash", "api_key", "secret",
  "client_secret", "webhook_secret",
  // PII directa (o re-identificable)
  "email", "email_canonical", "email_hash", "pending_email", "previous_email", "billing_email",
  "admin_email", "admin_name", "recipient", "pm_last_four", "phone",
  "ip", "ip_address", "ip_prefix", "signup_ip", "signup_ip_prefix", "user_agent_hash",
  "original_name", "share_url",
];

const READ_START = /^(select|with|show|describe|desc|explain)\b/i;

// Palabras que no tienen nada que hacer en una consulta de lectura (se matchean como TOKEN
// completo, así `updated_at` o `created_at` no disparan `update`/`create`).
const FORBIDDEN_TOKENS = new Set([
  // (REPLACE queda afuera: REPLACE() es una función de string legítima en un SELECT, y
  // REPLACE INTO ya lo frena READ_START porque una sentencia de escritura no arranca con SELECT.)
  "insert", "update", "delete",
  "drop", "alter", "create", "truncate", "rename",
  "grant", "revoke", "set", "call", "do", "handler", "lock", "unlock",
  "load", "load_file", "outfile", "dumpfile", "sleep", "benchmark", "get_lock",
  "release_lock", "prepare", "execute", "deallocate", "kill", "shutdown",
]);

// Marca que deja stripSql donde había un comentario EJECUTABLE de MySQL (`/*! ... */` o
// hint `/*+ ... */`): MySQL corre su contenido, así que no se puede borrar y validar el resto
// — checkReadOnlySql lo rechaza de plano.
const EXEC_COMMENT_MARK = "__executable_comment__";

// Saca comentarios y literales (strings) para que el análisis de tokens no se confunda con
// valores como 'email.delivered' o '-- algo'. Los identificadores con backticks se conservan
// SIN los backticks (así `email` bloquea igual que email). Sigue las reglas de MySQL:
// `--` es comentario SOLO si lo sigue un espacio/control (`1 --1` es aritmética, no comentario).
export function stripSql(sql) {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];
    const after = sql[i + 2];
    if (c === "-" && next === "-" && (after === undefined || /[\s\x00-\x1f]/.test(after))) {
      while (i < n && sql[i] !== "\n") i++; out += " "; continue;
    }
    if (c === "#") { while (i < n && sql[i] !== "\n") i++; out += " "; continue; }
    if (c === "/" && next === "*") {
      const executable = after === "!" || after === "+";
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2; out += executable ? ` ${EXEC_COMMENT_MARK} ` : " "; continue;
    }
    if (c === "'" || c === '"') {
      const q = c; i++;
      while (i < n) {
        if (sql[i] === "\\") { i += 2; continue; }
        if (sql[i] === q && sql[i + 1] === q) { i += 2; continue; }
        if (sql[i] === q) { i++; break; }
        i++;
      }
      out += " '' "; continue;
    }
    if (c === "`") {
      const end = sql.indexOf("`", i + 1);
      out += " " + sql.slice(i + 1, end === -1 ? n : end) + " ";
      i = end === -1 ? n : end + 1; continue;
    }
    out += c; i++;
  }
  return out;
}

export function checkReadOnlySql(sql, denyColumns = DEFAULT_DENY_COLUMNS) {
  if (typeof sql !== "string" || !sql.trim()) return { ok: false, reason: "SQL vacío." };
  const stripped = stripSql(sql).trim().replace(/;\s*$/, "");
  if (stripped.includes(EXEC_COMMENT_MARK)) {
    return { ok: false, reason: "Comentarios ejecutables de MySQL (/*! ... */ o hints /*+ ... */) no están permitidos." };
  }
  if (stripped.includes(";")) {
    return { ok: false, reason: "Una sola sentencia por llamada (sin ';' intermedios)." };
  }
  if (!READ_START.test(stripped)) {
    return { ok: false, reason: "Solo lectura: la sentencia tiene que empezar con SELECT, WITH, SHOW, DESCRIBE o EXPLAIN." };
  }
  const tokens = stripped.toLowerCase().match(/[a-z_][a-z0-9_$]*/g) || [];
  for (const t of tokens) {
    if (FORBIDDEN_TOKENS.has(t)) {
      return { ok: false, reason: `Keyword no permitida en modo read-only: '${t.toUpperCase()}'.` };
    }
  }
  if (/\binto\b/i.test(stripped)) {
    return { ok: false, reason: "SELECT ... INTO no está permitido." };
  }
  if (/\bfor\s+share\b|\block\s+in\s+share\s+mode\b/i.test(stripped)) {
    return { ok: false, reason: "Lecturas con lock no están permitidas." };
  }
  // SELECT * / DISTINCT * / alias.* (count(*) sí vale: el '*' va entre paréntesis)
  if (/\bselect\s+(all\s+|distinct\s+|distinctrow\s+)?\*/i.test(stripped) ||
      /,\s*\*/.test(stripped) || /[a-z0-9_$]\s*\.\s*\*/i.test(stripped)) {
    return { ok: false, reason: "Nombra las columnas explícitamente (SELECT * y alias.* están bloqueados para que no se filtren secretos/PII)." };
  }
  const deny = new Set(denyColumns.map((c) => c.toLowerCase()));
  const hits = [...new Set(tokens.filter((t) => deny.has(t)))];
  if (hits.length) {
    return {
      ok: false,
      reason: `Columna(s) bloqueada(s) por secreto/PII: ${hits.join(", ")}. Trabaja con ids y agregados (count, count distinct por id, fechas).`,
    };
  }
  // Se ejecuta el SQL ORIGINAL (con sus literales), no el `stripped` (que los vació).
  return { ok: true, sql: sql.trim().replace(/;\s*$/, "") };
}
