# Corre a Capi (PM) en su CHECK DE AVANCE programado (cron de n8n, p. ej. lun/mié/vie).
#   uso:  powershell -ExecutionPolicy Bypass -NoProfile -File scripts\run-capi-roadmap.ps1 -Project acme
#         ...-DryRun                      (muestra la config resuelta, no llama a claude)
#
# Qué hace: Capi inventaria el avance a todo nivel (issues agent-proposal/agent-report del
# team), reconcilia contra el plan persistente (projects/<slug>/roadmap.md) y el estado real
# de Linear, re-prioriza/secuencia con mirada de PM, REESCRIBE roadmap.md (único write) y deja
# en Linear: lunes un [Plan] priorizado, mié/vie un [Report] de avance. HITL-1: read-only sobre
# prod; el ÚNICO write es roadmap.md.
#
# POR QUÉ UN WRAPPER DEDICADO (y no run-skill.ps1 + el registry de Capi):
#   El loadout de Capi en agents.ps1 lo comparte el LISTENER de Linear (respond-linear.ps1:
#   lee, comenta y puede crear issues vía MCP, pero SIN Write de archivos). Este check necesita
#   Write (acotado por HARD STOP del SKILL a roadmap.md) que NO debe filtrarse a las respuestas
#   casuales de Linear. Por eso este
#   wrapper HARDCODEA el loadout (Opus 4.8, Write acotado, --add-dir al repo del producto) y solo
#   toma de agents.ps1 la IDENTIDAD/firma. Mismo modelo que scripts/run-greta-seo.ps1.
#
# Flags verificadas contra el mismo set que run-skill.ps1 / run-greta-seo.ps1. Si actualizas el
# CLI, revalida con `claude --help`.
param(
  [string]$Project = 'acme',
  [string]$Model  = 'claude-opus-4-8',
  [string]$Budget = '50',
  [int]$TimeoutMinutes = 30,
  [switch]$DryRun
)
$ErrorActionPreference = "Stop"

# Raíz del repo (este script vive en scripts\)
Set-Location (Split-Path $PSScriptRoot -Parent)

# Secretos del server desde .env.server (mismo loader que run-skill/run-greta-seo).
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

# Refrescar PATH desde el registry (ver run-skill.ps1).
$env:PATH = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')

# Billing: correr contra la suscripción (OAuth), NO la API key. (Ver run-skill.ps1.)
Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:ANTHROPIC_AUTH_TOKEN -ErrorAction SilentlyContinue

# Bajo SYSTEM (n8n-local) redirigimos USERPROFILE al user real y prependeamos .local\bin.
if ($env:CLAUDE_USERPROFILE) {
  $env:USERPROFILE = $env:CLAUDE_USERPROFILE
  $claudeBin = Join-Path $env:CLAUDE_USERPROFILE '.local\bin'
  if (Test-Path $claudeBin) { $env:PATH = "$claudeBin;$env:PATH" }
}

# Roster (identidad/firma de Capi) + contexto del proyecto (carga .env.<slug> encima).
. "$PSScriptRoot\agents.ps1"
. "$PSScriptRoot\project.ps1"
$projectObj = Resolve-ProjectContext -Slug $Project
$signature = Get-AgentSignature -Name 'capi'

$stamp = Get-Date -Format "yyyy-MM-dd"
$out = "queue/pending-review/$stamp-$($projectObj.slug)-pm-progress-review.md"
New-Item -ItemType Directory -Force -Path "queue/pending-review" | Out-Null

# --- Loadout HARDCODEADO del check (decoplado del loadout de listener de Capi, que NO tiene Write) ---
# Write: SOLO para roadmap.md (el HARD STOP del SKILL lo acota a ese archivo). Glob/Grep:
# para mirar el repo del producto (qué shipeó) si hace falta.
$allowed = "Read,Glob,Grep,Write,mcp__supabase__*,mcp__linear__*"
$mcpConfig = ".\$($projectObj.mcpConfig)"
$skillPath = "plugins/team-pm/skills/pm-progress-review/SKILL.md"
$roadmapPath = Join-Path $projectObj.contextDir 'roadmap.md'

# Lectura read-only del repo del producto (sanity-check de avance "a todo nivel de la app").
$addDirArgs = @()
$resolvedRepo = Resolve-Path -Path $projectObj.productRepoPath -ErrorAction SilentlyContinue
if ($resolvedRepo) { $addDirArgs += @('--add-dir', $resolvedRepo.Path) }
else { Write-Warning "No encontré $($projectObj.productRepoPath) — el sanity-check del repo correrá degradado." }

# Día de la semana → modo de corrida (lunes = [Plan] completo; resto = [Report] de avance).
$dow = (Get-Date).DayOfWeek
$isMonday = ($dow -eq [System.DayOfWeek]::Monday)
$dayMode = if ($isMonday) {
  "HOY ES LUNES → corrida COMPLETA: deja el issue [Plan] Roadmap priorizado $stamp (absorbe las ideas nuevas que Pico/Cody/Numa generaron temprano) con TODAS las secciones del SKILL."
} else {
  "HOY ES $($dow.ToString().ToUpper()) (check de mitad de semana) → deja el issue [Report] Check de avance $stamp (formato corto: qué se movió / qué se trabó / qué decidir ahora). No re-derives todo el plan si nada cambió."
}

# System prompt: identidad de Capi en MODO CHECK DE AVANCE (NO comment-only). El método vive en el SKILL.
$systemPrompt = @"
Eres Capi, el project manager de $($projectObj.name), corriendo tu CHECK DE AVANCE programado (cron, sin issue de Linear de origen). Este turno NO es comment-only: inventarías el avance, reconcilias, re-priorizas y mantienes tu propio plan persistente.

Tu método completo está en la skill: LEE y sigue al pie el archivo $skillPath (usa el tool Read). No improvises el método; está todo ahí.

Contexto del proyecto: team Linear $($projectObj.linear.teamKey); foco estratégico — $($projectObj.strategicFocus) El detalle vive en $($projectObj.contextDir)\ (glossary, data-model, etc.).

$dayMode

Reglas duras de este turno:
- READ-ONLY sobre prod (Supabase, repo del producto). El ÚNICO write permitido es el plan persistente $roadmapPath (con el tool Write). NUNCA escribas ningún otro archivo, y NUNCA escribas dentro de $($projectObj.productRepoPath) (ese repo es SOLO LECTURA).
- NO cambies estado/label/asignación/priority de NINGÚN issue ajeno de Linear. Tu única escritura en Linear es crear (o comentar, si ya existe el de hoy) TU issue [Plan]/[Report] en el team $($projectObj.linear.teamKey) (label agent-report, Backlog, sin asignar).
- Antes de re-priorizar: LEE $roadmapPath y reconcilia el status de cada fila contra el estado real del issue en Linear (Done=>hecho, Canceled=>wont-fix, Todo/In Progress=>aceptado, PR abierta en el thread=>en-progreso, Backlog=>propuesto).
- Al terminar, REESCRIBE $roadmapPath completo con las filas reconciliadas + las nuevas.
- Al final del body de tu issue agrega una línea '---' y debajo 'Generado por $signature'.
- Si el MCP de Linear falla, NO reescribas el ledger a ciegas: deja el análisis en el brief y avisa que faltó reconciliar.

Devuelve el brief completo en markdown como tu respuesta final (lo guarda el wrapper en $out). Empieza el brief con '${signature}:' y un veredicto corto.
"@

$userTask = "Ejecuta AHORA tu check de avance: lee $skillPath y síguelo al pie. No me describas el plan — inventaría el avance con el MCP de Linear, reconcilia $roadmapPath contra el estado real de los issues, re-prioriza, reescribe $roadmapPath, crea tu issue [Plan]/[Report] según el día, y devuelve el brief final en markdown."

if ($DryRun) {
  "=== DRY RUN run-capi-roadmap (no se llamó a claude) ==="
  "Project : $($projectObj.slug) | Team: $($projectObj.linear.teamKey)"
  "Day     : $dow | Mode: $(if ($isMonday) { '[Plan] (lunes)' } else { '[Report] (avance)' })"
  "Model   : $Model | Budget: $Budget | Timeout: $TimeoutMinutes min"
  "MCP     : $mcpConfig"
  "Allowed : $allowed"
  "Roadmap : $roadmapPath  (Test-Path: $(Test-Path $roadmapPath))"
  "AddDirs : $(if ($addDirArgs) { $addDirArgs -join ' ' } else { '(ninguno)' })"
  "Out     : $out"
  "SUPABASE_PROJECT_REF: $env:SUPABASE_PROJECT_REF"
  exit 0
}

# Guard de runtime por tiempo (ver project.ps1): si claude excede el timeout, el watchdog
# mata el árbol de procesos (claude + MCPs).
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
  Write-AgentAudit -Wrapper 'run-capi-roadmap' -ProjectSlug $projectObj.slug -Name 'pm-progress-review' -Model $Model -CostUsd $null -DurationS $durationS -IsError $true -TimedOut $timedOut
  $timeoutNote = if ($timedOut) { " TIMEOUT: el watchdog mató la corrida a los $TimeoutMinutes min." } else { "" }
  Write-Error "claude -p no devolvió JSON parseable para pm-progress-review ($($projectObj.slug)) (exit $exit).$timeoutNote Salida cruda:`n$json"
  exit 1
}

# El wrapper escribe el brief (UTF-8 SIN BOM). $parsed.result es el markdown final.
$outAbs = Join-Path (Get-Location) $out
[System.IO.File]::WriteAllText($outAbs, [string]$parsed.result, (New-Object System.Text.UTF8Encoding($false)))

Write-AgentAudit -Wrapper 'run-capi-roadmap' -ProjectSlug $projectObj.slug -Name 'pm-progress-review' -Model $Model -CostUsd $parsed.total_cost_usd -DurationS $durationS -IsError ([bool]$parsed.is_error) -TimedOut $timedOut

$parsed.result
"---"
"Brief: $out | Project: $($projectObj.slug) | Model: $Model"
"Costo USD: $($parsed.total_cost_usd) | Duración: $([math]::Round($durationS))s"

if ($exit -ne 0 -or $parsed.is_error) {
  Write-Error "run-capi-roadmap falló para $($projectObj.slug) (exit $exit, is_error=$($parsed.is_error))"
  exit 1
}
