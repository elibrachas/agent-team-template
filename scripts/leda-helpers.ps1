# EJEMPLO DE ADAPTER DE CMS — Payload CMS + Gemini para Leda 📖.
# Está pensado para un blog montado sobre Payload CMS (collection `posts`, uploads en `media`,
# opcionalmente un banco de ideas en `topics`). Si tu producto usa otro CMS (o Payload con otro
# schema), ADAPTA este archivo: los nombres de collections/campos (`ledaStatus`, `ledaPublishAt`,
# `ledaProcessedAt`, `ledaImageStyle`, ...) son los de ESTE ejemplo y tu CMS tiene que tenerlos
# (o cámbialos aquí y en las skills de contenido que invocan cada acción).
#
# Lo invoca Leda desde sus skills via Bash en el headless agent runtime:
#   powershell -ExecutionPolicy Bypass -NoProfile -File scripts\leda-helpers.ps1 -Action <x> [-Project <slug>] ...
#
# Multi-proyecto: -Project (default acme) carga .env.<slug> ENCIMA de .env.server,
# igual que project.ps1. Sin esto, el helper podría quedarse con valores de otro proyecto
# en el env y escribiría en el Payload EQUIVOCADO. PAYLOAD_BASE_URL es OBLIGATORIA en
# .env.<slug> (no hay default).
#
# Env vars (post-carga):
#   PAYLOAD_API_KEY      - secreto compartido server-to-server (mismo valor en el hosting del producto)
#   PAYLOAD_BASE_URL     - ej. https://acme.example/api (usa el host CANÓNICO: si el apex redirige
#                          a www, el redirect puede descartar el header Authorization)
#   GEMINI_API_KEY       - solo para 'generate-image'
#
# Auth: este ejemplo asume que el producto valida un SECRETO COMPARTIDO (no la API key nativa
# per-user de Payload): un access check en el producto compara el token del header
# `Authorization` (o `x-api-key`) contra process.env.PAYLOAD_API_KEY. Formato:
# `Authorization: Bearer <key>`. El mismo valor de PAYLOAD_API_KEY tiene que estar seteado
# en el producto (hosting) y aquí. TODO(acme): ajusta a como autentique tu CMS.
#
# Output: SIEMPRE JSON a stdout (success o error envuelto), para que la skill
# lo parsee desde el output del Bash tool. Exit code != 0 cuando hay error real.

param(
  [Parameter(Mandatory=$true)]
  [ValidateSet(
    'list-drafts','list-published','get-post','create-post','update-post',
    'upload-media','generate-image','find-related','validate-link',
    'mark-scheduled','mark-needs-rework','publish-now','cancel-schedule',
    'list-scheduled-due','find-recent-styles',
    'list-topics','claim-topic','deliver-topic'
  )]
  [string]$Action,
  [string]$Project = 'acme',      # slug del proyecto: carga .env.<slug> encima de .env.server
  [string]$PostId,
  [string]$TopicId,             # id de la collection topics (solo proyectos con banco de ideas)
  [string]$Notes,               # deliver-topic: nota de entrega (ej. "post id 12")
  [string]$Locale,              # en|es — appendea ?locale=<l> a get/create/update-post (Payload localizado)
  [switch]$Draft,               # appendea draft=true al query string de create/update-post
  [string]$BodyJson,            # JSON string para update-post (más simple que hashtable en CLI)
  [string]$BodyJsonFile,        # Path a un archivo JSON — alternativa a BodyJson para evitar escaping de quotes en CLI
  [string]$FilePath,
  [string]$Alt = "Imagen editorial generada para post de blog",
  [string]$Prompt,
  [string]$PromptFile,        # Path a archivo .txt con el prompt — alternativa a -Prompt para prompts largos/multiline
  [string]$OutFile,
  [string]$Url,
  [string]$Tags,                # comma-separated
  [string]$Category,
  [string]$ExcludeId,
  [int]$WindowHours = 6,
  [int]$Limit = 50
)
$ErrorActionPreference = "Stop"

# stdout en UTF-8: sin esto, PS 5.1 escribe el pipe con el codepage OEM y los acentos
# del JSON salen como mojibake hacia bash (el DATO en Payload está bien — es solo el
# display — pero Leda lo ve corrupto y el guard U+FFFD la obliga a reescribir nodos sanos).
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [System.Text.Encoding]::UTF8
} catch { }

# Raíz del repo (este script vive en scripts\)
Set-Location (Split-Path $PSScriptRoot -Parent)

# Loader de .env (mismo patrón que run-skill.ps1 / Import-EnvFile de project.ps1)
function Import-DotEnv([string]$Path) {
  if (-not (Test-Path $Path)) { return }
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

Import-DotEnv ".\.env.server"
$projEnv = ".\.env.$Project"
if (-not (Test-Path $projEnv)) {
  Write-Error "-Project $Project requiere $projEnv y no existe. Sin él, el helper podría apuntar al Payload de otro proyecto."
  exit 1
}
# Limpiar las vars de Payload que .env.server pudo dejar antes de recargar
Remove-Item Env:PAYLOAD_BASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:PAYLOAD_API_KEY -ErrorAction SilentlyContinue
Import-DotEnv $projEnv
if (-not $env:PAYLOAD_BASE_URL) {
  Write-Error "PAYLOAD_BASE_URL no está en $projEnv — obligatoria para -Project $Project (no hay default)."
  exit 1
}

# Query string común para get/create/update-post en Payloads localizados
$script:PostQS = ""
if ($Locale) { $script:PostQS = "?locale=$Locale" }
if ($Draft)  { $script:PostQS = if ($script:PostQS) { "$script:PostQS&draft=true" } else { "?draft=true" } }

function Require-Env([string]$name) {
  if (-not (Get-Item "Env:$name" -ErrorAction SilentlyContinue)) {
    Write-Error "Env var $name requerida pero no está en el environment. Agrégala a .env.server."
    exit 1
  }
}

function Get-PayloadHeaders {
  Require-Env 'PAYLOAD_API_KEY'
  return @{
    'Authorization' = "Bearer $env:PAYLOAD_API_KEY"
    # charset=utf-8 explícito: declaramos que el body (bytes UTF-8, ver Invoke-PayloadPatch)
    # es UTF-8 para que ningún parser server-side lo interprete como Latin-1 y genere mojibake
    # (é → Ã©).
    'Content-Type'  = 'application/json; charset=utf-8'
  }
}

function Invoke-PayloadGet([string]$Path) {
  Require-Env 'PAYLOAD_API_KEY'
  $url = "$env:PAYLOAD_BASE_URL$Path"
  try {
    # PS 5.1: Invoke-RestMethod / Invoke-WebRequest pueden decodificar como Latin-1 cuando
    # Content-Type no incluye charset=utf-8, corrompiendo acentos (mojibake). Usamos
    # HttpWebRequest + StreamReader UTF-8 explícito para decodificar siempre correctamente,
    # con decompresión automática (Vercel siempre comprime con gzip).
    $req = [System.Net.HttpWebRequest]::Create($url)
    $req.Method = 'GET'
    # Timeouts explícitos: sin esto un Payload lento/colgado bloquea la corrida hasta que el
    # watchdog la mata. Con esto falla rápido y la skill sigue.
    $req.Timeout = 30000            # connect + GetResponse (headers): 30s
    $req.ReadWriteTimeout = 30000   # una lectura INDIVIDUAL del stream sin avanzar: 30s
    $req.Headers['Authorization'] = "Bearer $env:PAYLOAD_API_KEY"
    $req.Accept = 'application/json'
    $req.AutomaticDecompression = [System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate
    $response = $req.GetResponse()
    $stream = $response.GetResponseStream()
    $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8, $true)
    # Deadline TOTAL sobre la lectura del body: $req.Timeout solo cubre hasta
    # GetResponse() y $req.ReadWriteTimeout solo corta UNA lectura estancada — un body que llega
    # a goteo (cada chunk <30s pero nunca termina) igual dejaría a ReadToEnd() correr indefinido y
    # pasar el watchdog. Leemos por chunks contra un deadline duro de 60s y abortamos si se excede.
    $bodyDeadline = (Get-Date).AddSeconds(60)
    $sb = New-Object System.Text.StringBuilder
    $buffer = New-Object char[] 8192
    while (($n = $reader.Read($buffer, 0, $buffer.Length)) -gt 0) {
      [void]$sb.Append($buffer, 0, $n)
      if ((Get-Date) -gt $bodyDeadline) {
        $req.Abort()
        throw "Payload GET $Path excedió el deadline total de 60s leyendo el body (respuesta a goteo)"
      }
    }
    $json = $sb.ToString()
    $reader.Close()
    $response.Close()
    return $json | ConvertFrom-Json
  } catch {
    Write-Error "Payload GET $Path falló: $_"
    exit 1
  }
}

function Invoke-PayloadPatch([string]$Path, [hashtable]$Body) {
  $headers = Get-PayloadHeaders
  $url = "$env:PAYLOAD_BASE_URL$Path"
  $json = $Body | ConvertTo-Json -Depth 30 -Compress
  # PS 5.1: pasar string usa encoding del sistema (CP1252) → Payload recibe bytes inválidos UTF-8.
  # Convertir a bytes UTF-8 explícitos para que la API reciba texto correcto.
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  try {
    # -TimeoutSec: Invoke-RestMethod en PS 5.1 espera INFINITO por default → un PATCH colgado
    # mata la corrida al watchdog. 30s corta rápido; la skill reintenta/continúa.
    return Invoke-RestMethod -Method Patch -Uri $url -Headers $headers -Body $bytes -TimeoutSec 30
  } catch {
    Write-Error "Payload PATCH $Path falló: $_"
    exit 1
  }
}

function Invoke-PayloadPost([string]$Path, [hashtable]$Body) {
  $headers = Get-PayloadHeaders
  $url = "$env:PAYLOAD_BASE_URL$Path"
  $json = $Body | ConvertTo-Json -Depth 30 -Compress
  # Bytes UTF-8 explícitos, mismo motivo que Invoke-PayloadPatch (PS 5.1 + CP1252)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  try {
    return Invoke-RestMethod -Method Post -Uri $url -Headers $headers -Body $bytes -TimeoutSec 30
  } catch {
    Write-Error "Payload POST $Path falló: $_"
    exit 1
  }
}

# BodyJson/BodyJsonFile → hashtable, con el guard de encoding U+FFFD (HARD)
function Read-BodyJson {
  if ($BodyJsonFile) { $script:BodyJson = [System.IO.File]::ReadAllText($BodyJsonFile, [System.Text.Encoding]::UTF8) }
  if (-not $script:BodyJson) { Write-Error "BodyJson o BodyJsonFile requerido"; exit 1 }
  if ($script:BodyJson.Contains([char]0xFFFD)) {
    Write-Error "Abortado: el body contiene el caracter de reemplazo U+FFFD (encoding corrupto). Escribe el body a un archivo UTF-8 y usa -BodyJsonFile, no -BodyJson."
    exit 1
  }
  $bodyObj = $script:BodyJson | ConvertFrom-Json
  # PowerShell 5.1 no soporta -AsHashtable; convertir manualmente
  $body = @{}
  $bodyObj.PSObject.Properties | ForEach-Object { $body[$_.Name] = $_.Value }
  return $body
}

# Nota: hubo una funcion Save-ImageAsCompressedJpeg (compresion a JPEG con System.Drawing/GDI+),
# pero su JPEG hacia 500ear a /api/media — el sharp del producto NO acepta ese JPEG (PNG y
# JPEG-de-sharp suben OK). Se removio: subimos el PNG crudo de Gemini y el producto optimiza el
# serving (imageSizes + Next/Image webp/avif).

# === Actions ===

switch ($Action) {

  'list-drafts' {
    # Drafts eligibles: _status=draft AND no procesados aún por Leda.
    # Opcional: excluir drafts por tag (p. ej. contenido de un segmento que Leda no debe tocar).
    $query = "/posts?where[_status][equals]=draft&where[ledaProcessedAt][exists]=false&sort=createdAt&limit=$Limit"
    $resp = Invoke-PayloadGet $query
    $excluded = @()   # TODO(acme): tags (en minúscula) a excluir, ej. @('internal','b2b')
    $eligible = $resp.docs | Where-Object {
      $tags = @($_.tags) | ForEach-Object { $_.ToLower() }
      ($tags | Where-Object { $excluded -contains $_ }).Count -eq 0
    }
    $__r = @($eligible | ForEach-Object {
      [pscustomobject]@{
        id        = $_.id
        title     = $_.title
        slug      = $_.slug
        category  = $_.category
        tags      = $_.tags
        createdAt = $_.createdAt
      }
    })
    ConvertTo-Json -InputObject $__r -Depth 5
  }

  'list-published' {
    $query = "/posts?where[_status][equals]=published&limit=$Limit&sort=-publishedAt"
    $resp = Invoke-PayloadGet $query
    $__r = @($resp.docs | ForEach-Object {
      [pscustomobject]@{
        id               = $_.id
        title            = $_.title
        slug             = $_.slug
        category         = $_.category
        tags             = $_.tags
        ledaImageStyle = $_.ledaImageStyle
        publishedAt      = $_.publishedAt
      }
    })
    ConvertTo-Json -InputObject $__r -Depth 5
  }

  'get-post' {
    if (-not $PostId) { Write-Error "PostId requerido"; exit 1 }
    Invoke-PayloadGet "/posts/$PostId$script:PostQS" | ConvertTo-Json -Depth 30
  }

  'create-post' {
    # POST /posts — crea un draft nuevo (p. ej. Leda redacta desde cero a partir del banco
    # de topics; usar -Locale en Payloads localizados y -Draft para que nazca como draft).
    $body = Read-BodyJson
    Invoke-PayloadPost "/posts$script:PostQS" $body | ConvertTo-Json -Depth 20
  }

  'update-post' {
    if (-not $PostId) { Write-Error "PostId requerido"; exit 1 }
    $body = Read-BodyJson
    Invoke-PayloadPatch "/posts/$PostId$script:PostQS" $body | ConvertTo-Json -Depth 20
  }

  'upload-media' {
    if (-not $FilePath) { Write-Error "FilePath requerido"; exit 1 }
    if (-not (Test-Path $FilePath)) { Write-Error "Archivo no existe: $FilePath"; exit 1 }
    Require-Env 'PAYLOAD_API_KEY'
    $absPath = (Resolve-Path $FilePath).Path
    # curl.exe para multipart (PS 5.1 no tiene -Form en Invoke-RestMethod; curl viene en Win 10+).
    # Capturamos el HTTP status con -w para reportar fallos REALES (un 500 server-side NO es permiso).
    $respFile = [System.IO.Path]::GetTempFileName()
    # --connect-timeout / --max-time: sin tope, curl cuelga indefinido ante una conexión estancada
    # y mata la corrida al watchdog. Acota connect a 30s y el upload total a 120s.
    # Payload 3 exige los campos del doc en la part `_payload` (JSON); el field suelto `alt`
    # da 400 "Alt: This field is required". Mandamos AMBOS formatos: `_payload` para
    # Payload 3 y `alt` suelto para versiones anteriores.
    # El JSON va vía archivo temp UTF-8 (-F @file) para no romper acentos en el borde CLI.
    $payloadPart = @{ alt = $Alt } | ConvertTo-Json -Compress
    $payloadPartFile = [System.IO.Path]::GetTempFileName()
    [System.IO.File]::WriteAllText($payloadPartFile, $payloadPart, (New-Object System.Text.UTF8Encoding($false)))
    $code = & curl.exe -s -o $respFile -w "%{http_code}" -X POST "$env:PAYLOAD_BASE_URL/media" `
      --connect-timeout 30 --max-time 120 `
      -H "Authorization: Bearer $env:PAYLOAD_API_KEY" `
      -F "file=@$absPath" `
      -F "_payload=<$payloadPartFile" `
      -F "alt=$Alt"
    Remove-Item $payloadPartFile -ErrorAction SilentlyContinue
    $jsonResp = if (Test-Path $respFile) { Get-Content $respFile -Raw -Encoding UTF8 } else { "" }
    Remove-Item $respFile -ErrorAction SilentlyContinue
    if ($LASTEXITCODE -ne 0) { Write-Error "curl POST /media fallo (exit $LASTEXITCODE)"; exit 1 }
    if ($code -notmatch '^2') {
      # 500 = error server-side (ej. sharp no procesa la imagen), NO falta de permiso. 4xx auth seria 401/403.
      Write-Error "Payload /media devolvio HTTP $code (no es permiso si es 5xx). Respuesta: $jsonResp"
      exit 1
    }
    try {
      $resp = $jsonResp | ConvertFrom-Json
    } catch {
      Write-Error "Payload /media no devolvio JSON parseable (HTTP $code): $jsonResp"
      exit 1
    }
    if (-not $resp.doc.id) { Write-Error "Payload /media no devolvio doc.id (HTTP $code): $jsonResp"; exit 1 }
    [pscustomobject]@{
      id  = $resp.doc.id
      url = $resp.doc.url
    } | ConvertTo-Json
  }

  'generate-image' {
    if ($PromptFile) { $Prompt = [System.IO.File]::ReadAllText($PromptFile, [Text.Encoding]::UTF8) }
    if (-not $Prompt) { Write-Error "Prompt requerido (usa -Prompt o -PromptFile)"; exit 1 }
    if (-not $OutFile) { Write-Error "OutFile requerido"; exit 1 }
    Require-Env 'GEMINI_API_KEY'

    $model = "gemini-3.1-flash-image-preview"
    $url = "https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent"
    $headers = @{
      'x-goog-api-key' = $env:GEMINI_API_KEY
      'Content-Type'   = 'application/json'
    }
    $body = @{
      contents         = @(@{ parts = @(@{ text = $Prompt }) })
      generationConfig = @{ responseModalities = @("IMAGE") }
    } | ConvertTo-Json -Depth 10 -Compress

    try {
      # -TimeoutSec 120: generar la imagen puede tardar, pero sin tope un Gemini colgado bloquea
      # la corrida hasta el watchdog. 120s es holgado para una imagen y acota el cuelgue.
      $resp = Invoke-RestMethod -Method Post -Uri $url -Headers $headers -Body $body -TimeoutSec 120
    } catch {
      Write-Error "Gemini generate-image API call falló: $_"
      exit 1
    }
    $imgPart = $resp.candidates[0].content.parts | Where-Object { $_.inlineData } | Select-Object -First 1
    if (-not $imgPart) {
      Write-Error "Gemini no devolvió imagen. Probablemente safety filter. Response: $($resp | ConvertTo-Json -Depth 10 -Compress)"
      exit 1
    }
    $bytes = [Convert]::FromBase64String($imgPart.inlineData.data)
    # Asegurar dir destino
    $outDir = Split-Path -Parent $OutFile
    if ($outDir -and -not (Test-Path $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
    # Guardamos el PNG crudo de Gemini TAL CUAL. NO recomprimir con System.Drawing: su JPEG hace
    # 500ear a /api/media (el sharp del producto no lo traga). El PNG sube OK y el producto genera
    # las variantes optimizadas (imageSizes) + Next/Image sirve liviano al visitante.
    [System.IO.File]::WriteAllBytes($OutFile, $bytes)
    [pscustomobject]@{
      outFile   = $OutFile
      mimeType  = $imgPart.inlineData.mimeType
      sizeBytes = $bytes.Length
    } | ConvertTo-Json
  }

  'find-related' {
    if (-not $ExcludeId) { Write-Error "ExcludeId requerido"; exit 1 }
    $published = Invoke-PayloadGet "/posts?where[_status][equals]=published&limit=200"
    $tagList = @()
    if ($Tags) { $tagList = $Tags.Split(',') | ForEach-Object { $_.Trim().ToLower() } }
    $candidates = @()
    foreach ($p in $published.docs) {
      if ($p.id -eq $ExcludeId) { continue }
      $score = 0
      $pTagsLower = @($p.tags) | ForEach-Object { $_.ToLower() }
      $tagsOverlap = @($pTagsLower | Where-Object { $tagList -contains $_ }).Count
      $score += $tagsOverlap * 2
      if ($p.category -and $Category -and $p.category.ToLower() -eq $Category.ToLower()) { $score += 3 }
      if ($score -gt 0) {
        $candidates += [pscustomobject]@{
          id    = $p.id
          title = $p.title
          slug  = $p.slug
          score = $score
        }
      }
    }
    $__r = @($candidates | Sort-Object -Property score -Descending | Select-Object -First 10)
    ConvertTo-Json -InputObject $__r -Depth 5
  }

  'validate-link' {
    if (-not $Url) { Write-Error "Url requerido"; exit 1 }
    try {
      $resp = Invoke-WebRequest -Method Head -Uri $Url -MaximumRedirection 5 -UseBasicParsing -TimeoutSec 10
      [pscustomobject]@{
        url    = $Url
        status = $resp.StatusCode
        ok     = ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 400)
      } | ConvertTo-Json
    } catch {
      [pscustomobject]@{
        url    = $Url
        status = 0
        ok     = $false
        error  = $_.Exception.Message
      } | ConvertTo-Json
    }
  }

  'mark-scheduled' {
    if (-not $PostId) { Write-Error "PostId requerido"; exit 1 }
    $publishAt = (Get-Date).ToUniversalTime().AddHours($WindowHours).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    $now = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    $body = @{
      ledaStatus       = 'scheduled'
      ledaPublishAt   = $publishAt
      ledaProcessedAt = $now
    }
    Invoke-PayloadPatch "/posts/$PostId" $body | ConvertTo-Json -Depth 5
  }

  'mark-needs-rework' {
    if (-not $PostId) { Write-Error "PostId requerido"; exit 1 }
    $now = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    $body = @{
      ledaStatus       = 'needs_rework'
      ledaProcessedAt = $now
    }
    Invoke-PayloadPatch "/posts/$PostId" $body | ConvertTo-Json -Depth 5
  }

  'publish-now' {
    if (-not $PostId) { Write-Error "PostId requerido"; exit 1 }
    $body = @{
      _status     = 'published'
      ledaStatus = 'published_by_leda'
    }
    Invoke-PayloadPatch "/posts/$PostId" $body | ConvertTo-Json -Depth 5
  }

  'cancel-schedule' {
    if (-not $PostId) { Write-Error "PostId requerido"; exit 1 }
    $body = @{
      ledaStatus     = 'cancelled'
      ledaPublishAt = $null
    }
    Invoke-PayloadPatch "/posts/$PostId" $body | ConvertTo-Json -Depth 5
  }

  'list-scheduled-due' {
    # Posts con ledaStatus=scheduled cuya ledaPublishAt ya pasó. Usado por el tick.
    $nowIso = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    $query = "/posts?where[ledaStatus][equals]=scheduled&where[ledaPublishAt][less_than]=$nowIso&limit=$Limit"
    $resp = Invoke-PayloadGet $query
    $__r = @($resp.docs | ForEach-Object {
      [pscustomobject]@{
        id              = $_.id
        title           = $_.title
        slug            = $_.slug
        ledaPublishAt = $_.ledaPublishAt
      }
    })
    ConvertTo-Json -InputObject $__r -Depth 5
  }

  'find-recent-styles' {
    # Últimos N posts publicados con ledaImageStyle seteado (para anti-repetición).
    # N default = 3 (controlado por -Limit).
    if (-not $Limit) { $Limit = 3 }
    $query = "/posts?where[_status][equals]=published&where[ledaImageStyle][exists]=true&sort=-publishedAt&limit=$Limit"
    $resp = Invoke-PayloadGet $query
    $__r = @($resp.docs | ForEach-Object {
      [pscustomobject]@{
        id               = $_.id
        title            = $_.title
        ledaImageStyle = $_.ledaImageStyle
        publishedAt      = $_.publishedAt
      }
    })
    ConvertTo-Json -InputObject $__r -Depth 5
  }

  # === Banco de ideas (collection `topics` — solo proyectos que lo tengan) ===

  'list-topics' {
    # Ideas disponibles, orden por prioridad (1 = alta). Fuente de un flujo de publicación desde cero.
    # -Category filtra por cluster — el publisher selecciona por cluster, no por orden arbitrario.
    $query = "/topics?where[status][equals]=idea&sort=priority&limit=$Limit"
    if ($Category) { $query += "&where[cluster][equals]=$Category" }
    $resp = Invoke-PayloadGet $query
    $__r = @($resp.docs | ForEach-Object {
      [pscustomobject]@{
        id            = $_.id
        keyword       = $_.keyword
        intent        = $_.intent
        audience      = $_.audience
        cluster       = $_.cluster
        priority      = $_.priority
        brief         = $_.brief
        internalLinks = $_.internalLinks
        ctaTarget     = $_.ctaTarget
        targetLocales = $_.targetLocales
      }
    })
    ConvertTo-Json -InputObject $__r -Depth 8
  }

  'claim-topic' {
    if (-not $TopicId) { Write-Error "TopicId requerido"; exit 1 }
    Invoke-PayloadPatch "/topics/$TopicId" @{ status = 'assigned' } | ConvertTo-Json -Depth 5
  }

  'deliver-topic' {
    # idea→drafted al entregar el draft; -Notes deja la referencia (ej. "post id 12").
    if (-not $TopicId) { Write-Error "TopicId requerido"; exit 1 }
    $body = @{ status = 'drafted' }
    if ($Notes) { $body['notes'] = $Notes }
    Invoke-PayloadPatch "/topics/$TopicId" $body | ConvertTo-Json -Depth 5
  }
}
