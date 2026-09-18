# aeo-memory.md — Memoria de la revisión AEO semanal (🤖 Greta 📈)

> Ledger persistente de hallazgos **AEO** (Answer Engine Optimization) y su **disposición**. Lo lee y **reescribe** la skill `aeo-weekly-review` en cada corrida (jueves 04:00, hora del server, vía `scripts/run-greta-aeo.ps1`). El owner también lo puede editar a mano.
>
> **Propósito**: que Greta NO re-proponga lo mismo cada semana, y que registre cuando algo se marcó "no se hace" (`wont-fix`) o "se hizo pero limitado" (`hecho-parcial`).
>
> El **plan** (estrategia + avances) vive en `aeo-strategy.md`: la skill LEE su estrategia estable (§3+) y REESCRIBE su sección viva (§1 Estado y avances, §2 Próximos pasos); **Cody** también appendea una línea de avance a §1 cuando implementa un issue con label `aeo`. Este archivo (`aeo-memory.md`) es el ledger granular por hallazgo; el plan es el resumen.
>
> **Complementariedad con SEO**: antes de proponer, la reconciliación lee AMBOS boards de Linear (labels `aeo` y `seo`). Si una mejora sirve a las dos superficies y SEO ya la tiene como issue, NO se abre uno nuevo — se comenta el de SEO y se registra aquí apuntando a ese issue.
>
> **Plantilla vacía**: arranca sin hallazgos. Greta agrega filas en su primera corrida real.

## Vocabulario de `status`

- `propuesto` — issue creado, en `Backlog`, esperando decisión del owner.
- `aceptado` — el owner lo movió a `Todo`/`In Progress` (se va a hacer).
- `hecho` — implementado (issue `Done`). No re-proponer; si la señal regresó, abrir un hallazgo NUEVO (id nuevo que referencia al viejo).
- `hecho-parcial` — se hizo pero limitado; la **nota** dice qué falta. Proponer SOLO el gap restante.
- `wont-fix` — decisión de no hacer (issue `Canceled`). NO re-proponer salvo que empeore materialmente → ahí comentar el issue existente, no crear uno nuevo.
- `recurrente` — algo que se monitorea, no se "arregla" (ej. vigilar el trend del canal AI Assistant, o el acceso de crawlers de IA en robots).

## Reglas de edición

- **La disposición real vive en Linear**: el estado del issue manda. Greta reconcilia esta tabla cada semana leyendo el estado del issue linkeado en `issue`.
- `id` = **slug estable** del hallazgo (ej. `aeo-llms-txt-ausente`, `aeo-faq-coverage-guias`, `aeo-ai-channel-trend`). **Reusa el mismo `id` entre semanas** — es la clave del dedupe.
- `primera-vez` / `última-vez` en `YYYY-MM-DD`. `última-vez` = la última corrida en la que el hallazgo seguía vigente.
- `issue` = id del issue de Linear (ej. `ACM-12`) o vacío si todavía no se creó issue. Si el dueño del issue es SEO (mejora compartida), anótalo en la nota.
- `nota` = contexto corto: dato que lo disparó, PR que lo cerró, gap restante, cruce con SEO. Nada de PII.

## Ledger

| id | título | primera-vez | última-vez | status | issue | nota |
|----|--------|-------------|------------|--------|-------|------|
| _ejemplo-aeo-llms-txt-ausente_ | _(EJEMPLO — borrar en la primera corrida) No existe `llms.txt` en la raíz del sitio_ | _YYYY-MM-DD_ | _YYYY-MM-DD_ | _propuesto_ | _ACM-0_ | _Fila de ejemplo del formato; no es un hallazgo real._ |
