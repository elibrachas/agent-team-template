// Smoke test del MCP. Arranca index.mjs, lista tools, llama get_cwv_field.
// Uso: node smoke-test.mjs   (necesita GOOGLE_API_KEY o GOOGLE_API en el env; CWV_SMOKE_URL opcional)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const env = { ...process.env };
if (!env.GOOGLE_API_KEY && env.GOOGLE_API) env.GOOGLE_API_KEY = env.GOOGLE_API;

const transport = new StdioClientTransport({
  command: "node",
  args: ["./index.mjs"],
  env,
});
const client = new Client({ name: "cwv-smoke", version: "0.0.1" }, { capabilities: {} });

await client.connect(transport);
const tools = await client.listTools();
console.log("=== tools ===");
console.log(tools.tools.map((t) => `${t.name}: ${t.description.slice(0, 70)}…`).join("\n"));
console.log("\n=== get_cwv_field on acme.example ===");
const result = await client.callTool({
  name: "get_cwv_field",
  arguments: { url: process.env.CWV_SMOKE_URL || "https://acme.example/" },
});
for (const c of result.content) console.log(c.text);
await client.close();
