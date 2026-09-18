# CLAUDE.md

Guía para Claude Code cuando trabaja **dentro de este repo** (el repo de agentes, no el del producto).

## Qué es este repo

`agent-team-template` es un **marketplace de plugins de Claude Code** + el runtime de un equipo de agentes que opera un producto de software. No es un proyecto de software típico: no hay código compilado, test runner ni package manager en la raíz. El "código" son manifests de plugins, archivos `SKILL.md`, configs de MCP, system prompts, wrappers de PowerShell, workflows de n8n y bases de conocimiento en markdown.

Lo consumen dos entornos:
- **Server headless** (Windows): n8n dispara `claude -p ...` por cron o por webhook.
- **Claude Code / Cowork desktop**: uso interactivo del owner para revisar y aprobar (HITL).

`.claude-plugin/marketplace.json` declara cuatro plugins en `plugins/`:
- `team-shared` — brand voice, glossary, personas, design system y skills de contenido. El resto de los plugins depende de estas skills.
- `team-growth` — ads, SEO, AEO, monitoreo de funnel, email lifecycle, conversión, y los `.mcp.json`.
- `team-data` — queries de solo lectura (cohortes, ARPU, anomalías).
- `team-pm` — pipeline insight → propuesta → roadmap.

El **repo del producto** vive aparte (`project.json → productRepoPath`, por ejemplo `..\..\acme-app`). Es la fuente de verdad de stack, copy y modelo de datos: léelo antes de preguntarle al owner.

## Modelo multi-proyecto

El roster de agentes es **un solo equipo compartido** que trabaja para uno o más proyectos. Todo lo específico de un proyecto vive en `projects/<slug>/` (`project.json` + brand-bible/glossary/data-model/icp/product-catalog/roadmap + `agent-overrides/<agente>.md` + `skills/` + `.mcp.json` opcional) más un `.env.<slug>` gitignoreado. El proyecto de ejemplo es **Acme** (`projects/acme`, team de Linear `ACM`).

Core (mejoras una vez → impacta en todos los proyectos): `scripts/agents.ps1` (system prompts con `{{PLACEHOLDERS}}`, incluido `{{OWNER_NAME}}` desde `project.json → ownerName`), `scripts/project.ps1` (`Resolve-ProjectContext` / `Resolve-AgentPrompt` / ruteo por team id), los wrappers, `memory/` y el listener de n8n.

- Los wrappers reciben `-Project <slug>` y `-DryRun` (imprime la config resuelta sin llamar a `claude`).
- El listener de Linear escucha todo el workspace: `respond-linear.ps1` resuelve el proyecto desde `-TeamId` (payload del webhook) o desde el prefijo del identifier del issue (`ACM-12` → acme). Nunca cae en silencio a otro proyecto.
- **Regla de oro**: un cambio que mejora cómo trabaja un *agente* → core (`agents.ps1`, wrappers). Un cambio de *dominio* (tablas, tono, stack, comandos de gating) → `projects/<slug>/` (contexto u override). Modelo completo: `projects/README.md`; alta de un proyecto: `docs/add-a-new-project.md`.

## Loop de mejora continua del producto

Un volante semanal por proyecto donde los agentes **generan ideas de mejora proactivamente** y Capi las prioriza en un plan persistente (`projects/<slug>/roadmap.md`). Todo es HITL 1: la persona siempre está entre el plan y la ejecución. Detalle: `docs/product-roadmap-loop.md`.

- **Generadores** (crean `[Proposal]` en Linear): Pico `product-idea-scan`, Cody `tech-debt-scan` (solo lectura, wrapper dedicado `run-cody-scan.ps1`), Numa `funnel-monitor` (anomalía sostenida → propuesta).
- **Dueño del plan**: Capi `pm-progress-review` (wrapper dedicado `run-capi-roadmap.ps1`): reconcilia, re-prioriza, secuencia y **reescribe `roadmap.md`** (su único write, con HARD STOP).
- **Changelog semanal**: Pico `product-shipped-digest` (wrapper dedicado `run-pico-shipped.ps1`, solo lectura + git/gh).
- **Gate humano**: ningún cron edita código ni abre PRs. El owner aprueba el issue y comenta `Cody:` para construir.

## Tareas comunes

No hay comandos de build / lint / test en este repo. Lo que existe:

- **Eval de una skill**: `evals/<skill>/`. Los resultados van a `evals/results/` (gitignoreado).
- **Correr una skill headless (server Windows)**: `powershell -File scripts\run-skill.ps1 -Skill <skill> [-Project <slug>] [-DryRun]`. El wrapper carga `.env.server` (+ `.env.<slug>` encima vía `scripts/project.ps1`), corre `claude -p` con `--strict-mcp-config` + `--permission-mode dontAsk` + una allowlist mínima de `--allowedTools` (`Read,mcp__supabase__*,mcp__linear__*`) + `--max-budget-usd`, y escribe el `result` del agente en `queue/pending-review/YYYY-MM-DD-<proyecto>-<skill>.md`. Existe un `run-skill.sh` de referencia, pero el runtime vivo es PowerShell en Windows. En el server el repo vive en `C:\agents\agent-team-template` (los workflows de n8n y `docs/server-setup.md` asumen esa ruta; actualízalos si lo mueves). Las flags de la CLI cambian entre versiones: revalida con `claude --help` después de cada upgrade.
- **Workflows de n8n**: viven en `automation/n8n/*.json` y son la fuente versionada. **Impórtalos** en n8n en vez de rearmarlos en la UI; si editas en la UI, re-exporta y sobrescribe el JSON.
- **Nunca recrees ni regeneres desde cero el JSON de un workflow ya publicado.** La copia del repo puede haber driftado respecto de lo que corre en n8n. Antes de cambiar un workflow publicado: (1) pide el JSON exportado actual de n8n, o (2) especifica los cambios exactos (qué nodo, qué campo, qué diff). Aplica el **diff mínimo sobre la versión viva**. Importar una plantilla vieja encima de un listener que funcionaba puede dejar a todos los agentes mudos sin ningún error visible.

Idioma del copy customer-facing: **por proyecto** (`project.json → languageConvention`). Docs internas, memory y prompts de este repo: español neutro con tuteo.

## Convenciones de plugins y skills

- Directorio: `projects/<slug>/skills/<kebab-case>/SKILL.md` para skills del proyecto (el default: `run-skill.ps1` busca ahí primero), o `plugins/<plugin>/skills/<kebab-case>/SKILL.md` para las que sirven a todos los proyectos.
- Frontmatter obligatorio: `name`, `description` (debe arrancar con "Use when ..." — eso dispara el auto-trigger), `hitl_level` (1/2/3), `owner`. Si la corre un agente, agrega `agent:` (lo lee `run-skill.ps1` para resolver tools y modelo). Recomendados: `schedule`, `inputs`, `outputs`, `cost_budget_usd`.
- Naming: `kebab-case`, prefijo por dominio (`ads-*`, `seo-*`, `aeo-*`, `funnel-*`, `content-*`, `signup-*`, `retention-*`), sufijo de acción para generadores (`-optimizer`, `-generator`, `-detector`, `-proposer`, `-monitor`, `-tracker`).
- MCP servers en `.mcp.json` con placeholders `${ENV_VAR}` — nunca secretos inline. El MCP de Supabase corre forzado a `--read-only --project-ref`; el de Linear es el remoto oficial con Bearer `${LINEAR_API_KEY}`. Antes de cablear un MCP de terceros, verifica que el paquete exista y haga lo que dice.
- **El agente headless no tiene `Write`** en las skills que corren por `run-skill.ps1`. En Windows las reglas `Write(<glob>)` no matchean la ruta absoluta que usa la tool, y un `Write` pelado dejaría tocar cualquier archivo del repo. Convención: la skill **devuelve el brief como respuesta final** y `run-skill.ps1` lo escribe en `queue/pending-review/`.
  - **Excepción — wrappers dedicados**: una skill con **wrapper propio** puede recibir un `Write` pelado acotado por **HARD STOP** a un archivo puntual, declarado en el `SKILL.md` y en el wrapper (por ejemplo, la memoria de la revisión SEO, las secciones vivas de la estrategia AEO o el `roadmap.md` de Capi). Nunca un `Write(<glob>)`. Un override de proyecto puede autorizar a un agente a appendear en un archivo puntual del repo de agentes, sin commitear.
  - **Excepción mayor — Alfred**: su dominio **es** este repo. Su wrapper (`scripts/run-alfred.ps1`) le da `Edit/Write/Bash` + git/`gh` para editar prompts, wrappers, skills y docs y **abrir PRs**, pero SOLO sobre un **clon limpio** (`ALFRED_REPO_PATH`), nunca sobre la copia viva. Sin clon, degrada a modo PROPOSE (solo lectura, diff como comentario). No toca el repo del producto. Ver `docs/alfred.md`.

## Modelo HITL — no negociable

Toda skill declara `hitl_level:` en el frontmatter:

| Nivel | Comportamiento |
|-------|----------------|
| 1 | Solo lectura. Escribe drafts/alertas. Seguro para correr desatendido. El brief sale como `result` del agente y `run-skill.ps1` lo espeja en `queue/pending-review/`. Si propone trabajo, crea un issue en el team del proyecto (estado `Backlog`, label `agent-proposal` o `agent-report`, sin asignar — convención completa en `memory/CLAUDE.md`). |
| 2 | Propone una acción y espera el OK humano. El feedback llega desde Linear con un comentario que empieza con `<Agente>:` (por ejemplo `Numa: ¿de qué tabla sale ese número?`) en cualquier team que tenga un `projects/<slug>/project.json`. Los agentes son `Capi/Numa/Greta/Pico/Cody/Qualy/Daly/Leda/Alfred` (roster en `memory/agents-roster.md` + `scripts/agents.ps1`; overrides por proyecto en `projects/<slug>/agent-overrides/`). `automation/n8n/linear-feedback-listener.json` matchea la regex y rutea a `scripts\respond-linear.ps1 -AgentName <nombre> -TeamId <uuid>`, que resuelve el proyecto, carga el prompt resuelto del agente y responde con un comentario que empieza con `🤖 <Nombre> <Emoji>:` (el 🤖 es el guard anti-loop: el agente comenta con la API key de una persona). **Alfred** no corre inline: `respond-linear.ps1` delega en `run-alfred.ps1 -Job issue` para que su loadout no se filtre al listener. No uses `@agente`: el `@` de Linear está reservado para menciones de usuario. |
| 3 | Ejecuta acciones reversibles con audit completo. **Reservado** — no crees skills de nivel 3 todavía. |

Si una skill toca producción (base de datos, pagos, email, plataformas de ads): primero dry-run, muestra el diff y espera aprobación. Antes de generar copy customer-facing, la skill carga la brand voice del proyecto (`team-shared/skills/brand-voice` o `projects/<slug>/brand-bible.md`). Antes de citar una métrica, carga el glossary del proyecto para confirmar que la definición coincide con la fuente.

## Tiering de modelos (defaults)

Las skills declaran su modelo con `run-skill.ps1 -Model` (default `claude-sonnet-4-6`, configurado por workflow en `automation/n8n/`). Los agentes del listener declaran su modelo en `scripts/agents.ps1` (campo `Model`, explícito para TODOS, así `ANTHROPIC_MODEL` del env nunca decide en silencio). Política sugerida: nada en Haiku salvo lo realmente trivial; Sonnet por default; Opus para los agentes de alto impacto.

- **Sonnet 4.6** (`claude-sonnet-4-6`) — Capi / Numa / Greta como responders, Qualy, Leda. Default de los crons.
- **Opus 4.8** (`claude-opus-4-8`) — Pico (propuestas de producto), Daly (mockups), los crons semanales de SEO/AEO de Greta y el roadmap de Capi (wrappers dedicados, effort high), y **Alfred** (edita prompts y `.ps1` del propio repo: un error de sintaxis en `agents.ps1` rompe a TODOS).
- **Opus 4.7** (`claude-opus-4-7`) con `Effort = 'xhigh'` — Cody. Escribe código en el repo del producto y abre PRs: el loop de mayor riesgo.
- **Haiku 4.5** — solo para ticks triviales que se pasan por `-Model` en n8n. No se asigna a agentes nuevos por default.

**Guard de runaway = TIEMPO, no presupuesto.** Si los agentes corren contra una suscripción (login OAuth), el costo no limita; el riesgo real es un loop colgado. Cada entrada del registry declara `TimeoutMinutes` (`Resolve-AgentTimeout` en `project.ps1`); un watchdog mata el árbol de procesos de claude (incluidos los MCP) al vencer y la corrida se loguea con `timed_out: true`. `--max-budget-usd` queda como respaldo profundo (`PER_RUN_BUDGET_USD` en `.env.server`). Cada corrida agrega una línea de uso (modelo, `cost_usd` nominal, `duration_s`, `timed_out`) a `audit/YYYY-MM-DD.jsonl` vía `Write-AgentAudit`.

Claude Code corre **solo con modelos Claude**. Las keys de Gemini / OpenAI se usan en workflows de n8n o como sub-llamadas dentro de una skill (por ejemplo, generación de imágenes), no como runtime del agente.

## Directorios de runtime (gitignoreados)

- `queue/pending-review/`, `queue/approved/`, `queue/rejected/` — cola compartida entre agentes y personas. `run-skill.ps1` escribe los briefs en `pending-review/` (espejo de lo creado en Linear).
- `audit/YYYY-MM-DD.jsonl` — log diario de corridas y decisiones HITL.
- `secrets/`, `.env*` — nunca se commitean (salvo los `*.example`).

Solo los `.gitkeep` de esos directorios están versionados. Al generar paths de output en skills, usa `queue/pending-review/YYYY-MM-DD-<skill>-<slug>.md`.

## Directorio de output versionado: `design/`

A diferencia de `queue/` y `audit/`, **`design/` SÍ se versiona**. Es el output de Daly 🎨: por cada diseño deja `design/<proyecto>/<IssueId>-<slug>/` con `brief.md` (spec para Cody) + `mockup.html` (autocontenido, se abre con doble clic) + `mockup-notes.md`. Cuando Cody implementa, mueve la carpeta a `design/<proyecto>/implemented/<IssueId>-<slug>/`. Convención completa: `design/README.md`. Skill de referencia: `plugins/team-shared/skills/design-system/SKILL.md` — la cargan Daly siempre, Pico cuando propone UI y Cody cuando implementa UI. Los tokens reales del design system viven en el repo del producto.

## Capa de memoria

`memory/CLAUDE.md` es el contexto que carga cada agente al inicio de una corrida. Mantenlo corto y denso; el detalle va en los archivos hermanos (`brand-bible.md`, `product-catalog.md`, `icp.md`, `data-model.md`) o en `projects/<slug>/`, que los agentes leen bajo demanda. Al editar `memory/CLAUDE.md`, conserva textual la sección "Reglas que no se rompen": son garantías operativas, no decisiones de estilo.

## Convenciones al editar este repo

- **Archivos `.ps1`**: UTF-8 **con BOM** (PowerShell 5.1 lee sin BOM como CP1252 y rompe emojis y acentos). Después de tocar uno, valida que parsea: `powershell -NoProfile -Command "[System.Management.Automation.Language.Parser]::ParseFile('<ruta>',[ref]$null,[ref]$null)"`.
- **No toques la identidad anti-loop** (nombre, emoji, firma `🤖 ...`) de ningún agente sin un pedido explícito del owner.
- **Cero secretos, cero PII, cero IDs reales** en archivos versionados. Lo que un tercero deba completar se marca con `TODO(<slug>):` o `{{PLACEHOLDER}}`.
- Cambios mínimos y quirúrgicos: el registry y los wrappers son compartidos por todos los proyectos.
