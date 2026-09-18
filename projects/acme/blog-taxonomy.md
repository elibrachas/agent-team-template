# Blog taxonomy — Acme (EJEMPLO)

> **Acme es un SaaS de ejemplo; reemplaza todo.** Set canónico de **categories** y **tags** que Leda 📖 elige para cada post. No inventar fuera de este set — si un post no encaja en ninguna categoría, marcarlo `needs_rework` con motivo "categoría no canónica: <propuesta>".
>
> Para ajustar: editas este archivo y la próxima corrida lo levanta. No requiere tocar código. Los nombres tienen que coincidir con los que existen en tu CMS.

## Categories (elegir EXACTAMENTE 1 por post)

_Guía_: 6-12 categorías mutuamente excluyentes, cada una con una línea de "para qué". Si un post abarca dos, se elige la más específica al ángulo principal.

| Category | Para qué |
|---|---|
| `Presupuestos` | _Ej._ Cómo armar, presentar y dar seguimiento a un presupuesto. |
| `Precios y cobros` | _Ej._ Cómo fijar tarifas, negociar, cobrar a tiempo. |
| `Gestión del negocio` | _Ej._ Organización, herramientas, productividad para freelancers y pymes. |
| `Conseguir clientes` | _Ej._ Prospección, portfolio, referidos. |

## Tags (elegir 3-5 por post, del set abajo)

_Guía_: tags más finos que se combinan, agrupados por eje. Mantén cada grupo corto.

### Por país / región
_Ej._ `argentina`, `mexico`, `espana`

### Por tipo de cliente
_Ej._ `freelancer`, `pyme`, `agencia`

### Por industria
_Ej._ `diseno`, `construccion`, `software`

### Por temática
_Ej._ `plantillas`, `negociacion`, `impuestos-basico`

### Por ángulo del post
_Ej._ `guia-paso-a-paso`, `errores-comunes`, `checklist`

## Tags excluidos (audiencia fuera de scope)

_Guía_: tags o temas que marcan contenido para una audiencia o línea de producto fuera del `strategicFocus` de `project.json`. Un draft con alguno de estos tags (o con el tema en el título) queda NO elegible para publicar. Mantén la lista sincronizada con la configuración del helper (`scripts/leda-helpers.ps1`).

- _Ej._ `enterprise`, `erp` (si el plan Enterprise está fuera de scope).

## Reglas de selección (Leda las sigue)

1. **1 category exacta** del set. Si el post no encaja: `needs_rework` con motivo.
2. **3-5 tags**, repartidos entre ejes (p. ej. 1 de tipo de cliente + 1-2 de temática + 1 de región si aplica).
3. **No combinar tags incompatibles** salvo que el post compare ambos explícitamente.
4. **Coherencia con la category**: los tags tienen que reforzar el ángulo de la category elegida.
5. **Priorizar lo regional**: si el post menciona un país explícitamente, agrega su tag.
6. **No inventar tags**. Si hace falta uno nuevo: `needs_rework` con motivo "tag necesario: <propuesta>". El owner decide si amplía el set.

## Mapeo category → familia visual (informativo, NO lo usa Leda)

_Guía_: opcional. Referencia humana de qué familias de `image-style-families.md` encajan con cada category. Leda elige la familia al azar con anti-repetición, así que esta tabla no condiciona la corrida.
