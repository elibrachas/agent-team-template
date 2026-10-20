# Secretos con 1Password + age (`scripts/op-env.mjs`)

> El esquema alternativo a los `.env` planos. Pensado para la máquina del owner y para los agentes
> interactivos (Claude Code, el Project Lead): los secretos viven en 1Password y se descifran a
> memoria al correr un comando, sin prompts. El server headless sigue con `.env.server` +
> `.env.<slug>` (ver [`server-setup.md`](server-setup.md)): los wrappers los cargan directo.

## La idea

- **La fuente de verdad es un item de 1Password**, no un archivo en el disco.
- En el repo vive **`.env.local.tpl`**: la misma lista de variables que un `.env`, pero cada secreto
  es una referencia `op://<vault>/<item>/<campo>`. Los valores públicos (un nombre de modelo, un id
  de propiedad de GA4, rutas) van literales. **Se commitea**: no tiene secretos.
- Cada máquina tiene **`.env.local.age`**: el `.env` completo, cifrado con [age](https://age-encryption.org)
  para las claves públicas de `.age-recipients`. **No se commitea** (gitignoreado).
- `node scripts/op-env.mjs exec -- <cmd>` descifra `.env.local.age` a memoria con la clave privada
  de la máquina y corre `<cmd>` con esas variables en el entorno. Sin biometría y en milisegundos:
  sirve para agentes desatendidos. El texto plano nunca toca el disco.
- Un `.env.local` plano puede no existir. Si hace falta (una herramienta que solo lee archivos),
  `npm run env:pull` lo materializa y `npm run env:purge` lo borra al terminar.

Por qué age y no sops: sops en Windows no puede leer stdin, así que cifrar con sops obligaría a pasar
el texto plano por un archivo temporal. age lee stdin y escribe stdout en cualquier sistema, y para
este flujo (cifrar el archivo entero, descifrar a memoria) la granularidad por clave de sops no
aporta nada.

## Comandos

| Comando | Qué hace | ¿Pide 1Password? |
|---|---|---|
| `node scripts/op-env.mjs exec -- <cmd>` | Corre `<cmd>` con los secretos en memoria. Si no existe `.env.local.age`, cae a `op run` (pide biometría en cada corrida) | No (con `.env.local.age`) |
| `npm run env:template` | Regenera `.env.local.tpl` desde `.env.local` | No |
| `npm run env:push` | Sube los secretos de `.env.local` al item de 1Password y regenera el template (crea el vault y el item si no existen) | Sí |
| `npm run env:encrypt` | 1Password → `.env.local.age`, cifrado para `.age-recipients`. Es el único paso que hay que repetir cuando cambia un secreto | Sí |
| `npm run env:pull` | Materializa un `.env.local` real desde el template | Sí |
| `npm run env:purge` | Borra el `.env.local` materializado, solo si todas sus variables están en el template (chequeo offline) | No |
| `npm run env:check` | Verifica que cada referencia `op://` resuelva | Sí |
| `npm run env:doctor` | Diagnóstico completo: CLI, login, vault, item y diferencias entre `.env.local` y el template | Sí |

Flags (para cualquier comando): `--vault=<nombre>`, `--item=<título>`, `--env=<path>`, `--tpl=<path>`,
`--enc=<path>`, `--no-template` (en `push`, no regenerar el template). El vault y el item por defecto
(`Agents` / `agent-team-env-local`) están al principio de `scripts/op-env.mjs` (`DEFAULTS`): cámbialos
ahí, ponlos en el entorno con `OP_ENV_VAULT` / `OP_ENV_ITEM` o pásalos por flag. La ruta de la clave
privada de age se cambia con `AGE_KEY_FILE` (o `SOPS_AGE_KEY_FILE`). El `.env.local.tpl` de ejemplo
del repo apunta a los defaults: regenéralo con `npm run env:template` después de armar tu `.env.local`.

El script **nunca imprime valores**, solo nombres de variables.

## Qué es secreto y qué no

Todo es secreto **salvo** lo que esté en la lista `PUBLIC_VARS` de `scripts/op-env.mjs` (o empiece con
`NEXT_PUBLIC_`). Es fail-safe a propósito: una variable nueva se vaultea salvo que la agregues a esa
lista adrede. Antes del primer `env:push`, revisa el `.env.local.tpl` generado.

## Primera vez en una máquina

1. Instala el CLI de 1Password y age: `winget install AgileBits.1Password.CLI` y
   `winget install FiloSottile.age` (el script los encuentra aunque winget todavía no los haya
   sumado al PATH de esa consola).
2. En la app de 1Password: *Settings → Developer → «Integrate with 1Password CLI»*. Desbloquea la app.
3. Genera la clave privada de age de esa máquina, fuera del repo y de cualquier carpeta
   sincronizada: `age-keygen -o "$env:USERPROFILE\.config\sops\age\keys.txt"` (es la ruta que usa el
   script; se cambia con `AGE_KEY_FILE`).
4. Imprime su clave pública con `age-keygen -y "$env:USERPROFILE\.config\sops\age\keys.txt"` y
   agrégala a `.age-recipients` (copia `.age-recipients.example`; una clave por línea, con un
   comentario que diga de qué máquina es). Las claves públicas no son secretas.
5. `npm run env:doctor` → si todo da verde, `npm run env:encrypt`. Desde ahí,
   `node scripts/op-env.mjs exec -- <cmd>` corre sin prompts.

**Sumar otra máquina**: agrega su clave pública a `.age-recipients` y corre `npm run env:encrypt`
desde una máquina que ya tenga acceso; el `.env.local.age` nuevo se descifra con cualquiera de las
claves de la lista.

## Variable nueva

`.env.local` (si no existe, `npm run env:pull` primero) → `npm run env:push` → `npm run env:encrypt`.

## Reglas para los agentes

- Todo comando que necesite secretos va envuelto en `node scripts/op-env.mjs exec -- <cmd>`.
- `env:push`, `env:pull`, `env:encrypt`, `env:check` y `env:doctor` piden biometría: solo con el
  owner presente. Un agente desatendido no los corre: los pide.
- Nunca imprimir valores de env (ni truncados), ni pegarlos en Linear, en el chat o en un commit.
- Nunca commitear `.env.local` ni `.env.local.age`.
- **Vercel**: el campo de 1Password puede llamarse `VERCEL_TOKEN`, pero el template lo expone como
  `VERCEL_API_TOKEN`, a propósito: el CLI de Vercel toma `VERCEL_TOKEN` solo del entorno y dejaría a
  cualquier agente con Bash autenticado para deployar. Solo `scripts/mcp-vercel/` usa ese token.

## Fuera de este esquema

- Los archivos de `secrets/` (por ejemplo, la key JSON de la service account de GA4): son archivos,
  no variables. En el template van como ruta (`GA4_SERVICE_ACCOUNT_JSON_PATH`).
- Las capas del server (`.env.server` y `.env.<slug>`), que leen los wrappers de PowerShell.
