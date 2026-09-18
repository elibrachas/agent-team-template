---
name: aeo-weekly-review
description: Use when running the project's weekly AEO review (Answer Engine Optimization) — measure the GA4 "AI Assistant" channel, audit on-site AEO-readiness of the product repo (llms.txt, schema coverage, SSR/extractability, entity clarity), probe answer-engine citation via WebSearch (proxy), and produce a prioritized weekly proposal that COMPLEMENTS the SEO review (never duplicates it). Keeps a persistent memory (aeo-memory.md) so it never re-proposes the same thing and tracks disposition (wont-fix / done-but-limited). Read-only on prod; the only writes are its memory ledger (aeo-memory.md) and the living section of its plan (aeo-strategy.md §1-2). Cody also appends progress lines to the plan when it ships an aeo-labeled issue.
hitl_level: 1
owner: owner
agent: greta
schedule: "0 4 * * 4"   # jueves 04:00 (hora del server)
model: claude-opus-4-8   # effort high — corre vía scripts/run-greta-aeo.ps1 (NO run-skill.ps1)
inputs:
  - "aeo-strategy.md: el plan vivo (estrategia estable §3+ que la skill LEE como brújula; sección viva §1-2 que la skill REESCRIBE; Cody también appendea avances a §1)"
  - "aeo-memory.md: ledger de hallazgos previos + su disposición (la skill lo reescribe)"
  - "ga4 (mcp__ga4__*): canal 'AI Assistant' — sesiones, trend WoW/28d, top landings que la IA referencia, conversión downstream"
  - "supabase (read-only): conversión atribuida al canal IA (si la derivación de canal lo captura), inventario de contenido = superficie de citación"
  - "repo del producto ../acme-app (read-only): robots, llms.txt, helpers de JSON-LD + wiring por ruta, SSR/extractabilidad de landings, entidad (Organization/WebSite)"
  - "websearch (WebSearch, built-in): probing de citación sobre queries de alta intención — PROXY de la respuesta IA real, declarado como tal"
outputs:
  - "Linear (team ACM): [Report] (AEO) semanal (label agent-report) + hasta 3-5 [Proposal] (AEO) nuevos (label agent-proposal + aeo); estado Backlog, sin asignar"
  - "aeo-memory.md (ledger) + sección viva de aeo-strategy.md (§1 Estado y avances, §2 Próximos pasos) — los DOS writes permitidos de Greta"
  - "queue/pending-review/YYYY-MM-DD-greta-aeo.md (espejo del brief; lo escribe el wrapper)"
cost_budget_usd: 15   # cap real en scripts/run-greta-aeo.ps1 (--max-budget-usd). Opus high es caro; tunable.
---

# aeo-weekly-review

> **HITL 1 — read-only sobre prod.** Mide el canal AI Assistant (GA4), audita el repo del producto (solo lectura) y sondea answer-engines vía WebSearch. No escribe nada a prod, no toca PII. Sus **dos writes** son su memoria (`aeo-memory.md`) y la **sección viva** de su plan (`aeo-strategy.md` §1-2). Entrega un reporte semanal + propuestas accionables; el owner decide qué se hace.

Revisión **AEO** semanal del proyecto. AEO = Answer Engine Optimization: aparecer/ser **citado** en respuestas de motores de IA (ChatGPT, Perplexity, Gemini, Google AI Overviews, Claude). Cruza las fuentes disponibles, las contrasta con su **memoria** para no repetir propuestas, y deja un **reporte + hasta 3-5 propuestas priorizadas** en Linear. Foco de negocio: que la IA cite al proyecto para las queries de alta intención de su categoría → tráfico del canal AI Assistant → signup → activación → compra (la palanca de la meta definida en `projects/<slug>/roadmap.md`). **Audita, estructura y optimiza — nunca regenera contenido** (si el contenido lo generan workflows de n8n u otros agentes, eso queda fuera de esta skill).

> **Complementario al SEO, no un reemplazo.** El north star está en `aeo-strategy.md`. **SEO gana el clic en el SERP; AEO gana la cita en la respuesta de IA.** Mismo activo (el contenido), distinta superficie. Ver la regla dura de complementariedad/anti-duplicación abajo.

## Cómo corre (runtime)

- **Cron** jueves 04:00 (hora del server) vía `scripts/run-greta-aeo.ps1` (Opus, effort `high`). NO usa `run-skill.ps1` ni el loadout comment-only de Greta del registry. (Jueves para no colisionar con los crons de los lunes ni con los de los viernes.)
- **Loadout**: `Read`/`Glob`/`Grep` (auditoría del repo del producto), `WebSearch` (probing de citación), `Write` (**SOLO** `aeo-memory.md` + la sección viva §1-2 de `aeo-strategy.md`), MCPs `supabase`/`linear`/`ga4` (de `plugins/team-growth/aeo.mcp.json`).
- Read del repo del producto vía `--add-dir ..\..\acme-app` (solo lectura).

## Antes de correr (dependencias / contexto)

El wrapper te pasa el directorio de contexto del proyecto (`projects/<slug>/`).

1. **Lee este SKILL completo** y ejecuta su método (abajo).
2. **Lee `aeo-strategy.md`** (el plan vivo — los 3 pilares, el modelo de medición, la complementariedad con SEO). Tus propuestas deben hacer avanzar esa estrategia. **Tú mantienes la sección viva** (§1 Estado y avances, §2 Próximos pasos): la reescribes al final reconciliándola contra Linear. **No toques las secciones de estrategia** (§3 en adelante) salvo para reflejar un giro real, y en ese caso avísalo en el `[Report]`. Nunca las vacíes.
3. **Lee `aeo-memory.md`** (la memoria — sección siguiente).
4. **Carga `projects/<slug>/data-model.md`** → columnas de canal de adquisición (first/last touch y cómo se derivan), eventos de analytics, tablas de contenido. **Confirma si existe un bucket de canal IA/LLM en la base** o si el canal AI Assistant es GA4-only (gap de atribución a declarar). No inventes SQL: usa las queries canónicas y fíltralas.
5. **Solo si vas a proponer copy customer-facing** (contenido de un `llms.txt`, respuestas FAQ nuevas, descripción de entidad): carga `team-shared/skills/brand-voice` + `projects/<slug>/brand-bible.md` → registro, promesas prohibidas, posicionamiento. **Importa doble en AEO**: el motor cita literal, así que una promesa de más se reproduce en la respuesta de IA.

## La memoria (`aeo-memory.md`) — no repetir, trackear disposición

Mismo contrato que la memoria de SEO. Que NO propongas lo mismo cada semana y que registres cuándo algo se marcó "no se hace" o "se hizo pero limitado".

**Formato**: tabla `| id | título | primera-vez | última-vez | status | issue | nota |`. El `id` es un **slug estable** del hallazgo (ej. `aeo-llms-txt-ausente`, `aeo-faq-coverage-guias`, `aeo-ai-channel-trend`). Reusa el MISMO id entre semanas — es la clave del dedupe.

**Vocabulario de `status`**: `propuesto` · `aceptado` · `hecho` · `hecho-parcial` · `wont-fix` · `recurrente` (definidos en el header de `aeo-memory.md`).

**Reconciliación (hazla ANTES de proponer nada):** la disposición REAL vive en Linear — el estado del issue manda. Para cada fila con link en `issue`:
1. Lee el issue en Linear (MCP) y su thread.
2. Actualiza el `status`: `Done` ⇒ `hecho`; `Canceled` ⇒ `wont-fix`; un comentario que diga que se hizo parcial/limitado ⇒ `hecho-parcial` (anota el gap en la nota); sigue en `Backlog` ⇒ `propuesto`; movido a `Todo`/`In Progress` ⇒ `aceptado`.

**Reglas de no-repetición** al matchear los hallazgos de ESTA semana contra el ledger (por `id`/semántica):
- Matchea un `wont-fix` → **NO crees issue nuevo**. Solo si el problema **empeoró materialmente**, comenta el issue Canceled existente con el nuevo data point; no abras otro.
- Matchea un `hecho` → no re-proponer. Si la señal **regresó**, es un hallazgo NUEVO (fila nueva con id nuevo que referencia al viejo en la nota).
- Matchea un `hecho-parcial` → propón SOLO el **gap restante**, citando qué ya se hizo.
- Matchea un `propuesto`/`aceptado` abierto → **no dupliques**. Refresca `última-vez`; si la señal cambió, deja un comentario `🤖 Greta 📈:` en el issue con el dato actualizado.
- Brand-new → crea la fila + el issue `[Proposal] (AEO)`.

**Reescritura (tus DOS writes permitidos):** al final, con el tool `Write`: (1) **reescribe `aeo-memory.md` completo** con las filas actualizadas (status reconciliado + `última-vez` actualizada) + las filas nuevas; (2) **reescribe la sección viva de `aeo-strategy.md`** — SOLO §1 (Estado y avances: actualiza el estado actual, reconcilia los avances contra Linear, mantén ~12 recientes y poda lo viejo) y §2 (Próximos pasos: re-prioriza). **HARD STOP: esos son los ÚNICOS dos archivos que escribes, y en `aeo-strategy.md` SOLO tocas §1-§2** (las secciones de estrategia §3+ son estables — no las reescribas salvo giro real avisado en el `[Report]`). Nunca escribas otro path, nunca nada en el repo del producto. **Ojo con Cody**: él también appendea líneas a §1 (Avances) cuando implementa; al reconciliar respeta/consolida lo que él haya dejado, no lo borres si sigue vigente.

## Complementariedad con SEO (regla dura — anti-duplicación)

**Antes de proponer, lee AMBOS boards de Linear** (issues con label `aeo` **y** con label `seo`) + cruza con `seo-memory.md` si hace falta.
- **AEO cede a SEO** en: posición/ranking del SERP, CTR del SERP, Core Web Vitals, indexación. **No re-propongas** temas de ranking puro — son de SEO.
- **AEO es dueña de**: acceso de crawler de IA (robots para GPTBot/etc.), `llms.txt`, extractabilidad-para-LLM, **cobertura de schema para extracción**, entidad/autoridad para citación, y el **canal AI Assistant**.
- **Mejora que sirve a las DOS superficies** (ej. cablear FAQPage en una ruta de contenido, mejorar estructura/SSR de una guía): si SEO **ya** la tiene como issue, **NO abras uno nuevo** — comenta el issue de SEO sumando el rationale AEO (extractabilidad/citación) y regístralo en `aeo-memory.md` apuntando a ese issue. Si NO existe del lado SEO, puedes crear el `[Proposal] (AEO)` (y mencionar el beneficio SEO).
- Reserva tus 3-5 plazas para lo **netamente AEO** o el ángulo AEO que SEO no cubre.

## Fuentes y qué mirar

### A. GA4 — canal "AI Assistant" (`mcp__ga4__*`) — el KPI lagging de AEO
- `run_report`: sesiones del canal AI Assistant (o el grouping de IA/LLM que GA4 exponga) — trend WoW y vs 28 d. **Reporta `n`, no solo %** (el canal suele ser de n chico).
- Top landing pages que la IA referencia (`landingPagePlusQueryString` o equivalente) → qué páginas ya nos están citando los motores.
- **Conversión downstream**: engagement y eventos clave (signups) del tráfico IA-referido vs orgánico. ¿El canal IA convierte mejor/peor? (con caveats de n).
- Si el canal "AI Assistant" no aparece como tal en este GA4, identifica las fuentes de referral de LLMs (chatgpt.com, perplexity.ai, gemini.google.com, copilot, etc.) y agrupa a mano; decláralo.

### B. Base de datos (read-only)
- ¿La derivación de canal de adquisición bucketea un canal IA/LLM? Si sí: signups y conversión free→paid de esas cohortes (caveat forward-only, n chico). Si **no**: el canal IA es GA4-only por ahora → decláralo como **gap de atribución** (candidato a propuesta: que el producto capture el referrer de LLM).
- Inventario de contenido `published` = la superficie de citación. NUNCA PII — solo agregados.

```sql
-- EJEMPLO: adapta a las tablas de tu data-model.md
SELECT channel_first, count(*) AS signups
FROM users
WHERE channel_first = 'ai_assistant'
  AND created_at >= now() - interval '28 days'
GROUP BY 1;
```

### C. Auditoría de AEO-readiness del frontend (`../acme-app`, read-only — Glob/Grep/Read)
Contrasta contra los archivos REALES (no asumas). TODO(acme): ajusta los paths a tu stack.
- **Acceso de crawler** — `robots` (p. ej. `app/robots.ts`): ¿los crawlers de IA (GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended, CCBot, Amazonbot) están permitidos? Registra el estado conocido en `aeo-strategy.md` §5 y **confírmalo** cada corrida; flag SOLO si un cambio los bloqueó.
- **`llms.txt` / `llms-full.txt`** — chequea `public/` y rutas dinámicas (p. ej. `app/llms.txt/route.ts`). Si está ausente, es la propuesta insignia (shippear un `llms.txt` curado; copy con brand-voice). Si existe, verifica que siga vivo y actualizado.
- **Cobertura de schema** — el helper de JSON-LD del repo (WebSite, Organization, Product, Article, HowTo, **FAQPage**, BreadcrumbList, etc.). El trabajo suele ser **wiring/cobertura**: qué ruta emite efectivamente cada schema. Grepea los usos de cada helper en las rutas y detecta rutas de alta intención sin FAQPage/HowTo. (Si SEO ya tiene un issue para cablear ese schema → sinergia, no dupliques.)
- **Extractabilidad / SSR** — ¿la respuesta de la guía/landing está en el HTML inicial (SSR/estático) o inyectada por cliente? Los crawlers de IA ejecutan JS peor que Googlebot. Mira si las rutas de contenido son server-rendered y si la respuesta concisa está arriba + H2 en forma de pregunta + listas/pasos.
- **Claridad de entidad** — Organization/WebSite/sameAs consistentes para que el motor ligue el nombre del proyecto a su categoría.

### D. Probing de answer-engines — WebSearch (built-in) — pulso CUALITATIVO
Corre un set **fijo + rotativo** de preguntas de alta intención del público objetivo, en el idioma del sitio. TODO(acme): define el núcleo fijo en `aeo-strategy.md` §6 (5-6 preguntas de categoría: "qué es X", "cómo hacer Y", "mejores herramientas para Z", etc.).
- Rota 2-3 según lo que GA4/inventario sugiera (ej. el tema que más tracciona).

Por query mira: **(a)** ¿aparece el proyecto entre las fuentes? **(b)** ¿qué competidores/fuentes dominan la respuesta? **(c)** ¿el dato que se cita sobre el tema es correcto y nos favorece?

> **CAVEAT OBLIGATORIO (declararlo en el `[Report]`):** WebSearch es un **PROXY** de lo que ChatGPT/Perplexity/Gemini realmente responden — direccional, no ground truth. **NO cuantifiques "citation share"** ni inventes métricas. Repórtalo como señal cualitativa ("aparecemos / no aparecemos / nos gana X"). El probing real (API de answer-engine / browser MCP) está en el backlog (v2 — ver `aeo-strategy.md`).
> **Degradación elegante**: si `WebSearch` no está disponible en el runtime headless, marca la sección de probing como "no disponible esta corrida" y sigue con A/B/C. No estimes.

## Método (orden de ejecución)

1. Leer `aeo-strategy.md` (north star) + `aeo-memory.md` y reconciliar disposición contra Linear (sección memoria) — incluyendo el board de SEO para la regla de complementariedad.
2. GA4: canal AI Assistant (trend, top landings citadas, conversión downstream).
3. Base: ¿hay bucket de canal IA? conversión atribuida (o declarar el gap) + inventario de contenido.
4. Auditoría de readiness del frontend (sección C): crawler access, llms.txt, cobertura de schema, SSR/extractabilidad, entidad.
5. Probing WebSearch (sección D) — con el caveat de proxy.
6. Sintetizar hallazgos → deduplicar contra la memoria Y contra el board de SEO → priorizar (impacto × esfuerzo).
7. Crear el `[Report]` (AEO) + hasta 3-5 `[Proposal]` (AEO) nuevos en Linear (o comentar el issue de SEO si la mejora es compartida y ya existe).
8. Reescribir `aeo-memory.md` (ledger) + la sección viva de `aeo-strategy.md` (§1-2).
9. Devolver el brief completo como respuesta final.

## Output

### 1. Issue `[Report] (AEO) semana <YYYY-MM-DD>`
Team ACM, label `agent-report`, estado `Backlog`, sin asignar, sin priority. Body:
- **Headline**: estado del canal AI Assistant (sesiones WoW, `n` + %), estado de readiness (llms.txt sí/no, % de rutas clave con schema), titular del probing.
- **Canal AI Assistant**: trend + top landings citadas + conversión downstream (con caveats de n y atribución).
- **Readiness**: checklist (crawler access OK/no, llms.txt, cobertura de schema, SSR/extractabilidad, entidad) con el gap más jugoso arriba.
- **Probing (WebSearch — proxy)**: para qué queries aparecemos/no, quién nos gana — **declarando el caveat de proxy**.
- **Top 3-5 oportunidades** priorizadas (la base de las propuestas).
- **Reconciliación**: resumen de la memoria + qué se cruzó con el board de SEO (mejoras compartidas comentadas vs nuevas).
- **Caveats vigentes** (los que apliquen, sección abajo).
- Cerrar con `---` + `Generado por 🤖 Greta 📈`.

### 2. Issues `[Proposal] (AEO) <imperativo>` — hasta 3-5 NUEVOS
Solo para hallazgos accionables nuevos NO vetados por la memoria ni ya cubiertos por SEO. Team ACM, label `agent-proposal` **+ label `aeo`** (crea el label `aeo` en Linear si no existe), estado `Backlog`, sin asignar. Las **6 secciones canónicas** de `memory/CLAUDE.md` → "Linear destination convention": `## Contexto`, `## Hipótesis`, `## Propuesta`, `## Métrica de éxito`, `## Riesgos / contras`, `## Generado por`. Cerrar con `---` + `Generado por 🤖 Greta 📈`.
- **Cap duro: 3-5 propuestas nuevas por semana.** El resto queda listado en el `[Report]` como backlog (y en la memoria como `propuesto` solo cuando efectivamente crees el issue). Más que eso inunda el board.
- Si una propuesta toca código de UI/frontend (ej. `llms.txt`, cablear schema), menciona que la implementa Cody (y, si amerita mockup, Daly) — tú no dispatchas; lo decide el owner.
- **Antes de crear**: confirma que NO existe ya como issue `seo` (regla de complementariedad). Si existe, comenta ese issue en vez de crear uno nuevo.

### 3. Writes: `aeo-memory.md` + sección viva de `aeo-strategy.md`
`aeo-memory.md`: filas reconciliadas + nuevas (el ledger granular). `aeo-strategy.md`: SOLO §1 (Estado y avances) + §2 (Próximos pasos), reconciliados y podados (~12 avances recientes). Esos son los dos únicos writes; las secciones de estrategia del plan (§3+) no se tocan salvo giro real avisado en el `[Report]`.

### 4. Brief como respuesta final
Markdown, arranca con `🤖 Greta 📈:` + veredicto. El wrapper lo espeja a `queue/pending-review/`.

## Priorización

Ordena por **impacto × (1/esfuerzo)**. Alto impacto típico en AEO: shippear `llms.txt` (bajo esfuerzo, abre el Pilar A), cobertura de schema FAQ/HowTo en clusters de alto volumen de citación, fixes de extractabilidad/SSR en las landings que el canal IA ya toca, cerrar el gap de atribución del canal IA en la base. Reserva las 3-5 plazas para lo de mejor ratio y lo netamente AEO.

## Caveats obligatorios (declararlos en el output cuando apliquen)

1. **WebSearch es PROXY** — no es la respuesta real de ChatGPT/Perplexity. Señal cualitativa, sin "citation share".
2. **Atribución forward-only + n chico** — el canal AI Assistant suele ser nuevo y de bajo volumen; reporta `n`, no alarmes por swings de pocos casos; el histórico es mayormente `unknown`.
3. **Posible gap de atribución en la base** — si la derivación de canal no bucketea IA, el canal es GA4-only; no concluyas conversión desde la base sola.
4. **No regenerar contenido** — si el contenido lo generan workflows/otros agentes, tú auditas/estructuras/optimizas lo existente.
5. **Idiomas del sitio** — no inventes trabajo de hreflang/i18n si el sitio es de un solo idioma.
6. **No inventar datos** — si un número no sale de una query o un tool, no va. Si una fuente falla, dilo.
7. **Complementariedad** — no re-propongas lo que es de SEO (ranking/CTR/CWV) ni dupliques un issue `seo` existente.

## Autoauditoría antes de entregar

- ¿Leí `aeo-strategy.md` (north star) + `aeo-memory.md` y reconcilié contra Linear (incluyendo el board de SEO) ANTES de proponer?
- ¿Evité re-proponer algo `wont-fix`, ya `hecho`, o ya cubierto por un issue `seo`? ¿Los `hecho-parcial` los acoté al gap?
- ¿Declaré que el probing WebSearch es un proxy y evité cuantificar "citation share"?
- ¿Las propuestas son ≤5, priorizadas, y netamente AEO (o el ángulo AEO de una mejora compartida que SEO no cubre)?
- ¿Reporté `n` además de `%` para el canal IA? ¿Declaré el gap de atribución si aplica?
- ¿Algún número sin query/tool detrás? Si no sale de una fuente, fuera.
- ¿Escribí SOLO mis dos archivos (`aeo-memory.md` completo + §1-§2 de `aeo-strategy.md`), sin tocar la estrategia (§3+) ni nada en el repo del producto?
- ¿Cada issue cierra con la firma `Generado por 🤖 Greta 📈`?

## Notas de runtime

- Read-only sobre prod. Si una conexión falla, reporta el fallo en el brief y sigue con las fuentes que sí respondan — no estimes de memoria.
- **Degradación elegante**: si `WebSearch` o `mcp__ga4__*` no responden, la corrida sigue con lo disponible y marca la capa faltante. El probing es la capa más prescindible (proxy); el canal AI Assistant y la auditoría de readiness son el núcleo.
- Costo: corre en Opus `high`; el cap está en `scripts/run-greta-aeo.ps1` (`--max-budget-usd`). Si se corta por budget, el brief queda incompleto — sube el cap o baja el effort.
