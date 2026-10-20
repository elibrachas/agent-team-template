# projects/ — un bundle de configuración por proyecto

El equipo de agentes (Capi / Numa / Greta / Pico / Cody / Qualy / Daly / Leda) es **uno solo y compartido**: su identidad y sus workflows viven en `scripts/agents.ps1` (el **core**). Lo que cambia por proyecto es el **contexto**, y todo el contexto vive aquí, un directorio por producto:

```
projects/<slug>/
├── project.json              metadatos + paths + IDs (lo consume scripts/project.ps1);
│                             productRepos[] si el producto vive en VARIOS repos;
│                             vercel{} = qué proyectos de Vercel puede leer el MCP read-only;
│                             payload{} = el contrato del CMS del blog (Leda)
├── brand-bible.md            voz, posicionamiento, no-go zones, crisis playbook
├── glossary.md               métricas, etapas del funnel y definiciones canónicas
├── data-model.md             tablas + queries canónicas + caveats de calidad de datos
├── icp.md                    ICP, personas, triggers, objeciones, anti-personas
├── product-catalog.md        planes, precios, límites, surfaces de checkout, semáforo por feature
├── design-system.md          dónde viven los tokens y componentes en el repo del producto
├── roadmap.md                ledger del plan priorizado (lo reescribe Capi)
├── qualy-front-memory.md     ledger de hallazgos de QA/seguridad (lo reescribe Qualy)
├── blog-taxonomy.md          categories + tags del blog (Leda)
├── content-references.md     fuentes de autoridad para links externos (Leda)
├── image-style-families.md   familias visuales para las imágenes del blog (Leda)
├── content-topics-seed.json  (opcional) seed inicial del banco de ideas del blog (scripts/seed-topics.ps1)
├── agent-overrides/          (opcional) <agent>.md — reglas del agente EN ESTE proyecto
├── skills/<skill>/SKILL.md   (opcional) skills propias del proyecto (los wrappers buscan aquí primero)
└── *.mcp.json                (opcional) MCPs propios del proyecto (mismas ${VARS}, valores de .env.<slug>)
```

`projects/acme/` es un **proyecto de ejemplo** (Acme es un SaaS ficticio): cópialo como punto de partida y reemplaza todo. Los archivos de contexto traen una guía de qué documentar en cada sección + ejemplos falsos; lo que tienes que completar está marcado con `TODO(acme):`. Los archivos del blog (Leda) solo hacen falta si usas ese flujo. Trae también tres skills de ejemplo en `projects/acme/skills/`: `content-topic-scan` (Leda, banco de ideas del blog), `funnel-daily-pulse` (Numa, pulso diario a Discord) y `security-review` (Qualy, revisión semanal de seguridad).

## Schema de `project.json`

| Campo | Obligatorio | Qué es |
|-------|-------------|--------|
| `slug` | sí | Identificador corto (`acme`). Es el valor de `-Project` en los wrappers y el sufijo de `.env.<slug>`. |
| `name` | sí | Nombre visible del producto. Se interpola como `{{PROJECT_NAME}}`. |
| `ownerName` | recomendado | Nombre de la persona dueña del producto y de las aprobaciones. Se interpola como `{{OWNER_NAME}}` en los prompts (fallback: "el owner"). |
| `linear.workspace` | sí | Slug del workspace de Linear. |
| `linear.teamKey` | sí | Key del team (`ACM`). Se interpola como `{{LINEAR_TEAM_KEY}}`; es el prefijo de los ids de issue. |
| `linear.teamId` | sí | UUID del team. El listener de n8n lo manda en el webhook y `respond-linear.ps1` resuelve el proyecto con `Resolve-ProjectSlugFromLinearTeamId` (falla ruidoso si ningún `project.json` matchea). Vacío = nada rutea a este proyecto todavía (sirve para dar de alta un bundle antes de crear el team). |
| `productRepoPath` | sí | Path relativo al repo **primario** del producto (`..\..\acme-app`). `{{PRODUCT_REPO_PATH}}`; es el `--add-dir` de los agentes que leen o escriben código y el destino por defecto de Cody. |
| `productRepoUrl` | recomendado | URL canónica del repo (`https://github.com/your-org/acme-app`). `{{PRODUCT_REPO_URL}}`. Cody la usa para verificar `git remote -v` **antes de cualquier edit**: si el `origin` apunta a otro repo, aborta. |
| `productRepos` | opcional | Lista de repos cuando el producto vive en varios (ver "Productos multi-repo"). Sin este campo, el único repo es `productRepoPath`. |
| `productUrl` | sí | URL de producción (`https://acme.example`). `{{PRODUCT_URL}}`; la usan Qualy (smoke), Greta (SEO/AEO) y Leda. |
| `productionDomain` | opcional | Dominio canónico de producción, con `www` si el apex redirige. Ningún script lo lee: es la referencia para skills y overrides que arman URLs públicas (un apex que redirige puede perder headers como `Authorization`). |
| `productStack` | sí | Stack en una línea (framework, base, CMS, pagos, package manager, deploy). `{{PRODUCT_STACK}}`. |
| `vercel` | opcional | Pin del MCP read-only de Vercel: `teamId` + `projects[{ key, id, name, role }]` (ver "Vercel read-only"). |
| `dbTunnel` | opcional | Si la base del producto es MySQL en una VM: `host`, `user`, `localPort`, `remotePort` del túnel SSH que mantiene `scripts/db-tunnel.ps1 -Project <slug>` (las env vars `DB_TUNNEL_*` de `.env.<slug>` ganan). No son secretos. Ver `docs/mysql-readonly-source.md`. |
| `envFile` | sí | Archivo de variables del proyecto (`.env.acme`), que se carga encima de `.env.server`. |
| `contextDir` | sí | Directorio de contexto (`projects\acme`). `{{PROJECT_CONTEXT_DIR}}`. |
| `mcpConfig` | sí | MCP default de los agentes del proyecto (p. ej. `plugins\team-growth\.mcp.json`). |
| `mcpVariants` | opcional | Mapa `variante → archivo` para agentes/jobs con loadout propio: `qa`, `design`, `seo`, `aeo`. Fallback: `mcpConfig`. Una skill puede pedir una variante para sí misma con `mcp_variant:` en su frontmatter. |
| `payload` | opcional | Contrato del CMS del blog para el pipeline de Leda (ver "El bloque `payload`"). |
| `languageConvention` | sí | Convención de idioma del copy customer-facing. `{{LANGUAGE_CONVENTION}}`. |
| `strategicFocus` | sí | Foco estratégico actual (qué se prioriza, qué queda fuera de scope). `{{STRATEGIC_FOCUS}}`. |
| `shippedDigestFollowers` | opcional | Emails de Linear a sumar como seguidores del digest de lo shipeado. Vacío = nadie. |
| `shippedDigestDiscordWebhookVar` | opcional | NOMBRE de la env var de `.env.<slug>` con el webhook de Discord donde `run-pico-shipped.ps1` postea además un resumen del digest semanal. Vacío = sin Discord. Nunca el webhook en sí. |
| `agents.<nombre>.enabled` | sí | Qué agentes corren en este proyecto. |

Los bloques (`vercel`, `dbTunnel`, `payload`) y el objeto raíz aceptan una clave `$comment` para documentar el porqué; los scripts la ignoran. Para un campo suelto, el ejemplo de Acme usa `$comment_<campo>` al lado.

## Core vs. proyecto — regla de oro

Si un cambio mejora **cómo trabaja un agente** (workflow, guardrails, formato de salida, HARD STOPS) → va al **core** (`scripts/agents.ps1`, wrappers, skills genéricas de `plugins/`). Si cambia **el dominio** (qué tabla mirar, qué métrica vale, qué tono usar, qué stack tiene el producto, qué comandos corren los tests) → va a `projects/<slug>/` (contexto u override).

## Cómo se inyecta

- Los wrappers (`run-skill.ps1`, `respond-linear.ps1`, `run-qualy.ps1`, …) aceptan `-Project <slug>`.
- `scripts/project.ps1` → `Resolve-ProjectContext` carga `.env.server` y, si existe, `.env.<slug>` encima (limpiando antes las variables project-scoped — ver `$ProjectScopedVars`), así un proyecto nunca hereda credenciales de otro. Si el `project.json` tiene bloque `vercel`, exporta además el pin (`VERCEL_TEAM_ID` / `VERCEL_PROJECTS`).
- `Resolve-AgentPrompt` **concatena `agent-overrides/<agent>.md`** (si existe) al system prompt core y después interpola los placeholders (`{{OWNER_NAME}}`, `{{PROJECT_NAME}}`, `{{PROJECT_SLUG}}`, `{{LINEAR_TEAM_KEY}}`, `{{PRODUCT_REPO_PATH}}`, `{{PRODUCT_REPO_URL}}`, `{{PRODUCT_REPOS}}`, `{{CODE_REPOS}}`, `{{PRODUCT_URL}}`, `{{PRODUCT_STACK}}`, `{{LANGUAGE_CONVENTION}}`, `{{STRATEGIC_FOCUS}}`, `{{PROJECT_CONTEXT_DIR}}`) desde `project.json` — tanto en el core como en el override.
  - ⚠ **`{{STRATEGIC_FOCUS}}` no está en el prompt core de todos los agentes** (solo en los que priorizan: Capi, Greta, Pico). Los demás se enteran del foco por su `agent-overrides/<agent>.md` o por el `SKILL.md` de su cron. Al cambiar el foco, revisa ambos y verifica el prompt resuelto.
- Las skills se buscan primero en `projects/<slug>/skills/` y después en `plugins/*/skills/`: un proyecto puede reemplazar una skill genérica con una propia sin tocar el core.

## Productos multi-repo

Si el producto vive en varios repos (la app, el sitio de marketing, módulos, un core de otro dueño…), decláralos en `project.json` → `productRepos`:

```json
"productRepos": [
  { "key": "app",  "path": "..\\..\\acme-app",  "repoUrl": "https://github.com/your-org/acme-app",  "url": "https://app.acme.example", "role": "qué es y qué se mide ahí", "owner": "quién lo mantiene" },
  { "key": "site", "path": "..\\..\\acme-site", "repoUrl": "https://github.com/your-org/acme-site", "url": "https://www.acme.example", "role": "…", "readOnly": true }
]
```

- `productRepoPath` sigue siendo el repo **primario** (el destino por defecto de Cody y el de los wrappers de un solo repo). Inclúyelo también en la lista.
- Los agentes de análisis (Numa, Greta, Pico) usan `AdditionalDirs = @('{{PRODUCT_REPOS}}')`: reciben TODOS los repos montados en solo lectura + la lista con roles en el prompt (`{{PRODUCT_REPOS}}`). Los wrappers de Greta (SEO/AEO) montan todos vía `Get-ProjectRepoAddDirArgs`.
- Cody usa `{{WRITABLE_REPOS}}`: los que no tienen `readOnly: true`, con el remote esperado de cada uno en su prompt (`{{CODE_REPOS}}`), y verifica `git remote -v` antes de editar.
- `readOnly: true` = ningún agente escribe ahí (repo de otro dueño) — se refleja en el prompt.
- Sin `productRepos`, todo resuelve igual que antes (un solo repo).
- `scripts/sync-product-repos.ps1 -Project <slug>` pone las copias al día (fetch siempre; fast-forward solo en la rama por defecto y sin cambios trackeados; nunca fuerza nada). Los wrappers lo corren antes de leer código (`Sync-ProjectRepos`; el listener en un modo que nunca cambia de rama, para no cortarle el checkout a una rama recién creada por Cody): con varios repos, las copias atrasadas son el primer riesgo del análisis.

## Vercel read-only

Si el producto deploya en Vercel, `project.json` → `vercel` declara el **pin**: el team y los proyectos de Vercel que los agentes de ESTE proyecto pueden leer (deploys, build logs, errores de runtime) por el MCP `scripts/mcp-vercel/`:

```json
"vercel": {
  "teamId": "{{VERCEL_TEAM_ID}}",
  "projects": [ { "key": "app", "id": "{{VERCEL_PROJECT_ID_APP}}", "name": "nombre-en-vercel", "role": "qué sirve" } ]
}
```

- `Resolve-ProjectContext` lo exporta como `VERCEL_TEAM_ID` / `VERCEL_PROJECTS` (son ids, no secretos: por eso van aquí y no en `.env.<slug>`). El MCP rechaza cualquier proyecto fuera de la lista, aunque el token —que suele ser de todo el team— lo pueda ver.
- El token (`VERCEL_API_TOKEN`) vive una sola vez en `.env.server`; un valor en `.env.<slug>` lo pisa.
- Varios proyectos de Vercel por producto = varias entradas (p. ej. `app` + `site`).
- Modelo de seguridad, alta en el server y rotación: `docs/vercel-readonly-source.md`.

## El bloque `payload`

Si Leda publica en un blog con Payload CMS, `project.json` → `payload` declara el contrato. Lo lee `scripts/leda-helpers.ps1` (los nombres de los campos del pipeline) y las skills de contenido (URLs y autor):

| Clave | Qué es |
|-------|--------|
| `baseUrl` / `adminUrl` | URL de la API y del admin (con el host canónico: si el apex redirige, el redirect puede tirar el header `Authorization`). La URL que usa el helper sale de `PAYLOAD_BASE_URL` en `.env.<slug>`; esta es la referencia para las skills. |
| `agentFieldPrefix` | Prefijo de los campos del pipeline: `agent` → `agentStatus` / `agentPublishAt` / `agentProcessedAt` / `agentImageStyle`. Sin el campo, el helper usa el contrato histórico `leda*`. |
| `publishedByAgentValue` | Valor final de `<prefijo>Status` al publicar (p. ej. `published_by_agent`). |
| `imageStyleField` | Campo donde se guarda la familia visual de la imagen; `null` = el CMS no lo tiene (la anti-repetición usa el pool completo). |
| `topics` | `true` si existe la collection `topics` (el banco de ideas). En `false`, las acciones de topics fallan claro: no es "banco vacío". |
| `guides` | `true` si los posts tienen guías y satélites (`isPillar` / `pillar`). |
| `localized` | `true` si el CMS es multi-idioma (las acciones llevan `-Locale`). |
| `defaultAuthorId` | Id NUMÉRICO del usuario del CMS que firma los posts de Leda; `null` = no se manda `authors`. |

## agent-overrides — cuándo escribir uno

Cuando el agente necesita reglas que solo aplican a ese proyecto:

| Agente | Qué suele declarar el override |
|--------|-------------------------------|
| Cody | archivos guía del repo, **comandos de gating exactos** (y el baseline de errores pre-existentes), **lista NO-TOCAR**, reglas de UI |
| Qualy | suite y comandos de test, flujos de smoke, fuentes de logs (Supabase + Vercel), baseline de seguridad, dimensiones del review de front |
| Daly | dónde viven los tokens y componentes, guía de interfaz, checklist de copy |
| Numa / Greta | **qué fuente sirve para qué** (base, GA4, CWV, pagos, Google Ads), canales activos, puntos ciegos de la atribución, volumen, el customer ID de Google Ads |
| Pico / Capi | dónde mirar antes de proponer, rúbrica de priorización contra el foco, conexión con el loop de roadmap |
| Leda | su rol (p. ej. blog con banco de ideas sobre un CMS), toolset, referencias que carga, pedidos interactivos, quality gates, hard stops |

El override se **appendea** al system prompt core — no lo reemplaza. Mantenlos cortos y operativos.

## Agregar un proyecto nuevo

Checklist completo en `docs/add-a-new-project.md`. En corto: copia `projects/acme/` a `projects/<slug>/`, completa `project.json` y los `TODO(acme):`, crea `.env.<slug>` a partir del ejemplo, crea el team en Linear y verifica el prompt resuelto de cada agente antes de activarlo.
