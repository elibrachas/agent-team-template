# projects/ — un bundle de configuración por proyecto

El equipo de agentes (Capi / Numa / Greta / Pico / Cody / Qualy / Daly / Leda) es **uno solo y compartido**: su identidad y sus workflows viven en `scripts/agents.ps1` (el **core**). Lo que cambia por proyecto es el **contexto**, y todo el contexto vive acá, un directorio por producto:

```
projects/<slug>/
├── project.json              metadatos + paths + IDs (lo consume scripts/project.ps1)
├── brand-bible.md            voz, posicionamiento, no-go zones, crisis playbook
├── glossary.md               métricas, etapas del funnel y definiciones canónicas
├── data-model.md             tablas + queries canónicas + caveats de calidad de datos
├── icp.md                    ICP, personas, triggers, objeciones, anti-personas
├── product-catalog.md        planes, precios, límites, surfaces de checkout
├── design-system.md          dónde viven los tokens y componentes en el repo del producto
├── roadmap.md                ledger del plan priorizado (lo reescribe Capi)
├── qualy-front-memory.md     ledger de hallazgos de QA/seguridad (lo reescribe Qualy)
├── blog-taxonomy.md          categories + tags del blog (Leda)
├── content-references.md     fuentes de autoridad para links externos (Leda)
├── image-style-families.md   familias visuales para las imágenes del blog (Leda)
├── agent-overrides/          (opcional) <agent>.md — reglas del agente EN ESTE proyecto
├── skills/<skill>/SKILL.md   (opcional) skills propias del proyecto (los wrappers buscan acá primero)
└── *.mcp.json                (opcional) MCPs propios del proyecto (mismas ${VARS}, valores de .env.<slug>)
```

`projects/acme/` es un **proyecto de ejemplo** (Acme es un SaaS ficticio): cópialo como punto de partida y reemplaza todo. Los archivos de contexto traen una guía de qué documentar en cada sección + ejemplos falsos; lo que tienes que completar está marcado con `TODO(acme):`. Los archivos del blog (Leda) solo hacen falta si usas ese flujo.

## Schema de `project.json`

| Campo | Obligatorio | Qué es |
|-------|-------------|--------|
| `slug` | sí | Identificador corto (`acme`). Es el valor de `-Project` en los wrappers y el sufijo de `.env.<slug>`. |
| `name` | sí | Nombre visible del producto. Se interpola como `{{PROJECT_NAME}}`. |
| `ownerName` | recomendado | Nombre de la persona dueña del producto y de las aprobaciones. Se interpola como `{{OWNER_NAME}}` en los prompts (fallback: "el owner"). |
| `linear.workspace` | sí | Slug del workspace de Linear. |
| `linear.teamKey` | sí | Key del team (`ACM`). Se interpola como `{{LINEAR_TEAM_KEY}}`; es el prefijo de los ids de issue. |
| `linear.teamId` | sí | UUID del team. El listener de n8n lo manda en el webhook y `respond-linear.ps1` resuelve el proyecto con `Resolve-ProjectSlugFromLinearTeamId` (falla ruidoso si ningún `project.json` matchea). |
| `productRepoPath` | sí | Path relativo al repo del producto (`..\..\acme-app`). `{{PRODUCT_REPO_PATH}}`; es el `--add-dir` de los agentes que leen o escriben código. |
| `productRepoUrl` | recomendado | URL canónica del repo (`https://github.com/your-org/acme-app`). `{{PRODUCT_REPO_URL}}`. Cody la usa para verificar `git remote -v` **antes de cualquier edit**: si el `origin` apunta a otro repo, aborta. |
| `productUrl` | sí | URL de producción (`https://acme.example`). `{{PRODUCT_URL}}`; la usan Qualy (smoke), Greta (SEO/AEO) y Leda. |
| `productStack` | sí | Stack en una línea (framework, base, CMS, pagos, package manager, deploy). `{{PRODUCT_STACK}}`. |
| `envFile` | sí | Archivo de variables del proyecto (`.env.acme`), que se carga encima de `.env.server`. |
| `contextDir` | sí | Directorio de contexto (`projects\acme`). `{{PROJECT_CONTEXT_DIR}}`. |
| `mcpConfig` | sí | MCP default de los agentes del proyecto (p. ej. `plugins\team-growth\.mcp.json`). |
| `mcpVariants` | opcional | Mapa `variante → archivo` para agentes/jobs con loadout propio: `qa`, `design`, `seo`, `aeo`. Fallback: `mcpConfig`. |
| `languageConvention` | sí | Convención de idioma del copy customer-facing. `{{LANGUAGE_CONVENTION}}`. |
| `strategicFocus` | sí | Foco estratégico actual (qué se prioriza, qué queda fuera de scope). `{{STRATEGIC_FOCUS}}`. |
| `shippedDigestFollowers` | opcional | Emails de Linear a sumar como seguidores del digest de lo shipeado. Vacío = nadie. |
| `agents.<nombre>.enabled` | sí | Qué agentes corren en este proyecto. |

## Core vs. proyecto — regla de oro

Si un cambio mejora **cómo trabaja un agente** (workflow, guardrails, formato de salida, HARD STOPS) → va al **core** (`scripts/agents.ps1`, wrappers, skills genéricas de `plugins/`). Si cambia **el dominio** (qué tabla mirar, qué métrica vale, qué tono usar, qué stack tiene el producto, qué comandos corren los tests) → va a `projects/<slug>/` (contexto u override).

## Cómo se inyecta

- Los wrappers (`run-skill.ps1`, `respond-linear.ps1`, `run-qualy.ps1`, …) aceptan `-Project <slug>`.
- `scripts/project.ps1` → `Resolve-ProjectContext` carga `.env.server` y, si existe, `.env.<slug>` encima (limpiando antes las variables project-scoped — ver `$ProjectScopedVars`), así un proyecto nunca hereda credenciales de otro.
- `Resolve-AgentPrompt` **concatena `agent-overrides/<agent>.md`** (si existe) al system prompt core y después interpola los placeholders (`{{OWNER_NAME}}`, `{{PROJECT_NAME}}`, `{{PROJECT_SLUG}}`, `{{LINEAR_TEAM_KEY}}`, `{{PRODUCT_REPO_PATH}}`, `{{PRODUCT_REPO_URL}}`, `{{PRODUCT_URL}}`, `{{PRODUCT_STACK}}`, `{{LANGUAGE_CONVENTION}}`, `{{STRATEGIC_FOCUS}}`, `{{PROJECT_CONTEXT_DIR}}`) desde `project.json` — tanto en el core como en el override.
  - ⚠ **`{{STRATEGIC_FOCUS}}` no está en el prompt core de todos los agentes** (solo en los que priorizan: Capi, Greta, Pico). Los demás se enteran del foco por su `agent-overrides/<agent>.md` o por el `SKILL.md` de su cron. Al cambiar el foco, revisa ambos y verifica el prompt resuelto.
- Las skills se buscan primero en `projects/<slug>/skills/` y después en `plugins/*/skills/`: un proyecto puede reemplazar una skill genérica con una propia sin tocar el core.

## agent-overrides — cuándo escribir uno

Cuando el agente necesita reglas que solo aplican a ese proyecto:

| Agente | Qué suele declarar el override |
|--------|-------------------------------|
| Cody | archivos guía del repo, **comandos de gating exactos** (y el baseline de errores pre-existentes), **lista NO-TOCAR**, reglas de UI |
| Qualy | suite y comandos de test, flujos de smoke, fuentes de logs, baseline de seguridad, dimensiones del review de front |
| Daly | dónde viven los tokens y componentes, guía de interfaz, checklist de copy |
| Numa / Greta | **qué fuente sirve para qué** (base, GA4, CWV, pagos), canales activos, puntos ciegos de la atribución, volumen |
| Pico / Capi | dónde mirar antes de proponer, rúbrica de priorización contra el foco, conexión con el loop de roadmap |
| Leda | su rol (p. ej. blog publisher sobre un CMS), toolset, referencias que carga, pedidos interactivos, quality gates, hard stops |

El override se **appendea** al system prompt core — no lo reemplaza. Mantenlos cortos y operativos.

## Agregar un proyecto nuevo

Checklist completo en `docs/add-a-new-project.md`. En corto: copia `projects/acme/` a `projects/<slug>/`, completa `project.json` y los `TODO(acme):`, crea `.env.<slug>` a partir del ejemplo, crea el team en Linear y verifica el prompt resuelto de cada agente antes de activarlo.
