# team-growth

Plugin de Growth del equipo de agentes: SEO, AEO (aparecer en respuestas de asistentes de IA), monitoreo del funnel y conversión. Las skills son **genéricas**: todo lo que depende del producto (tablas, etapas del funnel, canales, URLs, tono) lo leen del contexto del proyecto activo en `projects/<slug>/`.

El foco de cada proyecto (qué segmento, qué canal, qué queda fuera de scope) se declara en `project.json → strategicFocus` y en los `agent-overrides/` — no aquí.

## Skills incluidas

| Skill | HITL | Frecuencia sugerida | Agente | Qué hace |
|-------|------|---------------------|--------|----------|
| `funnel-monitor` | 1 | Cada 4 h | Numa 📊 | Detección de anomalías (~2σ sobre 28 días) en cada etapa del funnel. Callada por default; solo abre un `[Alert]` (con dedupe en Linear) cuando algo se sale de rango. |
| `signup-to-paid-tracker` | 1 | Diario | Numa 📊 | Conversión free → paid por cohorte y canal, con n siempre al lado del %. |
| `seo-weekly-review` | 1 | Semanal | Greta 📈 | Cruza GA4 + Search Console (MCP propio `scripts/mcp-gsc/`) + Core Web Vitals + base + auditoría del frontend del repo → `[Report]` + hasta 3-5 `[Proposal]` (SEO). Memoria persistente en `seo-memory.md`. Audita/optimiza — nunca regenera contenido. |
| `aeo-weekly-review` | 1 | Semanal | Greta 📈 | Mide el canal de asistentes IA, audita la AEO-readiness del frontend (llms.txt, schema, extractabilidad, entidad) y prueba answer-engines vía WebSearch → `[Report]` + `[Proposal]` (AEO). Plan vivo en `aeo-strategy.md` + memoria en `aeo-memory.md`. Complementaria al SEO, no duplicada. |

Ideas de skills para sumar según tu proyecto (no incluidas): `ads-daily-brief`, `ads-fatigue-detector`, `budget-reallocator`, `landing-page-optimizer`, `email-lifecycle-monitor`, `content-brief-generator`, `weekly-growth-review`. Arranca siempre en HITL 1 (read-only + reporte) y sube de nivel cuando la skill demostró criterio.

## Configs de MCP

| Archivo | Quién lo usa | Servers |
|---------|--------------|---------|
| `.mcp.json` | Default de los agentes (`project.json → mcpConfig`) | supabase (read-only), linear, ga4, cwv, stripe, vercel (read-only, `scripts/mcp-vercel/`), google-ads (read-only, MCP oficial). En `_pending_no_correr`: mysql (read-only, `scripts/mcp-mysql/`) para productos con base MySQL |
| `seo.mcp.json` | `scripts/run-greta-seo.ps1` | supabase, linear, ga4, cwv, gsc |
| `aeo.mcp.json` | `scripts/run-greta-aeo.ps1` | supabase, linear, ga4 (+ WebSearch built-in) |
| `qa.mcp.json` | Qualy 🧪 (`mcpVariants.qa`) | linear, supabase, playwright, vercel (read-only) |
| `design.mcp.json` | Daly (`mcpVariants.design`) | linear, supabase, playwright |

Todos usan solo `${ENV_VAR}` (con `${ENV_VAR:-}` donde el server sabe degradar a "fuente no configurada"); los valores viven en `.env.server` + `.env.<slug>`. Un proyecto puede apuntar a sus propias variantes vía `project.json → mcpVariants`. Los wrappers propios en Node (`scripts/mcp-*`) piden `npm ci` en su carpeta una vez por máquina, y los que leen datos de producción son **read-only por diseño** (solo GET o una sola sentencia de lectura, salida redactada): el agente nunca recibe un token con el que pueda escribir.

## Dependencias

- `team-shared/skills/brand-voice` — todas las skills de contenido lo cargan primero (a su vez carga `projects/<slug>/brand-bible.md`).
- `team-shared/skills/glossary` — definiciones de métricas y etapas del funnel (`projects/<slug>/glossary.md`).
- `team-shared/skills/customer-personas` — targeting de contenido y ads (`projects/<slug>/icp.md`).
- `projects/<slug>/data-model.md` — tablas y queries canónicas para las skills de monitoreo.

## Frontmatter mínimo de cada SKILL.md

```yaml
---
name: <kebab-case-name>
description: Use when <trigger condition>. <Qué hace>.
hitl_level: 1 | 2 | 3
owner: <persona responsable>
agent: <agente que la corre>
schedule: <cron expr o "on-demand">
inputs: [lista de fuentes]
outputs: [lista de destinos]
cost_budget_usd: <máximo por ejecución>
---
```

## Coexistencia con automatizaciones existentes

Si ya tienes workflows (p. ej. en n8n) que generan contenido o reportes, documenta en el README de tu proyecto qué hace cada uno y diseña las skills para **coexistir** con ellos, no duplicarlos. Si un workflow existente hace mal un trabajo que un agente puede hacer con más contexto, reemplázalo explícitamente y apágalo (p. ej. un generador de drafts de blog que no mira lo publicado → el banco de ideas de Leda: `content-topic-scan` + `content-blog-publisher`).
