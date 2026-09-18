# Alternativas a n8n y a Linear

El template usa **n8n** para disparar a los agentes y **Linear** como el lugar donde se les habla y donde dejan su trabajo. Ninguno de los dos es esencial para el método, pero no pesan lo mismo:

| Pieza | Qué hace en el sistema | Qué tan acoplada está | Esfuerzo para cambiarla |
|---|---|---|---|
| **n8n** | Solo **dispara** scripts: crons y el listener de comentarios. No tiene lógica propia. | Poco: 15 workflows que llaman a `scripts/*.ps1`. | **Bajo.** Cualquier scheduler llama a los mismos scripts. |
| **Linear** | Es el **tablero y el canal**: los agentes leen el hilo, comentan, crean issues con una convención fija. | Mucho: MCP, prompts, allowlists, resolución de proyecto, skills, docs (~80 archivos lo mencionan). | **Medio.** Es un port, pero mecánico: el patrón se mantiene igual. |
| **Claude Code** | Es el runtime de los agentes (`claude -p`). | Total. | No es intercambiable: el template está hecho para Claude Code. |

> Los fragmentos de código de este documento son **puntos de partida**, no piezas probadas del template. Revísalos y pruébalos (con `-DryRun` donde exista) antes de usarlos.

---

## 1. Sin n8n

n8n cumple dos funciones. Las dos se pueden reemplazar sin tocar ningún agente, porque lo que hace n8n es ejecutar una línea de comando.

### 1a. Los crons

Cada workflow de cron de `automation/n8n/` corre un comando como este (el cron está en la tabla de [`automation/n8n/README.md`](../automation/n8n/README.md)):

```
powershell -ExecutionPolicy Bypass -NoProfile -File "C:\agents\agent-team-template\scripts\run-skill.ps1" -Skill funnel-monitor -Project acme
```

Programa esa misma línea con lo que tengas a mano:

**Windows → Programador de tareas**

```powershell
# Cada 4 horas. /RU + /RP: corre aunque no haya sesión iniciada (pide la contraseña del usuario).
schtasks /Create /TN "agentes\acme-funnel-monitor" /SC HOURLY /MO 4 `
  /TR "powershell -ExecutionPolicy Bypass -NoProfile -File C:\agents\agent-team-template\scripts\run-skill.ps1 -Skill funnel-monitor -Project acme" `
  /RU TU_USUARIO /RP
```

Usa el usuario que hizo `claude login`: el runtime corre con su suscripción (ver `CLAUDE_USERPROFILE` en [`server-setup.md`](server-setup.md)).

**Linux / macOS → cron, systemd timers o launchd**

PowerShell 7 (`pwsh`) corre en Linux y macOS, pero los wrappers asumen Windows (rutas con `\`, PATH leído del registro). Tienes dos caminos: portar los wrappers a `pwsh` multiplataforma, o partir de `scripts/run-skill.sh`, que existe como referencia de bash. Con cualquiera de los dos, el crontab queda así:

```cron
0 */4 * * *  cd /opt/agent-team-template && ./scripts/run-skill.sh funnel-monitor >> audit/cron.log 2>&1
```

**GitHub Actions → `schedule`**

Útil si ya usas Actions. Necesita un **runner self-hosted** (la máquina con `claude login`, el repo del producto y los `.env`), porque los runners de GitHub no tienen nada de eso:

```yaml
on:
  schedule:
    - cron: "0 */4 * * *"   # en UTC
jobs:
  funnel-monitor:
    runs-on: [self-hosted, windows]
    steps:
      - run: powershell -ExecutionPolicy Bypass -NoProfile -File C:\agents\agent-team-template\scripts\run-skill.ps1 -Skill funnel-monitor -Project acme
```

Otras opciones que funcionan igual: Zapier, Make o Pipedream (si pueden llegar a tu máquina), o cualquier orquestador que ya uses.

### 1b. El listener de comentarios

El listener recibe el webhook de Linear, filtra y llama a:

```
scripts\respond-linear.ps1 -IssueId ACM-12 -AgentName numa -TeamId <uuid-del-team>
```

Lo que tienes que reproducir son **tres reglas**, las mismas que implementa el workflow (explicadas en [`automation/n8n/README.md`](../automation/n8n/README.md)):

1. Solo comentarios **nuevos** (no ediciones).
2. Que **no** empiecen con `🤖` (anti-loop: son respuestas de los propios agentes).
3. Que empiecen con `Nombre:` de un agente conocido (`^(Capi|Numa|Greta|Pico|Cody|Qualy|Daly|Leda|Alfred)\s*:`).

**Opción A — Polling (recomendada si no quieres exponer nada a internet).** Un script corre cada 1-2 minutos (con el Programador de tareas o cron), consulta a la API de Linear los comentarios creados desde la última corrida y llama al wrapper por cada uno que pase las tres reglas. Esquema en PowerShell:

```powershell
# poll-linear.ps1 — ESQUEMA: guarda la marca de tiempo de la última corrida y procesa lo nuevo.
$state = ".\audit\poll-linear.last"
$since = if (Test-Path $state) { Get-Content $state } else { (Get-Date).ToUniversalTime().AddMinutes(-5).ToString("o") }
$now   = (Get-Date).ToUniversalTime().ToString("o")

$query = @'
query($since: DateTimeOrDuration!) {
  comments(filter: { createdAt: { gt: $since } }, first: 50) {
    nodes { body issue { identifier team { id } } }
  }
}
'@
$body = @{ query = $query; variables = @{ since = $since } } | ConvertTo-Json -Depth 5
$res  = Invoke-RestMethod https://api.linear.app/graphql -Method Post -Body $body `
          -ContentType "application/json" -Headers @{ Authorization = $env:LINEAR_API_KEY }

foreach ($c in $res.data.comments.nodes) {
  if ($c.body.StartsWith("🤖")) { continue }
  if ($c.body -match '^(Capi|Numa|Greta|Pico|Cody|Qualy|Daly|Leda|Alfred)\s*:') {
    & .\scripts\respond-linear.ps1 -IssueId $c.issue.identifier -AgentName $Matches[1].ToLower() -TeamId $c.issue.team.id
  }
}
Set-Content $state $now
```

Cosas a resolver si lo llevas a producción: que dos corridas no se pisen (un lock file), qué pasa si una respuesta tarda más que el intervalo, y reintentos. El costo de esta opción es una demora de hasta un intervalo entre que comentas y el agente arranca.

**Opción B — Webhook propio.** Un servidor chico (Node, Python, lo que prefieras) recibe el webhook de Linear, **verifica la firma**, aplica las tres reglas y lanza el wrapper en segundo plano. Responde rápido: el webhook no puede esperar a que el agente termine. Requiere exponer un endpoint (o un túnel), que es justo lo que el diseño original evita.

**Opción C — Sin listener.** Llamas al agente a mano cuando lo necesitas:

```powershell
.\scripts\respond-linear.ps1 -IssueId ACM-12 -AgentName numa -Project acme
```

Pierdes la conversación por comentarios, pero conservas todo lo demás.

---

## 2. Sin Linear

Aquí sí hay que tocar el repo. El patrón no cambia (**el agente lee un hilo, comenta con su firma, crea ítems con una convención fija, una persona decide**); cambia la herramienta con la que lo hace.

### 2a. Qué depende de Linear

| Dónde | Qué hace con Linear | Qué cambias |
|---|---|---|
| `plugins/team-*/.mcp.json`, `scripts/alfred.mcp.json` | Servidor MCP `linear` | El MCP (o CLI) de tu tracker |
| `scripts/agents.ps1` | `AllowedTools` con `mcp__linear__*` y prompts que dicen "Linear", "issue", "team" | Las tools nuevas y el vocabulario de tu tracker |
| `scripts/respond-linear.ps1` | Recibe `-IssueId` y `-TeamId`, arma el prompt de turno | Una copia adaptada (p. ej. `respond-issue.ps1`) con los identificadores de tu tracker |
| `scripts/project.ps1` | `Resolve-ProjectSlugFromLinearTeamId` / `...TeamKey`: del team al proyecto | Una función equivalente (p. ej. repo → proyecto) |
| `projects/<slug>/project.json` | Bloque `linear` (workspace, teamKey, teamId) | El bloque de tu tracker |
| `memory/CLAUDE.md` → "Linear destination convention" | La convención de todo lo que crean los agentes | Traducir la convención (tabla abajo) |
| `scripts/run-*.ps1` y las skills | Textos del tipo "crea el issue en Linear, team X" | El texto equivalente |
| `automation/n8n/linear-feedback-listener.json` | El trigger de comentarios | El trigger de tu tracker (sección 1b) |

### 2b. La convención, traducida

Lo que importa de la convención no es Linear: es que **todo lo que crea un agente sea fácil de filtrar y no comprometa a nadie**. Así se traduce:

| Convención en Linear | GitHub Issues | Jira | Notion / ClickUp / Asana |
|---|---|---|---|
| Team del proyecto (`ACM`) | El repo del producto | El proyecto de Jira | La base / lista / proyecto |
| Label `agent-proposal` / `agent-report` | Los mismos labels | Los mismos labels | Una propiedad o tag |
| Estado `Backlog` | Sin milestone + columna *Backlog* de un Project (o label `backlog`) | Estado *Backlog* | Estado *Backlog* |
| Sin asignar, sin prioridad, sin cycle | Sin assignee, sin milestone | Sin assignee, prioridad por defecto, fuera del sprint | Igual |
| Título `[Proposal] ...` + 6 secciones | Igual (el cuerpo es Markdown) | Igual | Igual |
| Comentario firmado `🤖 Nombre Emoji:` | Igual | Igual | Igual |

### 2c. Recomendado: GitHub Issues

Si tu producto ya vive en GitHub, es la alternativa más natural: Cody ya usa `gh`, los issues quedan al lado del código y GitHub Actions puede hacer de listener y de cron a la vez (reemplaza también a n8n).

**Acceso de los agentes.** Dos opciones: el servidor MCP oficial de GitHub, o `gh` desde Bash con una allowlist acotada (por ejemplo `Bash(gh issue view:*),Bash(gh issue comment:*),Bash(gh issue create:*)` en lugar de `mcp__linear__*`). La segunda es más simple y más fácil de auditar.

**Listener con Actions** (en el repo donde viven los issues, con runner self-hosted):

```yaml
name: agentes
on:
  issue_comment:
    types: [created]
jobs:
  responder:
    # Solo comentarios del owner del repo, y nunca las respuestas de los agentes (anti-loop).
    if: >-
      github.event.comment.author_association == 'OWNER' &&
      !startsWith(github.event.comment.body, '🤖')
    runs-on: [self-hosted, windows]
    steps:
      - id: agente
        shell: pwsh
        env:
          BODY: ${{ github.event.comment.body }}   # por env, nunca interpolado en el script (evita inyección)
        run: |
          if ($env:BODY -match '^(Capi|Numa|Greta|Pico|Cody|Qualy|Daly|Leda|Alfred)\s*:') {
            "nombre=$($Matches[1].ToLower())" >> $env:GITHUB_OUTPUT
          }
      - if: steps.agente.outputs.nombre != ''
        shell: pwsh
        run: >-
          powershell -ExecutionPolicy Bypass -NoProfile
          -File C:\agents\agent-team-template\scripts\respond-issue.ps1
          -Repo "${{ github.repository }}"
          -IssueNumber ${{ github.event.issue.number }}
          -AgentName ${{ steps.agente.outputs.nombre }}
```

`respond-issue.ps1` no existe en el template: es la copia adaptada de `respond-linear.ps1` (paso 2 del checklist de abajo).

Dos advertencias de seguridad:

- **El filtro `author_association == 'OWNER'` no es opcional.** Sin él, cualquiera que pueda comentar en tu repo puede darle órdenes a tus agentes. Si el repo es público, lo más seguro es tener los issues de los agentes en un repo **privado** aparte.
- **Un runner self-hosted en un repo público es un riesgo conocido**: GitHub recomienda no usarlos ahí, porque un fork puede ejecutar código en tu máquina. Otra razón para el repo privado.

**Resolución de proyecto.** En lugar de `teamId`, el listener manda `owner/repo`; la función nueva busca en `projects/*/project.json` cuál tiene ese repo en `productRepoUrl` (o en un bloque `github` nuevo). Mantén la regla del original: si no matchea, **falla ruidoso**; nunca uses un proyecto por defecto en silencio.

### 2d. Otros trackers (Jira, ClickUp, Asana, Notion)

El mismo port que GitHub Issues: MCP del tracker en los `.mcp.json`, allowlists y vocabulario en `agents.ps1`, un `respond-<tracker>.ps1`, la función de resolución de proyecto y la convención traducida (tabla 2b). Para el listener, usa sus webhooks (opción B de 1b) o polling de su API (opción A).

### 2e. Slack (u otro chat)

Sirve para la **conversación** (`Numa: ¿cómo vino ayer?` en un canal, respuesta en el hilo), pero un chat no es un tablero: las propuestas se pierden en el scroll. Si vas por acá, combínalo con algo que persista: los agentes responden en Slack y crean las propuestas en un tracker (o como archivos en `queue/pending-review/`).

### 2f. Sin tracker

El mínimo absoluto: corres las skills a mano desde Claude Code y los agentes dejan su output en `queue/pending-review/` (esa cola ya existe en el template). Tú apruebas moviendo el archivo a `queue/approved/` o `queue/rejected/`. Pierdes la conversación y el historial compartido; conservas el método, el contexto y el HITL.

---

## 3. Checklist para portar de Linear a otro tracker

1. **Elige el acceso**: MCP del tracker o CLI con allowlist. Agrégalo a los `.mcp.json` que usen tus agentes y sus variables a `.env.<slug>` (y a `$ProjectScopedVars` en `scripts/project.ps1` si son por proyecto).
2. **Crea el wrapper de respuesta**: copia `scripts/respond-linear.ps1` como `respond-<tracker>.ps1`, cambia los parámetros (`-IssueId/-TeamId` → los de tu tracker) y el prompt de turno. Mantén la validación de parámetros vacíos o `undefined`: es la que evita que el agente responda "en el issue undefined".
3. **Resolución de proyecto**: agrega en `scripts/project.ps1` la función que va del identificador del tracker al slug, y el bloque correspondiente en `project.json`.
4. **Registro de agentes** (`scripts/agents.ps1`): reemplaza `mcp__linear__*` en cada `AllowedTools` y el vocabulario de los prompts. No toques las firmas `🤖 Nombre Emoji:`.
5. **Convención**: reescribe "Linear destination convention" en `memory/CLAUDE.md` con la tabla 2b.
6. **Wrappers de cron y skills**: busca `Linear` / `linear` en `scripts/` y `plugins/` y adapta cada texto.
7. **Listener y crons**: sección 1.
8. **Prueba sin riesgo**: `-DryRun` en los wrappers, después un issue de prueba con `Capi: hola`, y recién después activa los crons.
9. **Valida los `.ps1`** (deben parsear y quedar en UTF-8 con BOM; ver [`como-trabajo.md`](como-trabajo.md#detalles-técnicos-que-costaron-caro)).

**Atajo:** este checklist es exactamente el tipo de tarea que Claude Code hace bien. Abre el repo y pídele algo como:

> Porta este template de Linear a GitHub Issues siguiendo `docs/alternativas.md` §3. El repo de issues es `your-org/acme-agents` (privado). Usa `gh` con allowlist acotada en vez de un MCP. Muéstrame el plan antes de editar y valida que todos los `.ps1` parseen al final.

Y revisa el diff como revisarías un PR de Cody.
