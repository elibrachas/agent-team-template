# Corre a Pico (PM) en su REPORTE SEMANAL DE "QUÉ SE ACTUALIZÓ EN LA APP" (cron de n8n, p. ej. viernes por la tarde).
#   uso:  powershell -ExecutionPolicy Bypass -NoProfile -File scripts\run-pico-shipped.ps1 -Project acme
#         ...-DryRun                      (muestra la config resuelta, no llama a claude)
#
# Qué hace: Pico mira los commits de la semana del repo del producto (git log read-only) + PRs
# mergeadas (gh, opcional) + issues que pasaron a Done en Linear, los cruza con el plan
# (projects/<slug>/roadmap.md), y deja un [Report] "Qué se actualizó en la app" en Linear,
# sumando como seguidoras a las personas configuradas por proyecto (project.json ->
# shippedDigestFollowers). HITL-1, READ-ONLY.
#
# POR QUÉ UN WRAPPER DEDICADO (y NO run-skill.ps1 + el registry de Pico):
#   El loadout de Pico en agents.ps1 NO tiene Bash, y este report necesita Bash para `git log`
#   (y opcionalmente `gh`). Este wrapper HARDCODEA un loadout read-only con Bash (sin Edit/Write)
#   e inyecta el system prompt del modo report. Mismo modelo que run-cody-scan.ps1 / run-greta-seo.ps1.
#
# Flags verificadas contra el mismo set que run-skill.ps1 / run-cody-scan.ps1. Si actualizas el
# CLI, revalida con `claude --help`.
param(
  [string]$Project = 'acme',
  [string]$Model  = 'claude-opus-4-8',
  [string]$Budget = '50',
  [int]$TimeoutMinutes = 25,
  [switch]$DryRun
)
$ErrorActionPreference = "Stop"

# Raíz del repo (este script vive en scripts\)
Set-Location (Split-Path $PSScriptRoot -Parent)

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

# Refrescar PATH desde el registry (ver run-skill.ps1). Importante para `git` y `gh`.
$env:PATH = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')

# Billing: correr contra la suscripción (OAuth), NO la API key.
Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:ANTHROPIC_AUTH_TOKEN -ErrorAction SilentlyContinue

# Bajo SYSTEM (n8n-local) redirigimos USERPROFILE al user real + .local\bin (claude).
# `gh` lee GH_TOKEN directo del env (cargado de .env.server) — para `git log` no hace falta auth.
if ($env:CLAUDE_USERPROFILE) {
  $env:USERPROFILE = $env:CLAUDE_USERPROFILE
  $claudeBin = Join-Path $env:CLAUDE_USERPROFILE '.local\bin'
  if (Test-Path $claudeBin) { $env:PATH = "$claudeBin;$env:PATH" }
}

# GitHub auth para `git fetch` (repo privado) headless. Bajo SYSTEM (n8n-local) no hay
# keyring/GCM, así que `git fetch origin` no autentica solo (falla parejo para cualquier
# proyecto si el repo local no tiene credenciales cacheadas). Inyectamos GH_TOKEN como header
# HTTP de Authorization para github.com vía GIT_CONFIG_* (mismo método que GitHub Actions y que
# respond-linear.ps1 para Cody): no depende de credential helpers. Solo si .env.server trae GH_TOKEN.
if ($env:GH_TOKEN) {
  $ghBasic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("x-access-token:$($env:GH_TOKEN)"))
  $env:GIT_CONFIG_COUNT = "1"
  $env:GIT_CONFIG_KEY_0 = "http.https://github.com/.extraheader"
  $env:GIT_CONFIG_VALUE_0 = "Authorization: Basic $ghBasic"
}

# Roster (identidad/firma de Pico) + contexto del proyecto (carga .env.<slug> encima).
. "$PSScriptRoot\agents.ps1"
. "$PSScriptRoot\project.ps1"
$projectObj = Resolve-ProjectContext -Slug $Project
$ownerName = Get-ProjectOwnerName -Project $projectObj
$signature = Get-AgentSignature -Name 'pico'

$stamp = Get-Date -Format "yyyy-MM-dd"
$out = "queue/pending-review/$stamp-$($projectObj.slug)-product-shipped-digest.md"
New-Item -ItemType Directory -Force -Path "queue/pending-review" | Out-Null

# --- Loadout HARDCODEADO del report (READ-ONLY — SIN Edit/Write; Bash para git/gh de lectura) ---
$allowed = "Read,Glob,Grep,Bash,mcp__supabase__*,mcp__linear__*"
$mcpConfig = ".\$($projectObj.mcpConfig)"
$skillPath = "plugins/team-pm/skills/product-shipped-digest/SKILL.md"
$roadmapPath = Join-Path $projectObj.contextDir 'roadmap.md'

# Lectura del repo del producto (git log + archivos). $repoPath = ruta resuelta.
$addDirArgs = @()
$repoPath = $projectObj.productRepoPath
$resolvedRepo = Resolve-Path -Path $projectObj.productRepoPath -ErrorAction SilentlyContinue
if ($resolvedRepo) { $repoPath = $resolvedRepo.Path; $addDirArgs += @('--add-dir', $resolvedRepo.Path) }
else { Write-Warning "No encontré $($projectObj.productRepoPath) — el report correrá degradado (sin commits del repo, solo Linear)." }

# Seguidoras a sumar al issue: POR PROYECTO (project.json -> shippedDigestFollowers).
# Cada proyecto lista a las personas que quieren recibir el digest (puede ser vacío).
$followerList = @()
if ($projectObj.PSObject.Properties['shippedDigestFollowers'] -and $projectObj.shippedDigestFollowers) {
  $followerList = @($projectObj.shippedDigestFollowers)
}
$followers = $followerList -join ', '
$followersDirective = if ($followers) {
  "- SEGUIDORAS (OBLIGATORIO): suma a $followers como subscribers/seguidoras del issue. Resuelve sus user IDs con list_users/get_user del MCP de Linear. Agrégalos con update_issue (subscriberIds = existentes + los nuevos) si el tool lo soporta; si no, comenta el issue @-mencionándolos (Linear auto-suscribe a los mencionados). REPORTA en el brief si pudiste y por qué método; si no, dilo claro para que $ownerName las agregue a mano. Nunca falles en silencio."
} else {
  "- SEGUIDORAS: este proyecto no tiene seguidoras configuradas (project.json -> shippedDigestFollowers vacío). No agregues a nadie como seguidor."
}

# System prompt: Pico en MODO REPORT SEMANAL DE CAMBIOS (read-only). El método vive en el SKILL.
$systemPrompt = @"
Eres Pico, el product manager de $($projectObj.name), corriendo tu REPORTE SEMANAL de "qué se actualizó en la app" (cron, sin issue de Linear de origen). Este turno es READ-ONLY: miras lo que shipeó y lo reportas; NO escribes código ni archivos.

Tu método completo está en la skill: LEE y sigue al pie el archivo $skillPath (usa el tool Read). No improvises el método; está todo ahí.

Contexto del proyecto: team Linear $($projectObj.linear.teamKey); repo del producto en $repoPath ($($projectObj.productStack)); foco estratégico — $($projectObj.strategicFocus).

Reglas duras de este turno (HARD STOPS):
- READ-ONLY total. Con Bash, SOLO comandos de LECTURA: `git -C $repoPath fetch origin` (no toca el working tree), `git -C $repoPath log/show/diff/status`, y opcionalmente `gh pr list ... --state merged` (read-only). PROHIBIDO: git add/commit/push/branch/checkout/reset/rebase/merge, gh pr create/merge, installs, build, y cualquier comando que modifique el repo. No tienes tools Edit/Write.
- Ventana: últimos 7 días. Agrupa los commits por tema (no listes la lista cruda). Extrae las refs a Linear (Cody comitea con 'Refs $($projectObj.linear.teamKey)-X').
- LEE $roadmapPath para mapear lo shipeado contra el plan, pero NO lo reescribas (es de Capi).
- Salida en Linear (team $($projectObj.linear.teamKey)): UN issue [Report] 'Qué se actualizó en la app — semana $stamp' (label agent-report, Backlog, sin asignar). Si ya existe el de esta semana, comenta en vez de duplicar. Al final del body, '---' + 'Generado por $signature'.
$followersDirective
- Si git/gh fallan, repórtalo y arma el report con lo que tengas de Linear. No inventes commits ni PRs.

Devuelve el brief completo en markdown como tu respuesta final (lo guarda el wrapper en $out). Empieza el brief con '${signature}:' y un resumen corto.
"@

$userTask = "Ejecuta AHORA tu reporte semanal de qué se actualizó en la app: lee $skillPath y síguelo al pie. No me describas el plan — corre git log (read-only) sobre $repoPath, cruza contra Linear y $roadmapPath, crea el [Report], suma las seguidoras configuradas del proyecto (ver la directiva de SEGUIDORAS en el system), y devuelve el brief final en markdown. Recuerda: SIN editar/comitear/pushear nada."

if ($DryRun) {
  "=== DRY RUN run-pico-shipped (no se llamó a claude) ==="
  "Project  : $($projectObj.slug) | Team: $($projectObj.linear.teamKey)"
  "Model    : $Model | Budget: $Budget | Timeout: $TimeoutMinutes min"
  "MCP      : $mcpConfig"
  "Allowed  : $allowed   <-- read-only: SIN Edit/Write"
  "RepoPath : $repoPath  (Test-Path: $(Test-Path $repoPath))"
  "Roadmap  : $roadmapPath  (Test-Path: $(Test-Path $roadmapPath))"
  "Followers: $(if ($followers) { $followers } else { '(ninguna configurada)' })"
  "gh token : $(if ($env:GH_TOKEN) { 'presente (git fetch + gh autenticados via extraheader)' } else { 'AUSENTE (git fetch de repo privado puede fallar; configura GH_TOKEN en .env.server)' })"
  "AddDirs  : $(if ($addDirArgs) { $addDirArgs -join ' ' } else { '(ninguno)' })"
  "Out      : $out"
  exit 0
}

# Guard de runtime por tiempo (ver project.ps1).
$watchdog = Start-AgentWatchdog -TimeoutMinutes $TimeoutMinutes
$runStart = Get-Date

$json = "" | claude -p $userTask `
  --append-system-prompt $systemPrompt `
  --model $Model `
  --mcp-config $mcpConfig `
  --strict-mcp-config `
  --permission-mode dontAsk `
  --allowedTools $allowed `
  --max-budget-usd $Budget `
  --output-format json `
  @addDirArgs
$exit = $LASTEXITCODE

$timedOut = Stop-AgentWatchdog $watchdog
$durationS = ((Get-Date) - $runStart).TotalSeconds

$parsed = $null
try { $parsed = $json | ConvertFrom-Json } catch {}

if (-not $parsed) {
  Write-AgentAudit -Wrapper 'run-pico-shipped' -ProjectSlug $projectObj.slug -Name 'product-shipped-digest' -Model $Model -CostUsd $null -DurationS $durationS -IsError $true -TimedOut $timedOut
  $timeoutNote = if ($timedOut) { " TIMEOUT: el watchdog mató la corrida a los $TimeoutMinutes min." } else { "" }
  Write-Error "claude -p no devolvió JSON parseable para product-shipped-digest ($($projectObj.slug)) (exit $exit).$timeoutNote Salida cruda:`n$json"
  exit 1
}

# El wrapper escribe el brief (UTF-8 SIN BOM). $parsed.result es el markdown final.
$outAbs = Join-Path (Get-Location) $out
[System.IO.File]::WriteAllText($outAbs, [string]$parsed.result, (New-Object System.Text.UTF8Encoding($false)))

Write-AgentAudit -Wrapper 'run-pico-shipped' -ProjectSlug $projectObj.slug -Name 'product-shipped-digest' -Model $Model -CostUsd $parsed.total_cost_usd -DurationS $durationS -IsError ([bool]$parsed.is_error) -TimedOut $timedOut

$parsed.result
"---"
"Brief: $out | Project: $($projectObj.slug) | Model: $Model"
"Costo USD: $($parsed.total_cost_usd) | Duración: $([math]::Round($durationS))s"

if ($exit -ne 0 -or $parsed.is_error) {
  Write-Error "run-pico-shipped falló para $($projectObj.slug) (exit $exit, is_error=$($parsed.is_error))"
  exit 1
}
