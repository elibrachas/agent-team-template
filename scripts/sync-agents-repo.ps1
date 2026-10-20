# Actualiza la copia VIVA del repo de agentes (ESTA PC — la que corre los crons/listener) con lo
# que se haya mergeado en MAIN (típicamente un PR de Alfred ya aprobado). Así el runtime en esta
# máquina toma las mejoras sin que las tengas que traer a mano.
#
#   uso:  powershell -ExecutionPolicy Bypass -NoProfile -File scripts\sync-agents-repo.ps1
#         ... -Quiet   (sin ruido si ya estaba al día — para llamarlo desde otro script)
#         ... -OpsProject <slug>   (proyecto "home de ops": en su team de Linear va el aviso; default acme)
#
# LA COPIA VIVA VA SIEMPRE EN MAIN. Exigir el working tree limpio no sirve —NUNCA lo está: los
# agentes reescriben memorias/roadmaps versionados en cada corrida— y pullear la rama actual en vez
# de main deja la copia viva decenas de commits atrás sin que nadie lo vea. Por eso:
#   - Si estás en otra rama y esa rama YA está mergeada (sin commits propios fuera de origin/main,
#     o su PR figura MERGED en GitHub) → vuelve a main. Si tiene trabajo sin mergear, NO cambia de
#     rama (avisa: el runtime está corriendo esa rama).
#   - En main: `git merge --ff-only origin/main` CON cambios sin commitear. Si un archivo con
#     cambios locales también cambió en origin, el ff aborta sin tocar NADA (y lista cuáles). En ese
#     caso descartamos SOLO esos archivos que chocan (vuelven a origin/main) —tras backup con fecha
#     en queue/sync-backups/ (gitignored)— y reintentamos el ff; el resto del WIP que no choca no se
#     toca. Si el reintento sigue sin entrar, NO se fuerza nada y queda UN [Alert] en Linear (team
#     del proyecto de ops) con el motivo y los archivos (uno solo mientras siga abierto). Nunca
#     stash, reset ni force.
param(
  [switch]$Quiet,
  [string]$OpsProject = 'acme'   # proyecto "home de ops": en su team de Linear se crea el [Alert]
)
$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

# .env.server para el GH_TOKEN (el repo de agentes es privado → el fetch/pull necesita auth).
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
$env:PATH = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
if ($env:CLAUDE_USERPROFILE) {
  $claudeBin = Join-Path $env:CLAUDE_USERPROFILE '.local\bin'
  if (Test-Path $claudeBin) { $env:PATH = "$claudeBin;$env:PATH" }
}
# GH auth para el pull de un repo privado (mismo método que Cody/Alfred: extraheader).
if ($env:GH_TOKEN) {
  $ghBasic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("x-access-token:$($env:GH_TOKEN)"))
  $env:GIT_CONFIG_COUNT = "1"
  $env:GIT_CONFIG_KEY_0 = "http.https://github.com/.extraheader"
  $env:GIT_CONFIG_VALUE_0 = "Authorization: Basic $ghBasic"
}

$main = 'main'
$branch = (git rev-parse --abbrev-ref HEAD 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or -not $branch) { Write-Warning "No pude leer la rama actual — ¿es un repo git?"; exit 1 }

# git escribe a stderr en operaciones normales; bajo $ErrorActionPreference='Stop' eso sería error
# terminante. Bajamos a 'Continue' y gateamos por $LASTEXITCODE.
$ErrorActionPreference = 'Continue'
git fetch origin --prune 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Warning "git fetch falló (¿GH_TOKEN?). No toco nada."; exit 1 }

# 1) Volver a main si la rama actual ya está mergeada.
if ($branch -ne $main) {
  $ahead = (git rev-list --count "origin/$main..HEAD" 2>$null | Out-String).Trim()
  $merged = ($ahead -eq '0')
  if (-not $merged -and (Get-Command gh -ErrorAction SilentlyContinue)) {
    # Squash/rebase merge: los commits de la rama no quedan en main, pero el PR figura MERGED.
    $prState = (gh pr view $branch --json state --jq .state 2>$null | Out-String).Trim()
    $merged = ($prState -eq 'MERGED')
  }
  if (-not $merged) {
    Write-Warning "La copia viva está en '$branch' con $ahead commit(s) sin mergear en $main — NO cambio de rama (el runtime corre ESTA rama). Mergea el PR o vuelve a $main a mano."
    exit 0
  }
  # El main LOCAL puede estar atrasado: cambiar a él "revertiría" archivos y git rechazaría el
  # switch. Si no tiene commits propios, lo movemos a origin/main antes (no está checked out).
  git merge-base --is-ancestor $main "origin/$main" 2>$null
  if ($LASTEXITCODE -eq 0) { git branch -f $main "origin/$main" 2>$null | Out-Null }
  $out = (git switch $main 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "No pude volver de '$branch' a $main — git no tocó nada. Detalle:`n$out"
    exit 1
  }
  "Copia viva: volví de '$branch' (ya mergeada) a $main."
}

# Aviso visible en Linear (team del proyecto de ops) cuando el sync no pudo actualizar la copia
# viva. Si el abort se traga en silencio, los crons corren código viejo sin que nadie lo vea.
# Idempotente: un solo [Alert] abierto por vez — mientras siga abierto NO se crea otro (no uno por
# corrida). Determinístico vía GraphQL directo (sin claude), mismo patrón que run-health-check.ps1.
function Send-SyncBlockedAlert {
  param([string]$Reason, [string]$Detail, [string]$Backup)
  if (-not $env:LINEAR_API_KEY) { Write-Warning "Sin LINEAR_API_KEY: no puedo avisar en Linear que el sync quedó bloqueado."; return }
  $teamId = $null
  try { $teamId = (Get-Content (Join-Path $root "projects/$OpsProject/project.json") -Raw -Encoding UTF8 | ConvertFrom-Json).linear.teamId } catch {}
  if (-not $teamId) { Write-Warning "No pude resolver el teamId del proyecto '$OpsProject' para el aviso de Linear."; return }
  $headers = @{ Authorization = $env:LINEAR_API_KEY; 'Content-Type' = 'application/json; charset=utf-8' }
  $gql = {
    param($Query, $Variables)
    $body = @{ query = $Query; variables = $Variables } | ConvertTo-Json -Depth 6 -Compress
    Invoke-RestMethod -Uri 'https://api.linear.app/graphql' -Method Post -Headers $headers -Body ([Text.Encoding]::UTF8.GetBytes($body))
  }
  $prefix = '[Alert] sync-agents-repo bloqueado'
  try {
    # Dedup SIN ventana de tiempo: si ya hay uno ABIERTO de esta clase, no creo otro. Así es "uno solo
    # mientras siga abierto", no uno por corrida. Filtramos por los tipos ABIERTOS (triage/backlog/
    # unstarted/started), NO por "excluir completed/canceled": en algunos workspaces el estado
    # Duplicate tiene type "duplicate" y, al no caer en completed ni canceled, un aviso cerrado como
    # duplicado contaría como abierto y taparía todos los siguientes.
    $dq = & $gql 'query($t:ID,$p:String){ issues(filter:{team:{id:{eq:$t}}, title:{startsWith:$p}, state:{type:{in:["triage","backlog","unstarted","started"]}}}, first:1){ nodes{ identifier url } } }' @{ t = $teamId; p = $prefix }
    $open = $dq.data.issues.nodes[0]
    if ($open) { "Ya hay un [Alert] abierto del sync ($($open.identifier)) — no duplico. $($open.url)"; return }
  } catch { }  # si la query de dedup falla, caemos a crear igual (mejor ruido que silencio)
  $labelId = $null; $stateId = $null; $assigneeId = $null
  try { $labelId = (& $gql 'query($t:ID){ issueLabels(filter:{name:{eq:"agent-report"}, team:{id:{eq:$t}}}, first:1){ nodes{ id } } }' @{ t = $teamId }).data.issueLabels.nodes[0].id } catch {}
  try { $stateId = (& $gql 'query($t:ID){ workflowStates(filter:{name:{eq:"Backlog"}, team:{id:{eq:$t}}}, first:1){ nodes{ id } } }' @{ t = $teamId }).data.workflowStates.nodes[0].id } catch {}
  try { $assigneeId = (& $gql 'query{ viewer{ id } }' @{}).data.viewer.id } catch {}
  $title = "$prefix — la copia viva no se actualiza ($(Get-Date -Format 'yyyy-MM-dd HH:mm'))"
  $backupNote = ''
  if ($Backup) {
    $backupNote = "`n`nEl sync YA descartó de la copia viva los archivos que chocaban y respaldó su última versión en: $Backup (relativo a la raíz del repo). Si necesitas recuperar lo que escribió un agente, está ahí — no lo busques en el working tree."
  }
  $desc = @"
## Qué pasó
$Reason

La copia viva del repo de agentes no pudo hacer fast-forward a origin/${main}: está quedando atrás y los crons de esta PC corren código viejo.

## Detalle de git

$Detail

## Qué hacer
En la copia viva, haz commit de los archivos que chocan o descártalos, y corre scripts\sync-agents-repo.ps1 de nuevo. Los archivos que un agente reescribe en cada corrida se resuelven solos (el sync los descarta con backup y reintenta); este aviso queda para los que git no pudo hacer fast-forward igual.$backupNote

---
Generado por scripts/sync-agents-repo.ps1. Un solo aviso mientras siga abierto.
"@
  $issueInput = @{ teamId = $teamId; title = $title; description = $desc }
  if ($labelId) { $issueInput.labelIds = @($labelId) }
  if ($stateId) { $issueInput.stateId = $stateId }
  if ($assigneeId) { $issueInput.assigneeId = $assigneeId }
  try {
    $r = & $gql 'mutation($input: IssueCreateInput!){ issueCreate(input:$input){ success issue{ identifier url } } }' @{ input = $issueInput }
    if ($r.data.issueCreate.success) { "Aviso del sync creado en Linear: $($r.data.issueCreate.issue.identifier) — $($r.data.issueCreate.issue.url)" }
    else { Write-Warning "issueCreate devolvió success=false para el aviso del sync." }
  } catch { Write-Warning "No pude crear el aviso del sync en Linear: $($_.Exception.Message)" }
}

# 2) Fast-forward de main. Con WIP sin commitear está bien: si un archivo con cambios locales también
#    cambió en origin, git aborta sin tocar nada. En ese caso descartamos SOLO esos (a favor de
#    origin/main, con backup) y reintentamos; si aún así no entra, no forzamos y avisamos en Linear.
# Capturamos stderr a archivo (no 2>&1): bajo PS 5.1 el 2>&1 envuelve cada línea de git en un
# ErrorRecord y el texto queda inservible. Con redirección a archivo $out queda texto plano.
function Invoke-FfMerge {
  $errFile = [System.IO.Path]::GetTempFileName()
  $txt = ((git merge --ff-only "origin/$main" 2>$errFile | Out-String) + (Get-Content $errFile -Raw 2>$null)).Trim()
  Remove-Item $errFile -ErrorAction SilentlyContinue
  return $txt
}
$before = (git rev-parse HEAD 2>$null).Trim()
$out = Invoke-FfMerge
$ok = ($LASTEXITCODE -eq 0)

# Auto-resolución del caso "would be overwritten". Los archivos que bloquean el ff son los que
# tienen cambios locales Y además cambiaron río arriba: los calculamos con git plumbing (la
# intersección), no parseando el texto del error. Descartamos SOLO esos (vuelven a origin/$main),
# tras backup con fecha, y reintentamos. Los WIP que NO chocan no se tocan.
$collide = @()
if (-not $ok) {
  # Solo entramos a la recuperación destructiva si el ff ERA posible y lo único que lo bloquea es WIP
  # local (HEAD es ancestro de origin/$main → la falla es un "would be overwritten"). Si HEAD NO es
  # ancestro, la copia viva divergió (tiene commits propios sin pushear): ahí --ff-only aborta por la
  # divergencia, NO por el working tree, y ningún descarte de WIP haría entrar el ff. En ese caso no
  # tocamos nada y dejamos que caiga al aviso.
  git merge-base --is-ancestor HEAD "origin/$main" 2>$null
  $ffPossible = ($LASTEXITCODE -eq 0)
  if ($ffPossible) {
    $upstreamChanged = @(git diff --name-only HEAD "origin/$main" 2>$null | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $untracked = @{}
    $localModified = @(git status --porcelain --untracked-files=all 2>$null | ForEach-Object {
      $code = $_.Substring(0, 2)
      $p = $_.Substring(3).Trim()
      if ($p -match ' -> ') { $p = ($p -split ' -> ')[-1].Trim() }  # rename: la ruta nueva
      $p = $p.Trim('"')
      if ($code -eq '??') { $untracked[$p] = $true }  # untracked: origin lo AGREGA, no está en HEAD
      $p
    } | Where-Object { $_ })
    $collide = @($localModified | Where-Object { $upstreamChanged -contains $_ } | Select-Object -Unique)
    if ($collide.Count -gt 0) {
      # Backup con fecha (gitignored): lo que se pisa es la última versión que escribió un agente.
      $ts = Get-Date -Format 'yyyy-MM-dd-HHmmss'
      $backupRel = "queue/sync-backups/$ts"
      $backupDir = Join-Path $root $backupRel
      # Respaldamos y SOLO descartamos un archivo si su copia quedó bien (existe y pesa lo mismo). Aquí
      # $ErrorActionPreference es 'Continue', así que un Copy-Item que falle (ruta larga, permisos,
      # disco) no corta el script: sin verificar descartaríamos igual y perderíamos justo lo que el
      # backup tenía que cuidar. El que no se pudo respaldar NO se toca → el ff vuelve a abortar por él
      # y caemos al aviso con ese motivo.
      $discarded = @()
      $backupFailed = @()
      foreach ($f in $collide) {
        $src = Join-Path $root $f
        if (-not (Test-Path -LiteralPath $src -PathType Leaf)) {
          # No hay archivo que respaldar (lo borró el WIP local): no hay versión del agente que perder;
          # el checkout/remove de abajo lo resuelve.
          $discarded += $f
          continue
        }
        $dst = Join-Path $backupDir $f
        New-Item -ItemType Directory -Force -Path (Split-Path $dst -Parent) | Out-Null
        Copy-Item -LiteralPath $src -Destination $dst -Force -ErrorAction SilentlyContinue
        if ((Test-Path -LiteralPath $dst -PathType Leaf) -and
            ((Get-Item -LiteralPath $dst).Length -eq (Get-Item -LiteralPath $src).Length)) {
          $discarded += $f
        } else {
          $backupFailed += $f
        }
      }
      # Liberar SOLO los que se respaldaron OK para que el ff traiga la versión de origin:
      #  - trackeado (existe en HEAD): `git checkout HEAD -- $f` lo vuelve a HEAD.
      #  - untracked (lo agrega origin, NO está en HEAD): checkout no lo borra (overlay mode) → lo
      #    removemos a mano, si no el ff vuelve a abortar por el mismo archivo. Ya quedó backupeado.
      foreach ($f in $discarded) {
        if ($untracked[$f]) {
          $p = Join-Path $root $f
          if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue }
        } else {
          git checkout HEAD -- $f 2>$null | Out-Null
        }
      }
      if ($discarded.Count -gt 0) {
        $out = Invoke-FfMerge
        $ok = ($LASTEXITCODE -eq 0)
      }
      if ($ok) {
        "Sync: $($discarded.Count) archivo(s) chocaban con un commit entrante y los tomé de origin/${main} (backup en ${backupRel}): $($discarded -join ', ')."
      }
    }
  }
}

$after = (git rev-parse HEAD 2>$null).Trim()

if (-not $ok) {
  $backupForAlert = $null
  if ($collide.Count -gt 0) {
    # Ya tocamos la copia viva: descartamos (con backup) los que chocaban y se respaldaron OK, pero el
    # ff no entró igual — típicamente porque algún archivo NO se pudo respaldar y lo dejamos intacto, y
    # sigue bloqueando. NO decimos "git no tocó nada": sí tocó (descartó los respaldados).
    $parts = @()
    if ($discarded.Count -gt 0) {
      $parts += "Descarté de la copia viva (tomándolos de origin/$main) y respaldé en ${backupRel}: $($discarded -join ', ')."
      $backupForAlert = $backupRel
    }
    if ($backupFailed.Count -gt 0) {
      $parts += "NO pude respaldar y por eso dejé intactos (siguen bloqueando el ff): $($backupFailed -join ', ')."
    }
    $reason = (($parts -join ' ') + " El fast-forward no entró igual.").Trim()
  } elseif ($out -match 'would be overwritten') {
    $reason = "Archivos con cambios locales sin commitear que TAMBIÉN cambiaron en origin/$main (git no tocó nada)."
  } else {
    $reason = "git merge --ff-only falló en $main (¿commits locales sin pushear? no es fast-forward)."
  }
  Write-Warning "No actualicé ${main}: $reason`n$out"
  Send-SyncBlockedAlert -Reason $reason -Detail $out -Backup $backupForAlert
  exit 1
}
if ($before -ne $after) {
  "Repo de agentes actualizado ($main): $($before.Substring(0,7)) -> $($after.Substring(0,7)). El runtime de esta PC ya toma los cambios mergeados."
} elseif (-not $Quiet) {
  "Repo de agentes ya estaba al día ($main, $($after.Substring(0,7)))."
}
