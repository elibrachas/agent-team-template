# CLAUDE.md — Contexto general para todos los agentes

> Este archivo lo lee Claude Code al inicio de cada sesión. Mantenlo corto y de alta densidad. Para detalle profundo, los agentes leen el bundle del proyecto en `projects/<slug>/` o el repo del producto correspondiente.

## Multi-proyecto

El equipo de agentes es UNO y puede trabajar para **más de un proyecto**. Cada proyecto tiene su bundle en `projects/<slug>/` (`project.json` + brand-bible + glossary + data-model + icp + product-catalog + design-system + roadmap + agent-overrides + skills propias + MCPs propios) y su `.env.<slug>`. Los wrappers reciben `-Project <slug>`; el listener de Linear resuelve el proyecto por el `teamId` del webhook. Modelo completo: `projects/README.md`; alta de proyecto: `docs/add-a-new-project.md`.

- **Acme** (proyecto de ejemplo) → team Linear `ACM`, producto en `../acme-app/`, contexto en `projects/acme/`.

**El contexto que vale es siempre el del proyecto del issue que estás trabajando.** No asumas nada de un proyecto cuando trabajas en otro.

## Qué es el producto

No se describe aquí: cada proyecto lo define en `projects/<slug>/` y parte llega interpolada a tu prompt desde `project.json`:

- Qué es, para quién y cómo se posiciona → `brand-bible.md`, `icp.md`.
- Planes, precios y límites → `product-catalog.md`.
- **Foco estratégico** (qué se prioriza y qué queda fuera de scope) → `project.json → strategicFocus`. Si el foco declara algo fuera de scope, ningún agente propone, prioriza, escribe contenido ni construye alrededor de eso.
- Convención de idioma del copy → `project.json → languageConvention`.
- Stack → `project.json → productStack` + el repo del producto (fuente de verdad de stack, copy y modelo de datos).

## Cómo trabajamos con agentes

- Repo: este mismo (`agent-team-template`). El repo de cada producto está en el `productRepoPath` de su `project.json`.
- Versionado en git; runtime headless (`claude -p`) en un server + uso interactivo.
- Modelo HITL: 3 niveles (1 = read-only, 2 = propose & approve, 3 = execute with rollback). Hoy hay una sola skill de nivel 3: `content-topic-scan` de Leda, que carga ideas al banco del CMS sin aprobación previa (el registro es el issue `[Topics]` + su ledger; la vuelta atrás es borrar la idea antes de que el publisher la tome).
- Aprobaciones / feedback conversacional: en Linear, en el team del proyecto, empezando el comentario con el nombre del agente + `:` (p. ej. `Numa: ¿de qué tabla sale ese número?`). Convención y roster completo en `memory/agents-roster.md`.
- Cola de drafts: `queue/pending-review/`, `queue/approved/`, `queue/rejected/`. No se versionan.
- Crons de growth/data: `signup-to-paid-tracker` + `funnel-monitor` (Numa), `funnel-daily-pulse` (Numa, un mensaje diario a Discord; no crea issue), `seo-weekly-review` y `aeo-weekly-review` (Greta, vía `scripts/run-greta-seo.ps1` / `run-greta-aeo.ps1`), estas dos con **memoria persistente** (`seo-memory.md` / `aeo-memory.md`: no repiten propuestas y trackean `wont-fix` / `hecho-parcial`). Contenido: `content-topic-scan` (Leda) llena el banco de ideas del blog y el publisher escribe desde ese banco. Seguridad: `security-review` (Qualy, semanal).
- Fuentes read-only además de la base: GA4, Search Console, Core Web Vitals, Stripe, **Vercel** (deploys y logs, `mcp__vercel__*`), **Google Ads** (gasto, `mcp__google-ads__*`, solo Numa y Greta) y, si la base del producto no es Supabase, **MySQL** (`mcp__mysql__*`). Si el producto vive en varios repos, los recibes todos en solo lectura (`project.json → productRepos`).
- **Loop de mejora continua del producto**: Pico (`product-idea-scan`), Cody (`tech-debt-scan`, read-only) y Numa (anomalías del funnel) generan `[Proposal]`; Capi (`pm-progress-review`, vía `scripts/run-capi-roadmap.ps1`) prioriza y es **dueño del plan persistente `projects/<slug>/roadmap.md`** (su único write). Complemento: Pico `product-shipped-digest` deja un `[Report]` de "qué se actualizó en la app" y suma como seguidores a `project.json → shippedDigestFollowers`. Cada idea es un issue para aprobar; la ejecución la dispara el owner con `Cody:`. Detalle: `docs/product-roadmap-loop.md`.
- **Project Lead** (no es un agente del server: Claude Code en la máquina del owner con la skill `.claude/skills/project-lead`): cada mañana tría lo que dejan los agentes en todos los teams, archiva los registros leídos, junta duplicados y le lleva al owner hasta tres tareas listas para un sí; después publica el pedido (`Cody: …`, `Qualy: …`) y lo sigue hasta producción. No reemplaza a Capi ni reescribe `roadmap.md`. Detalle: `lead/README.md`.
- Audit log: `audit/YYYY-MM-DD.jsonl`. No se versiona.

## Reglas que no se rompen

1. **Nunca commitear secrets**. Usar `.env*` (gitignored) + los `.example`.
2. **Nunca tocar PII en el repo de agentes**. Los datos personales de los usuarios del producto se quedan en la base del producto: no entran a este repo, ni a sus colas, ni a Linear. Solo agregados.
3. **Nunca una acción nivel 3 sin auditoría completa y rollback documentado.**
4. **Antes de generar contenido customer-facing**, cargar la skill `brand-voice` (que carga `projects/<slug>/brand-bible.md`) y respetar la `languageConvention` del proyecto.
5. **Antes de citar una métrica**, validar con la skill `glossary` (`projects/<slug>/glossary.md`) que la definición coincide con la fuente (base de prod, GA4, pasarela).
6. **Si una skill toca producción** (base, pasarela de pagos, email, ads), dry-run primero, mostrar el diff y esperar approval.
7. **No inventar datos**. Si falta evidencia, decirlo y proponer cómo conseguirla — no rellenar.

## Verifica contra el código, no contra esta base

La base de conocimiento de este repo (`project.json`, `data-model.md`, `glossary.md`, `product-catalog.md`, `brand-bible.md`, los `agent-overrides/` y este `memory/`) **envejece**: describe el producto en un momento, y las apps cambian todos los días por fuera de aquí (muchos PRs ni siquiera nombran un issue). Cuando se revisó un Backlog grande contra el código, una buena parte de los issues de trabajo abiertos pedía algo ya hecho o partía de una premisa que ya no valía (un proveedor que la app ya había migrado, una función o un plan que se habían borrado del código).

**Regla para cualquier agente que PROPONE o DIAGNOSTICA (Pico, Numa, Greta, Qualy, el scan de Cody):** antes de crear un `[Proposal]` / `[Report]` / hallazgo que afirma un hecho del producto —un proveedor, un archivo, una función, una ruta, una tabla, un flujo—, **confírmalo en la rama principal del repo del producto** (tienes los repos montados en solo lectura; lee el `package.json`/lockfile, el archivo o el `CLAUDE.md`/`AGENTS.md`/`docs` del repo). Si el código desmiente a esta base, **manda el código**: no propongas sobre la premisa vieja, y di en el brief qué dato de la base quedó viejo para que se corrija. No afirmes un `archivo:línea` sin releerlo en la copia actual. Las copias locales pueden estar atrás del main remoto (los wrappers las sincronizan antes de cada corrida, pero el sync puede fallar); si una conclusión depende de código reciente, decláralo.

## Archivos clave para profundizar

- `projects/<slug>/project.json` — metadatos, foco, convención de idioma, stack.
- `projects/<slug>/brand-bible.md` — posicionamiento, mensajes, principios, no-go zones de marca.
- `projects/<slug>/product-catalog.md` — planes, precios, consumo por flujo.
- `projects/<slug>/icp.md` — ICP, personas y anti-personas.
- `projects/<slug>/data-model.md` — tablas relevantes y métricas con definición canónica.
- `projects/<slug>/glossary.md` — definiciones de métricas y términos.
- `projects/<slug>/roadmap.md` — plan priorizado de mejoras (lo escribe Capi).
- `memory/agents-roster.md` — quién es quién en el equipo de agentes.
- `docs/architecture.md` — arquitectura del sistema de agentes.
- **El repo del producto** — fuente de verdad para stack, copy y principios (`README.md`, `AGENTS.md`, `CLAUDE.md` si existen).

## Linear destination convention

Toda skill que cree un ticket/issue/spec en Linear desde un agente usa este destino canónico. No improvisar:

### Dos destinos: decisión vs registro

Antes de crear un issue, clasifica lo que vas a dejar. **Todo nace en `Backlog`** (el owner lee ahí); lo que esta clasificación decide es el **label**, no el estado:

- **Decisión** — pide una acción o un criterio del owner: propuestas (`[Proposal]`), alertas de anomalía (`[Alert]`), hallazgos accionables (`[QA-sec]`, `[QA-front]`). → label `agent-proposal`. Queda abierto esperando que el owner lo trabaje.
- **Registro** — solo deja constancia, no pide decisión: reportes periódicos (`[Report]`), digests, ticks de cron, el registro de lo cargado al banco de ideas (`[Topics]`). → label `agent-report`. El owner lo lee en el Backlog; **NO lo cierres tú**: el Project Lead lo archiva cuando tiene 2 días.

Reglas del registro (para que el board no se tape: sin ellas, los reportes terminan siendo casi la mitad de los issues abiertos y alguien tiene que cerrarlos a mano):

- **Título fijo por serie**: prefijo estable y agrupable (`[Report] Free→paid`, `[Report] (SEO) semana`, `[Report] seguridad`) con la fecha SOLO al final, para poder encontrar y agrupar la serie.
- **Un issue por corrida**: cada corrida con novedades crea SU PROPIO issue (en `Backlog`) con el título fijo de la serie + la fecha. NO acumules snapshots como comentarios en un issue "del mes" ni reabras uno viejo: el Project Lead agrupa la serie por el título.
- **Corrida/tick sin novedades → NO crees issue.** Si no hay nada que reportar ("tick limpio", "0 posts", sin cambios vs el anterior), alcanza con el espejo en `queue/pending-review/`. Solo creas issue cuando hay señal.
- **No cierres tus registros ni los de otra corrida.** El agente nunca cierra un registro; el Project Lead los archiva a los 2 días. El `[Plan]` del lunes de Capi queda **abierto** hasta que llega el siguiente (es el documento vivo de la semana).
- Un registro que además trae una pregunta para el owner deja de ser solo un registro: lleva `agent-proposal` y el título lo dice (p. ej. `[Topics] … · con preguntas`).

**Cómo sabes que funciona**: pocos registros abiertos por team (menos de 10), sin que nadie los cierre a mano.

### Campos del issue

- **Workspace**: el de `project.json → linear.workspace`.
- **Team key**: el del proyecto que estás trabajando (`project.json → linear.teamKey`, en el ejemplo `ACM`). NUNCA crear el issue en el team de otro proyecto.
- **Label obligatorio**: `agent-proposal` para decisiones, `agent-report` para registros — distingue lo que generan los agentes de lo que crea un humano y permite filtrar los registros abiertos. Crear el label en Linear si todavía no existe.
- **State inicial**: `Backlog` para todo (NO `Todo` ni `In Progress`). El owner promueve las decisiones cuando decide trabajarlas; los registros los archiva el Project Lead a los 2 días (el agente no los cierra). Distinto es **tomar un pedido**: cuando el owner (o el Project Lead) te pide en un issue existente que PRODUZCAS algo (código, verificación, mockup, draft, publicación), pasa ese issue a `In Progress` al tomarlo; una consulta que se contesta en tu comentario no cambia el estado, y nunca retrocedas ni reabras un issue cerrado.
- **Asignado a**: nadie. El owner se autoasigna después del review (evita falsos "tengo X tickets nuevos" en su dashboard).
- **Priority**: `No priority` por default. La prioridad la decide el owner al revisar.
- **Cycle**: NO agregar al cycle actual. Queda en backlog hasta decisión humana.
- **Project**: si el spec pertenece a un project existente de Linear, asociarlo. Si no, dejarlo sin project.

### Formato del título y body

- **Título**: empezar con `[Proposal]` seguido del cambio en imperativo neutro. Ej.: `[Proposal] Capturar el click id de ads en la página de checkout`.
- **Body**: estructura fija para que sea revisable rápido —
  - `## Contexto` — qué insight de data lo motivó + link al reporte en `queue/`
  - `## Hipótesis` — qué creemos que va a pasar y por qué
  - `## Propuesta` — cambio concreto, lo más acotado posible
  - `## Métrica de éxito` — qué medimos y cuándo
  - `## Riesgos / contras` — lo que el agente identificó
  - `## Generado por` — nombre de la skill + timestamp + ID del run

### Cuándo NO crear ticket directo

- Si el spec es ambiguo o requiere conversación previa → dejarlo como draft en `queue/pending-review/` y notificar, **no** crear el issue en Linear todavía.
- Si el cambio es >5 días de dev → no es un ticket, es un proyecto. El agente escribe un PRD primero, no un issue en Linear.

## Persona responsable

El owner de cada proyecto (`project.json → ownerName`, interpolado como `{{OWNER_NAME}}` en los prompts de los agentes) — dueño de producto y de las aprobaciones. TODO(acme): completa `ownerName` en tu `project.json`.
