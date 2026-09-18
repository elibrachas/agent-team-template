---
name: funnel-monitor
description: Use when watching the project's commercial funnel for drop-off or anomalies — signup → activación → checkout → compra → recompra (stages defined in the project's glossary.md). Alerts only when a stage moves beyond ~2σ of its 28-day baseline. Read-only database. Early-warning, not a full report.
hitl_level: 1
owner: owner
agent: numa
schedule: "0 */4 * * *"  # cada 4 horas (hora del server)
inputs:
  - "supabase (read-only): las tablas/vistas de funnel y eventos que declare projects/<slug>/data-model.md"
outputs:
  - "Linear (team ACM): issue SOLO si hay anomalía — label agent-report (o agent-proposal si es accionable), estado Backlog"
  - "queue/pending-review/YYYY-MM-DD-funnel-monitor.md (snapshot siempre; alertas resaltadas)"
cost_budget_usd: 0.40
---

# funnel-monitor

> **HITL 1 — read-only.** Lee la base agregada, no escribe a prod, no toca PII. Es una **alarma temprana**: por default está callada y solo habla cuando algo se mueve fuera de rango.

Vigila el embudo comercial del proyecto y avisa cuando una etapa cae (o sube) más de ~2σ respecto de su baseline de 28 días. Complementa a `signup-to-paid-tracker` (que es el reporte diario de conversión): esta corre cada 4 horas y solo busca quiebres.

## Antes de correr (dependencias)

El wrapper te pasa el directorio de contexto del proyecto (`projects/<slug>/`).

1. Carga `team-shared/skills/glossary` + `projects/<slug>/glossary.md` → etapas canónicas del funnel + definiciones.
2. Carga `projects/<slug>/data-model.md` → la fuente real de cada etapa (tabla, columna o evento). Si una etapa sale de una fuente distinta a la obvia (p. ej. el paso de checkout vive en una tabla de eventos de analytics y no en la de funnel), ese archivo lo dice.
3. Conexión: MCP `supabase` `--read-only`.

## Deduplicación (consulta Linear antes de alertar)

Esta skill corre cada 4 horas. Sin dedup, una anomalía persistente generaría 6 issues por día — ruido inservible. **Antes de crear cualquier issue de alerta**, lista vía MCP de Linear los issues del team ACM con label `agent-report` o `agent-proposal` cuyo título tenga `[Alert]` o cuyo footer mencione `🤖 Numa 📊` + `funnel-monitor`, creados en las **últimas 24 horas**:

1. **Si encuentras uno sobre la MISMA etapa o tasa**: NO crees issue nuevo. Agrega un comentario `🤖 Numa 📊:` al existente con el nuevo data point ("4 h después: <etapa> sigue Xσ fuera, n=Y"). Si el desvío volvió a estar dentro de 1σ, comenta "vuelve a baseline" (no cierres el issue — el owner lo cierra a mano).
2. **Si encuentras uno sobre OTRA etapa o métrica**: crea uno nuevo (es una anomalía distinta).
3. **Si no encuentras nada y la anomalía es nueva**: crea el issue normalmente con `[Alert]`.
4. **Si la anomalía persiste >24 h** (3+ data points sobre lo mismo en el thread): escala a una **propuesta de mejora** que alimente el loop de roadmap (ver `docs/product-roadmap-loop.md`). Crea un issue separado con label `agent-proposal`, las **6 secciones canónicas** (`memory/CLAUDE.md`), donde `## Contexto` lleva el dato concreto (etapa, valor vs baseline, n, cuántas horas fuera de rango) y `## Propuesta` sugiere la investigación/acción acotada ("<etapa> lleva 28 h fuera de rango — revisar el deploy del día X, o pagos rotos"). **Antes de crearlo, dedupea** contra `projects/<slug>/roadmap.md` (el plan persistente) y las `[Proposal]` abiertas: si ya hay una propuesta abierta sobre el mismo síntoma, coméntala con el data point nuevo en vez de duplicar. Cierra con `---` + `Generado por 🤖 Numa 📊`. Capi la absorbe al `roadmap.md` y Pico/el owner la refinan.

Si Linear MCP falla, **crea el issue igual** pero agrega al final del body: "⚠️ no pude consultar Linear para dedupe — chequear manual si hay alerta previa antes de actuar".

## Etapas y fuentes

Las etapas son genéricas; **defínelas en `projects/<slug>/glossary.md`** y mapea cada una a su fuente en `projects/<slug>/data-model.md`.

| Etapa | Fuente | Nota |
|-------|--------|------|
| signup | TODO(acme): tabla/columna de alta de usuario | |
| activación | TODO(acme): primer uso del valor central del producto | |
| checkout | TODO(acme): evento de checkout visto / iniciado | suele vivir en la tabla de eventos de analytics |
| compra | TODO(acme): primera compra/pago completado | |
| recompra | TODO(acme): usuarios con 2+ compras | |
| motivo de fricción (opcional) | TODO(acme): evento de paywall/límite con su motivo | útil como contexto, no como serie si es nuevo |

> **Baseline**: documenta en `glossary.md` o `data-model.md` dónde está sano el funnel y dónde se concentra el drop-off. Las etapas a vigilar de cerca son las del tramo con más drop-off (típicamente monetización: checkout → compra); una caída en las etapas altas (signup/activación) suele ser más bien señal de un bug de producto.

## Método de anomalía (2σ sobre 28 días)

1. Para cada etapa, trae el conteo **diario** de los últimos 28 días (usa una tabla de métricas diarias si existe; si no, agrega por día desde la tabla de eventos/progresión).
2. Calcula media y desvío estándar de los días previos (excluye el día parcial en curso del cálculo del baseline).
3. Marca anomalía si el día más reciente completo está fuera de `media ± 2σ`, **o** si una *tasa* entre etapas (ej. checkout iniciado / checkout visto, o compra / activación) cae fuera de 2σ de su propia serie.
4. Vigila también las compras/día y los pagos fallidos si la base los registra (un salto en fallidos es señal de pagos rotos).

```sql
-- EJEMPLO: adapta a las tablas de tu data-model.md
-- Serie diaria de un evento de checkout (últimos 28 d)
SELECT date_trunc('day', timezone('UTC', occurred_at))::date AS day,
       count(*) AS events, count(DISTINCT user_id) AS users
FROM events
WHERE event_type = 'checkout_viewed'
  AND occurred_at >= now() - interval '28 days'
GROUP BY 1 ORDER BY 1;
```

```sql
-- EJEMPLO: adapta a las tablas de tu data-model.md
-- Snapshot de drop-off acumulado (contexto en cada alerta)
SELECT count(*) AS signed_up,
       count(activated_at) AS activated,
       count(first_order_at) AS purchased,
       count(*) FILTER (WHERE order_count >= 2) AS repeat_purchasers
FROM users;
```

## Caveats obligatorios

1. **Volumen chico = mucho ruido.** Si hay pocas ventas por semana, la etapa de compra tiene pocos casos por día y 2σ puede dispararse por azar. Para etapas de bajo n, usa ventana semanal en vez de diaria, y exige que el desvío sea material (no 1 compra de diferencia). Reporta n siempre.
2. **Día parcial.** No compares el día en curso (incompleto) contra días completos: o se normaliza por hora, o se excluye.
3. **Fuentes nuevas (forward-only).** Una tabla/evento que recién empezó a registrarse no sirve como serie temporal todavía: no alarmes por su bajo conteo; úsala solo como contexto (p. ej. el motivo de un paywall).
4. **TZ**: agrega por día en la zona horaria de negocio definida en `glossary.md`, consistente con cualquier tabla de métricas diarias.

## Output

- **Si NO hay anomalía**: escribe el snapshot a `queue/pending-review/YYYY-MM-DD-funnel-monitor.md` (drop-off + series). **No crees issue en Linear** (no spamear el board con días normales).
- **Si HAY anomalía**: crea un **issue en Linear** (team ACM, estado `Backlog`, sin asignar) con label `agent-report` — o `agent-proposal` si hay una acción concreta sugerida. Título `[Alert] <etapa> fuera de rango (Xσ)`. Body: qué etapa, valor de hoy vs baseline (media ± σ), tasa afectada, hipótesis corta de causa (ej. "checkout iniciado cayó 2.4σ — ¿deploy de pricing? ¿pago roto?"). Resalta lo mismo arriba del snapshot en la cola.
- Nunca propongas una acción ejecutable automática (eso es HITL 2+). Solo alerta y contextualiza.

## Autoauditoría antes de entregar

- ¿Excluí el día parcial del baseline?
- ¿La etapa con alerta tiene n suficiente, o es ruido de bajo volumen?
- ¿Saqué cada etapa de la fuente que indica `data-model.md` (y no de una tabla parecida)?
- ¿La alerta incluye baseline + n, no solo "cayó"?
- ¿Algún número sin query detrás? No va.

## Notas de runtime

- Read-only puro. Si falla la conexión, alerta el fallo (no estimes).
- Costo objetivo < USD 0.40/run.
- Corre cada 4 horas: mantén el output idempotente por día (sobreescribe el snapshot del día, no acumules duplicados).
