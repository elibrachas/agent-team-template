# Server setup (headless en **Windows**)

> Guía paso a paso para correr los agentes en un server **Windows** con n8n nativo, escribiendo en **Linear** (el team de cada proyecto, por ejemplo `ACM`). Los agentes no exponen nada al exterior.
> **Multi-proyecto:** además de `.env.server` (core), cada proyecto tiene un `.env.<slug>` (template versionado `.env.<slug>.example`) que el wrapper carga encima. Alta de un proyecto: [`add-a-new-project.md`](add-a-new-project.md).
> Conceptos y modelo HITL: [`runtime-deployment.md`](runtime-deployment.md). Convención de Linear: `memory/CLAUDE.md` → "Linear destination convention".

En toda esta guía el repo vive en **`C:\agents\agent-team-template`**. Si usas otra ruta, actualízala también en los comandos de los workflows de `automation/n8n/*.json`.

## 0. Qué vas a tener al final

A horario, n8n corre `claude -p` (vía un script de PowerShell) con una skill. La skill lee la base **en solo lectura** (MCP), arma el brief y **crea un issue en Linear directamente** (MCP remoto, estado `Backlog`, sin asignar). Además, el listener de Linear responde los comentarios `Nombre: ...`.

```
Schedule (n8n) ─► Execute Command: powershell -File scripts\run-skill.ps1 -Skill <skill> -Project acme
                     │  claude -p (Sonnet / Opus)
                     │   ├─ MCP supabase (read-only)  → lee datos
                     │   └─ MCP linear (Bearer)        → crea el issue en ACM
                     ▼
                queue/pending-review/<fecha>-<proyecto>-<skill>.md   (espejo local del brief)
```

## 1. Quién hace qué

- **n8n** = el reloj (cron) + el receptor de webhooks + quien corre el comando. No toca Linear directamente.
- **Claude Code (agente)** = lee la skill + la base (lectura) + escribe en Linear, todo vía MCP.
- **Linear MCP** es el remoto oficial → usa tu API key como Bearer, sin browser.

## 2. Requisitos en el server (Windows, PowerShell)

```powershell
# Node 18+:
winget install OpenJS.NodeJS.LTS        # o el instalador de nodejs.org
node -v

# Claude Code CLI:
npm i -g @anthropic-ai/claude-code
claude --version

# Git + GitHub CLI (para Cody, Alfred y el changelog de Pico):
winget install --id Git.Git
winget install --id GitHub.cli

# Clonar el repo FUERA de carpetas sincronizadas (OneDrive/Dropbox corrompen .git):
git clone https://github.com/your-org/agent-team-template.git C:\agents\agent-team-template
```

No necesitas `jq`: los wrappers usan `ConvertFrom-Json` nativo de PowerShell.

> Si n8n corre como servicio con otra cuenta de Windows, esa cuenta necesita `node` / `claude` en el PATH, acceso a la ruta del repo y el login de Claude Code (ver `CLAUDE_USERPROFILE` más abajo).

## 3. Login de Claude Code (billing)

Los wrappers corren contra el **login OAuth** de la CLI (suscripción de Claude) y **borran `ANTHROPIC_API_KEY` del env** antes de invocar `claude`, para que no se facture por API por accidente.

1. Con la cuenta que va a correr los agentes: `claude` → `/login` una vez.
2. Si n8n corre con otra cuenta de Windows, apunta `CLAUDE_USERPROFILE` (en `.env.server`) al perfil donde quedó el login (por ejemplo `C:\Users\<usuario>`). Los wrappers redirigen `USERPROFILE` ahí y agregan `.local\bin` al PATH.

## 4. Keys: qué necesitas y de dónde sale cada una

| Key | De dónde | Variable |
|-----|----------|----------|
| Linear API key | Linear → **Settings → Account → Security & Access → Generate API key** (`lin_api_...`) | `LINEAR_API_KEY` (`.env.server`) |
| GitHub token | GitHub → fine-grained token con acceso al repo del producto (y al de agentes, para Alfred) | `GH_TOKEN` (`.env.server`) |
| Supabase PAT | Dashboard → **Account → Access Tokens** → *Generate new token* (`sbp_...`) | `SUPABASE_ACCESS_TOKEN` (`.env.<slug>`) |
| Supabase project ref | El `<project-ref>` de la URL del proyecto | `SUPABASE_PROJECT_REF` (`.env.<slug>`) |
| GA4 / Search Console | Service account de Google Cloud con acceso de lectura a la propiedad | `GA4_PROPERTY_ID`, `GA4_SERVICE_ACCOUNT_JSON_PATH`, `GSC_SITE_URL` (`.env.<slug>`) |
| Stripe (opcional) | Restricted key de **solo lectura** | `STRIPE_RESTRICTED_KEY` (`.env.<slug>`) |
| CMS + imágenes (Leda, opcional) | API key de tu CMS + key de Gemini | `PAYLOAD_BASE_URL`, `PAYLOAD_API_KEY`, `GEMINI_API_KEY` (`.env.<slug>`) |
| Token de Vercel (deploys + logs, MCP read-only, opcional) | Vercel → Account Settings → Tokens. Va UNA vez en `.env.server`, no en cada `.env.<slug>`. Ver [`vercel-readonly-source.md`](vercel-readonly-source.md) | `VERCEL_API_TOKEN` (`.env.server`) |
| Base MySQL del producto (opcional) | Usuario de solo lectura con GRANT por columna + túnel SSH. Ver [`mysql-readonly-source.md`](mysql-readonly-source.md) | `MYSQL_*` (`.env.<slug>`) |
| Google Ads (opcional) | Sin key nueva: reusa la service account de GA4. Ver § 6d | — |
| Webhook de Discord (pulso diario, opcional) | Discord → canal → Editar → Integraciones → Webhooks → Nuevo → Copiar URL | p. ej. `DISCORD_WEBHOOK_NUMA` (`.env.<slug>`) |

**Solo lectura en Supabase:** el PAT en sí NO es de solo lectura (es un token de cuenta). La solo lectura la fuerza el MCP con `--read-only --project-ref` (ya configurado en el `.mcp.json`).

**Solo lectura en Vercel:** tampoco existe a nivel token (Vercel solo acota por team o proyecto y por vencimiento; el mismo token puede borrar proyectos y leer las env vars de producción). La fuerza el MCP propio `scripts/mcp-vercel/`: solo GET, pin de proyectos por `project.json → vercel` y salida redactada. Requiere `cd scripts\mcp-vercel; npm ci` una vez. Los agentes nunca usan el token por `curl` ni por el CLI `vercel`.

La lista completa con comentarios está en `.env.example` (core) y `.env.acme.example` (proyecto).

## 5. Secretos en el server → `.env.server` + `.env.<slug>`

No copies archivos de secretos desde otra máquina por carpetas sincronizadas. Créalos en la raíz del repo clonado:

```powershell
cd C:\agents\agent-team-template
Copy-Item .env.example .env.server
Copy-Item .env.acme.example .env.acme     # uno por proyecto: .env.<slug>
notepad .env.server                        # completa los valores
notepad .env.acme

# Restringir los archivos a tu usuario (equivalente a chmod 600):
icacls .\.env.server /inheritance:r /grant:r "$($env:USERNAME):(R,W)"
icacls .\.env.acme   /inheritance:r /grant:r "$($env:USERNAME):(R,W)"

git check-ignore .env.server .env.acme     # debe devolver ambos nombres
```

> **Gotcha:** si guardas los valores entre comillas (`KEY="valor"`), el loader de los wrappers las quita antes de exportar. Sin eso, un token viajaría con comillas y la API devolvería 401.

> **Gotcha de la carga en capas:** `.env.<slug>` se carga ENCIMA de `.env.server`, así que una variable con valor en el del proyecto pisa la del core. Dos casos que muerden: un `VERCEL_API_TOKEN=<valor viejo>` que quedó en un `.env.<slug>` (bórralo: el token vive en `.env.server`) y un `GA4_SERVICE_ACCOUNT_JSON_PATH` relativo que no existe en el server (usa la ruta absoluta del core: un path roto pisa el correcto y tumba los MCP de GA4, GSC y Google Ads).

> **¿Y 1Password?** En tu máquina puedes no tener ningún `.env` plano: con `scripts/op-env.mjs` los secretos viven en 1Password y se descifran a memoria (ver [`secretos.md`](secretos.md)). El server sigue usando `.env.server` + `.env.<slug>`, porque los wrappers los cargan directo.

## 6. MCPs (configurados en el repo)

`plugins\team-growth\.mcp.json` (referenciado desde `project.json → mcpConfig`) trae:
- `supabase` — solo lectura, acotado al proyecto. **Lee.**
- `linear` — remoto (`https://mcp.linear.app/mcp`), Bearer con `${LINEAR_API_KEY}`. **Escribe issues y comentarios.**
- `ga4`, `cwv`, `stripe`, `vercel` y `google-ads` — solo lectura. Los que necesitan instalación aparte tienen su sección o su doc: GA4 (`analytics-mcp`) y Google Ads por una herramienta de Python aislada (§ 6d), Vercel por `npm ci` ([`vercel-readonly-source.md`](vercel-readonly-source.md)). Si la base del producto es MySQL, el `.mcp.json` del proyecto suma `mysql` ([`mysql-readonly-source.md`](mysql-readonly-source.md)).

Hay variantes por uso (`qa.mcp.json` con Playwright para Qualy, `design.mcp.json` para Daly, `seo.mcp.json` y `aeo.mcp.json` para Greta), referenciadas desde `project.json → mcpVariants`. Los `${VAR}` se resuelven del **env del proceso**: el wrapper carga los `.env` antes de llamar a `claude`.

> Gotcha de Windows: los `.mcp.json` usan `command: "npx"`. Si Claude Code no encuentra `npx`, puede que necesites Node en el PATH del servicio o usar `npx.cmd`. Se ve en el smoke test.

### 6a. MCP de Google Search Console (para `seo-weekly-review` de Greta)

La revisión SEO semanal usa un MCP propio de **Search Console** (`scripts/mcp-gsc/`) además de GA4 y Core Web Vitals (`scripts/mcp-cwv/`). Vive en `plugins/team-growth/seo.mcp.json` y lo levanta `scripts/run-greta-seo.ps1`.

**Auth**: Search Console es data privada por propiedad → no sirve una API key. Reusa el **mismo service account de GA4** con scope `webmasters.readonly`.

1. **Instala las dependencias** (una vez): `cd scripts\mcp-gsc; npm install` (ídem `scripts\mcp-cwv`).
2. **Habilita la Search Console API** en el proyecto de Google Cloud del service account (*APIs & Services → Enable APIs*).
3. **Agrega el service account a la propiedad** en Search Console (*Settings → Users and permissions → Add user*, permiso de lectura).
4. **`GSC_SITE_URL`** debe coincidir con el **tipo exacto** de propiedad a la que el service account tiene acceso: una domain property es `sc-domain:acme.example`; una URL-prefix es `https://acme.example/`. Si no coincide, la API devuelve 403. Para ver qué propiedades ve el SA: `GET https://searchconsole.googleapis.com/webmasters/v3/sites`.

> **Degradación elegante**: si el MCP de Search Console falla (token, API, acceso), la skill corre igual con GA4 + CWV + Supabase + auditoría del frontend y marca la capa de búsqueda como "no disponible".

**Tools del MCP**: `gsc_query` (search analytics), `gsc_url_inspect` (indexación de una URL), `gsc_sitemaps` (sitemaps + errores).

```powershell
cd C:\agents\agent-team-template
powershell -ExecutionPolicy Bypass -NoProfile -File scripts\run-greta-seo.ps1 -Project acme -DryRun           # solo imprime la config
powershell -ExecutionPolicy Bypass -NoProfile -File scripts\run-greta-seo.ps1 -Project acme -Job weekly-review # corrida real
```

Escribe el brief en `queue/pending-review/`, crea los issues `[Report]` / `[Proposal]` (label `seo`) en Linear y reescribe su archivo de memoria (`seo-memory.md`). Cron: `automation/n8n/greta-seo-weekly.json`.

### 6b. Cron AEO de Greta (`aeo-weekly-review`) — sin requisitos nuevos

La revisión **AEO** (Answer Engine Optimization: aparecer citado en respuestas de asistentes de IA) corre vía `scripts/run-greta-aeo.ps1`. **Complementa al cron SEO, no lo reemplaza.** Su MCP config es mínima (`aeo.mcp.json` = supabase + linear + ga4) y el sondeo de answer-engines lo hace la tool **WebSearch** built-in, como proxy declarado.

Único punto a verificar en la primera corrida: que **WebSearch** esté habilitada en el headless (`--permission-mode dontAsk` + `WebSearch` en `--allowedTools`). Si no lo está, la skill degrada y marca el sondeo como "no disponible".

```powershell
powershell -ExecutionPolicy Bypass -NoProfile -File scripts\run-greta-aeo.ps1 -Project acme -DryRun
powershell -ExecutionPolicy Bypass -NoProfile -File scripts\run-greta-aeo.ps1 -Project acme -Job weekly-review
```

Crea el label `aeo` en Linear y agenda el cron `automation/n8n/greta-aeo-weekly.json` en un día distinto al de SEO.

### 6c. Alfred (meta-agente) — label + clon para PRs

**Alfred 🎩** mejora a los OTROS agentes: diagnostica la causa raíz de un mal comportamiento y, si amerita, cambia el sistema de agentes y **abre un PR contra este repo**. Corre por cron diario (`alfred-daily-sweep`) y por llamado directo (`Alfred: ...`). Método: [`alfred.md`](alfred.md). Wrapper: `scripts/run-alfred.ps1`.

1. **Label `alfred`** en el team de Linear.
2. **Clon limpio para los PRs** — Alfred NO commitea sobre la copia viva (que puede tener tu WIP). Usa un clon dedicado, en la rama base, que solo toca él:
   ```powershell
   git clone https://github.com/your-org/agent-team-template.git C:\agents\agent-team-template-alfred
   ```
   Y en `.env.server`:
   ```
   ALFRED_REPO_PATH=C:\agents\agent-team-template-alfred
   ALFRED_BASE_BRANCH=main
   ```
   `ALFRED_BASE_BRANCH` es la rama contra la que Alfred abre los PRs y desde la que crea sus ramas; el clon debe estar en esa misma rama. Si la variable apunta a una rama que ya no existe en origin, el `pull --ff-only` falla y Alfred degrada a PROPOSE en cada corrida. **Sin clon, Alfred corre igual en modo PROPOSE** (solo lectura, deja el diff propuesto como comentario en Linear).
3. **Regex del listener** — para el llamado directo, la regex del `linear-feedback-listener` debe incluir `Alfred`: `^(Capi|Numa|Greta|Pico|Cody|Qualy|Daly|Leda|Alfred):`. Si ya tienes el listener publicado, aplica el cambio mínimo sobre la versión viva en n8n (no re-importes el JSON encima).
4. **Cron** — importa `automation/n8n/alfred-daily-sweep.json` y actívalo.

```powershell
powershell -ExecutionPolicy Bypass -NoProfile -File scripts\run-alfred.ps1 -Project acme -Job sweep -DryRun   # imprime config + modo (PR/PROPOSE)
powershell -ExecutionPolicy Bypass -NoProfile -File scripts\run-alfred.ps1 -Project acme -Job sweep           # corrida real
```

**Cerrar el loop en el server.** Un PR de Alfred mergeado no llega a la copia viva hasta que la actualizas. `scripts/sync-agents-repo.ps1` deja la copia viva en `main` y hace `git merge --ff-only` **aun con WIP sin commitear** (la copia viva casi nunca está limpia: los agentes reescriben memorias y roadmaps versionados en cada corrida, y exigir el árbol limpio dejaba la copia viva atrás durante semanas). Si un archivo con cambios locales choca con un commit entrante, descarta SOLO ese archivo (tras un backup con fecha en `queue/sync-backups/`) y reintenta; el resto del WIP no se toca y nunca usa stash, reset ni force. Si aun así no puede hacer fast-forward, deja UN `[Alert]` en Linear con el motivo y los archivos (uno solo mientras siga abierto), en el team del proyecto "home de ops" (`-OpsProject <slug>`, default `acme`). Si la copia viva está en otra rama que ya se mergeó, vuelve a `main`; si esa rama tiene trabajo sin mergear, no cambia de rama y avisa.
- **A mano**, después de mergear: `powershell -File scripts\sync-agents-repo.ps1`.
- **Piggyback en Alfred**: el sweep diario lo llama al inicio (depende de que ese cron esté activo).
- **Cron dedicado (recomendado)**: `automation/n8n/sync-agents-repo.json` lo corre cada pocas horas, sin llamar a `claude` (costo cero). Se importa inactivo; actívalo.

### 6d. MCP de Google Ads (solo lectura, para Numa y Greta)

Gasto, clics y conversiones por campaña y por día, para calcular CAC y ROAS. Es el MCP **oficial** de Google (`google-ads-mcp`, versión fijada) y va en el `.mcp.json` default del proyecto (bloque `google-ads`). Detalle completo, errores y cómo leer los datos: [`google-ads-readonly-source.md`](google-ads-readonly-source.md).

**Sin key nueva.** Reusa la **misma service account de GA4** (`GA4_SERVICE_ACCOUNT_JSON_PATH`) y no lleva developer token: Google los dio de baja y el acceso ahora lo da el proyecto de Google Cloud. Google Ads no tiene scope de solo lectura, así que el solo-lectura lo ponen las tools del MCP (solo leen) **y** el rol «Solo lectura» de la service account en la cuenta de Google Ads.

1. Del lado de Google, una vez: habilita la Google Ads API en el proyecto de Google Cloud de la service account, pide el nivel de acceso **Explorer** en *Google Ads API → Overview* y agrega la service account en Google Ads → Administrador → Acceso y seguridad con rol **«Solo lectura»**.
2. En el server, con el usuario que corre los agentes, instálalo como herramienta de Python aislada. Si el server no tiene Python, usa **`uv`** (trae su propio Python): `winget install --id astral-sh.uv -e`, abre otra consola y `uv tool install "google-ads-mcp==<versión>" --python 3.13`. Con Python, sirve igual `python -m pipx install "google-ads-mcp==<versión>"`. Los dos dejan el `.exe` en `%USERPROFILE%\.local\bin` (lo confirma `uv tool dir --bin`). El `.mcp.json` lo llama como `google-ads-mcp`, así que esa carpeta tiene que estar en el PATH del proceso de los agentes (los wrappers la suman desde `CLAUDE_USERPROFILE`); si no, pon la ruta absoluta en el `command` del bloque. Hazlo **antes** de que el `.mcp.json` con el bloque llegue a la copia viva: si no, cada corrida anota un MCP que no levanta.
3. `.env.server`: nada nuevo. Si hay una línea `GOOGLE_ADS_DEVELOPER_TOKEN=...`, bórrala.
4. Smoke directo (comando en el doc) y después un `Numa: ¿cuánto gastamos ayer en Google Ads?` en un issue del team.

## 7. El wrapper de corrida (PowerShell)

`scripts\run-skill.ps1`. Pruébalo a mano:

```powershell
cd C:\agents\agent-team-template
powershell -ExecutionPolicy Bypass -NoProfile -File scripts\run-skill.ps1 -Skill signup-to-paid-tracker -Project acme -DryRun
powershell -ExecutionPolicy Bypass -NoProfile -File scripts\run-skill.ps1 -Skill signup-to-paid-tracker -Project acme
```

Flags usadas: `--model`, `--mcp-config`, `--strict-mcp-config`, `--permission-mode dontAsk`, `--allowedTools`, `--max-budget-usd`, `--output-format json`. Si actualizas la CLI, revalida con `claude --help`: los nombres de las flags cambian entre versiones.

Lo que conviene entender del wrapper:
- **`--strict-mcp-config`**: usa SOLO los MCP del config del proyecto (no mezcla con MCP configurados a nivel usuario). Determinismo en el server.
- **`--permission-mode dontAsk`** + allowlist: en headless no hay TTY para aprobar, así que los tools fuera del allowlist se **deniegan** (no se cuelga). Si una corrida falla por permiso denegado, ajusta `--allowedTools`.
- **Guard por tiempo**: cada agente declara `TimeoutMinutes` en `scripts/agents.ps1`; un watchdog mata el árbol de procesos al vencer (`AGENT_TIMEOUT_MINUTES` lo pisa globalmente). `--max-budget-usd` (`PER_RUN_BUDGET_USD`) queda como respaldo.
- **Audit**: cada corrida agrega una línea a `audit/YYYY-MM-DD.jsonl` (modelo, costo nominal, duración, `timed_out`, `is_error`).

**Permisos:** estas skills **leen** la base y **crean un issue en Linear** (vía MCP). El allowlist es `Read,mcp__supabase__*,mcp__linear__*` y nada más. Si la skill declara `agent:` en el frontmatter, la allowlist y el modelo salen del registry del agente; una skill puede sumar tools con `extra_allowed_tools` y elegir otra variante de MCP con `mcp_variant` sin tocar el registry.

**Destino Discord:** con `-DiscordWebhookVar <VAR>` (el NOMBRE de una env var de `.env.<slug>`, nunca el webhook) la corrida termina en un mensaje de Discord: el agente deja el texto entre una línea `<discord>` y una línea `</discord>` y el wrapper postea solo ese bloque (con `allowed_mentions` vacío: un `@everyone` del agente no notifica a nadie). Lo usa `funnel-daily-pulse` de Numa.

> **Por qué el agente NO tiene `Write`:** en Windows, las reglas `Write(<glob>)` no matchean la ruta absoluta que usa la tool, y un `Write` pelado dejaría al agente tocar cualquier archivo del repo. Solución: el agente **devuelve el brief como respuesta final** y el wrapper lo escribe en `queue/pending-review/`.

## 8. Smoke tests (antes de automatizar)

```powershell
claude --version
claude --help            # anota los nombres reales de las flags
```
1. Corre la skill a mano (paso 7): debe **devolver números** de la base, no un error de permiso o conexión.
2. Verifica en Linear (team `ACM`) que apareció el issue: estado `Backlog`, sin asignar, label correcto.
3. Si se cuelga esperando aprobación → el `--permission-mode` o el allowlist están mal; ajusta hasta que corra solo.
4. Listener sin n8n: `powershell -File scripts\respond-linear.ps1 -IssueId ACM-1 -AgentName capi -Project acme -DryRun` → revisa el prompt resuelto.

## 9. Conectar n8n (Windows nativo)

Los workflows están versionados en **`automation/n8n/`**: impórtalos, no los armes a mano (ver `automation/n8n/README.md`).

- `linear-feedback-listener.json` — webhook de Linear → `respond-linear.ps1`. Es lo que hace funcionar los `Nombre:`. Necesita una credencial de Linear en n8n y un trigger por team.
- `_template-skill-cron.json` — base para automatizar cualquier skill (reemplaza `__PROJECT__` / `__SKILL__` / `__CRON__`).
- Crons de ejemplo: `signup-to-paid-tracker`, `funnel-monitor`, el pulso diario de Numa a Discord (`funnel-daily-pulse`), `greta-seo-weekly`, `greta-aeo-weekly`, `qualy-prod-smoke`, `qualy-log-review`, la revisión de seguridad de Qualy (`security-review`), el scan de temas de Leda (`content-topic-scan`), `leda-blog-publisher`, `leda-publish-tick`, `alfred-daily-sweep`, `sync-agents-repo`, `sync-product-repos`, `core-health-check`, `core-auth-probe`.

Cada cron es `Schedule Trigger → Execute Command (wrapper) → NoOp`. Impórtalos **inactivos**, pruébalos con **Execute Workflow** y recién después actívalos. Configura la zona horaria del workflow a la tuya.

Para los crons, n8n **no** necesita un nodo de Linear: el agente escribe el issue solo vía MCP.

> **Nunca re-importes a ciegas** el JSON del repo encima de un workflow ya publicado: la versión viva puede haber cambiado en la UI. Exporta la versión viva o aplica el diff mínimo.

### 9a. El tick de Leda: una vez por día

El publisher de Leda escribe la nota de madrugada y la deja agendada unas horas después. Lo único que publica es el tick `content-blog-publish-tick`, y alcanza con correrlo **una vez por día, a primera hora**: cada nota sale con el primer tick posterior a su hora de agenda, y **la ventana para frenarla con `Leda: stop ACM-X` es hasta ese tick**. Si el tick corre antes de que venza la nota del día, sale a la mañana siguiente (casi un día entero de ventana); si corre después, sale ese mismo día. Elige la hora del tick según cuánta ventana quieres.

Los días sin post vencido el tick no llama a `claude`: `run-skill.ps1` resuelve la lista vacía y deja una línea `"model":"precheck"` en `audit\<fecha>.jsonl`. No le pongas `-Model` con Haiku al comando del tick: con Haiku el agente alucinaba que no podía ejecutar PowerShell y no publicaba.

El health check diario (`scripts/run-health-check.ps1`) compara cada proyecto contra la hora de su último tick (la de hoy si ya pasó, si no la de ayer; las horas están en `$TickProjects`). Avisa en dos casos:

- **Falta el brief de ese tick** en `queue\pending-review\`: el tick no corrió (o falló antes de escribir el brief). Mira las **Executions** del workflow en n8n.
- **Un post que vencía antes de ese tick sigue programado**: el tick corrió pero no lo publicó. El motivo está en el stdout de esa ejecución.

Una nota que tiene que salir antes del tick sale con **Execute Workflow** en el tick, o a mano:

```powershell
cd C:\agents\agent-team-template
powershell -ExecutionPolicy Bypass -NoProfile -File scripts\run-skill.ps1 -Skill content-blog-publish-tick -Project acme
```

### 9b. Zona horaria de n8n

Los workflows del repo traen `settings.timezone`, pero un workflow exportado desde la UI puede no tenerla, y entonces el cron dispara en la zona por defecto de n8n (America/New_York), que además cambia con el horario de verano de EE.UU. Se nota en Linear: los `[Report]` y los `[Alert]` llegan a otra hora que la que dice el cron. Para que cada cron corra a la hora que dice, agrega `GENERIC_TIMEZONE=<tu zona>` al entorno del servicio de n8n y reinícialo, o elige la zona en *Workflow → Settings → Timezone* de cada workflow. Después del cambio, revisa la hora del tick de Leda en el mismo cambio: un cron que dependía de la zona por defecto se corre.

## 10. Salud del sistema y recuperación

- `scripts\run-health-check.ps1` detecta fallas silenciosas: un probe real de auth (`claude -p "OK"` — `claude --version` no ve un logout de OAuth), clusters de errores en el audit, archivos `.env` faltantes, `teamId` incompletos, crons que no dejaron su brief a tiempo, timeouts y el tick de Leda (que no corrió, o que dejó un post vencido sin publicar; § 9a). Si encuentra problemas crea un `[Alert]` en Linear y sale con código 1 (n8n en rojo). Crons: `core-health-check` (completo) y `core-auth-probe` (`-AuthOnly`, liviano).
- `scripts\sync-product-repos.ps1 -Project <slug>` pone al día las copias locales de los repos del producto (`fetch` siempre; fast-forward solo en la rama por defecto y sin cambios trackeados; nunca fuerza nada). Los wrappers lo corren antes de leer código y un cron diario cubre los días sin corridas: una copia atrasada hace que los agentes analicen código que ya no existe.
- `scripts\recover-failed-runs.ps1` lista (y con `-Execute` re-corre) las corridas con `is_error` del audit, por ejemplo después de un logout de OAuth que tiró a todo el roster. Un webhook de Linear ya consumido no se reintenta solo; esto te deja recuperarlo.

## 11. Roles en el listener

Cada agente tiene un `OperatingMode` en `scripts/agents.ps1` que define su loadout:

- **Numa / Greta** — `comment-only`. Leen, consultan sus fuentes y dejan UN comentario.
- **Capi** — `lead-triage-and-create`. Lee, rutea, comenta y **puede crear issues** (`[Proposal]`, Backlog, sin asignar). No escribe archivos ni cambia estado/prioridad/asignación de issues existentes.
- **Pico** — `creates-issues`. Además de comentar, crea issues `[Proposal]` con citas concretas del repo del producto. Si la propuesta toca UI, carga el design system o sugiere un mockup de Daly.
- **Cody** — `writes-code`. Lee y **escribe código en el repo del producto** (`productRepoPath`), crea ramas `cody/*` y abre PRs. Si existe un brief de Daly en `design/<proyecto>/<IssueId>-<slug>/`, lo usa como spec y al terminar lo archiva en `implemented/`. No mergea ni cambia el estado del issue. Requiere `gh auth login` (o `GH_TOKEN`) una vez.
- **Qualy** — `qa-tests` + MCP con Playwright. QA de previews de PRs, smoke no destructivo de producción, revisión de logs (Supabase + Vercel por el MCP read-only `mcp__vercel__*`) y revisión semanal de seguridad (`security-review`). Reporta PASS/FAIL; no escribe código.
- **Daly** — `design-creates-mockups` + MCP con Playwright. Comenta y **escribe mockups** (HTML/CSS autocontenido) + `brief.md` en `design/`. Nunca escribe en el repo del producto.
- **Leda** — `content-publishes` + `scripts/leda-helpers.ps1` (API del CMS + generación de imágenes) + `scripts/seed-topics.ps1` (banco de ideas). Scan semanal que carga ideas al banco `topics`, cron diario que escribe una nota desde ese banco (o el refresh de una publicada), genera la imagen, la agenda con ventana de cancelación y crea un issue `[Content]`; un tick diario publica lo que venció (§ 9a). Nunca escribe en el repo del producto.
- **Alfred** — wrapper dedicado (ver 6c).

## 12. Checklist

- [ ] Node 18+ + Claude Code CLI (`claude --version`) + `/login` hecho
- [ ] Repo clonado fuera de carpetas sincronizadas (`C:\agents\agent-team-template`)
- [ ] API key de Linear + PAT de Supabase + `GH_TOKEN` generados
- [ ] `.env.server` y `.env.<slug>` creados + `icacls` + `git check-ignore` OK
- [ ] `claude --help` → flags reales verificadas contra los wrappers
- [ ] Smoke test a mano → números de la base OK
- [ ] Issue de prueba en Linear OK (estado / label / sin asignar)
- [ ] Labels creados en Linear: `agent-proposal`, `agent-report` (+ `seo`, `aeo`, `alfred` si aplica)
- [ ] Listener importado + credencial de Linear + prueba con `Capi: hola`
- [ ] Crons importados + probados con Execute Workflow + activados de a uno
- [ ] (Greta SEO) `npm install` en `scripts\mcp-gsc` y `scripts\mcp-cwv` + Search Console API + SA con acceso + `GSC_SITE_URL`
- [ ] (Vercel, opcional) `npm ci` en `scripts\mcp-vercel` + `VERCEL_API_TOKEN` en `.env.server` (y ningún `VERCEL_API_TOKEN` viejo en los `.env.<slug>`) + `scripts\run-qualy.ps1 -Job log-review -Project <slug> -DryRun` muestra la línea `Vercel :` con el pin y `token cargado`
- [ ] (MySQL, opcional) usuario con GRANT por columna + túnel SSH + `MYSQL_*` en `.env.<slug>` + `npm ci; npm test` en `scripts\mcp-mysql`
- [ ] (Google Ads, opcional, § 6d) API habilitada + nivel Explorer + service account con rol «Solo lectura» en la cuenta + `google-ads-mcp` instalado con `uv tool` o `pipx` + smoke OK + `Numa:` contesta el gasto de ayer
- [ ] (Discord, opcional) webhook del canal en `.env.<slug>` + `run-skill.ps1 -Skill funnel-daily-pulse -Project <slug> -DiscordWebhookVar <VAR> -DryRun` muestra `Discord : <VAR> → configurado`
- [ ] (Leda) tick diario a la hora que quieras (§ 9a) + su hora en `$TickProjects` del health check
- [ ] (opcional, § 9b) zona horaria de n8n configurada (`GENERIC_TIMEZONE`) y la hora del tick de Leda revisada en el mismo cambio
- [ ] (Alfred) label `alfred` + clon en `ALFRED_REPO_PATH` + `Alfred` en la regex del listener + `-DryRun` dice modo PR
- [ ] (Cody) `gh auth login` → `gh repo view your-org/acme-app` responde OK
- [ ] Health-check activo (`core-health-check` + `core-auth-probe`)
- [ ] Dejarlo correr unos días y revisar
