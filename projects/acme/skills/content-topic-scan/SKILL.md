---
name: content-topic-scan
description: Use when running Leda's weekly topic scan for the project's blog — fills the CMS `topics` idea bank with up to 8 ideas a week (new posts and `refresh:` of published ones) from demand evidence (Search Console of the blog, Greta's SEO/AEO memory, the ledger's refresh list, seasonality), after checking each one against the published posts, the drafts in flight and the bank so no two pages compete for the same question. Loads what passes the filter in the same run with scripts/seed-topics.ps1 and records it in Linear; only real decisions (merging posts, a new category, anything that needs an expert) wait for the owner (HITL-3).
hitl_level: 3
owner: owner
agent: leda
mcp_variant: seo                                # project.json → mcpVariants.seo: suma el server gsc (Search Console) al loadout
extra_allowed_tools: mcp__gsc__*,mcp__ga4__*     # la allowlist diaria de Leda no incluye GSC ni GA4
schedule: "30 10 * * 1"   # lunes 10:30 (hora del server) — después de la revisión SEO de Greta (deja seo-memory.md al día) y de los scans de los lunes de Pico y Cody, antes del [Plan] de Capi. Cron: automation/n8n/leda-topic-scan.json
inputs:
  - "CMS del blog vía scripts/leda-helpers.ps1 -Project <slug>: list-published (lo publicado), list-in-flight (borradores y programadas) y list-topics -Status all (todo el banco: idea, assigned, drafted)"
  - "gsc (Search Console de la propiedad del sitio): gsc_query con pageContains '/blog/' — notas con impresiones, posición y queries"
  - "plugins/team-growth/skills/seo-weekly-review/seo-memory.md y aeo-weekly-review/aeo-memory.md — lo que Greta ya decidió (no reabrir) y las búsquedas donde los motores de IA no citan al sitio"
  - "projects/<slug>/skills/content-topic-scan/topic-memory.md — el ledger de lo cargado, lo descartado, los refresh pendientes y las canibalizaciones conocidas"
  - "projects/<slug>/blog-taxonomy.md (categorías), product-catalog.md (qué existe: semáforo por feature), brand-bible.md, icp.md y plugins/team-shared/skills/customer-personas"
outputs:
  - "CMS: las ideas que pasan el filtro, cargadas al banco `topics` (status idea) con scripts/seed-topics.ps1"
  - "Linear (team del proyecto): UN issue `[Topics] Cargadas — <YYYY-MM-DD>` en Backlog, sin asignar: label agent-report si es solo el registro de lo cargado; agent-proposal y título terminado en `· con preguntas` si hay preguntas para el owner"
  - "projects/<slug>/skills/content-topic-scan/topic-memory.md actualizado (único archivo versionado que esta skill escribe)"
  - "queue/pending-review/YYYY-MM-DD-<slug>-content-topic-scan.md (espejo del brief; lo escribe el wrapper)"
cost_budget_usd: 3
---

# content-topic-scan

> **HITL 3 — carga sola y avisa.** Lo que pasa el filtro del Paso 3 se carga al banco en esta misma
> corrida: nadie aprueba antes. El issue `[Topics]` es el registro de lo cargado y el lugar de las
> preguntas que sí son del owner (consolidar notas, una categoría nueva, algo que necesita un
> experto). La vuelta atrás es borrar la idea en el admin del CMS (`<adminUrl>` de
> `project.json → payload` → Topics) mientras siga en `idea`: hasta que el publisher la toma, no se
> escribió nada.
>
> **Todas** las llamadas a `leda-helpers.ps1` y a `seed-topics.ps1` llevan `-Project <slug>`: con
> más de un blog, un copy-paste sin el flag escribe en el blog equivocado.

## Por qué existe

Cuando las ideas del blog las pone un workflow que deja drafts sin mirar lo publicado, el blog
termina con varias notas compitiendo por la misma búsqueda, notas para una audiencia que no es la
del producto y categorías fuera de la taxonomía; y cuando ese workflow se cae, el blog se queda sin
backlog en silencio. Este scan llena el banco con ideas que tienen **evidencia de demanda**, que
**no repiten una intención** ya publicada, y cuando la intención ya existe, carga un `refresh:` de
esa nota en vez de una nueva.

**Por qué carga sola.** Con aprobación previa, una tanda que nadie aprueba deja el banco vacío y el
blog deja de publicar. El filtro del Paso 3 ya decide qué entra; la aprobación no sumaba control y
era el punto donde todo se frenaba.

## Workflow

### Paso 1: qué hay

```bash
powershell -File scripts\leda-helpers.ps1 -Action list-published -Project <slug> -Limit 300
powershell -File scripts\leda-helpers.ps1 -Action list-in-flight -Project <slug> -Limit 50
powershell -File scripts\leda-helpers.ps1 -Action list-topics -Project <slug> -Status all -Limit 300
```

Las tres, porque lo que está en curso no aparece en las otras: el publisher de la madrugada puede
haber tomado una idea (`assigned`, `drafted`) cuya nota sigue programada. `list-topics` sin
`-Status` solo devuelve `idea`.

TODO(acme): si el producto tiene páginas programáticas que ya responden preguntas (guías por
empresa, por puesto, por ciudad…), lístalas aquí con su consulta de solo lectura: el blog no tiene
que duplicarlas.

Si cualquiera de estas consultas falla, repórtalo tal cual y termina: sin esos datos no se puede
deduplicar. **Nunca cargues a ciegas.** (Si `list-topics` dice que el CMS NO tiene la collection
`topics`, es un bloqueo — falta la migración del producto o `project.json → payload.topics` está en
`false` —, no un banco vacío.)

Lee `topic-memory.md`: lo ya cargado, lo descartado y por qué (no lo repitas salvo que haya
evidencia nueva), los refresh pendientes y las canibalizaciones conocidas.

Cuenta lo que queda en el banco con `status: idea`, separando notas nuevas de `refresh:`: es el
punto de partida del Paso 4.

### Paso 2: de dónde salen las ideas (evidencia, no intuición)

En este orden:

1. **Search Console del blog** (`gsc_query`, últimos 90 días; GSC tiene 2-3 días de lag y ordena
   las filas por clicks). Si una nota concentra el tráfico por una búsqueda de baja intención,
   exclúyela con `pageExcludeRegex` para que no tape al resto:
   - Por nota: `dimensions: ["page"]`, `pageContains: "/blog/"`, `rowLimit: 250`. Una nota con
     ≥100 impresiones en posición 8-30, o con CTR muy bajo en buena posición, es candidata a
     **refresh**.
   - Por búsqueda: `dimensions: ["query", "page"]`, `pageContains: "/blog/"`, `rowLimit: 250`
     (con `queryExcludeRegex` para la marca propia). Busca queries con impresiones que caen en una
     nota que no las responde: según el caso, **nota nueva** para esa intención o **refresh** de la
     nota que ya rankea.
   - Por país: `dimensions: ["country"]` con `pageContains: "/blog/"` si el producto apunta a más
     de un mercado.
2. **Lo que Greta ya mira** (`seo-memory.md`, `aeo-memory.md`): las búsquedas donde los motores de
   IA no citan al sitio (la palanca suele ser contenido: una comparativa, una respuesta directa).
   **Respeta sus decisiones**: si un hallazgo está `wont-fix` o dice "no reabrir", no lo vuelvas a
   tomar como SEO; un refresh de contenido sobre esa misma nota solo si el ángulo es distinto
   (respuesta directa, checklist, FAQ, datos al día) y lo dices en la evidencia.
3. **Refresh pendientes** del ledger (notas viejas que no están al estándar).
4. **Temporada** de la audiencia (TODO(acme): los momentos del año en que tu audiencia busca lo que
   resuelves). Verifica cualquier fecha con WebSearch antes de usarla en un brief.

Una idea sin evidencia de ninguna de estas fuentes no se carga.

### Paso 3: el filtro (cada candidata, antes de cargarla)

Este filtro es todo el control que hay: lo que lo pasa se escribe. Ante la duda, afuera.

1. **¿Ya hay una nota para esta pregunta?** Compara con `list-published` (título, slug,
   categoría) y, si dudas, `find-related -Project <slug> -ExcludeId 0 -Tags <...> -Category <...>`.
   Misma pregunta y misma audiencia = **refresh** de esa nota (`keyword: "refresh: <slug>"`),
   nunca una nueva. Si hay dos o tres notas que se pisan, carga el refresh de la más fuerte (más
   impresiones en GSC) con un brief que absorba el ángulo de las otras y las enlace; las otras van a
   "Canibalizaciones" en el ledger. Consolidar o redirigir notas es decisión del owner (y trabajo de
   Cody), no tuyo: va al issue como pregunta aparte.
2. **¿Ya la responde una página del producto?** (las programáticas del Paso 1, una landing, la
   documentación). No cargues una nota que compita con esa página; si el ángulo es otro, la nota la
   enlaza, no la repite.
3. **¿Ya está en el banco o en curso?** Contra todas las ideas (`idea`, `assigned`, `drafted`) y
   contra las notas de `list-in-flight`. Si está, no la repitas.
4. **¿Es para la audiencia del producto?** Contra `icp.md` y `project.json → strategicFocus`: lo que
   queda fuera de scope va al ledger como "fuera de foco".
5. **¿Existe lo que necesita?** Contra el semáforo de `product-catalog.md`: no se cargan notas que
   dependan de una feature 🔴 o que la presenten como disponible si está 🟡, ni notas que prometan
   resultados. Anótalo en el ledger con el motivo.
6. **¿La puede escribir un agente?** Asesoramiento legal, médico, financiero o de cumplimiento
   específico necesita un experto: va al ledger como "requiere experto". Un dato de una fuente
   oficial sí se puede citar.
7. **Categoría existente**: el `cluster` es el slug de una de las categorías de `blog-taxonomy.md`.
   Si hace falta una nueva, va al issue como pregunta para el owner, no al banco.

### Paso 4: armar la tanda

- **Hasta 8 ideas por semana.** Mientras queden notas en "Refresh pendientes" del ledger, **al
  menos 3 son refresh**: el publisher toma un refresh los lunes, miércoles y viernes.
- **Nunca rellenes.** Si no hay evidencia para llegar, carga menos y di en el issue y en el brief
  hasta qué día alcanza el banco (el publisher gasta una idea por día).
- Prioridad: 1 = evidencia fuerte de GSC o temporada que empieza ya; 2 = evidencia clara; 3 = el
  resto. Con igual evidencia, primero lo que lleva a la puerta de entrada del producto
  (TODO(acme): la feature gratuita o la página de conversión principal).
- Cada idea con el formato de la collection:
  - `keyword`: la búsqueda como la escribiría el lector (o `refresh: <slug>`).
  - `audience`: TODO(acme): los valores de tu collection (p. ej. `general` o las personas de `icp.md`).
  - `cluster`: slug de la categoría.
  - `intent`: `info` · `commercial` · `transactional`.
  - `priority`: 1-3.
  - `brief`: el ángulo; la respuesta directa que tiene que dar el primer párrafo; qué checklist o
    pasos lleva; qué fuentes buscar; qué NO prometer; a qué notas hermanas y páginas del producto
    enlazar. En un refresh: qué le falta a la nota y qué ángulo de las notas que la canibalizan
    tiene que absorber. En el idioma de `project.json → languageConvention`.
  - `internalLinks`: un path por línea (`/blog/<slug>`, la página del CTA…).
  - `ctaTarget`: TODO(acme): los valores de tu collection (p. ej. la feature gratuita, `pricing`).
  - `status`: `"idea"`.

### Paso 5: cargar al banco

1. Crea `tmp/` si no existe y escribe la tanda en `tmp/leda-<slug>-topics.json` (UTF-8, con el
   heredoc de bash, para que no se rompan los acentos): un array con los objetos del Paso 4, en el
   orden de la tabla del issue.
2. Cárgala con el script. Deduplica por `keyword` contra todo el banco, en cualquier estado, y no
   carga nada si no puede listarlo:

   ```bash
   powershell -ExecutionPolicy Bypass -NoProfile -File scripts\seed-topics.ps1 -Project <slug> -SeedFile tmp\leda-<slug>-topics.json
   ```

   Imprime una línea por idea (`created`, `skip (ya existe)` o `FAIL`) y el total.
3. Si termina con error o hay algún `FAIL`: copia la salida tal cual al issue y al brief, y sigue
   con lo que sí se cargó. No reintentes a ciegas ni cargues por otra vía. Volver a correr el script
   es seguro: saltea lo que ya está.
4. **Qué no se carga nunca por aquí**: una idea que necesita una categoría nueva, una que depende de
   consolidar o sacar notas, y lo que quedó "requiere experto". Van al issue como preguntas.

### Paso 6: el issue en Linear (team del proyecto)

Título: `[Topics] Cargadas — <YYYY-MM-DD>`, en `Backlog` y sin asignar (convención de
`memory/CLAUDE.md`). Si no hay preguntas para el owner, es un **registro**: label `agent-report`, y
el Project Lead lo archiva a los 2 días. Si hay preguntas, es una **decisión**: label
`agent-proposal` y el título termina en ` · con preguntas`. Body:

1. **Resumen**: cuántas se cargaron (nuevas y refresh), cuántas quedan en el banco y **hasta qué
   día alcanza**.
2. **Tabla**: `# · keyword · tipo (nueva/refresh) · categoría · prioridad · evidencia (fuente +
   dato: impresiones, posición, país) · nota o página más cercana y por qué no es duplicado ·
   resultado (cargada / ya estaba / falló)`.
3. **Descartadas esta semana** y por qué (duplicado de <slug> / la responde una página del
   producto / fuera de foco / no existe / requiere experto).
4. **Preguntas para el owner** (solo si las hay): consolidar notas que se canibalizan, una
   categoría nueva. Una línea cada una, con lo que cambia según la respuesta.
5. **Cómo sacar una idea**: "Lo que no quieras que se escriba, bórralo en el admin del CMS
   (Topics) mientras esté en `idea`. El publisher toma una por día, de madrugada."
6. Firma: `🤖 Leda 📖 · <YYYY-MM-DD HH:MM> · cron content-topic-scan (<slug>)`.

Si no se cargó nada y no hay preguntas (banco lleno, sin evidencia nueva), no crees el issue:
alcanza con el brief.

### Paso 7: ledger

Reescribe `topic-memory.md`: suma lo de esta semana con su estado (`cargado` con la fecha y el
número de issue, `ya estaba`, `falló la carga`, `descartado` con el motivo, `pregunta para el
owner`) y actualiza "Refresh pendientes" (saca las notas cuyo refresh ya se publicó) y
"Canibalizaciones". Es el único archivo versionado que esta skill escribe.

### Paso 8: brief final

```markdown
# Cron content-topic-scan (<slug>) — <fecha>

- Banco antes: <N> ideas (<R> refresh) · publicado: <P> notas
- Cargadas: <n> (<r> refresh) · ya estaban: <s> · fallaron: <f> → <TEAM>-<n>
- Banco ahora: <N2> ideas (<R2> refresh) → alcanza hasta el <día>
- Descartadas: <d> (duplicado / página del producto / fuera de foco / no existe / requiere experto)
- Preguntas para el owner: <q> (o ninguna)
- Evidencia esta semana: <GSC / AEO / ledger / temporada / país>
```

## Pedidos sobre el banco (modo interactivo)

La tanda no se aprueba. Lo que el owner todavía puede pedir en un issue del team:

- **Cargar algo puntual** ("Leda: carga esta idea…", "carga los topics de <issue>", "la 4 hazla
  para otro país y cárgala"): arma el JSON, pásalo por el filtro del Paso 3 y cárgalo con
  `seed-topics.ps1` como en el Paso 5. Responde con lo que se cargó y actualiza `topic-memory.md`.
- **Sacar una idea** ("Leda: saca la de X"): el helper no borra topics. Pásale el link de la idea en
  el admin del CMS para que la borre y anótala en el ledger como descartada, así no vuelve en el
  próximo scan.

## Autoauditoría

- ¿Cada idea tiene evidencia con fuente y dato? ¿Ninguna repite una pregunta ya publicada ni una
  página del producto?
- ¿Las que se pisaban con una nota quedaron como `refresh:`?
- ¿Todas son para la audiencia del producto y dentro del foco?
- ¿Nada promete resultados ni depende de algo que el semáforo de `product-catalog.md` no tiene en 🟢?
- ¿Los `brief` respetan `languageConvention` (ortografía completa)?
- ¿Cargué solo lo que pasó el filtro, con `seed-topics.ps1`, y nada que necesite una decisión del
  owner?
- ¿El issue (si lo hubo) y el brief dicen hasta qué día alcanza el banco?
