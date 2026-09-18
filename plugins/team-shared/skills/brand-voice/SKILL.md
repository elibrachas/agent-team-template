---
name: brand-voice
description: Use when writing or reviewing any customer-facing content for the active project — blog posts, ads copy, emails, product pages, push notifications, social posts, in-product copy, support replies. Loads the project's brand bible (projects/<slug>/brand-bible.md) and the language convention from project.json, then enforces voice, tone by channel, lexicon and forbidden terms. Always invoke before publishing-facing copy.
hitl_level: 1
owner: owner
---

# Brand Voice

> Skill genérica: **no contiene la voz de ningún producto**. La voz vive en el contexto del proyecto activo y esta skill te dice cómo cargarla y aplicarla. Si el proyecto no tiene `brand-bible.md`, dilo y no inventes una voz.

## 1. Qué cargar (en este orden)

1. `projects/<slug>/brand-bible.md` — posicionamiento, personalidad, manifiesto, no-go zones, temas sensibles, crisis playbook. Si existe una sección de voz/lexicón, esa es tu fuente de verdad.
2. `project.json → languageConvention` — convención de idioma (tuteo/voseo/usted, variante regional, reglas de ortografía). Te llega interpolada en el prompt como `{{LANGUAGE_CONVENTION}}`; si no, léela del `project.json`.
3. `projects/<slug>/icp.md` (o la skill `customer-personas`) — a quién le hablas.
4. `projects/<slug>/glossary.md` — nombres canónicos de productos, planes y features (no inventes nombres).

## 2. Qué tiene que definir el brand-bible (checklist para el owner)

Si falta alguno de estos puntos, señálalo en tu respuesta como `TODO(acme):` para que el owner lo complete:

- **Qué somos** en 2-3 oraciones + contra qué competimos y en qué nos diferenciamos.
- **Personalidad de marca** (3-5 rasgos, con "somos X, no Y").
- **Tono base** y **adaptación por canal** (blog, email, push, ads, landing, soporte, crisis).
- **Lexicón**: palabras que SÍ usamos / palabras que NUNCA usamos (superlativos vacíos, promesas imposibles, jerga).
- **Variantes regionales** si el producto habla a varios países.
- **Reglas de estilo** (mayúsculas, números, emojis, longitud de oraciones, CTAs).
- **Ejemplos canónicos**: uno bueno largo, varios buenos cortos, uno malo con el porqué.

## 3. Cómo usar esta skill

1. Carga las fuentes de §1 completas antes de generar.
2. Identifica el canal (blog / email / push / ad / landing / soporte / crisis) y aplica la adaptación de tono del brand-bible.
3. Genera el draft respetando tono, lexicón y reglas de estilo.
4. **Antes de devolver, autoaudita**:
   - ¿Usé alguna palabra de la lista NUNCA?
   - ¿El tono coincide con el canal?
   - ¿Hay superlativos vacíos o promesas que el producto no puede cumplir?
   - ¿Respeté la convención de idioma de forma consistente (p. ej. tuteo sin slips de voseo, o al revés)?
   - ¿Estoy inventando datos (números sin fuente, testimonios sin origen)?
   - ¿La ortografía está completa? Tildes (también en MAYÚSCULAS y títulos) y signos de apertura `¿` `¡` si el idioma es español.
5. Si el output no pasa la auditoría, regenera antes de mostrarlo.

## 4. Reglas generales (valen para cualquier proyecto)

- Si un corpus, fuente o contenido existente viola la convención (sin tildes, otra variante regional), eso es un **error a corregir**, nunca un estilo a imitar.
- No prometas resultados garantizados. No afirmes superioridad que no puedas respaldar.
- Sin nombres de clientes, testimonios ni cifras que no estén documentados en el contexto del proyecto.
