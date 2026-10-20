// Test del tope de tiempo y del achique de ventana de las tools de logs. SIN red: levanta
// index.mjs con un fetch de mentira (test-mock-fetch.mjs) y lo maneja como cliente MCP.
//   node budget.test.mjs     (necesita `npm ci`: usa el SDK de MCP)
//
// Qué protege: que una búsqueda de logs lenta o caída del lado de Vercel NUNCA deje a un agente
// colgado, y que lo que vuelva diga honestamente qué tramo de la ventana quedó cubierto.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = (f) => fileURLToPath(new URL(f, import.meta.url));
const baseEnv = {
  ...process.env,
  VERCEL_API_TOKEN: "token-de-test",
  // Ids inventados, armados por partes (un literal entero con forma de id real hace saltar los
  // chequeos de anonimización del template).
  VERCEL_TEAM_ID: "team" + "_0000000000000000",
  VERCEL_PROJECTS: "app=prj" + "_0000000000000000",
  VERCEL_PROJECT_ID: "",
};

async function withServer(scenario, budgetMs, fn) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", new URL("./test-mock-fetch.mjs", import.meta.url).href, here("./index.mjs")],
    env: { ...baseEnv, MOCK_SCENARIO: scenario, VERCEL_TOOL_BUDGET_MS: String(budgetMs) },
  });
  const client = new Client({ name: "budget-test", version: "0.0.1" }, { capabilities: {} });
  await client.connect(transport);
  const call = async (name, args = {}) => {
    const t0 = Date.now();
    const res = await client.callTool({ name, arguments: args }, undefined, { timeout: budgetMs + 20000 });
    const text = res.content?.[0]?.text ?? "";
    return { ms: Date.now() - t0, isError: Boolean(res.isError), text, data: res.isError ? null : JSON.parse(text) };
  };
  try { await fn(call); } finally { await client.close(); }
}

// 1) Vercel responde 504 con la ventana ancha → se cubre el cuarto más reciente y se dice cuál.
await withServer("wide-504", 20000, async (call) => {
  const before = Date.now();
  const logs = await call("vercel_request_logs", { since: "24h", statusCode: "5xx" });
  assert.equal(logs.isError, false, logs.text);
  assert.equal(logs.data.count, 1);
  assert.ok(logs.data.coveredSince, "tiene que informar desde cuándo cubrió");
  const covered = Date.parse(logs.data.coveredSince);
  assert.ok(Math.abs(covered - (before - 6 * 3600e3)) < 5000, "cubre el cuarto más reciente de 24 h (6 h)");
  assert.equal(logs.data.hasMore, true, "lo anterior quedó sin mirar: hay más");
  assert.equal(Date.parse(logs.data.nextUntil), covered - 1, "el cursor arranca donde empieza lo no cubierto");
  assert.match(logs.data.note, /SIN mirar/);
  assert.ok(!logs.text.includes("no-debe-salir") && !logs.text.includes("example.com"), "la salida sigue redactada");

  const sum = await call("vercel_logs_summary", { since: "24h" });
  assert.equal(sum.isError, false, sum.text);
  assert.equal(sum.data.complete, false, "un resumen de un tramo no es un resumen completo");
  assert.ok(sum.data.coverage.every((c) => c.coveredSince), "cada consulta dice desde cuándo cubrió");
  assert.equal(sum.data.requestsWithProblems, 2);
  assert.match(sum.data.note, /SIN mirar/);

  // Con una ventana chica Vercel responde: resultado completo, sin avisos.
  const narrow = await call("vercel_logs_summary", { since: "1h" });
  assert.equal(narrow.data.complete, true);
  assert.ok(narrow.data.coverage.every((c) => !c.coveredSince && !c.failed && !c.partial));
  const narrowLogs = await call("vercel_request_logs", { since: "1h", level: ["error"] });
  assert.equal(narrowLogs.data.coveredSince, undefined);
  assert.equal(narrowLogs.data.hasMore, false);
});

// 2) Vercel no responde nunca → error claro DENTRO del tope, no un cuelgue.
await withServer("hang", 2500, async (call) => {
  const logs = await call("vercel_request_logs", { since: "1h", level: ["error"] });
  assert.equal(logs.isError, true);
  assert.match(logs.text, /no respondió dentro del tiempo/);
  assert.ok(logs.ms < 5000, `tardó ${logs.ms} ms con un tope de 2500`);

  const sum = await call("vercel_logs_summary", { since: "24h", include4xx: true, includeWarnings: true });
  assert.equal(sum.isError, true, "si no respondió ninguna consulta no hay resumen (un cero se leería como 'sin errores')");
  assert.ok(sum.ms < 5000, `4 consultas en paralelo tardaron ${sum.ms} ms con un tope de 2500`);
});

// 3) Una consulta no responde y la otra sí → resumen con lo que hay, marcado INCOMPLETO.
await withServer("one-fails", 2500, async (call) => {
  const sum = await call("vercel_logs_summary", { since: "1h" });
  assert.equal(sum.isError, false, sum.text);
  assert.equal(sum.data.complete, false);
  const byName = Object.fromEntries(sum.data.coverage.map((c) => [c.query, c]));
  assert.ok(byName["5xx"].failed, "la consulta 5xx tiene que figurar como fallida");
  assert.equal(byName["error-logs"].rows, 1);
  assert.match(sum.data.note, /INCOMPLETO/);
  assert.ok(sum.ms < 5000, `tardó ${sum.ms} ms con un tope de 2500`);
});

// 4) Todo responde → nada de avisos.
await withServer("ok", 20000, async (call) => {
  const sum = await call("vercel_logs_summary", { since: "24h" });
  assert.equal(sum.data.complete, true);
  assert.equal(sum.data.requestsWithProblems, 2);
  assert.ok(sum.ms < 3000);
});

console.log("budget.test.mjs OK");
