# Image style families — Acme blog (EJEMPLO)

> **Acme es un SaaS de ejemplo; reemplaza todo.** Leda 📖 lee este archivo para componer el `STYLE_FAMILY_BLOCK` del prompt del modelo de imágenes. La selección es random con anti-repetición (excluir las familias usadas en los últimos 3 posts publicados, guardadas en un campo del post en el CMS).
>
> Para ajustar: editas un template y la próxima corrida lo levanta. No requiere tocar código. Los bloques compartidos y las dos familias de abajo son reutilizables tal cual; agrega o reemplaza familias para que la estética encaje con tu marca (ver `brand-bible.md`).
>
> **Lección**: combatir la estética de IA a fuerza de paletas apagadas, papel blanco y mucho espacio vacío da imágenes genéricas, sin vida y todas parecidas entre sí (y, con varios blogs, iguales entre marcas). Lo que funciona es lo contrario: dos **bloques de marca** que van SIEMPRE, antes del estilo — `VIBE_BLOCK` (un momento concreto, gesto, luz, humor cálido) y `BRAND_PALETTE_BLOCK` (el color de marca como hilo visual de todas las portadas + una paleta saturada) — y una **guía de escena** que obliga a una persona haciendo algo. Las reglas duras (sin texto, sin logos, sin personas reales, sin fotorrealismo) no cambian.

## Identidad visual del blog

_Guía_: 3-5 líneas que expliquen por qué esta paleta y este tono, para que quien edite las familias no las vuelva a apagar.

- TODO(acme): el color de marca (el del CTA o el isotipo) y por qué es el hilo visual de las portadas. _Ej._: el producto es neutro con un solo color de marca, `{{BRAND_ACCENT_HEX}}`; el blog se lee sobre fondo claro, así que las imágenes van con fondo cálido claro y ese color como el punto que "es Acme".
- TODO(acme): la personalidad de la marca traducida a imagen. _Ej._: adultos capaces en acción, calor humano, humor tranquilo; nunca la persona derrotada frente a una pila de papeles, nunca el stock corporativo, nunca el robot/cerebro brillante.
- TODO(acme): la textura cotidiana de tu audiencia (lugares, objetos) que puede aparecer sin ciudad ni bandera específica.

## Bloques compartidos (van en TODOS los prompts, en este orden)

### HEADER
```
Editorial illustration to accompany a blog article. The image must contain NO text, letters, or words of any kind — do not draw the title, a headline, a caption, or any lettering.
Article theme (context to inform the imagery only, NEVER to be rendered as text in the image): "<TITLE>".
Topic: <CATEGORY> · Audience: TODO(acme): describe tu audiencia en una línea (p. ej. "freelancers and small business owners").
```

> **Por qué el HEADER no dice "titled"**: decirle al modelo que ilustre un post *"titled: X"* lo empuja a tipografiar un titular dentro de la imagen, y cuando un modelo de imágenes renderiza texto suele inventar un titular genérico sin relación con el post. Por eso el tema va como CONTEXTO y el texto se prohíbe explícitamente aquí y en el ANTI_AI_BLOCK.

### VIBE_BLOCK
```
Mood: warm, hopeful, human, quietly funny. The reader is a capable adult
caught mid-action — never defeated, never a victim, never a corporate stock
figure. Show ONE specific moment with motion or emotion: a stride, a gesture,
a glance, a small private victory, a shared laugh. There is a visible light
source (window light, afternoon sun, a warm lamp) and the scene feels lived-in.
Characters have readable expressions and body language; faces are simplified
but alive. One clear focal point that reads at thumbnail size.
```

_TODO(acme)_: ajusta el mood a tu marca y suma, si aplica, la textura cotidiana de tu audiencia (p. ej. "a café, a kitchen table, a balcony, a bus — with no specific city, flag or landmark").

### BRAND_PALETTE_BLOCK
```
Brand palette (applies on top of the style): the signature accent is
{{BRAND_ACCENT_NAME}} ({{BRAND_ACCENT_HEX}}). It MUST appear clearly on the
focal element or on one key object — a folder, a jacket, a chair, a door, a
mug, a notebook — never as the whole background and never diluted. Supporting
colors, pick 2-3 per image: {{SUPPORTING_COLORS}} (e.g. warm cream paper,
charcoal ink, deep teal, mustard yellow). Colors are saturated and confident —
not pastel, not washed out, not muddy. The ground is warm off-white and the
overall image is bright.
```

### ANTI_AI_BLOCK
```
CRITICAL: the final image must contain absolutely no text, letters, words,
headlines, titles, captions, labels, logos or lettering of any kind. An image
with any legible text is unusable — render the concept purely through imagery.

AVOID: photorealism and hyperrealistic faces; slick 3D renders, plastic
gradients, glowing neon, lens flares; perfect symmetry; generic stock-photo
poses (handshakes, thumbs-up, pointing at charts, staring at a laptop);
overcrowded compositions; recognizable real people; brand logos and branded
products; grey lifeless offices; sad, slumped, defeated characters; AI clichés
(robots, glowing brains, circuit boards, floating holograms, a magnifying glass
over a document as the default metaphor); dull, desaturated or washed-out
color; large empty areas of blank paper as a substitute for composition.

EMBRACE: the hand of a real illustrator (imperfect lines, a visible medium —
ink, gouache, print grain, cut paper); confident saturated color; a real
moment happening; warmth and light; humor without mockery.
```

### FORMAT_BLOCK
```
16:9 landscape orientation, target 1568x880 px. The composition must read
clearly at thumbnail size (~600px wide) — the focal subject is centered
enough to survive aggressive cropping but the overall composition is
off-center and dynamic.
```

---

## F1 — New Yorker editorial cartoon

**Reference**: Roz Chast, Bruce Eric Kaplan, William Steig, Christoph Niemann (line work).

**STYLE_FAMILY_BLOCK**:
```
Style: New Yorker single-panel editorial cartoon in the tradition of Roz
Chast, Bruce Eric Kaplan, and William Steig.

Visual: confident black ink line work with watercolor or ink-wash tinting,
loose hand-drawn lines, slightly off-kilter geometry, a full single-panel
scene (not a lone figure on blank paper). Dry quiet humor, never cynical or
mean-spirited. The reader/customer is the protagonist, not the joke.

Characters: simplified facial features (small dots for eyes, minimal nose,
expressive mouths), realistic body proportions, contemporary clothing
suggested with few lines, caught mid-gesture.

Color palette: black ink + 2-3 confident washes from the brand palette; the
brand accent sits on the focal object. Warm off-white paper ground, with
the washes covering a real part of the scene.

Texture: visible paper grain, slight ink bleed where lines thicken, subtle
unevenness as if drawn on cold-press paper. The watercolor washes have
hard edges where they pool.
```

**Cuándo encaja (orientativo — la selección es random)**: artículos de opinión, reflexiones, situaciones cotidianas del cliente contadas con humor.

---

## F2 — Mid-century editorial illustration

**Reference**: Saul Bass, Charley Harper, Push Pin Studios, Paul Rand, Alvin Lustig, 1950s-60s magazine art (Esquire, Fortune).

**STYLE_FAMILY_BLOCK**:
```
Style: Mid-century modernist editorial illustration in the tradition of
Saul Bass, Charley Harper, and Push Pin Studios.

Visual: bold geometric shapes, flat colors with subtle grain overlay,
modernist composition, confident shape-based forms over line work. Slight
playful quality — shapes nearly but not quite symmetric. Layered planes
with limited depth.

Characters and objects: reduced to elegant geometric primitives. Faces
suggested with one or two well-placed shapes, no detail. Bodies are flat
silhouettes or stacked rounded shapes. Clothing and objects abstracted to
their essential form.

Color palette: 3-4 colors total. Warm earth tones (ochre, deep navy,
off-white, brick red) OR cool retro (mustard yellow, sage green, charcoal,
cream). One color clearly dominates; one acts as accent.

Texture: subtle grain overlay throughout the image — the kind of
imperfection that comes from offset printing in the 1960s. Edges between
colors are crisp but the colors themselves carry texture inside them.
```

**Cuándo encaja**: guías estructuradas, how-to, frameworks, "anatomía de…", resúmenes de datos.

---

## F3…Fn — TODO(acme)

_Guía_: define 4-6 familias en total para que la anti-repetición tenga margen (con 3 excluidas, quedan al menos 3 para elegir). Cada familia lleva: **Reference** (artistas/tradición), **STYLE_FAMILY_BLOCK** (visual, personajes, paleta, textura) y **Cuándo encaja**. Ideas: risografía, gouache + tinta, collage de papel recortado, ilustración de línea con identidad regional. Escríbelas con color y luz: la paleta de cada familia convive con el `BRAND_PALETTE_BLOCK`, no lo reemplaza (si una familia pide "never bright or saturated", choca con la marca y vuelve a salir sobria).

---

## Guía de escena (para que NO salga genérica)

La `SCENE` la escribe Leda a partir del post (1-2 oraciones). Receta obligatoria: **persona + acción concreta + objeto del oficio + lugar + luz + emoción**.

- **Objetos del oficio** (elige 1-2): TODO(acme): los objetos del mundo de tu audiencia (p. ej. una laptop, el celular con un mail, un cuaderno, una carpeta del color de marca, una taza, una agenda).
- **Acciones vivas**: caminar hacia, salir de, alcanzar, entregar, celebrar en silencio, ensayar frente al espejo, tachar y reescribir, cerrar la laptop y sonreír.
- **Lugares**: cocina, café de barrio, balcón, bus, plaza, escritorio junto a una ventana grande.
- **Emociones**: alivio, orgullo tranquilo, curiosidad, nervios con humor, determinación.
- **Prohibido como default**: lupa sobre el documento, persona hundida frente a una pila de papeles, oficina gris, robots, cerebros, apretón de manos, señalar un gráfico.

Ejemplos buenos (adáptalos al blog del proyecto):
- Post sobre organizar un portfolio → `A young designer on a sunny balcony pins bright portfolio pages onto a clothesline like laundry, one page in the brand accent color catching the wind; a mug and a laptop on a small table, plants around.`
- Post sobre negociar condiciones → `Two people at a café table in warm window light; the younger one slides a single notebook in the brand accent color across the table with a small confident smile, the other raises an eyebrow mid-sip.`

---

## Anti-repetition selection algorithm

Leda implementa esta lógica en `content-blog-publisher`:

1. `scripts\leda-helpers.ps1 -Action find-recent-styles -Limit 3` → devuelve las familias usadas en los últimos 3 posts publicados.
2. Pool inicial: todas las familias definidas en este archivo (`F1…Fn`).
3. Excluir las del paso 1.
4. Random uniforme entre las restantes.
5. Guardar la elegida en el campo de estilo del post nuevo (vía `update-post`).

Si `find-recent-styles` no devuelve nada (primera corrida), pool = todas las familias, random puro.

---

## Cómo Leda arma el prompt completo

Pseudocódigo:

```
1. seleccionar familia (random anti-repetición) → guardarla en el post
2. derivar SCENE con la receta de la "Guía de escena" (persona + acción + objeto + lugar + luz + emoción):
     - "A freelancer at a kitchen table arranging price tags into a neat list, one tag in the brand accent color"
   Reglas para la scene:
     - debe relacionarse con el TÍTULO del post
     - debe ser visualizable en una sola imagen (no una narrativa con varios momentos)
     - sin marcas, logos, personas reales ni texto
3. concatenar, EN ESTE ORDEN:
     HEADER
     + VIBE_BLOCK
     + BRAND_PALETTE_BLOCK
     + STYLE_FAMILY_BLOCK(elegida)
     + "Scene: " + SCENE
     + ANTI_AI_BLOCK
     + FORMAT_BLOCK
4. escribir el prompt a tmp\leda-<slug>-<postId>-prompt.txt (UTF-8) y llamar generate-image -PromptFile
5. validar la imagen (sizeBytes > ~30KB, mimeType image/*; a ojo: ¿está el color de marca? ¿hay una persona haciendo algo? ¿hay luz? ¿cero texto?)
6. upload-media y setear la imagen destacada del post (featuredImage + meta.image)
```

Si borras `VIBE_BLOCK` y `BRAND_PALETTE_BLOCK` (porque tu marca no los necesita), el publisher arma el prompt sin ellos: los usa solo si este archivo los define.
