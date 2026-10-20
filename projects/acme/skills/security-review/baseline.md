# Baseline de seguridad — Acme (EJEMPLO)

> Lo que ya se sabe, para que `security-review` no lo re-descubra cada semana. Se funda al dar de
> alta el proyecto, con la auditoría de seguridad que tenga el producto (si existe), la base en vivo
> y una lectura de `origin/main` (anota el commit).
>
> **Quién lo actualiza**: el owner o una sesión interactiva (Qualy en cron no tiene Write). El estado
> VIVO de cada hallazgo está en su issue de Linear: cuando este archivo y Linear no coinciden, manda
> Linear, y el `[Report] seguridad` lo dice. Al cerrar o aceptar algo, actualiza la fila aquí.
>
> **Nunca** se copia aquí (ni a Linear) el valor de un secreto, una contraseña o un dato de un cliente.

## Aceptado por diseño o diferido — NO se reporta como nuevo

Solo se vuelve a levantar si cambia (se agrava, se amplía o aparece un abuso real).

| ID | Qué | Por qué está aceptado | Qué lo reabriría |
|---|---|---|---|
| A1 | _Ej._ Las tablas deny-all (RLS sin policy) que el linter marca como INFO | diseño: solo el service role las toca (lista en `data-model.md`) | una tabla nueva sin policy que NO esté en esa lista |
| A2 | _Ej._ Funciones `SECURITY DEFINER` ejecutables por `authenticated`: TODO(acme): la lista | patrón de RLS: las que reciben un id validan que el usuario tiene acceso | una función nueva en la lista, o una de estas que cambia su cuerpo y deja de validar `auth.uid()` |
| A3 | _Ej._ Sin rate limiting en login, reset y formularios públicos | diferido (necesita un store compartido) | un abuso real visible en los logs |
| A4 | _Ej._ CSP con `'unsafe-inline'` en `script-src`/`style-src` | nonces diferidos | que la CSP se afloje más (otro origen en `script-src`) o que desaparezca |
| TODO(acme) | | | |

## Abiertos — sin issue todavía

La primera corrida de `security-review` abre un `[QA-sec]` por cada uno que confirme abierto (máx. 5
por corrida, por severidad) y, desde ahí, el estado vive en Linear.

| ID | Sev. | Hallazgo | Evidencia (con fecha de verificación) | Fix sugerido |
|---|---|---|---|---|
| S1 | _🟡_ | _Ej._ Los previews del hosting corren con las llaves de producción | _Ej._ el service role y el token de servicio tienen target `preview` + `production`; no hay base de staging. Cualquier rama pusheada ejecuta con privilegios contra prod | sacar las llaves del target `preview` (si la app corre sin env con fixtures) o darle a preview una base propia |
| S2 | _🟡_ | _Ej._ Un mismo token hace dos trabajos (Bearer de los jobs y clave de los links firmados) | _Ej._ si se filtra sirve para las dos cosas, y rotarlo invalida todos los links ya enviados | una clave propia para firmar links |
| S3 | _🟡_ | _Ej._ Un GET escribe estado (links de un mail que registran una acción al abrirse) | _Ej._ los escáneres de links de los clientes de correo los abren solos | que el GET muestre una confirmación y el POST registre |
| S4 | _⚪_ | _Ej._ Toggles del dashboard de la base (registro abierto, protección de contraseñas filtradas) | no se leen con el MCP read-only; probarlos sería una mutación: **no se hace** | el owner lo confirma en el dashboard y se actualiza esta fila |
| TODO(acme) | | | | |
