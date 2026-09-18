---
name: content-blog-publisher
description: Use when running the daily Leda cron — polishes 2+ blog drafts from the CMS, generates a Gemini image per post (random style family with anti-repetition), schedules them to publish in 6h with a cancellation window via Linear. The MVP loop of the Leda agent. Respeta la audiencia objetivo del proyecto. Auto-publish with cancel window (HITL-2 con default-publish).
hitl_level: 2
owner: owner
agent: leda
schedule: "0 3 * * *"   # diario 03:00 hora del server (fuera de horas activas)
inputs:
  - "CMS (p. ej. Payload): drafts elegibles (filtrados por audiencia, no procesados)"
  - "projects/<slug>/image-style-families.md — 6 familias visuales"
  - "projects/<slug>/content-references.md, projects/<slug>/blog-taxonomy.md, projects/<slug>/brand-bible.md"
  - "GEMINI_API_KEY env var (para la imagen)"
outputs:
  - "CMS: posts pulidos + featuredImage + ledaPublishAt seteado"
  - "Linear (team del proyecto, ej. ACM): issue [Content] por cada post con preview link, deadline, y stop instructions"
  - "queue/pending-review/YYYY-MM-DD-content-blog-publisher.md (audit local)"
cost_budget_usd: 4
---

# content-blog-publisher

> **HITL 2 — auto-publish con ventana de cancelación de 6h.** Orquesta el pipeline: lista drafts → pulido (vía `content-blog-improver`) → genera imagen Gemini → programa. NO publica directo — eso lo hace el tick horario después de la ventana.

## Antes de correr

1. Cargar `content-blog-improver` (la skill que pule cada post). Esta skill **la llama** dentro del loop.
2. Leer `projects/<slug>/image-style-families.md` — las 6 familias + algoritmo de selección.
3. Leer `projects/<slug>/content-references.md`, `projects/<slug>/blog-taxonomy.md`, `projects/<slug>/brand-bible.md`.
4. Cargar `team-shared/skills/brand-voice`, `team-shared/skills/customer-personas` y `projects/<slug>/glossary.md` (lo mismo que carga `content-blog-improver`).
5. Conexión: `scripts\leda-helpers.ps1` debe poder llamar al CMS (verificar que `PAYLOAD_API_KEY` esté en el env) y a Gemini (`GEMINI_API_KEY`).

## Workflow

### Paso 1: listar drafts elegibles

```bash
powershell -File scripts\leda-helpers.ps1 -Action list-drafts -Limit 20
```

Filtros que ya aplica el helper:
- `_status = 'draft'`
- `ledaProcessedAt` no seteado
- Tags excluidos (audiencia fuera de scope, definidos en `blog-taxonomy.md` y configurados en el helper)

Output: array de drafts (id, title, slug, category, tags, createdAt).

**Si está vacío** (cero drafts elegibles):

1. **Verifica primero que `list-drafts` tuvo éxito.** Si el helper devolvió error (exit ≠ 0 / stderr con "falló"), esto NO es "backlog vacío" — es un fallo de query o de auth (ej. `PAYLOAD_API_KEY` mal seteada, o los campos `leda*` todavía no existen en el CMS). Reporta el error tal cual y sal. **NUNCA interpretes un error como "0 drafts".**
2. Si de verdad hubo 0 elegibles: chequea si ya existe un issue `[Content]` de backlog-vacío abierto de los últimos 7 días (búsqueda en Linear). Si existe, NO crees otro — escribe solo el mirror local y sal.
3. Si no existe: crea **un issue de heads-up MÍNIMO** en Linear, team del proyecto (ej. ACM; label `agent-proposal`, estado `Backlog`, sin asignar):
   - Título: `[Content] Backlog de drafts vacío — <YYYY-MM-DD>`
   - Body, exactamente estas 3 secciones:
     ```
     ## Contexto
     La corrida diaria no encontró drafts elegibles (status=draft, sin ledaProcessedAt, dentro de la audiencia del proyecto). Backlog drenado o el generador upstream no produjo contenido nuevo.

     ## Propuesta
     Alimentar el backlog con drafts nuevos (generador n8n o manual). La próxima corrida los toma sola.

     ## Generado por
     🤖 Leda 📖 · <YYYY-MM-DD HH:MM> · cron content-blog-publisher · backlog vacío
     ```
   - **PROHIBIDO en este issue**: tablas o métricas de funnel (signups/conversión/atribución), análisis de negocio, y proponer títulos/temas concretos. Eso es lane de Numa 📊, no tuya. El issue solo avisa "no hay material para procesar".
4. Mirror local: escribe 2 líneas en `queue/pending-review/YYYY-MM-DD-content-blog-publisher.md` (`Backlog vacío. Heads-up: ACM-X.`) y sal sin error.

### Paso 2: decidir cuántos procesar

- **Mínimo**: 2.
- **Máximo por corrida (TOPE DURO): 4 drafts.** Aunque el backlog tenga más, procesas como mucho 4 y **el resto queda para la próxima corrida diaria** — no se pierde nada: la idempotencia por `ledaProcessedAt` garantiza que los no tocados quedan elegibles y se drenan en días sucesivos, y el tick horario los va publicando. **Por qué el tope**: cada draft cuesta ~4-6 min (pulido + imagen Gemini + upload + issue), y la corrida tiene un watchdog de 45 min (2700s — `TimeoutMinutes` de Leda en `scripts/agents.ps1`; un tope de 30 min se quedaba corto con 4 drafts por corrida). Sin tope, un backlog acumulado —típico a inicio de semana, después de fines de semana sin actividad— hace que el loop intente drenar todo, revienta el timeout y el proceso **muere a mitad de loop sin cerrar**. Con 4 la duración queda holgada bajo el watchdog.
- **Selecciona ahora los primeros ≤4 drafts del backlog → esa es tu LISTA DE TRABAJO de esta corrida.** El loop del Paso 4 itera SOLO sobre esa lista, NUNCA sobre el backlog completo. Este es el punto donde el tope se hace efectivo: si el backlog tiene 7, tu lista tiene 4 y los otros 3 ni se miran hasta mañana.
- **Guard de costo**: si la corrida acumula > USD 3 antes del último post, parar acá y reportar "stop por budget; queda backlog".

Cuando cortas por el tope de 4 (o por budget), **anota el backlog remanente en el brief** (paso 5) para que se vea que se está drenando, no perdiendo.

### Paso 3: obtener las familias visuales recientes (anti-repetición)

```bash
powershell -File scripts\leda-helpers.ps1 -Action find-recent-styles -Limit 3
```

Output: array de los últimos 3 `ledaImageStyle` de posts publicados. Ej: `[F2, F5, F1]`.

Pool inicial = `{F1, F2, F3, F4, F5, F6}` menos esos.

**Si no hay publicados con `ledaImageStyle`** (primera corrida): pool = los 6.

### Paso 4: por cada draft (loop)

Para cada draft **de la LISTA DE TRABAJO seleccionada en el Paso 2** (máximo 4; o hasta que salte el guard de budget). **NO iteres sobre el backlog completo** — solo sobre esos ≤4:

#### 4a. Pulido (delegar a `content-blog-improver`)

Invoca la skill `content-blog-improver` con el `postId`. Esa skill hace el pulido completo y deja el draft con texto/SEO/links/tags actualizados (pero sin imagen ni programación). Output: éxito o `needs_rework`.

**Si `content-blog-improver` reportó needs_rework**: el draft ya quedó marcado con `ledaStatus='needs_rework'` y `ledaProcessedAt`. Salta al siguiente.

**Si éxito**: continúa con 4b.

#### 4b. Seleccionar familia visual

Del pool calculado en el paso 3, elige UNA al azar.

Pseudo:
```
$available = @('F1','F2','F3','F4','F5','F6') | Where-Object { $recentStyles -notcontains $_ }
$chosen = Get-Random -InputObject $available
```

Después de elegir, agrega `$chosen` a la lista `$recentStyles` localmente, para que el próximo draft del mismo loop no la repita.

#### 4c. Componer el prompt de imagen

Leer `projects/<slug>/image-style-families.md`. Tomar el bloque `STYLE_FAMILY_BLOCK` de la familia elegida.

**Deriva la `SCENE` del post**: 1-2 oraciones específicas que ilustren visualmente el tema. Reglas:
- Relacionada al título y al ángulo principal del post.
- Visualizable en una sola imagen (no narrativa con varios momentos).
- NO marcas, NO logos, NO personas reales, NO texto.
- Un foco claro: un personaje, una situación, un objeto-metáfora.

Ejemplos (adáptalos a la temática de tu blog):
- Post sobre organizar un portfolio → `A young designer at a desk arranging portfolio pages floating in formation above the desk, with a window suggesting the city skyline as geometric silhouettes.`
- Post sobre negociar condiciones → `Two abstract figures sitting across a table, with a single piece of paper between them. One holds a small notebook. Generous negative space around them, suggesting the tension of the conversation.`
- Post sobre "todo parece estar bien pero no hay resultados" → `A figure standing in front of a wall of identical documents pinned up, holding a magnifying glass over one. Slight tilt to the figure suggests exhausted thoughtfulness.`

#### 4d. Armar el prompt completo

```
[HEADER]
Editorial illustration to accompany a blog article. The image must contain NO text, letters, or words — do not draw the title/headline/caption.
Article theme (context only, never rendered as text): "<TITLE>".
Topic: <CATEGORY> · Audience: <AUDIENCE de brand-bible.md>.

[STYLE_FAMILY_BLOCK de la familia elegida]
...

Scene: <SCENE derivada del post>

[ANTI_AI_BLOCK]
AVOID: ...
EMBRACE: ...

[FORMAT_BLOCK]
16:9 landscape, 1568x880 px target. ...
```

(Los bloques exactos están en `image-style-families.md`.)

#### 4e. Generar imagen con Gemini

```bash
powershell -File scripts\leda-helpers.ps1 -Action generate-image -Prompt "<el prompt>" -OutFile "tmp\leda-<postId>.png"
```

El helper llama a Gemini y guarda el **PNG crudo** que devuelve. Devuelve JSON con `outFile` (la ruta `.png`), `sizeBytes`, `mimeType`. **NO se recomprime client-side**: un JPEG recomprimido con System.Drawing puede ser rechazado (HTTP 500) por el procesador de imágenes del CMS (ej. `sharp`). El PNG sube bien, y el CMS genera variantes optimizadas (tamaños thumbnail/card/og) + el frontend sirve webp/avif liviano al visitante, así que el peso del original no afecta la página.

**Validar el output**:
- `outFile` existe y `sizeBytes` > ~30KB (un PNG real de Gemini pesa varios cientos de KB; si es <30KB, probablemente Gemini devolvió basura → tratar como fallo y reintentar).
- `mimeType` empieza con `image/`.

**Si Gemini falla** (safety filter, error API): reintenta 1 vez con un prompt ligeramente ajustado (reformulando la scene). Si vuelve a fallar:
- `mark-needs_rework` para el post.
- Comenta en el issue del post (que vas a crear en el paso 4i) que la imagen no salió.
- Continúa con el siguiente draft.

#### 4f. Upload a la colección Media del CMS

```bash
powershell -File scripts\leda-helpers.ps1 -Action upload-media -FilePath "<el outFile .png que devolvió 4e>" -Alt "<descripción de la scene en 1 línea>"
```

**Si `upload-media` devuelve error con `HTTP 500`**: NO es falta de permiso (el 500 es server-side, ej. el procesador de imágenes). Reporta el status real, deja el post sin featuredImage nueva y sigue. NUNCA escribas "el Bearer no tiene permiso en Media" — eso es un diagnóstico equivocado.

Output: `{ id, url }`. Guardar el `id` para el siguiente paso.

**Alt text**: descripción concisa (≤120 chars) de la scene visual. Para a11y. NO mencionar "AI-generated" o "Gemini" — para el lector no hace diferencia, y debilita el branding.

#### 4g. Patch del post con featuredImage + meta.image + ledaImageStyle

```bash
$body = @{
  featuredImage    = '<media-id>'
  meta             = @{ image = '<media-id>' }
  ledaImageStyle = '<F1..F6>'
} | ConvertTo-Json -Compress

powershell -File scripts\leda-helpers.ps1 -Action update-post -PostId <id> -BodyJson $body
```

(Este body es ASCII puro — ids y códigos —, por eso `-BodyJson` es seguro acá. Cualquier texto con acentos va por `-BodyJsonFile`, ver `content-blog-improver` Paso 11.)

#### 4h. Marcar como programado (+6h)

```bash
powershell -File scripts\leda-helpers.ps1 -Action mark-scheduled -PostId <id> -WindowHours 6
```

Esto setea `ledaStatus='scheduled'`, `ledaPublishAt = now + 6h`, `ledaProcessedAt = now`.

#### 4i. Crear issue [Content] en Linear (team del proyecto)

Usando el MCP `linear`, crear issue con la convención canónica de `memory/CLAUDE.md`:

- Team: el del proyecto (ej. ACM)
- Label: `agent-proposal` (crearlo si no existe en el team)
- Estado: `Backlog`
- Sin asignar, sin priority, sin cycle
- Título: `[Content] <título exacto del post>`
- Body (6 secciones exactas):

```
## Contexto
Cron diario de Leda procesó este draft a calidad publicable y lo dejó programado para publicar en 6h.

## Hipótesis
El post mejorado mejora <métrica esperada — ej. CTR a la página core linkeada, o engagement vs drafts no editados>.

## Propuesta
Publicar el post titulado "<title>" el <ledaPublishAt en hora local del server>.

**Preview admin**: ${PAYLOAD_BASE_URL}/admin/collections/posts/<postId>
**Preview público (cuando se publique)**: <URL pública del proyecto>/blog/<slug>

**Cambios principales aplicados**:
- <3-5 bullets concretos: voz / SEO / links / imagen>

**Imagen**: generada con estilo <familia: F1..F6>. <breve descripción de la scene>.

## Métrica de éxito
Engagement orgánico (sesiones, scroll depth, click a internal links). Track en GA4.

## Riesgos / contras
- Quality gate: pasó todos los checks previos a programar, pero los gates son automáticos y pueden pasar por alto matices.
- Tono: revisa si te suena "demasiado pulido" o pierde la voz del autor original.
- Style match: si la familia visual elegida no te cuadra con el tema, comenta `Leda: stop ACM-X` y reprocesará con otra familia en la próxima corrida.

## Generado por
🤖 Leda 📖 · <YYYY-MM-DD HH:MM> · run de cron content-blog-publisher

---
**Stop**: comenta `Leda: stop ACM-X` (reemplaza ACM-X por este issue) para cancelar la publicación. El tick horario chequea antes de cada publish.
Alternativa: limpia `ledaPublishAt` directamente en el admin del CMS.
```

Guardar el `issueId` retornado por Linear para tener traza.

#### 4j. Pasar al siguiente draft

Volver al paso 4 con el próximo draft **de la lista de trabajo seleccionada en el Paso 2**. Cuando terminaste los ≤4 seleccionados (o cortaste por el guard de budget), **PARA el loop y ve al Paso 5** — NO vuelvas al backlog completo a buscar un 5º draft. El remanente queda para la próxima corrida (idempotencia por `ledaProcessedAt`).

### Paso 5: brief final

Después del loop, devuelve el brief completo como `result` del agente (lo guarda el wrapper en `queue/pending-review/`):

```markdown
# Cron content-blog-publisher — <fecha>

## Resumen

- Drafts procesados: <N>
- Pulidos + programados: <M>
- Needs-rework: <K>
- Backlog remanente (cortado por tope de 4 / budget): <R> — lo toma la próxima corrida
- Familias visuales usadas hoy: <lista>

## Posts programados

| PostId | Title | Slug | Familia | Publica en | Issue Linear |
|---|---|---|---|---|---|
| ... | ... | ... | F<n> | <timestamp> | ACM-... |

## Skipped (filtro de audiencia / needs_rework)

| PostId | Motivo |
|---|---|
| ... | ... |

## Costo total

USD <total_cost_usd> · ~$0.20-0.30 por imagen Gemini + edición de texto con Sonnet.

## Próximos pasos

- Si quieres cancelar alguno: `Leda: stop ACM-<n>` o limpiar `ledaPublishAt` en el admin del CMS.
- Próxima corrida: mañana 03:00 (hora del server).
```

## Autoauditoría antes de entregar

- ¿Procesé ≥ 2 drafts? Si no había backlog, ¿lo reporté?
- ¿Cada post programado tiene featuredImage + ledaImageStyle + ledaPublishAt?
- ¿Cada post tiene un issue Linear con stop instructions?
- ¿Las familias visuales rotaron (no repetí la misma 4 veces seguidas)?

## Notas de runtime

- Schedule: cron diario 03:00 hora del server (fuera de horas activas).
- **Watchdog + duración esperada**: la corrida corre bajo un watchdog de **45 min (2700s)** — el `TimeoutMinutes` de Leda en `scripts/agents.ps1`. Una corrida **normal NO es rápida**: procesa hasta 4 drafts × ~4-6 min cada uno (pulido + imagen Gemini + upload + issue) + overhead MCP → **~24-40 min en un día con backlog**. Que una corrida dure 30-43 min es lo esperado, no una anomalía. **Un backlog vacío, en cambio, sale en < ~2 min** (el Paso 1 corta temprano): así que una corrida larga SIEMPRE significa que SÍ había drafts y los estaba procesando — nunca es "no encontró posts". Nota de audit: si subes el watchdog, la copia viva del server lo toma recién cuando corre el sync del repo de agentes; un `timed_out:true` al tope viejo justo después del cambio suele ser lag de sync, no un fallo del watchdog.
- Costo objetivo: < USD 4 / corrida (2 posts × ~$0.25 Gemini + texto con Sonnet).
- Si la corrida muere a mitad: la idempotencia se mantiene por `ledaProcessedAt`. La próxima corrida no reprocesará los que ya quedaron seteados.
- Tmp files (imágenes): `tmp\leda-<postId>.png`. Limpiar al final o dejar para audit.
