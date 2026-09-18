# Automatizaciones n8n — agent-team-template

Workflows de [n8n](https://n8n.io) que disparan las skills headless de los agentes (`claude -p`) en un server Windows y cierran el loop de feedback con Linear. Los conceptos y el modelo HITL están en `docs/server-setup.md` y `docs/runtime-deployment.md`.

n8n es el **único proceso que queda corriendo**: cada workflow es un cron (o un webhook de Linear) que ejecuta un script de PowerShell de `scripts/`. Los scripts cargan los secretos de `.env.server`, arman el prompt del agente y dejan el resultado en Linear y en `queue/pending-review/`.

Los workflows del repo usan el proyecto de ejemplo **Acme** (slug `acme`, team de Linear `ACM`). Cámbialos por el slug de tu proyecto.

## Workflows

Los workflows `core · ...` son del sistema (uno por instalación); los `acme · ...` son por proyecto (duplícalos por cada proyecto y cambia `-Project acme`).

| Archivo | Nombre en n8n | Qué hace | Trigger |
|---------|---------------|----------|---------|
| `linear-feedback-listener.json` | `core · linear-feedback-listener` | Responde en Linear cuando comentas `Nombre: ...` en un issue (ver abajo) | Webhook (Linear Trigger) |
| `core-health-check.json` | `core · health-check` | Health-check diario del sistema de agentes, sin LLM ($0). Crea un `[Alert]` en Linear si algo falla | `0 13 * * *` |
| `core-auth-probe.json` | `core · auth-probe` | Hace un `claude -p` real para detectar que el OAuth de Claude se cayó (el health-check diario no lo ve) | `0 6,10,14,18,22 * * *` |
| `sync-agents-repo.json` | `core · sync-agents-repo` | `git pull --ff-only` de la copia viva del repo de agentes, solo si el working tree está limpio. Sin LLM | `0 */3 * * *` |
| `core-pm-weekly-digest.json` | `core · pm-weekly-digest` | **Deprecado**: reemplazado por el loop de roadmap por proyecto (`scripts/run-capi-roadmap.ps1`). Se conserva como referencia; no lo actives | `0 11 * * 1` |
| `alfred-daily-sweep.json` | `acme · alfred-daily-sweep` | Alfred procesa las escalaciones con label `alfred` y, si amerita, abre un PR contra el repo de agentes | `0 7 * * *` |
| `signup-to-paid-tracker.json` | `acme · signup-to-paid-tracker` | Skill diaria de conversión free → paid (HITL-1) | `0 9 * * *` |
| `funnel-monitor.json` | `acme · funnel-monitor` | Vigila el funnel y alerta solo si hay una anomalía (HITL-1, Haiku) | `0 */4 * * *` |
| `leda-blog-publisher.json` | `acme · leda-blog-publisher` | Pule drafts del blog, genera imagen y programa la publicación (HITL-2 con ventana de cancelación) | `0 3 * * *` |
| `leda-publish-tick.json` | `acme · leda-publish-tick` | Publica los posts programados cuya hora ya pasó, salvo que se hayan cancelado (HITL-2, Sonnet) | `0 * * * *` |
| `qualy-prod-smoke.json` | `acme · qualy-prod-smoke` | Smoke test no destructivo de los flujos clave de producción | `0 9 * * 1` |
| `qualy-log-review.json` | `acme · qualy-log-review` | Revisión diaria de logs del backend; issue solo si hay un bug accionable | `0 8 * * *` |
| `greta-seo-weekly.json` | `acme · greta-seo-weekly` | Revisión SEO semanal (GA4 + Search Console + Core Web Vitals + frontend) → reporte y propuestas | `0 4 * * 1` |
| `greta-aeo-weekly.json` | `acme · greta-aeo-weekly` | Revisión AEO semanal (canal AI Assistant de GA4 + AEO-readiness del frontend) → reporte y propuestas | `0 4 * * 4` |
| `_template-skill-cron.json` | `__PROJECT__ · __SKILL__` | Template para automatizar una skill nueva (ver abajo) | `__CRON__` |

Cada JSON trae un campo `_uso_` con la explicación detallada del workflow (n8n lo ignora al importar). Los cron de las skills salen del `schedule:` del frontmatter de cada `SKILL.md`: si cambias uno, sincroniza ambos.

## Importar a n8n

1. En n8n: **Workflows → ⋯ → Import from File** → elige el JSON.
2. Los workflows entran **inactivos** (`active: false`). Pruébalos con **Execute Workflow** antes de activarlos.
3. Revisa lo que hay que configurar (sección siguiente).
4. Para que corran solos, activa el toggle **Active**.

### Qué tienes que configurar después de importar

- **Ruta del repo.** Todos los nodos *Execute Command* asumen el repo de agentes en `C:\agents\agent-team-template`. Si lo clonaste en otro lugar, reemplaza esa ruta en cada workflow (en el listener aparece con las barras escapadas: `C:\\agents\\agent-team-template`).
- **Proyecto.** Los workflows por proyecto pasan `-Project acme`. Cambia `acme` por el slug de tu proyecto (el de `projects/<slug>/project.json`) y renombra el workflow.
- **Zona horaria.** Cada workflow fija `settings.timezone` (`America/Argentina/Buenos_Aires` por defecto); esto pisa la TZ default de la instancia. Cámbiala por la tuya, o ajusta las expresiones cron.
- **Credencial de Linear** (solo el listener). Crea en n8n una credencial de tipo **Linear API** con tu `LINEAR_API_KEY` y asígnala al nodo `Linear Trigger` (en el JSON figura como `{"id": "REPLACE_ME", "name": "Linear API"}`; la UI te pide elegirla).
- **Team de Linear** (solo el listener). Reemplaza el `teamId` placeholder `00000000-0000-0000-0000-000000000000` por el UUID de tu team.
- **Execute Command habilitado.** En versiones recientes de n8n el nodo *Execute Command* puede venir deshabilitado por defecto (`NODES_EXCLUDE`); habilítalo en la instancia del server.
- **Entorno del proceso.** n8n debe correr bajo una cuenta con `node`, `git` y `claude` en el PATH, con Claude Code logueado, y con acceso al repo y a `.env.server`.

Los workflows cron no necesitan credenciales de n8n: los secretos (Linear, base de datos, GA4, etc.) los carga cada script desde `.env.server` / `.env.<slug>`.

## Cron (HITL-1): cómo funciona

`Schedule Trigger → Execute Command → NoOp`. El Execute Command llama, por ejemplo, a `scripts\run-skill.ps1 -Skill <skill> -Project <slug>`, que:

- carga `.env.server`, corre `claude -p` con los MCP que la skill necesita (lectura de datos + escritura en Linear),
- crea el issue en el team de Linear del proyecto y escribe el espejo del brief en `queue/pending-review/`,
- imprime el resultado y el `Costo USD` por stdout (queda en el log de ejecución de n8n).

Para abaratar, `funnel-monitor` pasa `-Model claude-haiku-4-5-20251001`. El tope de gasto por corrida es `PER_RUN_BUDGET_USD` de `.env.server` (`--max-budget-usd`). Un script que sale con código distinto de 0 deja la ejecución en rojo en n8n.

### Agregar una skill nueva al cron (`_template-skill-cron.json`)

1. Copia `_template-skill-cron.json` → `<proyecto>-<skill>.json`.
2. Reemplaza los tres placeholders:
   - `__PROJECT__` → slug del proyecto (p. ej. `acme`),
   - `__SKILL__` → nombre de la skill (el directorio de su `SKILL.md`),
   - `__CRON__` → expresión cron (el mismo valor que el `schedule:` del frontmatter).
3. Opcional: agrega `-Model claude-haiku-4-5-20251001` (u otro modelo) al final del command.
4. Borra el campo `_uso_` si quieres, importa y prueba con Execute Workflow.

## Feedback desde Linear: los 3 modelos

Que el agente "sepa que respondiste" tiene tres niveles. El template usa el 1 y el 2.

### 1. Pull vía MCP (siempre disponible, sin infra)

En su próxima corrida de cron, una skill puede leer comentarios y estado de un issue con el MCP de Linear (`list_comments`, etc.). Sirve para chequeos no urgentes ("¿el owner aprobó la propuesta de ayer?"). No es en tiempo real.

### 2. Push vía webhook (`linear-feedback-listener.json`), en tiempo real

Cuando comentas en un issue de un team con listener, Linear dispara un webhook → el **Linear Trigger** de n8n lo recibe → el nodo **IF** decide si es un llamado a un agente → n8n corre `scripts\respond-linear.ps1 -IssueId <id> -AgentName <nombre> -TeamId <uuid>` → el script resuelve el proyecto por el `TeamId`, carga el system prompt de ese agente desde el registry (`scripts\agents.ps1`), el agente lee el hilo del issue por MCP, consulta datos si hace falta y deja **un comentario que empieza con `🤖 <Nombre> <Emoji>:`**.

#### La regex que enruta los comentarios

El nodo IF evalúa esta expresión:

```js
$json.action === 'create'
  && /^(Capi|Numa|Greta|Pico|Cody|Qualy|Daly|Leda|Alfred):/i.test(($json.data.body || '').trim())
  && !($json.data.body || '').trim().startsWith('🤖')
```

- `$json.action === 'create'`: solo comentarios nuevos (editar un comentario no vuelve a disparar al agente).
- `^(...)`: el nombre del agente tiene que estar **al principio** del comentario (tras quitar espacios). Mencionar a "Greta" en medio de una frase no dispara nada.
- `(Capi|Numa|...|Alfred)`: la lista cerrada de agentes del roster. Un nombre que no está en la lista no dispara nada.
- `:` pegado al nombre: `Greta: ...` dispara; `Greta ...` o `Greta, ...` no.
- `/i`: no distingue mayúsculas (`greta:` también funciona).
- `!startsWith('🤖')`: excluye las respuestas de los propios agentes (anti-loop, ver abajo).

El nodo Execute Command vuelve a aplicar la misma regex con `.match(...)` para extraer el nombre (grupo 1) y lo pasa en minúsculas como `-AgentName`; si por algún motivo no matchea, cae a `capi` (el PM, que enruta). Además resuelve el `-IssueId` con fallback (`data.issue.identifier`, legible tipo `ACM-12`, o `data.issueId`, UUID) y agrega `-TeamId` si el payload lo trae.

**Cómo lo usas:** empiezas el comentario con el nombre del agente y dos puntos. Ejemplos:

- `Capi: ¿qué debería mirar primero hoy?` (PM, enruta)
- `Numa: ¿de qué tabla sale ese número?` (data)
- `Greta: ¿cómo está el checkout esta semana?` (growth)
- `Pico: convierte el último insight de Numa en propuesta` (product)
- `Cody: estima el alcance del [Proposal] ACM-23` (code)
- `Qualy: prueba el preview del PR de ACM-23` (QA tester: corre tests y browser, reporta PASS/FAIL)
- `Daly: haz un mockup del empty state del dashboard` (UX/UI designer: deja HTML + brief en `design/`)
- `Leda: stop ACM-42` o `Leda: mejora el post <uuid>` (content expert: cancela una publicación programada o pule un post puntual)
- `Alfred: el agente X no debería hacer Y` (meta-agente: propone un cambio al repo de agentes vía PR)

Roster completo en `memory/agents-roster.md`.

**Por qué `<Nombre>:` y no `@`:** Linear usa el `@` para abrir el selector de mentions de usuarios, así que no se puede tipear `@agente` como palabra clave literal. El nombre + `:` es el reemplazo limpio y además deja claro a quién le hablas.

**Por qué el prefijo `🤖 <Nombre> <Emoji>:` en la respuesta:** el agente comenta con **tu** API key, así que sus comentarios figuran como tuyos. No se puede distinguir "tú vs. agente" por autor; si respondiera a todo, entraría en loop. Doble red anti-loop: el trigger lo invocas de forma explícita (`Nombre:`) y el bot se autoexcluye con el `🤖`.

**Varios proyectos:** el nodo Linear Trigger obliga a elegir UN team, así que hay un trigger por team, todos conectados al mismo IF. Para sumar un proyecto: duplica el nodo trigger, elige el team nuevo y conéctalo al IF. `respond-linear.ps1` resuelve el proyecto por el `-TeamId` (declarado en `projects/<slug>/project.json`) o, como fallback, por el prefijo del identifier.

**Para agregar o renombrar un agente:** ver "Cómo agregar / cambiar / renombrar un agente" en `memory/agents-roster.md`. Son varios lugares que tienen que coincidir: el registry en `scripts\agents.ps1`, **las dos regex de `linear-feedback-listener.json`** (la del IF y la del Execute Command), la doc en `memory/agents-roster.md` y el índice en `MEMORY.md`.

**Verificación al importar:** toca **Listen for test event** en el trigger, comenta en un issue y verifica que los campos del payload real coincidan con `data.body`, `data.issue.identifier` y `data.issue.teamId`. Si tu versión del nodo los nombra distinto, ajusta el IF y el Execute Command. Después de activar, revisa en Linear → Settings → API → Webhooks que no quede un webhook huérfano de una importación anterior (causa respuestas duplicadas).

### 3. Linear Agents API (fase futura: mencionar de verdad)

Para que el agente sea un **miembro del team** al que mencionas (`@nombre-del-agente`) o al que **asignas** issues, hay que registrarlo como app con los scopes `app:mentionable` / `app:assignable`. Linear crea entonces una *AgentSession* y dispara eventos de webhook propios. Requiere una OAuth app + un handler, bastante más que el Bearer token actual. Cuando el volumen lo justifique, este listener puede migrar a consumir `AgentSessionEvent`.

Refs: [Linear for Agents](https://linear.app/developers/agents) · [Agent Interaction](https://linear.app/developers/agent-interaction) · [Webhooks](https://linear.app/developers/webhooks) · [MCP server](https://linear.app/docs/mcp).

## El JSON del repo vs. el workflow vivo

Estos JSON son la **fuente versionada** de los workflows, pero el workflow que corre en n8n puede **divergir**: cualquier cambio hecho en la UI (una credencial, un team, un ajuste de payload) vive solo en la instancia hasta que lo exportes.

- Evita editar en la UI. Si lo haces, **re-exporta** el workflow y pisa el JSON del repo para no perder el cambio.
- **Antes de re-importar un JSON sobre un workflow que ya está vivo**, exporta la versión live desde la UI, compárala con la del repo y aplica el diff mínimo. Importar encima sin comparar puede borrar la credencial, el team o ajustes hechos a mano, y en el caso del listener dejar webhooks duplicados en Linear.
- Al exportar desde n8n, quita los datos propios de tu instancia antes de commitear (`meta.instanceId`, `id`, `versionId`, `webhookId`, ids de credenciales, `pinData`) si el repo es público.

## Notas

- Nada de esto expone el repo de agentes al exterior: lo único que recibe tráfico entrante es n8n (el webhook de Linear), que necesita un túnel o una URL pública.
- `sync-agents-repo` mantiene al día la copia viva del repo en el server; si trabajas con WIP sin commitear en esa copia, el sync se saltea hasta que la limpies.
