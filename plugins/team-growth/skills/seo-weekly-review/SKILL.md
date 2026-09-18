---
name: seo-weekly-review
description: Use when running the project's weekly SEO review — cross GA4 organic + Google Search Console + Core Web Vitals + the database + a read-only frontend audit of the product repo, then produce a prioritized weekly proposal of optimizations. Keeps a persistent memory (seo-memory.md) so it never re-proposes the same thing and tracks disposition (wont-fix / done-but-limited). Read-only on prod; the only write is its own memory file.
hitl_level: 1
owner: owner
agent: greta
schedule: "0 4 * * 1"   # lunes 04:00 (hora del server)
model: claude-opus-4-8   # effort high — corre vía scripts/run-greta-seo.ps1 (NO run-skill.ps1)
inputs:
  - "gsc (mcp__gsc__*): queries/pages, clicks/impresiones/CTR/posición, indexación, sitemaps"
  - "ga4 (mcp__ga4__*): sesiones orgánicas, top landing pages, engagement, conversiones desde orgánico"
  - "cwv (mcp__cwv__*): Core Web Vitals — CrUX field + PSI lab — por un set de URLs"
  - "supabase (read-only): orgánico atribuido, inventario de contenido publicado (guías, posts) — según projects/<slug>/data-model.md"
  - "repo del producto ../acme-app (read-only): sitemap, robots, helpers de JSON-LD, generateMetadata, script de budgets de CWV, docs de SEO"
  - "seo-memory.md: ledger de hallazgos previos + su disposición"
outputs:
  - "Linear (team ACM): [Report] (SEO) semanal (label agent-report) + hasta 3-5 [Proposal] (SEO) nuevos (label agent-proposal + seo); estado Backlog, sin asignar"
  - "seo-memory.md actualizado (Greta lo reescribe — único write permitido)"
  - "queue/pending-review/YYYY-MM-DD-greta-seo.md (espejo del brief; lo escribe el wrapper)"
cost_budget_usd: 15   # cap real en scripts/run-greta-seo.ps1 (--max-budget-usd). Opus high es caro; tunable.
---

# seo-weekly-review

> **HITL 1 — read-only sobre prod.** Lee GA4 / GSC / CrUX / la base / el repo del producto, no escribe nada a prod, no toca PII. El **único write** es su propia memoria (`seo-memory.md`). Entrega un reporte semanal + propuestas accionables; el owner decide qué se hace.

Revisión SEO semanal del proyecto. Cruza las fuentes disponibles, las contrasta con su **memoria** para no repetir propuestas, y deja un **reporte + hasta 3-5 propuestas priorizadas** en Linear. Foco de negocio: orgánico que termina en signup → activación → compra (la palanca de la meta definida en `projects/<slug>/roadmap.md`). **Audita y optimiza — nunca regenera contenido** (si el contenido programático o el blog lo generan workflows de n8n u otros agentes, ver el overlap en `plugins/team-growth/README.md`).

## Cómo corre (runtime)

- **Cron** lunes 04:00 (hora del server) vía `scripts/run-greta-seo.ps1` (Opus, effort `high`). NO usa `run-skill.ps1` ni el loadout comment-only de Greta del registry.
- **Loadout**: `Read`/`Glob`/`Grep` (auditoría del repo del producto), `Write` (**SOLO** `seo-memory.md`), MCPs `supabase`/`linear`/`ga4`/`cwv`/`gsc` (de `plugins/team-growth/seo.mcp.json`).
- Read del repo del producto vía `--add-dir ..\..\acme-app` (solo lectura).

## Antes de correr (dependencias / contexto)

El wrapper te pasa el directorio de contexto del proyecto (`projects/<slug>/`).

1. **Lee este SKILL completo** y ejecuta su método (abajo).
2. **Lee `seo-memory.md`** (la memoria — sección siguiente).
3. **Carga `projects/<slug>/data-model.md`** → tablas de contenido publicado, eventos de analytics y la columna de canal de adquisición (el valor que marca orgánico). No inventes SQL: usa las queries canónicas de ahí y fíltralas por orgánico.
4. **Lee los docs de SEO del repo del producto** (TODO(acme): p. ej. `../acme-app/docs/seo/`) → guardrails de CWV/rendering y qué mejoras YA se hicieron. No re-propongas nada que ya esté ahí como hecho.
5. **Solo si vas a proponer copy customer-facing** (meta title/description, H1, anchor text): carga `team-shared/skills/brand-voice` + `projects/<slug>/brand-bible.md` → registro, tuteo/voseo y promesas prohibidas del proyecto.

## La memoria (`seo-memory.md`) — no repetir, trackear disposición

Este es el corazón de la skill: que NO propongas lo mismo cada semana y que registres cuándo algo se marcó "no se hace" o "se hizo pero limitado".

**Formato**: tabla `| id | título | primera-vez | última-vez | status | issue | nota |`. El `id` es un **slug estable** del hallazgo (ej. `cwv-lcp-landing-precios`, `meta-desc-faltante-blog`, `gsc-pagina2-guia-x`). Reusa el MISMO id entre semanas — es la clave del dedupe.

**Vocabulario de `status`**: `propuesto` · `aceptado` · `hecho` · `hecho-parcial` · `wont-fix` · `recurrente` · `archivado` (definidos en el header de `seo-memory.md`).

**Reconciliación (hazla ANTES de proponer nada):** la disposición REAL vive en Linear — el estado del issue manda. Para cada fila con link en `issue`:
1. Lee el issue en Linear (MCP) y su thread.
2. Actualiza el `status`: `Done` ⇒ `hecho`; `Canceled` ⇒ `wont-fix`; un comentario que diga que se hizo parcial/limitado ⇒ `hecho-parcial` (anota el gap en la nota); sigue en `Backlog` ⇒ `propuesto`; movido a `Todo`/`In Progress` ⇒ `aceptado`.

**Reglas de no-repetición** al matchear los hallazgos de ESTA semana contra el ledger (por `id`/semántica):
- Matchea un `wont-fix` → **NO crees issue nuevo**. Solo si el problema **empeoró materialmente**, comenta el issue Canceled existente con el nuevo data point y anota en la nota; no abras otro.
- Matchea un `hecho` → no re-proponer. Si la métrica **regresó**, es un hallazgo NUEVO (fila nueva con id nuevo que referencia al viejo en la nota).
- Matchea un `hecho-parcial` → propón SOLO el **gap restante**, citando qué ya se hizo.
- Matchea un `propuesto`/`aceptado` abierto → **no dupliques**. Refresca `última-vez`; si la señal cambió (mejoró/empeoró), deja un comentario `🤖 Greta 📈:` en el issue con el dato actualizado.
- Brand-new → crea la fila + el issue `[Proposal]`.

**Reescritura**: al final, con el tool `Write`, **reescribe `seo-memory.md` completo** con las filas actualizadas (status reconciliado + `última-vez` actualizada) + las filas nuevas. **HARD STOP: ese es el ÚNICO archivo que escribes.** Nunca escribas otro path, nunca dentro del repo del producto.

## Fuentes y qué mirar

### A. Google Search Console — `mcp__gsc__*` (la capa de search; es la señal SEO más fuerte)
- `gsc_query` con `dimensions=['query']` (últimos 28 d): top queries por clicks e impresiones.
- **Oportunidades de ranking**: queries en **posición 11-20 (página 2)** con impresiones altas — empujarlas a página 1 es el mayor ROI. (Trae un `rowLimit` alto por query y filtra por `position` entre 11 y 20.)
- **Oportunidades de CTR**: queries/pages con **buena posición (≤10) pero CTR bajo** → problema de title/meta description (ahí entra brand-voice).
- `gsc_query` con `dimensions=['page']`: top pages orgánicas + movers WoW (compara contra el `[Report]` de la semana pasada vía Linear/memoria).
- `gsc_query` con `dimensions=['query']` + `page=<url>`: drill de qué queries trae una landing puntual.
- `gsc_url_inspect`: para URLs que DEBERÍAN rankear pero no aparecen (contenido nuevo) → ¿indexadas? ¿coverageState? ¿canonical de Google = el declarado?
- `gsc_sitemaps`: ¿el sitemap se procesa sin errores? ¿submitted vs indexed coherente?
- **Si el MCP de GSC falla** (falta el prereq de API/SA — ver `docs/server-setup.md`): DILO en el brief, marca la sección de search como "no disponible esta corrida", y sigue con el resto. No estimes.

### B. GA4 — `mcp__ga4__*`
- `run_report`: sesiones del canal orgánico (Organic Search) — trend WoW y vs 28 d.
- Top landing pages orgánicas (`landingPagePlusQueryString` o equivalente) + engagement rate.
- Conversiones desde orgánico (signups / eventos clave) si están configuradas.
- Cruce con GSC: GA4 = comportamiento on-site post-clic; GSC = lo que pasa en el SERP. No promedies; explica la diferencia.

### C. Core Web Vitals — `mcp__cwv__*`
- `get_cwv_field` (CrUX, field real) por cada URL del set (mobile y desktop vía `formFactor`). LCP/INP/CLS p75.
- `get_cwv_audit` (PSI lab) en las URLs peores → opportunities concretas con savings.
- Contrasta contra los budgets del producto (TODO(acme): script de budgets de CWV del repo, si existe) y los guardrails de los docs de SEO.
- **Caveat CrUX**: URLs de bajo tráfico no tienen field data → cae al lab de PSI o a datos origin-level, y decláralo.

### D. Base de datos (read-only)
- Orgánico atribuido: signups y conversión free→paid de cohortes cuyo canal de adquisición es orgánico (caveat: forward-only, histórico mayormente `unknown`).
- Consistencia de contenido: conteo de contenido `published` vs lo que el sitemap debería listar.
- NUNCA PII — solo agregados (counts, sums, tasas).

```sql
-- EJEMPLO: adapta a las tablas de tu data-model.md
SELECT count(*) FILTER (WHERE status = 'published') AS published_pages
FROM content_pages;
```

### E. Auditoría de frontend (`../acme-app`, read-only — usa Glob/Grep/Read)
Contrasta contra los archivos REALES (no asumas). TODO(acme): ajusta los paths a tu stack; en Next.js App Router suelen ser:
- `app/sitemap.ts` — ¿enumera todo el contenido `published` + blog + marketing? ¿`lastModified` razonable (no hardcodeado)?
- `app/robots.ts` — ¿los `disallow`/noindex correctos? ¿referencia al sitemap?
- Metadata por página + el helper de JSON-LD — ¿`canonical` + `openGraph` seteados en las rutas clave? ¿JSON-LD presente donde corresponde (Article en blog, FAQPage en precios/FAQ, BreadcrumbList en contenido jerárquico)?
- Rutas SEO dinámicas (contenido programático, blog) — ¿`generateMetadata` por slug, canonical bien armado?
- El script de budgets de CWV — qué budgets define; correlaciona con lo que viste en CrUX/PSI.
- Los docs de SEO del repo — no re-proponer lo ya hecho.

## El set de URLs a auditar (CWV + GSC page-level)

Núcleo fijo (siempre): TODO(acme): lista las URLs clave del proyecto en `projects/<slug>/` (home, precios, cómo funciona, landing del producto principal, índices del blog y del contenido programático).
**+ data-driven**: las top 3-5 landing pages orgánicas reales (de GSC `dimensions=['page']` / GA4). Tope ~10-12 URLs para controlar costo (todas con el host canónico de prod, p. ej. `https://acme.example`; si prod redirige a `www`, usa el host final).

## Método (orden de ejecución)

1. Leer `seo-memory.md` + reconciliar disposición contra Linear (sección memoria).
2. GSC: top queries/pages, oportunidades (pos 11-20, CTR bajo), indexación de URLs clave, sitemaps.
3. GA4: orgánico (trend, top landings, engagement, conversiones).
4. Definir el set de URLs (núcleo + top orgánicas).
5. CWV: field + audit del set.
6. Base: orgánico atribuido + consistencia contenido/sitemap.
7. Frontend: auditoría del repo (sección E).
8. Sintetizar hallazgos → deduplicar contra la memoria → priorizar (impacto × esfuerzo).
9. Crear el `[Report]` + hasta 3-5 `[Proposal]` nuevos en Linear.
10. Reescribir `seo-memory.md`.
11. Devolver el brief completo como respuesta final.

## Output

### 1. Issue `[Report] (SEO) semana <YYYY-MM-DD>`
Team ACM, label `agent-report`, estado `Backlog`, sin asignar, sin priority. Body:
- **Headline**: estado del orgánico (sesiones WoW, n + %), estado CWV (cuántas URLs en good/needs-improvement/poor).
- **Top movers** de GSC (queries/pages que subieron o cayeron, con impresiones/posición).
- **Top 3-5 oportunidades** priorizadas (la base de las propuestas).
- **Reconciliación**: resumen de la memoria ("3 hallazgos previos siguen abiertos, 1 marcado wont-fix, 1 hecho-parcial — falta X").
- **Caveats vigentes** (los que apliquen, sección abajo).
- Cerrar con `---` + `Generado por 🤖 Greta 📈`.

### 2. Issues `[Proposal] (SEO) <imperativo>` — hasta 3-5 NUEVOS
Solo para hallazgos accionables nuevos NO vetados por la memoria. Team ACM, label `agent-proposal` **+ label `seo`** (crea el label `seo` en Linear si no existe), estado `Backlog`, sin asignar. Las **6 secciones canónicas** de `memory/CLAUDE.md` → "Linear destination convention": `## Contexto`, `## Hipótesis`, `## Propuesta`, `## Métrica de éxito`, `## Riesgos / contras`, `## Generado por`. Cerrar con `---` + `Generado por 🤖 Greta 📈`.
- **Cap duro: 3-5 propuestas nuevas por semana.** El resto de oportunidades quedan listadas en el `[Report]` como backlog (y en la memoria como `propuesto` solo cuando efectivamente crees el issue). Más que eso inunda el board.
- Si una propuesta toca código de UI/landing concreto, menciona que la implementa Cody (y, si amerita mockup, Daly) — tú no dispatchas; lo decide el owner.

### 3. `seo-memory.md` actualizado (Write)
Filas reconciliadas + nuevas. Único write.

### 4. Brief como respuesta final
Markdown, arranca con `🤖 Greta 📈:` + veredicto. El wrapper lo espeja a `queue/pending-review/`.

## Priorización

Ordena por **impacto × (1/esfuerzo)**. Alto impacto típico: oportunidades de página 2 con volumen, CTR en queries de alta intención (defínelas en `glossary.md`), CWV que degrada landings de alto tráfico, indexación rota de contenido nuevo. Bajo esfuerzo: title/meta tweaks, internal linking, sitemap fixes. Reserva las 3-5 plazas de propuesta para lo de mejor ratio.

## Caveats obligatorios (declararlos en el output cuando apliquen)

1. **GSC tiene ~2-3 días de lag** — el rango por default termina en hoy-3.
2. **CrUX necesita tráfico** — URLs de bajo volumen no tienen field data; cae a lab/origin y dilo.
3. **Atribución forward-only** — el canal orgánico en la base puede ser mayormente `unknown` para histórico; para histórico de canal, cruza con GSC/GA4, no concluyas desde la base sola.
4. **Volumen chico** — reporta `n` además de `%`; no alarmes por swings de pocos casos.
5. **No regenerar contenido** — si el contenido lo generan workflows/otros agentes, tú auditas/optimizas lo existente.
6. **Idiomas del sitio** — no inventes trabajo de hreflang/i18n si el sitio es de un solo idioma (declara los idiomas en `projects/<slug>/`).
7. **No inventar datos** — si un número no sale de una query o un tool, no va. Si una fuente falla, dilo.

## Autoauditoría antes de entregar

- ¿Leí `seo-memory.md` y reconcilié contra Linear ANTES de proponer?
- ¿Evité re-proponer algo `wont-fix` o ya `hecho`? ¿Los `hecho-parcial` los acoté al gap?
- ¿Las propuestas son ≤5 y priorizadas por impacto×esfuerzo?
- ¿Reporté `n` además de `%`? ¿Declaré el lag de GSC y el caveat de CrUX donde corresponde?
- ¿Algún número sin query/tool detrás? Si no sale de una fuente, fuera.
- ¿Escribí SOLO `seo-memory.md` (ningún otro archivo, nada en el repo del producto)?
- ¿Cada issue cierra con la firma `Generado por 🤖 Greta 📈`?

## Notas de runtime

- Read-only sobre prod. Si una conexión falla, reporta el fallo en el brief y sigue con las fuentes que sí respondan — no estimes de memoria.
- **Degradación elegante**: si `mcp__gsc__*` no está disponible (prereq de API/SA pendiente), la corrida sigue con GA4 + CWV + base + frontend y marca la capa de search como faltante.
- Costo: corre en Opus `high`; el cap está en `scripts/run-greta-seo.ps1` (`--max-budget-usd`). Si se corta por budget, el brief queda incompleto — sube el cap o baja el effort.
