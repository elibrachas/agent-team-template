---
name: content-blog-improver
description: Use when polishing a single existing blog post of the project to publishable quality (interactive `Leda:` requests — a draft written by hand in the CMS admin, or a correction on a scheduled/published post) — improves text, adds internal + external authority links, fills SEO fields (title, slug, excerpt, meta), assigns category and tags from canonical taxonomy, validates brand voice. Also the rulebook (Steps 4-11) that content-blog-publisher applies when it writes a post from scratch. Does NOT generate the image or schedule publish. Input: a postId. Respeta la audiencia objetivo y lo que el strategicFocus de project.json declara fuera de scope.
hitl_level: 2
owner: owner
agent: leda
inputs:
  - "CMS (p. ej. Payload; API key auth vía leda-helpers.ps1): GET /posts/{id}, GET /posts (publicados, como candidatos a internal links)"
  - "projects/<slug>/content-references.md — links externos de autoridad curados"
  - "projects/<slug>/blog-taxonomy.md — categories canónicas + tag set + tags excluidos"
  - "projects/<slug>/brand-bible.md — audiencia, páginas core del producto, URL pública"
  - "plugins/team-shared/skills/brand-voice/SKILL.md — voz operativa"
outputs:
  - "CMS: PATCH /posts/{id} con texto mejorado + meta + tags + author"
  - "Linear (issue origen si lo hubo): comentario con resumen de cambios + admin URL"
cost_budget_usd: 2
---

# content-blog-improver

> **HITL 2.** Pule UN post existente a calidad publicable. NO genera imagen, NO publica, NO programa.
>
> **Dos usos:**
> 1. **Interactivo** (`Leda: mejora / corrige el post <id>`): el flujo completo de abajo.
> 2. **Reglas del publisher**: `content-blog-publisher` no pule drafts de un generador upstream — redacta cada nota desde el banco de ideas (`topics`). Para eso aplica los **Pasos 4 a 11** de esta skill (estructura, Lexical, voz, SEO, taxonomía, links, author, gates, encoding). Los Pasos 1-3 son solo para un post que ya existe.

## Antes de correr (dependencias)

1. Cargar `team-shared/skills/brand-voice` — la voz del proyecto (registro, persona gramatical, qué evitar: superlativos vacíos, promesas vacías).
2. Cargar `team-shared/skills/customer-personas` — a quién le escribe el blog.
3. Leer `projects/<slug>/glossary.md` si el post menciona términos del dominio del producto.
4. Leer `projects/<slug>/content-references.md` — lista curada de fuentes de autoridad (oficiales, institucionales, del sector) por tema/región.
5. Leer `projects/<slug>/blog-taxonomy.md` — categories canónicas + tag set + tags excluidos.
6. Leer `projects/<slug>/brand-bible.md` — audiencia objetivo, URL pública del producto (ej. `https://acme.example`) y páginas core linkeables.

## Toolset

- **Bash** para invocar `scripts\leda-helpers.ps1` (CMS + validación de links).
- **WebSearch + WebFetch** para encontrar fuentes externas de autoridad reales y verificar datos antes de citarlos (no inventes URLs ni stats).
- **mcp__linear__\*** para comentar en el issue origen (si la skill se invocó desde un comentario `Leda: ...`).
- **Read** para leer los archivos de referencia.

## Inputs esperados

- `postId` — id del post a pulir (p. ej. `143` en un CMS con ids numéricos). El pedido interactivo lo trae en el comentario o en el link al admin del issue.
- `issueOrigenId` (opcional) — si la skill fue invocada desde un comentario en Linear, el issue ID para comentar el resumen.

## Workflow

### Paso 1: leer draft completo

```bash
powershell -File scripts\leda-helpers.ps1 -Action get-post -PostId <id>
```

Output: JSON con `title`, `content` (Lexical AST), `excerpt`, `category`, `tags`, `slug`, `meta`, `authors`, `featuredImage`, `_status`, campos `leda*`.

**Verificar primero (guard de reproceso)** — depende de cómo se invocó la skill:

- **Sin pedido explícito** (SIN `issueOrigenId`): si `_status != 'draft'` o `ledaProcessedAt` está seteado → **abortar**. Reporta que ya fue procesado o publicado.
- **Corrección interactiva** (invocada desde un comentario `Leda:` del owner, CON `issueOrigenId` — ej. "corrige el encoding del post X"): **NO abortes** aunque el post esté `scheduled`/`published` o tenga `ledaProcessedAt`. El owner pidió explícitamente reprocesar ESTE post; reprocésalo para aplicar el fix (encoding, tono, links...). Es **seguro**: el improver solo hace PATCH de texto/meta y NO toca `_status`, `ledaPublishAt`, `ledaStatus`, `ledaProcessedAt` ni la imagen (ver Paso 11, "No tocar") — un post programado se sigue publicando a su hora, ahora con el contenido corregido, y uno ya publicado queda corregido en vivo.
- **Post publicado con un refresh pendiente** (HARD): si el post está publicado, corre también `get-post -PostId <id> -Draft`; si esa última versión tiene `_status: "draft"`, hay un borrador sin publicar (un refresh que no pasó los gates, o una edición del owner a medio hacer). Ahí **NO hagas PATCH sin `-Draft`**: un CMS con versiones (p. ej. Payload) arma el update sobre la última versión (el borrador) y la nota publicada pasaría a borrador (404 en la URL pública). Aplica la corrección sobre el borrador (`update-post -Draft`, partiendo del contenido de `get-post -Draft`) y avísale al owner que ese borrador sigue sin publicar. `mark-needs-rework` detecta solo ese caso y marca únicamente el borrador, así que los caminos de falla de los Pasos 2, 6 y 10 no despublican la nota.

### Paso 2: filtro de audiencia (foco del proyecto)

Si los `tags` o el `title` incluyen alguno de los **tags excluidos** de `blog-taxonomy.md` (contenido para una audiencia o línea de producto fuera de scope según el `strategicFocus` de project.json), marca el draft como NO elegible:

```bash
powershell -File scripts\leda-helpers.ps1 -Action mark-needs-rework -PostId <id>
```

Comenta en Linear (si hay issue origen): "Skipped — el target del contenido está fuera de scope según el strategicFocus del proyecto. Conviene sacar este post del backlog de Leda."

### Paso 3: analizar gaps

Antes de tocar nada, lista QUÉ falta. Output mental (no escribes nada todavía):

- **Estructura**: ¿tiene intro / secciones / conclusión? ¿headings H2/H3 jerárquicos?
- **Voz**: ¿respeta la persona gramatical de `brand-voice` (ej. tuteo sin voseo)? ¿superlativos vacíos ("el mejor", "único", "revolucionario")? ¿promesas vacías?
- **Claims**: ¿números sin fuente? ¿afirmaciones sin respaldo?
- **Links**: ¿cuántos internos? ¿cuántos externos? (target: ≥2 internos + ≥2 externos)
- **SEO**: ¿title <60 chars? ¿meta title + description seteados? ¿excerpt 160-200 chars? ¿slug SEO-friendly?
- **Taxonomy**: ¿category es del set canónico? ¿hay 3-5 tags?
- **Image**: (no la generas tú — lo hace el publisher — pero verifica si el draft ya tiene una `featuredImage`; si tiene, déjala — quizá el owner ya puso una)
- **Author**: ¿hay al menos 1 autor? Si no, hay que setear el autor por defecto (ver Paso 9).

### Paso 4: mejorar el content (texto Y formato)

**Importante**: el content en el CMS es **Lexical JSON** (AST), NO markdown (no hay converter — editas el AST). "Mejorar" incluye **estructura y formato**, no solo el texto: el objetivo es que quede tan prolijo como una buena edición editorial, no apenas corregir palabras. Tienes libertad para reordenar, partir párrafos y agregar headings/listas/bold. Lo único que NO haces: inventar datos/stats, ni reescribir todo al punto de perder el contenido original.

**Hazlo más interesante, no solo correcto** (esto es clave — es lo que diferencia a Leda de un corrector): engancha desde la primera línea con el dolor/objetivo concreto del lector, usa ejemplos y escenarios reales de la audiencia del proyecto, datos verificados (con WebSearch), y un ángulo que aporte algo que el lector no sabía. Cero relleno genérico, cero tono de manual. Test: ¿alguien de la audiencia objetivo lo leería y diría "qué bueno"? Si no, mejóralo.

**Reglas de estructura (esto es lo que lo hace ver bien):**

1. **NUNCA pongas un `h1` dentro del content.** El campo `title` YA es el h1 de la página. El content arranca en `h2`. Los drafts viejos de un generador upstream y los escritos a mano suelen traer un `h1` al inicio → **bórralo** (o bájalo a `h2` solo si es una sección real). No confíes en que el frontend quite el h1 líder: suele hacerlo solo si su texto coincide EXACTO con el title; si no, queda un título duplicado visible.
2. **Jerarquía limpia**: `h2` para secciones, `h3` para subsecciones. No saltes niveles.
3. **Párrafos cortos**: máx ~3-4 líneas. Parte los muros de texto.
4. **Listas** para enumeraciones / pasos / checklists (mejor que párrafos con comas).
5. **Énfasis con bold** (`"format": 1`): resalta términos clave, el lead-in de cada item de lista y frases importantes — sin abusar (~1-2 por párrafo). Esto es lo que más diferencia un texto plano de uno cuidado.
6. **Acentos también en el `title`**: si el title viene sin diacríticos ("Metodo", "como"), corrígelo ("Método", "cómo"). Vale para todos los campos customer-facing.
7. Cierre con CTA suave a una página core.

Cómo se ven los nodos Lexical (lee los del draft real como base; esto es referencia):

```json
{ "type": "paragraph", "format": "", "indent": 0, "direction": "ltr", "version": 1, "children": [
  { "type": "text", "text": "texto normal y ", "format": 0, "detail": 0, "mode": "normal", "style": "", "version": 1 },
  { "type": "text", "text": "una frase clave en bold", "format": 1, "detail": 0, "mode": "normal", "style": "", "version": 1 }
] }
{ "type": "heading", "tag": "h2", "format": "", "indent": 0, "direction": "ltr", "version": 1, "children": [{ "type": "text", "text": "Título de sección", "format": 0, "detail": 0, "mode": "normal", "style": "", "version": 1 }] }
{ "type": "list", "tag": "ul", "listType": "bullet", "start": 1, "format": "", "indent": 0, "direction": "ltr", "version": 1, "children": [
  { "type": "listitem", "value": 1, "format": "", "indent": 0, "direction": "ltr", "version": 1, "children": [
    { "type": "text", "text": "Lead-in en bold:", "format": 1, "detail": 0, "mode": "normal", "style": "", "version": 1 },
    { "type": "text", "text": " y el resto del item normal.", "format": 0, "detail": 0, "mode": "normal", "style": "", "version": 1 }
  ] }
] }
{ "type": "link", "fields": { "url": "/una-pagina-core", "linkType": "custom", "newTab": false }, "format": "", "indent": 0, "direction": "ltr", "version": 1, "children": [{ "type": "text", "text": "texto del ancla", "format": 0, "detail": 0, "mode": "normal", "style": "", "version": 1 }] }
```

- **`format` de un text node** (bitmask Lexical): `0`=normal, `1`=bold, `2`=italic, `3`=bold+italic, `8`=underline. Para énfasis editorial usa `1`.
- **`indent: 0` en TODO nodo elemento es OBLIGATORIO** (paragraph/heading/list/listitem/link/quote): sin él, el front renderiza pero el ADMIN de un CMS con Lexical rompe al abrir el post (`Minified Lexical error #117` = `Invalid indent value`). `format`/`direction`/`version` en elementos y `detail`/`mode`/`style` en text completan la forma que el editor serializa. `leda-helpers.ps1` rellena estos defaults en `create-post`/`update-post` como red de seguridad — escríbelos igual.
- **Links**: formato del CMS = `fields.url` + `fields.linkType:"custom"` + `fields.newTab`. `newTab:false` para internos (`/...` del sitio del proyecto), `newTab:true` solo para externos.

**Reglas de edición**:

- **Voz**: la de `brand-voice` (ej. español neutro con tuteo: "tú", "te", "sube tu archivo"; sin voseo ni español de España, si así lo define la guía).
- **Claridad**: oraciones promedio <20 palabras. Voz activa. Sin jerga corporativa.
- **Estructura**: la intro engancha en 1-2 oraciones con el "para qué" del lector. 2-6 secciones H2. Sub-secciones H3 cuando aplique. Cierre con CTA suave a una página core.
- **Tono**: honesto, claro, cercano-profesional. NO motivacional vacío. NO paternalista. NO promesas.

### Paso 5: SEO fields

- `title`: <60 chars, con keyword principal natural, sin clickbait. Conservar el original si ya está bien.
- `slug`: kebab-case derivado del title (sin stopwords como "y", "de", "el", "la"). Si el original es genérico o muy largo, regenerar.
- `excerpt`: 160-200 chars. Pitch del valor concreto. Que el lector entienda QUÉ se lleva.
- `meta.title`: <60 chars. Puede ser igual al title o variante con keyword más explícita.
- `meta.description`: 140-160 chars. Distinta del excerpt cuando puedas.
- `meta.image`: la setea el publisher con la imagen generada. NO la toques.

### Paso 6: category y tags

Leer `projects/<slug>/blog-taxonomy.md`. Elegir:

- **1 category exacta** del set canónico. Si el post no encaja en ninguna: `mark-needs-rework` y comentar "category no canónica: <propuesta>" para que el owner decida si expandir el set.
- **3-5 tags exactos** del set, siguiendo las reglas de combinación que define `blog-taxonomy.md`.

### Paso 7: internal links

```bash
powershell -File scripts\leda-helpers.ps1 -Action find-related -ExcludeId <currentPostId> -Tags <tag1,tag2,tag3> -Category <category>
```

Output: lista de posts publicados ordenada por score (overlap de tags + match de category). Elegir **2-3 candidatos** + opcionalmente 1-2 a **páginas core del producto** (la tabla "página core → cuándo linkearla" vive en `brand-bible.md` o `content-references.md`; ej. la página de precios cuando el post habla de planes, la de "cómo funciona" en un post explicativo).

**Validar cada URL** con `validate-link`:

```bash
powershell -File scripts\leda-helpers.ps1 -Action validate-link -Url https://acme.example/precios
```

Si da `ok: false` → no incluir, buscar alternativa.

**Inserción (clave)**: distribuye los links **a lo largo del cuerpo**, anclados a la frase relevante — NO los amontones al final. Internos: 2-3 inline donde el tema lo pida. Puedes ADEMÁS cerrar con un bloque corto "Lecturas relacionadas" (2-3 items), pero ese bloque NO reemplaza los links en el cuerpo — es extra.

### Paso 8: external authority links

**Usa WebSearch** para encontrar las fuentes externas más relevantes y actuales del tema (no te limites a la lista curada — es el piso, no el techo). **WebFetch** para abrir la fuente y confirmar que realmente dice lo que vas a citar (sobre todo si citas un número). Después `validate-link` para el liveness final. Lee `projects/<slug>/content-references.md` como base curada. Elegir 2-3 fuentes relevantes al tema:

- Si el post es de un país/región concreto → priorizar el instituto oficial de estadística y las fuentes sectoriales de esa región que liste `content-references.md`.
- Si es post de data / estadísticas → organismos internacionales u oficiales pertinentes.
- Si es post de investigación del sector → reportes reconocidos de la industria.

**Validar todas con `validate-link`** antes de incluir.

**Anchor text descriptivo**, NO genérico:
- ✅ "Según el [informe anual del instituto de estadística](https://...), la tasa de…"
- ❌ "Según [esta fuente](https://...), …"

`rel="noopener"` siempre. Default follow (no agregar nofollow salvo razón específica).

### Paso 9: authors

Si `authors` está vacío, setea el autor por defecto: **`authors: [<DEFAULT_AUTHOR_ID>]`** — `TODO(acme): id del autor por defecto en tu CMS` (ej. el usuario "Equipo de Acme"). Si la API key no puede leer la colección de usuarios (es común que `/users` dé 403 con un secreto compartido), no intentes listarla: fija el id aquí y actualízalo si cambia.

Si ya tiene authors, mantenlos.

### Paso 10: quality gates (HARD — no PATCH si fallan)

Valida **antes** de enviar el patch:

- [ ] Length del content ≥ 800 palabras (contar texto en los nodos Lexical).
- [ ] ≥ 2 internal + ≥ 2 external authority links, **distribuidos en el cuerpo** (anclados a frases/datos relevantes), no solo en un bloque al final.
- [ ] `title` seteado, <60 chars.
- [ ] `excerpt` seteado, 160-200 chars.
- [ ] `meta.title` seteado, `meta.description` seteada 140-160 chars.
- [ ] `slug` seteado, SEO-friendly.
- [ ] ≥ 1 author.
- [ ] `category` del set canónico.
- [ ] 3-5 tags del set canónico.
- [ ] Cero desvíos de la persona gramatical de `brand-voice` en customer-facing text.
- [ ] Cero superlativos vacíos.
- [ ] Cero promesas vacías.
- [ ] El content NO empieza con un `h1` (arranca en `h2`; el `title` es el h1 de la página).
- [ ] Hay énfasis con bold (`format:1`) en términos/frases clave — el texto no quedó 100% plano.
- [ ] Párrafos cortos (≤ ~4 líneas) y listas donde aplica.
- [ ] Links internos con `newTab:false`; externos con `newTab:true`.
- [ ] `title` (y demás campos) con acentos correctos.
- [ ] Ningún campo de texto contiene el carácter de reemplazo `�` (U+FFFD) — si aparece, hubo corrupción de encoding aguas arriba; NO hagas PATCH, reescribe el nodo (y confirma que el PATCH usa `-BodyJsonFile`, no `-BodyJson`, ver Paso 11).
- [ ] `authors` seteado (el autor por defecto del Paso 9 si estaba vacío).
- [ ] Todo dato/stat citado verificado con fuente real (WebSearch/WebFetch) y linkeado — nada inventado.
- [ ] Lexical JSON parsea limpio (valida con `ConvertFrom-Json` o equivalente).

**Si falla cualquiera**:

```bash
powershell -File scripts\leda-helpers.ps1 -Action mark-needs-rework -PostId <id>
```

Comentar en Linear (si hay issue origen) qué falló específicamente. NO PATCH.

### Paso 11: PATCH al CMS

Si pasaron los gates, armar el patch body con SOLO los campos modificados.

> ⚠️ **Encoding (HARD STOP).** NUNCA pases contenido con acentos/ñ/emoji por `-BodyJson` (string de CLI). Al cruzar el borde `bash → powershell.exe` como argumento, PS 5.1 lo decodifica con el codepage del sistema (CP1252), NO UTF-8, y los acentos se rompen al carácter de reemplazo `�` (ej. `qué` → `qu�`), que queda guardado en el post publicado. Escribe SIEMPRE el body a un archivo UTF-8 con el heredoc de bash y usa `-BodyJsonFile` (el helper lo lee con `[System.IO.File]::ReadAllText($file, [Text.Encoding]::UTF8)` — ver `scripts/leda-helpers.ps1`). Vale para cualquier PATCH con texto customer-facing.

```bash
# 1) Escribe el body JSON a un archivo UTF-8 con un heredoc de bash.
#    Bash escribe los bytes UTF-8 tal cual — NO cruza el borde de CLI que rompe los acentos.
#    `tmp/` está gitignored: en un checkout limpio no existe y bash NO crea el dir padre
#    del redirect → sin este mkdir, `cat >` aborta con "No such file or directory". Es idempotente.
mkdir -p tmp
cat > tmp/leda-body-<id>.json <<'JSON'
{
  "title": "...",
  "excerpt": "...",
  "slug": "...",
  "content": { ...Lexical AST modificado... },
  "category": "...",
  "tags": ["tag1","tag2","tag3"],
  "authors": [<DEFAULT_AUTHOR_ID>],
  "meta": { "title": "...", "description": "..." }
}
JSON

# 2) Haz el PATCH leyendo el archivo (UTF-8), NO un string de CLI.
powershell -File scripts\leda-helpers.ps1 -Action update-post -PostId <id> -BodyJsonFile tmp/leda-body-<id>.json
```

`authors` solo si estaba vacío (ver Paso 9). `meta` sin `image` — la setea el publisher.

**No tocar**: `_status` (lo cambia el tick), `publishedAt` (lo setea un hook del CMS/producto), `featuredImage` (la setea el publisher), `ledaPublishAt`, `ledaStatus`, `ledaProcessedAt` (los setea el publisher al programar).

### Paso 12: comentario en Linear (si hay issue origen)

```
🤖 Leda 📖: Post pulido.

Cambios principales:
- <bullet 1: ej. "Reescrita la intro para enganchar con el dolor concreto del lector">
- <bullet 2: ej. "Agregados 3 internal links + 2 external (fuentes oficiales)">
- <bullet 3: ej. "Category: '<category>'. Tags: <list>">

Preview: <admin URL del CMS: ${PAYLOAD_BASE_URL}/admin/collections/posts/<id>>

NO está publicado todavía. Si te invocaron en modo individual: hay que invocar a Leda en el publisher para imagen + programación. Si esto vino del cron: el publisher continúa con imagen + programación automáticamente.
```

## Autoauditoría antes de entregar

- ¿Me desvié de la persona gramatical de `brand-voice` en algún lugar del body? (ej. si la guía pide tuteo, buscar voseo: `tenés|querés|podés|subí|escribí|vos\b`)
- ¿Inventé alguna stat sin fuente?
- ¿Algún link externo dio 404 al validar?
- ¿La category está en `blog-taxonomy.md`?
- ¿Los tags están en el set?
- ¿El Lexical JSON parsea sin error?
- ¿El post sigue siendo del autor original o lo reescribí desde cero? (objetivo: **mejorar**, no reescribir todo)

## Notas de runtime

- Sin Supabase. Write sobre el CMS (colección Posts) vía API key. No toca código del producto. WebSearch/WebFetch para fuentes externas.
- Costo objetivo: < USD 2 / corrida (Sonnet, ~3-5 turnos de tool use).
- El cron `content-blog-publisher` no invoca esta skill como sub-paso (redacta desde el banco `topics`); solo carga sus reglas. Esta skill comenta en Linear solo cuando hay issue origen.
