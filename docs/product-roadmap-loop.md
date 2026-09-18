# Loop de mejora continua del producto

> **Qué es**: un volante semanal, por proyecto, donde el equipo de agentes **genera ideas de mejora de producto de forma proactiva** (sin esperar a que el owner las pida), Capi (PM/PO) las **prioriza y secuencia** en un plan persistente, y la ejecución se dispara siempre con una persona en el medio.

## Por qué existe

Sin este loop, Pico, Cody y Capi son **reactivos**: solo actúan cuando alguien comenta `<Nombre>:` en un issue de Linear. No hay generación proactiva de ideas ni un plan priorizado persistente; el único "plan" es el estado `Backlog` de Linear, triado a mano. Este loop cierra esa brecha sin perder nunca el **gate humano**.

## El loop (por proyecto)

```
  [señales: reportes de Numa, funnel, datos del producto, repo del producto]
        │
   ┌────┴───────────────┬────────────────────┐
   ▼                    ▼                    ▼
 Pico                 Cody                 Numa
 product-idea-scan    tech-debt-scan       funnel-monitor (extendido)
 (semanal)            (semanal, R-O)       (cada pocas horas)
 producto + datos     deuda técnica/DX     anomalía sostenida → propuesta
   │                    │                    │
   └──────► crean issues [Proposal] en Linear (team del proyecto) ◄──────┘
                        │
                        ▼
              Capi · pm-progress-review   (3 checks de avance por semana)
              - inventario de avance (propuestas, PRs en vuelo, mergeado, bloqueado)
              - reconcilia contra roadmap.md (el estado real de Linear manda)
              - re-prioriza (impacto × 1/esfuerzo vs. strategicFocus) y SECUENCIA
              - REESCRIBE projects/<slug>/roadmap.md  (único write, HARD STOP)
              - primer check de la semana: issue [Plan] · resto: [Report] de avance
                        │
                        ▼
              El owner revisa roadmap.md + el issue (Cowork / Linear)
              - conversa y aprueba: mueve el issue a Todo
              - para construir: comenta `Cody:` en el issue (MANUAL)
                        │
                        ▼
              Cody (respond-linear, manual) → abre PR → el owner revisa/mergea; Qualy hace QA
                        │
                        ▼
              próximo check: Capi reconcilia "hecho/en progreso" y vuelve a priorizar
```

Todo es **HITL 1**: solo lectura sobre producción; el único write de archivo es `roadmap.md` (de Capi). **No hay autonomía de ejecución**: ningún cron escribe código ni abre PRs. Cody solo construye cuando el owner lo invoca con `Cody:` sobre un issue aprobado.

## Roles, skills, wrappers y crons

| Agente | Rol en el loop | Skill | Wrapper | Cadencia sugerida | Modelo |
|--------|----------------|-------|---------|-------------------|--------|
| **Pico** 🎯 | Genera ideas de producto + datos | `product-idea-scan` | `run-skill.ps1` (loadout del registry) | semanal | Opus 4.8 |
| **Cody** 💻 | Detecta deuda técnica (SOLO LECTURA) | `tech-debt-scan` | `run-cody-scan.ps1` (dedicado, sin Edit/Write) | semanal | Sonnet 4.6 |
| **Numa** 📊 | Anomalía del funnel → propuesta | `funnel-monitor` (extendido) | `run-skill.ps1` | cada pocas horas | Sonnet |
| **Capi** 🫒 | Prioriza, secuencia, dueño del plan | `pm-progress-review` | `run-capi-roadmap.ps1` (dedicado, Write → `roadmap.md`) | lun/mié/vie | Opus 4.8 |
| **Pico** 🎯 | Reporte de qué se lanzó (changelog) | `product-shipped-digest` | `run-pico-shipped.ps1` (dedicado, solo lectura + git/gh) | viernes | Opus 4.8 |

Escalona los horarios para que dos corridas pesadas no compitan por los mismos rate limits (por ejemplo: idea-scan de madrugada, tech-debt-scan una hora después, el check de Capi a media mañana).

**Por qué wrappers dedicados** (Cody-scan, Capi, Pico-shipped): el loadout de esos agentes en `scripts/agents.ps1` lo comparte el listener interactivo de Linear (`respond-linear.ps1`). Capi necesita `Write` (acotado a `roadmap.md`) y Cody-scan necesita un loadout **de solo lectura**, capacidades que NO deben filtrarse a las respuestas casuales en Linear. Por eso esos wrappers **fijan** el loadout del modo y solo toman del registry la identidad y la firma. Pico corre el idea-scan con `run-skill.ps1` porque su loadout `creates-issues` ya sirve tal cual.

## El plan persistente: `projects/<slug>/roadmap.md`

Es la memoria del plan, versionada en git. **Capi es su único dueño**: lo reescribe en cada check. Pico, Cody y Numa solo lo LEEN (para no duplicar) y crean issues; nunca lo escriben.

- **Ledger**: `| id | título | fuente | tema/bet | impacto | esfuerzo | rank | status | <TEAM> | primera-vez | última-vez | nota |`
- **`id`** = slug estable de la mejora (clave del dedupe; se reusa entre corridas).
- **`status`**: `idea` (en el plan, sin issue) · `propuesto` (Backlog) · `aceptado` (Todo/In Progress) · `en-progreso` (PR abierto) · `hecho` (Done) · `hecho-parcial` · `wont-fix` (Canceled).
- **Regla de oro**: la disposición REAL vive en Linear — el estado del issue manda. Capi reconcilia el ledger contra Linear en cada corrida.

## Reporte semanal de "qué se actualizó en la app" (Pico)

Cierra el lazo: muestra qué de lo planeado **efectivamente se lanzó**. Es distinto del check de Capi (que prioriza el plan): esto es el **changelog / release notes** de la semana, para stakeholders.

- **Skill** `product-shipped-digest` (Pico), wrapper dedicado `run-pico-shipped.ps1` (solo lectura + Bash para `git log` / `gh`). Si tienes varios proyectos, escalona los horarios (por ejemplo, 30 minutos de diferencia) para no correr en simultáneo contra la misma suscripción.
- **Fuentes**: (1) commits de la semana en `origin/main` del repo del producto (`git fetch` + `git log --since="7 days ago"`), (2) opcional: PRs mergeados vía `gh`, (3) issues que pasaron a Done en Linear, (4) cruce contra `roadmap.md` (qué del plan avanzó / qué no estaba planificado / qué sigue pendiente). Pico NO reescribe `roadmap.md`.
- **Output**: un `[Report] Qué se actualizó en la app — semana <fecha>` en el team del proyecto, con las personas configuradas en `project.json → shippedDigestFollowers` como seguidoras (vía `subscriberIds`; si el MCP no lo soporta, @-mención que auto-suscribe).
- **Auth de git**: el wrapper inyecta `GH_TOKEN` como `http.https://github.com/.extraheader` (el mismo método que usa GitHub Actions) para que `git fetch` autentique un repo privado en headless.

## El gate humano (HITL)

1. Los agentes proponen → issues `[Proposal]` en `Backlog`, sin asignar (convención de `memory/CLAUDE.md`).
2. Capi prioriza y secuencia → issue `[Plan]` / `[Report]` + `roadmap.md` actualizado. **No cambia estados de issues ajenos.**
3. **El owner decide**: conversa en Linear/Cowork y mueve a `Todo` lo que aprueba.
4. **El owner dispara la ejecución**: comenta `Cody:` en el issue aprobado. Cody abre un PR; el owner revisa y mergea; Qualy hace QA del preview.

Ningún paso de ejecución es automático. El loop solo **propone y prioriza**.

## Correr a mano / validar

```powershell
# Resolución (no llama a claude): confirma agente, loadout, proyecto y ruta de roadmap.md
powershell -ExecutionPolicy Bypass -NoProfile -File scripts\run-skill.ps1 -Skill product-idea-scan -Project acme -DryRun
powershell -ExecutionPolicy Bypass -NoProfile -File scripts\run-capi-roadmap.ps1 -Project acme -DryRun
powershell -ExecutionPolicy Bypass -NoProfile -File scripts\run-cody-scan.ps1 -Project acme -DryRun

# Corrida real (escribe en Linear + queue/pending-review/ + roadmap.md en el caso de Capi)
powershell -ExecutionPolicy Bypass -NoProfile -File scripts\run-skill.ps1 -Skill product-idea-scan -Project acme
powershell -ExecutionPolicy Bypass -NoProfile -File scripts\run-cody-scan.ps1 -Project acme
powershell -ExecutionPolicy Bypass -NoProfile -File scripts\run-capi-roadmap.ps1 -Project acme
```

`run-capi-roadmap.ps1` detecta el día: lunes ⇒ `[Plan]` completo; cualquier otro día ⇒ `[Report]` de avance corto.

## Activación

- Crea los workflows de n8n de cada cron a partir de `automation/n8n/_template-skill-cron.json` (o de los wrappers dedicados), impórtalos inactivos, pruébalos con *Execute Workflow* y actívalos.
- Puedes activar el loop por partes: por ejemplo, solo el changelog de Pico en un proyecto nuevo y el loop completo cuando el proyecto madure. Las skills y los wrappers son agnósticos del proyecto: se prenden y apagan desde n8n sin tocar código.
- `pm-weekly-digest` (en `plugins/team-pm/`) es el antecesor de `pm-progress-review`: no actives los dos a la vez.

## Archivos

- Skills: `plugins/team-pm/skills/{product-idea-scan,tech-debt-scan,pm-progress-review,product-shipped-digest}/SKILL.md`
- Wrappers: `scripts/{run-capi-roadmap,run-cody-scan,run-pico-shipped}.ps1` (+ `run-skill.ps1` para el idea-scan de Pico)
- Plan: `projects/<slug>/roadmap.md`
- Numa: `plugins/team-growth/skills/funnel-monitor/SKILL.md` (anomalía → propuesta)
- Overrides: `projects/<slug>/agent-overrides/{capi,pico,cody}.md`
