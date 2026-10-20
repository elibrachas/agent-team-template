---
name: content-blog-publisher
description: Use when running the daily Leda cron for the active project — picks a topic from the CMS `topics` idea bank and either WRITES a new post from scratch (Gemini image with random style family and anti-repetition; scheduled with ledaPublishAt = +6h and published by the daily tick at 08:00 the next morning, cancellable via Linear until that tick — HITL-2 con default-publish) or, for a `refresh:` topic, rewrites an existing published post to the current standard and publishes it in the same run once it passes the gates (HITL-3: the owner reviews what is published and can restore the previous version). Respeta la audiencia objetivo del proyecto y lo que el strategicFocus declara fuera de scope.
hitl_level: 2
owner: owner
agent: leda
schedule: "0 3 * * *"   # diario 03:00 hora del server (fuera de horas activas; si tienes varios proyectos con blog, escalónalos: comparten los límites de la suscripción)
inputs:
  - "CMS (p. ej. Payload): collection `topics` con status=idea — el banco de ideas (lo llena content-topic-scan cada semana y lo carga solo, sin aprobación previa)"
  - "projects/<slug>/image-style-families.md — familias visuales (+ los bloques de marca, si el proyecto los define)"
  - "projects/<slug>/content-references.md, projects/<slug>/blog-taxonomy.md, projects/<slug>/product-catalog.md, projects/<slug>/brand-bible.md"
  - "GEMINI_API_KEY + PAYLOAD_API_KEY (.env.server / .env.<slug>)"
outputs:
  - "CMS: post draft nuevo + featuredImage + ledaPublishAt seteado + topic → drafted · o, en un refresh, la nota publicada reescrita y publicada en la misma corrida"
  - "Linear (team del proyecto, ej. ACM): issue [Content] por post nuevo (preview, fecha de salida, stop) · issue [Refresh] (en Done) por cada refresh publicado (qué cambió y cómo volver a la versión anterior)"
  - "queue/pending-review/YYYY-MM-DD-<project>-content-blog-publisher.md (audit local, lo escribe el wrapper)"
cost_budget_usd: 3
---

# content-blog-publisher

> **HITL 2 — auto-publish con ventana de cancelación hasta el tick.** El banco de ideas es la
> collection `topics` del CMS y **tú redactas el post desde cero**. Pipeline: elegir topic →
> redactar draft → imagen Gemini → schedule +6h → issue en Linear. NO publica directo: eso lo hace
> el tick diario (`content-blog-publish-tick`, una vez por día a las 08:00, hora del server), que
> publica lo que ya venció. Como esta corrida es de madrugada, la nota sale con el tick de la
> mañana siguiente, ~28 h después; hasta ese tick se puede frenar con `Leda: stop`.
>
> ⚠️ **La ventana NO está enforced server-side**: `publish-now` publica al instante. Está
> PROHIBIDO en esta skill. Solo `mark-scheduled -WindowHours 6`. La única publicación que hace
> esta skill es la de un refresh, con `publish-refresh` (Paso 4-R): el helper la rechaza si la
> nota no estaba ya publicada, así que no sirve para saltear la ventana de una nota nueva.
>
> Todas las llamadas a `leda-helpers.ps1` llevan `-Project <slug>` (aunque coincida con el
> default: explícito evita escribir en el blog de otro proyecto por un copy-paste).

## Por qué un banco de ideas (y no pulir drafts)

Un modelo anterior pulía drafts que dejaba un generador upstream (p. ej. un workflow de n8n). Ese
generador elegía temas sin mirar lo publicado (notas que se canibalizan, notas para una audiencia
fuera de foco) y, cuando dejó de producir, el blog se quedó sin material sin que nadie lo notara.
El modelo actual:

- **Las ideas** salen del scan semanal `content-topic-scan` (skill del proyecto), con evidencia de
  demanda y deduplicadas contra lo publicado; el scan las carga solo en la collection `topics`
  (nadie aprueba la tanda: el owner revisa lo publicado).
- **Esta skill** toma una idea y escribe la nota desde cero, o hace el **refresh** de una nota
  publicada (topics `refresh: <slug>`).
- Un draft escrito a mano en el admin del CMS no lo toma el cron: se pule por la vía interactiva
  (`Leda: mejora el post <id>` → `content-blog-improver`).

## Antes de correr

1. Cargar `plugins/team-shared/skills/content-blog-improver/SKILL.md`: define las reglas de
   redacción, el formato Lexical, SEO fields, taxonomía, links, author, quality gates y encoding
   que aplicas al escribir (Pasos 4-11 del improver; los Pasos 1-3 son solo para pulir un draft
   existente).
2. Cargar `team-shared/skills/brand-voice`, `team-shared/skills/customer-personas` y
   `team-shared/skills/glossary` (si el post nombra términos del dominio del producto).
3. Leer `projects/<slug>/image-style-families.md`, `content-references.md`, `blog-taxonomy.md` y
   `product-catalog.md` (qué existe y qué no).
4. Conexión: `scripts\leda-helpers.ps1` tiene que poder llamar al CMS (`PAYLOAD_API_KEY`) y a
   Gemini (`GEMINI_API_KEY`).

## Reglas de posicionamiento (NO negociables)

- **Audiencia**: la del proyecto (`brand-bible.md` + `icp.md`). Nada sobre lo que el
  `strategicFocus` de `project.json` declara fuera de scope (una línea de producto discontinuada,
  un segmento abandonado).
- **Sin promesas** imposibles ni garantías (ver las no-go zones del `brand-bible.md`).
- **Precios y planes** solo como están en `product-catalog.md` / la página de precios en vivo.
- **Datos**: todo número con fuente real, linkeada y verificada (WebSearch + WebFetch +
  `validate-link`). **Nunca inventar cifras.** Leyes y datos regulados, con la fuente oficial del
  país.
- **Idioma**: la convención de `project.json → languageConvention`, también en title, excerpt,
  meta y FAQ.
- Las reglas propias del proyecto (qué nunca afirmar, qué comparaciones evitar) viven en el
  override de Leda (`projects/<slug>/agent-overrides/leda.md`): cárgalas también.

## Workflow

### Paso 1: elegir el topic

```bash
powershell -File scripts\leda-helpers.ps1 -Action list-topics -Project <slug> -Limit 30
powershell -File scripts\leda-helpers.ps1 -Action list-published -Project <slug> -Limit 3
```

`list-topics` devuelve las ideas con `status=idea` ordenadas por `priority` (1 = alta): `id,
keyword, intent, audience, cluster, priority, brief, internalLinks, ctaTarget`.

- **Refresh los lunes, miércoles y viernes**: si hay algún topic cuyo `keyword` empieza con
  `refresh:`, toma ese (el de menor `priority`) y sigue el **Paso 4-R**. Los otros días, y si no
  hay refresh, una nota nueva.
- **Alternancia**: no publiques dos notas seguidas del mismo `cluster` si hay ideas de otro con
  prioridad ≤ 2 (mira qué salió último en `list-published -Limit 3`).

**Antes de escribir una nota nueva: ¿ya existe?** Corre `list-published -Project <slug> -Limit 300`,
`list-in-flight -Project <slug>` y `find-related -Project <slug> -ExcludeId 0 -Tags <los que
usarías> -Category <la que usarías>`. Si una nota publicada ya responde la MISMA pregunta para la
MISMA audiencia (aunque el keyword sea otro), no la escribas: entrega el topic con
`deliver-topic -Notes "duplicate: <slug> — conviene refresh"` y toma el siguiente (el scan semanal
lo va a proponer como refresh). Si el proyecto tiene páginas programáticas (guías generadas por
plantilla), una pregunta que ya responde una de ellas también cuenta como duplicado:
`deliver-topic -Notes "la responde /<guía>"`. Tampoco cuenta como duplicado una nota publicada
que el brief nombra porque toca el tema de pasada: enlázala. Las excepciones del proyecto (p. ej.
un tipo de brief que se escribe aunque exista la guía, con el slug que fija el brief y un enlace a
la guía) viven en el override (`projects\<slug>\agent-overrides\leda.md`).

**¿Existe lo que el topic necesita?** Si depende de algo que `product-catalog.md` no tiene, no lo
escribas: déjalo en el banco, anótalo en el brief y toma el siguiente.

**Si está vacío o falla**:

1. **Verifica primero que `list-topics` tuvo éxito.** Si el helper devolvió error (exit ≠ 0 /
   stderr con "falló"; un 404 en `/topics` = la collection no existe en el CMS), esto NO es
   "banco vacío": reporta el error tal cual en el brief y sal. **NUNCA interpretes un error
   como "0 topics".**
2. Si de verdad hay 0 ideas: chequea si ya existe un issue `[Content] Banco de topics vacío`
   abierto en los últimos 7 días en el team del proyecto. Si existe, NO crees otro: brief y sal.
3. Si no existe: crea un issue mínimo (label `agent-proposal`, `Backlog`, sin asignar).
   Título: `[Content] Banco de topics vacío — <YYYY-MM-DD>`. Body: contexto (la corrida diaria
   no encontró topics con status=idea; el scan semanal carga el banco solo, así que un banco
   vacío quiere decir que el último scan falló o cargó de menos: di cuál fue el último issue
   `[Topics]` y cuántas ideas cargó), qué hacer (correr el scan ahora,
   `scripts\run-skill.ps1 -Skill content-topic-scan -Project <slug>`, o cargar ideas en el admin
   del CMS → Topics), firma
   `🤖 Leda 📖 · <fecha> · cron content-blog-publisher (<slug>) · banco vacío`. **Prohibido
   en este issue**: métricas de funnel y análisis de negocio (lane de Numa) y proponer temas
   (lane del scan).
4. Brief y sal sin error.

### Paso 2: cuántos procesar

- **Tope por corrida: 1 post** (nuevo o refresh). Escribir desde cero con estos gates lleva
  ~12-20 min bajo el watchdog de 45 min de Leda. Si el owner pide 2 por día, se cambia aquí y en
  el brief (y conviene un segundo cron, no subir el tope: dos notas en una corrida rozan el
  watchdog).
- **Guard de costo**: si la corrida acumula > USD 2.5 antes de terminar, para y reporta "stop por
  budget".

### Paso 3: familias visuales recientes (anti-repetición)

```bash
powershell -File scripts\leda-helpers.ps1 -Action find-recent-styles -Project <slug> -Limit 3
```

Pool = `{F1..Fn}` (las familias de `image-style-families.md`) menos las devueltas (el helper lee
`ledaImageStyle` de los últimos publicados). Si devuelve `[]`, pool = todas. Eliges una al azar en
el 4d.

### Paso 4: nota nueva

#### 4a. Reclamar el topic

```bash
powershell -File scripts\leda-helpers.ps1 -Action claim-topic -Project <slug> -TopicId <id>
```

#### 4b. Redactar el post (desde cero)

Aplica las reglas del improver (estructura, Lexical, voz, SEO, taxonomía, links, author). Además,
**el estándar de cada nota**:

- **Respuesta directa arriba**: el primer párrafo responde la pregunta principal en **40-80
  palabras**, sin introducción.
- **H2 con la pregunta real del lector** (como la buscaría), y el primer párrafo tras cada H2
  responde directo en 40-60 palabras antes de profundizar.
- **Al menos un checklist o pasos numerados** (lista de Lexical). **No uses nodos `table`**
  mientras su forma no esté verificada contra el editor del admin (un nodo incompleto rompe el
  admin con `Minified Lexical error #117`, aunque el front renderice).
- **Al menos un dato con fuente y fecha** (estadística oficial, organismo del sector, un estudio
  verificado) — ver `content-references.md`.
- **Hazlo interesante, no solo correcto**: ejemplos concretos por tipo de lector (según el
  `audience` del topic), escenarios reales, un ángulo que el lector no sabía.
- **País o región**: si el keyword es de un país, datos y ejemplos de ese país; si es general,
  ejemplos de 2-3 mercados de la audiencia.
- **Largo**: 1.200-1.800 palabras para guías y comparativas; 800-1.200 para respuestas
  puntuales. Profundidad, no relleno.
- **Links internos: mínimo 3 en el cuerpo**: los `internalLinks` del topic + la página core del
  `ctaTarget` (el mapeo `ctaTarget` → URL vive en `blog-taxonomy.md` o el override) + **2 notas
  hermanas publicadas** (`find-related`) + la página programática que corresponda, si el proyecto
  tiene y el tema la toca.
- **Links externos: mínimo 2 (ideal 3)** a fuentes de autoridad, cada uno anclando un dato
  verificado (WebSearch/WebFetch + `validate-link`).
- **Cierre**: CTA suave a la página del `ctaTarget` (regla del improver). Si la plantilla del blog
  ya agrega un bloque "Relacionado" abajo, no lo repitas.
- `faq`: 3-5 pares `{question, answer}` que el post responde (no inventar). Si el CMS los
  renderiza como FAQPage, también suman para AEO.
- `title` < 60 chars · `excerpt` 160-200 · `meta.title` < 60 · `meta.description` 140-160 ·
  `category` = la del `cluster` en `blog-taxonomy.md` · 3-5 `tags` del set · `authors` = el autor
  por defecto del proyecto (TODO(acme): su id en el CMS, declarado en el override de Leda).

Crear el draft (body JSON SIEMPRE por archivo UTF-8 con heredoc de bash — nunca `-BodyJson` con
acentos, ver encoding en el improver Paso 11):

```bash
mkdir -p tmp
cat > tmp/leda-<slug>-post.json <<'JSON'
{
  "title": "...",
  "slug": "...",
  "category": "<una de blog-taxonomy.md>",
  "tags": ["...", "...", "..."],
  "excerpt": "160-200 chars: qué se lleva el lector.",
  "authors": [<id del autor por defecto>],
  "meta": { "title": "< 60 chars", "description": "140-160 chars, con la keyword, distinta del excerpt" },
  "faq": [ { "question": "...", "answer": "..." } ],
  "content": { "root": { "type": "root", "format": "", "indent": 0, "direction": "ltr", "version": 1, "children": [ ...nodos con TODAS sus props (ver improver)... ] } }
}
JSON
powershell -File scripts\leda-helpers.ps1 -Action create-post -Project <slug> -Draft -BodyJsonFile tmp/leda-<slug>-post.json
```

Guarda el `doc.id`. **No mandes** `_status`, `publishedAt`, `ledaStatus`, `ledaPublishAt`,
`ledaProcessedAt` en el create (los setean `mark-scheduled` y el tick).

#### 4c. Quality gates (HARD — antes de imagen y schedule)

Los del improver (Paso 10) más los del estándar de arriba: respuesta directa arriba, checklist,
dato con fuente y fecha, ≥3 internos (2 notas hermanas), ≥2 externos validados, FAQ 3-5,
convención de idioma respetada, cero promesas, cero U+FFFD, Lexical parsea, no arranca con `h1`.
**Si falla algo, corrige el draft (`update-post -Project <slug> -PostId <id> -Draft -BodyJsonFile
...`) hasta que pase.** Si no se puede salvar (el brief pide datos que no existen):

```bash
powershell -File scripts\leda-helpers.ps1 -Action mark-needs-rework -Project <slug> -PostId <id>
powershell -File scripts\leda-helpers.ps1 -Action deliver-topic -Project <slug> -TopicId <id> -Notes "needs rework: <motivo>"
```

y termina la corrida.

#### 4d. Imagen

1. **Familia**: una al azar del pool del Paso 3.
2. **Escena** (`SCENE`): 1-2 oraciones visualizables que ilustren el tema. Si
   `image-style-families.md` trae una guía de escena, aplica su receta (típicamente: persona +
   acción concreta + objeto del oficio + lugar + luz + emoción). Sin marcas, logos, personas
   reales ni texto. Evita los clichés visuales del tema (la lupa sobre el documento, la persona
   hundida frente a una pila de papeles, la oficina gris, robots/cerebros, el apretón de manos).
   Ejemplos (adáptalos al blog del proyecto):
   - Post sobre organizar un portfolio → `A young designer on a sunny balcony pins bright portfolio pages onto a clothesline like laundry, one page catching the wind; a mug and a laptop on a small table, plants around.`
   - Post sobre negociar condiciones → `Two people at a café table in warm window light; the younger one slides a single notebook across the table with a small confident smile, the other raises an eyebrow mid-sip.`
3. **Prompt**, en el orden que define `image-style-families.md` ("Cómo Leda arma el prompt
   completo"). Si el archivo define **bloques de marca** (p. ej. `VIBE_BLOCK` y
   `BRAND_PALETTE_BLOCK`), van SIEMPRE: son el hilo visual del feed — sin ellos las imágenes
   vuelven a salir genéricas. Forma típica:
   ```
   [HEADER]
   Editorial illustration to accompany a blog article. The image must contain NO text, letters, or words — do not draw the title/headline/caption.
   Article theme (context only, never rendered as text): "<TITLE>".
   Topic: <CATEGORY> · Audience: <AUDIENCE de brand-bible.md>.
   [bloques de marca, si existen] [STYLE_FAMILY_BLOCK de la familia]
   Scene: <SCENE>
   [ANTI_AI_BLOCK] [FORMAT_BLOCK]
   ```
   Escríbelo a `tmp\leda-<slug>-<postId>-prompt.txt` (UTF-8) y usa `-PromptFile`.
4. Generar:
   ```bash
   powershell -File scripts\leda-helpers.ps1 -Action generate-image -Project <slug> -PromptFile "tmp\leda-<slug>-<postId>-prompt.txt" -OutFile "tmp\leda-<slug>-<postId>.png"
   ```
   Validar: `sizeBytes` > ~30KB y `mimeType` image/*. El helper guarda el PNG crudo (NO se
   recomprime: un JPEG recomprimido con System.Drawing puede ser rechazado por el procesador de
   imágenes del CMS, p. ej. `sharp`). Si Gemini falla (safety filter, error API): un reintento
   con la escena reformulada. Si vuelve a fallar: `mark-needs-rework`,
   `deliver-topic -Notes "needs rework: imagen"` y termina.
5. Subir:
   ```bash
   powershell -File scripts\leda-helpers.ps1 -Action upload-media -Project <slug> -FilePath "tmp\leda-<slug>-<postId>.png" -Alt "<la escena en 1 línea, ≤120 chars, sin 'AI-generated'>"
   ```
   **Si devuelve HTTP 500**: NO es falta de permiso (es server-side). Sigue SIN imagen y anota
   "sin imagen (media 500)" en el issue y el brief. NUNCA escribas "el Bearer no tiene permiso".
6. Patch con la imagen, la familia y `meta.image`:
   ```bash
   powershell -File scripts\leda-helpers.ps1 -Action update-post -Project <slug> -PostId <id> -Draft -BodyJson '{"featuredImage": <mediaId>, "ledaImageStyle": "F<n>", "meta": {"image": <mediaId>}}'
   ```
   (Si los ids del CMS son numéricos van sin comillas. Este body no lleva acentos, por eso
   `-BodyJson` sirve; `meta.title` y `meta.description` ya van en el create — si faltan, súmalos
   en este PATCH por archivo.)

#### 4e. Schedule (+6h) y entrega del topic

```bash
powershell -File scripts\leda-helpers.ps1 -Action mark-scheduled -Project <slug> -PostId <id> -WindowHours 6
powershell -File scripts\leda-helpers.ps1 -Action deliver-topic -Project <slug> -TopicId <topicId> -Notes "post id <postId>"
```

`mark-scheduled` setea `ledaStatus=scheduled` + `ledaPublishAt=now+6h` + `ledaProcessedAt=now`.
**Nunca `publish-now` aquí.**

**Cuándo sale de verdad.** `ledaPublishAt` es lo más temprano que puede salir, no la hora de
publicación: el tick corre una vez por día, a las 08:00 (hora del server), y publica lo que ya
venció. La nota sale con el primer tick a partir de `ledaPublishAt`: si `ledaPublishAt` cae
después de las 08:00 (lo normal: esta corrida es de madrugada y queda ~09:00-10:00), con el del
día siguiente; si cae antes, con el de ese mismo día. Esa es la **fecha de salida** (p. ej.
«domingo 19, 08:00») que va en el issue y en el comentario de stop. No escribas «en 6h» ni la hora
de `ledaPublishAt` como hora de publicación.

#### 4f. Issue [Content] en Linear (team del proyecto)

Convención canónica (`memory/CLAUDE.md`): team del proyecto (ej. ACM), label `agent-proposal`,
estado `Backlog`, sin asignar. Título: `[Content] <título exacto del post>`. Body:

```
## Contexto
Cron diario de Leda: nota nueva escrita desde el banco de ideas. Sale con el tick diario del <fecha de salida> a las 08:00, salvo que la frenes antes.
Topic: "<keyword>" · <cluster> · <intent> · audiencia <audience> · CTA <ctaTarget>.

## Hipótesis
<qué búsqueda o pregunta responde y por qué: la evidencia del topic>

## Propuesta
Publicar "<title>" el <fecha de salida> a las 08:00, con el tick diario.

**Preview admin**: <URL pública del proyecto>/admin/collections/posts/<postId>
**URL pública (cuando se publique)**: <URL pública del proyecto>/blog/<slug>

- Largo: <n> palabras · FAQ: <n> · links internos: <n> · externos: <n>
- Imagen: familia <F1..Fn> — <escena en una línea> (o "sin imagen (media 500)")
- Fuentes externas: <lista de URLs citadas>

## Métrica de éxito
Impresiones y clicks en Search Console a 4 semanas; clicks al <ctaTarget> desde la nota (GA4).

## Riesgos / contras
- Los gates son automáticos: revisa tono y datos.
- Si la familia visual no te cuadra, frena la publicación y pide otra imagen.

## Generado por
🤖 Leda 📖 · <YYYY-MM-DD HH:MM> · cron content-blog-publisher (<slug>)

---
**Stop**: comenta `Leda: stop ACM-X` (reemplaza ACM-X por este issue) antes del tick del <fecha de salida> a las 08:00 para cancelar la publicación. El tick lo chequea antes de publicar.
Alternativa: en el admin del CMS (Posts → el draft) borra `ledaPublishAt` o pon `ledaStatus` en `cancelled`.
```

**Después de crear el issue** (ya conoces su identifier, p. ej. `ACM-123`), agrega UN comentario
con la instrucción de stop resuelta: `🤖 Leda 📖: Este post sale con el tick del <fecha de salida>
a las 08:00. Para frenarlo antes, comenta exactamente: Leda: stop <ACM-N>` — así el owner copia y
pega sin reemplazar el placeholder.

### Paso 4-R: refresh de una nota publicada (topics `refresh:`)

El refresh **se publica en esta misma corrida**: el owner revisa lo publicado, no aprueba antes.
No lleva ventana para frenarlo ni pasa por el tick: la nota ya estaba en línea.

1. `claim-topic` como siempre. Busca la nota: `list-published -Project <slug> -Limit 300` → la
   que tenga el slug del keyword → `get-post -Project <slug> -PostId <id>`. Si no existe o no
   está publicada: `deliver-topic -Notes "refresh: no encontré <slug>"` y sigue con una nota
   nueva.
2. **¿Ya tiene un borrador pendiente?** `get-post -Project <slug> -PostId <id> -Draft`: si la
   última versión tiene `_status: "draft"` mientras la publicada existe, alguien dejó cambios sin
   publicar (el owner editando en el admin, o un refresh anterior que no pasó los gates). No lo
   pises ni lo publiques: `deliver-topic -Notes "refresh: ya hay un borrador pendiente en el
   post <id>"`, dilo en el brief y sigue con una nota nueva.
3. Reescríbela al estándar del 4b **conservando** `slug`, `featuredImage`, `meta.image`,
   `ledaImageStyle` y `authors`. Actualiza datos y años (con fecha), suma la respuesta directa,
   el checklist, la FAQ y los links que falten, y aplica el `brief` del topic (el ángulo del
   refresh; si absorbe notas que la canibalizan, enlázalas). **Normaliza la `category`** a una de
   `blog-taxonomy.md` si hoy tiene otra. No cambies lo que ya está bien: es una mejora, no otra
   nota.
4. Guárdala como **borrador de la nota publicada**:
   `update-post -Project <slug> -PostId <id> -Draft -BodyJsonFile tmp/leda-<slug>-refresh.json`.
   Con `-Draft`, un CMS con versiones (p. ej. Payload 3) guarda solo una versión borrador y **la
   publicada sigue en línea** mientras corres los gates (un PATCH con `draft=true` no toca la
   fila principal).
5. Gates del 4c sobre el borrador. Si no se puede salvar, el mismo camino de falla del 4c:
   `mark-needs-rework` detecta el borrador pendiente y marca solo el borrador (la publicada
   sigue en línea), y `deliver-topic -Notes "needs rework: refresh <motivo> — borrador en el post
   <id>, no publicar"`. Sin issue `[Refresh]`; dilo en el brief y termina.
6. **Publícala**:
   `powershell -File scripts\leda-helpers.ps1 -Action publish-refresh -Project <slug> -PostId <id>`.
   El helper solo publica si la nota ya estaba publicada y su última versión es un borrador; si
   no, falla sin tocar nada. **NO** `publish-now` (es del tick) y **NO** `mark-scheduled`: ese
   PATCH no lleva `_status`, el CMS arma el update sobre la última versión (el borrador) y la
   nota publicada pasaría a borrador (404 en una URL que ya tenía tráfico). Por lo mismo, entre
   el paso 4 y este nadie hace otro PATCH sin `-Draft` sobre esa nota.
7. **Verifica que quedó en línea**: `get-post -Project <slug> -PostId <id>` tiene que dar
   `_status: "published"` con el título nuevo, y
   `validate-link -Url <URL pública del proyecto>/blog/<slug>` tiene que responder 200. Si
   `publish-refresh` dio error (la nota publicada queda como estaba, con el borrador pendiente)
   o algo de esto falla, no reintentes: el issue del paso 8 va en `Backlog`, con el título
   `[Refresh] REVISAR — <título>` y la primera línea diciendo qué falló.
8. Issue en el team del proyecto: `[Refresh] <título>`, label `agent-proposal`, sin asignar,
   estado **`Done`**: es el registro de algo ya publicado (el tick hace lo mismo con los
   `[Content]` cuando publica). Body: la URL pública, qué cambió (bullets), fuentes nuevas, la
   evidencia del topic (impresiones/posición), y **cómo volver atrás**: "Si no te gusta:
   <URL pública del proyecto>/admin/collections/posts/<id>/versions → abre la versión publicada
   anterior → Restaurar esta versión. La nota sigue en línea con el texto de antes. Despublicar
   la saca del sitio (404): úsalo solo si la nota no tiene que existir."
9. `deliver-topic -Notes "refresh published on post <id> — ACM-<n>"`.

### Paso 5: brief final

Devuelve el brief como `result` (el wrapper lo escribe a `queue/pending-review/`):

```markdown
# Cron content-blog-publisher (<slug>) — <fecha>

## Resumen
- Topics disponibles: <N> · procesados: <M> · needs-rework: <K>
- Post programado: <id, title, category, URL pública, fecha de salida, issue ACM-X> · o refresh: <slug, post id, URL pública, issue ACM-X, "publicado">
- Topics salteados: <keyword — duplicado de <slug> / la responde una página programática / depende de algo que no existe>
- Imagen: <familia / "sin imagen — media 500">
- Fuentes externas: <n> validadas
- Topics que quedan en el banco: <R> (por cluster)

## Costo
USD <total> · ~$0.25 por imagen Gemini + redacción con Sonnet.

## Próximos pasos
- Cancelar: `Leda: stop ACM-<n>` o borrar ledaPublishAt en el admin del CMS.
- Próxima corrida: mañana 03:00 (hora del server).
```

## Autoauditoría antes de entregar

- ¿Usé `publish-now`? → NO debe aparecer en esta corrida.
- Si fue nota nueva: ¿chequeé que no hubiera una publicada ni una página programática para la
  misma pregunta? ¿Tiene respuesta directa arriba, checklist, dato con fuente y fecha, FAQ, 2
  notas hermanas enlazadas?
- Si fue refresh: ¿pasó los gates antes de `publish-refresh`, la URL pública responde 200 y el
  issue `[Refresh]` dice cómo volver a la versión anterior?
- ¿Respeté la convención de idioma, cero promesas, nada fuera del foco del proyecto?
- ¿El post programado tiene imagen (o la nota de media 500), `ledaImageStyle`, `ledaPublishAt` e
  issue con stop (con la fecha de salida, no «en 6h»)?
- ¿El topic quedó `drafted` (o con nota de rework)?

## Notas de runtime

- Schedule: cron diario 03:00 hora del server (`automation/n8n/leda-blog-publisher.json`). Si hay
  varios proyectos con blog, escalónalos: comparten los límites de la suscripción.
- Watchdog: 45 min (`TimeoutMinutes` de Leda en `scripts/agents.ps1`). Corrida normal con 1 post:
  ~12-20 min. Banco vacío: < 2 min. Una corrida larga siempre significa que había trabajo.
- Modelo: Sonnet (el de Leda). No Haiku.
- Idempotencia: un topic `assigned`/`drafted` no vuelve a aparecer en `list-topics`. Si la
  corrida muere a mitad, un topic que quedó `assigned` sin post se retoma a mano (avísalo en el
  brief si lo detectas).
- Tmp files: `tmp\leda-<slug>-*.{json,png,txt}`.
