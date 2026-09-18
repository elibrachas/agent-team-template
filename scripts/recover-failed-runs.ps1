# Recupera corridas de agentes que fallaron (is_error=true en el audit) — típicamente tras
# un apagón de OAuth (Claude deslogueado) que tira TODO el roster headless a la vez.
#   uso:  powershell -ExecutionPolicy Bypass -NoProfile -File scripts\recover-failed-runs.ps1
#         ... -Since 2026-01-15        (escanea desde esa fecha hasta hoy; default: solo hoy)
#         ... -Execute                 (RE-CORRE los fallos; sin esto solo LISTA, read-only)
#         ... -IncludeTimeouts         (incluye los timed_out=true; por default se omiten —
#                                       un timeout no es un apagón, re-correrlo puede colgar igual)
#
# Por qué existe: el listener (respond-linear) lo dispara un webhook de Linear que YA se
# consumió — un fallo ahí NO se reintenta solo. Los crons podrían esperar a su próxima corrida,
# pero esto te deja recuperarlos ya. La fuente de verdad es audit\YYYY-MM-DD.jsonl (una línea por
# corrida, con wrapper/project/name/is_error/timed_out) que escriben todos los wrappers vía
# Write-AgentAudit (scripts\project.ps1). Mismo runtime/billing que los wrappers (suscripción OAuth).
param(
  [string]$Since = (Get-Date -Format 'yyyy-MM-dd'),
  [ValidateSet('all', 'listener', 'cron')][string]$Class = 'all',
  [switch]$Execute,
  [switch]$IncludeTimeouts
)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

# --- Rango de fechas [Since .. hoy] ---
try { $sinceDate = [datetime]::ParseExact($Since, 'yyyy-MM-dd', $null) }
catch { Write-Error "-Since inválido: '$Since'. Formato esperado yyyy-MM-dd."; exit 1 }
$today = (Get-Date).Date
if ($sinceDate -gt $today) { Write-Error "-Since '$Since' es futuro."; exit 1 }

# --- Juntar las líneas de audit del rango ---
$lines = @()
for ($d = $sinceDate; $d -le $today; $d = $d.AddDays(1)) {
  $af = "audit\$($d.ToString('yyyy-MM-dd')).jsonl"
  if (Test-Path $af) { $lines += Get-Content $af }
}
$rangeLabel = "$Since..$($today.ToString('yyyy-MM-dd'))"
if ($lines.Count -eq 0) { "No hay audit en el rango $rangeLabel. Nada que recuperar."; exit 0 }

# --- Parsear y filtrar los fallos ---
# Parsear TODAS las entradas del rango (no solo las fallidas): para cada (wrapper+project+name)
# necesito ver cuál fue su corrida MÁS RECIENTE, no solo si alguna vez falló.
$all = @()
foreach ($ln in $lines) {
  if ([string]::IsNullOrWhiteSpace($ln)) { continue }
  $e = $null; try { $e = $ln | ConvertFrom-Json } catch { continue }
  if ($e.ts) { $all += $e }
}
$toNote = if (-not $IncludeTimeouts) { ' [timeouts omitidos — usa -IncludeTimeouts]' } else { '' }

# Corridas fallidas brutas (para el note), excluyendo timeouts salvo -IncludeTimeouts.
$rawErr = @($all | Where-Object { $_.is_error -and ($IncludeTimeouts -or -not $_.timed_out) }).Count

# Una clave (wrapper+project+name) "necesita recuperación" SOLO si su ÚLTIMA corrida falló. Si una
# corrida POSTERIOR tuvo éxito (ya la recuperaste, o el cron volvió a correr y anduvo), se excluye
# → la recuperación es RESUMIBLE/idempotente: re-correr no re-hace lo ya recuperado. (Esto también
# colapsa duplicados del mismo día, ej. pm-weekly-digest disparado 2x.) ts en formato sortable.
$failed = @($all |
  Group-Object { "$($_.wrapper)|$($_.project)|$($_.name)" } |
  ForEach-Object { $_.Group | Sort-Object { $_.ts } | Select-Object -Last 1 } |
  Where-Object { $_.is_error -and ($IncludeTimeouts -or -not $_.timed_out) } |
  Sort-Object { $_.ts })

if ($failed.Count -eq 0) { "Sin corridas pendientes en $rangeLabel$toNote — lo que falló ya se recuperó o volvió a correr OK. Nada que hacer."; exit 0 }
$dupNote = if ($rawErr -gt $failed.Count) { " ($($rawErr - $failed.Count) ya recuperada(s)/dup)" } else { '' }

# --- Mapear cada fallo a su comando de re-corrida (por wrapper) ---
function Resolve-Rerun {
  param($Entry)
  $w = [string]$Entry.wrapper; $proj = [string]$Entry.project; $nm = [string]$Entry.name
  switch ($w) {
    'respond-linear' {
      # name = "<agente>/<IssueId>"; el team se deriva del prefijo del IssueId dentro del wrapper.
      $parts = $nm -split '/', 2
      if ($parts.Count -eq 2 -and $parts[1]) {
        return [pscustomobject]@{ Class = 'listener'; Exe = 'scripts\respond-linear.ps1'; Args = @('-IssueId', $parts[1], '-AgentName', $parts[0]); Note = '' }
      }
      return [pscustomobject]@{ Class = 'listener'; Exe = $null; Args = @(); Note = "name inesperado '$nm' (se esperaba agente/IssueId)" }
    }
    'run-skill'        { return [pscustomobject]@{ Class = 'cron'; Exe = 'scripts\run-skill.ps1';        Args = @('-Skill', $nm, '-Project', $proj); Note = '' } }
    'run-capi-roadmap' { return [pscustomobject]@{ Class = 'cron'; Exe = 'scripts\run-capi-roadmap.ps1'; Args = @('-Project', $proj); Note = '' } }
    'run-greta-seo'    { return [pscustomobject]@{ Class = 'cron'; Exe = 'scripts\run-greta-seo.ps1';    Args = @('-Project', $proj); Note = '' } }
    'run-cody-scan'    { return [pscustomobject]@{ Class = 'cron'; Exe = 'scripts\run-cody-scan.ps1';    Args = @('-Project', $proj); Note = '' } }
    'run-pico-shipped' { return [pscustomobject]@{ Class = 'cron'; Exe = 'scripts\run-pico-shipped.ps1'; Args = @('-Project', $proj); Note = '' } }
    'run-qualy'        { return [pscustomobject]@{ Class = 'cron'; Exe = 'scripts\run-qualy.ps1';        Args = @('-Job', ($nm -replace '^qualy-', ''), '-Project', $proj); Note = '' } }
    default            { return [pscustomobject]@{ Class = 'unknown'; Exe = $null; Args = @(); Note = "wrapper '$w' no mapeado — re-correr a mano" } }
  }
}

# Construir el plan (sin imprimir todavía) y aplicar el filtro -Class.
$plan = @()
foreach ($e in $failed) { $plan += [pscustomobject]@{ Entry = $e; Rerun = (Resolve-Rerun -Entry $e) } }
$view = if ($Class -eq 'all') { $plan } else { @($plan | Where-Object { $_.Rerun.Class -eq $Class }) }
$classNote = if ($Class -eq 'all') { '' } else { " [filtrado a class=$Class]" }

"=== Corridas fallidas en ${rangeLabel}: $($view.Count) de $($failed.Count)$toNote$dupNote$classNote ==="
foreach ($p in $view) {
  $e = $p.Entry; $r = $p.Rerun
  $cmd = if ($r.Exe) { "powershell -ExecutionPolicy Bypass -NoProfile -File $($r.Exe) $($r.Args -join ' ')" } else { "(sin comando — $($r.Note))" }
  $tag = switch ($r.Class) { 'listener' { '[listener · re-correr SÍ o SÍ]' } 'cron' { '[cron · opcional]' } default { '[?]' } }
  "{0}  {1}  {2}/{3}" -f $e.ts, $tag, $e.project, $e.name
  "      -> $cmd" + $(if ($r.Note -and $r.Exe) { "   ($($r.Note))" } else { '' })
}

if (-not $Execute) {
  ""
  "Read-only (lista). Para re-correr: agrega -Execute."
  "  · lo crítico son los listeners — recupéralos solos con:  -Class listener -Execute"
  "  · listener (respond-linear): el webhook ya se consumió — re-correr es la única forma"
  "    (alternativa sin script: re-comentar '<Agente>: dale' en el issue para re-disparar el webhook)."
  "  · cron: también puedes esperar la próxima corrida programada, o re-correr el workflow desde n8n."
  "    (re-correr crons puede duplicar el issue del día y re-disparar agentes caros como Cody/Qualy)."
  exit 0
}

# --- -Execute: re-correr cada fallo con comando mapeado, en proceso hijo aislado ---
# Proceso hijo (powershell -File) para no contaminar cwd/env de este script — igual que n8n.
# IMPORTANTE: un fallo de un hijo NO debe abortar el batch. En PS 5.1, `& powershell ... 2>&1`
# envuelve el stderr nativo en NativeCommandError; con ErrorActionPreference=Stop (seteado arriba)
# eso TERMINA el script al primer hijo que escribe a stderr (un Write-Error de run-skill, etc.).
# Bajamos a Continue para el loop Y envolvemos cada corrida en try/catch: un FALLO se cuenta y se
# sigue con el resto. (El setup de arriba sí usa Stop, a propósito.)
$ErrorActionPreference = 'Continue'
""
$runnable = @($view | Where-Object { $_.Rerun.Exe }).Count
"=== Re-corriendo $runnable corrida(s) (-Execute$classNote) ==="
$ok = 0; $bad = 0; $skip = 0
foreach ($p in $view) {
  $r = $p.Rerun; $e = $p.Entry
  if (-not $r.Exe) { "SKIP  $($e.project)/$($e.name) — $($r.Note)"; $skip++; continue }
  "RUN   $($e.project)/$($e.name)  ($($r.Exe) $($r.Args -join ' '))"
  $rargs = @($r.Args)
  $code = 0; $o = $null
  try {
    $o = & powershell -ExecutionPolicy Bypass -NoProfile -File $r.Exe @rargs 2>&1
    $code = $LASTEXITCODE
  } catch {
    $o = $_.Exception.Message; $code = 1
  }
  if ($code -eq 0) { "  OK"; $ok++ }
  else {
    "  FALLO (exit $code):"
    @($o | Select-Object -Last 4) | ForEach-Object { "      $_" }
    $bad++
  }
}
""
"Resumen: OK=$ok  FALLO=$bad  SKIP=$skip"
if ($bad -gt 0) { exit 1 }
exit 0
