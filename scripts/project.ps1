# Capa multi-proyecto. Dot-source desde un wrapper: . "$PSScriptRoot\project.ps1"
# (después de haber cargado .env.server — Resolve-ProjectContext carga .env.<slug> ENCIMA).
#
# Modelo: el roster de agentes es UNO (scripts\agents.ps1, core). Todo lo específico
# de un proyecto vive en projects\<slug>\ (project.json + contexto + agent-overrides
# + skills + .mcp.json) y en .env.<slug>. Ver projects\README.md.

# Vars que son POR PROYECTO. Cuando existe .env.<slug>, se limpian ANTES de cargarlo
# para que nada del proyecto anterior (o de .env.server legacy) se filtre a la corrida.
# Si agregas una var project-scoped a un .env.<slug>.example, agrégala aquí también.
$ProjectScopedVars = @(
  'SUPABASE_PROJECT_REF', 'SUPABASE_ACCESS_TOKEN',
  'GA4_PROPERTY_ID', 'GA4_SERVICE_ACCOUNT_JSON_PATH',
  'GSC_SERVICE_ACCOUNT_JSON_PATH', 'GSC_SITE_URL',
  'GOOGLE_PROJECT_ID', 'GOOGLE_API', 'GOOGLE_API_KEY',
  'STRIPE_RESTRICTED_KEY',
  'PAYLOAD_API_KEY', 'PAYLOAD_BASE_URL', 'GEMINI_API_KEY',
  'VERCEL_API_TOKEN', 'VERCEL_PROJECT_ID'
)

# Loader de archivos KEY=value (mismo formato y strip de comillas que el loader
# de .env.server que ya tienen los wrappers).
function Import-EnvFile {
  param([Parameter(Mandatory = $true)][string]$Path)
  Get-Content $Path | ForEach-Object {
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

# Devuelve el project.json parseado. Falla ruidoso si el slug no existe.
function Get-Project {
  param([Parameter(Mandatory = $true)][string]$Slug)
  $key = $Slug.Trim().ToLower()
  $path = "projects\$key\project.json"
  if (-not (Test-Path $path)) {
    $known = (Get-ChildItem "projects\*\project.json" -ErrorAction SilentlyContinue |
              ForEach-Object { $_.Directory.Name }) -join ', '
    throw "Proyecto desconocido: '$Slug' (no existe $path). Conocidos: $known"
  }
  # -Encoding UTF8 OBLIGATORIO: PS 5.1 sin encoding lee ANSI (CP1252) y los project.json
  # no tienen BOM → "español neutro" llegaba como "espaÃ±ol neutro" a {{LANGUAGE_CONVENTION}}
  # / {{STRATEGIC_FOCUS}} en el system prompt de TODOS los agentes (y eso empuja a los
  # agentes a evitar tildes en contenido customer-facing).
  return (Get-Content $path -Raw -Encoding UTF8 | ConvertFrom-Json)
}

# Carga el contexto del proyecto: devuelve el objeto project.json y deja las env vars
# listas. Orden CRÍTICO: el wrapper ya cargó .env.server (core); aquí, SI existe
# .env.<slug>, limpiamos las vars project-scoped y cargamos el archivo del proyecto
# encima. Si NO existe, se avisa fuerte: las vars project-scoped quedan con lo que
# haya en .env.server (que idealmente no tiene ninguna).
function Resolve-ProjectContext {
  param([Parameter(Mandatory = $true)][string]$Slug)
  $project = Get-Project -Slug $Slug
  $envFile = ".\$($project.envFile)"
  if (Test-Path $envFile) {
    foreach ($v in $ProjectScopedVars) { Remove-Item "Env:$v" -ErrorAction SilentlyContinue }
    Import-EnvFile $envFile
  }
  else {
    Write-Warning "$envFile no existe: las vars project-scoped quedan con los valores de .env.server (si los hay). Crea $($project.envFile) (template: $($project.envFile).example) antes de correr $($project.name) contra datos reales."
  }
  return $project
}

# Mapea el teamId del webhook de Linear al slug del proyecto, leyendo todos los
# projects\*\project.json. Falla ruidoso si no matchea — NUNCA defaultear en silencio
# (un default silencioso = el agente contesta con el contexto del proyecto equivocado).
function Resolve-ProjectSlugFromLinearTeamId {
  param([Parameter(Mandatory = $true)][string]$TeamId)
  $tid = $TeamId.Trim()
  if ([string]::IsNullOrWhiteSpace($tid) -or $tid -in @('undefined', 'null')) {
    throw "TeamId inválido recibido del workflow: '$TeamId'. Revisar la expresión del Execute Command en n8n."
  }
  $found = @()
  Get-ChildItem "projects\*\project.json" | ForEach-Object {
    $p = Get-Content $_.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($p.linear.teamId -and ($p.linear.teamId -eq $tid)) { $found += $p.slug }
  }
  if ($found.Count -eq 1) { return $found[0] }
  if ($found.Count -eq 0) {
    throw "Ningún projects\*\project.json tiene linear.teamId='$tid'. Si es un team nuevo, completa el teamId en su project.json."
  }
  throw "linear.teamId='$tid' duplicado en: $($found -join ', '). Corrige los project.json."
}

# Variante por teamKey ("ACM") — útil cuando el webhook no trae teamId pero el
# IssueId viene como identifier humano ("ACM-12": el prefijo ES el team key).
function Resolve-ProjectSlugFromLinearTeamKey {
  param([Parameter(Mandatory = $true)][string]$TeamKey)
  $tk = $TeamKey.Trim().ToUpper()
  $found = @()
  Get-ChildItem "projects\*\project.json" | ForEach-Object {
    $p = Get-Content $_.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($p.linear.teamKey -and ($p.linear.teamKey.ToUpper() -eq $tk)) { $found += $p.slug }
  }
  if ($found.Count -eq 1) { return $found[0] }
  if ($found.Count -eq 0) { throw "Ningún projects\*\project.json tiene linear.teamKey='$tk'." }
  throw "linear.teamKey='$tk' duplicado en: $($found -join ', ')."
}

# ¿El agente está habilitado para este proyecto? (project.json → agents.<name>.enabled).
# Sin entrada explícita = habilitado (opt-out, no opt-in).
function Test-AgentEnabled {
  param([Parameter(Mandatory = $true)]$Agent, [Parameter(Mandatory = $true)]$Project)
  $key = $Agent.Name.ToLower()
  $prop = $Project.agents.PSObject.Properties[$key]
  if (-not $prop) { return $true }
  return [bool]$prop.Value.enabled
}

# MCP config efectivo del agente en el proyecto: si el agente declara McpVariant
# ('qa' / 'design' / 'seo'), se busca en project.json → mcpVariants; fallback al
# mcpConfig default del proyecto.
function Resolve-AgentMcpConfig {
  param([Parameter(Mandatory = $true)]$Agent, [Parameter(Mandatory = $true)]$Project)
  if ($Agent.PSObject.Properties['McpVariant'] -and $Agent.McpVariant) {
    $vprop = $null
    if ($Project.PSObject.Properties['mcpVariants'] -and $Project.mcpVariants) {
      $vprop = $Project.mcpVariants.PSObject.Properties[$Agent.McpVariant]
    }
    if ($vprop -and $vprop.Value) { return ".\$($vprop.Value)" }
    Write-Warning "El agente $($Agent.Name) pide la variante MCP '$($Agent.McpVariant)' pero $($Project.slug) no la define — uso el MCP default del proyecto."
  }
  return ".\$($Project.mcpConfig)"
}

# AdditionalDirs del agente resueltos contra el proyecto: el registry usa el
# placeholder '{{PRODUCT_REPO_PATH}}' en vez de un path hardcodeado.
function Resolve-AgentAdditionalDirs {
  param([Parameter(Mandatory = $true)]$Agent, [Parameter(Mandatory = $true)]$Project)
  $dirArgs = @()
  foreach ($d in $Agent.AdditionalDirs) {
    $dir = $d.Replace('{{PRODUCT_REPO_PATH}}', $Project.productRepoPath)
    $resolved = Resolve-Path -Path $dir -ErrorAction SilentlyContinue
    if ($resolved) { $dirArgs += @('--add-dir', $resolved.Path) }
    else { Write-Warning "AdditionalDir '$dir' no encontrado en disco — $($Agent.Name) NO va a tener acceso a esa ruta." }
  }
  return $dirArgs
}

# --- Guard de runtime por TIEMPO ---------------------------------------------
# Los agentes corren contra una suscripción (OAuth): el costo no limita, pero un loop colgado sí.
# El guard es un watchdog: un job que duerme N minutos y, si nadie lo paró antes
# (= claude sigue corriendo), mata el árbol de procesos hijos del wrapper
# (claude.exe + sus MCP servers node/npx) con taskkill /T. La invocación foreground
# de claude queda intacta — si el watchdog dispara, claude muere y el wrapper cae
# en su error handling normal ("no JSON parseable") con $watchdog.State='Completed'
# como evidencia de timeout.

# Timeout efectivo: agent.TimeoutMinutes > env AGENT_TIMEOUT_MINUTES > 30 min.
function Resolve-AgentTimeout {
  param($Agent)
  if ($Agent -and $Agent.PSObject.Properties['TimeoutMinutes'] -and $Agent.TimeoutMinutes) { return [int]$Agent.TimeoutMinutes }
  if ($env:AGENT_TIMEOUT_MINUTES) { return [int]$env:AGENT_TIMEOUT_MINUTES }
  return 30
}

function Start-AgentWatchdog {
  param([Parameter(Mandatory = $true)][int]$TimeoutMinutes)
  if ($TimeoutMinutes -le 0) { return $null }
  return Start-Job -ScriptBlock {
    param($parentPid, $timeoutMin)
    Start-Sleep -Seconds ($timeoutMin * 60)
    # Seguimos vivos = el wrapper no nos detuvo = claude excedió el tiempo. Matar hijos.
    $kids = Get-CimInstance Win32_Process -Filter "ParentProcessId=$parentPid" |
            Where-Object { $_.ProcessId -ne $PID -and $_.Name -match '^(claude|node|npx|cmd)' }
    foreach ($k in $kids) { taskkill /PID $k.ProcessId /T /F | Out-Null }
  } -ArgumentList $PID, $TimeoutMinutes
}

# Devuelve $true si el watchdog DISPARÓ (timeout) antes de que lo paráramos.
function Stop-AgentWatchdog {
  param($Watchdog)
  if (-not $Watchdog) { return $false }
  $fired = ($Watchdog.State -eq 'Completed')
  Stop-Job $Watchdog -ErrorAction SilentlyContinue
  Remove-Job $Watchdog -Force -ErrorAction SilentlyContinue
  return $fired
}

# --- Audit de usage por corrida ---------------------------------------------
# Una línea JSON por corrida en audit\YYYY-MM-DD.jsonl (gitignored). El costo es
# nominal (la suscripción OAuth no factura por token) pero sirve como proxy de usage/rate.
function Write-AgentAudit {
  param(
    [string]$Wrapper, [string]$ProjectSlug, [string]$Name,
    [string]$Model, $CostUsd, [double]$DurationS, [bool]$IsError, [bool]$TimedOut = $false
  )
  try {
    New-Item -ItemType Directory -Force -Path "audit" | Out-Null
    $entry = [ordered]@{
      ts = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss'); wrapper = $Wrapper; project = $ProjectSlug
      name = $Name; model = $Model; cost_usd = $CostUsd
      duration_s = [math]::Round($DurationS, 1); is_error = $IsError; timed_out = $TimedOut
    }
    Add-Content -Path ("audit\{0}.jsonl" -f (Get-Date -Format 'yyyy-MM-dd')) -Value ($entry | ConvertTo-Json -Compress) -Encoding UTF8
  } catch { Write-Warning "No pude escribir el audit log: $($_.Exception.Message)" }
}

# Nombre de quien opera el equipo en este proyecto (project.json → ownerName): la persona
# que habla con los agentes en Linear, revisa sus PRs y promueve sus propuestas. Lo usan
# Resolve-AgentPrompt ({{OWNER_NAME}}) y los wrappers en sus prompts de turno.
# Fallback genérico si el project.json no lo declara.
function Get-ProjectOwnerName {
  param([Parameter(Mandatory = $true)]$Project)
  if ($Project.PSObject.Properties['ownerName'] -and $Project.ownerName) { return [string]$Project.ownerName }
  return 'el owner'
}

# System prompt EFECTIVO del agente para un proyecto:
#   1. appendea projects\<slug>\agent-overrides\<agent>.md si existe (la "función
#      del agente en ESTE proyecto" — domain rules, stack, gating, tooling local).
#   2. interpola los {{PLACEHOLDERS}} (core + override) desde project.json.
function Resolve-AgentPrompt {
  param([Parameter(Mandatory = $true)]$Agent, [Parameter(Mandatory = $true)]$Project)
  $prompt = $Agent.SystemPrompt
  $map = @{
    '{{OWNER_NAME}}'          = Get-ProjectOwnerName -Project $Project
    '{{PROJECT_NAME}}'        = $Project.name
    '{{PROJECT_SLUG}}'        = $Project.slug
    '{{LINEAR_TEAM_KEY}}'     = $Project.linear.teamKey
    '{{PRODUCT_REPO_PATH}}'   = $Project.productRepoPath
    # Fallback explícito: si un project.json todavía no declara productRepoUrl, el prompt
    # dice "(no declarado)" en vez de quedar vacío — que leído por Cody parecería "el
    # remote no matchea nada" y lo haría abortar.
    '{{PRODUCT_REPO_URL}}'    = if ($Project.productRepoUrl) { $Project.productRepoUrl } else { '(no declarado en project.json)' }
    '{{PRODUCT_URL}}'         = $Project.productUrl
    '{{PRODUCT_STACK}}'       = $Project.productStack
    '{{LANGUAGE_CONVENTION}}' = $Project.languageConvention
    '{{STRATEGIC_FOCUS}}'     = $Project.strategicFocus
    '{{PROJECT_CONTEXT_DIR}}' = $Project.contextDir
  }
  $override = Join-Path $Project.contextDir ("agent-overrides\{0}.md" -f $Agent.Name.ToLower())
  if (Test-Path $override) {
    $prompt += "`n`n# Contexto específico de $($Project.name) (override del proyecto — complementa, no reemplaza, lo de arriba)`n`n"
    # -Encoding UTF8: los overrides .md son UTF-8 sin BOM; sin esto PS 5.1 los lee ANSI
    # y TODO el override llegaba con mojibake al prompt del agente (mismo bug de arriba).
    $prompt += (Get-Content $override -Raw -Encoding UTF8)
  }
  # Se interpola DESPUÉS de appendear el override: los overrides también pueden usar
  # los placeholders (p. ej. {{OWNER_NAME}}).
  foreach ($k in $map.Keys) { $prompt = $prompt.Replace($k, [string]$map[$k]) }
  return $prompt
}
