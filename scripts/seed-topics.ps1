# Carga un banco de ideas (topics) en el Payload de un proyecto vía leda-helpers.ps1.
#   powershell -ExecutionPolicy Bypass -NoProfile -File scripts\seed-topics.ps1 -Project acme [-SeedFile <path>] [-DryRun]
#
# - Lee el JSON de seed ({ "topics": [ {...}, ... ] } o un array pelado [ {...}, ... ]) como UTF-8.
#   Default: projects\<slug>\content-topics-seed.json.
# - Por cada topic escribe un archivo temporal UTF-8 (sin BOM) y llama
#   leda-helpers.ps1 -Action create-topic -Project <slug> -BodyJsonFile <tmp>.
# - Dedup: antes de crear, lista los topics existentes (cualquier status) y salta
#   los que ya tienen el mismo keyword (case-insensitive). Volver a correrlo es seguro.
# - Requiere que el Payload del proyecto tenga la collection `topics`
#   (project.json -> payload.topics distinto de false); si no, el helper falla claro y este
#   script se detiene en el primer item.
# - -DryRun: muestra qué se crearía sin llamar al Payload.

param(
  [Parameter(Mandatory=$true)]
  [string]$Project,
  [string]$SeedFile,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [System.Text.Encoding]::UTF8
} catch { }

if (-not $SeedFile) { $SeedFile = ".\projects\$Project\content-topics-seed.json" }
if (-not (Test-Path $SeedFile)) { Write-Error "No existe el seed: $SeedFile"; exit 1 }

$seed = Get-Content $SeedFile -Raw -Encoding UTF8 | ConvertFrom-Json
$topics = if ($seed.PSObject.Properties['topics']) { @($seed.topics) } else { @($seed) }
if ($topics.Count -eq 0) { Write-Error "El seed no tiene topics"; exit 1 }

$helper = ".\scripts\leda-helpers.ps1"

# Keywords ya cargados en CUALQUIER status (idea / assigned / drafted / published) para no
# duplicar al volver a correrlo ni recargar una idea que Leda ya escribió. Si el listado falla,
# no seguimos: cargar a ciegas es justo lo que duplica.
$existing = @{}
if (-not $DryRun) {
  # EAP Continue alrededor de la llamada: en PS 5.1, con 'Stop', el stderr redirigido de un
  # proceso hijo se vuelve un error terminante y perderíamos el mensaje del helper.
  $ErrorActionPreference = 'Continue'
  $raw = & powershell -ExecutionPolicy Bypass -NoProfile -File $helper -Action list-topics -Project $Project -Status all -Limit 1000 2>&1
  $listExit = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($listExit -ne 0) { Write-Error "list-topics falló, no cargo nada para no duplicar: $raw"; exit 1 }
  $raw = @($raw | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] })
  try {
    $parsed = ($raw -join "`n") | ConvertFrom-Json
  } catch { Write-Error "list-topics no devolvió JSON, no cargo nada: $raw"; exit 1 }
  foreach ($t in @($parsed)) { if ($t.keyword) { $existing[$t.keyword.ToLower()] = $true } }
}

$created = 0; $skipped = 0; $failed = 0
foreach ($t in $topics) {
  $kw = [string]$t.keyword
  if (-not $kw) { $skipped++; continue }
  if ($existing.ContainsKey($kw.ToLower())) {
    Write-Host "skip (ya existe): $kw"
    $skipped++
    continue
  }
  # Solo los campos de la collection (el seed puede traer extras de documentación).
  $body = [ordered]@{}
  foreach ($k in 'keyword','audience','cluster','intent','priority','brief','internalLinks','ctaTarget','status','notes') {
    if ($t.PSObject.Properties[$k] -and $null -ne $t.$k) { $body[$k] = $t.$k }
  }
  if (-not $body.Contains('status')) { $body['status'] = 'idea' }
  $json = $body | ConvertTo-Json -Depth 5 -Compress
  if ($DryRun) {
    Write-Host "would create: $kw  [$($body.cluster) / p$($body.priority) / $($body.audience)]"
    $existing[$kw.ToLower()] = $true
    $created++
    continue
  }
  $tmp = [System.IO.Path]::GetTempFileName()
  [System.IO.File]::WriteAllText($tmp, $json, (New-Object System.Text.UTF8Encoding($false)))
  try {
    $ErrorActionPreference = 'Continue'
    $out = & powershell -ExecutionPolicy Bypass -NoProfile -File $helper -Action create-topic -Project $Project -BodyJsonFile $tmp 2>&1
    $createExit = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($createExit -ne 0) {
      Write-Host "FAIL: $kw -> $out"
      $failed++
      if ($out -match "NO tiene la collection") { Write-Error "El Payload de $Project no tiene la collection topics. Créala en el producto primero."; exit 1 }
    } else {
      Write-Host "created: $kw"
      # El mismo keyword puede venir repetido en el seed (o con otra capitalización).
      $existing[$kw.ToLower()] = $true
      $created++
    }
  } finally {
    Remove-Item $tmp -ErrorAction SilentlyContinue
  }
}

Write-Host ""
Write-Host "Seed $Project -> creados: $created, saltados: $skipped, fallidos: $failed$(if ($DryRun) { ' (DryRun)' })"
if ($failed -gt 0) { exit 1 }
