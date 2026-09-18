# Corre a Greta (growth) en su REVISIÓN SEO SEMANAL programada (cron de n8n).
#   uso:  powershell -ExecutionPolicy Bypass -NoProfile -File scripts\run-greta-seo.ps1 -Job weekly-review
#
# Qué hace: cruza GA4 + Google Search Console + Core Web Vitals + Supabase + auditoría del
# frontend del repo del producto, reconcilia contra su memoria (seo-memory.md) y los issues
# [SEO] de Linear, y deja (1) un [Report] (SEO) semanal, (2) hasta 3-5 [Proposal] (SEO) nuevos,
# y (3) la memoria actualizada. HITL-1: read-only sobre prod; el único write es la memoria.
#
# POR QUÉ UN WRAPPER DEDICADO (y no run-skill.ps1 + el registry de Greta):
#   El Model/AllowedTools/McpConfig de Greta en agents.ps1 los comparte el LISTENER de Linear
#   (respond-linear.ps1, comment-only / read-only / tier barato). El cron de SEO necesita un
#   loadout MÁS PESADO y con Write que NO debe filtrarse a las respuestas casuales de Linear.
#   Por eso este wrapper HARDCODEA el loadout del run de SEO (Opus 4.8 high, Write acotado,
#   --add-dir <repo del producto>, seo.mcp.json) y solo toma de agents.ps1 la IDENTIDAD/firma.
#
# Flags verificadas contra el mismo set que run-qualy.ps1 / run-skill.ps1. Si actualizas el
# CLI, revalida con `claude --help`.
param(
  [Parameter(Mandatory = $false)][ValidateSet('weekly-review')][string]$Job = 'weekly-review',
  [string]$Project = 'acme',        # slug: resuelve .env.<slug>, skill, mcp, repo del producto y team
  [string]$Model  = 'claude-opus-4-8',
  [string]$Effort = 'high',
  [string]$Budget = '15',
  [switch]$DryRun
)
$ErrorActionPreference = "Stop"

# Raíz del repo (este script vive en scripts\)
Set-Location (Split-Path $PSScriptRoot -Parent)

# Secretos del server desde .env.server (mismo loader que run-skill/run-qualy/respond-linear).
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

# Bajo SYSTEM (n8n-local) redirigimos USERPROFILE al user real (auth de claude) y
# prependeamos .local\bin (claude native installer). No-op en la laptop de dev.
if ($env:CLAUDE_USERPROFILE) {
  $env:USERPROFILE = $env:CLAUDE_USERPROFILE
  $claudeBin = Join-Path $env:CLAUDE_USERPROFILE '.local\bin'
  if (Test-Path $claudeBin) { $env:PATH = "$claudeBin;$env:PATH" }
}

# Multi-proyecto: carga .env.<slug> ENCIMA de .env.server (limpia las project-scoped antes).
. "$PSScriptRoot\project.ps1"
$projectObj = Resolve-ProjectContext -Slug $Project
$teamKey = $projectObj.linear.teamKey

# Roster → Greta (SOLO para identidad/firma; el loadout pesado se hardcodea abajo).
# La firma con emoji (🤖 Greta 📈) sale de agents.ps1 vía el helper (single source, ya BOM-encodeado).
. "$PSScriptRoot\agents.ps1"
$agent = Get-Agent -Name 'greta'
$signature = Get-AgentSignature -Name 'greta'

$stamp = Get-Date -Format "yyyy-MM-dd"
$out = "queue/pending-review/$stamp-$($projectObj.slug)-greta-seo.md"
New-Item -ItemType Directory -Force -Path "queue/pending-review" | Out-Null

# --- Loadout HARDCODEADO del run de SEO (decoplado del registry de Greta) ---
# Write: SOLO para la memoria (el HARD STOP del SKILL lo acota a un archivo). Glob/Grep:
# para la auditoría de frontend del repo del producto. mcp__gsc__*: el server nuevo.
$allowed = "Read,Glob,Grep,Write,mcp__supabase__*,mcp__linear__*,mcp__ga4__*,mcp__cwv__*,mcp__gsc__*"

# Skill + memoria: primero projects\<slug>\skills\ (convención de skills por proyecto),
# fallback al plugin compartido (team-growth).
$skillPath = "projects/$($projectObj.slug)/skills/seo-weekly-review/SKILL.md"
if (-not (Test-Path $skillPath)) { $skillPath = "plugins/team-growth/skills/seo-weekly-review/SKILL.md" }
$memoryPath = (Split-Path $skillPath -Parent).Replace('\','/') + "/seo-memory.md"

# MCP: project.json → mcpVariants.seo; fallback al seo.mcp.json del plugin compartido.
$mcpConfig = ".\plugins\team-growth\seo.mcp.json"
if ($projectObj.PSObject.Properties['mcpVariants'] -and $projectObj.mcpVariants.PSObject.Properties['seo']) {
  $mcpConfig = ".\$($projectObj.mcpVariants.seo)"
}

# Lectura del repo del producto (frontend SEO: sitemap/robots/metadata/json-ld/cwv budgets).
$addDirArgs = @()
$prodRepo = $projectObj.productRepoPath
$resolved = Resolve-Path -Path $prodRepo -ErrorAction SilentlyContinue
if ($resolved) { $addDirArgs += @('--add-dir', $resolved.Path); $prodRepo = $resolved.Path }
else { Write-Warning "No encontré $prodRepo — la auditoría de frontend correrá degradada." }

if ($DryRun) {
  "=== DRY RUN run-greta-seo (no se llamó a claude) ==="
  "Project : $($projectObj.slug) | Team: $teamKey | Job: $Job"
  "Skill   : $skillPath"
  "Memoria : $memoryPath"
  "MCP     : $mcpConfig"
  "AddDirs : $($addDirArgs -join ' ')"
  "Model   : $Model (effort $Effort) | Budget: $Budget"
  "Out     : $out"
  "GSC_SITE_URL: $env:GSC_SITE_URL | SUPABASE_PROJECT_REF: $env:SUPABASE_PROJECT_REF"
  exit 0
}

# System prompt: identidad de Greta en MODO CRON SEO (NO comment-only). El método vive en el SKILL.
$systemPrompt = @"
Eres Greta, la especialista de growth de $($projectObj.name), corriendo tu REVISIÓN SEO SEMANAL programada (cron, sin issue de Linear de origen). Este turno NO es comment-only: auditas, propones y mantienes tu propia memoria.

Tu método completo está en la skill: LEE y sigue al pie el archivo $skillPath (usa el tool Read). No improvises el método; está todo ahí.

Reglas duras de este turno:
- READ-ONLY sobre prod (Supabase, GA4, GSC, CrUX/PSI). El ÚNICO write permitido es el archivo de memoria $memoryPath (con el tool Write). NUNCA escribas ningún otro archivo, y NUNCA escribas dentro de $prodRepo (ese repo es SOLO LECTURA, para la auditoría de frontend).
- Antes de proponer: LEE $memoryPath y reconcilia la disposición de cada hallazgo previo contra el estado de su issue [SEO] en Linear (Done => hecho, Canceled => wont-fix, comentario 'parcial/limitado' => hecho-parcial, sigue en Backlog => propuesto). No repitas lo ya propuesto ni lo marcado wont-fix.
- Salida en Linear (team $teamKey): un issue [Report] (SEO) (label agent-report, estado Backlog, sin asignar) + hasta 3-5 [Proposal] (SEO) NUEVOS (label agent-proposal + seo; estado Backlog; las 6 secciones canónicas de memory/CLAUDE.md). Al final del body de CADA issue agrega una línea '---' y debajo 'Generado por $signature'.
- Al terminar, REESCRIBE $memoryPath con las filas actualizadas + las nuevas.
- Si una fuente falla (ej. mcp__gsc__* no responde porque falta el prereq de la API/SA), DILO en el brief y sigue con el resto. No estimes números de memoria. No inventes datos.
- NO propongas regenerar guías ni posts (eso lo hacen workflows de n8n) — solo audita y optimiza lo existente.

Devuelve el brief completo en markdown como tu respuesta final (lo guarda el wrapper en $out). Empieza el brief con '${signature}:' y un veredicto corto.
"@

$userTask = "Ejecuta AHORA tu revisión SEO semanal: lee $skillPath y síguela al pie. No me describas el plan — corre las queries/tools, reconcilia la memoria contra Linear, crea el [Report] (SEO) y los [Proposal] (SEO) nuevos, reescribe $memoryPath, y devuelve el brief final en markdown."

$json = "" | claude -p $userTask `
  --append-system-prompt $systemPrompt `
  --model $Model `
  --effort $Effort `
  --mcp-config $mcpConfig `
  --strict-mcp-config `
  --permission-mode dontAsk `
  --allowedTools $allowed `
  --max-budget-usd $Budget `
  --output-format json `
  @addDirArgs
$exit = $LASTEXITCODE

$parsed = $null
try { $parsed = $json | ConvertFrom-Json } catch {}

if (-not $parsed) {
  Write-Error "claude -p no devolvió JSON parseable para greta-seo $Job (exit $exit). Salida cruda:`n$json"
  exit 1
}

# El wrapper escribe el brief (UTF-8 SIN BOM). $parsed.result es el markdown final.
$outAbs = Join-Path (Get-Location) $out
[System.IO.File]::WriteAllText($outAbs, [string]$parsed.result, (New-Object System.Text.UTF8Encoding($false)))

$parsed.result
"---"
"Brief: $out | Job: $Job | Model: $Model (effort $Effort)"
"Costo USD: $($parsed.total_cost_usd)"

if ($exit -ne 0 -or $parsed.is_error) {
  Write-Error "run-greta-seo falló para $Job (exit $exit, is_error=$($parsed.is_error))"
  exit 1
}
