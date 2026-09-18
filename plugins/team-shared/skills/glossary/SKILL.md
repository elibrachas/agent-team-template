---
name: glossary
description: Use when discussing the active project's products, surfaces, terminology, metrics, funnel stages, payment states, user segments, or any term where a generic interpretation might miss internal nuance. Loads projects/<slug>/glossary.md. Especially important for data, growth and PM skills.
hitl_level: 1
owner: owner
---

# Glosario del proyecto

> Skill genérica: el glosario real vive en `projects/<slug>/glossary.md`. Esta skill te dice cuándo cargarlo y cómo usarlo. **Si una métrica o término no está en el glosario, no lo expongas en un output con una definición inventada**: usa la definición más conservadora, decláralo explícitamente y propón agregarlo.

## 1. Qué cargar

1. `projects/<slug>/glossary.md` — definiciones canónicas.
2. `projects/<slug>/data-model.md` — de qué tabla/evento sale cada métrica (cuando vas a calcular algo).

## 2. Qué tiene que definir el glosario (checklist)

- **Productos y surfaces**: nombre canónico de cada producto, plan, feature y página clave.
- **Métricas core**: definición exacta (numerador, denominador, ventana, filtros — p. ej. "solo pagos con monto > 0", "monedas por separado").
- **Canales de adquisición**: buckets canónicos y cómo se derivan.
- **Funnel comercial**: etapas en orden, con el evento/campo que marca cada una.
- **Estados de pago** y qué cuenta como venta.
- **Segmentos de usuario** (free, pagador, recurrente, etc.).
- **Convenciones internas**: zona horaria, moneda, redondeos, cómo se nombran cosas en Linear.

## 3. Cómo usar esta skill

1. Antes de reportar una métrica, busca su definición en el glosario y cítala (o linkéala) en el output.
2. Si dos fuentes dan números distintos para "lo mismo", revisa si el glosario aclara cuál es la canónica; si no, explica la diferencia, no promedies.
3. Siempre reporta el **n** al lado de un porcentaje.
4. Si detectas un término ambiguo o faltante, sugiere la entrada nueva en tu respuesta (el owner decide si la agrega).
