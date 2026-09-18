#!/usr/bin/env node
// MCP server: Core Web Vitals para el equipo de agentes.
// Expone 2 tools usados por Numa (data) y Greta (growth):
//   - get_cwv_field  (CrUX Report API)    → field data real (p75 de usuarios reales)
//   - get_cwv_audit  (PageSpeed Insights) → lab + opportunities accionables
// Auth: env GOOGLE_API_KEY. Sin secretos en el código.
// Lanza con: node scripts/mcp-cwv/index.mjs   (el cliente MCP se conecta por stdio).

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const API_KEY = process.env.GOOGLE_API_KEY || process.env.GOOGLE_API;
if (!API_KEY) {
  console.error("[mcp-cwv] FATAL: falta GOOGLE_API_KEY (o GOOGLE_API) en el env.");
  process.exit(1);
}

const CRUX_URL = "https://chromeuxreport.googleapis.com/v1/records:queryRecord";
const PSI_URL = "https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed";

const TOOLS = [
  {
    name: "get_cwv_field",
    description:
      "Field Core Web Vitals (datos REALES de usuarios de Chrome, del Chrome UX Report). " +
      "Una request, rápido. Devuelve LCP / INP / CLS / FCP / TTFB p75 para una URL " +
      "agregando los últimos 28 días. Úsalo para chequear estado actual o trend reciente.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL exacta a consultar, ej. https://acme.example/",
        },
        formFactor: {
          type: "string",
          enum: ["PHONE", "DESKTOP", "TABLET", "ALL_FORM_FACTORS"],
          description: "Form factor a filtrar. Default: ALL_FORM_FACTORS.",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "get_cwv_audit",
    description:
      "PageSpeed Insights audit (lab + field combinados). Más lento (~10–15s) pero " +
      "devuelve performance score, métricas de lab, y top opportunities con savings " +
      "estimados. Úsalo para diagnóstico profundo o cuando necesites accionables concretos.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL exacta a auditar" },
        strategy: {
          type: "string",
          enum: ["mobile", "desktop"],
          description: "Estrategia de simulación. Default: mobile.",
        },
      },
      required: ["url"],
    },
  },
];

// ---------- CrUX ----------
async function getCwvField({ url, formFactor = "ALL_FORM_FACTORS" }) {
  const body = { url, formFactor };
  const resp = await fetch(`${CRUX_URL}?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`CrUX ${resp.status}: ${t.slice(0, 400)}`);
  }
  const data = await resp.json();
  return formatCrux(data, url, formFactor);
}

function formatCrux(data, url, formFactor) {
  const rec = data.record;
  if (!rec) return `Sin datos CrUX para ${url} (form factor ${formFactor}). Probable: tráfico insuficiente.`;
  const m = rec.metrics || {};
  const p = (k) => (m[k]?.percentiles?.p75 ?? "—");
  const period = rec.collectionPeriod;
  const fmtDate = (d) => d ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}` : "—";
  return [
    `URL: ${url}`,
    `Form factor: ${formFactor}`,
    `Período: ${fmtDate(period?.firstDate)} → ${fmtDate(period?.lastDate)}`,
    `LCP p75:    ${p("largest_contentful_paint")} ms   (good <2500, poor >4000)`,
    `INP p75:    ${p("interaction_to_next_paint")} ms   (good <200, poor >500)`,
    `CLS p75:    ${p("cumulative_layout_shift")}        (good <0.10, poor >0.25)`,
    `FCP p75:    ${p("first_contentful_paint")} ms`,
    `TTFB p75:   ${p("experimental_time_to_first_byte")} ms`,
  ].join("\n");
}

// ---------- PageSpeed Insights ----------
async function getCwvAudit({ url, strategy = "mobile" }) {
  const params = new URLSearchParams({
    url,
    key: API_KEY,
    strategy,
    category: "performance",
  });
  const resp = await fetch(`${PSI_URL}?${params}`);
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`PSI ${resp.status}: ${t.slice(0, 400)}`);
  }
  const data = await resp.json();
  return formatPsi(data, url, strategy);
}

function formatPsi(data, url, strategy) {
  const lh = data.lighthouseResult;
  if (!lh) return `PSI no devolvió lighthouseResult para ${url}.`;
  const score = Math.round((lh.categories?.performance?.score ?? 0) * 100);
  const a = lh.audits || {};
  const num = (k, unit = "ms") => {
    const n = a[k]?.numericValue;
    return n != null ? `${Math.round(n)}${unit}` : "—";
  };
  const opps = Object.values(a)
    .filter((x) => x?.details?.overallSavingsMs > 0 && (x.score ?? 1) < 0.9)
    .sort((x, y) => (y.details.overallSavingsMs - x.details.overallSavingsMs))
    .slice(0, 5)
    .map((x) => `  • ${x.title} — savings ~${Math.round(x.details.overallSavingsMs)} ms`);
  return [
    `URL: ${url}`,
    `Strategy: ${strategy}`,
    `Performance score: ${score}/100`,
    `LCP:  ${num("largest-contentful-paint")}`,
    `INP:  ${num("interaction-to-next-paint")}`,
    `CLS:  ${a["cumulative-layout-shift"]?.numericValue?.toFixed(3) ?? "—"}`,
    `FCP:  ${num("first-contentful-paint")}`,
    `TBT:  ${num("total-blocking-time")}`,
    `SI:   ${num("speed-index")}`,
    "",
    opps.length ? "Top opportunities (sort by savings):" : "Sin opportunities relevantes.",
    ...opps,
  ].join("\n");
}

// ---------- MCP wiring ----------
const server = new Server(
  { name: "cwv", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    const text =
      name === "get_cwv_field"
        ? await getCwvField(args)
        : name === "get_cwv_audit"
        ? await getCwvAudit(args)
        : (() => { throw new Error(`Unknown tool: ${name}`); })();
    return { content: [{ type: "text", text }] };
  } catch (e) {
    return {
      isError: true,
      content: [{ type: "text", text: `Error en ${name}: ${e.message}` }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[mcp-cwv] server listo (stdio)");
