# Corre a Qualy (QA tester) en modo PROGRAMADO (cron de n8n), sin trigger de comentario.
#   uso:  powershell -ExecutionPolicy Bypass -NoProfile -File scripts\run-qualy.ps1 -Job prod-smoke
#         ...-Job log-review
#
# Dos jobs:
#   prod-smoke  (semanal) — REVIEW DE FRONT completo de PROD, NO DESTRUCTIVO: flujos (Playwright) +
#               calidad de front + SEGURIDAD de front (headers/cookies observables + revisión
#               estática del repo contra el baseline + pnpm audit). 'front-review' es alias del
#               mismo job (mismo comportamiento; el nombre prod-smoke se mantiene para el cron de n8n).
#   log-review  (diario)  — Supabase advisors+logs (principal) + Vercel runtime logs (best-effort).
# Qualy devuelve el brief como .result (lo guarda el wrapper en queue/pending-review/) y,
# si encuentra algo accionable, crea un issue en Linear (label agent-report, Backlog) vía MCP.
# Identidad, tools y mcp-config de Qualy salen de scripts\agents.ps1 (single source).
param(
  [Parameter(Mandatory = $true)][ValidateSet('prod-smoke', 'front-review', 'log-review')][string]$Job,
  [string]$Model,
  [string]$Url = "",   # default: productUrl del proyecto (project.json)
  [string]$Project = 'acme',
  [switch]$DryRun
)
$ErrorActionPreference = "Stop"

# Raíz del repo (este script vive en scripts\)
Set-Location (Split-Path $PSScriptRoot -Parent)

# Secretos del server desde .env.server (mismo loader que run-skill/respond-linear).
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

# Billing: correr contra la suscripción (login OAuth de `claude login`), NO la API key.
# Claude Code usa ANTHROPIC_API_KEY si está en el env (factura API, pago por token). La
# sacamos para que caiga en las credenciales OAuth de %USERPROFILE%\.claude\.credentials.json
# (el USERPROFILE se redirige al user real más abajo). Para volver a billing por API,
# borra estas 2 líneas — la key sigue guardada en .env.server. OJO: la suscripción comparte los
# rate limits con tu uso interactivo (claude.ai / Claude Code).
Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:ANTHROPIC_AUTH_TOKEN -ErrorAction SilentlyContinue

# Bajo SYSTEM (n8n-local) redirigimos USERPROFILE al user real (auth de claude),
# prependeamos .local\bin (claude native installer), apuntamos COREPACK_HOME (pnpm) y
# PLAYWRIGHT_BROWSERS_PATH (los browsers viven en el perfil del user real, no en el
# systemprofile) — si no, el Playwright MCP no encuentra chromium.
if ($env:CLAUDE_USERPROFILE) {
  $env:USERPROFILE = $env:CLAUDE_USERPROFILE
  $claudeBin = Join-Path $env:CLAUDE_USERPROFILE '.local\bin'
  if (Test-Path $claudeBin) { $env:PATH = "$claudeBin;$env:PATH" }
  $corepackHome = Join-Path $env:CLAUDE_USERPROFILE 'AppData\Local\node\corepack'
  if (Test-Path $corepackHome) { $env:COREPACK_HOME = $corepackHome }
  $pwBrowsers = Join-Path $env:CLAUDE_USERPROFILE 'AppData\Local\ms-playwright'
  if (Test-Path $pwBrowsers) { $env:PLAYWRIGHT_BROWSERS_PATH = $pwBrowsers }
}

# Roster → Qualy (identidad + tools + mcp-config en un solo lugar) + capa multi-proyecto.
. "$PSScriptRoot\agents.ps1"
. "$PSScriptRoot\project.ps1"
$projectObj = Resolve-ProjectContext -Slug $Project
$ownerName = Get-ProjectOwnerName -Project $projectObj
$agent = Get-Agent -Name 'qualy'
$signature = "🤖 $($agent.Name) $($agent.Emoji)"
if (-not (Test-AgentEnabled -Agent $agent -Project $projectObj)) {
  Write-Error "Qualy está deshabilitada para el proyecto $($projectObj.name) (project.json). No corro."
  exit 1
}
if ([string]::IsNullOrWhiteSpace($Url)) { $Url = $projectObj.productUrl }

$model = if ($Model) { $Model }
         elseif ($agent.Model) { $agent.Model }
         elseif ($env:ANTHROPIC_MODEL) { $env:ANTHROPIC_MODEL }
         else { "claude-sonnet-4-6" }

# Presupuesto: backstop profundo, NO el guard principal (corre contra una suscripción
# OAuth — el guard de runaway es el watchdog de TIEMPO de project.ps1).
$budget = if ($agent.PSObject.Properties['Budget'] -and $agent.Budget) { $agent.Budget }
          elseif ($env:PER_RUN_BUDGET_USD) { $env:PER_RUN_BUDGET_USD }
          elseif ($env:DAILY_BUDGET_USD) { $env:DAILY_BUDGET_USD }
          else { "50" }

$stamp = Get-Date -Format "yyyy-MM-dd"
$out = "queue/pending-review/$stamp-$($projectObj.slug)-qualy-$Job.md"
New-Item -ItemType Directory -Force -Path "queue/pending-review" | Out-Null

# Memoria persistente del review de front (ledger de hallazgos + disposición). Es el ÚNICO
# archivo que Qualy puede escribir en este job (HARD STOP en el system prompt + Write agregado
# al allowlist más abajo SOLO para front-review). Versionada en git, modelo seo-memory.md.
$memoryPath = "projects/$($projectObj.slug)/qualy-front-memory.md"

# Contexto operativo según el job. NO hay issue de Linear de origen (es cron):
# Qualy crea un issue NUEVO solo si encuentra algo accionable.
switch ($Job) {
  { $_ -in 'prod-smoke', 'front-review' } {
    $jobContext = @"
Contexto operativo de este turno (CRON SEMANAL — REVIEW DE FRONT: flujos + calidad + seguridad):
- Corrida PROGRAMADA, sin issue de Linear de origen. Es tu chequeo más completo del front.
- Objetivo: encontrar bugs, regresiones de calidad y problemas de SEGURIDAD de front en $($projectObj.name) ANTES que los usuarios, y dejarlos como issues accionables en Linear para que $ownerName los despache a Cody. REPORTAS, no arreglas.
- MEMORIA (dedupe + disposición) — HAZLO PRIMERO: lee $memoryPath con Read (si no existe, arrancas con ledger vacío). Es tu registro de qué ya reportaste y en qué quedó. Reconcilia CADA hallazgo previo contra el estado de su issue en Linear (mcp__linear__*): `Done` => arreglado (confirma que de verdad se arregló antes de cerrarlo), `Canceled` => wont-fix, sigue en `Backlog`/`Todo`/`In Progress` => abierto/aceptado. REGLAS DE DEDUPE: (a) NO crees un issue nuevo para un hallazgo que YA tiene issue abierto — solo refrescas su 'última-vez' en la memoria (y comentas el issue existente SOLO si empeoró materialmente); (b) NO re-levantes lo marcado `wont-fix` ni `falso-positivo`; (c) solo creas issues para hallazgos NUEVOS o REGRESIONES (algo que estaba `arreglado` y volvió => id NUEVO que referencia al viejo); (d) lo ya documentado en el baseline de seguridad NO se re-reporta salvo que verifiques que sigue ABIERTO.
- HARD STOP de escritura: el ÚNICO archivo que tienes permitido escribir (tool Write) es $memoryPath. NUNCA escribas ningún otro archivo, y NUNCA escribas dentro del repo del producto (es SOLO LECTURA).
- TRES dimensiones (el detalle de flujos, comandos y patrones está en tu override de proyecto — LÉELO):
  1. FLUJOS (Playwright, NO DESTRUCTIVO): navega los flujos clave de PROD ($Url) en mobile (~390px) Y desktop. Que arranquen, rendericen y no tiren errores de consola/red. Llega HASTA el borde de cada mutación (signup/login/checkout/feature paga) SIN ejecutarla. NUNCA completes signups, pagos ni mutaciones reales. NO corras suites e2e contra prod (mutan).
  2. CALIDAD DE FRONT: coherencia visual con el design system, imágenes/links rotos, overflow o texto cortado en mobile, snapshot de accesibilidad (Playwright a11y tree) de las páginas clave. Screenshot de lo que reportes.
  3. SEGURIDAD DE FRONT:
     - Observable en browser (Playwright): headers de respuesta de prod (¿CSP enforced o solo Report-Only? HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy), flags de cookies (Secure/HttpOnly/SameSite), contenido mixto / requests inseguros.
     - Estático del repo (Read/Grep en el repo del producto, montado como dir adicional): tu override indica el archivo BASELINE de seguridad — léelo PRIMERO. Verifica REGRESIONES nuevas (getSession() en rutas API en vez de getUser(), dangerouslySetInnerHTML que no sea JSON-LD, NEXT_PUBLIC_* que filtre un secret, input del request interpolado en queries, webhooks sin verificación de firma) y el ESTADO de los findings CRÍTICOS del baseline (¿se arreglaron o siguen abiertos?). NO re-reportes lo ya documentado salvo que confirmes que sigue abierto, citando su ID.
     - pnpm audit (best-effort): deps vulnerables. Si Bash/red está bloqueada, dilo y sigue con lo estático + el baseline.
- SEVERIDAD: 🔴 alta (explotable / rompe un flujo clave) · 🟡 media (degrada / regresión de calidad / hardening pendiente) · 🟢 baja-info (va SOLO en el brief, NO creas issue).
- ENTREGA — en este orden, NO opcional:
  1. Por CADA finding accionable (🔴/🟡) crea UN issue en Linear con el MCP (mcp__linear__*) — team $($projectObj.linear.teamKey), label agent-report, estado Backlog, sin asignar, sin priority. Título prefijado por área: '[QA-sec] ...' para seguridad, '[QA-front] ...' para flujos/calidad, + 1 línea de resumen. Body: severidad, repro/pasos o archivo:línea, impacto, e hipótesis de fix para Cody (con el ID del baseline si aplica). MÁXIMO 5 issues por corrida: si hay más, crea los 5 de mayor impacto y lista el resto en el brief. Estos issues son el entregable PRINCIPAL; el brief es secundario.
  2. REESCRIBE $memoryPath (tool Write) con el ledger actualizado: filas nuevas + 'última-vez' al día de hoy en las que sigan vigentes + status reconciliado contra Linear. Es el ÚNICO archivo que escribes.
  3. Devuelve el brief completo en markdown (veredicto arriba, hallazgos por dimensión, qué cambió desde la corrida anterior según la memoria, y qué NO pudiste testear y por qué).
- El brief DEBE cerrar con una línea: 'Issues: $($projectObj.linear.teamKey)-XX, $($projectObj.linear.teamKey)-YY — <urls>' con los que creaste, o 'Sin issue: todo OK' si pasó limpio. Si hubo 🔴/🟡 y NO hay línea de Issues, la corrida está INCOMPLETA. Si un create_issue falla, reporta el error textual en esa línea (no lo escondas).
- Empieza el brief con tu firma ${signature}: y el veredicto (✅ PASS / ⚠️ PASS con observaciones / ❌ FAIL).
"@
    $userTask = "Ejecuta AHORA el review semanal de front (flujos + calidad + seguridad), NO DESTRUCTIVO, siguiendo tu system prompt y el contexto. No me describas el plan. Primero lee y reconcilia tu memoria ($memoryPath) contra Linear. Por cada hallazgo NUEVO accionable (🔴/🟡) CREA el issue en Linear (paso obligatorio, máx 5, sin duplicar lo ya abierto). Después REESCRIBE la memoria y devuelve el brief, que debe cerrar con la línea 'Issues: ...' o 'Sin issue: todo OK'."
  }
  'log-review' {
    $jobContext = @"
Contexto operativo de este turno (CRON DIARIO — review de logs del backend):
- Corrida PROGRAMADA, sin issue de Linear de origen.
- Tarea: revisar la salud del backend del último día y reportar bugs (warnings/errores). Sin PII.
- Fuentes:
  1. Supabase (mcp__supabase__*) — TU FUENTE PRINCIPAL Y CONFIABLE: get_advisors (lints de security + performance) y get_logs (prueba los servicios api / postgres / auth; busca errores y excepciones recientes).
  2. Vercel (BEST-EFFORT, vía Bash + curl): autentica con el token de la env var VERCEL_API_TOKEN (header Authorization: Bearer) y el proyecto en la env var VERCEL_PROJECT_ID. Pasos:
     - Último deployment de prod: GET https://api.vercel.com/v6/deployments?projectId=<VERCEL_PROJECT_ID>&target=production&limit=1&state=READY
     - Runtime logs de ese deployment: GET https://api.vercel.com/v1/projects/<VERCEL_PROJECT_ID>/deployments/<deploymentId>/runtime-logs
     - OJO: los runtime logs de Vercel tienen retención corta y la API puede venir vacía. Si no obtienes nada útil, DILO (no es error tuyo) y quédate con lo de Supabase.
- Resume: errores nuevos vs recurrentes, frecuencia y qué los dispara. Prioriza por impacto.
- ENTREGA — en este orden, NO opcional:
  1. **Si encuentras CUALQUIER hallazgo accionable (los 🔴/🟡 de tu brief, o sea severidad alta o media)**: ANTES de cerrar, crea UN issue en Linear con el MCP (mcp__linear__*) — team $($projectObj.linear.teamKey), label agent-report, estado Backlog, sin asignar, sin priority; titulo: [QA] Logs ${stamp}: <resumen>; body con los hallazgos priorizados + repro/hipótesis. Este issue es el entregable PRINCIPAL del cron; el brief en la cola es secundario.
  2. Devuelve el brief completo en markdown.
- El brief DEBE cerrar con una línea: 'Issue: $($projectObj.linear.teamKey)-XX — <url>' si lo creaste, o 'Sin issue: <razón concreta>' si de verdad no había nada accionable. Si hubo 🔴/🟡 y NO hay línea de Issue, la corrida está INCOMPLETA. Si el create_issue de Linear falla, reporta el error textual en esa línea (no lo escondas).
- Empieza el brief con tu firma ${signature}: y un veredicto (tranquilo / observaciones / bug accionable).
"@
    $userTask = "Ejecuta AHORA el review de logs siguiendo tu system prompt y el contexto. No me describas el plan. Si hay hallazgos accionables, CREA el issue en Linear (paso obligatorio) y DESPUÉS devuelve el brief, que debe cerrar con la línea 'Issue: ...' o 'Sin issue: ...'."
  }
}

# System prompt = identidad de Qualy (core + placeholders + override del proyecto) + contexto del job.
$resolvedPrompt = Resolve-AgentPrompt -Agent $agent -Project $projectObj
$systemPrompt = @"
$resolvedPrompt

$jobContext
"@

$allowed = $agent.AllowedTools
# El review de front mantiene una memoria persistente → necesita Write, acotado por HARD STOP
# (en el system prompt) al único archivo $memoryPath. Se agrega SOLO aquí y SOLO para este job:
# el registry de Qualy (que comparte el listener comment-only) queda SIN Write. Write PELADO
# (no glob) por el bug de path-matching de Windows. Mismo modelo de confianza que run-greta-seo.ps1.
if ($Job -in 'prod-smoke', 'front-review') { $allowed = "$allowed,Write" }
# Qualy usa la variante MCP 'qa' del proyecto (incluye Playwright); fallback al default del proyecto.
$mcpConfig = Resolve-AgentMcpConfig -Agent $agent -Project $projectObj

$addDirArgs = Resolve-AgentAdditionalDirs -Agent $agent -Project $projectObj

if ($DryRun) {
  "=== DRY RUN run-qualy (no se llamó a claude) ==="
  "Project : $($projectObj.slug) | Job: $Job | Url: $Url"
  "Model   : $model | Budget: $budget"
  "MCP     : $mcpConfig"
  "Allowed : $allowed"
  "AddDirs : $(if ($addDirArgs) { $addDirArgs -join ' ' } else { '(ninguno)' })"
  "Out     : $out | Team: $($projectObj.linear.teamKey) | SUPABASE_PROJECT_REF: $env:SUPABASE_PROJECT_REF"
  "Memory  : $(if ($Job -in 'prod-smoke','front-review') { "$memoryPath (Write habilitado)" } else { '(n/a — este job no escribe memoria)' })"
  exit 0
}

# Guard de runtime por tiempo (ver project.ps1).
$timeoutMin = Resolve-AgentTimeout -Agent $agent
$watchdog = Start-AgentWatchdog -TimeoutMinutes $timeoutMin
$runStart = Get-Date

$json = "" | claude -p $userTask `
  --append-system-prompt $systemPrompt `
  --model $model `
  --mcp-config $mcpConfig `
  --strict-mcp-config `
  --permission-mode dontAsk `
  --allowedTools $allowed `
  --max-budget-usd $budget `
  --output-format json `
  @addDirArgs
$exit = $LASTEXITCODE
$timedOut = Stop-AgentWatchdog $watchdog
$durationS = ((Get-Date) - $runStart).TotalSeconds

$parsed = $null
try { $parsed = $json | ConvertFrom-Json } catch {}

if (-not $parsed) {
  Write-AgentAudit -Wrapper 'run-qualy' -ProjectSlug $projectObj.slug -Name "qualy-$Job" -Model $model -CostUsd $null -DurationS $durationS -IsError $true -TimedOut $timedOut
  $timeoutNote = if ($timedOut) { " TIMEOUT: el watchdog mató la corrida a los $timeoutMin min." } else { "" }
  Write-Error "claude -p no devolvió JSON parseable para qualy $Job (exit $exit).$timeoutNote Salida cruda:`n$json"
  exit 1
}

# El wrapper escribe el brief (UTF-8 SIN BOM). $parsed.result es el markdown final.
$outAbs = Join-Path (Get-Location) $out
[System.IO.File]::WriteAllText($outAbs, [string]$parsed.result, (New-Object System.Text.UTF8Encoding($false)))

Write-AgentAudit -Wrapper 'run-qualy' -ProjectSlug $projectObj.slug -Name "qualy-$Job" -Model $model -CostUsd $parsed.total_cost_usd -DurationS $durationS -IsError ([bool]$parsed.is_error) -TimedOut $timedOut

$parsed.result
"---"
"Brief: $out | Job: $Job | Model: $model"
"Costo USD: $($parsed.total_cost_usd) | Duración: $([math]::Round($durationS))s"

if ($exit -ne 0 -or $parsed.is_error) {
  Write-Error "run-qualy falló para $Job (exit $exit, is_error=$($parsed.is_error))"
  exit 1
}
