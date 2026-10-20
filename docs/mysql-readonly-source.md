# Fuente MySQL read-only (MCP `mysql`)

> Para proyectos cuya base de producto **no es Supabase**: por ejemplo, un portal o un backend en
> Laravel/Rails con MySQL en una VM, donde vive el funnel registro → cuenta → pago. La usan **Numa**
> y **Greta** (`mcp__mysql__*`). Código: `scripts/mcp-mysql/`.

## Cómo está armado — 3 capas de defensa

1. **Usuario MySQL read-only con GRANT por columna** (la capa que manda): el usuario solo
   puede `SELECT` sobre columnas puntuales de las tablas del funnel y **nunca ve** secretos
   (passwords, tokens, keys) ni datos de personas o de contenido de clientes.
   Pedir otra columna da `SELECT command denied ... for column` — a propósito.
2. **Sesión read-only**: el MCP abre la conexión con `SET SESSION TRANSACTION READ ONLY`,
   `MAX_EXECUTION_TIME` (default 15 s, `MYSQL_TIMEOUT_MS`) y `sql_select_limit`; la cierra sola tras
   10 s sin uso (`MYSQL_IDLE_CLOSE_MS`), porque el usuario puede tener un cupo chico de conexiones
   simultáneas.
3. **Guard de SQL** (`scripts/mcp-mysql/guard.mjs`): una sola sentencia, solo
   `SELECT/WITH/SHOW/DESCRIBE/EXPLAIN`, sin `SELECT *`, sin columnas de la denylist
   (default + `MYSQL_DENY_COLUMNS` del proyecto), sin comentarios ejecutables `/*! */`, sin
   `INTO OUTFILE`/`SLEEP`/locks. Tope de filas (500 por default, `MYSQL_ROW_LIMIT`, en streaming).
   Test: `cd scripts\mcp-mysql; npm test`.

Si faltan las vars o el túnel está caído, el MCP levanta igual y cada tool responde con un
error claro ("fuente MySQL no configurada" / "no conecta — túnel caído"): el agente
**degrada** declarando la fuente, no se rompe la corrida.

El GRANT por columna es obligatorio: el guard es la segunda línea, no la primera. Una regex sobre SQL
siempre tiene huecos; un permiso que la base no da, no.

## Lado de la base (lo hace quien administra la VM)

TODO(acme): ajusta nombres y puertos a tu infraestructura. El patrón:

- **Usuario MySQL `agents_ro`** en la base del producto, con GRANT por columna sobre las tablas del
  funnel y `MAX_USER_CONNECTIONS 2`. Deja **afuera** a propósito las columnas que traen datos de
  personas (nombres, emails, dominios de clientes) o contenido de clientes (mensajes, nombres de
  archivo, links compartidos). Si un análisis necesita alguna, se discute con quien administra la
  base. Documenta la lista vigente en `projects/<slug>/data-model.md`.
- **La base escucha solo en `127.0.0.1`** de la VM (nunca en una IP pública).
- **Usuario SSH dedicado** (p. ej. `agents-tunnel`) en la VM: sin shell, sin terminal y fuera de
  cualquier grupo con privilegios (un usuario del grupo `docker`, por ejemplo, es root de hecho).
  Solo puede abrir un túnel al puerto de la base; el `sshd` y las opciones de la key rechazan todo lo
  demás. Su `authorized_keys` espera la key del server de agentes, con este formato:
  `restrict,port-forwarding,permitopen="127.0.0.1:<puerto>" ssh-ed25519 AAAA... agents-server`.

## Lado del server de agentes (~20 min)

Todo con `scripts\db-tunnel.ps1 -Project <slug>`, desde la raíz del repo en el server. El host, el
usuario SSH y los puertos salen de los parámetros, de las env vars `DB_TUNNEL_HOST` /
`DB_TUNNEL_USER` / `DB_TUNNEL_LOCAL_PORT` / `DB_TUNNEL_REMOTE_PORT` o del bloque `dbTunnel` de
`project.json` (en ese orden; defaults: usuario `agents-tunnel`, puerto local 13306, remoto 3306; el
host no tiene default).

1. `... -Action keygen` → crea una key dedicada (sin passphrase, solo para este túnel) en
   `%USERPROFILE%\.ssh\` y muestra la parte **pública**: esa, y solo esa, va a quien administra la
   VM. Si el server tiene IP pública fija, pásala también: la ata a la key.
2. Quien administra la VM la carga en el `authorized_keys` del usuario del túnel con el formato de
   arriba (`restrict,port-forwarding,permitopen=…`).
3. `... -Action trust` → primera conexión: compara la huella del host con la que te pasen y
   acéptala. Termina con "This account is currently not available.": es lo esperado (sin shell).
4. `... -Action test` → abre el túnel unos segundos y prueba el puerto local.
5. `... -Action install` (**consola como administrador**) → tarea programada al iniciar Windows que
   mantiene el túnel (se relanza sola si se corta; log en `audit\<slug>-db-tunnel.log`). `-Action status` para ver cómo
   está; `-Action uninstall` la borra.
6. En `.env.<slug>` (el password lo pasa quien administra la base por un gestor de contraseñas, nunca
   por chat ni por mail):

   ```
   MYSQL_HOST=127.0.0.1
   MYSQL_PORT=13306
   MYSQL_DATABASE={{MYSQL_DATABASE}}
   MYSQL_USER=agents_ro
   MYSQL_PASSWORD=<el del gestor de contraseñas>
   MYSQL_DENY_COLUMNS=name,email,message,domain,recipient,original_name
   ```

   `MYSQL_PORT` es el puerto local del túnel. Las `MYSQL_*` figuran en `$ProjectScopedVars` de
   `scripts/project.ps1`: así no se filtran a la corrida de otro proyecto.
7. **Smoke**:

   ```powershell
   cd scripts\mcp-mysql; npm ci; npm test       # guard OK
   ```

   y en un issue de prueba del team del proyecto: `Numa: ¿cuántos registros y cuántas cuentas pagas
   hubo esta semana, por canal de adquisición?` → tiene que contestar con conteos (sin emails).

## Si algo falla

| Síntoma | Causa |
|---|---|
| `Permission denied (publickey)` | la key todavía no está cargada en la VM, o el túnel no usa esa key |
| `administratively prohibited` | el túnel pedido no es exactamente `127.0.0.1:<puerto>` |
| `Host key verification failed` | falta `-Action trust`, o cambió la huella del host (avisa a quien administra la VM) |
| "no conecta — túnel caído" en la respuesta del agente | la tarea del túnel no está corriendo: `scripts\db-tunnel.ps1 -Project <slug> -Action status` (log en `audit\<slug>-db-tunnel.log`) |
| `Access denied for user 'agents_ro'` | password mal copiado |
| `SELECT command denied ... for column X` | columna fuera del GRANT: a propósito |
| `exceeded the 'max_user_connections'` | dos agentes consultando a la vez: reintentar en un minuto |

## Reusar en otro proyecto

Mismo MCP (`node scripts/mcp-mysql/index.mjs`) en el `.mcp.json` del proyecto con sus
`${MYSQL_*:-}`. La denylist default cubre nombres genéricos de secretos y PII; columnas propias del
proyecto se suman con `MYSQL_DENY_COLUMNS` (csv). El GRANT por columna es obligatorio igual.
