# roadmap.md — Plan priorizado de mejora del producto (🤖 Capi 🫒) · Acme (EJEMPLO)

> **Acme es un SaaS de ejemplo; reemplaza todo.** Ledger persistente del **plan priorizado de mejoras** del producto y su **disposición**. Lo lee y **reescribe** la skill `pm-progress-review` en cada corrida (p. ej. lun/mié/vie, vía `scripts/run-capi-roadmap.ps1`). El owner también lo puede editar a mano.
>
> **Propósito**: que el equipo de agentes (Pico 🎯 producto+datos, Cody 💻 deuda técnica, Numa 📊 anomalías, Greta 📈 SEO/AEO, Qualy 🧪 QA/seguridad) genere ideas que NO se pierdan ni se re-propongan; que Capi las priorice y secuencie con mirada de PM; y que el avance quede trackeado.
>
> Este archivo es el **único** que la skill tiene permiso de escribir (HARD STOP en el SKILL + en el wrapper). No toca código del producto ni issues ajenos de Linear.
>
> **El humano siempre está entre el plan y la ejecución.** Esto es solo el plan: nada se construye sin que el owner apruebe el issue y, cuando quiera, invoque a `Cody:`.

## Vocabulario de `status`

- `idea` — está en el plan pero todavía NO tiene issue en Linear (candidato; aún no amerita ticket o falta madurar).
- `propuesto` — issue creado, en `Backlog`, esperando decisión del owner.
- `aceptado` — el owner lo movió a `Todo`/`In Progress`/`In Review` (se va a hacer).
- `en-progreso` — hay una PR abierta referida en el thread.
- `hecho` — implementado (issue `Done` / PR mergeada). No re-proponer; si el problema regresa, abrir un hallazgo NUEVO (id nuevo que referencia al viejo en la nota).
- `hecho-parcial` — se hizo pero limitado; la **nota** dice qué falta. Re-proponer SOLO el gap restante.
- `wont-fix` — decisión de no hacer (issue `Canceled`). No re-proponer salvo que empeore materialmente → en ese caso comentar el issue existente, no crear uno nuevo.

## Reglas de edición (Capi)

- **La disposición real vive en Linear**: el estado del issue manda. Capi reconcilia esta tabla cada corrida (Done ⇒ hecho, Canceled ⇒ wont-fix, Todo/In Progress/In Review ⇒ aceptado, PR abierta en el thread ⇒ en-progreso, sigue en Backlog ⇒ propuesto).
- `id` = **slug estable** de la mejora (p. ej. `checkout-mobile-friction`). **Reusa el mismo `id` entre corridas** — es la clave del dedupe. Si dos agentes proponen lo mismo, una sola fila (anota ambas fuentes en la nota).
- `fuente` = quién originó la idea: `pico` / `cody` / `numa` / `greta` / `qualy` / `leda` / `human` (o varias).
- `impacto` / `esfuerzo` = `alto` / `medio` / `bajo`, juzgados contra el `strategicFocus` de `project.json`.
- `rank` = prioridad del plan (1 = lo próximo a encarar). Capi lo recalcula cada corrida.
- `tema/bet` = área o apuesta (p. ej. `monetización`, `activación`, `SEO`, `AEO`, `tech-debt`, `confiabilidad`, `seguridad`).
- `primera-vez` / `última-vez` en `YYYY-MM-DD`. `última-vez` = la última corrida en la que la mejora seguía vigente.
- `issue` = id del issue de Linear (p. ej. `ACM-12`) o vacío si es una `idea`.

## Ledger

### Plan activo (mejoras vivas, ordenadas por `rank`)

| id | título | fuente | tema/bet | impacto | esfuerzo | rank | status | issue | primera-vez | última-vez | nota |
|----|--------|--------|----------|---------|----------|------|--------|-------|-------------|------------|------|
| _ejemplo-checkout-mobile_ | _(EJEMPLO — bórralo)_ Reducir fricción del checkout en mobile | pico, numa | monetización | alto | medio | 1 | propuesto | ACM-1 | 2026-01-05 | 2026-01-05 | Fila de ejemplo para mostrar el formato. |

### Hechos recientes (mejoras significativas shipeadas — contexto, no re-proponer)

| id | título | issue | cerrado | nota |
|----|--------|-------|---------|------|

### Para cerrar (recomendación — Capi no toca issues ajenos)

| id | título | issue | recomendación | motivo |
|----|--------|-------|---------------|--------|

## Duplicados / overlaps a coordinar

_(Capi anota aquí propuestas de distintos agentes que tocan lo mismo y quién debería decidir la secuencia.)_

## Notas de la corrida

_(Capi agrega un bloque por corrida: qué cambió, nuevo tope del plan, higiene de backlog y preguntas para la próxima corrida.)_
