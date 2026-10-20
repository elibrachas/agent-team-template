# Valida que un archivo .ps1 parsea sin errores de sintaxis.
# Lo usa Alfred (docs/alfred.md) como control de seguridad antes de commitear
# cualquier .ps1: un error de sintaxis en agents.ps1 rompe a TODOS los agentes.
#
#   uso:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-ps1-parse.ps1 <ruta>
#
# Sale con 0 e imprime "PARSE OK" si parsea; con 1 y los mensajes del parser si no.
# Vive en un archivo (no un one-liner con $vars entre comillas) a propósito: así no
# depende de cómo escape el $ el shell que lo llame. Desde el tool de Bash, un
# "powershell -Command "...$errs...""  haría que Bash expanda el $ antes de arrancar
# powershell, y el resultado cambiaría según el escape de cada vez. Con -File no hay
# nada que expandir en la línea de comando.
#
# El chequeo real es $errors.Count -eq 0: ParseFile deja los errores en su 3er
# parámetro [ref] y NO tira excepción, así que gatear por $? imprimiría "PARSE OK"
# aun con el script roto.

param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Path
)

if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    Write-Error "No existe el archivo: $Path"
    exit 1
}

$full = (Resolve-Path -LiteralPath $Path).Path
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile($full, [ref]$null, [ref]$errors) > $null

if ($errors -and $errors.Count -gt 0) {
    $errors | ForEach-Object { Write-Output $_.Message }
    exit 1
}

Write-Output 'PARSE OK'
exit 0
