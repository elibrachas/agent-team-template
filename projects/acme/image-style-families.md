# Image style families — Acme blog (EJEMPLO)

> **Acme es un SaaS de ejemplo; reemplaza todo.** Leda 📖 lee este archivo para componer el `STYLE_FAMILY_BLOCK` del prompt del modelo de imágenes. La selección es random con anti-repetición (excluir las familias usadas en los últimos 3 posts publicados, guardadas en un campo del post en el CMS).
>
> Para ajustar: editas un template y la próxima corrida lo levanta. No requiere tocar código. Los bloques compartidos y las dos familias de abajo son reutilizables tal cual; agrega o reemplaza familias para que la estética encaje con tu marca (ver `brand-bible.md`).

## Bloques compartidos (van en todos los prompts)

### HEADER
```
Editorial illustration to accompany a blog article. The image must contain NO text, letters, or words of any kind — do not draw the title, a headline, a caption, or any lettering.
Article theme (context to inform the imagery only, NEVER to be rendered as text in the image): "<TITLE>".
Topic: <CATEGORY> · Audience: TODO(acme): describe tu audiencia en una línea (p. ej. "freelancers and small business owners").
```

> **Por qué el HEADER no dice "titled"**: decirle al modelo que ilustre un post *"titled: X"* lo empuja a tipografiar un titular dentro de la imagen, y cuando un modelo de imágenes renderiza texto suele inventar un titular genérico sin relación con el post. Por eso el tema va como CONTEXTO y el texto se prohíbe explícitamente acá y en el ANTI_AI_BLOCK.

### ANTI_AI_BLOCK
```
CRITICAL: the final image must contain absolutely no text, letters, words,
headlines, titles, captions, labels, or lettering of any kind. An image with
any legible text is unusable — render the concept purely through imagery.

AVOID: photorealism, smooth digital gradients, glowing neon highlights,
perfect symmetry, hyperrealistic faces, generic stock-photo poses,
overcrowded compositions, recognizable real people, brand logos, branded
products, text or words within the image, AI-style "wow" aesthetic.

EMBRACE: imperfect hand-drawn lines, off-center composition, generous
negative space, traditional print media references, intentional
imperfections like ink bleed or grain, characters with simplified but
expressive features.
```

### FORMAT_BLOCK
```
16:9 landscape orientation, target 1568x880 px. The composition must read
clearly at thumbnail size (~600px wide) — the focal subject is centered
enough to survive aggressive cropping but the overall composition is
off-center.
```

---

## F1 — New Yorker editorial cartoon

**Reference**: Roz Chast, Bruce Eric Kaplan, William Steig, Christoph Niemann (line work).

**STYLE_FAMILY_BLOCK**:
```
Style: New Yorker single-panel editorial cartoon in the tradition of Roz
Chast, Bruce Eric Kaplan, and William Steig.

Visual: confident black ink line work with very subtle watercolor or
ink-wash tinting, loose hand-drawn lines, slightly off-kilter geometry,
generous negative space, single-panel composition. Dry quiet humor, never
cynical or mean-spirited. The reader/customer is the protagonist, not the joke.

Characters: simplified facial features (small dots for eyes, minimal nose,
expressive mouths), realistic body proportions, contemporary clothing
suggested with few lines.

Color palette: black ink + maximum 2 muted washes (soft ochre, dusty teal,
faded brick red, washed gray, pale mustard). Never bright or saturated.
Most of the image is white/off-white paper.

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

_Guía_: define 4-6 familias en total para que la anti-repetición tenga margen (con 3 excluidas, quedan al menos 3 para elegir). Cada familia lleva: **Reference** (artistas/tradición), **STYLE_FAMILY_BLOCK** (visual, personajes, paleta, textura) y **Cuándo encaja**. Ideas: risografía, tinta + lápiz de color, collage editorial, ilustración de línea con identidad regional.

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
2. derivar SCENE de los takeaways del post (1-2 oraciones específicas):
     - "A freelancer at a kitchen table arranging price tags into a neat list"
   Reglas para la scene:
     - debe relacionarse con el TÍTULO del post
     - debe ser visualizable en una sola imagen (no una narrativa con varios momentos)
     - sin marcas, logos, personas reales ni texto
3. concatenar: HEADER + STYLE_FAMILY_BLOCK(elegida) + "Scene: " + SCENE + ANTI_AI_BLOCK + FORMAT_BLOCK
4. llamar generate-image con ese prompt
5. validar la imagen (resolución, aspect ratio, sin caras fotorrealistas, sin texto)
6. upload-media y setear la imagen destacada del post
```
