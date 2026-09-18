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

---

## El equipo

| Agente | Lo llamas con | Qué hace | Modelo (default) | HITL |
|---|---|---|---|---|
| **Capi** 🫒 | `Capi:` | Project Lead. Lee el issue, responde o te dice qué agente debería tomarlo, y **puede crear issues** `[Proposal]` para trackear o delegar. Además es el dueño del roadmap. | Sonnet (listener) / Opus (roadmap) | 1 |
| **Numa** 📊 | `Numa:` | Data. Funnel, conversión, revenue, anomalías. Fuentes: Supabase, GA4, Core Web Vitals, Stripe (solo lectura). | Sonnet | 1 |
| **Greta** 📈 | `Greta:` | Growth. Ads, SEO/AEO, email, conversión. Copy customer-facing. | Sonnet (listener) / Opus (crons) | 1–2 |
| **Pico** 🎯 | `Pico:` | Product. Convierte insights en **propuestas** → crea issues `[Proposal]`. | Opus | 2 |
| **Cody** 💻 | `Cody:` | Code. Lee el repo del producto, crea una rama y **abre un PR**. Nunca mergea. | Opus (xhigh) | 2 |
| **Qualy** 🧪 | `Qualy:` | QA. Corre tests (unitarios + Playwright) y testeo exploratorio. Reporta PASS/FAIL. | Sonnet | 1–2 |
| **Daly** 🎨 | `Daly:` | UX/UI. Escribe **mockups HTML reales** + un brief para Cody en `design/`. | Opus | 1–2 |
| **Leda** 📖 | `Leda:` | Contenido. Mejora drafts del blog, genera la imagen, **agenda y publica**. | Sonnet | 2 |
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
```
> Solo lectura y agregados (nunca PII). Si dos fuentes difieren, te explica por qué. Antes de citar una métrica, confirma la definición en el glossary del proyecto.

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
> No toca producción de forma destructiva (no completa pagos ni registros reales). Reporta ✅/❌/⚠️ con casos concretos.

### Daly 🎨 — Diseño
```
Daly: haz el mockup del estado vacío del dashboard cuando el usuario no tiene datos
Daly: revisa el preview del PR de ACM-23 contra tu mockup
```
> Deja `design/acme/ACM-X-<slug>/` con `mockup.html` (se abre con doble clic) + `brief.md` (spec para Cody). Nunca escribe en el repo del producto.

### Leda 📖 — Contenido del blog
```
Leda: ¿qué hay en el backlog?          # lista de drafts pendientes
Leda: mejora el post <id>              # pulido puntual, sin agendar
Leda: stop ACM-42                      # cancela una publicación agendada
```
> En modo automático (cron) procesa drafts y **agenda la publicación con una ventana de cancelación**. Ver [Flujo de contenido](#flujo-de-contenido-leda).

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
  - **Leda** → es la excepción: **agenda y publica sola** al cerrarse la ventana, salvo que canceles con `Leda: stop ACM-X`. Es "aprobación por defecto" con ventana de cancelación.

**Anti-loop**: las respuestas de los agentes empiezan con `🤖`, y el sistema ignora todo comentario que empiece con `🤖` para que no se respondan a sí mismos. Por eso nunca empieces un pedido con 🤖.

**Re-disparar**: si un agente falló, **vuelve a comentar** `Nombre: ...`. El sistema no reintenta solo (para recuperar en lote, ver `scripts/recover-failed-runs.ps1`).

---

## Qué corre solo (crons)

No hace falta llamarlos: corren en horario fijo y dejan su resultado en Linear + en `queue/pending-review/`. Los workflows están en `automation/n8n/`; activa solo los que uses.

| Cron | Agente | Frecuencia sugerida |
|---|---|---|
| `signup-to-paid-tracker` | Numa 📊 | diario |
| `funnel-monitor` | Numa 📊 | cada pocas horas |
| `greta-seo-weekly` (`seo-weekly-review`) | Greta 📈 | semanal |
| `greta-aeo-weekly` (`aeo-weekly-review`) | Greta 📈 | semanal (otro día que SEO) |
| `product-idea-scan` | Pico 🎯 | semanal |
| `tech-debt-scan` | Cody 💻 (solo lectura) | semanal |
| `pm-progress-review` | Capi 🫒 | 3 veces por semana |
| `product-shipped-digest` | Pico 🎯 | semanal (viernes) |
| `leda-blog-publisher` | Leda 📖 | diario, fuera de horario activo |
| `leda-publish-tick` | Leda 📖 | cada hora |
| `qualy-prod-smoke` | Qualy 🧪 | semanal |
| `qualy-log-review` | Qualy 🧪 | diario |
| `alfred-daily-sweep` | Alfred 🎩 | diario |
| `sync-agents-repo` | (sin agente) | cada pocas horas |
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
1. Un workflow (o una persona) deja un **draft** en el CMS del blog.
2. **Leda (cron diario)** lo mejora (texto, SEO, links internos y externos, tags, categoría), genera la **imagen** y la sube, y **agenda la publicación** dentro de una ventana (por ejemplo, +6 h). Crea un issue `[Content]` con el link de preview.
3. Revisas dentro de la ventana. Si no haces nada → **se publica solo**. Si no te gusta → `Leda: stop ACM-X`. Para una edición chica de texto, edita directamente en el CMS.
4. **Leda (tick horario)** publica los que vencieron sin cancelarse y comenta el link público.

---

## Dónde queda el output

- **Comentarios** → en el mismo issue de Linear.
- **Issues nuevos** → team `ACM`, label `agent-proposal` / `agent-report`, estado `Backlog`, sin asignar:
  - `[Proposal]` (Pico, Capi, crons), `[Design]` (Daly), `[Content]` (Leda), `[Report]` / `[Plan]` (crons), `[Retro]` (escalaciones para Alfred), `[Alert]` (health-check).
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
