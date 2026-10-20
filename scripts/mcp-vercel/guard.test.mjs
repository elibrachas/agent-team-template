// Test del guard (sin red, sin token): node guard.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  cleanPath,
  errorSignature,
  isAllowedProjectId,
  normLevels,
  normStatus,
  parseProjects,
  parseTime,
  pickDeployment,
  pickDeploymentDetail,
  pickLogRow,
  redact,
  resolveProject,
  DEPLOYMENT_ID_RE,
} from "./guard.mjs";

// Ids inventados, armados por partes: un literal entero con forma de id real de Vercel hace
// saltar los chequeos de anonimización del template.
const P = "prj" + "_";
const D = "dpl" + "_";
const A = P + "FAKEsiteAAAAAAAAAAAAAAAAAAA";
const B = P + "FAKEappBBBBBBBBBBBBBBBBBBBB";
const OTHER = P + "FAKEotherCCCCCCCCCCCCCCCCCC";
const DPL = D + "FAKEdeployDDDDDDDDDDDDDDDDD";

// --- pin de proyectos ---
{
  const p = parseProjects({ VERCEL_PROJECTS: `site=${A};app=${B}` });
  assert.deepEqual([...p], [["site", A], ["app", B]]);
  assert.deepEqual(resolveProject(undefined, p), { key: "site", id: A });
  assert.deepEqual(resolveProject("APP", p), { key: "app", id: B });
  assert.deepEqual(resolveProject(B, p), { key: "app", id: B });
  assert.throws(() => resolveProject(OTHER, p), /fuera del alcance/);
  assert.throws(() => resolveProject("portal", p), /fuera del alcance/);
  assert.equal(isAllowedProjectId(A, p), true);
  assert.equal(isAllowedProjectId(OTHER, p), false);
  assert.equal(isAllowedProjectId(undefined, p), false);
}
// coma como separador, basura ignorada, id legado
assert.deepEqual([...parseProjects({ VERCEL_PROJECTS: `site=${A}, x=no-es-un-id, ../env=${B}` })], [["site", A]]);
assert.deepEqual([...parseProjects({ VERCEL_PROJECT_ID: A })], [["default", A]]);
assert.deepEqual([...parseProjects({ VERCEL_PROJECTS: `site=${A}`, VERCEL_PROJECT_ID: B })], [["site", A]]);
assert.equal(parseProjects({}).size, 0);
assert.throws(() => resolveProject(undefined, new Map()), /no configurada/);

// --- ids: nada que pueda cambiar el path de la API ---
for (const bad of [D + "abc/../../v9/projects/x/env", D + "abcdefghij?decrypt=true", A, "", D]) {
  assert.equal(DEPLOYMENT_ID_RE.test(bad), false, bad);
}
assert.equal(DEPLOYMENT_ID_RE.test(DPL), true);

// --- tiempos, niveles, status ---
{
  const now = Date.UTC(2026, 9, 6, 12, 0, 0);
  assert.equal(parseTime("30m", now), now - 30 * 60e3);
  assert.equal(parseTime("6h", now), now - 6 * 3600e3);
  assert.equal(parseTime("1d", now), now - 86400e3);
  assert.equal(parseTime("now", now), now);
  assert.equal(parseTime("2026-10-06T10:00:00Z", now), Date.UTC(2026, 9, 6, 10));
  assert.equal(parseTime(String(now), now), now);
  assert.throws(() => parseTime("ayer", now), /inválido/);
}
assert.deepEqual(normLevels(["error", "warning", "ERROR"]), ["error", "warn"]);
assert.deepEqual(normLevels("error,fatal"), ["error", "fatal"]);
assert.deepEqual(normLevels(undefined), []);
assert.throws(() => normLevels(["debug"]), /nivel inválido/);
assert.equal(normStatus("5XX"), "5xx");
assert.equal(normStatus(500), "500");
assert.throws(() => normStatus("500&decrypt=true"), /inválido/);
assert.throws(() => normStatus("abc"), /inválido/);

// --- redacción ---
// Los valores con forma de credencial se arman por partes: son inventados, pero un literal
// entero con ese formato hace saltar a los escáneres de secretos del repo.
const fake = (prefix, body = "FAKEfake0000FAKEfake0000FAKE") => prefix + body;
const secretish = [
  ["user ana.perez+test@example.com failed", "[email]"],
  ["GET /unsubscribe/ana%40example.com", "[email]"],
  ["Authorization: Bearer abcDEF1234567890xyz", "[redacted]"],
  [`jwt ${fake("ey", "JFAKEfake000")}.${fake("ey", "JFAKEfake111")}.FAKEsignature`, "[jwt]"],
  [`key ${fake("sk_" + "live_")}`, "[stripe-key]"],
  [`${fake("rk_" + "live_")} leaked`, "[stripe-key]"],
  [fake("wh" + "sec_"), "[webhook-secret]"],
  [fake("sb_" + "secret_"), "[supabase-key]"],
  [fake("vc" + "p_"), "[vercel-token]"],
  [fake("gh" + "p_"), "[github-token]"],
  ["password=hunter2hunter2", "[redacted]"],
  ['{"api_key":"abcdef123456"}', "[redacted]"],
  ["from 203.0.113.56 blocked", "[ip]"],
];
for (const [input, marker] of secretish) {
  const out = redact(input);
  assert.ok(out.includes(marker), `${input} → ${out}`);
}
assert.ok(!redact("ana.perez@example.com").includes("example.com"));
assert.ok(!redact("Bearer abcDEF1234567890xyz").includes("abcDEF"));
assert.equal(redact("TypeError: Cannot read properties of undefined (reading 'id')"), "TypeError: Cannot read properties of undefined (reading 'id')");
assert.equal(cleanPath("/api/auth/callback?code=SECRET123&state=x#frag"), "/api/auth/callback");
assert.equal(cleanPath("/u/ana@example.com/cv"), "/u/[email]/cv");

// --- whitelist de salida ---
{
  const row = {
    requestId: "gru1::iad1::abcde-1759750000000-0123456789ab",
    timestamp: "2026-10-06T04:14:38.038Z",
    requestMethod: "GET",
    requestPath: "/api/x?token=abc",
    statusCode: 500,
    route: "/api/x",
    environment: "production",
    deploymentId: DPL,
    hasFunctionCrashed: true,
    requestDurationMs: 123.7,
    clientUserAgent: "Mozilla/5.0 SECRETUA",
    requestSearchParams: { token: "abc" },
    clientIpCountry: "AR",
    asnName: "SOME-ISP",
    sessionId: "sess_1",
    requestReferer: "https://example.com/?email=a@b.example",
    botName: "GPTBot",
    botCategory: "ai_crawler",
    logs: [
      { timestamp: "2026-10-06 04:14:45.244", source: "function", level: "info", message: "start" },
      { timestamp: "2026-10-06 04:14:45.300", source: "function", level: "error", message: "boom for ana@example.com\n  at x" },
    ],
  };
  const picked = pickLogRow(row);
  const json = JSON.stringify(picked);
  for (const leak of ["SECRETUA", "requestSearchParams", "token=abc", "SOME-ISP", "sess_1", "clientIpCountry", "example.com"]) {
    assert.ok(!json.includes(leak), `leak: ${leak}`);
  }
  assert.equal(picked.path, "/api/x");
  assert.equal(picked.crashed, true);
  assert.equal(picked.durationMs, 124);
  assert.deepEqual(picked.bot, { name: "GPTBot", category: "ai_crawler" });
  assert.equal(picked.logs.length, 2);
  assert.equal(pickLogRow(row, { levels: ["error"] }).logs.length, 1);
  assert.equal(pickLogRow(row, { maxLines: 1 }).moreLogLines, 1);

  const sig = errorSignature(row);
  assert.equal(sig.level, "error");
  assert.equal(sig.message, "boom for [email]");
  // mismo error con otro id numérico → misma firma
  const a = errorSignature({ logs: [{ level: "error", message: "user 123456 not found" }] });
  const b = errorSignature({ logs: [{ level: "error", message: "user 987654 not found" }] });
  assert.equal(a.key, b.key);
  assert.equal(errorSignature({ logs: [] }).key, "");
}
{
  const raw = {
    id: DPL,
    name: "acme-site",
    readyState: "ERROR",
    target: null,
    created: 1759750000000,
    errorMessage: "Command \"npm run build\" exited with 1",
    env: ["PAYLOAD_API_KEY", "RESEND_API_KEY"],
    build: { env: ["PAYLOAD_DATABASE_URL"] },
    projectSettings: { buildCommand: "x" },
    oidcTokenClaims: { sub: "x" },
    meta: { githubCommitSha: "0123456789abcdef0123", githubCommitMessage: "fix: algo\n\ncuerpo", githubCommitRef: "cody/ACM-1", githubCommitAuthorEmail: "ana@example.com", githubCommitAuthorLogin: "acme-dev" },
    crons: [{ path: "/api/cron/rescore", schedule: "0 6 * * *" }],
  };
  const json = JSON.stringify(pickDeploymentDetail(raw));
  for (const leak of ["PAYLOAD_API_KEY", "PAYLOAD_DATABASE_URL", "projectSettings", "oidcTokenClaims", "example.com", "cuerpo"]) {
    assert.ok(!json.includes(leak), `leak: ${leak}`);
  }
  const d = pickDeployment(raw);
  assert.equal(d.target, "preview");
  assert.equal(d.state, "ERROR");
  assert.equal(d.commit.sha, "0123456789");
  assert.equal(d.commit.message, "fix: algo");
  assert.deepEqual(pickDeploymentDetail(raw).crons, [{ path: "/api/cron/rescore", schedule: "0 6 * * *" }]);
}

// --- garantías estáticas de index.mjs: una sola salida a la red, solo GET, sin endpoints de secretos ---
{
  const src = readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
  const code = src.split("\n").filter((l) => !/^\s*(\/\/|#!)/.test(l)).join("\n");
  assert.equal((code.match(/\bfetch\(/g) || []).length, 1, "index.mjs debe tener UNA sola llamada a fetch()");
  assert.ok(/method:\s*"GET"/.test(code), "el método tiene que estar fijo en GET");
  assert.ok(!/["'`](POST|PUT|PATCH|DELETE)["'`]/.test(code), "no puede haber otro método HTTP");
  assert.ok(!/\/env\b|decrypt|\/v\d+\/projects\/\$|\/secrets|\/domains|\/v\d+\/teams/.test(code), "no puede haber paths de env vars / proyectos / dominios / teams");
  assert.ok(/redirect:\s*"error"/.test(code), "no se siguen redirects");
}

console.log("guard.test.mjs OK");
