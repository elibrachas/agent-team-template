// SOLO PARA TESTS (lo carga budget.test.mjs con `node --import`): reemplaza fetch por un Vercel
// de mentira, sin red, para ejercitar el tope de tiempo y el achique de ventana de index.mjs.
// Nunca se carga en una corrida real: index.mjs no lo importa.
//
// MOCK_SCENARIO:
//   ok          → la búsqueda de logs responde siempre.
//   wide-504    → responde 504 si la ventana pedida supera las 8 h (como el gateway real con
//                 ventanas anchas); con ventanas más chicas responde.
//   hang        → no responde nunca (hasta que el cliente aborta).
//   one-fails   → la consulta statusCode=5xx no responde; las demás sí.
const scenario = process.env.MOCK_SCENARIO || "ok";

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
const never = (signal) =>
  new Promise((_, reject) => {
    signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  });
const later = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (init.method !== "GET") throw new Error(`el MCP hizo un ${init.method}: solo puede hacer GET`);
  if (url.pathname !== "/api/logs/request-logs") return json(404, { error: { code: "not_found" } });

  const start = Number(url.searchParams.get("startDate"));
  const end = Number(url.searchParams.get("endDate"));
  const is5xx = url.searchParams.get("statusCode") === "5xx";

  if (scenario === "hang") return never(init.signal);
  if (scenario === "one-fails" && is5xx) return never(init.signal);
  if (scenario === "wide-504" && end - start > 8 * 3600e3) return later(150, json(504, { error: { code: "gateway_timeout" } }));

  const ts = new Date(end - 60e3).toISOString();
  return later(50, json(200, {
    hasMoreRows: false,
    rows: [
      {
        requestId: `req-${is5xx ? "5xx" : "log"}-0001`,
        timestamp: ts,
        requestMethod: "POST",
        requestPath: "/api/demo?token=no-debe-salir",
        route: "/api/demo",
        statusCode: 500,
        environment: "production",
        deploymentId: "dpl" + "_0000000000000000",
        logs: [{ timestamp: ts, level: "error", source: "function", message: "boom para ana@example.com" }],
      },
    ],
  }));
};
