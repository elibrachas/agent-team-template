# seo-memory.md — Memoria de la revisión SEO semanal (🤖 Greta 📈)

> Ledger persistente de hallazgos SEO y su **disposición**. Lo lee y **reescribe** la skill `seo-weekly-review` en cada corrida (lunes 04:00, hora del server, vía `scripts/run-greta-seo.ps1`). El owner también lo puede editar a mano.
>
> **Propósito**: que Greta NO re-proponga lo mismo cada semana, y que registre cuando algo se marcó "no se hace" (`wont-fix`) o "se hizo pero limitado" (`hecho-parcial`).
>
> Este archivo es el **único** que la skill tiene permiso de escribir (HARD STOP en el SKILL + en el wrapper). No toca código del producto.
>
> **Plantilla vacía**: arranca sin hallazgos. Greta agrega filas en su primera corrida real.

## Vocabulario de `status`

- `propuesto` — issue creado, en `Backlog`, esperando decisión del owner.
- `aceptado` — el owner lo movió a `Todo`/`In Progress` (se va a hacer).
- `hecho` — implementado (issue `Done`). No re-proponer; si la métrica regresó, abrir un hallazgo NUEVO (id nuevo que referencia al viejo).
- `hecho-parcial` — se hizo pero limitado; la **nota** dice qué falta. Proponer SOLO el gap restante.
- `wont-fix` — decisión de no hacer (issue `Canceled`). NO re-proponer salvo que empeore materialmente → ahí comentar el issue existente, no crear uno nuevo.
- `recurrente` — algo que se monitorea, no se "arregla" (ej. vigilar el CWV de una landing de alto tráfico, o un cluster recién activado a la espera de re-crawl).
- `archivado` — se monitoreó, se cumplió el corte y no se activó / no dio señal; se deja de trackear salvo que reaparezca. No re-proponer ni re-monitorear.

## Reglas de edición

- **La disposición real vive en Linear**: el estado del issue manda. Greta reconcilia esta tabla cada semana leyendo el estado del issue linkeado en `issue`.
- `id` = **slug estable** del hallazgo (ej. `cwv-lcp-landing-precios`, `meta-desc-faltante-blog`, `gsc-pagina2-guia-x`). **Reusa el mismo `id` entre semanas** — es la clave del dedupe.
- `primera-vez` / `última-vez` en `YYYY-MM-DD`. `última-vez` = la última corrida en la que el hallazgo seguía vigente.
- `issue` = id del issue de Linear (ej. `ACM-12`) o vacío si todavía no se creó issue.
- `nota` = contexto corto: dato que lo disparó, PR que lo cerró, gap restante, por qué se archivó. Nada de PII.
- Opcional: al pie, una línea `> Nota de la corrida YYYY-MM-DD:` con el resumen de la última corrida (id del `[Report]`, filas nuevas, propuestas creadas). Greta reemplaza la anterior; no acumula.

## Ledger

| id | título | primera-vez | última-vez | status | issue | nota |
|----|--------|-------------|------------|--------|-------|------|
| _ejemplo-cwv-lcp-landing_ | _(EJEMPLO — borrar en la primera corrida) LCP p75 mobile fuera de budget en la landing de precios_ | _YYYY-MM-DD_ | _YYYY-MM-DD_ | _propuesto_ | _ACM-0_ | _Fila de ejemplo del formato; no es un hallazgo real._ |
