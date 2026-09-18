# team-pm

Pipeline: insight (de data) → propuesta priorizada → roadmap → spec listo para implementar. El humano siempre está entre el plan y la ejecución.

## Skills incluidas

| Skill | HITL | Agente | Qué hace |
|-------|------|--------|----------|
| `product-idea-scan` | 1 | Pico 🎯 | Scan semanal proactivo: propone mejoras de producto cruzando datos + repo, con dedupe contra el roadmap. |
| `tech-debt-scan` | 1 | Cody 💻 | Scan semanal read-only de deuda técnica → hasta 3-5 `[Proposal]` de ingeniería. |
| `pm-progress-review` | 1 | Capi 🫒 | Reconcilia `projects/<slug>/roadmap.md` contra Linear, re-prioriza y reescribe el ledger (único archivo que escribe). |
| `pm-weekly-digest` | 1 | Capi 🫒 | Resumen semanal del estado del plan. |
| `product-shipped-digest` | 1 | Pico 🎯 | Digest de lo shipeado, con seguidores configurables (`project.json → shippedDigestFollowers`). |

El loop completo está documentado en `docs/product-roadmap-loop.md`.

## Destino Linear

Team del proyecto (`project.json → linear.teamKey`, en el ejemplo **ACM**). Convención completa en `memory/CLAUDE.md` sección "Linear destination convention". Resumen:

- Crear issue con label `agent-proposal`, state `Backlog`, sin asignar, sin priority, sin cycle.
- Título: `[Proposal] <cambio en imperativo neutro>`.
- Body: secciones fijas (Contexto, Hipótesis, Propuesta, Métrica de éxito, Riesgos, Generado por).
- Si el spec es ambiguo o requiere >5 días de dev → NO ir directo a Linear; dejarlo como draft en `queue/pending-review/` o escribir un PRD primero.

## MCPs

Declarados en `.mcp.json` del plugin (valores por env var):

- **Linear** — `https://mcp.linear.app/mcp` con `LINEAR_API_KEY` como Bearer (sirve headless).
- **Notion** — `https://mcp.notion.com/mcp` con `NOTION_TOKEN`. Para PRDs largos (opcional).
- **Slack** — bot token (`SLACK_BOT_TOKEN`), para notificar cuando se crea una propuesta (opcional).

## Skills oficiales de Anthropic reutilizables

De `knowledge-work-plugins/product-management/`:
- `metrics-review` — base del review semanal.
- `write-spec` — base de un template de PRD.
- `synthesize-research` — feedback de soporte / reviews / encuestas.
- `brainstorm` — uso interactivo.
