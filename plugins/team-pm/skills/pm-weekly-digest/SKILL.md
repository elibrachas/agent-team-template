---
name: pm-weekly-digest
description: Use when producing the weekly cross-project PM oversight digest — review every agent-generated Linear issue (agent-proposal / agent-report) across ALL project teams from the last week, reconcile what moved vs what's stalled, dedupe overlapping proposals, and deliver a prioritized digest so the owner decides in 5 minutes instead of triaging issue by issue. Read-only on Linear. Weekly [Report] in the ops home team (ACM).
hitl_level: 1
owner: owner
agent: capi
schedule: "0 11 * * 1"  # lunes 11:00 hora del server
inputs:
  - "linear (workspace your-workspace): issues con label agent-proposal / agent-report en TODOS los teams con projects/<slug>/project.json (ej. ACM)"
outputs:
  - "Linear (team home de ops, ej. ACM): issue semanal [Report] Digest de agentes — label agent-report, estado Backlog, sin asignar"
  - "queue/pending-review/YYYY-MM-DD-<project>-pm-weekly-digest.md (brief siempre)"
cost_budget_usd: 2.00
---

# pm-weekly-digest

> **⚠️ DEPRECADO — reemplazado por [`pm-progress-review`](../pm-progress-review/SKILL.md).** El loop de mejora continua (`docs/product-roadmap-loop.md`) hizo a Capi **per-project** y dueño de un plan persistente (`projects/<slug>/roadmap.md`), con 3 checks de avance por semana (lun/mié/vie) en vez de un digest semanal cross-proyecto. Esta skill queda como referencia; no la corras (su cron `core-pm-weekly-digest` se desactiva en n8n a favor de `<slug>-capi-progress`). Si quieres una línea de salud cross-proyecto, se agrega como sección en el `[Plan]` del lunes de `pm-progress-review`.

> **HITL 1 — read-only sobre Linear** (solo crea SU issue de digest). Es el meta-agente de oversight: el equipo genera reportes y propuestas toda la semana; este digest evita que se acumulen sin decisión. **Cross-proyecto por diseño** — es la única skill que mira todos los teams.

## Antes de correr

1. Lista los proyectos activos leyendo `projects/*/project.json` (ej. acme→ACM). El digest cubre TODOS sus teams.
2. Carga el foco estratégico de cada proyecto (campo `strategicFocus` del project.json) — las prioridades se juzgan contra eso, no en abstracto.

## Qué hacer (con el MCP de Linear)

1. **Inventario**: por cada team, lista los issues con label `agent-proposal` o `agent-report` **creados o actualizados en los últimos 7 días**, con su estado actual. Incluye también los `[Proposal]` viejos que sigan en Backlog (los estancados son el punto).
2. **Reconciliación**: clasifica cada uno —
   - ✅ **Avanzó**: el owner lo movió de Backlog / comentó / se implementó (PR mergeada referida en el thread).
   - 💤 **Estancado**: `[Proposal]` en Backlog sin ningún comentario humano. Anota la edad en días.
   - 🔁 **Duplicado/solapado**: dos propuestas que atacan lo mismo (típico: Greta y Pico proponen variantes de la misma mejora). Marca cuál es la mejor formulada.
   - 📊 **Solo informativo**: reports diarios/semanales sin acción pendiente — cuéntalos, no los listes uno por uno.
3. **Priorización** (lo más valioso): elige el **top 3 de propuestas estancadas que SÍ valen la pena** según el strategicFocus de cada proyecto, con una línea de por qué ahora. Y propón explícitamente **cuáles cerrar** (stale, superadas, o fuera de foco — lo que el `strategicFocus` declara fuera de scope) para que el backlog no sea un cementerio.
4. **Salud del sistema** (1 línea por proyecto): ¿los crons reportaron toda la semana? ¿algún agente generó ruido repetitivo que convenga ajustar?

## Output

- **Issue semanal en Linear**: team home de ops (el digest es uno solo aunque cubre todos los proyectos — ej. ACM), label `agent-report`, estado `Backlog`, sin asignar. Título `[Report] Digest semanal de agentes YYYY-MM-DD`. Body con secciones: `## Resumen ejecutivo` (3-5 líneas), `## Avanzó`, `## Top 3 para decidir esta semana`, `## Propuestas para cerrar`, `## Duplicados`, `## Salud del sistema`, `## Generado por`. Cada issue mencionado va con su identifier linkeable (`ACM-XX`).
- **Brief** = el mismo contenido (lo guarda el wrapper).
- **Dedupe**: si ya existe el digest de esta semana (busca por título), comenta ahí en vez de duplicar.

## Reglas

- NO cambies estado/label/asignación de NINGÚN issue ajeno — solo recomiendas; el owner ejecuta.
- NO repitas el contenido completo de cada propuesta: una línea + link. El digest se lee en 5 minutos o falló.
- Si una semana no hubo actividad de agentes, el digest es corto y lo dice — no infles.
- Juzga contra el `strategicFocus` del proyecto correspondiente (lo que declara fuera de scope no se prioriza).
