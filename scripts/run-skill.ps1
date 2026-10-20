# Corre una skill headless desde n8n en el server WINDOWS.
#   uso:  powershell -ExecutionPolicy Bypass -NoProfile -File scripts\run-skill.ps1 -Skill signup-to-paid-tracker
#         ...-Skill funnel-monitor -Model claude-haiku-4-5-20251001   (override de modelo por corrida)
#         ...-Skill funnel-monitor -Project acme                      (multi-proyecto)
#         ...-DryRun                                                  (muestra la config resuelta, no llama a claude)
#         ...-DiscordWebhookVar DISCORD_WEBHOOK_NUMA                  (postea el resultado a ese webhook de Discord)
#         ...-Skill content-blog-publish-tick -NoPreCheck              (corre el agente aunque no haya posts vencidos)
#
# Tick de Leda: antes de llamar a claude para content-blog-publish-tick, el wrapper
# pregunta al CMS con el mismo helper de la skill (leda-helpers.ps1 -Action
# list-scheduled-due); si no hay posts vencidos deja constancia y sale sin llamar al modelo.
# Ver el bloque "Pre-check del tick" más abajo.
#
# Discord: con -DiscordWebhookVar <NOMBRE_DE_VAR>, el destino de la corrida es
# Discord y NO Linear: el prompt le dice al agente que no cree issue (salvo que su SKILL.md lo
# pida para un caso puntual) y que ponga el mensaje entre <discord>…</discord>; el WRAPPER
# postea SOLO ese bloque (las notas de trabajo del agente no llegan) al webhook que está en esa var
# (.env.server o .env.<slug>). Los agentes no hacen HTTP: el envío es del wrapper, como el
# mirror a queue/. Tope de Discord: 2000 caracteres (se trunca con aviso).
#
# Multi-proyecto: -Project (default 'acme'). El contexto sale de projects\<slug>\project.json vía scripts\project.ps1.
#
# Flags de `claude -p` verificadas contra Claude Code 2.1.152. Si actualizas el CLI,
# revalida con `claude --help` (--permission-mode, --allowedTools, --mcp-config,
# --strict-mcp-config, --max-budget-usd, --model, --output-format).
param(
  [Parameter(Mandatory = $true)][string]$Skill,
  [string]$Model,
  [string]$Project = 'acme',
  [int]$TimeoutMinutes = 0,   # 0 = usar el del agente (o 30 default). Override por cron pesado (ej. pm-weekly-digest en Opus).
  [string]$DiscordWebhookVar, # nombre de la env var con el webhook de Discord (ver cabecera). Vacío = sin Discord.
  [switch]$NoPreCheck,        # content-blog-publish-tick: saltea el pre-check y corre el agente igual.
  [switch]$DryRun
)
$ErrorActionPreference = "Stop"

# Raíz del repo (este script vive en scripts\)
Set-Location (Split-Path $PSScriptRoot -Parent)

# Secretos del server desde .env.server (formato KEY=value). NO un .env.local de tu laptop.
# Ver docs/server-setup.md §4.
$envFile = ".\.env.server"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
      $parts = $line.Split("=", 2)
      $key = $parts[0].Trim()
      $value = $parts[1].Trim()
      # Sacar comillas envolventes (convención .env): "valor" o 'valor'.
      # Sin esto, la key se pasa con las comillas y la API tira 401.
      if ($value.Length -ge 2 -and
          (($value.StartsWith('"') -and $value.EndsWith('"')) -or
           ($value.StartsWith("'") -and $value.EndsWith("'")))) {
        $value = $value.Substring(1, $value.Length - 2)
      }
      Set-Item -Path ("Env:" + $key) -Value $value
    }
  }
}

# Refrescar PATH desde el registry de Windows. El servicio n8n-local captura el env
# al arrancar, así que cualquier binario instalado DESPUÉS (winget, etc.) no aparece
# en su $env:PATH hasta que reinicie. Aquí lo re-leemos en cada invocación.
$env:PATH = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')

# Billing: correr contra la suscripción (login OAuth de `claude login`), NO la API key.
# Claude Code usa ANTHROPIC_API_KEY si está en el env (factura API, pago por token). La
# sacamos para que caiga en las credenciales OAuth de %USERPROFILE%\.claude\.credentials.json
# (el USERPROFILE se redirige al user real más abajo). Para volver a billing por API,
# borra estas 2 líneas — la key sigue guardada en .env.server. OJO: la suscripción comparte los
# rate limits con tu uso interactivo (claude.ai / Claude Code).
Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:ANTHROPIC_AUTH_TOKEN -ErrorAction SilentlyContinue

# `claude` busca credenciales en %USERPROFILE%\.claude\.credentials.json. Cuando este
# script corre bajo una cuenta sin login interactivo (ej. n8n como LocalSystem en el
# server), esa ruta apunta a C:\Windows\System32\config\systemprofile y no hay auth.
# Si CLAUDE_USERPROFILE está seteada en .env.server, redirigimos USERPROFILE al
# perfil del usuario real que sí corrió `claude login`. No-op en máquinas donde la
# variable no está seteada (laptop de dev).
if ($env:CLAUDE_USERPROFILE) {
  $env:USERPROFILE = $env:CLAUDE_USERPROFILE
  # Con el native installer de claude, el binario vive en
  # %USERPROFILE%\.local\bin\claude.exe (no en el global de npm). .local\bin del
  # usuario real suele estar en el PATH de la máquina, pero lo prependeamos igual para
  # que el wrapper resuelva claude aunque corra en un server recién configurado.
  $claudeBin = Join-Path $env:CLAUDE_USERPROFILE '.local\bin'
  if (Test-Path $claudeBin) { $env:PATH = "$claudeBin;$env:PATH" }
}

# Multi-proyecto: roster (agents.ps1) + contexto del proyecto (project.ps1).
# Resolve-ProjectContext carga .env.<slug> ENCIMA de .env.server (que ya cargamos arriba).
. "$PSScriptRoot\agents.ps1"
. "$PSScriptRoot\project.ps1"
$projectObj = Resolve-ProjectContext -Slug $Project

$stamp = Get-Date -Format "yyyy-MM-dd"
$out = "queue/pending-review/$stamp-$($projectObj.slug)-$Skill.md"
New-Item -ItemType Directory -Force -Path "queue/pending-review" | Out-Null

# Identidad opcional del agente dueño de la skill — se lee del frontmatter `agent: <name>`
# de la SKILL.md. Si está presente, el wrapper toma del registry (`scripts\agents.ps1`):
#   - $agent.AllowedTools  → `--allowedTools` (clave para Leda: necesita Bash para leda-helpers.ps1)
#   - $agent.Budget        → `--max-budget-usd` (override del cap global)
#   - $agent.Model         → `--model` (fallback debajo de -Model param y ANTHROPIC_MODEL env)
#   - $agent.McpConfig     → `--mcp-config` (override del default growth)
#   - $agent.AdditionalDirs→ `--add-dir` (Leda/Cody/Daly leen el repo del producto)
#   - $agent.Effort        → `--effort` (Cody xhigh; no aplica a cron actuales)
# Si la skill NO declara agent, fallback al hardcoded histórico (Read + supabase + linear, sin Bash).
# Mismo patrón que run-qualy.ps1 y respond-linear.ps1 — single source of truth en agents.ps1.
$skillAgent = $null
# Opcionales de la skill: `mcp_variant: <nombre>` elige una variante de
# project.json → mcpVariants para ESTA skill (pisa la del agente) y `extra_allowed_tools:
# a,b` suma tools al allowlist del agente. Caso de uso: un content-topic-scan que necesita
# Search Console (variante 'seo' + mcp__gsc__*), que el loadout diario de Leda no
# levanta. Sin estas claves, nada cambia.
$skillMcpVariant = $null
$skillExtraTools = $null
# Búsqueda de la SKILL.md: primero en el proyecto (projects\<slug>\skills\), fallback
# a plugins\*\skills\ (skills compartidas entre proyectos).
$skillFile = Get-ChildItem -Path "projects\$($projectObj.slug)\skills\$Skill\SKILL.md" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $skillFile) {
  $skillFile = Get-ChildItem -Path "plugins\*\skills\$Skill\SKILL.md" -ErrorAction SilentlyContinue | Select-Object -First 1
}
if (-not $skillFile) {
  Write-Warning "SKILL.md de '$Skill' no encontrada ni en projects\$($projectObj.slug)\skills\ ni en plugins\*\skills\ — sigo igual (el agente puede resolverla por nombre), pero revisa el -Skill."
}
if ($skillFile) {
  $content = Get-Content $skillFile.FullName -Raw -Encoding UTF8
  if ($content -match '(?ms)^---\s*\r?\n(.*?)\r?\n---') {
    $frontmatter = $matches[1]
    if ($frontmatter -match '(?m)^agent:\s*(\S+)') {
      $skillAgent = $matches[1].Trim()
    }
    if ($frontmatter -match '(?m)^mcp_variant:\s*["'']?([A-Za-z0-9_-]+)') {
      $skillMcpVariant = $matches[1].Trim()
    }
    if ($frontmatter -match '(?m)^extra_allowed_tools:\s*["'']?([^"''#\r\n]+)') {
      $skillExtraTools = $matches[1].Trim().TrimEnd(',')
    }
  }
}

$agent = $null
$agentFooterDirective = ""
if ($skillAgent) {
  try {
    $agent = Get-Agent -Name $skillAgent
    $signature = Get-AgentSignature -Name $skillAgent
    $agentFooterDirective = " Al final del body del issue de Linear, agrega una linea separadora '---' y debajo la firma exacta 'Generado por $signature'."
  } catch {
    Write-Warning "SKILL.md de $Skill declara agent='$skillAgent' pero no está en agents.ps1. Sigo con defaults hardcoded."
  }
}

# Los repos del producto al día antes de que el agente los lea (Sync-ProjectRepos en project.ps1).
# No en los ticks (`*-tick`, ej. el de Leda): no leen código.
if (-not $DryRun -and $skillAgent -and $Skill -notlike "*-tick") { Sync-ProjectRepos -Project $projectObj }

# Tiering de modelo (priority: -Model param > agent.Model > ANTHROPIC_MODEL env > sonnet default).
# Los workflows de funnel-monitor / leda-publish-tick pasan -Model haiku para abaratar.
$model = if ($Model) { $Model }
         elseif ($agent -and $agent.Model) { $agent.Model }
         elseif ($env:ANTHROPIC_MODEL) { $env:ANTHROPIC_MODEL }
         else { "claude-sonnet-4-6" }

# AllowedTools: si la skill declara agent, lee del registry; sino fallback histórico.
# Crítico para Leda: necesita Bash + PowerShell para invocar leda-helpers.ps1 — sin esto
# quedan bloqueados por --permission-mode dontAsk y el agente falla silencioso reportando
# "shell bloqueado".
$allowed = if ($agent -and $agent.AllowedTools) { $agent.AllowedTools }
           else { "Read,mcp__supabase__*,mcp__linear__*" }

# Budget per-corrida: backstop profundo, NO el guard principal (corre contra una
# suscripción OAuth — el guard de runaway es el watchdog de TIEMPO, ver abajo).
$budget = if ($agent -and $agent.PSObject.Properties['Budget'] -and $agent.Budget) { $agent.Budget }
          elseif ($env:PER_RUN_BUDGET_USD) { $env:PER_RUN_BUDGET_USD }
          elseif ($env:DAILY_BUDGET_USD) { $env:DAILY_BUDGET_USD }
          else { "50" }

# MCP config: variante del agente si la declara (Qualy='qa', Daly='design'), resuelta
# contra project.json → mcpVariants; sino el MCP default del proyecto.
$mcpConfig = if ($agent) { Resolve-AgentMcpConfig -Agent $agent -Project $projectObj }
             else { ".\$($projectObj.mcpConfig)" }

# Overrides de la skill (frontmatter mcp_variant / extra_allowed_tools, ver arriba).
if ($skillMcpVariant) {
  $vprop = $null
  if ($projectObj.PSObject.Properties['mcpVariants'] -and $projectObj.mcpVariants) {
    $vprop = $projectObj.mcpVariants.PSObject.Properties[$skillMcpVariant]
  }
  if ($vprop -and $vprop.Value) { $mcpConfig = ".\$($vprop.Value)" }
  else { Write-Warning "La skill $Skill pide la variante MCP '$skillMcpVariant' pero $($projectObj.slug) no la define — sigo con $mcpConfig." }
}
if ($skillExtraTools) { $allowed = "$allowed,$skillExtraTools" }

# AdditionalDirs (--add-dir): para leer fuera del cwd. El registry usa el placeholder
# {{PRODUCT_REPO_PATH}} que aquí se resuelve al repo del producto DEL proyecto.
$addDirArgs = @()
if ($agent -and $agent.AdditionalDirs) {
  $addDirArgs = Resolve-AgentAdditionalDirs -Agent $agent -Project $projectObj
}

# Effort opcional (Cody xhigh; ningún cron actual lo declara pero queda por consistencia).
$effortArgs = @()
if ($agent -and $agent.Effort) { $effortArgs += @('--effort', $agent.Effort) }

$skillFileHint = if ($skillFile) { " Su SKILL.md está en '$($skillFile.FullName)'." } else { "" }
$prompt = if ($DiscordWebhookVar) {
  "Estás trabajando para el proyecto $($projectObj.name). Usa la skill $Skill.$skillFileHint " +
  "Sigue su SKILL.md al pie: carga el glossary y el data-model del proyecto (en $($projectObj.contextDir)\) y corre las queries read-only que pide. " +
  "Fecha de esta corrida (calculada por el wrapper, úsala tal cual — no la deduzcas): $((Get-Date).ToString('dddd dd-MMM-yyyy HH:mm', [Globalization.CultureInfo]::GetCultureInfo('es-ES'))) (hora del server). " +
  "El destino de esta corrida es DISCORD, no Linear: NO crees issue en Linear salvo que el SKILL.md lo pida explícitamente para un caso puntual. " +
  "En tu respuesta final, pon el mensaje de Discord EXACTO entre una línea '<discord>' y una línea '</discord>' (el wrapper postea SOLO lo que está entre esas marcas; cualquier nota de trabajo va afuera y no llega a Discord). Respeta el formato y el largo que define el SKILL.md (máximo 1800 caracteres)."
} else {
  "Estás trabajando para el proyecto $($projectObj.name). Usa la skill $Skill.$skillFileHint " +
  "Sigue su SKILL.md al pie: carga el glossary y el data-model del proyecto (en $($projectObj.contextDir)\), " +
  "corre las queries read-only contra Supabase, y crea el issue en Linear (team $($projectObj.linear.teamKey), estado Backlog, sin asignar) " +
  "ELIGIENDO EL LABEL por tipo según memory/CLAUDE.md § ""Dos destinos: decisión vs registro"": " +
  "si lo que dejas PIDE una decisión (propuesta/alerta/hallazgo accionable) va con label agent-proposal; " +
  "si solo deja CONSTANCIA (un [Report]/digest/tick) va con label agent-report, uno por corrida con título fijo de serie, y NO lo cierres (lo archiva el lead); " +
  "un tick SIN novedades NO crea issue (alcanza el espejo en queue/pending-review)." +
  $agentFooterDirective + " " +
  "Devuelve el brief completo en markdown como tu respuesta final (lo guarda el wrapper)."
}

# Send-DiscordMessage vive en project.ps1 (lo comparte run-pico-shipped.ps1).
$discordUrl = if ($DiscordWebhookVar) { [Environment]::GetEnvironmentVariable($DiscordWebhookVar) } else { $null }

$tickPreCheck = ($Skill -eq 'content-blog-publish-tick') -and -not $NoPreCheck

if ($DryRun) {
  "=== DRY RUN run-skill (no se llamó a claude) ==="
  "Project : $($projectObj.slug) | Skill: $Skill"
  "SkillFile: $(if ($skillFile) { $skillFile.FullName } else { '(no encontrada)' })"
  "Agent   : $(if ($agent) { $agent.Name } else { '(sin agent en frontmatter)' }) | Model: $model | Budget: $budget"
  "MCP     : $mcpConfig"
  "Allowed : $allowed"
  "AddDirs : $(if ($addDirArgs) { $addDirArgs -join ' ' } else { '(ninguno)' })"
  "Out     : $out"
  "Team    : $($projectObj.linear.teamKey) | SUPABASE_PROJECT_REF: $env:SUPABASE_PROJECT_REF"
  "Vercel  : $(Format-ProjectVercelPin)"
  if ($DiscordWebhookVar) { "Discord : $DiscordWebhookVar → $(if ($discordUrl) { 'configurado (' + $discordUrl.Length + ' chars)' } else { 'VACÍO — no se va a postear' })" }
  if ($tickPreCheck) { "PreCheck: list-scheduled-due ($($projectObj.slug)) — sin posts vencidos sale sin llamar a claude" }
  exit 0
}

# Pre-check del tick: una corrida de Sonnet sobre la suscripción no tiene sentido cuando no hay
# nada vencido (un día sin post nuevo, o cualquier tick si alguna vez corre más seguido). El helper
# es el mismo que usa la skill en su Paso 1. Ante cualquier duda (el helper falla, la salida no
# es JSON, hay posts) sigue como siempre y corre el agente.
if ($tickPreCheck) {
  $preStart = Get-Date
  $dueRaw = $null; $dueExit = 1
  # Con "Stop", PS 5.1 corta el script si el helper escribe algo en stderr (lo envuelve como error).
  $prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try {
    $dueRaw = & powershell -ExecutionPolicy Bypass -NoProfile -File "$PSScriptRoot\leda-helpers.ps1" -Action list-scheduled-due -Project $projectObj.slug 2>$null
    $dueExit = $LASTEXITCODE
  } catch { $dueRaw = $null } finally { $ErrorActionPreference = $prevEap }
  # Un warning del helper puede salir antes del JSON: se parsea desde la primera línea que
  # empieza con '[' (el array de ConvertTo-Json arranca así; un "ADVERTENCIA: ..." no).
  $dueLines = @($dueRaw | ForEach-Object { [string]$_ })
  $jsonLine = -1
  for ($k = 0; $k -lt $dueLines.Count; $k++) { if ($dueLines[$k].TrimStart().StartsWith('[')) { $jsonLine = $k; break } }
  # El ForEach-Object enumera el array en PS 5.1 (ConvertFrom-Json lo emite como UN objeto, y un
  # @() directo daría Count 1 con la lista vacía) y en PS 7 (que ya lo enumera). El parseo se
  # registra aparte: una lista vacía bien parseada y un parseo fallido no son lo mismo.
  $due = @(); $dueParsed = $false
  if ($dueExit -eq 0 -and $jsonLine -ge 0) {
    try {
      $due = @(ConvertFrom-Json -InputObject ($dueLines[$jsonLine..($dueLines.Count - 1)] -join "`n") | ForEach-Object { $_ })
      $dueParsed = $true
    } catch { $dueParsed = $false }
  }
  if ($dueParsed -and $due.Count -eq 0) {
    # Sin posts vencidos. El espejo del día no se pisa: si una corrida anterior de hoy publicó
    # algo, su brief queda.
    $outAbs = Join-Path (Get-Location) $out
    if (-not (Test-Path $outAbs)) {
      $brief = "# Tick $Skill — $(Get-Date -Format 'yyyy-MM-dd HH:mm') ($($projectObj.slug))`n`nTick limpio: 0 posts vencidos. Lo resolvió el pre-check del wrapper (leda-helpers.ps1 -Action list-scheduled-due), sin llamar al modelo.`n"
      [System.IO.File]::WriteAllText($outAbs, $brief, (New-Object System.Text.UTF8Encoding($false)))
    }
    Write-AgentAudit -Wrapper 'run-skill' -ProjectSlug $projectObj.slug -Name $Skill -Model 'precheck' -CostUsd 0 -DurationS ((Get-Date) - $preStart).TotalSeconds -IsError $false
    "Tick limpio: 0 posts vencidos en $($projectObj.slug). Pre-check sin modelo: no se llamó a claude."
    "Brief: $out"
    exit 0
  }
  if (-not $dueParsed) { Write-Warning "Pre-check del tick sin respuesta válida del helper (exit $dueExit) — corro el agente igual." }
}

# Guard de runtime por tiempo (ver project.ps1): si claude excede el timeout del
# agente (default 30 min), el watchdog mata el árbol de procesos (claude + MCPs).
$timeoutMin = if ($TimeoutMinutes -gt 0) { $TimeoutMinutes } else { Resolve-AgentTimeout -Agent $agent }
$watchdog = Start-AgentWatchdog -TimeoutMinutes $timeoutMin
$runStart = Get-Date

# Flags verificadas contra Claude Code 2.1.152.
# --strict-mcp-config: usa SOLO los MCP de este archivo (no mezclar con config user/global).
$json = claude -p $prompt `
  --model $model `
  --mcp-config $mcpConfig `
  --strict-mcp-config `
  --permission-mode dontAsk `
  --allowedTools $allowed `
  --max-budget-usd $budget `
  --output-format json `
  @effortArgs @addDirArgs

$exit = $LASTEXITCODE
$timedOut = Stop-AgentWatchdog $watchdog
$durationS = ((Get-Date) - $runStart).TotalSeconds

# Parsear el JSON nativo de PowerShell (sin jq). Lo hacemos ANTES de cortar por exit
# code: cuando claude falla (ej. 401, budget excedido) igual devuelve JSON con el
# detalle en .result — si saliéramos antes, perderíamos el motivo del error.
$parsed = $null
try { $parsed = $json | ConvertFrom-Json } catch {}

if (-not $parsed) {
  Write-AgentAudit -Wrapper 'run-skill' -ProjectSlug $projectObj.slug -Name $Skill -Model $model -CostUsd $null -DurationS $durationS -IsError $true -TimedOut $timedOut
  $timeoutNote = if ($timedOut) { " TIMEOUT: el watchdog mató la corrida a los $timeoutMin min." } else { "" }
  Write-Error "claude -p no devolvió JSON parseable para $Skill (exit $exit).$timeoutNote Salida cruda:`n$json"
  exit 1
}

# El wrapper escribe el brief (no el agente). $parsed.result es el markdown final.
# UTF-8 SIN BOM (Out-File -Encoding utf8 de PS 5.1 mete BOM y ensucia el archivo).
$outAbs = Join-Path (Get-Location) $out
[System.IO.File]::WriteAllText($outAbs, [string]$parsed.result, (New-Object System.Text.UTF8Encoding($false)))

Write-AgentAudit -Wrapper 'run-skill' -ProjectSlug $projectObj.slug -Name $Skill -Model $model -CostUsd $parsed.total_cost_usd -DurationS $durationS -IsError ([bool]$parsed.is_error) -TimedOut $timedOut

$parsed.result
"---"
"Brief: $out"
"Costo USD: $($parsed.total_cost_usd) | Duración: $([math]::Round($durationS))s"

# Destino Discord (solo si la corrida salió bien y hay texto): lo postea el wrapper.
if ($DiscordWebhookVar) {
  if (-not $discordUrl) { Write-Warning "-DiscordWebhookVar $DiscordWebhookVar está vacía — no posteé a Discord (cárgala en .env.$($projectObj.slug))." }
  elseif ($exit -ne 0 -or $parsed.is_error -or -not [string]$parsed.result) { Write-Warning "La corrida falló — no posteo a Discord un resultado roto." }
  else {
    # Solo lo que está entre <discord>…</discord>; sin marcas, el resultado entero (con aviso).
    $raw = [string]$parsed.result
    $m = [regex]::Match($raw, '(?s)<discord>\s*(.*?)\s*</discord>')
    $msg = if ($m.Success) { $m.Groups[1].Value } else { Write-Warning "El resultado no trae <discord>…</discord> — posteo el resultado entero."; $raw }
    if (Send-DiscordMessage -WebhookUrl $discordUrl -Text $msg) { "Discord: enviado ($DiscordWebhookVar, $($msg.Length) caracteres)." }
  }
}

if ($exit -ne 0 -or $parsed.is_error) {
  Write-Error "claude -p falló para $Skill (exit $exit, is_error=$($parsed.is_error))"
  exit 1
}
