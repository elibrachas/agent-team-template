# Fuente Vercel read-only (MCP `vercel`)

> Deploys, build logs y errores de runtime de los proyectos de Vercel de **cada producto**. La usan
> **Qualy** (log-review, QA de previews), **Cody** (¿buildeó mi preview?, ¿qué error tira prod?) y
> **Numa / Greta / Pico** (¿hubo un deploy o un pico de 5xx que explique este número?) por
> `mcp__vercel__*`. Código: `scripts/mcp-vercel/`.

## Por qué un MCP y no `curl` con el token

**Vercel no tiene tokens de solo lectura.** Un access token se puede acotar por team (o por
proyecto) y por vencimiento, pero no por permiso: el mismo token que lee un log puede borrar un
proyecto, cambiar un dominio, disparar un deploy y **leer y descifrar las env vars de producción**
(pasarela de pagos, service role de la base, proveedor de email…) de todo lo que alcanza.

Lo habitual es que el token alcance **todo el team**, que puede tener más proyectos que los de los
productos que maneja este repo (prototipos, otros clientes). Por eso el "solo lectura" se impone del
lado nuestro, igual que con MySQL (`docs/mysql-readonly-source.md`):

1. **Solo GET.** `vget()` es la única función de `index.mjs` que sale a la red y el método está
   fijo. El test (`guard.test.mjs`) falla si aparece otro `fetch` u otro método HTTP.
2. **Paths fijos.** Cada tool arma su path desde una plantilla y los ids pasan un regex estricto.
   No hay tool que llegue a env vars, a la config del proyecto, a tokens, dominios ni teams.
3. **Pin de proyectos.** Cada corrida solo puede leer los proyectos de Vercel de SU producto
   (`project.json → vercel.projects`). Un proyecto o deployment de otro producto del team se
   rechaza aunque el token lo pueda ver.
4. **Salida filtrada y redactada** (`guard.mjs`): de cada fila sale una lista corta de campos; los
   paths van sin query string; los mensajes pasan por una redacción de emails, tokens e IPs. No
   salen user agents, IPs, geo, referers ni session ids.

Lo que **no** resuelve el MCP: un agente con `Bash` (Cody, Qualy, Daly, Leda, Alfred) puede leer el
env de su propio proceso y el `.env.server`, como ya pasa con el resto de los secretos. Para Cody y
Qualy —los dos que tienen motivo para mirar Vercel— la regla es de prompt (está en
`scripts/agents.ps1`): Vercel solo por `mcp__vercel__*`, nunca el token por `curl` ni el CLI
`vercel`. Los agentes sin Bash (Numa, Greta, Pico) no tienen forma de usar el token por fuera del
MCP. Si ese riesgo residual molesta, la salida es un token acotado por proyecto (ver "Rotar").

## Tools

| Tool | Para qué |
|---|---|
| `vercel_projects` | Qué proyectos puede leer la corrida + último deploy de prod y último fallido (7 días). Chequeo barato de que la fuente responde |
| `vercel_deployments` | Lista de deployments: estado, target, rama, commit. Filtros `state` (`ERROR` = builds fallidos), `target`, `branch`, `since` |
| `vercel_build_logs` | Estado de UN deployment (error, alias, **crons registrados**) + últimas líneas del build. `onlyErrors` |
| `vercel_logs_summary` | Errores de runtime agrupados por status + ruta + mensaje (5xx y logs de nivel error; opcional 4xx y warnings) |
| `vercel_request_logs` | Filas de runtime con filtros (`level`, `statusCode`, `search`, `deploymentId`, `requestId`). Paginado con `nextUntil` |

El `deployment.crons` que devuelve `vercel_build_logs` del último deploy de producción es la lista
REAL de crons registrados (path + schedule): si no coincide con lo que dice el `data-model.md` del
proyecto, la tabla quedó vieja o un cron se cayó del `vercel.json`.

### Retención: ~24 horas de runtime

Los logs de runtime tienen la retención del plan de Vercel: **~24 h** en los planes habituales.
Pedir una ventana que cae entera fuera de eso devuelve un error explícito. Consecuencia práctica: un
`log-review` **semanal** solo ve el último día; uno **diario** cubre todo. Los deploys y sus build
logs sí tienen historial.

Si decides dejar un `log-review` semanal (más barato), el reporte tiene que decirlo: de runtime cubre
1 día de cada 7, y lo que sí cubre la semana entera son los deploys fallidos y sus build logs. Un cron
del producto que corre una vez por semana tampoco se ve desde un review de otro día.

La falla silenciosa más común en funciones serverless es el **timeout** (`maxDuration`): Vercel mata
la función, el `catch` no corre y no queda rastro en la base. Esos casos solo aparecen aquí.

### De dónde salen los logs

Del endpoint que usa el CLI oficial (`vercel logs`): `https://vercel.com/api/logs/request-logs`.
El que está documentado en la REST API (`/v1/projects/{id}/deployments/{id}/runtime-logs`) es un
**stream en vivo**: no devuelve historial y deja la conexión abierta. Un `log-review` que lo llama por
`curl` no trae nada (0 bytes) sin dar error: parece que no hubo errores cuando en realidad no se miró.

**La búsqueda es lenta y a veces no responde**: unos segundos con una ventana de 1 h, bastante más
con 24 h, y con ventanas anchas el gateway de Vercel corta a los ~30 s con un 504. Cómo lo maneja el
MCP:

- Cada llamada a una tool tiene un **tope de tiempo total** (55 s; `VERCEL_TOOL_BUDGET_MS`). Nunca
  deja a un agente esperando minutos.
- Si Vercel no responde para la ventana completa, se reintenta **una vez con el cuarto más
  reciente** (mínimo 1 h) y la respuesta lo dice: `coveredSince` marca desde cuándo cubrió y lo
  anterior queda explícitamente sin mirar. Se completa repitiendo con `until`.
- `vercel_logs_summary` corre sus consultas en paralelo y trae `complete`. Si es `false`,
  `coverage` dice qué consulta falló o qué tramo cubrió. Si no respondió ninguna, la tool devuelve
  error: un resumen en cero se leería como "sin errores".

Dos rarezas del endpoint que el MCP ya maneja: ignora el parámetro `page` (se pagina moviendo
`endDate`) y el nivel de warning se llama `warn`, no `warning` (un nivel desconocido se ignora en
silencio). No es una API pública documentada: si un día cambia, las dos tools de logs empiezan a
fallar con el status que devuelva Vercel y el agente lo declara; deploys y build logs usan la REST
API documentada.

## Configuración

| Qué | Dónde | Notas |
|---|---|---|
| Token | `VERCEL_API_TOKEN` en **`.env.server`** (una sola vez) | Si usas 1Password, el campo del item puede llamarse distinto (p. ej. `VERCEL_TOKEN`) y `.env.local.tpl` lo expone como `VERCEL_API_TOKEN`. `project.ps1` lo conserva para cada proyecto; un valor no vacío en `.env.<slug>` lo pisa (sirve para un token acotado a un proyecto) |
| Team + proyectos (el pin) | `projects/<slug>/project.json` → `vercel` | Son ids, no secretos: van versionados. `Resolve-ProjectContext` los exporta como `VERCEL_TEAM_ID` / `VERCEL_PROJECTS` |
| Server MCP | bloque `vercel` en el `.mcp.json` default y en `qa.mcp.json` de cada proyecto | Los crons SEO/AEO de Greta y las variantes `design` no lo cargan |
| Quién puede llamarlo | `AllowedTools` en `scripts/agents.ps1` | `mcp__vercel__*` para Qualy, Cody, Numa, Greta y Pico. Capi, Daly, Leda y Alfred no |

**Por qué la variable se llama `VERCEL_API_TOKEN` y no `VERCEL_TOKEN`:** el CLI de Vercel toma
`VERCEL_TOKEN` del entorno sin que nadie se lo pase. Con ese nombre, cualquier agente con Bash que
corra `vercel` (o `npx vercel`) quedaría autenticado para deployar, bajar env vars o borrar. En
1Password el campo puede llamarse como quieras; en el env de los agentes, `VERCEL_API_TOKEN`.

Si un producto tiene varios proyectos de Vercel (p. ej. la app y el sitio de marketing), cada uno es
una entrada del pin con su `key`. Lo que no está en Vercel (una VM, otro hosting) no entra al pin.

## Alta en el server (una vez)

Desde la raíz del repo en el server (`C:\agents\agent-team-template`):

1. `cd scripts\mcp-vercel; npm ci` — instala la única dependencia (el SDK de MCP).
2. En `.env.server`: `VERCEL_API_TOKEN=<tu token>` (Vercel → Account Settings → Tokens).
3. En cada `.env.<slug>` que exista: **borra** la línea `VERCEL_API_TOKEN=...` si tiene un valor
   viejo (pisaría al de `.env.server`). `VERCEL_PROJECT_ID` solo sirve para una corrida local sin
   wrapper: con el pin en `project.json`, se puede borrar.
4. Verifica el pin de cada proyecto sin llamar a claude (la última línea dice `Vercel : ...`):
   `powershell -File scripts\run-qualy.ps1 -Job log-review -Project acme -DryRun`
5. Smoke contra Vercel real, solo lectura (imprime conteos y estados, nunca mensajes de log):

   ```powershell
   $env:VERCEL_API_TOKEN = '<token>'; $env:VERCEL_PROJECTS = 'app={{VERCEL_PROJECT_ID_APP}}'
   cd scripts\mcp-vercel; npm run smoke
   ```

Si falta el token, el pin o el `npm ci`, la corrida **no se rompe**: las tools responden "fuente
Vercel no configurada" (o el server no levanta) y el agente lo declara en su reporte.

## Rotar o revocar el token

Vercel → Account Settings → Tokens. Para rotar: crea el nuevo, actualiza el secreto (1Password o
`VERCEL_API_TOKEN` en `.env.server`) y revoca el viejo. Un token revocado se ve enseguida: las tools
responden "Vercel rechazó el pedido (401/403)".

Si en algún momento quieres bajar el alcance: Vercel permite crear tokens acotados a **un**
proyecto (`vercel tokens add <nombre> --project <prj_...>`). Con uno por proyecto, cada uno va en
el `.env.<slug>` correspondiente y el de `.env.server` se elimina. Un producto con dos proyectos de
Vercel necesitaría dos tokens, y el MCP toma un solo token por corrida: ese caso requiere un cambio
chico en `index.mjs`. No está verificado que el endpoint de logs acepte tokens acotados a proyecto.

## Agregar un proyecto

En `projects/<slug>/project.json`:

```json
"vercel": {
  "teamId": "{{VERCEL_TEAM_ID}}",
  "projects": [
    { "key": "app", "id": "{{VERCEL_PROJECT_ID_APP}}", "name": "nombre-en-vercel", "role": "qué sirve" }
  ]
}
```

y el bloque `vercel` en su `.mcp.json` y `qa.mcp.json`. El id del proyecto (`prj_...`) sale de
Vercel → Project → Settings → General → Project ID; el del team (`team_...`), de Team Settings. Si
el proyecto vive en otra cuenta de Vercel que el token no ve, necesita su propio token en
`.env.<slug>`.

## Tests

- `cd scripts\mcp-vercel; npm test` — sin red ni token. `guard.test.mjs`: pin, validación de ids,
  redacción, whitelist de campos, y que `index.mjs` siga teniendo una sola salida a la red, solo
  GET. `budget.test.mjs`: levanta el MCP contra un Vercel simulado (lento, caído, con 504 en
  ventanas anchas) y verifica que cada llamada vuelva dentro del tope y diga qué tramo cubrió.
- `npm run smoke` — contra Vercel real, con el env del proyecto cargado (ver arriba).
  `SMOKE_VERBOSE=1` muestra los grupos de error ya redactados.
