# Corre a Cody (code engineer) en su SCAN DE DEUDA TÉCNICA programado (cron de n8n, p. ej. lunes temprano).
#   uso:  powershell -ExecutionPolicy Bypass -NoProfile -File scripts\run-cody-scan.ps1 -Project acme
#         ...-DryRun                      (muestra la config resuelta, no llama a claude)
#
# Qué hace: Cody escanea el repo del producto (READ-ONLY) buscando deuda técnica — errores de
# tipo baseline, TODO/FIXME viejos, tests salteados, código muerto, deps desactualizadas, DX/perf
# — reconcilia contra roadmap.md + Linear, y propone hasta 3-5 [Proposal] de ingeniería. HITL-1.
#
# POR QUÉ UN WRAPPER DEDICADO (y NO run-skill.ps1 + el registry de Cody):
#   El loadout de Cody en agents.ps1 es 'writes-code' (Edit/Write/Bash + push/PR). Un SCAN debe
#   ser READ-ONLY: este wrapper HARDCODEA un loadout sin Edit/Write (Read/Glob/Grep/Bash +
#   Linear/Supabase) e inyecta un system prompt en MODO SCAN con HARD STOP. Así la capacidad de
#   escribir código NUNCA se activa en una corrida de scan. Mismo modelo que run-greta-seo.ps1 /
#   run-capi-roadmap.ps1 (wrappers dedicados que decoplan un modo del registry).
#
# Flags verificadas contra el mismo set que run-skill.ps1 / respond-linear.ps1. Si actualizas el
# CLI, revalida con `claude --help`.
param(
  [string]$Project = 'acme',
  [string]$Model  = 'claude-sonnet-4-6',
  [string]$Budget = '50',
  [int]$TimeoutMinutes = 30,
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

# Refrescar PATH desde el registry (ver run-skill.ps1).
$env:PATH = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')

# Billing: correr contra la suscripción (OAuth), NO la API key.
Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:ANTHROPIC_AUTH_TOKEN -ErrorAction SilentlyContinue

# Bajo SYSTEM (n8n-local) redirigimos USERPROFILE al user real + .local\bin + corepack
# (para que `pnpm typecheck` / `npx tsc` del scan resuelvan; mismo setup que respond-linear.ps1).
if ($env:CLAUDE_USERPROFILE) {
  $env:USERPROFILE = $env:CLAUDE_USERPROFILE
  $claudeBin = Join-Path $env:CLAUDE_USERPROFILE '.local\bin'
  if (Test-Path $claudeBin) { $env:PATH = "$claudeBin;$env:PATH" }
  $corepackHome = Join-Path $env:CLAUDE_USERPROFILE 'AppData\Local\node\corepack'
  if (Test-Path $corepackHome) { $env:COREPACK_HOME = $corepackHome }
}

# Roster (identidad/firma de Cody) + contexto del proyecto (carga .env.<slug> encima).
. "$PSScriptRoot\agents.ps1"
. "$PSScriptRoot\project.ps1"
$projectObj = Resolve-ProjectContext -Slug $Project
$signature = Get-AgentSignature -Name 'cody'

$stamp = Get-Date -Format "yyyy-MM-dd"
$out = "queue/pending-review/$stamp-$($projectObj.slug)-tech-debt-scan.md"
New-Item -ItemType Directory -Force -Path "queue/pending-review" | Out-Null

# --- Loadout HARDCODEADO del scan (READ-ONLY — SIN Edit/Write, decoplado del writes-code de Cody) ---
$allowed = "Read,Glob,Grep,Bash,mcp__supabase__*,mcp__linear__*"
$mcpConfig = ".\$($projectObj.mcpConfig)"
$skillPath = "plugins/team-pm/skills/tech-debt-scan/SKILL.md"
$roadmapPath = Join-Path $projectObj.contextDir 'roadmap.md'
$codyOverride = Join-Path $projectObj.contextDir 'agent-overrides\cody.md'

# Lectura read-only del repo del producto.
$addDirArgs = @()
$resolvedRepo = Resolve-Path -Path $projectObj.productRepoPath -ErrorAction SilentlyContinue
if ($resolvedRepo) { $addDirArgs += @('--add-dir', $resolvedRepo.Path) }
else { Write-Warning "No encontré $($projectObj.productRepoPath) — el scan correrá degradado (sin repo del producto)." }

# System prompt: Cody en MODO SCAN (read-only). El método vive en el SKILL.
$systemPrompt = @"
Eres Cody, el code engineer de $($projectObj.name), corriendo tu SCAN DE DEUDA TÉCNICA programado (cron, sin issue de Linear de origen). Este turno es READ-ONLY: NO escribes código, NO abres PRs — escaneas y propones.

Tu método completo está en la skill: LEE y sigue al pie el archivo $skillPath (usa el tool Read). No improvises el método; está todo ahí.

Contexto del proyecto: team Linear $($projectObj.linear.teamKey); repo del producto en $($projectObj.productRepoPath) ($($projectObj.productStack)); foco estratégico — $($projectObj.strategicFocus). Los comandos exactos de gating (typecheck/lint/test) y la lista NO-TOCAR están en tu override: $codyOverride (léelo).

Reglas duras de este turno (HARD STOPS):
- READ-ONLY ABSOLUTO sobre el repo del producto. NO tienes tools Edit/Write. Con Bash, SOLO comandos de DIAGNÓSTICO read-only: typecheck con --noEmit, lint, git log/diff/status, grep, ls, cat. PROHIBIDO: git add/commit/push/branch/checkout/reset/rebase, gh pr create, installs (pnpm/npm install, corepack), build, y cualquier comando que modifique archivos del repo.
- NO escribes NINGÚN archivo (tampoco $roadmapPath — de eso es dueño Capi). Tu output son los issues de Linear + el brief que devuelves.
- Antes de proponer: LEE $roadmapPath y dedupea contra él + las [Proposal] abiertas en Linear. No re-propongas lo wont-fix ni lo ya hecho.
- Salida en Linear (team $($projectObj.linear.teamKey)): hasta 3-5 [Proposal] de deuda técnica (label agent-proposal, Backlog, sin asignar, las 6 secciones canónicas de memory/CLAUDE.md). Al final del body de CADA issue agrega una línea '---' y debajo 'Generado por $signature'.
- Si el toolchain (pnpm/npx) no está disponible, haz el scan con análisis estático (Grep/Read) y decláralo. No inventes conteos.
- Si el MCP de Linear falla, no crees a ciegas: deja los hallazgos en el brief y avisa.

Devuelve el brief completo en markdown como tu respuesta final (lo guarda el wrapper en $out). Empieza el brief con '${signature}:' y un veredicto corto.
"@

$userTask = "Ejecuta AHORA tu scan de deuda técnica: lee $skillPath y síguelo al pie. No me describas el plan — escanea el repo (read-only), reconcilia contra $roadmapPath + Linear, crea hasta 3-5 [Proposal] de deuda técnica nuevos, y devuelve el brief final en markdown. Recuerda: SIN editar/comitear/pushear nada."

if ($DryRun) {
  "=== DRY RUN run-cody-scan (no se llamó a claude) ==="
  "Project : $($projectObj.slug) | Team: $($projectObj.linear.teamKey)"
  "Model   : $Model | Budget: $Budget | Timeout: $TimeoutMinutes min"
  "MCP     : $mcpConfig"
  "Allowed : $allowed   <-- read-only: SIN Edit/Write"
  "Roadmap : $roadmapPath  (Test-Path: $(Test-Path $roadmapPath))"
  "Override: $codyOverride  (Test-Path: $(Test-Path $codyOverride))"
  "AddDirs : $(if ($addDirArgs) { $addDirArgs -join ' ' } else { '(ninguno)' })"
  "Out     : $out"
  "SUPABASE_PROJECT_REF: $env:SUPABASE_PROJECT_REF"
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
  Write-AgentAudit -Wrapper 'run-cody-scan' -ProjectSlug $projectObj.slug -Name 'tech-debt-scan' -Model $Model -CostUsd $null -DurationS $durationS -IsError $true -TimedOut $timedOut
  $timeoutNote = if ($timedOut) { " TIMEOUT: el watchdog mató la corrida a los $TimeoutMinutes min." } else { "" }
  Write-Error "claude -p no devolvió JSON parseable para tech-debt-scan ($($projectObj.slug)) (exit $exit).$timeoutNote Salida cruda:`n$json"
  exit 1
}

# El wrapper escribe el brief (UTF-8 SIN BOM). $parsed.result es el markdown final.
$outAbs = Join-Path (Get-Location) $out
[System.IO.File]::WriteAllText($outAbs, [string]$parsed.result, (New-Object System.Text.UTF8Encoding($false)))

Write-AgentAudit -Wrapper 'run-cody-scan' -ProjectSlug $projectObj.slug -Name 'tech-debt-scan' -Model $Model -CostUsd $parsed.total_cost_usd -DurationS $durationS -IsError ([bool]$parsed.is_error) -TimedOut $timedOut

$parsed.result
"---"
"Brief: $out | Project: $($projectObj.slug) | Model: $Model"
"Costo USD: $($parsed.total_cost_usd) | Duración: $([math]::Round($durationS))s"

if ($exit -ne 0 -or $parsed.is_error) {
  Write-Error "run-cody-scan falló para $($projectObj.slug) (exit $exit, is_error=$($parsed.is_error))"
  exit 1
}
