# Corre a Alfred 🎩 (meta-agente que mejora a los OTROS agentes).
#   uso:  powershell -ExecutionPolicy Bypass -NoProfile -File scripts\run-alfred.ps1 -Job sweep
#         ... -Job issue -IssueId ACM-42 -Project acme        (llamado directo; lo invoca respond-linear.ps1)
#         ... -DryRun                                          (muestra la config resuelta, no llama a claude)
#
# Qué hace: Alfred procesa las ESCALACIONES de los otros agentes (issues Linear label 'alfred')
# y los llamados directos del owner. Diagnostica la causa raíz de un mal comportamiento y, si
# amerita, cambia el SISTEMA DE AGENTES (scripts/agents.ps1, un override, un SKILL.md, un wrapper
# o una doc) → PR contra el repo de AGENTES + reporte en Linear. El owner revisa y aprueba. HITL-1
# en el sentido de que nada se mergea sin su review. Método completo: docs/alfred.md.
#
# POR QUÉ UN WRAPPER DEDICADO (y NO respond-linear.ps1 + el registry):
#   El loadout de Alfred (Edit/Write/Bash + git/PR sobre el repo de AGENTES) NO debe filtrarse al
#   listener comment-only de Linear. Este wrapper hardcodea ese loadout y, sobre todo, aísla el
#   trabajo en un CLON LIMPIO del repo (ALFRED_REPO_PATH) para NUNCA commitear sobre la copia viva
#   con el WIP del owner. Mismo patrón decoplado que run-greta-seo.ps1 / run-cody-scan.ps1.
#
# MODOS (los resuelve este wrapper):
#   - PR mode: hay un clon limpio en ALFRED_REPO_PATH → Alfred edita ahí, commitea y abre PR.
#   - Propose mode (fallback): no hay clon / no está limpio → Alfred corre READ-ONLY y deja el
#     diff propuesto como comentario en Linear (sin PR). Así v1 funciona antes del setup del clon.
#
# Flags verificadas contra el mismo set que run-cody-scan.ps1 / respond-linear.ps1. Si actualizas
# el CLI, revalida con `claude --help`.
param(
  [Parameter(Mandatory = $false)][ValidateSet('sweep', 'issue')][string]$Job = 'sweep',
  [string]$IssueId = '',
  [string]$Project = 'acme',
  [string]$Model  = 'claude-opus-4-8',
  [string]$Effort = 'high',
  [string]$Budget = '50',
  [int]$TimeoutMinutes = 45,
  [string]$BaseBranch = '',   # rama base de los PRs de Alfred; default env ALFRED_BASE_BRANCH > 'main'
  [switch]$DryRun
)
$ErrorActionPreference = "Stop"

if ($Job -eq 'issue' -and [string]::IsNullOrWhiteSpace($IssueId)) {
  Write-Error "run-alfred.ps1 -Job issue requiere -IssueId. (El llamado directo lo pasa respond-linear.ps1.)"
  exit 1
}

# Raíz del repo de agentes VIVO (este script vive en scripts\). Es la copia con el WIP del owner:
# Alfred la LEE (modo propose) pero NUNCA commitea aquí — para PRs usa el clon limpio (más abajo).
$workingRoot = Split-Path $PSScriptRoot -Parent
Set-Location $workingRoot

# Secretos del server desde .env.server (mismo loader que el resto de los wrappers).
$envFile = ".\.env.server"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
      $parts = $line.Split("=", 2)
      $key = $parts[0].Trim()
      $value = $parts[1].Trim()
      if ($value.Length -ge 2 -and
          (($value.StartsWith('"') -and $value.EndsWith('"')) -or
           ($value.StartsWith("'") -and $value.EndsWith("'")))) {
        $value = $value.Substring(1, $value.Length - 2)
      }
      Set-Item -Path ("Env:" + $key) -Value $value
    }
  }
}

# Refrescar PATH desde el registry (ver run-skill.ps1) — necesario para `gh` / `git` bajo n8n.
$env:PATH = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')

# Billing: correr contra la suscripción (OAuth), NO la API key.
Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:ANTHROPIC_AUTH_TOKEN -ErrorAction SilentlyContinue

# Bajo SYSTEM (n8n-local) redirigimos USERPROFILE al user real + .local\bin (claude native installer).
if ($env:CLAUDE_USERPROFILE) {
  $env:USERPROFILE = $env:CLAUDE_USERPROFILE
  $claudeBin = Join-Path $env:CLAUDE_USERPROFILE '.local\bin'
  if (Test-Path $claudeBin) { $env:PATH = "$claudeBin;$env:PATH" }
}

# GitHub auth para el PR de Alfred (contra el repo de AGENTES). Mismo método que Cody:
# inyectamos GH_TOKEN como extraheader HTTP de Authorization para github.com (no depende del
# keyring/GCM, que bajo SYSTEM no está). `gh pr create` usa GH_TOKEN directo.
if ($env:GH_TOKEN) {
  $ghBasic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("x-access-token:$($env:GH_TOKEN)"))
  $env:GIT_CONFIG_COUNT = "1"
  $env:GIT_CONFIG_KEY_0 = "http.https://github.com/.extraheader"
  $env:GIT_CONFIG_VALUE_0 = "Authorization: Basic $ghBasic"
}
# Identidad de commits de Alfred (repo de agentes; el email no afecta el deploy aquí, pero mantenemos
# atribución consistente con el resto de los agentes que escriben).
$env:GIT_AUTHOR_NAME     = "Alfred (agent team)"
$env:GIT_AUTHOR_EMAIL    = 'owner@example.com'   # TODO(acme): el email de tu cuenta de GitHub
$env:GIT_COMMITTER_NAME  = $env:GIT_AUTHOR_NAME
$env:GIT_COMMITTER_EMAIL = $env:GIT_AUTHOR_EMAIL

# Cierre del loop: antes del barrido diario, actualiza la copia VIVA del repo de agentes (esta PC)
# con lo que se haya mergeado (ej. un PR anterior de Alfred ya aprobado), para que el runtime tome
# las mejoras. Best-effort + seguro: sync-agents-repo.ps1 hace FF-only y SOLO si está limpio (nunca
# pisa WIP). Solo en el sweep (no en cada llamado directo, para no meter latencia). Si falla, sigo.
if ($Job -eq 'sweep' -and -not $DryRun) {
  try { & "$PSScriptRoot\sync-agents-repo.ps1" -Quiet } catch { Write-Warning "sync-agents-repo (no bloqueante) falló: $($_.Exception.Message)" }
}

# Roster (identidad/firma + system prompt de Alfred) + contexto del proyecto.
. "$PSScriptRoot\agents.ps1"
. "$PSScriptRoot\project.ps1"
$projectObj = Resolve-ProjectContext -Slug $Project
$ownerName = Get-ProjectOwnerName -Project $projectObj
$agent = Get-Agent -Name 'alfred'
$signature = Get-AgentSignature -Name 'alfred'
$teamKey = $projectObj.linear.teamKey

$stamp = Get-Date -Format "yyyy-MM-dd"
$out = if ($Job -eq 'issue') { "queue/pending-review/$stamp-$($projectObj.slug)-alfred-$IssueId.md" }
       else                  { "queue/pending-review/$stamp-$($projectObj.slug)-alfred-sweep.md" }
$outAbs = Join-Path $workingRoot $out
New-Item -ItemType Directory -Force -Path (Join-Path $workingRoot "queue/pending-review") | Out-Null

# --- Resolver el modo (PR vs Propose) contra el clon limpio ---
# ALFRED_REPO_PATH (env) o el default sibling. Debe ser un repo git; lo sincronizamos a main y
# verificamos que quede LIMPIO. Cualquier problema → modo propose (read-only, sin PR), seguro.
# Rama base de los PRs de Alfred. Si el repo de agentes trabaja sobre una rama de larga vida
# distinta de main (que se PRea a main aparte), Alfred debe branchear de esa rama y PRear DE
# VUELTA a ella (si PReara a main, el diff arrastraría todos los commits pendientes de la
# working branch). Configurable por -BaseBranch > env ALFRED_BASE_BRANCH > 'main'.
$baseBranch = if ($BaseBranch) { $BaseBranch } elseif ($env:ALFRED_BASE_BRANCH) { $env:ALFRED_BASE_BRANCH } else { 'main' }

$prMode = $false
$alfredRepoResolved = $null
$alfredRepoRaw = if ($env:ALFRED_REPO_PATH) { $env:ALFRED_REPO_PATH } else { '..\agent-team-template-alfred' }
$r = Resolve-Path -Path $alfredRepoRaw -ErrorAction SilentlyContinue
if ($r -and (Test-Path (Join-Path $r.Path '.git'))) {
  $alfredRepoResolved = $r.Path
  # git escribe mensajes informativos a stderr (ej. "Switched to branch"); bajo
  # $ErrorActionPreference='Stop' eso se vuelve error terminante. Bajamos a 'Continue'
  # alrededor de los git nativos (gateamos por $LASTEXITCODE, no por excepción).
  $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  # Bajo SYSTEM (n8n-local) el clon lo owns el user real (no SYSTEM) → git aborta con "dubious
  # ownership" en TODO comando (checkout/pull/status), $coOk/$pullOk quedan $false y el wrapper
  # degrada a PROPOSE aunque el clon esté impecable. Marcamos el clon como safe.directory
  # (forward slashes, como lo computa git en Windows; idempotente) para que resuelva PR-mode.
  $safeDir = $alfredRepoResolved -replace '\\', '/'
  if (((git config --global --get-all safe.directory 2>$null) -contains $safeDir) -ne $true) {
    git config --global --add safe.directory $safeDir 2>$null | Out-Null
  }
  git -C $alfredRepoResolved fetch origin 2>$null | Out-Null
  git -C $alfredRepoResolved checkout $baseBranch 2>$null | Out-Null
  $coOk = ($LASTEXITCODE -eq 0)
  git -C $alfredRepoResolved pull --ff-only origin $baseBranch 2>$null | Out-Null
  $pullOk = ($LASTEXITCODE -eq 0)
  $porcelain = (git -C $alfredRepoResolved status --porcelain 2>$null) -join ''
  $ErrorActionPreference = $eap
  $isClean = [string]::IsNullOrWhiteSpace($porcelain)
  if ($coOk -and $pullOk -and $isClean) {
    $prMode = $true
  } else {
    Write-Warning "Clon de Alfred ($alfredRepoResolved) no quedó limpio en $baseBranch (checkout=$coOk pull=$pullOk clean=$isClean). Corro en modo PROPOSE (read-only, sin PR)."
  }
} else {
  Write-Warning "ALFRED_REPO_PATH ('$alfredRepoRaw') no existe o no es un repo git. Corro en modo PROPOSE (read-only, sin PR). Ver docs/server-setup.md § Alfred para habilitar PRs."
}

# --- Loadout por modo ---
if ($prMode) {
  # PR mode: Edit/Write/Bash + git/gh. El sandbox de archivos = el CLON (cwd se cambia abajo).
  $allowed = "Read,Edit,Write,Bash,Grep,Glob,mcp__linear__*"
  $modeNote = "MODO PR: estás parado en un CLON LIMPIO del repo de agentes, ya sincronizado a la rama base '$baseBranch'. Haz el cambio MÍNIMO ahí: branch ``alfred/<slug-corto>`` (desde '$baseBranch'), Edit/Write SOLO dentro de este clon, valida los .ps1 que tocaste (parse + BOM), ``git add`` de los archivos que tocaste (NO -A a ciegas), commit, push, y ``gh pr create --base $baseBranch``. Comenta el link del PR en Linear. NUNCA salgas de este clon ni toques el repo del producto."
} else {
  # Propose mode: READ-ONLY. Sin Edit/Write. Bash SOLO para diagnóstico read-only (git log/status, date).
  $allowed = "Read,Grep,Glob,Bash,mcp__linear__*"
  $modeNote = "MODO PROPOSE (read-only): NO hay clon limpio configurado, así que NO tienes Edit/Write y NO abres PR. Lee el estado actual del repo (tu cwd) y deja en tu comentario de Linear: la causa raíz + el archivo/sección exacta a cambiar + el DIFF propuesto (antes/después en un bloque de código) + la nota 'para aplicarlo como PR, configura ALFRED_REPO_PATH (ver docs/server-setup.md § Alfred)'. NO escribas NINGÚN archivo con Bash."
}

# MCP config (absoluto para que funcione sea cual sea el cwd). Solo Linear.
$mcpConfig = Join-Path $workingRoot 'scripts\alfred.mcp.json'

# System prompt = identidad de Alfred (registry, con placeholders interpolados) + contexto del turno.
$resolvedPrompt = Resolve-AgentPrompt -Agent $agent -Project $projectObj

if ($Job -eq 'issue') {
  $jobContext = @"
Contexto operativo de este turno — LLAMADO DIRECTO en el issue $IssueId (team $teamKey, proyecto $($projectObj.name)):
- $ownerName te llamó con 'Alfred:' en $IssueId. Lee el issue + TODO el thread (Linear MCP) y detecta qué te pide.
- LEE PRIMERO docs/alfred.md (tool Read) y sigue ese método al pie.
- $modeNote
- Deja UN comentario nuevo en $IssueId que empiece EXACTO con '${signature}: '. Devuelve un brief corto en markdown como respuesta final.
"@
  $userTask = "Ejecuta AHORA el pedido de $ownerName en ${IssueId}: lee docs/alfred.md, lee el issue + thread, diagnostica, decide si amerita cambio de sistema, actúa (PR o propose según el modo), deja tu comentario '${signature}:' en $IssueId, y devuelve un brief corto. No me describas el plan — hazlo."
} else {
  $jobContext = @"
Contexto operativo de este turno — SWEEP (corrida diaria, sin issue de origen; team $teamKey, proyecto $($projectObj.name)):
- Barre los issues ABIERTOS (estado NO Done/Canceled) con label 'alfred' del team $teamKey (Linear MCP). Son las escalaciones que dejaron los otros agentes cuando $ownerName los marcó fuerte.
- LEE PRIMERO docs/alfred.md (tool Read) y sigue ese método al pie. Aplica IDEMPOTENCIA: salta los issues que ya tienen un comentario tuyo ('${signature}:') sin actividad humana nueva posterior.
- Para cada issue: lee el thread completo, diagnostica la causa raíz, decide si amerita cambio de sistema, y actúa.
- $modeNote
- Devuelve un brief en markdown: qué issues barriste y qué decidiste en cada uno (PR / propose / no-amerita) con links.
"@
  $userTask = "Ejecuta AHORA tu barrido diario: lee docs/alfred.md y síguelo. Busca los issues abiertos con label 'alfred' en el team $teamKey, procesa cada uno (idempotente), deja tu comentario '${signature}:' en cada uno, y devuelve el brief final en markdown. No me describas el plan — hazlo."
}

$systemPrompt = @"
$resolvedPrompt

$jobContext
"@

if ($DryRun) {
  "=== DRY RUN run-alfred (no se llamó a claude) ==="
  "Job     : $Job$(if ($Job -eq 'issue') { " | Issue: $IssueId" })"
  "Project : $($projectObj.slug) | Team: $teamKey"
  "Mode    : $(if ($prMode) { "PR -> base '$baseBranch' (clon: $alfredRepoResolved)" } else { "PROPOSE (read-only, sin PR) | base seria '$baseBranch'" })"
  "Model   : $Model | Effort: $Effort | Budget: $Budget | Timeout: $TimeoutMinutes min"
  "MCP     : $mcpConfig"
  "Allowed : $allowed"
  "Commit  : $env:GIT_AUTHOR_NAME <$env:GIT_AUTHOR_EMAIL>"
  "Signature: $signature"
  "Out     : $out"
  "--- System prompt resuelto (primeras 25 líneas) ---"
  ($systemPrompt -split "`n" | Select-Object -First 25) -join "`n"
  exit 0
}

# En PR mode, el cwd de claude debe ser el CLON (aísla el sandbox de archivos a él; la copia viva
# con el WIP del owner NO queda en el sandbox → Alfred no la puede tocar). En propose mode nos
# quedamos en la copia viva (solo lectura). El brief y el audit se escriben con rutas absolutas.
if ($prMode) { Set-Location $alfredRepoResolved }

# Guard de runtime por tiempo (ver project.ps1).
$watchdog = Start-AgentWatchdog -TimeoutMinutes $TimeoutMinutes
$runStart = Get-Date

$json = "" | claude -p $userTask `
  --append-system-prompt $systemPrompt `
  --model $Model `
  --effort $Effort `
  --mcp-config $mcpConfig `
  --strict-mcp-config `
  --permission-mode dontAsk `
  --allowedTools $allowed `
  --max-budget-usd $Budget `
  --output-format json
$exit = $LASTEXITCODE

$timedOut = Stop-AgentWatchdog $watchdog
$durationS = ((Get-Date) - $runStart).TotalSeconds

# Volver a la raíz viva para el audit + el brief (rutas relativas de esos helpers).
Set-Location $workingRoot

$parsed = $null
try { $parsed = $json | ConvertFrom-Json } catch {}

if (-not $parsed) {
  Write-AgentAudit -Wrapper 'run-alfred' -ProjectSlug $projectObj.slug -Name "alfred/$Job" -Model $Model -CostUsd $null -DurationS $durationS -IsError $true -TimedOut $timedOut
  $timeoutNote = if ($timedOut) { " TIMEOUT: el watchdog mató la corrida a los $TimeoutMinutes min." } else { "" }
  Write-Error "claude -p no devolvió JSON parseable para alfred $Job (exit $exit).$timeoutNote Salida cruda:`n$json"
  exit 1
}

# El wrapper escribe el brief (UTF-8 SIN BOM). $parsed.result es el markdown final.
[System.IO.File]::WriteAllText($outAbs, [string]$parsed.result, (New-Object System.Text.UTF8Encoding($false)))

Write-AgentAudit -Wrapper 'run-alfred' -ProjectSlug $projectObj.slug -Name "alfred/$Job" -Model $Model -CostUsd $parsed.total_cost_usd -DurationS $durationS -IsError ([bool]$parsed.is_error) -TimedOut $timedOut

$parsed.result
"---"
"Brief: $out | Job: $Job | Mode: $(if ($prMode) { 'PR' } else { 'PROPOSE' }) | Model: $Model (effort $Effort)"
"Costo USD: $($parsed.total_cost_usd) | Duración: $([math]::Round($durationS))s"

if ($exit -ne 0 -or $parsed.is_error) {
  Write-Error "run-alfred falló para $Job (exit $exit, is_error=$($parsed.is_error))"
  exit 1
}
