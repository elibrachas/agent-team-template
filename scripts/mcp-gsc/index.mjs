#!/usr/bin/env node
// MCP server: Google Search Console para el equipo de agentes.
// Expone 3 tools usados por Greta (growth, skill seo-weekly-review) y Numa:
//   - gsc_query        (Search Analytics)  → queries / pages / clicks / impressions / CTR / posición
//   - gsc_url_inspect  (URL Inspection)    → estado de indexación de una URL
//   - gsc_sitemaps     (Sitemaps)          → sitemaps enviados, last-downloaded, errores/warnings
//
// Auth: service account JWT (scope webmasters.readonly) — GSC es data PRIVADA por propiedad,
// NO sirve API key (a diferencia de mcp-cwv). Reusa el MISMO service account que GA4/cwv.
// El email del SA debe estar agregado como usuario (lectura) de la propiedad en Search Console.
//
// Env requeridas (de .env.server):
//   GA4_SERVICE_ACCOUNT_JSON_PATH  → ruta al JSON del service account (mismo de GA4)
//   GSC_SITE_URL                   → propiedad por default. OJO: debe matchear el TIPO exacto
//                                    en GSC: domain property = "sc-domain:acme.example",
//                                    URL-prefix = "https://acme.example/".
//
// Lanza con: node scripts/mcp-gsc/index.mjs   (el cliente MCP se conecta por stdio).

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { GoogleAuth } from "google-auth-library";

const KEY_FILE =
  process.env.GA4_SERVICE_ACCOUNT_JSON_PATH ||
  process.env.GOOGLE_APPLICATION_CREDENTIALS;
const DEFAULT_SITE = process.env.GSC_SITE_URL || "";

if (!KEY_FILE) {
  console.error(
    "[mcp-gsc] FATAL: falta GA4_SERVICE_ACCOUNT_JSON_PATH (o GOOGLE_APPLICATION_CREDENTIALS) en el env."
  );
  process.exit(1);
}

// Un solo cliente auth para todo el proceso. getAccessToken() cachea/refresca solo.
const auth = new GoogleAuth({
  keyFile: KEY_FILE,
  scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
});
let authClient;
async function getToken() {
  if (!authClient) authClient = await auth.getClient();
  const t = await authClient.getAccessToken();
  const token = typeof t === "string" ? t : t?.token;
  if (!token) throw new Error("no pude obtener access token del service account");
  return token;
}

const SC_V3 = "https://searchconsole.googleapis.com/webmasters/v3";
const SC_V1 = "https://searchconsole.googleapis.com/v1";

// GSC tiene ~2-3 días de lag: el default de endDate es hoy-3.
function ymd(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}`;
}
function defaultRange(days = 28) {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 3);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { startDate: ymd(start), endDate: ymd(end) };
}

const TOOLS = [
  {
    name: "gsc_query",
    description:
      "Google Search Console — Search Analytics. Devuelve filas top con clicks, impressions, " +
      "CTR y posición media para una propiedad. Dimensiones combinables: query | page | country | " +
      "device | date. Casos típicos: top queries, top pages, oportunidades (posición 11-20 = página 2), " +
      "CTR bajo con buena posición (problema de title/meta), trend por date. GSC tiene ~2-3 días de lag.",
    inputSchema: {
      type: "object",
      properties: {
        dimensions: {
          type: "array",
          items: { type: "string", enum: ["query", "page", "country", "device", "date"] },
          description: "Dimensiones a agrupar. Default: ['query'].",
        },
        startDate: { type: "string", description: "YYYY-MM-DD. Default: hoy-3 menos 'days'." },
        endDate: { type: "string", description: "YYYY-MM-DD. Default: hoy-3 (lag de GSC)." },
        days: {
          type: "number",
          description: "Atajo: últimos N días si no pasas startDate/endDate. Default 28.",
        },
        rowLimit: { type: "number", description: "Máx filas. Default 20, máximo 250." },
        page: {
          type: "string",
          description: "Filtro opcional: limitar a una URL exacta (útil con dimensions=['query']).",
        },
        pageContains: {
          type: "string",
          description:
            "Filtro opcional: solo URLs que contengan este texto (ej. '/blog/' para ver solo el blog). Se combina con los otros filtros (AND).",
        },
        queryContains: {
          type: "string",
          description:
            "Filtro opcional: solo queries que contengan este texto (ej. 'precio'). Se combina con los otros filtros (AND).",
        },
        pageExcludeRegex: {
          type: "string",
          description:
            "Filtro opcional: excluye URLs que matcheen esta regex RE2 (ej. 'guia-top|landing-precios'). GSC ordena las filas por clicks, así que excluir las páginas que concentran el tráfico deja ver el resto.",
        },
        queryExcludeRegex: {
          type: "string",
          description:
            "Filtro opcional: excluye queries que matcheen esta regex RE2 (ej. 'marca|competidor').",
        },
        siteUrl: {
          type: "string",
          description:
            "Propiedad. Default GSC_SITE_URL. Domain property = 'sc-domain:acme.example'.",
        },
      },
    },
  },
  {
    name: "gsc_url_inspect",
    description:
      "Google Search Console — URL Inspection. Estado de indexación de UNA URL: verdict, " +
      "coverageState, si está indexada, último crawl, robots/canonical de Google vs el declarado. " +
      "Úsalo para diagnosticar páginas que no aparecen en search.",
    inputSchema: {
      type: "object",
      properties: {
        inspectionUrl: { type: "string", description: "URL exacta a inspeccionar (full https://...)." },
        siteUrl: { type: "string", description: "Propiedad. Default GSC_SITE_URL." },
        languageCode: { type: "string", description: "Default 'es'." },
      },
      required: ["inspectionUrl"],
    },
  },
  {
    name: "gsc_sitemaps",
    description:
      "Google Search Console — lista de sitemaps enviados de la propiedad: path, last-submitted, " +
      "last-downloaded, pendiente, errores/warnings y conteo por tipo de contenido. Úsalo para " +
      "verificar que el sitemap se está procesando sin errores.",
    inputSchema: {
      type: "object",
      properties: {
        siteUrl: { type: "string", description: "Propiedad. Default GSC_SITE_URL." },
      },
    },
  },
];

function resolveSite(siteUrl) {
  const s = siteUrl || DEFAULT_SITE;
  if (!s) throw new Error("falta siteUrl (ni argumento ni GSC_SITE_URL en el env)");
  return s;
}

async function gscFetch(url, { method = "GET", body } = {}) {
  const token = await getToken();
  const resp = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`GSC ${resp.status}: ${t.slice(0, 500)}`);
  }
  return resp.json();
}

// ---------- Search Analytics ----------
async function gscQuery(args = {}) {
  const site = resolveSite(args.siteUrl);
  const dimensions = args.dimensions?.length ? args.dimensions : ["query"];
  const range =
    args.startDate && args.endDate
      ? { startDate: args.startDate, endDate: args.endDate }
      : defaultRange(args.days || 28);
  const rowLimit = Math.min(args.rowLimit || 20, 250);
  const body = {
    startDate: range.startDate,
    endDate: range.endDate,
    dimensions,
    rowLimit,
    dataState: "final",
  };
  const filters = [];
  if (args.page) filters.push({ dimension: "page", operator: "equals", expression: args.page });
  if (args.pageContains) filters.push({ dimension: "page", operator: "contains", expression: args.pageContains });
  if (args.queryContains) filters.push({ dimension: "query", operator: "contains", expression: args.queryContains });
  if (args.pageExcludeRegex) filters.push({ dimension: "page", operator: "excludingRegex", expression: args.pageExcludeRegex });
  if (args.queryExcludeRegex) filters.push({ dimension: "query", operator: "excludingRegex", expression: args.queryExcludeRegex });
  if (filters.length) body.dimensionFilterGroups = [{ groupType: "and", filters }];
  const url = `${SC_V3}/sites/${encodeURIComponent(site)}/searchAnalytics/query`;
  const data = await gscFetch(url, { method: "POST", body });
  const filterLabel = filters.map((f) => `${f.dimension} ${f.operator} ${f.expression}`).join(" AND ");
  return formatQuery(data, { site, dimensions, range, rowLimit, filterLabel });
}

function formatQuery(data, { site, dimensions, range, rowLimit, filterLabel }) {
  const rows = data.rows || [];
  const head = [
    `Propiedad: ${site}`,
    `Período: ${range.startDate} → ${range.endDate}  (GSC lag ~2-3d)`,
    `Dimensiones: ${dimensions.join(" + ")}${filterLabel ? `   | filtro: ${filterLabel}` : ""}`,
    `Filas: ${rows.length} (rowLimit ${rowLimit})`,
    "",
  ];
  if (!rows.length) {
    head.push("Sin filas. Probable: rango sin datos, propiedad equivocada, o el SA no tiene acceso.");
    return head.join("\n");
  }
  const lines = rows.map((r) => {
    const keys = (r.keys || []).join(" | ");
    const clicks = r.clicks ?? 0;
    const impr = r.impressions ?? 0;
    const ctr = ((r.ctr ?? 0) * 100).toFixed(1);
    const pos = (r.position ?? 0).toFixed(1);
    return `  ${keys}\n      clicks ${clicks} · impr ${impr} · CTR ${ctr}% · pos ${pos}`;
  });
  return [...head, `${dimensions.join(" + ")}:`, ...lines].join("\n");
}

// ---------- URL Inspection ----------
async function gscUrlInspect(args = {}) {
  const site = resolveSite(args.siteUrl);
  if (!args.inspectionUrl) throw new Error("falta inspectionUrl");
  const body = {
    inspectionUrl: args.inspectionUrl,
    siteUrl: site,
    languageCode: args.languageCode || "es",
  };
  const url = `${SC_V1}/urlInspection/index:inspect`;
  const data = await gscFetch(url, { method: "POST", body });
  return formatInspect(data, args.inspectionUrl, site);
}

function formatInspect(data, inspectionUrl, site) {
  const r = data.inspectionResult;
  if (!r) return `Sin inspectionResult para ${inspectionUrl}.`;
  const idx = r.indexStatusResult || {};
  const out = [
    `URL: ${inspectionUrl}`,
    `Propiedad: ${site}`,
    `Veredicto: ${idx.verdict ?? "—"}`,
    `Cobertura: ${idx.coverageState ?? "—"}`,
    `Robots: ${idx.robotsTxtState ?? "—"}   | Indexing: ${idx.indexingState ?? "—"}`,
    `Page fetch: ${idx.pageFetchState ?? "—"}`,
    `Último crawl: ${idx.lastCrawlTime ?? "—"}`,
    `Canonical declarado: ${idx.userCanonical ?? "—"}`,
    `Canonical de Google: ${idx.googleCanonical ?? "—"}`,
  ];
  if (r.mobileUsabilityResult?.verdict) {
    out.push(`Mobile usability: ${r.mobileUsabilityResult.verdict}`);
  }
  if (r.richResultsResult?.verdict) {
    out.push(`Rich results: ${r.richResultsResult.verdict}`);
  }
  if (r.inspectionResultLink) out.push(`Detalle: ${r.inspectionResultLink}`);
  return out.join("\n");
}

// ---------- Sitemaps ----------
async function gscSitemaps(args = {}) {
  const site = resolveSite(args.siteUrl);
  const url = `${SC_V3}/sites/${encodeURIComponent(site)}/sitemaps`;
  const data = await gscFetch(url);
  return formatSitemaps(data, site);
}

function formatSitemaps(data, site) {
  const sm = data.sitemap || [];
  const head = [`Propiedad: ${site}`, `Sitemaps enviados: ${sm.length}`, ""];
  if (!sm.length) {
    head.push("Sin sitemaps enviados (o el SA no ve la propiedad).");
    return head.join("\n");
  }
  const lines = sm.map((s) => {
    const errors = s.errors ?? 0;
    const warnings = s.warnings ?? 0;
    const contents = (s.contents || [])
      .map((c) => `${c.type}: ${c.submitted ?? 0} submitted / ${c.indexed ?? 0} indexed`)
      .join(", ");
    return [
      `  • ${s.path}`,
      `      submitted: ${s.lastSubmitted ?? "—"} | downloaded: ${s.lastDownloaded ?? "—"} | pending: ${s.isPending ?? false}`,
      `      errores: ${errors} · warnings: ${warnings}${contents ? ` | ${contents}` : ""}`,
    ].join("\n");
  });
  return [...head, ...lines].join("\n");
}

// ---------- MCP wiring ----------
const server = new Server({ name: "gsc", version: "0.1.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    const text =
      name === "gsc_query"
        ? await gscQuery(args)
        : name === "gsc_url_inspect"
        ? await gscUrlInspect(args)
        : name === "gsc_sitemaps"
        ? await gscSitemaps(args)
        : (() => {
            throw new Error(`Unknown tool: ${name}`);
          })();
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
console.error("[mcp-gsc] server listo (stdio)");
