# Pone al día las copias locales de los REPOS DEL PRODUCTO de un proyecto (los que leen los
# agentes de análisis: Numa, Greta, Pico). Hermano de sync-agents-repo.ps1.
#
#   uso:  powershell -ExecutionPolicy Bypass -NoProfile -File scripts\sync-product-repos.ps1 -Project acme
#         ... -Quiet   (sin ruido si ya estaba al día)
#
# POR QUÉ: los agentes leen el código para entender cómo se genera un dato y para auditar el
# frontend. Si el producto vive en varios repos y nadie actualiza las copias locales, pueden
# quedar semanas atrás del main remoto → análisis sobre código que ya no existe.
#
# SEGURO POR DISEÑO, por repo (y SIEMPRE en la rama default, ver abajo):
#   - SIEMPRE `git fetch origin` (solo actualiza refs remotas — no toca el working tree).
#   - Si está en otra rama (ej. la cody/* de un PR ya abierto) VUELVE a main, solo si la rama
#     está limpia, pusheada completa y su último commit tiene >1 h. Si no → solo fetch, y avisa.
#   - Fast-forward del working tree SOLO en la rama default y SIN cambios trackeados.
#   - Nunca fuerza nada: si no es fast-forward, avisa y sigue con el próximo repo.
#
# -NoSwitch: NUNCA cambia de rama, ni siquiera cuando sería seguro. Lo usa el listener
# (respond-linear.ps1), que dispara con CADA comentario a cualquier agente: podría caer sobre una
# rama recién creada por Cody desde main (limpia, sin commits locales, <1 h) y devolverla a main le
# cortaría el checkout. En ese modo: solo fetch, y fast-forward si YA está en la rama default. Los
# crons siguen SIN -NoSwitch (vuelven a main).
param(
  [Parameter(Mandatory = $true)][string]$Project,
  [switch]$Quiet,
  [switch]$NoSwitch
)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

# .env.server para GH_TOKEN (repos privados → el fetch necesita auth). Mismo loader que el resto.
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
if ($env:GH_TOKEN) {
  $ghBasic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("x-access-token:$($env:GH_TOKEN)"))
  $env:GIT_CONFIG_COUNT = "1"
  $env:GIT_CONFIG_KEY_0 = "http.https://github.com/.extraheader"
  $env:GIT_CONFIG_VALUE_0 = "Authorization: Basic $ghBasic"
}

. "$PSScriptRoot\project.ps1"
$projectObj = Get-Project -Slug $Project

$failed = 0
foreach ($r in (Get-ProjectRepos -Project $projectObj)) {
  $resolved = Resolve-Path -Path $r.path -ErrorAction SilentlyContinue
  if (-not $resolved) { Write-Warning "[$($r.key)] $($r.path) no existe en disco — clónalo (ver docs/add-a-new-project.md)."; $failed++; continue }
  $dir = $resolved.Path

  # git escribe a stderr en operaciones normales; gateamos por $LASTEXITCODE.
  $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  git -C $dir fetch origin --prune 2>$null | Out-Null
  $fetchOk = ($LASTEXITCODE -eq 0)
  $branch = (git -C $dir rev-parse --abbrev-ref HEAD 2>$null | Out-String).Trim()
  $default = (git -C $dir symbolic-ref --short refs/remotes/origin/HEAD 2>$null | Out-String).Trim() -replace '^origin/', ''
  if (-not $default) { $default = 'main' }
  $dirty = (git -C $dir status --porcelain --untracked-files=no 2>$null) -join ''
  $behind = (git -C $dir rev-list --count "HEAD..origin/$default" 2>$null | Out-String).Trim()
  $ErrorActionPreference = $eap

  if (-not $fetchOk) { Write-Warning "[$($r.key)] git fetch falló (¿GH_TOKEN sin acceso a este repo?)."; $failed++; continue }
  if ($branch -ne $default) {
    if ($NoSwitch) {
      # Listener: no cambiamos de rama ni aunque fuera seguro — podría ser una rama recién
      # creada por Cody desde main, antes de su primer cambio. Solo fetch (ya hecho) + aviso.
      Write-Warning "[$($r.key)] está en '$branch' (no en '$default') — modo -NoSwitch: solo fetch, no cambio de rama. El agente lee esa rama."
      continue
    }
    # SIEMPRE MAIN: las copias que leen los agentes viven en la rama default.
    # Típico: Cody abrió un PR y dejó el checkout en su rama cody/* → los agentes leían código viejo.
    # Volvemos SOLO si es seguro: (a) sin cambios trackeados (puede ser Cody trabajando), (b) sin
    # commits que existan solo en esta copia (todo está en algún ref remoto → nada se pierde) y
    # (c) el último commit de la rama tiene más de 1 h (no cortarle a Cody el push → PR).
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $localOnly = (git -C $dir rev-list --count HEAD --not --remotes 2>$null | Out-String).Trim()
    $lastCommit = [int64]((git -C $dir log -1 --format=%ct 2>$null | Out-String).Trim())
    $ErrorActionPreference = $eap
    $ageMin = ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - $lastCommit) / 60
    $why = if (-not [string]::IsNullOrWhiteSpace($dirty)) { 'tiene cambios trackeados sin commitear' }
           elseif ($localOnly -ne '0') { "tiene $localOnly commit(s) que solo existen en esta copia" }
           elseif ($ageMin -lt 60) { 'su último commit tiene menos de 1 h (¿Cody abriendo el PR?)' }
           else { $null }
    if ($why) {
      Write-Warning "[$($r.key)] está en '$branch' (no en '$default') y $why — solo fetch, no cambio de rama. Los agentes leen esa rama."
      continue
    }
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $out = (git -C $dir switch $default 2>&1 | Out-String).Trim()
    $switchOk = ($LASTEXITCODE -eq 0)
    $behind = (git -C $dir rev-list --count "HEAD..origin/$default" 2>$null | Out-String).Trim()
    $ErrorActionPreference = $eap
    if (-not $switchOk) { Write-Warning "[$($r.key)] no pude volver de '$branch' a $default (git no tocó nada):`n$out"; $failed++; continue }
    "[$($r.key)] volví de '$branch' (ya pusheada) a $default."
    $branch = $default
  }
  if (-not [string]::IsNullOrWhiteSpace($dirty)) {
    Write-Warning "[$($r.key)] tiene cambios trackeados sin commitear — solo fetch ($behind commits atrás de origin/$default)."
    continue
  }
  if ($behind -eq '0') { if (-not $Quiet) { "[$($r.key)] al día ($default)." }; continue }

  $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  git -C $dir merge --ff-only "origin/$default" 2>$null | Out-Null
  $ok = ($LASTEXITCODE -eq 0)
  $ErrorActionPreference = $eap
  if ($ok) { "[$($r.key)] actualizado: +$behind commits ($default)." }
  else { Write-Warning "[$($r.key)] no es fast-forward (¿commits locales sin pushear?) — no fuerzo nada, resuélvelo a mano."; $failed++ }
}
if ($failed) { exit 1 }
