# Cómo usar los agentes

> Manual operativo del equipo de agentes, con ejemplos del proyecto **Acme** (team de Linear `ACM`).
> Fuentes de verdad técnicas: [`scripts/agents.ps1`](../scripts/agents.ps1) (identidad y tools de cada agente) y [`memory/agents-roster.md`](../memory/agents-roster.md) (roster y flujos). Si algo de aquí las contradice, ganan ellas.

---

## En 30 segundos

Hablas con los agentes **comentando en un issue de Linear** (team `ACM`), empezando el comentario con el **nombre del agente + `:`**.

```
Numa: ¿cuánto convirtió ayer por canal?
```

- **Sin `@`**: Linear lo toma como mención de usuario y no dispara nada. Usa texto plano.
- **No distingue mayúsculas**: `numa:` = `Numa:`.
- El agente responde **en el mismo issue** con un comentario que empieza con `🤖 <Nombre> <Emoji>:`.
- Algunos agentes **corren solos por cron** (no hace falta llamarlos). Ver [Qué corre solo](#qué-corre-solo-crons).
- **Un issue nuevo no arranca a nadie**: lo que pone a trabajar a un agente es un comentario que empieza con su nombre. Si creas un issue para un agente, comenta `Nombre: …` en él.
- Cuando un agente toma un pedido que produce trabajo (código, verificación, mockup, draft, publicación), **pasa el issue a In Progress** para que en Linear se vea que alguien lo está trabajando. Una consulta que se contesta en el comentario no cambia el estado, y ningún agente reabre un issue cerrado.
- **¿No sabes qué pedir hoy?** Si usas el **Project Lead** (Claude Code en tu máquina con la skill `.claude/skills/project-lead`), cada mañana te abre una charla con lo que hay para mergear, las decisiones rápidas y hasta tres tareas listas, cada una con el pedido al agente ya escrito; con tu sí las publica en Linear y las sigue hasta producción. Cómo funciona: [`lead/README.md`](../lead/README.md).

---

## El equipo

| Agente | Lo llamas con | Qué hace | Modelo (default) | HITL |
|---|---|---|---|---|
| **Capi** 🫒 | `Capi:` | Project Lead. Lee el issue, responde o te dice qué agente debería tomarlo, y **puede crear issues** `[Proposal]` para trackear o delegar. Además es el dueño del roadmap. | Sonnet (listener) / Opus (roadmap) | 1 |
| **Numa** 📊 | `Numa:` | Data. Funnel, conversión, revenue, anomalías, CAC y ROAS. Fuentes: Supabase (o la base MySQL del producto), GA4, Core Web Vitals, Stripe, Google Ads y Vercel (todo solo lectura). | Sonnet | 1 |
| **Greta** 📈 | `Greta:` | Growth. Ads, SEO/AEO, email, conversión. Copy customer-facing. | Sonnet (listener) / Opus (crons) | 1–2 |
| **Pico** 🎯 | `Pico:` | Product. Convierte insights en **propuestas** → crea issues `[Proposal]`. | Opus | 2 |
| **Cody** 💻 | `Cody:` | Code. Lee el repo del producto, crea una rama y **abre un PR**. Nunca mergea. | Opus (xhigh) | 2 |
| **Qualy** 🧪 | `Qualy:` | QA. Corre tests (unitarios + Playwright), testeo exploratorio, revisión de logs (Supabase + Vercel) y la revisión semanal de seguridad. Reporta PASS/FAIL. | Sonnet | 1–2 |
| **Daly** 🎨 | `Daly:` | UX/UI. Escribe **mockups HTML reales** + un brief para Cody en `design/`. | Opus | 1–2 |
| **Leda** 📖 | `Leda:` | Contenido. Llena el **banco de ideas** del blog con evidencia de demanda, escribe cada nota, genera la imagen, **agenda y publica**. | Sonnet | 2 (3 en la carga del banco) |
| **Alfred** 🎩 | `Alfred:` | Mejora a los **otros agentes**: diagnostica por qué actuaron mal y **abre un PR contra el repo de agentes**. No toca el producto. No mergea. | Opus (high) | 1 |

Además está **Lupa** 🔍, que no se llama directamente: es la convención para que los otros agentes lancen un subagente de búsqueda (código, docs, web) y citen lo que encontró ("según Lupa 🔍: …").

---

## Qué le pides a cada uno (ejemplos)

### Capi 🫒 — Project Lead
Para cuando no sabes a quién pedirle algo o quieres una respuesta rápida de contexto.
```
Capi: ¿quién debería ver esto?
Capi: resúmeme en qué quedó este issue
```
> Capi **lee, responde, rutea y puede crear issues** (te dice "esto es para Numa / Pico / etc." y, si conviene, deja un `[Proposal]` en Backlog para no perder el pendiente). No dispara a otro agente solo: el siguiente llamado lo haces tú.

### Numa 📊 — Data
```
Numa: conversión free→paid del último mes, con n y %
Numa: ¿están llegando los pagos a Stripe o están fallando? muéstrame los decline codes
Numa: ¿de qué canal vino el tráfico esta semana? (GA4)
Numa: ¿cuánto gastamos en Google Ads el mes pasado y cuál fue el CAC?
Numa: ¿hubo un deploy o un pico de errores el día que cayó la conversión? (Vercel)
```
> Solo lectura y agregados (nunca PII). Si dos fuentes difieren, te explica por qué. Antes de citar una métrica, confirma la definición en el glossary del proyecto. Además, si el proyecto lo tiene configurado, te manda **un pulso diario a Discord** (`funnel-daily-pulse`): las últimas 24 h del funnel contra el promedio de 7 días, en 20 segundos de lectura.

### Greta 📈 — Growth
```
Greta: ¿cómo viene el funnel de checkout esta semana?
Greta: dame 3 ángulos de copy para la landing principal de Acme
```
> Antes de escribir copy carga la brand voice del proyecto. Si hace falta tocar código, te deriva a Pico o Cody.
> Además corre **dos crons semanales** por su cuenta: **SEO** y **AEO** (Answer Engine Optimization: aparecer citado en respuestas de asistentes de IA). Cada uno deja un `[Report]` + hasta 3-5 `[Proposal]` en Linear. Cada cron mantiene su propio archivo de memoria para no repetir propuestas.

### Pico 🎯 — Product
```
Pico: convierte el insight de Numa en una propuesta accionable
Pico: propón cómo reducir el abandono en el paso de pago
```
> Si el cambio es acotado y claro, **crea un issue `[Proposal]`** en Backlog y te deja el link. Si es ambiguo o grande, solo comenta.

### Cody 💻 — Code
```
Cody: implementa ACM-23
Cody: estima el alcance del [Proposal] de ACM-23
```
> Necesita un issue de referencia. Crea la rama `cody/ACM-xx`, corre el gating local (typecheck, lint, tests), **abre un PR** y te comenta el link. **Tú revisas y mergeas**: Cody nunca mergea. Es el agente más pesado; si corre contra tu suscripción, comparte rate limits con tu uso interactivo.

### Qualy 🧪 — QA
```
Qualy: testea el preview del PR de ACM-23 y dime si rompe algo
Qualy: smoke de los flujos clave de producción
```
> No toca producción de forma destructiva (no completa pagos ni registros reales). Reporta ✅/❌/⚠️ con casos concretos. Una vez por semana corre `security-review`: aislamiento de datos entre cuentas en la base, authz de cada ruta, superficie sin sesión, secretos en el repo, accesos y dependencias; abre un `[QA-sec]` por hallazgo nuevo y nunca se loguea ni muta nada.

### Daly 🎨 — Diseño
```
Daly: haz el mockup del estado vacío del dashboard cuando el usuario no tiene datos
Daly: revisa el preview del PR de ACM-23 contra tu mockup
```
> Deja `design/acme/ACM-X-<slug>/` con `mockup.html` (se abre con doble clic) + `brief.md` (spec para Cody). Nunca escribe en el repo del producto.

### Leda 📖 — Contenido del blog
```
Leda: ¿qué hay en el banco de ideas?   # ideas pendientes y lo que está en curso
Leda: carga esta idea: <tema>          # una idea puntual al banco (pasa el mismo filtro que el scan)
Leda: mejora el post <id>              # pulido puntual, sin agendar
Leda: stop ACM-42                      # cancela una publicación agendada
```
> En modo automático (cron) escribe la nota de madrugada y **la agenda**; sale con el tick diario siguiente, y hasta ese tick la puedes frenar. Ver [Flujo de contenido](#flujo-de-contenido-leda).

### Alfred 🎩 — Mejora a los agentes
```
Alfred: Numa alarma por variaciones chicas aunque le dije que no — revisa cómo actúa
Alfred: revisa el prompt de Cody, se salteó el gating en ACM-40
```
> Alfred mejora a los **otros** agentes. Se activa de dos formas:
> - **Solo (cron diario)**: barre las **escalaciones** de los agentes. Cuando le marcas con fuerza a un agente que su forma de actuar estuvo mal, el agente (además de arreglar lo puntual) deja un issue `[Retro]` con label `alfred`. Alfred los procesa: si amerita, cambia el prompt, el wrapper o la doc del agente y **abre un PR contra el repo de agentes**; si no, comenta por qué.
> - **Directo**: `Alfred: <lo que quieres que revise o cambie>` en cualquier issue.
>
> **Tú revisas y apruebas el PR**: nada se mergea sin ti. Alfred toca SOLO el repo de agentes; si el problema es del producto, te dice que llames a Cody. Para feedback chico o puntual **no** hace falta Alfred. Método: [`alfred.md`](alfred.md).

---

## Cómo apruebas o cancelas (modelo HITL)

Cada agente tiene un **nivel HITL** (human-in-the-loop):

- **Nivel 1 (Capi, Numa, Greta)** — leen y comentan (Capi además puede dejar issues `[Proposal]` en Backlog). No ejecutan acciones en producción ni mergean: lo que generan queda en Backlog para tu revisión.
- **Alfred (nivel 1, caso especial)** — corre solo y **abre PRs contra el repo de agentes**, pero no toca producción y **nada se mergea sin ti**: el PR es el gate humano.
- **Nivel 2 (Pico, Cody, Daly, Qualy, Leda)** — proponen una acción y esperan tu decisión:
  - **Pico / Daly** → crean un issue (`[Proposal]` / `[Design]`) en **Backlog**. Tú decides si avanzar (y recién ahí llamas a Cody).
  - **Cody** → abre un **PR en GitHub**. Tú lo revisas y lo mergeas.
  - **Qualy** → te da un veredicto PASS/FAIL. Tú decides.
  - **Leda** → es la excepción: **agenda y publica sola** con el tick diario que sigue a la ventana, salvo que canceles antes con `Leda: stop ACM-X`. Es "aprobación por defecto" con ventana de cancelación. Y el banco de ideas lo carga sola (nivel 3): lo que no quieras que se escriba, lo borras en el admin del CMS mientras siga en `idea`.

**Anti-loop**: las respuestas de los agentes empiezan con `🤖`, y el sistema ignora todo comentario que empiece con `🤖` para que no se respondan a sí mismos. Por eso nunca empieces un pedido con 🤖.

**Re-disparar**: si un agente falló, **vuelve a comentar** `Nombre: ...`. El sistema no reintenta solo (para recuperar en lote, ver `scripts/recover-failed-runs.ps1`).

---

## Qué corre solo (crons)

No hace falta llamarlos: corren en horario fijo y dejan su resultado en Linear + en `queue/pending-review/`. Los workflows están en `automation/n8n/`; activa solo los que uses.

| Cron | Agente | Frecuencia sugerida |
|---|---|---|
| `signup-to-paid-tracker` | Numa 📊 | diario |
| `funnel-monitor` | Numa 📊 | cada pocas horas |
| `funnel-daily-pulse` | Numa 📊 | diario — un mensaje corto a Discord con las últimas 24 h contra el promedio de 7 días; no crea issue |
| `greta-seo-weekly` (`seo-weekly-review`) | Greta 📈 | semanal |
| `greta-aeo-weekly` (`aeo-weekly-review`) | Greta 📈 | semanal (otro día que SEO) |
| `product-idea-scan` | Pico 🎯 | semanal |
| `tech-debt-scan` | Cody 💻 (solo lectura) | semanal |
| `pm-progress-review` | Capi 🫒 | 3 veces por semana |
| `product-shipped-digest` | Pico 🎯 | semanal (viernes); opcional, también a Discord |
| `content-topic-scan` | Leda 📖 | semanal, después de la revisión SEO — carga el banco de ideas del blog |
| `leda-blog-publisher` | Leda 📖 | diario, fuera de horario activo |
| `leda-publish-tick` | Leda 📖 | diario, a primera hora (sin posts vencidos, sale sin llamar al modelo) |
| `qualy-prod-smoke` | Qualy 🧪 | semanal |
| `qualy-log-review` | Qualy 🧪 | diario (la retención de los logs de runtime del hosting suele ser de ~24 h: un review semanal solo ve el último día) |
| `security-review` | Qualy 🧪 | semanal — aislamiento de datos, authz de rutas, secretos, accesos y dependencias |
| `alfred-daily-sweep` | Alfred 🎩 | diario |
| `sync-agents-repo` | (sin agente) | cada pocas horas |
| `sync-product-repos` | (sin agente) | diario (los wrappers además lo corren antes de leer código) |
| `core-health-check` / `core-auth-probe` | (sin agente) | diario / cada pocas horas |
| `linear-feedback-listener` | (todos) | webhook, siempre activo — es lo que hace funcionar los `Nombre:` |

El loop de roadmap (idea-scan, tech-debt-scan, progress-review, shipped-digest) está explicado en [`product-roadmap-loop.md`](product-roadmap-loop.md).

---

## Los dos flujos canónicos

### Flujo de diseño (Pico → Daly → Cody → Qualy)
1. **Pico** propone (issue `[Proposal]`). Si toca UI, sugiere acompañarlo con un mockup de Daly.
2. Tú: `Daly: haz el mockup de ACM-X`.
3. **Daly** deja `mockup.html` + `brief.md` en `design/acme/ACM-X-<slug>/` y comenta.
4. Abres el mockup y, si te convence: `Cody: implementa el diseño de ACM-X`.
5. **Cody** usa el brief de Daly como spec, **reutiliza componentes existentes** (no reinventa) y abre el PR.
6. **Review visual obligatorio** en cambios de UI: `Qualy: testea el preview del PR de ACM-X`. Qualy abre el preview con un browser real (Playwright), toma screenshots en mobile y desktop y verifica que el render no esté roto. Complemento: `Daly: revisa el preview del PR de ACM-X contra tu mockup`.
7. **Mergeas** si todo está en verde **y el review visual pasó**.

> Ningún agente dispara a otro automáticamente. **Tú eres el eslabón entre cada paso.**

> ⚠️ **Por qué el paso 6 no es opcional en cambios visuales.** Cody es un **agente ciego**: nunca ve lo que renderiza. Corre typecheck, lint y tests y abre el PR, pero **esas compuertas pasan aunque la UI quede rota** (un botón invisible, un ícono desalineado, una card distinta al resto). Cuando trabajas con Claude directamente, el loop visual eres tú mirando la pantalla; en el pipeline headless ese ojo lo ponen **Qualy (screenshots del preview) o Daly (preview vs. mockup)**. Sin ese paso, los bugs visuales llegan al merge.

### Flujo de contenido (Leda)
El blog trabaja con un **banco de ideas** (collection `topics` del CMS) en vez de drafts que deja un workflow sin mirar lo publicado: así se evita que varias notas compitan por la misma búsqueda.
1. **Leda (scan semanal, `content-topic-scan`)** busca ideas con evidencia de demanda (Search Console, la memoria SEO/AEO de Greta, la temporada) — notas nuevas y `refresh:` de notas publicadas —, las deduplica contra lo publicado, lo que está en curso y el banco, y **las carga sola** al banco con `scripts/seed-topics.ps1`. Deja un issue `[Topics]` con lo que cargó.
2. Tú no apruebas la tanda. Si una idea no va, la borras en el admin del CMS antes de que el cron la tome. El issue solo pide algo cuando Leda tiene una pregunta para ti (una categoría nueva, consolidar notas que se pisan): entonces el título termina en `· con preguntas`.
3. **Leda (cron diario)** toma una idea y **escribe la nota desde cero** (respuesta directa arriba, checklist, datos con fuente, FAQ, links a notas hermanas), genera la **imagen** y **la agenda**. Crea un issue `[Content]` con el preview y el día en que sale. Si la idea es un `refresh:`, reescribe esa nota publicada y la publica en la misma corrida si pasa los controles; deja un issue `[Refresh]` con lo que cambió (si no te gusta, restauras la versión anterior desde el historial del CMS).
4. Revisas hasta el tick siguiente. Si no haces nada → **se publica solo**. Si no te gusta → `Leda: stop ACM-X` antes de ese tick. Para una edición chica de texto, edita directamente en el CMS.
5. **Leda (tick diario, a primera hora)** publica lo que venció sin cancelarse y comenta el link público. El health check avisa si el tick no corrió o si un post vencido quedó sin publicar.

---

## Dónde queda el output

- **Comentarios** → en el mismo issue de Linear.
- **Issues nuevos** → team `ACM`, estado `Backlog`, sin asignar. El label separa lo que te pide algo de lo que solo deja constancia:
  - **Decisiones** (label `agent-proposal`, quedan abiertas hasta que las trabajes): `[Proposal]` (Pico, Capi, crons), `[Design]` (Daly), `[QA-sec]` / `[QA-front]` (Qualy), `[Alert]` (health-check y anomalías), `[Retro]` (escalaciones para Alfred).
  - **Registros** (label `agent-report`): `[Report]` / `[Plan]` (crons), `[Topics]` (Leda). Un issue por corrida con título fijo por serie; ningún agente los cierra y el Project Lead los archiva a los 2 días (el `[Plan]` de la semana queda hasta el siguiente). Una corrida sin novedades no crea issue.
  - **Flujo**: `[Content]` / `[Refresh]` (Leda), que siguen la publicación de una nota.
- **Pulso diario** → un mensaje en el canal de Discord del proyecto (no crea issue).
- **Briefs locales de los crons** → `queue/pending-review/YYYY-MM-DD-<proyecto>-<skill>.md` (no se versiona).
- **Mockups de Daly** → `design/acme/<IssueId>-<slug>/` (sí se versiona).
- **PRs de Cody** → GitHub, en el repo del producto (`productRepoUrl`).
- **PRs de Alfred** → GitHub, en este repo.
- **Plan priorizado** → `projects/acme/roadmap.md` (lo reescribe Capi).

---

## Gotchas para operar

- **No uses `@`** para llamar a los agentes en Linear. Texto plano: `Numa: ...`.
- Un comentario que empieza con `🤖` **no dispara nada** (es el guard anti-loop).
- **Re-disparar** = volver a comentar; no hay reintento automático.
- Si los agentes corren contra una **suscripción** (OAuth), comparten rate limits con tu uso interactivo: si corres mucho en simultáneo, puede haber throttling. Escalona los crons pesados.
- Si un día **ningún agente responde**, lo más probable es un logout del OAuth de la CLI en el server: el `core-auth-probe` lo detecta y crea un `[Alert]`.
- Si cambias un workflow de n8n desde la UI, re-exporta el JSON al repo; si cambias el JSON del repo, aplica el diff mínimo sobre la versión viva (no re-importes a ciegas).
- **Zona horaria de n8n**: los workflows del repo traen `settings.timezone`, pero un export vivo puede no tenerla y entonces el cron dispara en la zona por defecto de n8n. Si los `[Report]` llegan a otra hora que la que dice el workflow, configura `GENERIC_TIMEZONE` en el servicio de n8n (ver `docs/server-setup.md`).
