# docs/ — índice

Mapa de la documentación del template. El [README raíz](../README.md) es el punto de entrada general.

## Uso y operación

| Doc | Para qué |
|---|---|
| [`como-trabajo.md`](como-trabajo.md) | **Por qué está armado así**: el ciclo de trabajo, las lecciones detrás de cada regla y cómo empezar sin montar todo. |
| [`como-usar-los-agentes.md`](como-usar-los-agentes.md) | **Manual de uso**: cómo llamar a cada agente en Linear, aprobar/cancelar, qué corre solo por cron y los flujos canónicos. Empieza por aquí. |
| [`add-a-new-project.md`](add-a-new-project.md) | **Checklist** para sumar un proyecto al equipo de agentes (team de Linear + `projects/<slug>/` + `.env` + smoke tests). |
| [`server-setup.md`](server-setup.md) | Setup del **server headless** (Windows + n8n): Node + Claude Code CLI, keys, `.env.server`, smoke tests, importar workflows. |
| [`runtime-deployment.md`](runtime-deployment.md) | Modelo **conceptual** del runtime: loop HITL, por qué no hace falta exponer nada, secretos y billing. |
| [`architecture.md`](architecture.md) | Arquitectura del sistema de agentes (visión general y capas). |

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
