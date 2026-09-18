---
name: content-blog-publish-tick
description: Use when running the hourly Leda tick — checks for scheduled posts whose publish window expired, verifies they weren't cancelled, and flips them to published in the CMS. Pairs with content-blog-publisher (which schedules) to implement the 6h cancellation window. Lightweight, Haiku-friendly.
hitl_level: 2
owner: owner
agent: leda
schedule: "0 * * * *"   # cada hora en punto
inputs:
  - "CMS (p. ej. Payload): posts con ledaStatus=scheduled y ledaPublishAt < now()"
  - "Linear: thread del issue [Content] correspondiente (para detectar la señal de cancelación)"
outputs:
  - "CMS: flip _status=draft → published para posts confirmados"
  - "Linear: comentar '🤖 Leda 📖: Publicado → <url>' + mover issue a Done; o cancelar y mover a Cancelled"
cost_budget_usd: 0.30
---

# content-blog-publish-tick

> **HITL 2 — ejecuta el publish después de la ventana.** Tick horario. Liviano (Haiku alcanza): lista los programados vencidos, chequea la señal de cancelación, publica o aborta. Sin pulido, sin imagen, sin escritura larga.

## Antes de correr

1. Conexión: `scripts\leda-helpers.ps1` debe poder llamar al CMS (verificar `PAYLOAD_API_KEY`).
2. MCP `linear` para chequear el thread del issue [Content].
3. URL pública del proyecto (para el link del comentario): sale de `projects/<slug>/brand-bible.md` / project.json (ej. `https://acme.example`).

## Workflow

### Paso 1: listar scheduled-due

```bash
powershell -File scripts\leda-helpers.ps1 -Action list-scheduled-due
```

Output: array de posts donde `ledaStatus='scheduled'` AND `ledaPublishAt < now()`. Idealmente vacío en la mayoría de los ticks (el publisher es diario, el tick es horario — solo cae trabajo cada ~6h).

**Si está vacío**: sal sin hacer nada. Brief mínimo: "Tick limpio — 0 posts para publicar." Costo ~$0.05 (Haiku, 1 turno).

### Paso 2: por cada post scheduled-due

#### 2a. Encontrar el issue [Content] en Linear

Usa el MCP de Linear (`list_issues` con label `agent-proposal` filtrando por título `[Content] <title del post>`, o `search_issues` con el slug del post en el body). El issue se creó cuando el publisher programó este post.

**Si no encuentras el issue** (raro): publica igual (la programación está en el CMS; el issue es para la UX de cancelación). Comenta en algún issue de tracking general si hay alguno. Log al brief: "issue Linear no encontrado para post <id>, publicado igual".

#### 2b. Chequear la señal de cancelación

Listar los comentarios del issue (`mcp__linear__list_comments`). Buscar comentarios POSTERIORES a la programación (timestamp > `ledaPublishAt - 6h`, aprox. cuando se creó el issue) que coincidan con cualquiera de:

- Body que arranca con `Leda: stop` (case-insensitive)
- Body que arranca con `Leda: cancela`, `Leda: cancelar` o `Leda: cancelá` (case-insensitive; acepta también la forma voseante que pueda escribir un humano)
- El issue tiene status `Cancelled` (chequear el state del issue)

**Si hay señal de cancelación**:

```bash
powershell -File scripts\leda-helpers.ps1 -Action cancel-schedule -PostId <postId>
```

Comentar en el issue (con la firma exacta `🤖 Leda 📖:` por anti-loop):

```
🤖 Leda 📖: Cancelado por tu pedido. El post queda como draft en el CMS con ledaStatus='cancelled'. Si quieres reprocesarlo, limpia ledaStatus en el admin del CMS (vuelve a quedar elegible para el cron). Si quieres descartarlo definitivamente, elimina el draft.
```

Mover el issue a status `Cancelled` (o `Done` si Cancelled no existe en este team — ver convención).

#### 2c. Si NO hay señal de cancelación: publicar

```bash
powershell -File scripts\leda-helpers.ps1 -Action publish-now -PostId <postId>
```

Esto cambia `_status='published'` (un hook `beforeChange` del CMS setea `publishedAt = now()` automáticamente) y `ledaStatus='published_by_leda'`.

#### 2d. Comentar y cerrar issue

Comentar en el issue (firma exacta):

```
🤖 Leda 📖: Publicado → <URL pública del proyecto>/blog/<slug>

Featured image: <familia visual usada>.
Si después de leerlo quieres cambios chicos: edita en el admin del CMS directamente (no hace falta despublicar). Si quieres despublicar: cambia _status='draft' en el CMS.
```

Mover el issue a status `Done`.

### Paso 3: brief final

```markdown
# Tick content-blog-publish-tick — <fecha y hora>

## Resumen

- Posts scheduled-due encontrados: <N>
- Publicados: <M>
- Cancelados: <K>

## Publicados

| PostId | Title | URL pública |
|---|---|---|
| ... | ... | ... |

## Cancelados

| PostId | Title | Issue Linear |
|---|---|---|
| ... | ... | ACM-... |

## Costo

USD <total_cost_usd> (Haiku — bajo).

## Próximo tick

A la hora siguiente.
```

## Autoauditoría

- ¿Cada post publicado quedó con `_status=published` y `ledaStatus=published_by_leda`?
- ¿Cada post cancelado quedó con `ledaPublishAt=null` y `ledaStatus=cancelled`?
- ¿Comenté el issue Linear correspondiente en TODOS los casos?

## Notas de runtime

- Schedule: cron horario (`0 * * * *`).
- Modelo recomendado: Haiku 4.5 (el workflow n8n pasa `-Model claude-haiku-4-5-20251001`).
- Costo objetivo: <USD 0.30 / corrida; típicamente <$0.10 (ticks vacíos).
- Concurrencia: la corrida es atómica por post (lock implícito por la transición `scheduled` → `published_by_leda`). Si por algún motivo dos ticks corrieran a la vez (raro), el segundo no encuentra el post como scheduled-due y no hace nada.
- Si el CMS responde 5xx en el flip: loguea el error, **no marques** `ledaStatus` (queda scheduled-due, el próximo tick reintenta). Idempotente.
