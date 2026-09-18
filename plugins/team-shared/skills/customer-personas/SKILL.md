---
name: customer-personas
description: Use when generating customer-facing content, planning campaigns, prioritizing features, or analyzing user research for the active project. Loads the ICP and personas from projects/<slug>/icp.md (ICP one-liner, quantitative/qualitative criteria, personas, triggers, objections, anti-personas) and explains how to apply them.
hitl_level: 1
owner: owner
---

# Customer Personas

> Skill genérica: el ICP y las personas reales viven en `projects/<slug>/icp.md`. Esta skill define cómo cargarlos y aplicarlos. Si el proyecto declara en `strategicFocus` que un segmento está fuera de scope, no generes contenido ni propuestas para ese segmento.

## 1. Qué cargar

1. `projects/<slug>/icp.md` — ICP, segmentos, personas, triggers, objeciones, anti-personas.
2. `project.json → strategicFocus` — qué segmento prioriza hoy el proyecto.
3. `projects/<slug>/brand-bible.md` si vas a escribir copy (o la skill `brand-voice`).

## 2. Qué tiene que definir el ICP (checklist)

- **ICP one-liner**: quién, qué problema, en qué momento.
- **Criterios cuantitativos** (geografía, tamaño, seniority, presupuesto…) y **cualitativos** (motivación, contexto).
- **Personas** (2-4): nombre ficticio, contexto, objetivo, frustraciones, cómo nos encuentra, qué la hace pagar, qué la frena, cita representativa.
- **Triggers de compra** y **objeciones** — marcados como *hipótesis a validar* hasta que haya datos.
- **Anti-personas**: a quién NO le vendemos y por qué.

## 3. Cómo usar esta skill

- **Contenido / ads**: elige UNA persona objetivo por pieza y decláralo en el brief ("persona: Segmento B"). Escribe para su trigger y responde su objeción principal.
- **Priorización de features**: di qué persona se beneficia y cuánto pesa ese segmento según el ICP; si es un anti-persona, no la priorices.
- **Research**: al sintetizar feedback, mapea cada insight a una persona; si no encaja en ninguna, puede ser un segmento nuevo — propónlo, no lo inventes.
- Nunca uses datos personales reales de usuarios para construir o ilustrar personas.
