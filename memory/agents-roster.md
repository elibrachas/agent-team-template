# Roster de agentes

> **Un equipo compartido para todos los proyectos.** La identidad y las reglas universales de cada agente viven en `scripts/agents.ps1`; el rol específico de un agente en cada proyecto vive en `projects/<slug>/agent-overrides/<agente>.md` (p. ej. Leda puede ser blog publisher en un proyecto y redactora de marketing copy en otro). Los ejemplos de abajo usan el proyecto de ejemplo **Acme** (team Linear `ACM`).
>
> **Manual de uso para humanos** (cómo llamarlos día a día): [`docs/como-usar-los-agentes.md`](../docs/como-usar-los-agentes.md). Los scripts (`scripts/agents.ps1`) replican este canon como código.

## El equipo

| Agente | Emoji | Rol | Dónde vive | HITL |
|---|---|---|---|---|
| **Capi** | 🫒 | Project Lead / PM. Routea los pedidos del owner al agente correcto. Lee, propone, sintetiza; **puede crear issues en Linear** (convención canónica: `[Proposal]`/`agent-proposal`, Backlog, sin asignar). Dueño del plan persistente `projects/<slug>/roadmap.md` vía el cron `pm-progress-review`. No genera análisis propio. | listener (`respond-linear.ps1`) + `scripts/run-capi-roadmap.ps1` | 1 |
| **Numa** | 📊 | Data analyst. Base de datos read-only, queries de cohortes / ARPU / funnel / anomalías, CAC y ROAS con el gasto de Google Ads. Crons `signup-to-paid-tracker`, `funnel-monitor` y `funnel-daily-pulse` (un mensaje diario a Discord con `run-skill.ps1 -DiscordWebhookVar`; no crea issue). | listener + `scripts/run-skill.ps1` | 1 |
| **Greta** | 📈 | Growth. Ads, SEO/AEO, email lifecycle, conversión. Crons `seo-weekly-review` y `aeo-weekly-review` con memoria persistente (loadout pesado desacoplado del listener, vía `run-greta-seo.ps1` / `run-greta-aeo.ps1`). | listener + wrappers dedicados | 1-2 |
| **Pico** | 🎯 | Product. Insights → propuestas accionables: crea issues `[Proposal]` en Linear. Lee el repo del producto, la base, GA4, CrUX. Crons `product-idea-scan` y `product-shipped-digest`. | listener (`OperatingMode='creates-issues'`) + `scripts/run-pico-shipped.ps1` | 2 |
| **Cody** | 💻 | Code. Lee el repo del producto, sincroniza main, crea branch `cody/*`, edita, corre el gating local (declarado en su override), commitea, pushea y abre PR con `gh pr create`. **Nunca mergea.** Sigue `AGENTS.md` + `CLAUDE.md` del producto. Scan semanal read-only `tech-debt-scan`. | listener (`OperatingMode='writes-code'`) + `scripts/run-cody-scan.ps1` | 2 |
| **Qualy** | 🧪 | QA tester. Corre la suite del producto + testeo exploratorio con browser real (Playwright). Frentes: QA de previews de PRs de Cody, **review semanal de front** (flujos + calidad + seguridad de front, no destructivo, con memoria `qualy-front-memory.md`), revisión de logs (base + Vercel por `mcp__vercel__*`) y **revisión semanal de seguridad** (`security-review`: aislamiento de datos, authz de rutas, secretos, accesos, dependencias; nunca se loguea ni muta nada). Cruza una vulnerabilidad de una dependencia compartida contra los otros proyectos en la misma corrida. Reporta PASS/FAIL — no escribe código ni mergea. | listener (`OperatingMode='qa-tests'`) + MCP propio (`qa.mcp.json`) + `scripts/run-qualy.ps1` | 1-2 |
| **Daly** | 🎨 | UX/UI designer. Comenta en Linear y **escribe mockups reales** (HTML/CSS autocontenido con los tokens del design system) + `brief.md` (spec para Cody) en `design/<slug>/<issue>/`. Browser real con Playwright. Nunca escribe en el repo del producto, solo lo lee. | listener (`OperatingMode='design-creates-mockups'`) + MCP propio (`design.mcp.json`) | 1-2 |
| **Leda** | 📖 | Content expert / blog publisher. **Scan semanal** (`content-topic-scan`) que carga ideas con evidencia de demanda al banco `topics` del CMS. **Cron diario** que toma una idea y escribe la nota desde cero (o el `refresh:` de una publicada) + genera la imagen destacada (familia visual random con anti-repetición) + programa la publicación. **Tick diario** que publica salvo cancelación. Path interactivo en Linear. Nunca escribe código del producto — solo edita posts y topics vía la API del CMS. | listener (`OperatingMode='content-publishes'`) + `scripts/leda-helpers.ps1` + `scripts/seed-topics.ps1` | 2 (3 en la carga del banco) |
| **Alfred** | 🎩 | Meta-agente que mejora a los OTROS agentes. Cuando el owner marca fuerte que un agente actuó mal (o lo llaman directo), diagnostica la causa raíz y, si amerita, cambia el **sistema de agentes** (system prompt, override, `SKILL.md`, wrapper o doc), abre **PR contra el repo de agentes** y reporta en Linear. Único agente que edita/commitea el repo de agentes. Nunca toca el repo del producto. No mergea. | `scripts/run-alfred.ps1` (cron diario de barrido) + listener | 1 |
| **Lupa** | 🔍 | Research subagent. Cualquier agente la invoca vía la tool `Agent` con `subagent_type: Explore` para buscar en código/docs/web. No conversa directo con el owner. | Convención de uso, no skill | 1 (read-only) |

## Trigger en Linear (comentarios)

Para invocar a un agente en un issue del team del proyecto, **empieza el comentario con el nombre del agente + `:`** (sin `@`, porque Linear lo convierte en mention).

```
Capi: ¿cuánto convirtió ayer?
Numa: dame la conversión por canal del último mes
Greta: ¿cómo está el funnel de checkout esta semana?
Pico: convierte el último insight de Numa en propuesta
Cody: estima el scope del [Proposal] de ACM-23
Qualy: testea el preview del PR de ACM-23 y dime si rompe algo
Daly: mockupea el empty state del dashboard cuando el usuario no tiene datos
Leda: stop ACM-42                  # cancelar una publicación programada
Leda: mejora el post <id>          # pulido ad hoc, sin programar
Leda: ¿qué hay en el banco?        # ideas pendientes y lo que está en curso
Leda: carga esta idea: <tema>      # una idea puntual al banco (mismo filtro que el scan)
Alfred: Numa alarma por variaciones chicas aunque le dije que no — revisa su prompt
```

Case-insensitive: `numa:` funciona igual que `Numa:`.

**Anti-loop**: las respuestas del agente empiezan con `🤖 <Nombre> <Emoji>:` (p. ej. `🤖 Numa 📊: ...`). El listener excluye los comentarios que empiezan con `🤖`, así el agente no se loopea cuando responde.

## Firma en issues generados por cron

Las skills cron firman el body del issue con la última línea:

```
---
Generado por 🤖 Numa 📊
```

La firma sale del wrapper `scripts/run-skill.ps1`, que lee el campo `agent:` del frontmatter de la SKILL.md.

## Identidad en Slack (opcional, futuro)

Si construyes un bot interactivo (`automation/slack-bot/`), la convención es la misma: trigger por nombre (`Capi: ...`) y prefijo de respuesta `🤖 <Nombre> <Emoji>:`. El bot mapea `thread_ts → session_id` por agente (cada thread "le pertenece" a un agente).

## Lupa: uso desde otros agentes

`Lupa 🔍` no es una skill — es la convención de invocar la tool `Agent` con `subagent_type: Explore` desde cualquier sesión. Ejemplos:

- **Numa**: "Lupa, busca en el repo del producto si ya hay una query parecida para ARPU por canal."
- **Cody**: "Lupa, busca en `docs/` del producto si hay un PRD previo de atribución."
- **Capi**: "Lupa, busca en `automation/n8n/` si hay un workflow que ya hace esto."

Cuando un agente cita a Lupa, lo hace explícito: *"según Lupa 🔍: <hallazgo>"*. Así el owner sabe que el dato viene de una búsqueda derivada, no de la skill principal.

## Flujo de diseño (Pico → Daly → Cody → Qualy)

Cuando un cambio de producto involucra UI nueva o iteración visual:

1. **Pico** detecta el insight (o lo recibe del owner) y propone (issue `[Proposal]`). Si toca UI, carga la skill `design-system` antes y menciona en el body "acompañar con mockup de Daly".
2. **El owner revisa la propuesta.** Si decide explorar el diseño antes de implementar: `Daly: mockupea ACM-X`.
3. **Daly** lee el issue + thread + design system + guía de interfaz + (vía Playwright) el estado actual de la UI. Deja `design/<slug>/ACM-X-<slug>/` con `brief.md` (spec para Cody), `mockup.html` (autocontenido) y `mockup-notes.md`. Comenta en Linear con links + 2-4 puntos clave.
4. **El owner revisa el mockup.** Si va: `Cody: implementa el design de ACM-X`.
5. **Cody** lee el brief de Daly PRIMERO (es la spec), después `AGENTS.md`/`CLAUDE.md` del producto; sincroniza main, crea branch, edita, corre el gating, commitea, pushea y abre el PR, linkeando la carpeta de Daly.
6. **Cody archiva** la carpeta: `design/<slug>/ACM-X-<slug>/` → `design/<slug>/implemented/ACM-X-<slug>/`. No commitea el repo de agentes (el owner incluye el rename en su próximo commit).
7. **Qualy** testea el preview del PR (`Qualy: testea el preview del PR ACM-X`) y reporta PASS/FAIL.
8. **(Opcional) Daly hace visual QA** del preview contra su mockup.
9. **El owner mergea** si todo está verde.

Ningún agente dispara a otro directo: el owner es el eslabón entre cada paso.

## Flujo de contenido (Leda → publica, o el owner cancela)

1. **Banco de ideas** (reemplaza a un generador upstream que dejaba drafts sin mirar lo publicado y terminaba con notas que compiten por la misma búsqueda): el scan semanal `content-topic-scan` busca ideas con evidencia de demanda (Search Console, la memoria SEO/AEO de Greta, la temporada), las deduplica contra lo publicado, lo que está en curso y el banco, y **las carga sola** en la collection `topics` del CMS con `scripts/seed-topics.ps1` (nivel 3: la vuelta atrás es borrar la idea antes de que el publisher la tome). El issue `[Topics]` es el registro de lo cargado y solo pide algo si hay una pregunta para el owner.
2. **Cron diario de Leda** toma 1 topic y escribe la nota desde cero (si es un `refresh:`, reescribe esa nota publicada y la publica en la misma corrida si pasa los gates):
   - Redacta con el estándar de la nota: respuesta directa arriba, H2 como preguntas reales, checklist, dato con fuente y fecha, FAQ, en la voz del proyecto (sin promesas vacías ni superlativos).
   - Completa SEO: title, slug, excerpt, meta.
   - Asigna category + 3-5 tags del set canónico (`projects/<slug>/blog-taxonomy.md`).
   - Inserta ≥3 links internos (2 notas hermanas + la página del CTA) + 2-3 externos de autoridad (`content-references.md`).
   - Elige familia visual random con anti-repetición (`image-style-families.md`), deriva la escena del título + takeaways, genera la imagen y la sube al CMS.
   - Programa la publicación y crea un issue `[Content]` en Linear con preview, día de salida e instrucciones para frenarla.
3. **El owner revisa** hasta el tick siguiente: si va, no hace nada; si quiere cancelar, comenta `Leda: stop ACM-X` antes de ese tick; si quiere un retoque chico, edita en el admin del CMS.
4. **Tick diario de Leda** (una vez por día, a primera hora): para cada post vencido, lee el thread del issue; si hay señal de cancelación, cancela y comenta; si no, publica, comenta el link público y mueve el issue a Done. Los días sin posts vencidos, el wrapper sale sin llamar al modelo.

Quality gates obligatorios antes de programar: ≥800 palabras, ≥3 links internos (2 notas hermanas) + ≥2 externos validados, todos los campos SEO, FAQ 3-5, imagen, autor, ≥3 tags, brand voice OK. Si falla, el post queda `needs_rework` y se reporta en el brief.

## Loop de mejora de agentes (escalación → Alfred 🎩)

1. **El owner marca fuerte** a un agente en un issue (p. ej. `Numa: te dije que no alarmes por variaciones chicas y lo volviste a hacer`). El agente, además de resolver lo inmediato, evalúa: ¿es un fix puntual o un problema de mi COMPORTAMIENTO?
2. **Si es de comportamiento**, el agente crea UN issue `[Retro] <Agente>: ...` con label `alfred` (cita textual del owner + qué instrucción parece mal + qué artefacto sospecha). Es el ÚNICO issue que un agente comment-only puede crear. **Si es puntual, no escala.** Esta cláusula la inyecta `respond-linear.ps1` a todos los agentes.
3. **Alfred barre** los issues `alfred` en su cron diario (`run-alfred.ps1 -Job sweep`) — o el owner lo llama directo (`Alfred: ...`). Diagnostica la causa raíz y decide si amerita un cambio de sistema.
4. **Si amerita**: cambia el artefacto correcto (regla de oro: comportamiento general → `agents.ps1`/wrapper; dominio del proyecto → override), abre un **PR contra el repo de agentes** (desde un clon limpio, `ALFRED_REPO_PATH`) y comenta el link. **Si no**: explica por qué y sugiere cerrar.
5. **El owner revisa y aprueba** el PR. Nada se mergea sin el owner.

Alfred toca SOLO el repo de agentes; si la causa está en el producto, lo dice y el owner invoca a `Cody:`. Método completo: [`docs/alfred.md`](../docs/alfred.md).

## Cómo agregar / cambiar / renombrar un agente

1. **`scripts/agents.ps1`** — actualiza el hashtable `$AgentRegistry` (nombre, emoji, rol, allowlist, system prompt).
2. **Este archivo** — actualiza la tabla y las secciones que lo nombren.
3. **`automation/n8n/linear-feedback-listener.json`** — actualiza la regex del IF y la del Execute Command (`^(Capi|Numa|Greta|Pico|Cody|Qualy|Daly|Leda|Alfred):`). **Ojo**: no re-importes el JSON de cero — exporta la versión viva de n8n, aplica el diff sobre esa y re-impórtala.
4. **`project.json → agents`** de cada proyecto — habilita o deshabilita el agente.
5. **`lead/scripts/model.mjs`** — si el agente crea issues con un prefijo `[…]` nuevo, súmalo a la clasificación del Project Lead (trabajo / registro / flujo) y al mapa prefijo → agente; si no, el lead no sabe de quién es ni si tiene que archivarlo.

Los lugares deben coincidir o el listener no va a routear bien.

## Project Lead (no es un agente del roster)

El **Project Lead** no tiene entrada en `scripts/agents.ps1`, no corre en el server y no firma con `🤖`: es Claude Code en la máquina del owner con la skill `.claude/skills/project-lead`. Cada mañana tría lo que dejan los agentes en todos los teams, archiva los registros leídos, junta duplicados y le lleva al owner hasta tres tareas listas para un sí; con el sí, publica el pedido al agente (`Cody: …`, `Qualy: …`, `Alfred: …`) con la API key del owner y lo sigue hasta producción. No reemplaza a Capi (que sigue siendo el PM de cada proyecto y el único dueño de `roadmap.md`). Detalle: [`lead/README.md`](../lead/README.md).

## Filosofía operativa

- **Capi NO es otro LLM corriendo aparte.** Es un system prompt + loadout. Hablar con "Capi" es una sesión de Claude Code con el prompt de Capi cargado.
- **Cada agente tiene su scope.** Numa no escribe propuestas (eso es Pico). Pico no implementa código (eso es Cody). Greta no toca datos de prod (read-only). Cody no mergea (el owner).
- **Lupa es la única que no firma con identidad propia.** Sus hallazgos los cita el agente que la invocó.
