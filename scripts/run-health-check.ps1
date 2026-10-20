# Health-check del sistema de agentes — PowerShell + un probe mínimo de auth.
#   uso:  powershell -ExecutionPolicy Bypass -NoProfile -File scripts\run-health-check.ps1
#         ... -AuthOnly  (SOLO el probe de auth + cluster de errores; liviano, para el cron cada 4h)
#         ... -DryRun    (corre los checks pero NO crea issue en Linear)
#
# Detecta el modo de falla silencioso (ej. listener roto, o el OAuth de Claude deslogueado,
# que puede dejar al roster sin correr durante días SIN alarma):
#   0. AUTH PROBE: un `claude -p "OK"` real (haiku, ~3s, $0 con suscripción) — detecta el logout de
#      OAuth, que `claude --version` NO ve (la versión imprime igual deslogueado).  [SIEMPRE]
#   0b. Cluster de errores: 3+ corridas con is_error en las últimas 6h (ventana móvil, NO
#       "últimas N") → en el check FULL es problema; en -AuthOnly es solo info.       [SIEMPRE]
#   1. claude CLI responde (--version).                              [solo full, no -AuthOnly]
#   2. .env.server existe; .env.<slug> existe para cada proyecto.                        [full]
#   3. projects\*\project.json tienen linear.teamId completo.                           [full]
#   4. Frescura de crons: cada cron esperado dejó su brief en queue\pending-review\
#      dentro de su ventana (diario = hoy o ayer; semanal = últimos 8 días).            [full]
#   5. Cola estancada: briefs de hace más de 7 días sin mover (informativo).            [full]
#   6. audit\: hubo corridas con timed_out=true ayer/hoy (informativo).                 [full]
#   7. Tick diario de Leda, contra la hora del último tick de cada proyecto: falta su brief
#      (no corrió) o un post que vencía antes de ese tick sigue sin publicar (corrió y no
#      lo publicó, ej. con un modelo que no ejecutaba PowerShell).                     [full]
# Si hay problemas → crea UN issue [Alert] en el team Linear del proyecto de ops (-OpsProject;
# vía GraphQL directo, label agent-report, estado Backlog, ASIGNADO al dueño de la LINEAR_API_KEY
# para que le llegue el push) y sale con exit 1 (n8n rojo).
# El probe de auth usa las MISMAS credenciales que los agentes (OAuth de CLAUDE_USERPROFILE).
param(
  [switch]$DryRun,
  [switch]$AuthOnly,
  [string]$OpsProject = 'acme'   # proyecto "home de ops": en su team de Linear se crean los [Alert]
)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

# Cargar .env.server (LINEAR_API_KEY para el alert; CLAUDE_USERPROFILE para el probe).
. "$PSScriptRoot\project.ps1"
if (Test-Path ".\.env.server") { Import-EnvFile ".\.env.server" }

# Espejo del entorno de los wrappers, para que el AUTH PROBE pruebe EXACTAMENTE el mismo
# camino de credenciales que usan los agentes headless (OAuth, no API key). Sin esto el
# probe testearía un store de credenciales distinto al de las corridas reales. Ver run-skill.ps1.
$env:PATH = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:ANTHROPIC_AUTH_TOKEN -ErrorAction SilentlyContinue
if ($env:CLAUDE_USERPROFILE) {
  $env:USERPROFILE = $env:CLAUDE_USERPROFILE
  $claudeBin = Join-Path $env:CLAUDE_USERPROFILE '.local\bin'
  if (Test-Path $claudeBin) { $env:PATH = "$claudeBin;$env:PATH" }
}

# --- Crons esperados (actualiza esta tabla cuando agregues/quites crons) ---
# Pattern matchea nombre viejo (sin slug) y nuevo (con slug) en queue\pending-review.
# TODO(acme): reemplaza estos ejemplos por los crons que realmente programaste en n8n.
$ExpectedCrons = @(
  @{ Name = 'signup-to-paid-tracker'; Project = 'acme'; CadenceDays = 1 },
  @{ Name = 'funnel-monitor';         Project = 'acme'; CadenceDays = 1 },
  @{ Name = 'pm-weekly-digest';       Project = 'acme'; CadenceDays = 8 }
)

# --- Ticks de Leda activos en n8n (content-blog-publish-tick, una vez por día) ---
# TickHour = hora local del server a la que corre el tick vivo de cada proyecto. El check 7
# compara contra el ÚLTIMO tick: el de hoy si ya pasó (más $TickGraceMin para que termine), si no
# el de ayer. Cada proyecto tiene su hora porque su publisher también: si la nota vence después
# del tick, sale con el tick del día siguiente; si vence antes, sale ese mismo día.
# Suma el proyecto cuando actives el tick de otro.
# TODO(acme): deja aquí solo los proyectos cuyo tick de Leda programaste en n8n, con su hora real.
$TickProjects = @(
  @{ Slug = 'acme'; TickHour = 8 }
)
$TickGraceMin = 30

$problems = @()
$infos = @()

# --- 0. AUTH PROBE (SIEMPRE) -------------------------------------------------
# El check que faltaba: un `claude -p` real contra OAuth. `claude --version` (check 1)
# responde igual deslogueado, así que NO veía el logout. Esto sí. Mínimo: haiku, sin MCP
# (--strict-mcp-config sin --mcp-config = cero servers), budget 1, ~3s, $0 con suscripción.
try {
  $probeStart = Get-Date
  $probeJson = "" | claude -p "Responde unicamente con la palabra OK." `
    --output-format json --model claude-haiku-4-5 `
    --strict-mcp-config --permission-mode dontAsk --allowedTools "Read" --max-budget-usd 1
  $probeDur = [math]::Round(((Get-Date) - $probeStart).TotalSeconds)
  $probe = $null; try { $probe = $probeJson | ConvertFrom-Json } catch {}
  if (-not $probe) {
    $raw = ($probeJson | Out-String).Trim(); if ($raw.Length -gt 400) { $raw = $raw.Substring(0, 400) + '…' }
    $problems += "AUTH: claude -p no devolvió JSON (posible OAuth deslogueado / CLI roto). Vuelve a iniciar sesión en el server: 'claude /login' bajo el user real. Salida: $raw"
  } elseif ($probe.is_error) {
    $problems += "AUTH: claude -p devolvió is_error=true (subtype=$($probe.subtype)). Si menciona login/credit/auth → vuelve a iniciar sesión: 'claude /login'. result: $($probe.result)"
  } else {
    $infos += "auth probe OK ('$($probe.result)', ${probeDur}s)"
  }
} catch {
  $problems += "AUTH: el probe de claude -p tiró excepción: $($_.Exception.Message). Revisa login/CLI en el server."
}

# --- 0b. Cluster de errores RECIENTES en el audit (SIEMPRE) ------------------
# Cae algo sistémico ENTRE probes (auth u otro) → varias corridas reales fallan en poco tiempo.
# Ventana TIME-bounded = últimas 6h (> el intervalo de 4h del probe, para no perder fallos entre
# corridas). A propósito por TIEMPO y NO "últimas N corridas": así un apagón YA resuelto envejece
# y no deja el cron en rojo para siempre. Es PROBLEMA solo en el check FULL (diario); en -AuthOnly
# es INFO — el cron de auth tiene que estar rojo SOLO si la auth está caída, no por fallos viejos
# que ya conoces (para esos está recover-failed-runs.ps1 + el escalado del check diario).
$clusterWindowH = 6
$cutoff = (Get-Date).AddHours(-$clusterWindowH)
$recentErr = 0; $recentTotal = 0
foreach ($i in 0, 1) {  # hoy + ayer (la ventana de 6h puede cruzar medianoche)
  $af = "audit\$((Get-Date).AddDays(-$i).ToString('yyyy-MM-dd')).jsonl"
  if (-not (Test-Path $af)) { continue }
  foreach ($ln in (Get-Content $af)) {
    if ([string]::IsNullOrWhiteSpace($ln)) { continue }
    $e = $null; try { $e = $ln | ConvertFrom-Json } catch { continue }
    $t = $null; try { $t = [datetime]$e.ts } catch { continue }
    if ($t -lt $cutoff) { continue }
    $recentTotal++
    if ($e.is_error) { $recentErr++ }
  }
}
if ($recentErr -ge 3 -and -not $AuthOnly) {
  $problems += "Cluster de fallos: $recentErr corridas con is_error en las últimas ${clusterWindowH}h (de $recentTotal). Posible apagón sistémico — corre scripts\recover-failed-runs.ps1 para ver/re-correr."
} elseif ($recentErr -gt 0) {
  $infos += "$recentErr de $recentTotal corridas con is_error en las últimas ${clusterWindowH}h (recuperables: scripts\recover-failed-runs.ps1)"
}

# En -AuthOnly cortamos aquí: el cron liviano de cada 4h solo mira auth + cluster.
if (-not $AuthOnly) {
  # 1. claude CLI
  try {
    $v = (claude --version) 2>&1 | Select-Object -First 1
    $infos += "claude CLI: $v"
  } catch {
    $problems += "claude CLI no responde a --version: $($_.Exception.Message)"
  }

  # 2-3. envs + project.json
  if (-not (Test-Path ".\.env.server")) { $problems += ".env.server no existe" }
  Get-ChildItem "projects\*\project.json" | ForEach-Object {
    $p = Get-Content $_.FullName -Raw | ConvertFrom-Json
    if (-not $p.linear.teamId) { $problems += "projects\$($p.slug)\project.json sin linear.teamId (el listener no puede rutear ese team)" }
    if (-not (Test-Path ".\$($p.envFile)")) {
      $problems += "$($p.envFile) no existe — los crons de $($p.slug) van a correr solo con lo que haya en .env.server"
    }
  }

  # 4. Frescura de crons
  foreach ($cron in $ExpectedCrons) {
    $found = $false
    for ($i = 0; $i -lt $cron.CadenceDays + 1; $i++) {
      $d = (Get-Date).AddDays(-$i).ToString('yyyy-MM-dd')
      $hits = @(Get-ChildItem "queue\pending-review\$d-*$($cron.Name).md" -ErrorAction SilentlyContinue) +
              @(Get-ChildItem "queue\pending-review\$d-$($cron.Name).md" -ErrorAction SilentlyContinue)
      if ($hits.Count -gt 0) { $found = $true; break }
    }
    if (-not $found) {
      $problems += "Cron '$($cron.Project) · $($cron.Name)' sin brief en los últimos $($cron.CadenceDays + 1) días — ¿el workflow de n8n está activo y corriendo?"
    }
  }

  # 5. Cola estancada (informativo, no falla)
  $stale = @(Get-ChildItem "queue\pending-review\*.md" -ErrorAction SilentlyContinue |
             Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) })
  if ($stale.Count -gt 0) { $infos += "$($stale.Count) briefs de más de 7 días en queue\pending-review (revisar/archivar)" }

  # 6. Timeouts recientes (informativo)
  foreach ($i in 0..1) {
    $d = (Get-Date).AddDays(-$i).ToString('yyyy-MM-dd')
    $auditFile = "audit\$d.jsonl"
    if (Test-Path $auditFile) {
      $timeouts = @(Get-Content $auditFile | Where-Object { $_ -match '"timed_out":\s*true' })
      if ($timeouts.Count -gt 0) { $infos += "$($timeouts.Count) corridas con TIMEOUT en $d (ver $auditFile)" }
    }
  }

  # 7. Tick diario de Leda, contra el ÚLTIMO tick de cada proyecto (hoy a su TickHour si ya pasó,
  #    con $TickGraceMin para que termine; si no, el de ayer):
  #    7a. su brief de ese día en queue\pending-review\. Si falta, el tick no corrió (o falló
  #        antes de escribirlo).
  #    7b. los posts programados que vencían antes de ese tick y siguen sin publicar: el tick
  #        corrió y no los publicó. 7a no alcanza: el wrapper escribe el brief aunque el agente
  #        falle. Si el helper no responde, 7b queda como info y no como problema.
  $nowLocal = Get-Date
  foreach ($tick in $TickProjects) {
    $slug = $tick.Slug
    $lastTick = $nowLocal.Date.AddHours($tick.TickHour)
    if ($nowLocal -lt $lastTick.AddMinutes($TickGraceMin)) { $lastTick = $lastTick.AddDays(-1) }
    $tickLabel = $lastTick.ToString('yyyy-MM-dd HH:mm')

    $briefFile = "queue\pending-review\$($lastTick.ToString('yyyy-MM-dd'))-$slug-content-blog-publish-tick.md"
    if (-not (Test-Path $briefFile)) {
      $problems += "${slug}: el tick diario de Leda del $tickLabel (hora del server) no dejó brief ($briefFile): no corrió o falló antes de escribirlo. Mira las Executions de su workflow en n8n (docs/server-setup.md, sección del tick de Leda)."
    }

    $raw = $null; $code = 1
    # Con "Stop", PS 5.1 corta el script si el helper escribe algo en stderr (lo envuelve como error).
    $prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
      $raw = & powershell -ExecutionPolicy Bypass -NoProfile -File "$PSScriptRoot\leda-helpers.ps1" -Action list-scheduled-due -Project $slug 2>$null
      $code = $LASTEXITCODE
    } catch { $raw = $null } finally { $ErrorActionPreference = $prevEap }
    $lines = @($raw | ForEach-Object { [string]$_ })
    $first = -1
    for ($k = 0; $k -lt $lines.Count; $k++) { if ($lines[$k].TrimStart().StartsWith('[')) { $first = $k; break } }
    # Mismo parseo que el pre-check de run-skill.ps1: ForEach-Object enumera el array en PS 5.1 y 7.
    $duePosts = @(); $parsed = $false
    if ($code -eq 0 -and $first -ge 0) {
      try {
        $duePosts = @(ConvertFrom-Json -InputObject ($lines[$first..($lines.Count - 1)] -join "`n") | ForEach-Object { $_ })
        $parsed = $true
      } catch { $parsed = $false }
    }
    if (-not $parsed) { $infos += "${slug}: no pude listar los posts programados vencidos (leda-helpers exit $code), check 7b salteado"; continue }
    foreach ($post in $duePosts) {
      # ledaPublishAt o agentPublishAt según el prefijo de campos del proyecto (el helper usa el del proyecto).
      $prop = $post.PSObject.Properties | Where-Object { $_.Name -like '*PublishAt' } | Select-Object -First 1
      if (-not $prop -or -not $prop.Value) { continue }
      $dueLocal = $null
      try {
        $dueLocal = if ($prop.Value -is [datetime]) { $prop.Value.ToLocalTime() }
                    else { ([DateTimeOffset]::Parse([string]$prop.Value, [Globalization.CultureInfo]::InvariantCulture)).LocalDateTime }
      } catch { continue }
      if ($dueLocal -lt $lastTick) {
        $problems += "${slug}: el post $($post.id) «$($post.title)» vencía el $($dueLocal.ToString('yyyy-MM-dd HH:mm')) y el tick del $tickLabel (hora del server) no lo publicó: sigue programado. Si ese tick tampoco dejó brief, no corrió; si no, mira el stdout de esa ejecución en n8n (docs/server-setup.md, sección del tick de Leda)."
      }
    }
  }
}

# --- Reporte ---
$mode = if ($AuthOnly) { 'auth-probe' } else { 'full' }
"=== Health check ($mode) $(Get-Date -Format 'yyyy-MM-dd HH:mm') ==="
if ($problems.Count -eq 0) { "✅ Sin problemas." } else { $problems | ForEach-Object { "🔴 $_" } }
$infos | ForEach-Object { "ℹ️  $_" }

if ($problems.Count -eq 0) { exit 0 }

if ($DryRun) { "(DryRun: no creo issue en Linear)"; exit 1 }

# --- Crear issue [Alert] en Linear (team del proyecto de ops) vía GraphQL — sin claude, determinístico ---
if (-not $env:LINEAR_API_KEY) { Write-Warning "Sin LINEAR_API_KEY: no puedo crear el issue de alerta."; exit 1 }
$ops = Get-Project -Slug $OpsProject
$headers = @{ Authorization = $env:LINEAR_API_KEY; 'Content-Type' = 'application/json; charset=utf-8' }
function Invoke-LinearGql {
  param([string]$Query, $Variables)
  $body = @{ query = $Query; variables = $Variables } | ConvertTo-Json -Depth 6 -Compress
  return Invoke-RestMethod -Uri 'https://api.linear.app/graphql' -Method Post -Headers $headers -Body ([Text.Encoding]::UTF8.GetBytes($body))
}
try {
  # Clase de alerta (auth-down vs general) → dedup por clase: no duplicar el mismo tipo de
  # [Alert] si ya hay uno abierto en las últimas 24h (clave con el probe cada 4h, que si no
  # spamearía hasta 6 issues/día por una condición persistente). Un auth-down NUNCA lo suprime
  # un general — solo otro auth-down abierto. Si la query falla, degradamos a crear igual.
  $authDown = @($problems | Where-Object { $_ -like 'AUTH:*' }).Count -gt 0
  $dedupPrefix = if ($authDown) { '[Alert] Claude OAuth' } else { '[Alert] Health check' }
  $openAlert = $null
  try {
    $dq = Invoke-LinearGql -Query 'query($t:ID,$p:String,$s:DateTimeOrDuration){ issues(filter:{team:{id:{eq:$t}}, title:{startsWith:$p}, state:{type:{nin:["completed","canceled"]}}, createdAt:{gt:$s}}, first:1){ nodes{ identifier url } } }' -Variables @{ t = $ops.linear.teamId; p = $dedupPrefix; s = '-P1D' }
    $openAlert = $dq.data.issues.nodes[0]
  } catch { $openAlert = $null }
  if ($openAlert) {
    "Ya hay un [Alert] abierto de esta clase ($($openAlert.identifier), <24h) — no duplico. $($openAlert.url)"
    exit 1
  }

  # Lookups best-effort (si fallan, creamos el issue igual, sin label/estado explícito).
  $labelId = $null; $stateId = $null; $assigneeId = $null
  try {
    $r = Invoke-LinearGql -Query 'query($t:ID){ issueLabels(filter:{name:{eq:"agent-report"}, team:{id:{eq:$t}}}, first:1){ nodes{ id } } }' -Variables @{ t = $ops.linear.teamId }
    $labelId = $r.data.issueLabels.nodes[0].id
  } catch {}
  try {
    $r = Invoke-LinearGql -Query 'query($t:ID){ workflowStates(filter:{name:{eq:"Backlog"}, team:{id:{eq:$t}}}, first:1){ nodes{ id } } }' -Variables @{ t = $ops.linear.teamId }
    $stateId = $r.data.workflowStates.nodes[0].id
  } catch {}
  # Asignar al dueño de la API key (= viewer) → la app de Linear le manda push al teléfono.
  try { $assigneeId = (Invoke-LinearGql -Query 'query{ viewer{ id } }' -Variables @{}).data.viewer.id } catch {}

  # Auth caído = apagón de todo el roster: título explícito, prioridad Urgent, pasos de recuperación.
  # ($authDown ya calculado arriba para el dedup.)
  $title = if ($authDown) {
    "[Alert] Claude OAuth caído — el roster headless no corre ($(Get-Date -Format 'yyyy-MM-dd HH:mm'))"
  } else {
    "[Alert] Health check $(Get-Date -Format 'yyyy-MM-dd'): $($problems.Count) problema(s)"
  }
  $desc = "## Problemas`n" + (($problems | ForEach-Object { "- 🔴 $_" }) -join "`n")
  if ($infos.Count -gt 0) { $desc += "`n`n## Info`n" + (($infos | ForEach-Object { "- $_" }) -join "`n") }
  if ($authDown) {
    $desc += "`n`n## Qué hacer`n"
    $desc += '1. En el server, bajo el user real: `claude /login` (o `claude login`).' + "`n"
    $desc += '2. Verifica que volvió: `scripts\run-health-check.ps1 -AuthOnly -DryRun`.' + "`n"
    $desc += '3. Recupera lo que falló durante el apagón: `scripts\recover-failed-runs.ps1 -Since <fecha-inicio>` (agrega `-Execute` para re-correr).'
  }
  $desc += "`n`n---`nGenerado por scripts/run-health-check.ps1 (probe de auth cada 4h + health-check full diario, sin LLM). Cubre todos los proyectos; el issue va al team del proyecto de ops ($OpsProject)."

  $issueInput = @{ teamId = $ops.linear.teamId; title = $title; description = $desc }
  if ($labelId) { $issueInput.labelIds = @($labelId) }
  if ($stateId) { $issueInput.stateId = $stateId }
  if ($assigneeId) { $issueInput.assigneeId = $assigneeId }
  if ($authDown) { $issueInput.priority = 1 }  # Urgent: apagón de todo el roster.
  $r = Invoke-LinearGql -Query 'mutation($input: IssueCreateInput!){ issueCreate(input:$input){ success issue{ identifier url } } }' -Variables @{ input = $issueInput }
  if ($r.data.issueCreate.success) { "Issue creado: $($r.data.issueCreate.issue.identifier) — $($r.data.issueCreate.issue.url)" }
  else { Write-Warning "issueCreate devolvió success=false: $($r | ConvertTo-Json -Depth 5 -Compress)" }
} catch {
  Write-Warning "No pude crear el issue de alerta en Linear: $($_.Exception.Message)"
}
exit 1
