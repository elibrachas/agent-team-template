# docs/ — índice

Mapa de la documentación del template. El [README raíz](../README.md) es el punto de entrada general.

## Uso y operación

| Doc | Para qué |
|---|---|
| [`como-trabajo.md`](como-trabajo.md) | **Por qué está armado así**: el ciclo de trabajo, las lecciones detrás de cada regla y cómo empezar sin montar todo. |
| [`alternativas.md`](alternativas.md) | **Sin n8n o sin Linear**: cómo reemplazar el disparador (Programador de tareas, cron, GitHub Actions, polling) y portar el tablero a GitHub Issues u otro tracker. |
| [`como-usar-los-agentes.md`](como-usar-los-agentes.md) | **Manual de uso**: cómo llamar a cada agente en Linear, aprobar/cancelar, qué corre solo por cron y los flujos canónicos. Empieza por aquí. |
| [`../lead/README.md`](../lead/README.md) | **Project Lead**: el líder de proyecto que corre en tu máquina, ordena cada mañana lo que proponen los agentes y lleva las tareas aprobadas hasta producción. |
| [`add-a-new-project.md`](add-a-new-project.md) | **Checklist** para sumar un proyecto al equipo de agentes (team de Linear + `projects/<slug>/` + `.env` + smoke tests). |
| [`server-setup.md`](server-setup.md) | Setup del **server headless** (Windows + n8n): Node + Claude Code CLI, keys, `.env.server`, smoke tests, importar workflows. |
| [`secretos.md`](secretos.md) | **Secretos con 1Password + age** (`scripts/op-env.mjs`, `npm run env:*`): el esquema alternativo a los `.env` planos. |
| [`runtime-deployment.md`](runtime-deployment.md) | Modelo **conceptual** del runtime: loop HITL, por qué no hace falta exponer nada, secretos y billing. |
| [`architecture.md`](architecture.md) | Arquitectura del sistema de agentes (visión general y capas). |

## Fuentes de datos (solo lectura)

| Doc | Para qué |
|---|---|
| [`vercel-readonly-source.md`](vercel-readonly-source.md) | Deploys, build logs y errores de runtime de Vercel por un MCP propio que solo hace GET, con pin de proyectos por `project.json → vercel`. |
| [`mysql-readonly-source.md`](mysql-readonly-source.md) | Bases de producto que no son Supabase: MCP MySQL con usuario de GRANT por columna, sesión read-only y guard de SQL. |
| [`google-ads-readonly-source.md`](google-ads-readonly-source.md) | Gasto, clics y conversiones de Google Ads por el MCP oficial, con rol de solo lectura en la cuenta. CAC y ROAS. |

## Métodos

| Doc | Para qué |
|---|---|
| [`product-roadmap-loop.md`](product-roadmap-loop.md) | Loop semanal de mejora continua: agentes que generan propuestas y Capi que prioriza en `roadmap.md`. |
| [`alfred.md`](alfred.md) | Método de **Alfred** 🎩, el meta-agente que mejora a los otros agentes con PRs a este repo. |

## Reservados (vacíos)

- [`playbooks/`](playbooks/) — playbooks operativos de tu proyecto.
- [`runbooks/`](runbooks/) — runbooks de incidentes.

---

> Cómo mantener esto: cuando agregues un doc, súmalo a la tabla que corresponda. La identidad de los agentes vive en [`../scripts/agents.ps1`](../scripts/agents.ps1) + [`../memory/agents-roster.md`](../memory/agents-roster.md), no aquí.
