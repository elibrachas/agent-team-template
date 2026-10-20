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
# Contrato de campos por proyecto: el default es `leda*` (ledaStatus/ledaPublishAt/
# ledaProcessedAt/ledaImageStyle; estado final published_by_leda). Un proyecto puede usar una
# versión NEUTRAL `agent*` (agentStatus/agentPublishAt/agentProcessedAt; estado final
# published_by_agent), no tener campo de estilo de imagen o no tener collection `topics`. El
# mapping se lee de projects\<slug>\project.json → bloque opcional `payload` (ver $script:F más
# abajo); sin bloque = contrato leda* de siempre.
#
# Output: SIEMPRE JSON a stdout (success o error envuelto), para que la skill
# lo parsee desde el output del Bash tool. Exit code != 0 cuando hay error real.

param(
  [Parameter(Mandatory=$true)]
  [ValidateSet(
    'list-drafts','list-published','get-post','create-post','update-post',
    'upload-media','generate-image','find-related','validate-link',
    'mark-scheduled','mark-needs-rework','publish-now','publish-refresh','cancel-schedule',
    'list-scheduled-due','find-recent-styles','list-in-flight',
    'list-topics','claim-topic','deliver-topic','create-topic',
    'list-guides'
  )]
  [string]$Action,
  [string]$Project = 'acme',      # slug del proyecto: carga .env.<slug> encima de .env.server
  [string]$PostId,
  [string]$TopicId,             # id de la collection topics (solo proyectos con banco de ideas)
  [string]$Status,              # list-topics: idea (default, lo que toma el publisher) | assigned | drafted | published | all
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
  [string]$AspectRatio,         # generate-image: p. ej. "16:9" (generationConfig.imageConfig.aspectRatio). Vacío = lo que decida el modelo, como siempre
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

# === Contrato de campos del pipeline según el proyecto ===
# Default = contrato leda*. Un proyecto puede overridearlo en projects\<slug>\project.json con un
# bloque opcional:
#   "payload": {
#     "agentFieldPrefix": "agent",                  → agentStatus / agentPublishAt / agentProcessedAt
#     "publishedByAgentValue": "published_by_agent", → valor final de <prefix>Status al publicar
#     "imageStyleField": null | "agentImageStyle",  → null = el Payload NO tiene el campo (find-recent-styles devuelve [])
#     "topics": false                               → false = NO existe la collection `topics` (list/claim/deliver/create-topic fallan claro)
#     "guides": true                                → true = Posts tiene `isPillar` / `pillar` (guías y satélites)
#   }
$script:F = [ordered]@{
  Status      = 'ledaStatus'
  PublishAt   = 'ledaPublishAt'
  ProcessedAt = 'ledaProcessedAt'
  ImageStyle  = 'ledaImageStyle'
  PublishedBy = 'published_by_leda'
  HasTopics   = $true
  HasGuides   = $false
}
$projJsonPath = ".\projects\$Project\project.json"
if (Test-Path $projJsonPath) {
  # -Encoding UTF8 OBLIGATORIO: PS 5.1 lee ANSI por default y los project.json no tienen BOM.
  $projCfg = Get-Content $projJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $pl = $projCfg.payload
  if ($pl) {
    if ($pl.agentFieldPrefix) {
      $pfx = [string]$pl.agentFieldPrefix
      $script:F.Status      = "${pfx}Status"
      $script:F.PublishAt   = "${pfx}PublishAt"
      $script:F.ProcessedAt = "${pfx}ProcessedAt"
      $script:F.ImageStyle  = "${pfx}ImageStyle"
    }
    if ($pl.publishedByAgentValue) { $script:F.PublishedBy = [string]$pl.publishedByAgentValue }
    if ($pl.PSObject.Properties['imageStyleField']) {
      $script:F.ImageStyle = if ($pl.imageStyleField) { [string]$pl.imageStyleField } else { $null }
    }
    if ($pl.PSObject.Properties['topics']) { $script:F.HasTopics = [bool]$pl.topics }
    if ($pl.PSObject.Properties['guides']) { $script:F.HasGuides = [bool]$pl.guides }
  }
}

# `pillar` llega como id (depth=0) o como el post entero (la REST de Payload usa depth=2
# por default): siempre devolvemos el id.
function Get-PillarId($pillar) {
  if ($null -eq $pillar -or $pillar -eq '') { return $null }
  if ($pillar -is [System.Management.Automation.PSCustomObject]) { return $pillar.id }
  return $pillar
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

function Require-Topics {
  if (-not $script:F.HasTopics) {
    Write-Error "El Payload de '$Project' NO tiene la collection 'topics' (project.json → payload.topics = false). Esto NO es 'banco vacío': el banco de ideas todavía no existe en el producto."
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

# === Normalización del AST Lexical ===
# El editor del admin de Payload (Lexical) exige en cada nodo las props que el propio editor
# serializa: elementos (paragraph/heading/list/listitem/link/quote) con format:"" + indent:0 +
# direction:"ltr" + version:1; text con format:0 + detail:0 + mode:"normal" + style:"" + version:1;
# list con listType/tag/start; listitem con value. Si faltan, el front público renderiza igual pero
# el ADMIN rompe al abrir el post ("Minified Lexical error #117").
# Leda escribe los nodos a mano y a veces los omite → el helper rellena los defaults ANTES de mandar.
function Ensure-Prop([object]$Node, [string]$Name, [object]$Value) {
  if (-not $Node.PSObject.Properties[$Name]) { $Node | Add-Member -NotePropertyName $Name -NotePropertyValue $Value }
}
function Normalize-LexicalNode([object]$Node, [int]$Index = 0) {
  if ($null -eq $Node -or -not ($Node -is [System.Management.Automation.PSCustomObject])) { return }
  $t = [string]$Node.type
  # Bloques de Payload (BlocksFeature, p. ej. un CodeBlock): nodos decorator sin children ni
  # indent/direction. Un `block` es version 2: con version 1, Payload lo lee como el formato viejo
  # (fields.data) y deja los fields vacíos (un bloque de código sin código). Un `inlineBlock` es
  # version 1 y no lleva format (Payload 3.90). Solo se completa eso.
  if ($t -eq 'block') {
    Ensure-Prop $Node 'format' ''
    Ensure-Prop $Node 'version' 2
    return
  }
  if ($t -eq 'inlineBlock') {
    Ensure-Prop $Node 'version' 1
    return
  }
  if ($t -eq 'text') {
    Ensure-Prop $Node 'format' 0
    Ensure-Prop $Node 'detail' 0
    Ensure-Prop $Node 'mode' 'normal'
    Ensure-Prop $Node 'style' ''
    Ensure-Prop $Node 'version' 1
  } elseif ($t) {
    Ensure-Prop $Node 'format' ''
    Ensure-Prop $Node 'indent' 0
    Ensure-Prop $Node 'direction' 'ltr'
    Ensure-Prop $Node 'version' 1
    if ($t -eq 'list') {
      if (-not $Node.PSObject.Properties['listType']) { Ensure-Prop $Node 'listType' $(if ($Node.tag -eq 'ol') { 'number' } else { 'bullet' }) }
      if (-not $Node.PSObject.Properties['tag'])      { Ensure-Prop $Node 'tag' $(if ($Node.listType -eq 'number') { 'ol' } else { 'ul' }) }
      Ensure-Prop $Node 'start' 1
    }
    if ($t -eq 'listitem') { Ensure-Prop $Node 'value' ($Index + 1) }
    if ($t -eq 'heading')  { Ensure-Prop $Node 'tag' 'h2' }
    if ($t -eq 'link') {
      if (-not $Node.PSObject.Properties['fields']) { Ensure-Prop $Node 'fields' ([pscustomobject]@{ linkType = 'custom'; newTab = $false; url = '' }) }
      Ensure-Prop $Node.fields 'linkType' 'custom'
      Ensure-Prop $Node.fields 'newTab' $false
    }
  }
  if ($Node.PSObject.Properties['children'] -and $Node.children) {
    $i = 0
    foreach ($c in @($Node.children)) { Normalize-LexicalNode $c $i; $i++ }
  }
}
function Normalize-LexicalContent([hashtable]$Body) {
  if ($Body.ContainsKey('content') -and $Body['content'] -and $Body['content'].PSObject.Properties['root'] -and $Body['content'].root) {
    Normalize-LexicalNode $Body['content'].root 0
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
    $query = "/posts?where[_status][equals]=draft&where[$($script:F.ProcessedAt)][exists]=false&sort=createdAt&limit=$Limit"
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
      $o = [ordered]@{
        id       = $_.id
        title    = $_.title
        slug     = $_.slug
        category = $_.category
        tags     = $_.tags
      }
      # La key sale con el nombre REAL del campo del proyecto (ledaImageStyle / agentImageStyle);
      # si el proyecto no tiene el campo, se omite.
      if ($script:F.ImageStyle) { $o[$script:F.ImageStyle] = $_.($script:F.ImageStyle) }
      # Guías y satélites (payload.guides = true): si la nota es una guía y de qué guía es parte.
      if ($script:F.HasGuides) {
        $o['isPillar'] = [bool]$_.isPillar
        $o['pillar']   = Get-PillarId $_.pillar
      }
      $o['publishedAt'] = $_.publishedAt
      [pscustomobject]$o
    })
    ConvertTo-Json -InputObject $__r -Depth 5
  }

  'list-guides' {
    # Las guías publicadas (isPillar) y sus satélites publicados. Para elegir el `pillar` de una
    # nota nueva (por id, nunca hardcodeado) y para ver qué guía está flaca (pocas notas).
    if (-not $script:F.HasGuides) {
      Write-Error "El Payload de '$Project' NO tiene guías (project.json → payload.guides no es true)."
      exit 1
    }
    $guides = Invoke-PayloadGet "/posts?where[_status][equals]=published&where[isPillar][equals]=true&limit=50&depth=0&sort=title"
    $sats   = Invoke-PayloadGet "/posts?where[_status][equals]=published&where[pillar][exists]=true&limit=500&depth=0"
    $__r = @($guides.docs | ForEach-Object {
      $gid = $_.id
      $own = @($sats.docs | Where-Object { (Get-PillarId $_.pillar) -eq $gid } | ForEach-Object { $_.slug })
      [pscustomobject]@{
        id         = $gid
        title      = $_.title
        slug       = $_.slug
        category   = $_.category
        satellites = $own.Count
        slugs      = $own
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
    Normalize-LexicalContent $body   # rellena props Lexical faltantes (sin esto el admin rompe al abrir el post)
    Invoke-PayloadPost "/posts$script:PostQS" $body | ConvertTo-Json -Depth 20
  }

  'update-post' {
    if (-not $PostId) { Write-Error "PostId requerido"; exit 1 }
    $body = Read-BodyJson
    Normalize-LexicalContent $body   # idem create-post
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
    $genConfig = @{ responseModalities = @("IMAGE") }
    # Opcional: con aspectRatio el modelo respeta la proporción (p. ej. 16:9 → 1376x768). Sin el
    # parámetro, nada cambia.
    if ($AspectRatio) { $genConfig['imageConfig'] = @{ aspectRatio = $AspectRatio } }
    $body = @{
      contents         = @(@{ parts = @(@{ text = $Prompt }) })
      generationConfig = $genConfig
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
    $body = @{}
    $body[$script:F.Status]      = 'scheduled'
    $body[$script:F.PublishAt]   = $publishAt
    $body[$script:F.ProcessedAt] = $now
    Invoke-PayloadPatch "/posts/$PostId" $body | ConvertTo-Json -Depth 5
  }

  'mark-needs-rework' {
    if (-not $PostId) { Write-Error "PostId requerido"; exit 1 }
    $now = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    $body = @{}
    $body[$script:F.Status]      = 'needs_rework'
    $body[$script:F.ProcessedAt] = $now
    # Publicada con un borrador pendiente (refresh sin publicar): sin draft=true, Payload arma el
    # update sobre ese borrador y la nota publicada pasa a borrador (404). Ahí se marca solo el borrador.
    $qs = ''
    $main = Invoke-PayloadGet "/posts/${PostId}?depth=0"
    if ($main._status -eq 'published') {
      $latest = Invoke-PayloadGet "/posts/${PostId}?depth=0&draft=true"
      if ($latest._status -eq 'draft') { $qs = '?draft=true' }
    }
    Invoke-PayloadPatch "/posts/$PostId$qs" $body | ConvertTo-Json -Depth 5
  }

  'publish-now' {
    if (-not $PostId) { Write-Error "PostId requerido"; exit 1 }
    $body = @{ _status = 'published' }
    $body[$script:F.Status] = $script:F.PublishedBy
    Invoke-PayloadPatch "/posts/$PostId" $body | ConvertTo-Json -Depth 5
  }

  'publish-refresh' {
    # Publica el borrador de refresh de una nota que YA está publicada (los refresh salen en la
    # misma corrida del publisher, sin esperar aprobación). Dos guardas para que no sirva de atajo
    # a la ventana de 6h de las notas nuevas, que van por mark-scheduled + tick: la fila principal
    # tiene que estar publicada y la última versión tiene que ser un borrador. El PATCH va sin
    # draft=true y con _status=published: Payload arma el update sobre la última versión (el
    # borrador) y la deja publicada.
    if (-not $PostId) { Write-Error "PostId requerido"; exit 1 }
    $main = Invoke-PayloadGet "/posts/${PostId}?depth=0"
    if ($main._status -ne 'published') {
      Write-Error "publish-refresh es solo para notas ya publicadas: el post $PostId está en '$($main._status)'. Una nota nueva sale por mark-scheduled y el tick."
      exit 1
    }
    $latest = Invoke-PayloadGet "/posts/${PostId}?depth=0&draft=true"
    if ($latest._status -ne 'draft') {
      Write-Error "El post $PostId no tiene un borrador pendiente: no hay refresh que publicar."
      exit 1
    }
    $body = @{ _status = 'published' }
    $body[$script:F.Status]      = $script:F.PublishedBy
    $body[$script:F.ProcessedAt] = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    Invoke-PayloadPatch "/posts/$PostId" $body | ConvertTo-Json -Depth 5
  }

  'cancel-schedule' {
    if (-not $PostId) { Write-Error "PostId requerido"; exit 1 }
    $body = @{}
    $body[$script:F.Status]    = 'cancelled'
    $body[$script:F.PublishAt] = $null
    Invoke-PayloadPatch "/posts/$PostId" $body | ConvertTo-Json -Depth 5
  }

  'list-in-flight' {
    # Notas que todavía no están publicadas: borradores y programadas, procesadas o no (list-drafts
    # deja afuera las procesadas). Para deduplicar temas contra lo que ya se está escribiendo.
    $query = "/posts?where[_status][equals]=draft&sort=-createdAt&limit=$Limit"
    $resp = Invoke-PayloadGet $query
    $__r = @($resp.docs | ForEach-Object {
      [pscustomobject]@{
        id          = $_.id
        title       = $_.title
        slug        = $_.slug
        category    = $_.category
        agentStatus = $_.($script:F.Status)
        publishAt   = $_.($script:F.PublishAt)
      }
    })
    ConvertTo-Json -InputObject $__r -Depth 5
  }

  'list-scheduled-due' {
    # Posts con <prefix>Status=scheduled cuya <prefix>PublishAt ya pasó. Usado por el tick (y por su
    # pre-check en run-skill.ps1 y el check 7 de run-health-check.ps1).
    $nowIso = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    $query = "/posts?where[$($script:F.Status)][equals]=scheduled&where[$($script:F.PublishAt)][less_than]=$nowIso&limit=$Limit"
    $resp = Invoke-PayloadGet $query
    $__r = @($resp.docs | ForEach-Object {
      $o = [ordered]@{
        id    = $_.id
        title = $_.title
        slug  = $_.slug
      }
      $o[$script:F.PublishAt] = $_.($script:F.PublishAt)
      [pscustomobject]$o
    })
    ConvertTo-Json -InputObject $__r -Depth 5
  }

  'find-recent-styles' {
    # Últimos N posts publicados con el campo de estilo de imagen seteado (para anti-repetición).
    # N default = 3 (controlado por -Limit).
    if (-not $Limit) { $Limit = 3 }
    if (-not $script:F.ImageStyle) {
      # El Payload de este proyecto no tiene campo de estilo de imagen: sin memoria de familias →
      # pool completo, random puro.
      Write-Warning "El proyecto '$Project' no tiene campo de estilo de imagen (project.json → payload.imageStyleField = null): devuelvo [] — usa el pool completo de familias y NO mandes el campo en update-post."
      ConvertTo-Json -InputObject @() -Depth 5
      break
    }
    $query = "/posts?where[_status][equals]=published&where[$($script:F.ImageStyle)][exists]=true&sort=-publishedAt&limit=$Limit"
    $resp = Invoke-PayloadGet $query
    $__r = @($resp.docs | ForEach-Object {
      $o = [ordered]@{
        id    = $_.id
        title = $_.title
      }
      $o[$script:F.ImageStyle] = $_.($script:F.ImageStyle)
      $o['publishedAt'] = $_.publishedAt
      [pscustomobject]$o
    })
    ConvertTo-Json -InputObject $__r -Depth 5
  }

  # === Banco de ideas (collection `topics` — solo proyectos que lo tengan) ===

  'list-topics' {
    # Ideas disponibles, orden por prioridad (1 = alta). Fuente de un flujo de publicación desde cero.
    # -Category filtra por cluster — el publisher selecciona por cluster, no por orden arbitrario.
    Require-Topics
    # -Status: 'idea' por default (lo que toma el publisher, igual que siempre); 'all' trae todas,
    # para deduplicar contra ideas ya tomadas o entregadas (p. ej. un content-topic-scan).
    $topicStatus = if ($Status) { $Status } else { 'idea' }
    $query = "/topics?sort=priority&limit=$Limit"
    if ($topicStatus -ne 'all') { $query += "&where[status][equals]=$topicStatus" }
    if ($Category) { $query += "&where[cluster][equals]=$Category" }
    $resp = Invoke-PayloadGet $query
    $__r = @($resp.docs | ForEach-Object {
      [pscustomobject]@{
        id            = $_.id
        status        = $_.status
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
    Require-Topics
    if (-not $TopicId) { Write-Error "TopicId requerido"; exit 1 }
    Invoke-PayloadPatch "/topics/$TopicId" @{ status = 'assigned' } | ConvertTo-Json -Depth 5
  }

  'create-topic' {
    # POST /topics — carga UNA idea al banco (seed inicial o alta puntual). Body por archivo UTF-8
    # (-BodyJsonFile) con los campos de la collection del proyecto (keyword, audience, cluster,
    # intent, priority, brief, internalLinks, ctaTarget, status='idea'). Devuelve el doc creado.
    Require-Topics
    $body = Read-BodyJson
    Invoke-PayloadPost "/topics" $body | ConvertTo-Json -Depth 10
  }

  'deliver-topic' {
    # idea→drafted al entregar el draft; -Notes deja la referencia (ej. "post id 12").
    Require-Topics
    if (-not $TopicId) { Write-Error "TopicId requerido"; exit 1 }
    $body = @{ status = 'drafted' }
    if ($Notes) { $body['notes'] = $Notes }
    Invoke-PayloadPatch "/topics/$TopicId" $body | ConvertTo-Json -Depth 5
  }
}
