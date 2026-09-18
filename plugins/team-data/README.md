# team-data

Skills de análisis sobre la base / warehouse del proyecto. En el proyecto de ejemplo la base de prod (Supabase Postgres) hace también de warehouse; si tienes uno separado, cambia el server en `.mcp.json` y documéntalo en `projects/<slug>/data-model.md`.

Todas las skills son **read-only** y trabajan con **agregados** (counts/sums/tasas). Nunca extraer PII individual.

## Ideas de skills (plantilla — ninguna incluida todavía)

| Skill | HITL | Notas |
|-------|------|-------|
| `signup-cohort-analysis` | 1 | Cohortes mensuales por canal de adquisición con conversión a pago |
| `arpu-by-acquisition` | 1 | Revenue medio por usuario pagador, por canal |
| `mrr-tracker` | 1 | MRR por plan, net new MRR semanal, ajustado por churn (si tu modelo es de suscripción) |
| `churn-monitor` | 1 | Churn mensual por cohorte + indicadores tempranos de uso |
| `unit-margin-analyzer` | 1 | Margen por unidad vendida: costo por llamada (IA, storage, terceros) vs precio |
| `anomaly-detector` | 1 | z-score sobre series clave: revenue, signups, tasa de éxito de features críticas, fallos de pago |

Las skills de monitoreo que hoy existen (`funnel-monitor`, `signup-to-paid-tracker`) viven en `team-growth` y las corre Numa 📊.

## Prerrequisitos

- `projects/<slug>/data-model.md` completo: tablas relevantes con su schema + queries canónicas + caveats.
- `projects/<slug>/glossary.md` completo: definiciones de métricas que matcheen las tablas.
- MCP de la base en modo read-only, configurado en `.mcp.json` (valores en `.env.<slug>`).

## Skills oficiales de Anthropic reutilizables

De `knowledge-work-plugins/data/` se pueden importar / referenciar:
- `analyze` — clasificación de preguntas.
- `write-query` — SQL agnóstico de warehouse.
- `build-dashboard` — HTML self-contained con Chart.js.
- `validate-data` — sanity checks antes de compartir.
