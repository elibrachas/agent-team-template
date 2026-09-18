# Arquitectura

Documento corto de visión. El detalle operativo de cómo corre y cómo se activa está en [`runtime-deployment.md`](runtime-deployment.md) y [`server-setup.md`](server-setup.md).

## Visión

Convertir cada área operativa de un producto en un loop con agentes que ejecutan, personas que aprueban las decisiones críticas y un sistema versionado que evoluciona como cualquier otra parte del producto.

## Multi-proyecto

El roster es UNO (core: `scripts/agents.ps1` + wrappers + listener). Cada proyecto es un bundle de configuración en `projects/<slug>/` (contexto de negocio + agent-overrides + skills + MCP + `.env.<slug>`). Los wrappers reciben `-Project <slug>`; el listener de Linear escucha todo el workspace y rutea por el `teamId` del webhook (o por el prefijo del identifier del issue). Las mejoras a un agente en el core impactan en todos los proyectos; lo específico del dominio nunca entra al core. Detalle: `projects/README.md` + [`add-a-new-project.md`](add-a-new-project.md).

## Capas

```
┌─────────────────────────────────────────────────────────────┐
│  Claude Code / Cowork desktop (máquina del owner)           │
│  - Exploración, decisiones, revisión de PRs                 │
│  - Mismo marketplace de plugins instalado                   │
└───────────────────────────┬─────────────────────────────────┘
                            │ git push / pull
                            ▼
                  ┌──────────────────────────┐
                  │  GitHub (privado)        │
                  │  agent-team-template     │
                  └──────────┬───────────────┘
                             │ git pull (sync-agents-repo.ps1)
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Server headless (Windows)                                  │
│                                                             │
│   ┌──────────┐    ┌────────────────────┐   ┌────────────┐  │
│   │   n8n    │───▶│  Claude Code CLI   │──▶│   Linear   │  │
│   │ (crons,  │    │  (claude -p ...)   │   │ (issues +  │  │
│   │ webhooks)│    │  + MCP por wrapper │   │ comentarios)│  │
│   └──────────┘    └─────────┬──────────┘   └────────────┘  │
│                             │                               │
│                             ▼                               │
│                  ┌────────────────────┐                     │
│                  │  queue/  audit/    │  (local, sin git)   │
│                  └────────────────────┘                     │
└─────────────────────────────────────────────────────────────┘
                             ▲
                             │ APIs (MCP)
            ┌────────────────┴────────────────┐
            ▼          ▼          ▼           ▼
       Supabase      GA4      Search      GitHub (PRs
      (read-only)             Console     de Cody/Alfred)
```

## Flujo típico (ejemplo: revisión SEO semanal)

1. **Lunes a la madrugada** — n8n dispara el cron `greta-seo-weekly`.
2. El workflow ejecuta `scripts\run-greta-seo.ps1 -Project acme`, que corre `claude -p` con la skill `seo-weekly-review` y su MCP config (GA4 + Search Console + Core Web Vitals + Supabase + Linear).
3. Greta cruza las fuentes, lee su memoria de semanas anteriores y crea un `[Report]` + hasta 3-5 `[Proposal]` en el team `ACM` de Linear.
4. El wrapper guarda un espejo del brief en `queue/pending-review/` y una línea de uso en `audit/`.
5. El owner revisa en Linear, aprueba lo que quiere (mueve a `Todo`) y, si hay que tocar código, comenta `Cody: implementa ACM-XX`.
6. Cody abre un PR en el repo del producto; Qualy testea el preview; el owner mergea.

## Decisiones que NUNCA se delegan

Ver `memory/CLAUDE.md` ("Reglas que no se rompen") y la brand bible del proyecto: mergear código, publicar sin ventana de cancelación, escribir en producción, gastar en ads y cambiar precios siempre pasan por una persona.
