# Túnel SSH del server de agentes a la base MySQL de un producto (la que lee el MCP mysql).
#
# Del lado de la VM lo arma quien la administra (ver docs/mysql-readonly-source.md): un usuario
# MySQL de solo lectura con GRANT por columna, la base publicada SOLO en 127.0.0.1:<puerto> de la
# VM, y un usuario SSH sin shell que solo puede abrir un túnel a ese puerto. Este script es el
# lado del SERVER de agentes.
#
#   uso (PowerShell en el server de agentes, desde la raíz del repo):
#     powershell -ExecutionPolicy Bypass -File scripts\db-tunnel.ps1 -Project acme -Action keygen
#       → crea la key dedicada y muestra la parte PÚBLICA (esa, y solo esa, va a quien administra la VM)
#     ... -Action trust       → 1ª conexión: verificas la huella del host y la aceptas (una vez)
#     ... -Action test        → abre el túnel unos segundos y prueba el puerto local
#     ... -Action install     → tarea programada al iniciar Windows (consola COMO ADMINISTRADOR)
#     ... -Action status      → estado de la tarea + puerto + últimas líneas del log
#     ... -Action uninstall   → borra la tarea
#   (-Action run es el loop que ejecuta la tarea; no hace falta correrlo a mano.)
#
# De dónde salen host/usuario/puertos (gana el primero que tenga valor):
#   1. los parámetros (-RemoteHost, -RemoteUser, -LocalPort, -RemotePort);
#   2. env vars DB_TUNNEL_HOST / DB_TUNNEL_USER / DB_TUNNEL_LOCAL_PORT / DB_TUNNEL_REMOTE_PORT
#      (de .env.server o .env.<slug>);
#   3. projects\<slug>\project.json → bloque opcional
#        "dbTunnel": { "host": "...", "user": "agents-tunnel", "localPort": 13306, "remotePort": 3306 }
#   4. defaults: user agents-tunnel, localPort 13306, remotePort 3306 (el host no tiene default).
# Ningún dato de infraestructura real vive en este archivo.
#
# El MCP (scripts/mcp-mysql) se conecta a 127.0.0.1:<LocalPort> con las MYSQL_* de .env.<slug>
# (MYSQL_HOST=127.0.0.1, MYSQL_PORT=<LocalPort>).
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('keygen', 'trust', 'test', 'install', 'status', 'uninstall', 'run')]
  [string]$Action,
  [string]$Project    = 'acme',
  [string]$KeyPath    = '',
  [string]$KnownHosts = (Join-Path $env:USERPROFILE '.ssh\known_hosts'),
  [string]$RemoteHost = '',
  [string]$RemoteUser = '',
  [int]$LocalPort     = 0,
  [int]$RemotePort    = 0,
  [string]$TaskName   = ''
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

# Config: env vars (.env.server + .env.<slug>) y el bloque dbTunnel de project.json. Solo se leen
# las DB_TUNNEL_*; este script no necesita ningún secreto (la key vive en ~\.ssh).
. "$PSScriptRoot\project.ps1"
if (Test-Path ".\.env.server") { Import-EnvFile ".\.env.server" }
$projectObj = Get-Project -Slug $Project
if ($projectObj.envFile -and (Test-Path ".\$($projectObj.envFile)")) { Import-EnvFile ".\$($projectObj.envFile)" }
$cfg = if ($projectObj.PSObject.Properties['dbTunnel'] -and $projectObj.dbTunnel) { $projectObj.dbTunnel } else { $null }
function Get-CfgValue([string]$Prop) {
  if ($cfg -and $cfg.PSObject.Properties[$Prop] -and $cfg.$Prop) { return $cfg.$Prop }
  return $null
}
if (-not $RemoteHost) { $RemoteHost = if ($env:DB_TUNNEL_HOST) { $env:DB_TUNNEL_HOST } else { [string](Get-CfgValue 'host') } }
if (-not $RemoteUser) { $RemoteUser = if ($env:DB_TUNNEL_USER) { $env:DB_TUNNEL_USER } elseif (Get-CfgValue 'user') { [string](Get-CfgValue 'user') } else { 'agents-tunnel' } }
if (-not $LocalPort)  { $LocalPort  = if ($env:DB_TUNNEL_LOCAL_PORT) { [int]$env:DB_TUNNEL_LOCAL_PORT } elseif (Get-CfgValue 'localPort') { [int](Get-CfgValue 'localPort') } else { 13306 } }
if (-not $RemotePort) { $RemotePort = if ($env:DB_TUNNEL_REMOTE_PORT) { [int]$env:DB_TUNNEL_REMOTE_PORT } elseif (Get-CfgValue 'remotePort') { [int](Get-CfgValue 'remotePort') } else { 3306 } }
if (-not $KeyPath)    { $KeyPath    = Join-Path $env:USERPROFILE ".ssh\$($projectObj.slug)-agents-tunnel" }
if (-not $TaskName)   { $TaskName   = "agent-team - $($projectObj.slug)-db-tunnel" }
$logFile = Join-Path $root "audit\$($projectObj.slug)-db-tunnel.log"

$ssh = (Get-Command ssh.exe -ErrorAction SilentlyContinue).Source
$sshKeygen = (Get-Command ssh-keygen.exe -ErrorAction SilentlyContinue).Source
if (-not $ssh -or -not $sshKeygen) {
  throw "No encuentro ssh.exe / ssh-keygen.exe. Instala el cliente OpenSSH de Windows (Configuración → Aplicaciones → Características opcionales → Cliente OpenSSH)."
}

# Arma una línea de argumentos con comillas donde hace falta (Start-Process y la tarea
# programada reciben UN string; PowerShell 5.1 no cita solo los elementos con espacios).
function Join-Args([string[]]$ArgList) {
  ($ArgList | ForEach-Object { if ($_ -eq '' -or $_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join ' '
}

function Assert-Host {
  if (-not $RemoteHost) {
    throw "Falta el host de la VM: pásalo con -RemoteHost, con DB_TUNNEL_HOST en .env.$($projectObj.slug), o en projects\$($projectObj.slug)\project.json → dbTunnel.host."
  }
}

function Get-TunnelArgs {
  @('-N', '-i', $KeyPath,
    '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes',
    '-o', "UserKnownHostsFile=$KnownHosts", '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3', '-o', 'ExitOnForwardFailure=yes',
    '-L', "${LocalPort}:127.0.0.1:${RemotePort}", "$RemoteUser@$RemoteHost")
}

function Test-LocalPort {
  try {
    $c = New-Object Net.Sockets.TcpClient
    $iar = $c.BeginConnect('127.0.0.1', $LocalPort, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(1500) -and $c.Connected
    $c.Close()
    return [bool]$ok
  } catch { return $false }
}

function Write-TunnelLog([string]$Msg) {
  New-Item -ItemType Directory -Force -Path (Split-Path $logFile -Parent) | Out-Null
  Add-Content -Path $logFile -Value ("{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Msg) -Encoding UTF8
}

function Assert-Key {
  if (-not (Test-Path $KeyPath)) { throw "No existe la key $KeyPath — corre primero -Action keygen." }
}

switch ($Action) {
  'keygen' {
    if (Test-Path $KeyPath) {
      "Ya existe $KeyPath — no la piso. Parte pública:"
    } else {
      New-Item -ItemType Directory -Force -Path (Split-Path $KeyPath -Parent) | Out-Null
      # Start-Process con la línea armada a mano: `-N ""` llega como passphrase VACÍA en
      # cualquier versión de PowerShell (con `& ssh-keygen -N ""`, PS 5.1 descarta el
      # argumento vacío y tomaría "-C" como passphrase).
      $argLine = '-t ed25519 -N "" -C agents-server -f ' + (Join-Args @($KeyPath))
      $p = Start-Process -FilePath $sshKeygen -ArgumentList $argLine -NoNewWindow -Wait -PassThru
      if ($p.ExitCode -ne 0) { throw "ssh-keygen falló (exit $($p.ExitCode))." }
      "Key creada: $KeyPath (privada — NO sale de este server)."
      ""
      "Pásale a quien administra la VM SOLO esta línea (la parte pública):"
    }
    Get-Content "$KeyPath.pub"
    ""
    "Si este server tiene IP pública FIJA, pásale también la IP (la ata a la key)."
    "Si la IP es dinámica (típico en una red doméstica), díselo: sin eso, la key sola ya es el control."
  }

  'trust' {
    Assert-Key
    Assert-Host
    "Primera conexión: SSH te va a mostrar la huella (fingerprint) del host y preguntar si confías."
    "Antes de escribir 'yes', compárala con la que te pase quien administra la VM (en la VM:"
    "  ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub). Si no coincide, NO aceptes."
    "Después vas a ver 'This account is currently not available.' y se corta: es lo esperado"
    "(el usuario no tiene shell). Eso confirma que la key ya está cargada y la huella guardada."
    ""
    & $ssh -i $KeyPath -o IdentitiesOnly=yes -o "UserKnownHostsFile=$KnownHosts" -o StrictHostKeyChecking=ask "$RemoteUser@$RemoteHost"
    ""
    "exit $LASTEXITCODE — si viste 'Permission denied (publickey)', la key todavía no está cargada en la VM."
  }

  'test' {
    Assert-Key
    Assert-Host
    if (Test-LocalPort) { "El puerto 127.0.0.1:$LocalPort YA responde (¿la tarea ya está corriendo?). Nada que probar."; break }
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = $ssh
    $psi.Arguments = Join-Args (Get-TunnelArgs)
    $psi.UseShellExecute = $false
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $proc = [Diagnostics.Process]::Start($psi)
    $up = $false
    for ($i = 0; $i -lt 16 -and -not $proc.HasExited; $i++) {
      Start-Sleep -Milliseconds 500
      if (Test-LocalPort) { $up = $true; break }
    }
    if ($up) {
      "OK: túnel arriba — 127.0.0.1:$LocalPort → $RemoteHost 127.0.0.1:$RemotePort."
      if (-not $proc.HasExited) { $proc.Kill() }
      "(Lo cerré: era una prueba. Para dejarlo fijo: -Action install.)"
    } else {
      if (-not $proc.HasExited) { $proc.Kill() }
      $err = $proc.StandardError.ReadToEnd()
      "FALLÓ: el puerto local no abrió. Salida de ssh:"
      $err
      ""
      "Guía: 'Permission denied (publickey)' = key no cargada en la VM o no es esta key."
      "      'administratively prohibited' = el túnel pedido no es exactamente 127.0.0.1:$RemotePort."
      "      'Host key verification failed' = falta -Action trust (o cambió la huella: avisa a quien administra la VM)."
      exit 1
    }
  }

  'run' {
    # Loop del túnel (lo corre la tarea programada). Task Scheduler solo reintenta si la tarea
    # no ARRANCA; si ssh se corta después, este loop lo relanza cada 60 s.
    Assert-Key
    Assert-Host
    $argLine = Join-Args (Get-TunnelArgs)
    Write-TunnelLog "loop iniciado (ssh $argLine)"
    while ($true) {
      $p = Start-Process -FilePath $ssh -ArgumentList $argLine -NoNewWindow -Wait -PassThru
      Write-TunnelLog "ssh salió (exit $($p.ExitCode)) — reintento en 60 s"
      Start-Sleep -Seconds 60
    }
  }

  'install' {
    Assert-Key
    Assert-Host
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) { throw "Registrar una tarea 'al iniciar Windows' requiere una consola de PowerShell abierta COMO ADMINISTRADOR." }
    $kh = (Resolve-Path $KnownHosts -ErrorAction SilentlyContinue)
    if (-not $kh) { throw "No existe $KnownHosts — corre primero -Action trust (acepta la huella del host)." }
    # La tarea recibe todo resuelto: no depende de que el .env o el project.json sigan iguales.
    $psArgs = Join-Args @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
      '-File', $PSCommandPath, '-Action', 'run', '-Project', $projectObj.slug,
      '-KeyPath', (Resolve-Path $KeyPath).Path, '-KnownHosts', $kh.Path,
      '-RemoteHost', $RemoteHost, '-RemoteUser', $RemoteUser,
      '-LocalPort', "$LocalPort", '-RemotePort', "$RemotePort", '-TaskName', $TaskName)
    $taskAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $psArgs -WorkingDirectory $root
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
      -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
      -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    # S4U: corre con tu usuario aunque no haya sesión iniciada, sin guardar tu password.
    $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType S4U -RunLevel Limited
    Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger $trigger -Settings $settings -Principal $principal `
      -Description "Túnel SSH a la base de $($projectObj.name) (MCP mysql de los agentes). scripts\db-tunnel.ps1" -Force | Out-Null
    Start-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 6
    if (Test-LocalPort) { "OK: tarea '$TaskName' instalada y túnel arriba en 127.0.0.1:$LocalPort." }
    else { "Tarea instalada, pero el puerto todavía no responde. Mira: -Action status (y el log $logFile)." }
  }

  'status' {
    $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($t) {
      $info = $t | Get-ScheduledTaskInfo
      "Tarea    : $TaskName — estado $($t.State), última corrida $($info.LastRunTime) (resultado $($info.LastTaskResult))"
    } else { "Tarea    : no instalada (-Action install)" }
    "Destino  : $(if ($RemoteHost) { "$RemoteUser@$RemoteHost → 127.0.0.1:$RemotePort" } else { '(sin host configurado)' })"
    "Puerto   : 127.0.0.1:$LocalPort " + $(if (Test-LocalPort) { 'RESPONDE (OK)' } else { 'NO responde' })
    "Key      : $KeyPath " + $(if (Test-Path $KeyPath) { '(existe)' } else { '(NO existe)' })
    if (Test-Path $logFile) { "Log      : $logFile (últimas líneas)"; Get-Content $logFile -Tail 5 }
  }

  'uninstall' {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    "Tarea '$TaskName' borrada (la key y known_hosts quedan)."
  }
}
