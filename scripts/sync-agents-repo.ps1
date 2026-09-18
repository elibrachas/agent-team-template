# Actualiza la copia VIVA del repo de agentes (ESTA PC — la que corre los crons/listener) con lo
# que se haya mergeado en la rama de trabajo (típicamente un PR de Alfred ya aprobado). Así el
# runtime en esta máquina toma las mejoras de Alfred sin que las tengas que traer a mano.
#
#   uso:  powershell -ExecutionPolicy Bypass -NoProfile -File scripts\sync-agents-repo.ps1
#         ... -Quiet   (sin ruido si ya estaba al día — para llamarlo desde otro script)
#
# SEGURO POR DISEÑO: fast-forward ONLY, y SOLO si el working tree está limpio. Si tienes cambios
# sin commitear (WIP tuyo), NO hace nada — nunca pisa tu trabajo. Si la rama divergió (no es FF),
# tampoco fuerza nada: te avisa para que lo resuelvas a mano.
param([switch]$Quiet)
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

$branch = (git rev-parse --abbrev-ref HEAD 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or -not $branch) { Write-Warning "No pude leer la rama actual — ¿es un repo git?"; exit 1 }

# Solo miramos cambios TRACKED (--untracked-files=no): archivos sin trackear (ej. scratch en
# queue/ o scripts/) NO bloquean un fast-forward — git no los pisa (si hubiera colisión de
# nombre, el propio pull --ff-only aborta sin tocar nada). Lo que protegemos es tu WIP trackeado.
$dirty = (git status --porcelain --untracked-files=no 2>$null) -join ''
if (-not [string]::IsNullOrWhiteSpace($dirty)) {
  if (-not $Quiet) { Write-Warning "Cambios trackeados sin commitear en '$branch' — NO hago pull (para no pisar tu WIP). Haz commit o stash y vuelve a correr." }
  exit 0
}

# git fetch/pull escriben a stderr; bajo $ErrorActionPreference='Stop' eso sería error
# terminante. Bajamos a 'Continue' (gateamos por $LASTEXITCODE).
$eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
git fetch origin 2>$null | Out-Null
$before = (git rev-parse HEAD 2>$null).Trim()
git pull --ff-only origin $branch 2>$null | Out-Null
$ok = ($LASTEXITCODE -eq 0)
$after = (git rev-parse HEAD 2>$null).Trim()
$ErrorActionPreference = $eap

if (-not $ok) {
  Write-Warning "git pull --ff-only falló en '$branch' (¿la rama divergió y no es fast-forward?). Resuelve a mano."
  exit 1
}
if ($before -ne $after) {
  "Repo de agentes actualizado ($branch): $($before.Substring(0,7)) -> $($after.Substring(0,7)). El runtime de esta PC ya toma los cambios mergeados."
} elseif (-not $Quiet) {
  "Repo de agentes ya estaba al día ($branch, $($after.Substring(0,7)))."
}
