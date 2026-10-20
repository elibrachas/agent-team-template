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
  # Vercel (MCP read-only, scripts\mcp-vercel). El TOKEN es de la cuenta (un solo team para todos
  # los productos): vive en .env.server y Resolve-ProjectContext lo conserva si el .env.<slug> no
  # trae uno propio. El PIN (team + proyectos) NO va en ningún .env: sale de project.json → vercel
  # (Set-ProjectVercelEnv). VERCEL_PROJECT_ID queda como legado de un solo proyecto.
  'VERCEL_API_TOKEN', 'VERCEL_PROJECT_ID', 'VERCEL_TEAM_ID', 'VERCEL_PROJECTS',
  # MCP mysql read-only (scripts\mcp-mysql) — DB de la app cuando no es Supabase.
  'MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD',
  'MYSQL_ROW_LIMIT', 'MYSQL_TIMEOUT_MS', 'MYSQL_DENY_COLUMNS'
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
  # El token de Vercel es CORE (misma cuenta/team para todos los productos): se guarda antes de
  # limpiar y se repone si el .env.<slug> no define uno propio (un `VERCEL_API_TOKEN=` vacío
  # copiado del template lo borraría). Un valor no vacío en .env.<slug> sigue ganando — sirve
  # para un token acotado a un solo proyecto.
  $coreVercelToken = $env:VERCEL_API_TOKEN
  if (Test-Path $envFile) {
    foreach ($v in $ProjectScopedVars) { Remove-Item "Env:$v" -ErrorAction SilentlyContinue }
    Import-EnvFile $envFile
  }
  else {
    Write-Warning "$envFile no existe: las vars project-scoped quedan con los valores de .env.server (si los hay). Crea $($project.envFile) (template: $($project.envFile).example) antes de correr $($project.name) contra datos reales."
  }
  if (-not $env:VERCEL_API_TOKEN -and $coreVercelToken) { $env:VERCEL_API_TOKEN = $coreVercelToken }
  Set-ProjectVercelEnv -Project $project
  return $project
}

# Pin de Vercel de la corrida: qué team y qué proyectos de Vercel puede leer el MCP
# `vercel` (scripts\mcp-vercel) para ESTE proyecto. Sale de project.json → vercel { teamId,
# projects[{ key, id, name }] } — son ids, no secretos, por eso van versionados y no en el .env.
# El MCP rechaza cualquier proyecto/deployment fuera de esta lista aunque el token lo pueda ver
# (el token es de todo el team). Sin bloque `vercel`: no se exporta pin; si el .env.<slug> trae un
# VERCEL_PROJECT_ID legado, el MCP usa ese único proyecto.
function Set-ProjectVercelEnv {
  param([Parameter(Mandatory = $true)]$Project)
  Remove-Item Env:VERCEL_TEAM_ID -ErrorAction SilentlyContinue
  Remove-Item Env:VERCEL_PROJECTS -ErrorAction SilentlyContinue
  if (-not ($Project.PSObject.Properties['vercel'] -and $Project.vercel)) { return }
  if ($Project.vercel.teamId) { $env:VERCEL_TEAM_ID = [string]$Project.vercel.teamId }
  $pairs = @($Project.vercel.projects | Where-Object { $_ -and $_.key -and $_.id } | ForEach-Object { "$($_.key)=$($_.id)" })
  if ($pairs.Count -gt 0) {
    $env:VERCEL_PROJECTS = ($pairs -join ';')
    # El pin de project.json manda sobre un VERCEL_PROJECT_ID legado del .env.
    Remove-Item Env:VERCEL_PROJECT_ID -ErrorAction SilentlyContinue
  }
}

# Una línea para los -DryRun de los wrappers: qué va a poder leer el MCP de Vercel (sin valores).
function Format-ProjectVercelPin {
  $token = if ($env:VERCEL_API_TOKEN) { 'token cargado' } else { 'SIN TOKEN (el MCP responde "no configurada")' }
  $pin = if ($env:VERCEL_PROJECTS) { $env:VERCEL_PROJECTS }
         elseif ($env:VERCEL_PROJECT_ID) { "default=$($env:VERCEL_PROJECT_ID) (legado)" }
         else { '(sin proyectos declarados)' }
  return "$pin | team: $(if ($env:VERCEL_TEAM_ID) { $env:VERCEL_TEAM_ID } else { '(se deduce del token)' }) | $token"
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

# --- Multi-repo ---------------------------------------------------------------
# Un producto puede vivir en VARIOS repos (p. ej. sitio de marketing + portal de clientes +
# core app). project.json → productRepos[] los declara con su rol
# ({ key, path, url, repoUrl, role, owner, readOnly }). Sin productRepos, el repo único es
# productRepoPath (back-compat: los proyectos de un solo repo no cambian).
# productRepoPath sigue siendo el repo PRIMARIO: el que usan Cody (writes) y los
# wrappers que miran un solo repo. Los agentes de análisis (Numa/Greta/Pico) usan el
# placeholder '{{PRODUCT_REPOS}}' y reciben TODOS los repos, para tener la mirada cruzada.
function Get-ProjectRepos {
  param([Parameter(Mandatory = $true)]$Project)
  if ($Project.PSObject.Properties['productRepos'] -and $Project.productRepos) {
    return @($Project.productRepos)
  }
  return @([pscustomobject]@{
    key = 'product'; path = $Project.productRepoPath; url = $Project.productUrl
    repoUrl = $Project.productRepoUrl
    role = 'repo único del producto'; readOnly = $false
  })
}

# Copias locales de los repos del producto AL DÍA antes de que un agente las lea. El cron
# diario de sync-product-repos no alcanza: un scan que corre horas después, o un día en que el
# cron falló, lee código viejo (decenas de commits atrás) y el agente propone o reporta sobre
# algo que ya cambió. Lo usan todos los wrappers que leen código.
#
# EN UN PROCESO APARTE (no dot-source ni `&` del .ps1): sync-product-repos recarga .env.server y
# reescribe $env:PATH; en el proceso del wrapper restauraría ANTHROPIC_API_KEY (que los wrappers
# sacan para facturar contra la suscripción), pisaría las vars del proyecto y sacaría .local\bin
# del PATH. Best-effort y no bloqueante: si un repo no es fast-forward (WIP, rama de Cody), el
# sync avisa y sigue; el agente igual tiene que decir en su brief si la copia quedó atrás.
function Sync-ProjectRepos {
  param(
    [Parameter(Mandatory = $true)]$Project,
    # -NoSwitch: pasa el modo "solo fetch, nunca cambia de rama" a sync-product-repos. Lo usa el
    # listener (respond-linear.ps1), que dispara con cada comentario; los crons NO lo pasan.
    [switch]$NoSwitch
  )
  try {
    $syncArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "$PSScriptRoot\sync-product-repos.ps1", '-Project', $Project.slug, '-Quiet')
    if ($NoSwitch) { $syncArgs += '-NoSwitch' }
    & powershell.exe @syncArgs
  } catch {
    Write-Warning "sync-product-repos (no bloqueante) falló: $($_.Exception.Message)"
  }
}

# Estado READ-ONLY de las copias locales de los repos del producto, para avisarle al agente
# comment-only (que no tiene Bash para notarlo) si está leyendo código atrasado o de otra rama.
# NO toca nada: solo lee rama + cuántos commits atrás de origin/<default> + si hay
# cambios sin commitear. Devuelve markdown con SOLO los repos que no están al día en la rama
# default (si está todo OK devuelve '' y el llamador no agrega nada al contexto).
function Format-ProjectReposStatus {
  param([Parameter(Mandatory = $true)]$Project)
  $lines = @()
  foreach ($r in (Get-ProjectRepos -Project $Project)) {
    $resolved = Resolve-Path -Path $r.path -ErrorAction SilentlyContinue
    if (-not $resolved) { continue }
    $dir = $resolved.Path
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $branch = (git -C $dir rev-parse --abbrev-ref HEAD 2>$null | Out-String).Trim()
    $default = (git -C $dir symbolic-ref --short refs/remotes/origin/HEAD 2>$null | Out-String).Trim() -replace '^origin/', ''
    if (-not $default) { $default = 'main' }
    $behind = (git -C $dir rev-list --count "HEAD..origin/$default" 2>$null | Out-String).Trim()
    $ahead = (git -C $dir rev-list --count "origin/$default..HEAD" 2>$null | Out-String).Trim()
    $dirty = (git -C $dir status --porcelain --untracked-files=no 2>$null) -join ''
    $ErrorActionPreference = $eap
    if ($branch -eq $default -and ($behind -eq '0' -or -not $behind) -and ($ahead -eq '0' -or -not $ahead) -and -not $dirty) { continue }
    $notes = @()
    if ($branch -ne $default) { $notes += "en rama '$branch' (no '$default')" }
    if ($behind -and $behind -ne '0') { $notes += "$behind commit(s) atrás de origin/$default" }
    if ($ahead -and $ahead -ne '0') { $notes += "$ahead commit(s) local(es) no en origin/$default" }
    if ($dirty) { $notes += "con cambios sin commitear" }
    $lines += "- ``$($r.key)`` ($($r.path)): $($notes -join '; ')"
  }
  return ($lines -join "`n")
}

# Repos donde Cody PUEDE escribir: los de productRepos sin readOnly. El primario
# (productRepoPath) va primero porque es el destino por defecto. Sin productRepos = solo el
# primario → los proyectos de un solo repo resuelven exactamente igual.
function Get-ProjectWritableRepos {
  param([Parameter(Mandatory = $true)]$Project)
  $all = @(Get-ProjectRepos -Project $Project | Where-Object { -not ($_.PSObject.Properties['readOnly'] -and $_.readOnly) })
  $primary = @($all | Where-Object { $_.path -eq $Project.productRepoPath })
  $rest = @($all | Where-Object { $_.path -ne $Project.productRepoPath })
  return @($primary + $rest)
}

# Lista markdown de los repos escribibles para el prompt de Cody ({{CODE_REPOS}}), con el remote
# esperado de cada uno (Cody lo verifica con `git remote -v` antes de editar).
function Format-WritableRepos {
  param([Parameter(Mandatory = $true)]$Project)
  $lines = foreach ($r in (Get-ProjectWritableRepos -Project $Project)) {
    $remote = if ($r.PSObject.Properties['repoUrl'] -and $r.repoUrl) { $r.repoUrl } elseif ($r.path -eq $Project.productRepoPath -and $Project.productRepoUrl) { $Project.productRepoUrl } else { '(no declarado)' }
    $default = if ($r.path -eq $Project.productRepoPath) { ' **(destino por defecto)**' } else { '' }
    "- ``$($r.key)`` → ``$($r.path)`` — remote esperado: $remote — $($r.role).$default"
  }
  return ($lines -join "`n")
}

# Lista markdown de los repos para el system prompt ({{PRODUCT_REPOS}}).
function Format-ProjectRepos {
  param([Parameter(Mandatory = $true)]$Project)
  $lines = foreach ($r in (Get-ProjectRepos -Project $Project)) {
    $url = if ($r.PSObject.Properties['url'] -and $r.url) { " ($($r.url))" } else { '' }
    $owner = if ($r.PSObject.Properties['owner'] -and $r.owner) { " Dueño: $($r.owner)." } else { '' }
    $ro = if ($r.PSObject.Properties['readOnly'] -and $r.readOnly) { ' NINGÚN agente escribe en este repo.' } else { '' }
    "- ``$($r.key)`` → ``$($r.path)``$url — $($r.role).$owner$ro"
  }
  return ($lines -join "`n")
}

# `--add-dir` para TODOS los repos del producto (deduplicados). Para los wrappers
# dedicados (Greta SEO/AEO) que hardcodean su loadout en vez de leer el registry.
function Get-ProjectRepoAddDirArgs {
  param([Parameter(Mandatory = $true)]$Project, [string]$Who = 'el agente')
  $dirArgs = @(); $seen = @{}
  foreach ($r in (Get-ProjectRepos -Project $Project)) {
    $resolved = Resolve-Path -Path $r.path -ErrorAction SilentlyContinue
    if (-not $resolved) { Write-Warning "Repo '$($r.key)' ($($r.path)) no encontrado en disco — $Who NO va a poder leerlo."; continue }
    if ($seen.ContainsKey($resolved.Path)) { continue }
    $seen[$resolved.Path] = $true
    $dirArgs += @('--add-dir', $resolved.Path)
  }
  return $dirArgs
}

# Slugs de los OTROS proyectos (!= $Slug). Para el loop de sync del wrapper de Qualy, que
# pone al día las copias de los repos hermanos ANTES de leer sus manifests (si solo se
# sincroniza el proyecto de la corrida, los hermanos se leen atrasados).
function Get-OtherProjectSlugs {
  param([Parameter(Mandatory = $true)][string]$Slug)
  $cur = $Slug.Trim().ToLower()
  $slugs = @()
  Get-ChildItem "projects\*\project.json" | ForEach-Object {
    $p = Get-Content $_.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($p.slug.ToLower() -eq $cur) { return }
    $slugs += $p.slug
  }
  return $slugs
}

# Chequeos CROSS-PROYECTO de dependencias compartidas — p. ej. una vuln en Next.js (que usan
# varios productos) que debe cruzarse contra los demás en la MISMA corrida y reportarse el
# mismo día en cada team afectado (si cada proyecto la descubre en su propio review, el último
# se entera días después, o nunca).
#
# NO monta los repos hermanos con --add-dir: Qualy corre con un Write PELADO (su memoria), y
# --add-dir daría acceso de ESCRITURA a esos repos — el "solo lectura" quedaría solo en el
# texto. En vez de eso COPIA únicamente los manifests de dependencias
# (package.json + lockfiles) de cada repo hermano a un directorio de staging DESECHABLE y
# monta SOLO ese staging. Así ningún repo del producto queda expuesto a escritura: lo peor que
# puede pasar es que toque copias throwaway. Best-effort: salta lo que no está en disco (p. ej.
# en el clon de Alfred). Devuelve @{ AddDirArgs = @('--add-dir', <staging>); Lines = <md> };
# las Lines apuntan al staging (dónde leer cada manifest) + el teamKey de cada proyecto.
function Copy-OtherProjectsManifests {
  param(
    [Parameter(Mandatory = $true)][string]$Slug,
    [Parameter(Mandatory = $true)][string]$StageRoot,
    # Mapa slug->motivo de los repos hermanos cuyo sync NO terminó OK esta corrida. Para
    # esos NO leemos la ref en disco (quedó atrasada): los marcamos NO VERIFICADO con el motivo.
    [hashtable]$SyncFailed = @{}
  )
  $manifests = @('package.json', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'composer.json', 'composer.lock')
  $cur = $Slug.Trim().ToLower()
  if (Test-Path $StageRoot) { Remove-Item $StageRoot -Recurse -Force -ErrorAction SilentlyContinue }
  New-Item -ItemType Directory -Force -Path $StageRoot | Out-Null
  $stageAbs = (Resolve-Path $StageRoot).Path
  $lines = @(); $copiedAny = $false
  Get-ChildItem "projects\*\project.json" | ForEach-Object {
    $p = Get-Content $_.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($p.slug.ToLower() -eq $cur) { return }
    $tk = if ($p.linear -and $p.linear.teamKey) { $p.linear.teamKey } else { '(sin team)' }
    # Si el sync de este proyecto hermano falló (fetch sin acceso/red → sync-product-repos salió
    # != 0), la ref origin/<default> en disco quedó ATRASADA: no la cruzamos. Una ref vieja que
    # sobrevive a un fetch fallido se leería como al día. Marcamos NO VERIFICADO con el motivo y
    # no copiamos sus manifests.
    if ($SyncFailed -and $SyncFailed.ContainsKey($p.slug.ToLower())) {
      $lines += "- $($p.name) (team $tk): NO VERIFICADO (no cruzar — copia atrasada: $($SyncFailed[$p.slug.ToLower()]))"
      return
    }
    $repoDests = @()
    $unverified = @()
    # EAP=Continue alrededor de las llamadas a git: bajo $ErrorActionPreference='Stop' (lo setea
    # run-qualy) un `git show` que falla —p. ej. un manifest que no existe en ese repo, caso NORMAL—
    # TIRA aunque se redirija 2>$null, y tumbaría el front-review entero. Mismo guard que
    # Format-ProjectReposStatus. Lo restauramos al salir del loop del proyecto.
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    foreach ($r in (Get-ProjectRepos -Project $p)) {
      $resolved = Resolve-Path -Path $r.path -ErrorAction SilentlyContinue
      if (-not $resolved) { continue }
      # Leemos los manifests desde la ref YA TRAÍDA por el sync de arriba (origin/<default>), NO del
      # árbol de trabajo: la copia de un repo hermano puede estar en otra rama o sin poder
      # fast-forward (WIP / rama de Cody abierta), y entonces el working tree tiene versiones
      # viejas o de otra rama — Qualy cruzaría contra deps que no son las de prod. `git show
      # origin/<def>:<manifest>` da siempre lo último traído. Si el repo no se pudo traer (no existe
      # la ref), lo marcamos NO VERIFICADO en vez de leer silenciosamente algo viejo.
      $def = (git -C $resolved.Path symbolic-ref --short refs/remotes/origin/HEAD 2>$null | Out-String).Trim() -replace '^origin/', ''
      if (-not $def) { $def = 'main' }
      git -C $resolved.Path rev-parse --verify --quiet "refs/remotes/origin/$def" 2>$null | Out-Null
      if ($LASTEXITCODE -ne 0) { $unverified += "$($r.key) (no se pudo traer origin/$def)"; continue }
      $destDir = Join-Path (Join-Path $stageAbs $p.slug) $r.key
      $copiedHere = $false
      foreach ($m in $manifests) {
        $content = (git -C $resolved.Path show "origin/${def}:$m" 2>$null | Out-String)
        if ($LASTEXITCODE -eq 0 -and $content) {
          if (-not $copiedHere) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null; $copiedHere = $true }
          [System.IO.File]::WriteAllText((Join-Path $destDir $m), $content, (New-Object System.Text.UTF8Encoding($false)))
        }
      }
      if ($copiedHere) { $repoDests += "$($r.key) => $destDir"; $copiedAny = $true }
    }
    $ErrorActionPreference = $eap
    $parts = @()
    if ($repoDests) { $parts += ($repoDests -join ' ; ') }
    if ($unverified) { $parts += "NO VERIFICADO (no cruzar — copia atrasada): $($unverified -join ' ; ')" }
    $where = if ($parts) { $parts -join ' ; ' } else { '(sin manifests en disco — no se pudo cruzar)' }
    $lines += "- $($p.name) (team $tk): $where"
  }
  $addDirArgs = if ($copiedAny) { @('--add-dir', $stageAbs) } else { @() }
  return @{ AddDirArgs = $addDirArgs; Lines = ($lines -join "`n") }
}

# AdditionalDirs del agente resueltos contra el proyecto: el registry usa placeholders
# en vez de paths hardcodeados — '{{PRODUCT_REPO_PATH}}' (repo primario),
# '{{PRODUCT_REPOS}}' (todos los repos del producto, ver Get-ProjectRepos) o
# '{{WRITABLE_REPOS}}' (los que no son readOnly — el loadout de Cody, ver Get-ProjectWritableRepos).
function Resolve-AgentAdditionalDirs {
  param([Parameter(Mandatory = $true)]$Agent, [Parameter(Mandatory = $true)]$Project)
  $dirArgs = @(); $seen = @{}
  foreach ($d in $Agent.AdditionalDirs) {
    $dirs = if ($d -eq '{{PRODUCT_REPOS}}') { @((Get-ProjectRepos -Project $Project) | ForEach-Object { $_.path }) }
            elseif ($d -eq '{{WRITABLE_REPOS}}') { @((Get-ProjectWritableRepos -Project $Project) | ForEach-Object { $_.path }) }
            else { @($d.Replace('{{PRODUCT_REPO_PATH}}', $Project.productRepoPath)) }
    foreach ($dir in $dirs) {
      $resolved = Resolve-Path -Path $dir -ErrorAction SilentlyContinue
      if (-not $resolved) { Write-Warning "AdditionalDir '$dir' no encontrado en disco — $($Agent.Name) NO va a tener acceso a esa ruta."; continue }
      if ($seen.ContainsKey($resolved.Path)) { continue }
      $seen[$resolved.Path] = $true
      $dirArgs += @('--add-dir', $resolved.Path)
    }
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

# --- Discord: destino de una corrida (run-skill.ps1 -DiscordWebhookVar) o aviso extra de un
# wrapper dedicado (run-pico-shipped.ps1 con project.json -> shippedDigestDiscordWebhookVar).
# El webhook es un secreto: vive en una env var de .env.<slug> y aquí solo se pasa su valor.

# El mensaje que el agente dejó entre una línea <discord> y una línea </discord>. Devuelve $null
# si la respuesta no trae esas marcas: el llamador decide qué hacer (no se postea a ciegas).
# Las marcas tienen que estar SOLAS en su línea, y vale el ÚLTIMO bloque: el agente lee
# «<discord>…</discord>» en su prompt y puede repetirlo en una oración antes del bloque de
# verdad; con la primera coincidencia suelta se postearía ese pedazo de prosa.
function Get-DiscordBlock {
  param([string]$Text)
  $found = [regex]::Matches([string]$Text, '(?ms)^[ \t]*<discord>[ \t]*\r?\n(.*?)\r?\n[ \t]*</discord>[ \t]*\r?$')
  if ($found.Count -eq 0) { return $null }
  $block = $found[$found.Count - 1].Groups[1].Value.Trim()
  if ($block) { return $block }
  return $null
}

# Postea un texto a un webhook de Discord. Nunca rompe la corrida: si falla, avisa y sigue.
# -Username cambia el nombre con el que aparece ese mensaje (el webhook es de un canal, y lo
# pueden compartir dos agentes: sin esto el reporte de Pico saldría firmado como Numa).
function Send-DiscordMessage {
  param([string]$WebhookUrl, [string]$Text, [string]$Username)
  $max = 1990
  if ($Text.Length -gt $max) { $Text = $Text.Substring(0, $max - 20) + "`n… (recortado)" }
  # allowed_mentions vacío: un "@everyone" en el texto del agente no notifica a nadie.
  $payload = @{ content = $Text; allowed_mentions = @{ parse = @() } }
  if ($Username) { $payload.username = $Username }
  $body = $payload | ConvertTo-Json -Depth 4 -Compress
  try {
    Invoke-RestMethod -Uri $WebhookUrl -Method Post -ContentType 'application/json; charset=utf-8' `
      -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 20 | Out-Null
    return $true
  } catch {
    # El webhook es un secreto: si el error lo cita (una URL mal formada, por ejemplo), no sale al log.
    $why = [string]$_.Exception.Message
    if ($WebhookUrl) { $why = $why.Replace($WebhookUrl, '***') }
    Write-Warning "No pude postear a Discord: $why"
    return $false
  }
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
    '{{PRODUCT_REPOS}}'       = (Format-ProjectRepos -Project $Project)
    '{{CODE_REPOS}}'          = (Format-WritableRepos -Project $Project)
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
