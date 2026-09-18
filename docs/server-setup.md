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

**Solo lectura en Supabase:** el PAT en sí NO es de solo lectura (es un token de cuenta). La solo lectura la fuerza el MCP con `--read-only --project-ref` (ya configurado en el `.mcp.json`).

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

## 6. MCPs (configurados en el repo)

`plugins\team-growth\.mcp.json` (referenciado desde `project.json → mcpConfig`) trae:
- `supabase` — solo lectura, acotado al proyecto. **Lee.**
- `linear` — remoto (`https://mcp.linear.app/mcp`), Bearer con `${LINEAR_API_KEY}`. **Escribe issues y comentarios.**

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

**Cerrar el loop en el server.** Un PR de Alfred mergeado no llega a la copia viva hasta que la actualizas. `scripts/sync-agents-repo.ps1` hace `git pull --ff-only`, pero **solo si el working tree está limpio** (nunca pisa tu WIP) y solo si es fast-forward:
- **A mano**, después de mergear: `powershell -File scripts\sync-agents-repo.ps1`.
- **Piggyback en Alfred**: el sweep diario lo llama al inicio (depende de que ese cron esté activo).
- **Cron dedicado (recomendado)**: `automation/n8n/sync-agents-repo.json` lo corre cada pocas horas, sin llamar a `claude` (costo cero). Se importa inactivo; actívalo.

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

**Permisos:** estas skills **leen** la base y **crean un issue en Linear** (vía MCP). El allowlist es `Read,mcp__supabase__*,mcp__linear__*` y nada más.

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
- Crons de ejemplo: `signup-to-paid-tracker`, `funnel-monitor`, `greta-seo-weekly`, `greta-aeo-weekly`, `qualy-prod-smoke`, `qualy-log-review`, `leda-blog-publisher`, `leda-publish-tick`, `alfred-daily-sweep`, `sync-agents-repo`, `core-health-check`, `core-auth-probe`.

Cada cron es `Schedule Trigger → Execute Command (wrapper) → NoOp`. Impórtalos **inactivos**, pruébalos con **Execute Workflow** y recién después actívalos. Configura la zona horaria del workflow a la tuya.

Para los crons, n8n **no** necesita un nodo de Linear: el agente escribe el issue solo vía MCP.

> **Nunca re-importes a ciegas** el JSON del repo encima de un workflow ya publicado: la versión viva puede haber cambiado en la UI. Exporta la versión viva o aplica el diff mínimo.

## 10. Salud del sistema y recuperación

- `scripts\run-health-check.ps1` detecta fallas silenciosas: un probe real de auth (`claude -p "OK"` — `claude --version` no ve un logout de OAuth), clusters de errores en el audit, archivos `.env` faltantes, `teamId` incompletos, crons que no dejaron su brief a tiempo y timeouts. Si encuentra problemas crea un `[Alert]` en Linear y sale con código 1 (n8n en rojo). Crons: `core-health-check` (completo) y `core-auth-probe` (`-AuthOnly`, liviano).
- `scripts\recover-failed-runs.ps1` lista (y con `-Execute` re-corre) las corridas con `is_error` del audit, por ejemplo después de un logout de OAuth que tiró a todo el roster. Un webhook de Linear ya consumido no se reintenta solo; esto te deja recuperarlo.

## 11. Roles en el listener

Cada agente tiene un `OperatingMode` en `scripts/agents.ps1` que define su loadout:

- **Numa / Greta** — `comment-only`. Leen, consultan sus fuentes y dejan UN comentario.
- **Capi** — `lead-triage-and-create`. Lee, rutea, comenta y **puede crear issues** (`[Proposal]`, Backlog, sin asignar). No escribe archivos ni cambia estado/prioridad/asignación de issues existentes.
- **Pico** — `creates-issues`. Además de comentar, crea issues `[Proposal]` con citas concretas del repo del producto. Si la propuesta toca UI, carga el design system o sugiere un mockup de Daly.
- **Cody** — `writes-code`. Lee y **escribe código en el repo del producto** (`productRepoPath`), crea ramas `cody/*` y abre PRs. Si existe un brief de Daly en `design/<proyecto>/<IssueId>-<slug>/`, lo usa como spec y al terminar lo archiva en `implemented/`. No mergea ni cambia el estado del issue. Requiere `gh auth login` (o `GH_TOKEN`) una vez.
- **Qualy** — `qa-tests` + MCP con Playwright. QA de previews de PRs, smoke no destructivo de producción y revisión de logs. Reporta PASS/FAIL; no escribe código.
- **Daly** — `design-creates-mockups` + MCP con Playwright. Comenta y **escribe mockups** (HTML/CSS autocontenido) + `brief.md` en `design/`. Nunca escribe en el repo del producto.
- **Leda** — `content-publishes` + `scripts/leda-helpers.ps1` (API del CMS + generación de imágenes). Cron diario que mejora drafts del blog, genera la imagen, agenda la publicación con ventana de cancelación y crea un issue `[Content]`; un tick periódico publica lo que venció. Nunca escribe en el repo del producto.
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
- [ ] (Alfred) label `alfred` + clon en `ALFRED_REPO_PATH` + `Alfred` en la regex del listener + `-DryRun` dice modo PR
- [ ] (Cody) `gh auth login` → `gh repo view your-org/acme-app` responde OK
- [ ] Health-check activo (`core-health-check` + `core-auth-probe`)
- [ ] Dejarlo correr unos días y revisar
