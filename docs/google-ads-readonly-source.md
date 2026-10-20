# Fuente Google Ads read-only (MCP `google-ads`)

> Gasto, clics, impresiones y conversiones de **Google Ads** por campaña y por día. Sirve para
> contestar "¿la campaña paga?": CAC y ROAS de un período cruzando el gasto de aquí con las compras
> de la base del producto. La usan **Numa** y **Greta** por `mcp__google-ads__*`. Servidor: el MCP
> oficial de Google, [`googleads/google-ads-mcp`](https://github.com/googleads/google-ads-mcp)
> (Apache-2.0, PyPI `google-ads-mcp`), fijado en una versión (este doc asume la **0.0.5**).

## Por qué este servidor

- **Es el oficial** (lo mantiene el equipo de la Google Ads API) y su página de docs lo declara
  read-only: *"Mode: Read-only (current release)"*.
- **Se descartan los conectores alojados por terceros** que aparecen en los registros de conectores:
  en general pueden lanzar, pausar o editar campañas, y meten a un tercero entre la cuenta y los
  agentes.
- Corre local (stdio), instalado como herramienta de Python aislada: `uv tool` (en una máquina sin
  Python; `uv` trae el suyo) o `pipx`. Sin servidor HTTP, sin puertos.

## Cómo se garantiza el solo-lectura

Google Ads **no tiene un scope OAuth de solo lectura**: el único es `https://www.googleapis.com/auth/adwords`,
que lee y escribe. Por eso el solo-lectura se arma en tres capas, y la fuerte es la segunda:

1. **El servidor solo lee.** En la 0.0.5 hay tres tools, todas con `readOnlyHint=True`. `search` arma
   un `SELECT … FROM …` y lo manda a `GoogleAdsService.SearchStream` (GAQL no tiene sentencias de
   escritura); `get_resource_metadata` lee `GoogleAdsFieldService`; `list_accessible_customers` lee
   `CustomerService`. No hay ningún `mutate`. Si subes de versión, vuelve a verificarlo.
2. **La identidad tiene rol «Solo lectura» en la cuenta de Google Ads.** Es la misma service account
   de GA4. Aunque alguien usara su key por fuera del MCP (un agente con `Bash` puede leer el archivo),
   Google rechaza cualquier cambio porque el rol no lo permite. Si un día hace falta escribir, es una
   decisión del owner: cambiar el rol, no el MCP.
3. **Allowlist.** `mcp__google-ads__*` está solo en Numa y Greta (`scripts/agents.ps1`), que no
   tienen `Bash`. El resto de los agentes levanta el servidor (está en el `.mcp.json` default) pero
   no puede llamar sus tools.

El servidor agrega `google-ads-mcp/<versión>` al header `x-goog-api-client` de cada llamada (Google lo
usa para contar uso del MCP). Es solo el número de versión.

## Sin developer token: el acceso es del proyecto de Google Cloud

**Google dio de baja los developer tokens en septiembre de 2026.** Mandarlo es opcional y la API lo
ignora; en una versión futura lo va a rechazar, así que no se configura. El nivel de acceso ahora es
del **proyecto de Google Cloud dueño de la service account** (el mismo de GA4 y Search Console):

| Nivel | Lee producción | Operaciones por día | Cómo se consigue |
|---|---|---|---|
| Test | No | 15.000 (solo cuentas de prueba) | Al habilitar la Google Ads API en el proyecto |
| **Explorer** | **Sí** | **2.880** en producción | Se pide en la página *Google Ads API → Overview* del proyecto; la aprobación suele ser automática |
| Basic | Sí | 15.000 | Pide verificación de marca del proyecto |

Explorer alcanza: una consulta de un período entero segmentado por día es **una** operación. El
cupo es del proyecto entero y en ventana móvil de 24 h; GA4 y GSC son otras APIs y no lo consumen.

Dos problemas conocidos que Google documenta: si el proyecto está en la prueba gratis de Google
Cloud o tiene la facturación suspendida, rechaza Explorer; y algunos proyectos subidos de nivel
después del cambio todavía reciben `AUTHORIZATION_ERROR` en producción (el atajo es otro proyecto).
Fuente: [dev-token](https://developers.google.com/google-ads/api/docs/get-started/dev-token),
[access levels](https://developers.google.com/google-ads/api/docs/api-policy/access-levels).

## Tools

En la 0.0.5 las tools vienen con prefijo de categoría (`tools_config.yaml` del paquete):

| Tool | Para qué |
|---|---|
| `customers_list_accessible_customers` | Qué cuentas ve la service account. Chequeo barato de que la fuente responde |
| `search_search` | Consulta GAQL: `customer_id`, `resource`, `fields`, `conditions` (se unen con AND), `orderings`, `limit` |
| `metadata_get_resource_metadata` | Qué campos, métricas y segmentos acepta un resource. Úsala antes de adivinar un nombre de campo |

**Customer ID**: `search_search` lo pide en cada llamada y no toma uno por default del entorno
(`GOOGLE_ADS_CUSTOMER_ID` no lo lee el servidor), por eso va escrito en los overrides de Numa y Greta
del proyecto (TODO(acme): tu customer ID, sin guiones). Si la service account está agregada solo en
esa cuenta, `customers_list_accessible_customers` devuelve ese único ID; si un día ve otro o más de
uno (por ejemplo, la cuenta de otro producto), el agente tiene que decirlo en vez de elegir. Si la
service account está agregada directo, sin cuenta de administrador en el medio, no hace falta
`GOOGLE_ADS_LOGIN_CUSTOMER_ID`.

### La consulta de referencia: gasto por campaña y por día

```text
resource:   campaign
fields:     segments.date, campaign.id, campaign.name, campaign.status,
            metrics.cost_micros, metrics.clicks, metrics.impressions,
            metrics.conversions, metrics.conversions_value
conditions: segments.date BETWEEN 'YYYY-MM-DD' AND 'YYYY-MM-DD'
orderings:  segments.date
```

Y una vez por análisis, `customer.currency_code` y `customer.time_zone` del resource `customer`.

### Cómo leer lo que devuelve

- `metrics.cost_micros / 1000000` = plata en la **moneda de la cuenta** (`customer.currency_code`).
  No la asumas; si no coincide con la del revenue, no conviertas sin declarar el tipo de cambio.
- Las fechas (`segments.date`) están en la **zona horaria de la cuenta** (`customer.time_zone`).
  La base del producto suele guardar en UTC: para cortes por día, alinea las dos.
- `metrics.conversions` es lo que **Google se atribuye** según sus conversion actions. No es la
  compra: los compradores salen de la base del producto (canal pago **con** click id; reglas de
  revenue en `projects/<slug>/data-model.md`). Sirve para cruzar. Si la conversion action no carga
  el monto, `metrics.conversions_value` vale 1 por conversión y no sirve para ROAS: verifícalo en tu
  cuenta.
- **CAC** = gasto ÷ **compradores nuevos** del período (usuarios distintos cuya primera compra
  pagada cae en el período; una recompra no suma, si no el CAC sale más bajo de lo que es).
  **ROAS** = revenue de todas las compras del período ÷ gasto.
- Las conversiones de los últimos días **se recalculan** por un tiempo (atribución tardía): los
  últimos 3 días son provisorios.
- **Nunca** consultar `customer_user_access`, `customer_user_access_invitation` ni `change_event`:
  traen emails de usuarios de la cuenta.

## Configuración

| Qué | Dónde | Notas |
|---|---|---|
| Servidor MCP | bloque `google-ads` en el `.mcp.json` default del proyecto | Las variantes `qa`, `design`, `seo` y `aeo` no lo cargan |
| Credencial | `GOOGLE_APPLICATION_CREDENTIALS` ← `${GA4_SERVICE_ACCOUNT_JSON_PATH}` | La misma key JSON de GA4. Es un archivo, no una variable: no hay secreto nuevo |
| Cuenta de administrador | `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (opcional, vacío por default) | Solo si el acceso pasa por una cuenta de administrador |
| Quién puede llamarlo | `AllowedTools` en `scripts/agents.ps1` | `mcp__google-ads__*` para Numa y Greta |
| Qué hacer con los datos | `projects/<slug>/agent-overrides/{numa,greta}.md` | Customer ID, consulta de referencia, reglas de lectura |

**No setees** `GOOGLE_ADS_MCP_OAUTH_CLIENT_ID` / `GOOGLE_ADS_MCP_OAUTH_CLIENT_SECRET`: con esas dos
variables el servidor deja stdio y levanta un servidor HTTP en el puerto 8080.

## Alta del lado de Google (una vez; la hace el owner)

1. **Habilita la Google Ads API** en el proyecto de Google Cloud de la service account
   (*APIs & Services → Library → Google Ads API*). Eso da nivel Test.
2. **Pide Explorer** en *Google Ads API → Overview* del proyecto → *Upgrade access level* →
   *Apply for access*. Sin Explorer, cada consulta a la cuenta real da
   `CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION`.
3. **Google Ads → Administrador → Acceso y seguridad → Usuarios → «+»**: el email de la service
   account (`GOOGLE_SERVICE_ACCOUNT_EMAIL`, o IAM → Cuentas de servicio), con rol **«Solo lectura»**.
   Una service account no acepta el rol «Solo correo electrónico» y por default no recibe
   Administrador; no le des más que lectura.

## Alta en tu Claude Code (uso interactivo, opcional)

A nivel usuario (`~/.claude.json`), disponible en todos tus proyectos:

```powershell
python -m pip install --user pipx          # si no tienes pipx
python -m pipx install "google-ads-mcp==0.0.5"
claude mcp add --scope user google-ads -e "GOOGLE_APPLICATION_CREDENTIALS=<ruta a una key de la service account>" -- "$env:USERPROFILE\.local\bin\google-ads-mcp.exe"
```

Conviene usar **una key nueva** de la misma service account para tu máquina, guardada fuera del repo
y de cualquier carpeta sincronizada: se revoca sola sin tocar la del server. Ojo con tener en la
misma carpeta keys de otras service accounts del proyecto: con una que no está en Google Ads sale el
`UNAUTHENTICATED` de la tabla de errores.

## Alta en el server

Desde la raíz del repo en el server (`C:\agents\agent-team-template`), con el usuario que corre los
agentes:

1. Instala el servidor con **`uv`** si el server no tiene Python (es un solo ejecutable que baja y
   administra su propio Python):

   ```powershell
   winget install --id astral-sh.uv -e
   # cierra y abre otra consola, para que tome el PATH nuevo
   uv tool install "google-ads-mcp==0.0.5" --python 3.13
   uv tool dir --bin                                   # tiene que decir %USERPROFILE%\.local\bin
   Test-Path "$env:USERPROFILE\.local\bin\google-ads-mcp.exe"
   ```

   `uv tool` deja el `.exe` en `%USERPROFILE%\.local\bin`, la misma carpeta que `pipx`. El
   `.mcp.json` lo llama como `google-ads-mcp`, así que esa carpeta tiene que estar en el PATH del
   proceso de los agentes (los wrappers la suman desde `CLAUDE_USERPROFILE`). Si `uv tool dir --bin`
   dice otra ruta (porque alguien setea `UV_TOOL_BIN_DIR`), o si el servidor no levanta, pon la ruta
   absoluta en el `command` del bloque `google-ads`. En una máquina con Python sirve
   igual `python -m pipx install "google-ads-mcp==0.0.5"`. Para actualizar:
   `uv tool install --force "google-ads-mcp==X.Y.Z" --python 3.13`.
2. `.env.server`: nada nuevo. `GA4_SERVICE_ACCOUNT_JSON_PATH` ya está (lo usa GA4). Si existe una
   línea `GOOGLE_ADS_DEVELOPER_TOKEN=...`, bórrala.
3. Smoke directo, solo lectura (imprime totales, nunca la key):

   ```powershell
   $key = (Resolve-Path '<valor de GA4_SERVICE_ACCOUNT_JSON_PATH>').Path
   $cfg = @{ mcpServers = @{ 'google-ads' = @{ command = "$env:USERPROFILE\.local\bin\google-ads-mcp.exe"; env = @{ GOOGLE_APPLICATION_CREDENTIALS = $key } } } } | ConvertTo-Json -Depth 5
   [IO.File]::WriteAllText("$env:TEMP\gads-smoke.mcp.json", $cfg)   # UTF-8 sin BOM
   claude -p "Usa solo el MCP google-ads. Lista las cuentas accesibles y, para la del proyecto, el gasto, los clics y las conversiones de los últimos 7 días. Solo totales." --mcp-config "$env:TEMP\gads-smoke.mcp.json" --strict-mcp-config --allowedTools "mcp__google-ads__*" --permission-mode dontAsk
   Remove-Item "$env:TEMP\gads-smoke.mcp.json"
   ```

4. End to end: en cualquier issue del team, un comentario que empiece con `Numa:` y pregunte el
   gasto de Google Ads de ayer. Tiene que contestar con un número, no con "fuente no configurada".

Si falta la instalación, la API, Explorer o el rol, **la corrida no se rompe**: el servidor no levanta
o la tool devuelve el error de Google, y el agente lo declara y sigue con la base + GA4.

## Errores comunes

| Error | Causa | Arreglo |
|---|---|---|
| `UNAUTHENTICATED` "Request is missing required authentication credential" | Engaña: la key anda, pero esa service account **no está en ninguna cuenta de Google Ads**. El motivo real sale en el log de la librería: *"…is not associated with any Ads accounts"* | Paso 3 del alta de Google con el email de ESA service account (el `client_email` de la key) |
| `CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION` | El proyecto tiene nivel Test | Paso 2 del alta de Google (Explorer) |
| `USER_PERMISSION_DENIED` / `PERMISSION_DENIED` | La service account no está en la cuenta de Google Ads | Paso 3 |
| `Google Ads API has not been used in project … or it is disabled` | La API no está habilitada | Paso 1 |
| `DefaultCredentialsError` / archivo no encontrado | La ruta de la key está mal | Revisa `GA4_SERVICE_ACCOUNT_JSON_PATH` (en el server) o el `-e` de `claude mcp add` (en tu máquina) |
| `AUTHORIZATION_ERROR` con Explorer aprobado | Problema conocido de Google con proyectos subidos de nivel después del cambio | Esperar el arreglo o usar otro proyecto |

## Actualizar la versión

Antes de subir, lee los cambios entre versiones en GitHub. La 0.0.5 corrige que FastMCP dejara
tokens OAuth en los logs: no bajes de ahí. Para subir: `python -m pipx install --force "google-ads-mcp==X.Y.Z"`
en tu máquina y `uv tool install --force "google-ads-mcp==X.Y.Z" --python 3.13` en el server (que
queden iguales) y actualiza la versión en este doc y en el comentario del `.mcp.json`. Ojo con los
nombres de las tools: si cambia `tools_config.yaml`, cambian los prefijos (la allowlist usa
`mcp__google-ads__*`, así que sigue cubriendo todo).

## Revocar

- **Cortar todo de inmediato:** Google Ads → Administrador → Acceso y seguridad → quita la service
  account. GA4 sigue andando (son permisos separados).
- **Una sola key:** Google Cloud → IAM → Cuentas de servicio → la cuenta → Claves → borra la key
  de esa máquina. Borrar la del server corta también GA4 y GSC.

## Lo que suele faltar

- **Una tabla de gasto en la base del producto** (`ads_spend`), para tener el gasto en SQL e
  historia sin depender de la API. Forma sugerida en `projects/acme/data-model.md` → "CAC por canal".
- **Skills de cron** (un brief diario o semanal de ads): ninguna skill del template usa todavía esta
  fuente. Se usa a pedido, por comentario a Numa o Greta.
- **Pico** podría recibirla para sus propuestas de producto. Arrancar con dos agentes es a
  propósito: cuanto menos agentes ven el gasto, menos superficie.
