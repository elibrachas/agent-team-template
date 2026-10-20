# Corre a Greta (growth) en su REVISIÓN AEO SEMANAL programada (cron de n8n).
#   uso:  powershell -ExecutionPolicy Bypass -NoProfile -File scripts\run-greta-aeo.ps1 -Job weekly-review
#         powershell -ExecutionPolicy Bypass -NoProfile -File scripts\run-greta-aeo.ps1 -DryRun   # imprime config, no llama a claude
#
# Qué hace: AEO = Answer Engine Optimization (aparecer/ser citada en respuestas de IA — ChatGPT,
# Perplexity, Gemini, AI Overviews). Mide el canal "AI Assistant" de GA4, audita la AEO-readiness
# del frontend del repo del producto (llms.txt, cobertura de schema, SSR/extractabilidad, entidad),
# proba answer-engines vía WebSearch (PROXY), reconcilia contra su memoria (aeo-memory.md) y el board
# de Linear (incluyendo los issues [SEO] por la regla de complementariedad), y deja (1) un [Report]
# (AEO) semanal, (2) hasta 3-5 [Proposal] (AEO) nuevos, y (3) la memoria actualizada.
# HITL-1: read-only sobre prod; los DOS writes son la memoria + la sección viva del plan.
#
# COMPLEMENTARIO al cron SEO (run-greta-seo.ps1), NO lo reemplaza. El plan vivo está en
# plugins/team-growth/skills/aeo-weekly-review/aeo-strategy.md: la ESTRATEGIA (§3+) es la brújula
# que Greta LEE; la SECCIÓN VIVA (§1 Estado/avances, §2 Próximos pasos) la REESCRIBE. Cody también
# appendea avances a §1 cuando implementa un issue con label aeo (ver su override de proyecto).
#
# POR QUÉ UN WRAPPER DEDICADO (y no run-skill.ps1 + el registry de Greta):
#   El Model/AllowedTools/McpConfig de Greta en agents.ps1 los comparte el LISTENER de Linear
#   (respond-linear.ps1, comment-only / read-only / tier barato). El cron de AEO necesita un
#   loadout MÁS PESADO y con Write (+ WebSearch) que NO debe filtrarse a las respuestas casuales
#   de Linear. Por eso este wrapper HARDCODEA el loadout del run de AEO (Opus 4.8 high, Write acotado,
#   WebSearch, --add-dir <repo del producto>, aeo.mcp.json) y solo toma de agents.ps1 la IDENTIDAD/firma.
#
# Flags verificadas contra el mismo set que run-greta-seo.ps1. Si actualizas el CLI, revalida con
# `claude --help` (en especial que WebSearch esté en el set de allowedTools soportado por el headless).
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

# Secretos del server desde .env.server (mismo loader que run-skill/run-qualy/run-greta-seo/respond-linear).
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
# Los repos del producto al día antes de leerlos (Sync-ProjectRepos en project.ps1).
if (-not $DryRun) { Sync-ProjectRepos -Project $projectObj }
$teamKey = $projectObj.linear.teamKey

# Roster → Greta (SOLO para identidad/firma; el loadout pesado se hardcodea abajo).
# La firma con emoji (Greta) sale de agents.ps1 vía el helper (single source, ya BOM-encodeado).
. "$PSScriptRoot\agents.ps1"
$agent = Get-Agent -Name 'greta'
$signature = Get-AgentSignature -Name 'greta'

$stamp = Get-Date -Format "yyyy-MM-dd"
$out = "queue/pending-review/$stamp-$($projectObj.slug)-greta-aeo.md"
New-Item -ItemType Directory -Force -Path "queue/pending-review" | Out-Null

# --- Loadout HARDCODEADO del run de AEO (decoplado del registry de Greta) ---
# Write: SOLO la memoria (reescritura completa) + la sección viva §1-2 del plan (el HARD STOP del
# SKILL lo acota a esos dos archivos). Glob/Grep: para la
# auditoría de readiness del repo del producto. WebSearch: el probing de citación (proxy declarado).
# aeo.mcp.json: loadout mínimo (supabase + linear + ga4); SIN gsc/cwv (eso es SEO).
$allowed = "Read,Glob,Grep,Write,WebSearch,mcp__supabase__*,mcp__linear__*,mcp__ga4__*,mcp__mysql__*"

# Skill + memorias: primero projects\<slug>\skills\, fallback al plugin compartido (team-growth).
$skillPath = "projects/$($projectObj.slug)/skills/aeo-weekly-review/SKILL.md"
if (-not (Test-Path $skillPath)) { $skillPath = "plugins/team-growth/skills/aeo-weekly-review/SKILL.md" }
$skillDir = (Split-Path $skillPath -Parent).Replace('\','/')
$memoryPath = "$skillDir/aeo-memory.md"
$strategyPath = "$skillDir/aeo-strategy.md"

# MCP: project.json → mcpVariants.aeo; fallback al aeo.mcp.json del plugin compartido.
$mcpConfig = ".\plugins\team-growth\aeo.mcp.json"
if ($projectObj.PSObject.Properties['mcpVariants'] -and $projectObj.mcpVariants.PSObject.Properties['aeo']) {
  $mcpConfig = ".\$($projectObj.mcpVariants.aeo)"
}

# Lectura de los repos del producto (frontend AEO-readiness: robots/llms.txt/json-ld/SSR/entidad).
# Multi-repo: se montan TODOS los repos de project.json → productRepos
# (en proyectos de un solo repo, == productRepoPath). Todos son SOLO LECTURA aquí.
$addDirArgs = Get-ProjectRepoAddDirArgs -Project $projectObj -Who 'Greta'
if (-not $addDirArgs) { Write-Warning "No encontré ningún repo del producto — la auditoría de readiness correrá degradada." }
$prodRepo = ((Get-ProjectRepos -Project $projectObj) | ForEach-Object { $_.path }) -join ', '
$repoList = Format-ProjectRepos -Project $projectObj

# System prompt: identidad de Greta en MODO CRON AEO (NO comment-only). El método vive en el SKILL.
$systemPrompt = @"
Eres Greta, la especialista de growth de $($projectObj.name), corriendo tu REVISIÓN AEO SEMANAL programada (cron, sin issue de Linear de origen). AEO = Answer Engine Optimization: aparecer/ser citada en respuestas de motores de IA (ChatGPT, Perplexity, Gemini, AI Overviews, Claude). Este turno NO es comment-only: mides, auditas, propones y mantienes tu propia memoria. Es COMPLEMENTARIO a tu revisión SEO — no lo dupliques.

Tu plan vivo está en ${strategyPath}: LÉELO primero (usa Read). Sus secciones de ESTRATEGIA (§3 en adelante: pilares, medición, complementariedad, horizontes, guardrails) son la brújula estable — NO las reescribas salvo un giro real (y avísalo en el [Report]). Su SECCIÓN VIVA (§1 Estado y avances, §2 Próximos pasos) SÍ la mantienes tú: la reconcilias y reescribes al final.

Tu método completo está en la skill: LEE y sigue al pie el archivo $skillPath (usa el tool Read). No improvises el método; está todo ahí.

Repos del producto montados (SOLO LECTURA — la skill dice cuál es la superficie de cada auditoría):
$repoList

Reglas duras de este turno:
- READ-ONLY sobre prod (Supabase, GA4). Tienes DOS writes permitidos (tool Write): (1) el ledger $memoryPath (reescritura completa); (2) la SECCIÓN VIVA de tu plan $strategyPath, pero SOLO §1 (Estado y avances) y §2 (Próximos pasos) — las secciones de estrategia (§3 en adelante) son ESTABLES, no las toques salvo giro real avisado en el [Report]. NUNCA escribas ningún otro archivo, y NUNCA nada dentro de los repos del producto ($prodRepo) (esos repos son SOLO LECTURA, para la auditoría de readiness del frontend).
- Antes de proponer: LEE $memoryPath y reconcilia la disposición de cada hallazgo previo contra el estado de su issue en Linear (Done => hecho, Canceled => wont-fix, comentario 'parcial/limitado' => hecho-parcial, sigue en Backlog => propuesto). REGLA DE COMPLEMENTARIEDAD: lee TAMBIÉN el board de SEO (issues con label 'seo'); si una mejora sirve a las dos superficies y ya existe como issue 'seo', NO crees uno nuevo — comenta ese issue con el rationale AEO y regístralo en la memoria apuntando a su ID de issue. No repitas lo ya propuesto, lo marcado wont-fix, ni temas de ranking puro (eso es de SEO).
- VERIFICA CONTRA EL CÓDIGO antes de proponer (memory/CLAUDE.md § "Verifica contra el código, no contra esta base"): tu contexto de negocio PUEDE estar viejo. Confirma en el repo (ya sincronizado a main al inicio de la corrida) el archivo / ruta / llms.txt / schema que nombra tu propuesta; si ya está implementado o el código desmiente la premisa, NO lo propongas y anota qué dato quedó viejo. No afirmes un archivo:línea sin releerlo en la copia actual.
- WebSearch es un PROXY de la respuesta real de ChatGPT/Perplexity — úsalo para el pulso cualitativo del probing, decláralo como proxy en el [Report], y NO cuantifiques 'citation share'. Si WebSearch no está disponible, marca esa sección como no disponible y sigue.
- Salida en Linear (team $teamKey): un issue [Report] (AEO) (label agent-report, estado Backlog, sin asignar) + hasta 3-5 [Proposal] (AEO) NUEVOS (label agent-proposal + aeo; crea el label aeo si no existe; estado Backlog; las 6 secciones canónicas de memory/CLAUDE.md). Al final del body de CADA issue agrega una línea '---' y debajo 'Generado por $signature'.
- Al terminar, REESCRIBE $memoryPath (filas actualizadas + nuevas) Y la sección viva §1-2 de $strategyPath (reconciliada contra Linear: bumpea el estado actual, actualiza los avances/cerrado —respetando lo que Cody haya appendeado—, mantén ~12 recientes y poda lo viejo, y re-prioriza los próximos pasos).
- Si una fuente falla (ej. mcp__ga4__* no responde, o no hay bucket de canal IA en Supabase), DILO en el brief y sigue con el resto. No estimes números de memoria. No inventes datos. Reporta n además de % (el canal IA es de bajo volumen).
- NO propongas regenerar guías ni posts (eso lo hacen workflows de n8n) — solo audita, estructura y optimiza lo existente.

Devuelve el brief completo en markdown como tu respuesta final (lo guarda el wrapper en $out). Empieza el brief con '${signature}:' y un veredicto corto.
"@

$userTask = "Ejecuta AHORA tu revisión AEO semanal: lee $strategyPath (north star) y $skillPath, y síguela al pie. No me describas el plan — mide el canal AI Assistant (GA4), audita la readiness del frontend, prueba con WebSearch (proxy), reconcilia la memoria contra Linear (incluyendo el board de SEO), crea el [Report] (AEO) y los [Proposal] (AEO) nuevos, reescribe $memoryPath + la sección viva §1-2 de $strategyPath, y devuelve el brief final en markdown."

# --- DryRun: imprime la config resuelta y sale (no llama a claude) ---
if ($DryRun) {
  "=== run-greta-aeo.ps1 (DryRun) ==="
  "Project:    $($projectObj.slug) | Team: $teamKey"
  "Job:        $Job"
  "Model:      $Model (effort $Effort)"
  "Budget USD: $Budget"
  "Allowed:    $allowed"
  "McpConfig:  $mcpConfig"
  "Skill:      $skillPath"
  "Strategy:   $strategyPath"
  "Memory:     $memoryPath"
  "Out:        $out"
  "AddDirs:    $(if ($addDirArgs.Count) { $addDirArgs -join ' ' } else { '(ninguno encontrado)' })"
  "Signature:  $signature"
  "(DryRun: no se llama a claude.)"
  exit 0
}

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
  Write-Error "claude -p no devolvió JSON parseable para greta-aeo $Job (exit $exit). Salida cruda:`n$json"
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
  Write-Error "run-greta-aeo falló para $Job (exit $exit, is_error=$($parsed.is_error))"
  exit 1
}
