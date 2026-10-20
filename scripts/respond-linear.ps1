# Responde un comentario/feedback del owner en un issue de Linear (loop HITL conversacional).
# Lo invoca el workflow n8n `linear-feedback-listener` cuando un comentario empieza con el
# nombre de un agente + ':' (ej. "Numa: ¿de qué tabla sale ese número?").
#   uso:  powershell -ExecutionPolicy Bypass -NoProfile -File scripts\respond-linear.ps1 -IssueId ACM-7 -AgentName numa
#         ... -IssueId ACM-3 -AgentName numa -TeamId <uuid-del-webhook>   (el listener pasa el teamId y aquí se resuelve el proyecto)
#         ... -IssueId ACM-3 -AgentName capi -Project acme                (run manual)
#
# Roster de agentes y system prompts: scripts\agents.ps1 + memory\agents-roster.md.
# El agente carga su system prompt del registry, lee el issue + el hilo (MCP linear) y, si hace
# falta, Supabase read-only, y deja UN comentario nuevo que EMPIEZA con su firma
# "🤖 <Nombre> <Emoji>:" (anti-loop: el listener excluye comentarios que empiezan con 🤖,
# así el agente no se autoresponde — necesario porque comenta con la API key del owner).
param(
  [Parameter(Mandatory = $true)][string]$IssueId,
  [Parameter(Mandatory = $true)][string]$AgentName,
  [string]$CommentBody = "",  # opcional, legacy; el agente lee el hilo vía MCP, no lo necesita
  [string]$TeamId = "",       # UUID del team que manda el webhook de Linear — resuelve el proyecto (gana sobre -Project)
  [string]$Project = "",      # slug explícito (runs manuales); si faltan los dos, default acme con warning
  [switch]$DryRun             # muestra la config resuelta sin llamar a claude
)
$ErrorActionPreference = "Stop"

# Guard: si n8n pasa una expresión que resolvió a undefined/null/empty, falla ruidoso.
# Mandatory + [string] en PS acepta "" y "undefined" como strings válidos, así que
# este check es necesario. Sin él pasa en silencio — el modelo recibe 'Estás
# respondiendo en el issue undefined' y devuelve un saludo genérico.
if ([string]::IsNullOrWhiteSpace($IssueId) -or $IssueId -in @('undefined', 'null', '[object Object]')) {
  Write-Error "IssueId invalido recibido del workflow: '$IssueId'. Revisar la expresion en automation/n8n/linear-feedback-listener.json (campo de Linear webhook puede ser data.issueId UUID, NO data.issue.identifier)."
  exit 1
}

# Raíz del repo (este script vive en scripts\)
Set-Location (Split-Path $PSScriptRoot -Parent)

# Secretos del server desde .env.server (mismo loader que run-skill.ps1, con strip de comillas).
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

# Refrescar PATH desde el registry de Windows. Importante para procesos como el
# servicio n8n-local que capturan el env al arrancar: cualquier binario instalado
# DESPUÉS (ej. `gh` para Cody, vía `winget install GitHub.cli`) no aparece en su
# $env:PATH hasta que el servicio reinicie. Aquí lo re-leemos en cada invocación.
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
  # Ver run-skill.ps1: claude migró al native installer (%USERPROFILE%\.local\bin).
  # Prependeamos .local\bin del usuario real para que el binario vivo gane el PATH.
  $claudeBin = Join-Path $env:CLAUDE_USERPROFILE '.local\bin'
  if (Test-Path $claudeBin) { $env:PATH = "$claudeBin;$env:PATH" }

  # Cody corre `pnpm` (gating del producto) vía corepack. corepack guarda la versión
  # activada en COREPACK_HOME, que por defecto cuelga de %LOCALAPPDATA%. Bajo SYSTEM
  # (n8n-local) eso apunta al systemprofile vacío y pnpm no resuelve versión. Lo
  # redirigimos al corepack del usuario real, donde quedó pnpm activado.
  $corepackHome = Join-Path $env:CLAUDE_USERPROFILE 'AppData\Local\node\corepack'
  if (Test-Path $corepackHome) { $env:COREPACK_HOME = $corepackHome }

  # Qualy usa el Playwright MCP (browser real). Los browsers se instalaron en el
  # ms-playwright del user real; bajo SYSTEM, %LOCALAPPDATA% apunta al systemprofile
  # (vacío) y el MCP no encontraría chromium. Apuntamos PLAYWRIGHT_BROWSERS_PATH al
  # cache del user real.
  $pwBrowsers = Join-Path $env:CLAUDE_USERPROFILE 'AppData\Local\ms-playwright'
  if (Test-Path $pwBrowsers) { $env:PLAYWRIGHT_BROWSERS_PATH = $pwBrowsers }
}

# GitHub auth para Cody headless. `gh pr create` usa GH_TOKEN directo del env. Pero
# `git push` NO lee GH_TOKEN, y bajo SYSTEM (n8n-local) no hay keyring/GCM del usuario
# para resolver credenciales. Inyectamos el token como header HTTP de Authorization
# para github.com via GIT_CONFIG_* (mismo metodo que GitHub Actions): no depende de
# credential helpers ni del keyring. Solo si .env.server trae GH_TOKEN.
if ($env:GH_TOKEN) {
  $ghBasic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("x-access-token:$($env:GH_TOKEN)"))
  $env:GIT_CONFIG_COUNT = "1"
  $env:GIT_CONFIG_KEY_0 = "http.https://github.com/.extraheader"
  $env:GIT_CONFIG_VALUE_0 = "Authorization: Basic $ghBasic"
}

# Roster (agents.ps1) + capa multi-proyecto (project.ps1).
. "$PSScriptRoot\agents.ps1"
. "$PSScriptRoot\project.ps1"

# Resolución del proyecto: el listener n8n pasa -TeamId (UUID del webhook) y aquí se
# mapea al slug vía projects\*\project.json (falla ruidoso si no matchea — NUNCA
# defaultear en silencio al proyecto equivocado). -Project explícito es para runs
# manuales. Sin ninguno: default a acme, con warning para que se note en el log.
if ($TeamId) {
  $Project = Resolve-ProjectSlugFromLinearTeamId -TeamId $TeamId
} elseif ([string]::IsNullOrWhiteSpace($Project)) {
  # Fallback: si el IssueId es un identifier humano ("ACM-12"), el prefijo ES el team key.
  if ($IssueId -match '^([A-Za-z]+)-\d+$') {
    $Project = Resolve-ProjectSlugFromLinearTeamKey -TeamKey $matches[1]
  } else {
    $Project = 'acme'
    Write-Warning "Sin -TeamId / -Project y el IssueId no es identifier humano: asumo 'acme' (default). El listener n8n debería pasar -TeamId."
  }
}
$projectObj = Resolve-ProjectContext -Slug $Project
$ownerName = Get-ProjectOwnerName -Project $projectObj

$agent = Get-Agent -Name $AgentName
$signature = "🤖 $($agent.Name) $($agent.Emoji)"

# ¿El agente está habilitado para este proyecto? (project.json → agents.<name>.enabled)
if (-not (Test-AgentEnabled -Agent $agent -Project $projectObj)) {
  Write-Error "$($agent.Name) está deshabilitado para el proyecto $($projectObj.name) (projects\$($projectObj.slug)\project.json). No corro."
  exit 1
}

# Alfred (meta-agente que mejora a los otros agentes) NO corre por el flujo comment/writes-code
# de este script: tiene su propio wrapper dedicado (loadout de edición del repo de AGENTES +
# git/PR contra un clon limpio), igual que Greta-SEO / Cody-scan decoplan su modo del registry.
# El listener lo enruta aquí (misma regex), y aquí delegamos y salimos.
if ($agent.Name -eq 'Alfred') {
  $alfredArgs = @{ Job = 'issue'; IssueId = $IssueId; Project = $projectObj.slug }
  if ($DryRun) { $alfredArgs['DryRun'] = $true }
  & "$PSScriptRoot\run-alfred.ps1" @alfredArgs
  exit $LASTEXITCODE
}

# Identidad de commits para los agentes que escriben código (Cody / writes-code).
# Vercel (y otros hostings) autorizan el deploy según el AUTHOR del commit, que resuelve a
# un GitHub login por EMAIL: si el email mapea a una cuenta SIN permiso en el team del
# hosting, el deploy falla. Fijamos author+committer por env (GIT_AUTHOR_*/GIT_COMMITTER_*
# ganan sobre cualquier git config local/global del repo del producto, incluso un
# `-c user.email`), así NUNCA puede regresar al email equivocado si el config local del
# server driftea. El name conserva la atribución del agente ("Cody (Acme agent)"); el name
# no influye en el mapeo (solo el email). Si algún proyecto vive bajo OTRA cuenta de
# GitHub, vuelve este email per-proyecto vía projects\<slug>\project.json.
if ($agent.OperatingMode -eq 'writes-code') {
  $env:GIT_AUTHOR_NAME     = "$($agent.Name) ($($projectObj.name) agent)"
  $env:GIT_AUTHOR_EMAIL    = 'owner@example.com'   # TODO(acme): el email de la cuenta de GitHub CON permiso de deploy
  $env:GIT_COMMITTER_NAME  = $env:GIT_AUTHOR_NAME
  $env:GIT_COMMITTER_EMAIL = $env:GIT_AUTHOR_EMAIL
}

# Presupuesto: backstop profundo, NO el guard principal (corre contra una suscripción
# OAuth — el guard de runaway es el watchdog de TIEMPO de project.ps1).
$budget = if ($agent.PSObject.Properties['Budget'] -and $agent.Budget) { $agent.Budget }
          elseif ($env:PER_RUN_BUDGET_USD) { $env:PER_RUN_BUDGET_USD }
          elseif ($env:DAILY_BUDGET_USD) { $env:DAILY_BUDGET_USD }
          else { "50" }

# Modelo: prioridad $agent.Model (definido en agents.ps1 — hoy TODOS lo declaran:
# Sonnet default, Opus para Pico/Cody/Daly) > ANTHROPIC_MODEL del env > Sonnet.
# Política: nada en Haiku salvo lo realmente trivial.
$model = if ($agent.Model) { $agent.Model }
         elseif ($env:ANTHROPIC_MODEL) { $env:ANTHROPIC_MODEL }
         else { "claude-sonnet-4-6" }

# Effort opcional por-agente (solo aplica en modelos que lo soportan, ej. Opus 4.7).
# Cody declara xhigh para que reason más largo antes de tocar archivos del producto.
$effortArgs = @()
if ($agent.Effort) { $effortArgs += @('--effort', $agent.Effort) }

# Regla de estado del issue para los agentes que PRODUCEN trabajo (Cody/Daly/Leda/Qualy):
# cuando toman un pedido mueven el issue a In Progress para que en Linear se vea qué se
# está trabajando (si no, el estado solo cambia de rebote cuando Cody abre un PR).
# Los que SOLO contestan una consulta (Capi/Numa/Greta/Pico) NO tocan el estado. Mueven solo
# el estado (este avance), nunca label/asignación/prioridad. Se appendea a los 4 modos de
# producción de trabajo de abajo.
$workStatusClause = @"
- Estado del issue (IMPORTANTE): el avance de estado depende de SI ESTE PEDIDO te pone a producir trabajo tangible.
  - Si el pedido te pide PRODUCIR algo (código/PR, una verificación de QA, un mockup, un draft, una publicación): apenas lo tomas, ANTES de generarlo, mueve el issue $IssueId a 'In Progress' con el Linear MCP (mcp__linear__save_issue, campo de estado = 'In Progress'), así en Linear se ve que lo estás trabajando. Esto vale AUNQUE necesites preguntarle algo a $ownerName para poder seguir: mueves igual y dices en la primera línea de tu comentario (después de la firma) que quedas esperando su respuesta para continuar.
  - Si el pedido es SOLO una consulta que se contesta en tu comentario y NO deja trabajo en curso (p. ej. 'Leda: ¿esto va al backlog?', 'Cody: ¿es viable X?'): NO toques el estado — déjalo como está y responde la consulta. Un issue no debe quedar 'In Progress' sin que nadie lo esté trabajando.
  - NUNCA retrocedas ni REABRAS un issue: si ya está en 'In Progress' o en un estado más avanzado — arrancado ('In Review') o YA CERRADO ('Done', 'Canceled', 'Duplicate', o cualquier otro estado de tipo completed/canceled que tenga el team) — déjalo como está (mover a In Progress uno cerrado como Duplicate lo reabriría). Solo mueves desde un estado sin empezar (Backlog / Todo / Triage); si dudas del estado actual, léelo primero con mcp__linear__get_issue.
  - Mueves SOLO el estado (este avance); NUNCA toques label, asignación ni prioridad.
"@

# Contexto operativo del turno — depende del OperatingMode del agente.
# Modos: 'comment-only' (Numa/Greta — read-only, solo comentan), 'lead-triage-and-create'
# (Capi — triage + puede crear issues), 'creates-issues' (Pico), 'writes-code'
# (Cody), 'qa-tests' (Qualy), 'design-creates-mockups' (Daly), 'content-publishes'
# (Leda). Sin OperatingMode, default a comment-only.
switch ($agent.OperatingMode) {
  'creates-issues' {
    $operatingContext = @"
Contexto operativo de este turno:
- Estás respondiendo en el issue $IssueId de Linear (team $($projectObj.linear.teamKey), proyecto $($projectObj.name)).
- El comentario que te invocó es el MÁS RECIENTE en el hilo del issue que empieza con '$($agent.Name):' (case-insensitive). Léelo + el resto del thread con el MCP de Linear para tener contexto.
- Para fundamentar, lee los repos del producto (solo lectura; sus archivos guía primero: CLAUDE.md / AGENTS.md si existe) y Supabase / GA4 / CrUX según corresponda. Repos:
$(Format-ProjectRepos -Project $projectObj)
- Si la propuesta cumple las condiciones de tu system prompt para crear ticket, USA el Linear MCP para crearlo en team $($projectObj.linear.teamKey) con la convención EXACTA de ``memory/CLAUDE.md`` § "Linear destination convention" (label agent-proposal, Backlog, sin asignar, sin priority, sin cycle, body con las 6 secciones).
- En TODOS los casos, deja UN comentario nuevo en el issue actual donde te invocaron. El comentario DEBE empezar con la firma exacta '${signature}: '. Si creaste un ticket, menciónalo con su ID y link (ej. "Issue $($projectObj.linear.teamKey)-XX creado, ver allí el detalle"); si no creaste, explica por qué (ambiguo / PRD / sensible / etc.).
- NO cambies estado, prioridad, asignación ni label del issue donde te invocaron. Solo en el issue NUEVO que tú creas como propuesta, puedes setear lo que dicte la convención.
- Si generas copy customer-facing, sigue la convención del proyecto: $($projectObj.languageConvention)
"@
  }
  'lead-triage-and-create' {
    $operatingContext = @"
Contexto operativo de este turno (LEAD — triage + puedes crear issues):
- Estás respondiendo en el issue $IssueId de Linear (team $($projectObj.linear.teamKey), proyecto $($projectObj.name)).
- El comentario que te invocó es el MÁS RECIENTE en el hilo del issue que empieza con '$($agent.Name):' (case-insensitive). Léelo + el resto del thread con el MCP de Linear para tener contexto.
- Si necesitas data para decidir, consulta Supabase read-only (solo agregados, sin PII). Cita los números, no inventes. Para el detalle del proyecto, carga lo que necesites de $($projectObj.contextDir)\ (brand-bible, glossary, data-model, icp). NO tienes el repo del producto en tu sandbox: si hace falta mirarlo, delega en el agente que sí lo tiene (Cody/Qualy/Pico).
- Como Lead PUEDES crear issues en el team $($projectObj.linear.teamKey) cuando el pedido amerite trackear o delegar trabajo concreto (descomponer un pedido grande, formalizar una decisión, abrir un follow-up). Usa el Linear MCP con la convención EXACTA de ``memory/CLAUDE.md`` § "Linear destination convention" (label agent-proposal, Backlog, sin asignar, sin priority, sin cycle, título [Proposal] ..., body con las 6 secciones). Crea SOLO los que aporten — si con comentar y rutear alcanza, no infles el board.
- En TODOS los casos deja UN comentario nuevo en el issue $IssueId. DEBE empezar EXACTAMENTE con la firma '${signature}: '. Si creaste issues, lístalos con su ID + link y por qué; si no creaste ninguno, responde/rutea normalmente.
- NO cambies estado, prioridad, asignación ni label del issue donde te invocaron. La convención de arriba aplica SOLO a los issues NUEVOS que tú creas. NO escribas código ni abras PRs.
- Si generas copy customer-facing, sigue la convención del proyecto: $($projectObj.languageConvention)
"@
  }
  'writes-code' {
    $operatingContext = @"
Contexto operativo de este turno:
- Estás respondiendo a un pedido en el issue $IssueId de Linear (team $($projectObj.linear.teamKey), proyecto $($projectObj.name)).
- El comentario que te invocó es el MÁS RECIENTE en el hilo que empieza con '$($agent.Name):' (case-insensitive). Léelo + todo el thread con el MCP de Linear.
- El repo del producto por defecto es ``$($projectObj.productRepoPath)``; si tu system prompt lista varios en "Repos donde puedes escribir", elige el repo destino con esa regla (``Repo destino:`` del brief de Daly > el issue > preguntar). ANTES de editar, verifica con ``git remote -v`` que el remote corresponde al repo destino de $($projectObj.name) — si no coincide, aborta y repórtalo.
- Sigue el WORKFLOW de tu system prompt al pie de la letra: leer los archivos guía del producto, sync main, branch ``cody/*``, edit, gating (los comandos exactos están en tu override de proyecto, por repo si hay varios), commit, push, ``gh pr create``, y al final volver el checkout a main.
- Las herramientas Bash disponibles incluyen git, el package manager del producto, node, gh y comandos read-only típicos. Úsalas con criterio. No corras nada fuera del workflow.
- Al terminar (sea con PR abierta o con un fallo en el camino), deja UN comentario nuevo en el issue de Linear. El comentario DEBE empezar con la firma exacta '${signature}: '. Si abriste PR: incluye el link. Si fallaste: explica qué falló, dónde, y qué decisión te bloqueó.
- NO mergees PRs. NO toques label ni asignación del issue de Linear ($ownerName promueve el PR a In Review / Done después de revisarlo en GitHub).
$workStatusClause
"@
  }
  'qa-tests' {
    $operatingContext = @"
Contexto operativo de este turno:
- Estás respondiendo a un pedido en el issue $IssueId de Linear (team $($projectObj.linear.teamKey), proyecto $($projectObj.name)).
- El comentario que te invocó es el MÁS RECIENTE en el hilo que empieza con '$($agent.Name):' (case-insensitive). Léelo + todo el thread con el MCP de Linear.
- Interpreta QUÉ tipo de QA te piden y ejecútalo según tu system prompt:
  · Testear un PR / preview → encuentra el PR con ``gh`` (en ``$($projectObj.productRepoPath)``) y su URL de preview de Vercel, corre la suite del producto contra el preview SI el producto tiene suite (tu override de proyecto dice qué comandos existen) + pasada exploratoria del flujo que cambió con el Playwright MCP.
  · Smoke de prod → flujos clave NO DESTRUCTIVOS contra $($projectObj.productUrl).
  · Flujo puntual → testéalo en la URL que te indiquen (sandbox = flujo completo; prod = no destructivo).
- Bash disponible: los comandos de test del producto (override), gh, git, node. Playwright MCP para browser real. Supabase read-only para verificar efectos de data. Vercel read-only (mcp__vercel__*) para el estado y el build log del deployment de un preview y para errores de runtime (nunca el token por Bash ni el CLI de Vercel). Respeta las reglas de Seguridad de tu system prompt: en prod, CERO mutaciones (nada de signups/pagos reales).
- Al terminar, deja UN comentario nuevo en el issue $IssueId con tu veredicto (✅ PASS / ❌ FAIL / ⚠️ con observaciones) + hallazgos concretos. DEBE empezar con la firma exacta '${signature}: '.
- NO escribas código, NO abras PRs, NO mergees, NO toques label ni asignación del issue.
$workStatusClause
"@
  }
  'design-creates-mockups' {
    $operatingContext = @"
Contexto operativo de este turno (DISEÑO + MOCKUP):
- Estás respondiendo en el issue $IssueId de Linear (team $($projectObj.linear.teamKey), proyecto $($projectObj.name)).
- El comentario que te invocó es el MÁS RECIENTE en el hilo del issue que empieza con '$($agent.Name):' (case-insensitive). Léelo + todo el thread con el MCP de Linear para tener contexto.
- Tu output es DOBLE:
  (a) UN comentario en el issue $IssueId que empieza EXACTAMENTE con '${signature}: ' + veredicto (si pidieron review) o resumen (si pidieron diseño) + links a los archivos que dejaste en design/ + 2-4 puntos clave de razonamiento. La explicación entera va en brief.md, NO en el comentario.
  (b) Carpeta nueva en ``design\$($projectObj.slug)\$IssueId-<slug>\`` (slug ≤4 palabras kebab-case, derivado del título del issue) con: ``brief.md`` (las 7 secciones EXACTAS de tu system prompt) + ``mockup.html`` (auto-contenido, replica las CSS variables del design system del proyecto) + ``mockup-notes.md``. Opcional: ``screenshots/before-after.md`` y ``mockup.svg``.
- ANTES de proponer/diseñar: carga el design system del proyecto — tu override de proyecto dice exactamente dónde viven los tokens y el catálogo de componentes. NUNCA inventes tokens que no existan.
- Si el pedido amerita ticket ``[Design]`` propio (accionable, ≤2 días de Cody), créalo en Linear team $($projectObj.linear.teamKey) con la convención EXACTA de ``memory\CLAUDE.md`` § "Linear destination convention" (label ``agent-proposal``, Backlog, sin asignar, sin priority, sin cycle, body con las 6 secciones), linkeando la carpeta ``design\$($projectObj.slug)\<...>\``. Si NO creas issue, explica brevemente por qué en el comentario (exploración / necesita conversación / fuera de scope).
- NUNCA escribas en ``$($projectObj.productRepoPath)`` ni en ningún otro repo del producto. Solo los lees (si el producto es multi-repo, tienes todos montados: diseña sobre la UI real del repo que corresponde y declara ``Repo destino: <key>`` al abrir ``## Spec para Cody``). Tus archivos van EXCLUSIVAMENTE a ``design\`` de este repo (el de agentes — tu cwd actual).
- Mockup HTML: auto-contenido, abre con doble click (sin build, sin npm install, sin CDN runtime excepto Google Fonts). Replica las CSS variables del design system del proyecto al inicio del ``<style>`` (EXACTAS, del archivo que indica tu override). Iconos = SVG inline de [lucide.dev](https://lucide.dev). Fuentes del design system vía Google Fonts. Mobile-first (~390px) con media query desktop.
- Si tu mockup incluye copy customer-facing (headers, microcopy, CTAs, errores), carga la brand bible del proyecto y respeta: $($projectObj.languageConvention)
- A11y mínima obligatoria: foco visible, labels en inputs, headings jerárquicos, aria-label en icon buttons, contraste suficiente. Lo que no cumplas, decláralo en ``## A11y check`` del brief.
- NO toques prioridad, asignación ni label del issue donde te invocaron. Si creas un issue [Design] NUEVO, aplica la convención canónica ahí.
$workStatusClause
"@
  }
  'content-publishes' {
    $operatingContext = @"
Contexto operativo de este turno (CONTENT — Leda interactiva):
- Estás respondiendo en el issue $IssueId de Linear (team $($projectObj.linear.teamKey), proyecto $($projectObj.name)).
- El comentario que te invocó es el MÁS RECIENTE en el hilo del issue que empieza con '$($agent.Name):' (case-insensitive). Léelo + todo el thread con el MCP de Linear.
- Detecta qué te están pidiendo según los patrones de tu override de proyecto (CANCEL / MEJORAR / BACKLOG u otros que el override defina) y ejecuta EXACTAMENTE ese flujo con el toolset que el override te da. Si el comentario no encaja en ningún patrón, comenta pidiendo clarificación SIN hacer nada (no inventes una acción).
- NO publiques en este path interactivo salvo que tu override de proyecto lo permita explícitamente — en general el publish es de los crons.
- NO toques label ni asignación del issue donde te invocaron — deja UN comentario nuevo (más el avance de estado de abajo).
$workStatusClause
- Si el comentario implica copy customer-facing, carga la brand bible del proyecto y respeta: $($projectObj.languageConvention)
- Tu comentario DEBE empezar EXACTAMENTE con la firma '${signature}: '. Sin markdown bold, sin paréntesis.
"@
  }
  default {
    # comment-only (Numa, Greta — read-only, solo comentan).
    $operatingContext = @"
Contexto operativo de este turno:
- Estás respondiendo en el issue $IssueId de Linear (team $($projectObj.linear.teamKey), proyecto $($projectObj.name)).
- El comentario que te invocó es el MÁS RECIENTE en el hilo del issue que empieza con '$($agent.Name):' (case-insensitive). Léelo + el resto del thread con el MCP de Linear para tener contexto.
- Si necesitas datos, consulta las fuentes read-only del proyecto que define tu override (Supabase, la DB de la app, GA4, Stripe...) — sin PII, solo agregados. Cita los números, no inventes. Si el dato depende de cómo lo genera el código, lee los repos del producto (solo lectura).
- Deja UN solo comentario nuevo en el issue. Tu comentario DEBE empezar con la firma exacta '${signature}: ' (con espacio después de los dos puntos). Es obligatorio: el listener excluye comentarios que empiezan con 🤖, así no se loopea, y la firma le dice a $ownerName quién contestó.
- NO cambies el estado, ni la prioridad, ni la asignación del issue. NO crees issues nuevos. Solo comentas.
- Si generas copy customer-facing, sigue la convención del proyecto: $($projectObj.languageConvention)
"@
  }
}

# Escalación a Alfred 🎩 (mejora de agentes). Se appendea al system prompt de CUALQUIER
# agente (Alfred ya salió por delegación arriba). Convierte el feedback FUERTE de
# comportamiento del owner en un issue Linear label 'alfred' que la corrida diaria de Alfred
# procesa. Guardado (SOLO feedback de comportamiento, no fixes puntuales) para no inflar el board.
$escalationClause = @"
Escalación a Alfred 🎩 (el agente que mejora a los agentes) — SOLO si el feedback lo amerita:
- Si el comentario de $ownerName es un feedback FUERTE sobre tu COMPORTAMIENTO — te dice que tu forma de actuar / tus instrucciones / tu criterio estuvieron mal, o que necesita que CAMBIES cómo haces algo (NO un simple "corrige este dato / este copy / este bug puntual") — entonces, ADEMÁS de resolver lo inmediato en tu comentario, escala a Alfred:
  1. Crea UN issue en Linear (team $($projectObj.linear.teamKey)) con label 'alfred', estado Backlog, sin asignar, sin priority. Título: '[Retro] $($agent.Name): <resumen en 5-8 palabras>'. Body con: (a) cita textual de lo que marcó $ownerName; (b) qué comportamiento/instrucción tuya parece estar mal; (c) qué artefacto sospechas que habría que cambiar (tu system prompt en scripts/agents.ps1, tu override en projects/<slug>/agent-overrides/$($agent.Name.ToLower()).md, tu SKILL.md, o tu wrapper .ps1); (d) una línea '---' y debajo 'Generado por ${signature}'.
  2. Menciónalo en tu comentario de respuesta a ${ownerName}: "Escalé a Alfred para revisarlo a nivel sistema ($($projectObj.linear.teamKey)-XX)."
- Ese [Retro] es el ÚNICO issue que tienes permitido crear aunque tu modo sea 'solo comentas' — es una excepción acotada, exclusiva para escalar a Alfred.
- Si el feedback es chico/puntual (un fix de una sola vez, sin patrón de comportamiento) → NO escales. No infles el board. Solo arregla y comenta.
"@

# System prompt = identidad del agente (core del registry, con placeholders interpolados
# desde project.json + override del proyecto appendeado) + contexto operativo del turno
# + la cláusula de escalación a Alfred. Va por --append-system-prompt: define el ROL y las
# REGLAS, no es la tarea.
$resolvedPrompt = Resolve-AgentPrompt -Agent $agent -Project $projectObj
$systemPrompt = @"
$resolvedPrompt

$operatingContext

$escalationClause
"@

# User message = la TAREA imperativa de este turno. Va por -p. Crítico: sin un mensaje
# imperativo concreto, el modelo (especialmente Haiku) trata el system prompt como
# "describe tu rol" y responde con un saludo genérico tipo "Hola, soy Pico, ¿qué necesitas?"
# en vez de ejecutar la tarea. Esta lista numerada le dice EXACTAMENTE qué tools usar.
$userPrompt = @"
$ownerName acaba de comentar en el issue $IssueId de Linear (team $($projectObj.linear.teamKey), proyecto $($projectObj.name)) arrancando con '$($agent.Name):'. Es un pedido para ti.

Haz esto AHORA, en este orden:
1. Lee el issue completo con el Linear MCP (mcp__linear__get_issue u operación equivalente del server 'linear' — el ID es '$IssueId', puede ser UUID o identifier estilo $($projectObj.linear.teamKey)-X, el MCP acepta los dos).
2. Lee el thread del issue con mcp__linear__list_comments. Encuentra el ÚLTIMO comentario cuyo body empiece con '$($agent.Name):' (case-insensitive) — ese es el pedido vigente.
3. Haz el trabajo siguiendo tu system prompt y el contexto operativo de este turno (los pasos detallados están arriba en system).
4. Deja UN comentario nuevo en el issue $IssueId con mcp__linear__create_comment. El body DEBE empezar EXACTAMENTE con '${signature}: ' (emoji robot + espacio + nombre + espacio + emoji del agente + dos puntos + un espacio). SIN markdown bold (no '**'), SIN paréntesis, SIN agregar palabras antes del emoji. Eso EXACTO es lo que el listener excluye para no loopearse.

Empieza ya. No me describas el plan — ejecútalo. Tu respuesta final puede ser un resumen corto de qué hiciste (qué leíste, qué decidiste, qué comentario/issue dejaste), no la respuesta entera al usuario (esa va en el comentario de Linear que dejaste con el MCP).
"@

# Allowlist por-agente (definida en agents.ps1). Pico/Numa/Greta leen Supabase + Linear (+ GA4/CWV);
# Cody suma Edit/Write/Bash para trabajar en el repo del producto; Capi solo lee.
$allowed = $agent.AllowedTools

# Repos del producto al día ANTES de que el agente los lea: la regla "verifica contra el
# código" no sirve si la copia local está atrás del main o quedó en una rama de Cody — y los
# agentes comment-only (Numa/Greta/Pico) NO tienen Bash para darse cuenta. Los wrappers dedicados
# (Greta SEO/AEO, Cody scan, Capi roadmap) ya sincronizan; aquí lo hace el listener. Best-effort y
# no bloqueante (Sync-ProjectRepos captura sus errores).
# -NoSwitch: a diferencia de los crons, el listener dispara con CADA comentario a cualquier agente
# y podría caer sobre una rama recién creada por Cody desde main (limpia, sin commits locales, <1 h)
# que sync-product-repos devolvería a main, cortándole el checkout. Aquí: solo fetch + ff si YA está
# en la rama default, nunca cambia de rama. Después le contamos al agente (comment-only, sin Bash)
# en qué rama / cuántos commits atrás quedó cada repo, para que lo tenga en cuenta al verificar.
if (-not $DryRun -and @($agent.AdditionalDirs).Count -gt 0) {
  Sync-ProjectRepos -Project $projectObj -NoSwitch
  $repoStatus = Format-ProjectReposStatus -Project $projectObj
  if ($repoStatus) {
    $systemPrompt = @"
$systemPrompt

Estado de las copias locales del producto que vas a leer — tenlo en cuenta al "verificar contra el código" y dilo en tu comentario si cambia tu respuesta:
$repoStatus
Si un repo figura atrás de origin o en otra rama, el código que leas puede no ser el del main actual.
"@
  }
}

# Dirs adicionales por-agente: el registry usa los placeholders {{PRODUCT_REPO_PATH}}
# (repo primario) o {{PRODUCT_REPOS}} (todos), resueltos aquí contra el proyecto. `claude --add-dir` expande el
# sandbox de file tools sin pisar el cwd (que sigue siendo la raíz del repo de agentes).
$addDirArgs = Resolve-AgentAdditionalDirs -Agent $agent -Project $projectObj

# MCP config por-agente: variante del agente ('qa'/'design') resuelta contra
# project.json → mcpVariants; el resto usa el MCP default del proyecto. Así los demás
# agentes NO levantan el browser de Playwright en cada corrida.
$mcpConfig = Resolve-AgentMcpConfig -Agent $agent -Project $projectObj

if ($DryRun) {
  "=== DRY RUN respond-linear (no se llamó a claude) ==="
  "Project : $($projectObj.slug) | Issue: $IssueId | Agent: $($agent.Name)"
  "Model   : $model | Budget: $budget | Effort: $(if ($agent.Effort) { $agent.Effort } else { '-' })"
  if ($agent.OperatingMode -eq 'writes-code') { "Commit  : $env:GIT_AUTHOR_NAME <$env:GIT_AUTHOR_EMAIL>" }
  "MCP     : $mcpConfig"
  "Allowed : $allowed"
  "AddDirs : $(if ($addDirArgs) { $addDirArgs -join ' ' } else { '(ninguno)' })"
  "Team    : $($projectObj.linear.teamKey) | SUPABASE_PROJECT_REF: $env:SUPABASE_PROJECT_REF"
  "Vercel  : $(Format-ProjectVercelPin)"
  "--- System prompt resuelto (primeras 30 líneas) ---"
  ($systemPrompt -split "`n" | Select-Object -First 30) -join "`n"
  exit 0
}

# Guard de runtime por tiempo (ver project.ps1).
$timeoutMin = Resolve-AgentTimeout -Agent $agent
$watchdog = Start-AgentWatchdog -TimeoutMinutes $timeoutMin
$runStart = Get-Date

$json = "" | claude -p $userPrompt `
  --append-system-prompt $systemPrompt `
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

$parsed = $null
try { $parsed = $json | ConvertFrom-Json } catch {}

if (-not $parsed) {
  Write-AgentAudit -Wrapper 'respond-linear' -ProjectSlug $projectObj.slug -Name "$($agent.Name)/$IssueId" -Model $model -CostUsd $null -DurationS $durationS -IsError $true -TimedOut $timedOut
  $timeoutNote = if ($timedOut) { " TIMEOUT: el watchdog mató la corrida a los $timeoutMin min." } else { "" }
  Write-Error "claude -p no devolvió JSON parseable para respond-linear $IssueId (exit $exit).$timeoutNote Salida cruda:`n$json"
  exit 1
}

Write-AgentAudit -Wrapper 'respond-linear' -ProjectSlug $projectObj.slug -Name "$($agent.Name)/$IssueId" -Model $model -CostUsd $parsed.total_cost_usd -DurationS $durationS -IsError ([bool]$parsed.is_error) -TimedOut $timedOut

$parsed.result
"---"
$effortLabel = if ($agent.Effort) { " | Effort: $($agent.Effort)" } else { "" }
"IssueId: $IssueId | Agent: $($agent.Name) | Model: $model$effortLabel"
"Costo USD: $($parsed.total_cost_usd) | Duración: $([math]::Round($durationS))s"

if ($exit -ne 0 -or $parsed.is_error) {
  Write-Error "respond-linear falló para $IssueId (exit $exit, is_error=$($parsed.is_error))"
  exit 1
}
