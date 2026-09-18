# Content references — Acme blog (EJEMPLO)

> **Acme es un SaaS de ejemplo; reemplaza todo.** Lista curada de fuentes para los **external authority links** que Leda 📖 inserta en los posts. Regla: ≥2 links externos de autoridad relevante por post, validados siempre con `validate-link` antes de incluirlos.

## Plataformas del sector

_Guía_: sitios de referencia del rubro de tu audiencia, agrupados por país/región si aplica. Solo sitios estables, con autor y fecha.

### _País A_
- _Ej._ `https://example.org/asociacion-de-freelancers` — asociación profesional del rubro.

### Regionales y globales
- _Ej._ `https://example.org/estudio-global` — informe anual del sector.

## Fuentes de data y autoridad

_Guía_: fuentes oficiales o académicas para respaldar cifras. Prefiere organismos estadísticos, organismos internacionales, universidades y research con metodología publicada.

### Estadísticas oficiales
- _Ej._ Instituto nacional de estadística de cada país.

### Research del sector
- _Ej._ Estudios de consultoras o universidades con metodología publicada.

### Instituciones educativas (.edu)
- _Ej._ Guías de centros de carrera o de emprendimiento universitarios.

## NO LINKEAR (competidores directos o baja calidad)

- Competidores directos (landings o pricing). Excepción opcional: un artículo de research puntual de su blog, citado como referencia.
- Content farms: sitios sin autor, sin fecha o sin fuentes propias.
- Sitios con promesas exageradas o prácticas dudosas.
- Sitios sin HTTPS.

## Reglas de aplicación

1. **2-3 external authority links por post**.
2. **Validar siempre con `validate-link` antes de incluir** — si da 404 o un redirect raro, descartar.
3. **`rel="noopener"`** siempre; `nofollow` opcional para plataformas comerciales.
4. **Variedad**: no repetir las mismas fuentes en todos los posts; rota entre alternativas equivalentes.
5. **Relevancia regional**: si el post menciona un país, prioriza fuentes de ese país.
6. **No linkear más de una vez a la misma URL** dentro del mismo post.
7. **Anchor descriptivo**, no genérico ("según el instituto de estadística, la tasa…" mejor que "según [esta fuente]").
