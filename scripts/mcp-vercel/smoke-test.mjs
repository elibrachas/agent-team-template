// Smoke test del MCP contra Vercel real (solo lectura). Arranca index.mjs, lista las tools y
// llama a cada una. Imprime conteos y estados — nunca mensajes de log ni el token.
//
// Uso (desde scripts/mcp-vercel, con el env del proyecto cargado):
//   VERCEL_API_TOKEN=... VERCEL_PROJECTS="site=prj_..." node smoke-test.mjs
// En el server: correr un wrapper con -DryRun muestra el pin que recibe cada proyecto.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const env = { ...process.env };
if (!env.VERCEL_API_TOKEN && env.VERCEL_TOKEN) env.VERCEL_API_TOKEN = env.VERCEL_TOKEN;

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL("./index.mjs", import.meta.url))],
  env,
});
const client = new Client({ name: "vercel-smoke", version: "0.0.1" }, { capabilities: {} });
await client.connect(transport);

// Cada tool tiene un tope de tiempo propio (VERCEL_TOOL_BUDGET_MS, default 55 s): si una llamada
// tarda más que eso + margen, el tope no está funcionando y el smoke falla.
const BUDGET_MS = Number(process.env.VERCEL_TOOL_BUDGET_MS) || 55000;
let slowest = 0;
const call = async (name, args = {}) => {
  const t0 = Date.now();
  let res;
  try {
    res = await client.callTool({ name, arguments: args }, undefined, { timeout: BUDGET_MS + 60000 });
  } catch (e) {
    slowest = Math.max(slowest, Date.now() - t0);
    return { error: `la llamada no volvió: ${e?.message || e}` };
  }
  slowest = Math.max(slowest, Date.now() - t0);
  const text = res.content?.[0]?.text ?? "";
  if (res.isError) return { error: text };
  try { return JSON.parse(text); } catch { return { error: "respuesta no-JSON" }; }
};
let failed = false;
let warned = false;
const line = (label, value) => console.log(`${label.padEnd(34)} ${value}`);
// "Vercel tardó / devolvió 5xx" no es una falla del MCP si la tool cortó a tiempo y lo dijo claro:
// se informa como aviso. Cualquier otro error, o pasarse del tope, sí hace fallar el smoke.
const upstreamSlow = (msg) => /Vercel no respondió|Vercel respondió 5\d\d|rate limit/.test(msg);
const check = (label, r, describe) => {
  if (r.error && upstreamSlow(r.error)) { warned = true; line(label, `AVISO: Vercel lento, la tool cortó a tiempo → ${r.error.slice(0, 100)}`); return false; }
  if (r.error) { failed = true; line(label, `ERROR → ${r.error}`); return false; }
  line(label, describe(r));
  return true;
};

const tools = await client.listTools();
line("tools", tools.tools.map((t) => t.name).join(", "));

const projects = await call("vercel_projects");
check("vercel_projects", projects, (r) =>
  r.projects.map((p) => `${p.key}=${p.name ?? "?"} prod:${p.lastProduction?.state ?? p.error ?? "-"} fallido7d:${p.lastFailed7d ? "sí" : "no"}`).join(" | ")
);

for (const p of projects.projects ?? []) {
  console.log(`\n== ${p.key}`);
  const deps = await call("vercel_deployments", { project: p.key, limit: 5 });
  check(" vercel_deployments", deps, (r) => `${r.count} → ${r.deployments.map((d) => `${d.state}/${d.target}`).join(" ")}`);
  const dpl = p.lastProduction?.id ?? deps.deployments?.[0]?.id;
  if (dpl) {
    const build = await call("vercel_build_logs", { deploymentId: dpl, limit: 20 });
    check(" vercel_build_logs", build, (r) => `${r.deployment.state} · ${r.lineCount} líneas · crons:${r.deployment.crons?.length ?? 0}`);
  }
  const summary = await call("vercel_logs_summary", { project: p.key, since: "24h" });
  check(" vercel_logs_summary 24h", summary, (r) => {
    if (!r.complete) warned = true;
    const cov = r.coverage.map((c) => `${c.query}:${c.failed ? "SIN RESPUESTA" : c.coveredSince ? `solo desde ${c.coveredSince.slice(11, 16)}Z` : c.partial ? "parcial" : "ok"}`).join(" ");
    return `problemas:${r.requestsWithProblems} grupos:${r.groupCount} status:${JSON.stringify(r.byStatus)} crashes:${r.functionCrashes} · completo:${r.complete} (${cov})`;
  });
  // SMOKE_VERBOSE=1: los 5 grupos más frecuentes (ya redactados), para revisar a ojo el agrupado.
  if (process.env.SMOKE_VERBOSE && !summary.error) {
    for (const g of summary.groups.slice(0, 5)) {
      console.log(`   ×${g.count} ${g.status} ${g.method} ${g.route} ${g.errorCode ?? ""} [${g.level ?? "-"}] ${(g.message ?? "").slice(0, 110)}`);
    }
    console.log(`   coverage: ${JSON.stringify(summary.coverage)}`);
  }
  const logs = await call("vercel_request_logs", { project: p.key, since: "24h", level: ["error", "warning"], limit: 5 });
  check(" vercel_request_logs error|warn", logs, (r) => {
    if (r.coveredSince) warned = true;
    return `${r.count} filas · hasMore:${r.hasMore} · líneas:${r.rows.reduce((n, x) => n + (x.logs?.length ?? 0), 0)}${r.coveredSince ? ` · cubre solo desde ${r.coveredSince}` : ""}`;
  });
}

console.log("\n== guardas (tienen que FALLAR)");
const denied = [
  ["proyecto fuera del pin", "vercel_deployments", { project: "prj" + "_FAKEnotPinnedXXXXXXXXXXXXX" }],
  ["deploymentId con path", "vercel_build_logs", { deploymentId: "dpl_abc/../../v9/projects" }],
  ["ventana fuera de retención", "vercel_request_logs", { since: "72h", until: "48h" }],
  ["nivel inválido", "vercel_request_logs", { level: ["debug"] }],
];
if (process.env.SMOKE_FOREIGN_DEPLOYMENT) {
  denied.push(["deployment de otro proyecto", "vercel_build_logs", { deploymentId: process.env.SMOKE_FOREIGN_DEPLOYMENT }]);
}
for (const [label, name, args] of denied) {
  const r = await call(name, args);
  if (!r.error) failed = true;
  line(` ${label}`, r.error ? `rechazado ✓ (${r.error.slice(0, 110)})` : "NO fue rechazado ✗");
}

await client.close();
const overBudget = slowest > BUDGET_MS + 5000;
if (overBudget) failed = true;
console.log(`\nllamada más lenta: ${(slowest / 1000).toFixed(1)} s (tope ${BUDGET_MS / 1000} s)${overBudget ? " ✗ se pasó del tope" : ""}`);
console.log(failed ? "SMOKE: FALLÓ" : warned ? "SMOKE: OK con avisos — Vercel respondió lento o parcial en alguna consulta de logs" : "SMOKE: OK");
process.exit(failed ? 1 : 0);
