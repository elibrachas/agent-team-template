# Agregar un proyecto nuevo al equipo de agentes

> Checklist canónico (≤1 página). El modelo está en `projects/README.md`. Tiempo estimado: 1-2 horas + lo que tardes en redactar el contexto. Punto de partida: copiar `projects/acme/`.

## 1. Linear
- [ ] Crear el team en tu workspace (ej. `XYZ`). Anotar el **teamId** (UUID — se ve en la URL de settings del team o vía API `team { id }`).
- [ ] Crear los labels `agent-proposal` y `agent-report` en el team (y `alfred`, `seo`, `aeo` si vas a usar esos flujos).

## 2. Bundle del proyecto
- [ ] `projects/<slug>/project.json` — copia el de `projects/acme/` y completa: `name`, `ownerName` (se interpola como `{{OWNER_NAME}}` en los prompts), `linear` (`workspace` / `teamKey` / **`teamId`**), `productRepoPath` (relativo a la raíz del repo de agentes, ej. `..\\..\\<slug>-app`), **`productRepoUrl`** (URL canónica del repo, ej. `https://github.com/your-org/<slug>-app` — sin `.git`), `productUrl`, `productStack`, `languageConvention`, `strategicFocus` y los agentes habilitados.
  - `productRepoUrl` es lo que Cody compara contra `git remote -v` antes de cualquier edit: si apunta a otro `owner/repo`, aborta. Verifica que sea el nombre ACTUAL del repo (`gh api repos/<owner>/<repo> --jq .full_name`). Si el repo se renombró, GitHub redirige y el clon local puede seguir con la URL vieja: corrígelo con `git remote set-url origin <productRepoUrl>.git`.
- [ ] **¿El producto vive en varios repos?** Decláralos en `productRepos` (modelo en `projects/README.md` § Productos multi-repo; ejemplo en `projects/acme/project.json`) y clona cada uno en el server en el `path` declarado. Numa, Greta y Pico los leen todos (solo lectura); Cody escribe solo en los que no tienen `readOnly: true`, y por defecto en `productRepoPath`. Para mantener las copias al día: `scripts/sync-product-repos.ps1 -Project <slug>` (los wrappers ya lo corren antes de leer código; un cron diario lo cubre en los días sin corridas).
- [ ] Los archivos de contexto: `brand-bible.md`, `glossary.md`, `data-model.md`, `icp.md`, `product-catalog.md` y un `roadmap.md` semilla. Atajo: pídele a Claude que los redacte a partir del repo del producto y revísalos.
- [ ] `agent-overrides/<agente>.md` para los agentes cuyo rol cambia en este proyecto. Mínimo recomendado: `cody.md` (package manager + gating + lista NO-TOCAR), `daly.md` (dónde vive el design system), `numa.md` (fuentes activas), `qualy.md` (suite y rutas de smoke). Si un agente no aplica, `"enabled": false` en `project.json`.

## 3. Secretos y MCP
- [ ] Supabase (si aplica): crear un PAT (no existe PAT read-only; el MCP fuerza `--read-only`) y anotar el project ref.
- [ ] ¿La base del producto es MySQL (no Supabase)? MCP `mysql` read-only (`scripts/mcp-mysql/`): usuario con GRANT por columna + túnel SSH con `scripts/db-tunnel.ps1 -Project <slug>` (bloque `dbTunnel` en `project.json` o `DB_TUNNEL_*` en `.env.<slug>`); receta en `docs/mysql-readonly-source.md`.
- [ ] ¿El producto deploya en Vercel? Bloque `vercel` en `project.json` (`teamId` + `projects[{ key, id, name, role }]` — el `prj_...` sale de Vercel → Project → Settings → General) y el server `vercel` en el `.mcp.json` + `qa.mcp.json` del proyecto. No hay secreto nuevo: el token es el de `.env.server`. Si el proyecto está en OTRA cuenta de Vercel, necesita su propio `VERCEL_API_TOKEN` en `.env.<slug>`. Receta: `docs/vercel-readonly-source.md`.
- [ ] ¿Hay gasto en Google Ads? MCP oficial de solo lectura con la service account de GA4 y rol «Solo lectura» en la cuenta: `docs/google-ads-readonly-source.md`. El customer ID va en los overrides de Numa y Greta.
- [ ] ¿Quieres el pulso diario del funnel en Discord (`funnel-daily-pulse`) o el changelog semanal de Pico también en Discord? Crea un webhook del canal y guárdalo en una env var de `.env.<slug>` (p. ej. `DISCORD_WEBHOOK_NUMA`); para el changelog, nombra esa variable en `project.json → shippedDigestDiscordWebhookVar`.
- [ ] `.env.<slug>` en el server (template: `.env.acme.example`; versiona tu propio `.env.<slug>.example` sin valores). Verifica `git check-ignore .env.<slug>`. Antes de activar cualquier cron del proyecto nuevo, el archivo tiene que existir: sin él, el proyecto corre sin sus secretos (el health check lo marca).
- [ ] El `.mcp.json` del proyecto (+ variantes `qa` / `design` / `seo` si Qualy, Daly o Greta están habilitados), referenciado desde `project.json → mcpConfig` / `mcpVariants`. Mismas `${VARS}` de siempre; los valores los pone `.env.<slug>`.
- [ ] Si Cody está habilitado: el repo del producto clonado en `productRepoPath` y `GH_TOKEN` con permisos sobre ese repo.
- [ ] Si Leda va a publicar en un blog (Payload CMS): `PAYLOAD_BASE_URL` + `PAYLOAD_API_KEY` + `GEMINI_API_KEY` en `.env.<slug>`, y un bloque `payload` en `project.json` con el mapping de campos (`agentFieldPrefix`, `publishedByAgentValue`, `imageStyleField`, `topics`, `guides`) y los datos que leen las skills (`baseUrl`, `adminUrl`, `localized`, `defaultAuthorId`); `scripts/leda-helpers.ps1` lo lee solo. Porta las skills `content-blog-{publisher,improver,publish-tick}` a `projects/<slug>/skills/` si necesitas ajustarlas.
- [ ] Si el blog trabaja con **banco de ideas** (collection `topics` en el CMS, `payload.topics = true`): copia `projects/acme/skills/content-topic-scan/` (skill + `topic-memory.md`) y adapta las fuentes de evidencia y las categorías. La carga la hace `scripts/seed-topics.ps1`, que deduplica contra todo el banco. Para arrancar con un banco lleno, un seed inicial en `projects/<slug>/content-topics-seed.json` (el default de `seed-topics.ps1`).
- [ ] Si el tick de publicación de Leda corre para este proyecto, suma su hora a `$TickProjects` en `scripts/run-health-check.ps1`: así el health check avisa si el tick no corrió o si un post vencido quedó sin publicar.

## 4. Smoke tests (sin n8n)
- [ ] `powershell -File scripts\respond-linear.ps1 -IssueId <KEY>-1 -AgentName capi -Project <slug> -DryRun` → revisa que el system prompt mencione el proyecto y el owner correctos.
- [ ] Crea un issue de prueba en el team y comenta `Capi: prueba el contexto del proyecto` (a mano: mismo comando sin `-DryRun`) → debe presentarse como equipo del proyecto nuevo.
- [ ] `Numa: ¿cuántas filas tiene <tabla>?` → debe leer la base del proyecto nuevo (si responde con datos de otro proyecto, el `.env.<slug>` no está pisando las vars).
- [ ] Si Cody aplica: `Cody: status del repo` → `git remote -v` del repo correcto.

## 5. Listener (un trigger por team)
- [ ] El nodo Linear Trigger de n8n obliga a elegir UN team, así que en el workflow vivo del listener: duplica un nodo trigger existente, elige el team nuevo, conéctalo al mismo IF, guarda y reactiva. El ruteo al proyecto es automático (teamId/prefijo contra `project.json`). Revisa que no queden webhooks viejos en Linear después de reactivar.

## 6. Crons (opcional)
- [ ] Por cada skill cron: `projects/<slug>/skills/<skill>/SKILL.md` (frontmatter con `agent:` + `schedule:`) + copiar `automation/n8n/_template-skill-cron.json` → `<slug>-<skill>.json` reemplazando `__PROJECT__` / `__SKILL__` / `__CRON__`. Importar en n8n inactivo → Execute Workflow → activar.

## 7. Soak
- [ ] Primera semana: revisa que ningún issue del proyecto nuevo salga con datos de otro proyecto (contaminación cruzada) y que los crons de los proyectos existentes no hayan regresionado.
