# qualy-front-memory.md — Memoria del review semanal de front (🤖 Qualy 🧪) · Acme (EJEMPLO)

> **Acme es un SaaS de ejemplo; reemplaza todo.** Ledger persistente de hallazgos de **seguridad y calidad de front** y su **disposición**. Lo lee y **reescribe** Qualy en cada corrida del review semanal de front (`scripts/run-qualy.ps1 -Job front-review`). El owner también lo puede editar a mano.
>
> **Propósito**: que Qualy NO re-cree el mismo issue cada semana, que registre cuándo algo se arregló (`arreglado`), se decidió no hacer (`wont-fix`) o se hizo a medias (`arreglado-parcial`), y que distinga hallazgos NUEVOS de los ya conocidos del baseline de seguridad.

## Vocabulario de `status`

- `abierto` — issue creado en Linear, en `Backlog`, esperando decisión del owner.
- `aceptado` — el owner lo movió a `Todo`/`In Progress` (se va a arreglar). No re-crear; en la próxima corrida verificar si ya se arregló.
- `arreglado` — verificado resuelto (issue `Done` **y** Qualy confirmó el fix en código/browser). No re-reportar; si regresa, es un hallazgo NUEVO (id nuevo que referencia al viejo).
- `arreglado-parcial` — se hizo pero limitado; la **nota** dice qué falta. Reportar SOLO el gap restante.
- `wont-fix` — decisión de no arreglar (issue `Canceled`, o aceptado como riesgo). No re-crear salvo que empeore materialmente → comentar el issue existente.
- `monitoreo` — algo que se vigila, no se "arregla" de una (p. ej. una dependencia con vulnerabilidad sin parche upstream).
- `falso-positivo` — se confirmó que no era real. No volver a levantarlo.

## Reglas de edición

- **La disposición real vive en Linear**: el estado del issue manda. Qualy reconcilia esta tabla cada corrida.
- `id` = **slug estable** del hallazgo (p. ej. `csp-report-only`, `dep-vuln-<paquete>`, `flow-checkout-mobile-overflow`). **Reusa el mismo `id` entre corridas** — es la clave del dedupe.
- `área` = `sec` (seguridad) · `front` (calidad/UI) · `flow` (flujo roto/degradado).
- `sev` = 🔴 alta · 🟡 media · 🟢 baja/info (🟢 normalmente NO crea issue; va al brief y se trackea acá si conviene).
- `primera-vez` / `última-vez` en `YYYY-MM-DD`.
- `issue` = id del issue de Linear (p. ej. `ACM-40`) o vacío si no se creó.
- Hallazgos ya documentados en el baseline de seguridad del producto (si existe; ver `agent-overrides/qualy.md`): trackéalos acá con su id de baseline en la **nota**, y no crees issue salvo que verifiques que siguen abiertos.

## Ledger

| id | título | área | sev | primera-vez | última-vez | status | issue | nota |
|----|--------|------|-----|-------------|------------|--------|-------|------|
| _ejemplo-cookie-flags_ | _(EJEMPLO — bórralo)_ Cookie de sesión sin `SameSite` | sec | 🟡 | 2026-01-05 | 2026-01-05 | abierto | ACM-40 | Fila de ejemplo para mostrar el formato. |
