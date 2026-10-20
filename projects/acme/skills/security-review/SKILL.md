---
name: security-review
description: Use when auditing the security of the project's product once a week — data isolation in the database (RLS, grants, SECURITY DEFINER functions, storage), authz of every route handler and server action, the unauthenticated surface and headers of the production site, AI and natural-language-to-query paths, webhooks and files that arrive from outside, secrets in the repo, access hygiene and vulnerable dependencies. Read-only; opens a [QA-sec] per new finding and a [Report] seguridad per run in the project's Linear team.
hitl_level: 1
owner: owner
agent: qualy
schedule: "30 4 * * 2"   # martes 04:30 (hora del server). Cron: automation/n8n/qualy-security-review.json
inputs: "Supabase (MCP read-only, SQL de catálogo), repo del producto (Read/Grep + git/gh por Bash), Playwright (solo superficie sin sesión de la URL de producción), Vercel read-only (logs y deploys), Linear (dedupe + creación), projects/<slug>/skills/security-review/baseline.md"
outputs: "[QA-sec] por hallazgo nuevo (label agent-proposal) + [Report] seguridad (label agent-report) + brief como result"
cost_budget_usd: 5
---

# Review de seguridad (Qualy 🧪, semanal)

Tu trabajo es encontrar, antes que nadie, cualquier camino por el que un dato de un usuario o de una
cuenta llegue a quien no debe, y cualquier regresión de las defensas que ya existen. **REPORTAS, no
arreglas.** Es más profundo que la dimensión de seguridad del review de front (`front-review`): no
dupliques sus hallazgos; si uno ya está abierto allí, cítalo.

TODO(acme): en 2-3 líneas, por qué la seguridad importa en este producto (qué datos guarda, si es
multi-tenant, si los previews corren contra la base de producción). Eso decide la severidad.

## Contexto obligatorio (cargar primero, en este orden)

1. `projects/<slug>/skills/security-review/baseline.md` — lo aceptado (A*) y lo abierto (S*). No
   re-descubras lo que ya está ahí.
2. El `CLAUDE.md` / `AGENTS.md` del repo del producto, en sus secciones de seguridad y de base de
   datos: qué defensas existen y qué reglas sigue el repo (p. ej. "tabla nueva = policy por comando
   + revoke a anon").
3. `projects/<slug>/data-model.md` — tenancy, funciones, jobs, qué es sensible.
4. Linear (team del proyecto): los `[QA-sec]` abiertos, los `Canceled`/`Duplicate` (sin tope de
   fecha) y los `Done` de los últimos 45 días, y el `[Report] seguridad` anterior. **Linear es tu
   memoria**: esta skill no tiene archivo propio.

La copia local del repo puede estar atrás: trabaja sobre `origin/main` (`git -C <repo> fetch` y
`git show origin/main:<path>` / `git grep … origin/main`). Si no pudiste hacer fetch, dilo arriba
del brief.

## Qué revisas

Cada área dice el método y qué es rojo. Lo que no pudiste verificar va como ⚪ con el motivo, nunca
como verde. TODO(acme): borra las áreas que no apliquen a tu stack y ajusta los nombres (funciones de
membresía, buckets, rutas) a los del producto.

### A. Aislamiento de datos (base, SQL de catálogo read-only)

1. **RLS prendido en todo `public`**: `select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity` → 🔴 cualquier fila.
2. **Policies**: `pg_policies` de `public` y `storage`. 🔴 una policy para `anon`/`public` que no esté en el baseline, o una policy `FOR ALL`/`INSERT`/`UPDATE`/`DELETE` para `authenticated` si el producto escribe solo desde el servidor. 🟡 una tabla nueva cuya policy no filtra por usuario o por cuenta.
3. **Grants**: `information_schema.role_table_grants` de `public` para `anon` y `authenticated`. 🔴 `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` donde el diseño no los da. 🟡 `SELECT` para `anon` en una tabla de negocio.
4. **Funciones `SECURITY DEFINER`** ejecutables por `authenticated` o `anon` (`pg_proc` + `has_function_privilege`): compáralas contra la lista del baseline. Por cada una NUEVA o cuyo cuerpo cambió (`prosrc`): ¿valida que `auth.uid()` tiene acceso a lo que recibe por parámetro? ¿tiene `search_path` fijo (`proconfig`)? 🔴 si devuelve datos de otro usuario o cuenta sin validar; 🟡 sin `search_path` fijo. Cualquiera ejecutable por `anon` = 🔴 salvo que esté documentada.
5. **Storage**: los buckets privados siguen privados, con límite de tamaño y allowlist de MIME; las policies de `storage.objects` exigen la carpeta del dueño. 🔴 bucket público o policy sin dueño.
6. **Linter de Supabase** (`get_advisors` security): compara contra el baseline. Lo nuevo se analiza; lo conocido no se reporta.

### B. Superficie HTTP (repo + browser)

1. **Inventario de route handlers** (`git ls-tree -r --name-only origin/main | grep 'route.ts$'`, o el equivalente de tu framework). Compáralo contra el del `[Report]` anterior. Por cada ruta NUEVA o modificada desde la corrida anterior (`git log --since`): ¿qué la autentica? Sesión verificada contra el servidor de auth + chequeo de rol, un Bearer de servicio comparado en tiempo constante, una firma de webhook o un token HMAC. 🔴 una ruta con efecto, o que devuelve datos de un usuario, sin ninguna de esas.
2. **Server actions** (`"use server"` o equivalente): por cada export nuevo o modificado, el orden tiene que ser sesión → rol → recién ahí el cliente con privilegios. 🔴 un cliente con privilegios (service role) antes del gate o sin gate; 🟡 una acción pública nueva (sin sesión) que no esté en el baseline.
3. **Middleware**: el `matcher` cubre las rutas de la app; un directorio de páginas nuevo fuera del matcher tiene que gatear solo. 🟡 si no lo hace.
4. **Sin sesión, con Playwright, SOLO GET a páginas** de la URL de producción: las páginas de la app tienen que terminar en el login. 🔴 cualquier página de la app que renderice datos sin sesión. **No hagas requests a `/api/*`** (ni GET ni POST): algunos GET escriben y otros los llaman los jobs. La authz de las rutas API se revisa en el código (B1).
5. **Headers y cookies** (Playwright, respuesta del documento): CSP, HSTS, `X-Frame-Options`/`frame-ancestors`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, cookies de auth con `Secure`/`HttpOnly`/`SameSite`. Compara contra la config del framework. 🟡 lo que se aflojó; lo aceptado en el baseline no.

### C. IA y archivos que llegan de afuera

1. **Lenguaje natural → consulta** (si el producto lo tiene): ¿con qué rol se ejecuta lo que arma el modelo? ¿Está limitado a vistas de solo lectura, con límite de filas y timeout, y nunca con el service role? 🔴 cualquier camino donde texto generado por un modelo se ejecute como SQL con privilegios o fuera de los datos del que pregunta.
2. **Salida de modelos que escribe**: ¿pasa por un control (validación, aritmética, aprobación) antes de aprobar o escribir algo? 🟡 un camino nuevo donde la salida de un modelo escriba sin gate.
3. **Archivos y webhooks de afuera** (uploads, adjuntos de mail, ZIPs, planillas): límites de tamaño y de expansión, allowlist de hosts para descargas (anti-SSRF), firma de los webhooks, anti-replay. 🔴 que se caiga una de esas defensas.
4. **Costo de IA como abuso** (si hay un registro de uso): costo de los últimos 7 días por usuario. 🟡 un usuario con un costo diario más de 5 veces su mediana de 30 días.

### D. Secretos y configuración

1. **Secretos en el repo** (`git grep -nIE` sobre `origin/main`): `sb_secret_`, `sk-ant-`, `\bsk-[A-Za-z0-9]{20,}`, `AIza[0-9A-Za-z_-]{30,}`, `rk_live_`, `-----BEGIN [A-Z ]*PRIVATE KEY-----`, `password`/`contraseña` con un valor literal en `.env*.tpl`, `.env*.example`, `*.md`, `scripts/*`. Reporta **archivo:línea y el tipo**, NUNCA el valor (ni truncado). 🔴 un secreto real.
2. **Variables públicas del bundle** (`NEXT_PUBLIC_*` o equivalente): ninguna con un secreto. 🔴.
3. **Webhooks y jobs fail-closed**: sin el secreto configurado, responden 401/503 (no aceptan). 🔴 si uno pasa a aceptar sin secreto.
4. Lo que NO puedes ver: los valores y el alcance de las env vars del hosting (el MCP de Vercel no lista env) y los toggles del dashboard de la base. Dilo; no lo des por bueno.

### E. Accesos (mínimo privilegio, solo conteos)

Usuarios con rol de administrador, cuentas con acceso y sin login en 60 días, invitaciones pendientes de más de 30 días, API keys sin revocar. 🟡 cuentas con acceso a datos de clientes y sin uso en 60 días. Siempre por rol, nunca por mail.

### F. Dependencias

`pnpm audit --prod --json` (o el del package manager del repo) en la copia del repo (best-effort: si Bash o la red fallan, dilo). 🔴 critical/high con un camino alcanzable desde input externo; 🟡 el resto de high. Si una vulnerabilidad es de una dependencia que comparten otros productos del equipo (el framework, el cliente de la base), dilo en el brief para que el review de los otros proyectos la cruce el mismo día.

## Severidad y dedupe

- 🔴 explotable hoy o expone datos de clientes · 🟡 hardening pendiente o regresión de una defensa · 🟢 informativo (solo en el brief) · ⚪ no verificado.
- Antes de crear un issue, busca en Linear la **misma causa raíz** (abiertos, `Canceled`/`Duplicate` de cualquier fecha, `Done` de 45 días). Abierto → comenta ese issue solo si empeoró. `Canceled` → no lo levantes salvo que empeore de forma medible. `Done` que volvió → issue nuevo que cita al viejo (regresión).
- Lo del baseline (S*) que todavía no tiene issue: ábrelo si lo confirmas abierto en esta corrida.

## Output

1. **Un `[QA-sec] <qué>` por hallazgo nuevo 🔴/🟡** en el team del proyecto (Backlog, label `agent-proposal`, sin asignar, sin prioridad). Body: severidad, área, evidencia (`archivo:línea` en `origin/main`, la query de catálogo o el header observado — nunca datos de clientes ni secretos), impacto, cómo reproducirlo sin mutar nada, e hipótesis de fix para Cody (con el ID del baseline si aplica). **Máximo 5 por corrida**, por severidad; el resto va listado en el brief.
2. **`[Report] seguridad YYYY-MM-DD — <🟢 sin cambios | 🟡 … | 🔴 …>`** (Backlog, label `agent-report`): semáforo por área (A–F), lo nuevo, lo que se cerró desde la corrida anterior, los inventarios que vas a comparar la próxima vez (rutas, funciones `SECURITY DEFINER`, tablas, buckets) y lo que no pudiste verificar. Si nada cambió desde el reporte anterior y no hay hallazgos nuevos, **no lo crees**: alcanza con el espejo en `queue/pending-review/`.
3. **Brief como `result`**: veredicto arriba (✅ / ⚠️ / ❌), el mismo contenido, y una última línea `Issues: <TEAM>-XX, … — <urls>` o `Sin issue: <razón>`. Si `create_issue` falla, pega el error textual en esa línea y deja los hallazgos completos en el brief.

## Límites (HARD STOPS)

- **Nunca te logueas** en el producto ni pruebas credenciales, aunque encuentres una (es un hallazgo, no una llave). Nunca creas cuentas ni disparas un signup, un magic link o un reset de contraseña.
- **Nunca mutas nada**: sin POST, sin requests a `/api/*`, sin abrir links firmados de mails, sin correr los scripts del repo del producto (varios escriben en producción), sin levantar el dev server.
- SQL solo de lectura y sobre catálogo o agregados: nunca filas de tablas de negocio en el reporte.
- No lees ni imprimes valores de env. No usas el token de Vercel por fuera del MCP.
- No arreglas: si algo amerita fix, descríbelo para que el owner se lo pase a Cody.
