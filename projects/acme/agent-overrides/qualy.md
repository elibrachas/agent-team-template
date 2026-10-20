<!-- EJEMPLO: override de Qualy para el proyecto Acme. Declara la suite, los flujos de smoke, las fuentes de logs y el baseline de seguridad. -->
## QA en {{PROJECT_NAME}} — suite y comandos

- Suite del producto: TODO(acme). Ejemplo: `cd {{PRODUCT_REPO_PATH}}` y usa `pnpm test` (unit/integration), `pnpm test:e2e` (Playwright), `pnpm typecheck`, `pnpm lint`. Para apuntar e2e a un preview: `PLAYWRIGHT_BASE_URL=<url-del-preview> pnpm test:e2e`.
- NO corras la suite e2e completa contra prod (hay specs que MUTAN: crean cuentas, etc.). Contra prod: solo smoke read-only con el browser.
- Flujos clave de prod ({{PRODUCT_URL}}) para smoke: TODO(acme). Ejemplo: home (`/`), `/pricing`, la página de la feature principal; los forms de signup y login RENDERIZAN (sin enviar); el inicio del checkout muestra los precios (SIN pagar).
- Fallos pre-existentes conocidos de la suite: TODO(acme) (lístalos para que no se reporten como regresiones).
- Logs: la base (`get_advisors` + `get_logs` del MCP de Supabase) + **Vercel por `mcp__vercel__*`** (read-only; proyecto `app` del pin de `project.json → vercel`). Orden: `vercel_logs_summary` de las últimas 24 h → `vercel_request_logs` para el detalle de cada grupo → `vercel_deployments` con `state: ERROR` + `vercel_build_logs` para builds fallidos. El `deployment.crons` que devuelve `vercel_build_logs` del último deploy de producción es la lista REAL de crons registrados: si no coincide con lo que dice `data-model.md`, repórtalo. **Retención de runtime ~24 h**: si tu `log-review` es diario cubres todo (si un día no corrió, ese día quedó sin revisar: dilo); si es semanal, de runtime solo ves el último día y el reporte lo tiene que decir. La falla silenciosa más común es el **timeout** de la función (el hosting la mata, el `catch` no corre y no queda rastro en la base): solo se ve aquí. TODO(acme): qué rutas son 🔴 si dan 5xx (p. ej. una feature paga o el webhook de pagos: el usuario pagó y no recibió el resultado). Nunca uses el token de Vercel por `curl` ni el CLI `vercel`.
- Revisión semanal de seguridad: skill `security-review` (`{{PROJECT_CONTEXT_DIR}}\skills\security-review\SKILL.md`, con su `baseline.md`). Es más profunda que la dimensión 3 del review de front (aislamiento de datos en la base, authz de cada ruta, secretos, accesos, dependencias); no dupliques sus hallazgos aquí.

## Review semanal de front (job `front-review`)

Tu chequeo más completo. Tres dimensiones sobre {{PRODUCT_URL}} y el repo `{{PRODUCT_REPO_PATH}}`. Output: **un issue por hallazgo accionable** (🔴/🟡), máx. 5, prefijo `[QA-sec]` (seguridad) o `[QA-front]` (flujos/calidad). Los 🟢/info van solo en el brief. {{OWNER_NAME}} despacha cada issue a Cody.

**Memoria persistente — `{{PROJECT_CONTEXT_DIR}}\qualy-front-memory.md`** (es el ÚNICO archivo que escribes en este job). Léela PRIMERO y reconcilia cada hallazgo previo contra el estado de su issue en Linear (Done → arreglado, Canceled → wont-fix, sigue en Backlog → abierto). **No dupliques**: si un hallazgo ya tiene issue abierto, solo refrescas su `última-vez`; no re-levantas `wont-fix`/`falso-positivo`; solo creas issues para hallazgos NUEVOS o regresiones. Al terminar, **reescríbela** con el ledger actualizado. Vocabulario y reglas: en el header del propio archivo.

### 1. Flujos (Playwright, no destructivo)
Los mismos flujos clave del smoke. Mobile (~390px) + desktop. Captura errores de consola/red.

### 2. Calidad de front
- Coherencia con el design system real (ver `{{PROJECT_CONTEXT_DIR}}\design-system.md`).
- Imágenes/links rotos, overflow o texto cortado en mobile.
- Snapshot de accesibilidad (árbol a11y de Playwright) de la home + 1-2 páginas de conversión.

### 3. Seguridad de front
**Baseline**: TODO(acme) — si tienes un security review previo (p. ej. `{{PRODUCT_REPO_PATH}}\docs\security-review.md`), léelo PRIMERO: es tu fuente de verdad de lo ya conocido. No re-reportes un finding del baseline salvo que verifiques que sigue ABIERTO, y entonces cita su id.

**Observable en browser (Playwright sobre {{PRODUCT_URL}}):**
- Headers de respuesta: X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, HSTS y CSP (¿enforcing o solo Report-Only?). Verifica que efectivamente llegan en prod.
- Cookies: flags Secure / HttpOnly / SameSite.
- Contenido mixto / requests `http://` en página `https`.

**Estático del repo (Read/Grep en `{{PRODUCT_REPO_PATH}}`) — busca REGRESIONES NUEVAS:**
- Rutas de API que validan la sesión de forma débil (p. ej. leer la sesión del cliente en vez de verificar el usuario contra el servidor de auth).
- `dangerouslySetInnerHTML` que NO sea JSON-LD escapado de data estática (sobre todo con data de usuario/CMS).
- Variables públicas del bundle (`NEXT_PUBLIC_*` o equivalente) que expongan algo con pinta de secreto (las *publishable/anon/public keys* son OK por diseño; un `*_SECRET` no).
- Input del request interpolado en filtros de query o en SQL.
- Webhooks que acepten sin verificar firma (p. ej. `if (!secret) return true`).
- `console.log` de headers/cookies/PII en rutas.

**Deps:** `cd {{PRODUCT_REPO_PATH}}; pnpm audit --prod` (best-effort; si Bash/red falla, dilo y quédate con lo estático + el baseline).
