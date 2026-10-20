---
name: signup-to-paid-tracker
description: Use when reporting or investigating the project's free→paid conversion — the daily "how many signups end up paying, and which acquisition channel / signup cohort / persona converts best" question. Reads the database read-only and writes a brief. Usually the most important growth KPI for the revenue goal set in the project's roadmap.
hitl_level: 1
owner: owner
agent: numa
schedule: "0 9 * * *"  # diario 9:00 (hora del server)
inputs:
  - "supabase (read-only): usuarios, pagos/órdenes, atribución de canal y progresión de funnel — según projects/<slug>/data-model.md"
outputs:
  - "Linear (team ACM): issue con el brief — label agent-report, estado Backlog, sin asignar (ver convención en memory/CLAUDE.md)"
  - "queue/pending-review/YYYY-MM-DD-signup-to-paid-tracker.md (espejo local / audit)"
cost_budget_usd: 0.50
---

# signup-to-paid-tracker

> **HITL 1 — read-only.** Solo lee la base (agregado, sin PII) y escribe un brief — issue en Linear (team ACM) + espejo en `queue/pending-review/`. Nunca escribe a prod, nunca toca PII individual.

Mide la conversión **free→paid** del proyecto y la corta por canal de adquisición, cohorte de signup y (cuando se pueda) persona. Es el KPI que suele mover la meta de revenue del proyecto (ver `projects/<slug>/roadmap.md`): la palanca es `free→paid × volumen × ARPU`. Si el drop-off del funnel se concentra en monetización, esta es la métrica que más importa.

## Antes de correr (dependencias)

El wrapper te pasa el directorio de contexto del proyecto (`projects/<slug>/`).

1. Carga `team-shared/skills/glossary` + `projects/<slug>/glossary.md` → definiciones exactas de *Compra*, *Revenue*, *Conversión free→paid*, *canal first/last touch*.
2. Carga `projects/<slug>/data-model.md` → schema real + las **queries canónicas** (esta skill las usa, no inventa SQL nuevo sin chequear ahí).
3. Conexión: MCP `supabase` en `--read-only` (ver `plugins/team-growth/.mcp.json` o el `.mcp.json` que declare tu wrapper).

## Contexto histórico (consulta Linear antes de redactar)

Antes de armar el brief, lista vía MCP de Linear los issues del team ACM con label `agent-report` o `agent-proposal` cuyo título o footer mencione `signup-to-paid` o `🤖 Numa 📊` (búsqueda por texto). Haz tres lecturas:

1. **Issue de hoy con la misma skill**: si ya existe, **NO crees uno nuevo** — la corrida es 1×/día, así que un duplicado es signo de problema. En vez de eso, deja un comentario `🤖 Numa 📊:` en el existente comparando este snapshot vs el anterior, o avisa si los números no cambiaron (re-run manual probable).
2. **Issue del último día hábil anterior**: lee su headline (`X.X%`) para el comparativo "vs ayer". Sin esto no puedes hablar de tendencia honestamente.
3. **Issue de hace ~7 días**: para week-over-week en la sección de movimientos.

Además, lista los issues `agent-proposal` recientes (últimos 7 d) que mencionen conversión / canal / atribución. Si hay propuestas pendientes (de Pico o del owner), menciónalas brevemente al final del brief ("la propuesta de captura de click-id sigue abierta — afecta la lectura de canal hasta que se implemente").

Si Linear MCP falla o no devuelve nada, **dilo en el brief** ("no pude consultar reportes previos — comparativo no disponible") y sigue. No inventes el número de ayer.

## Definiciones que no se negocian (del glossary / data-model)

Complétalas en `glossary.md`; estas son las reglas típicas que conviene fijar:

- **Pagado**: el/los estados de pago que cuentan como completado (si en prod conviven varios literales, lístalos todos).
- **Revenue**: suma de montos cobrados, **siempre `amount > 0`** (excluye comps/regalos) y con la moneda normalizada (p. ej. `lower(currency)` si el casing es inconsistente). No conviertas monedas sin FX explícita: reporta cada moneda por separado.
- **Conversión free→paid**: usuarios que pagaron ÷ signups, por cohorte de mes de alta (en la TZ de negocio).
- **Canal**: el canal first-touch (qué los trajo). Si la atribución es **forward-only**, ver caveat.

## Queries base

```sql
-- EJEMPLO: adapta a las tablas de tu data-model.md
-- Conversión global por cohorte mensual (la headline)
WITH signups AS (
  SELECT date_trunc('month', created_at) AS cohort, id AS user_id
  FROM users
),
paying AS (
  SELECT DISTINCT user_id FROM orders WHERE status = 'paid' AND amount > 0
)
SELECT s.cohort, count(s.user_id) AS signups, count(p.user_id) AS paying,
       round(count(p.user_id)*100.0/nullif(count(s.user_id),0), 2) AS conversion_pct
FROM signups s LEFT JOIN paying p USING (user_id)
GROUP BY s.cohort ORDER BY s.cohort DESC LIMIT 12;
```

```sql
-- EJEMPLO: adapta a las tablas de tu data-model.md
-- Conversión por canal (cohortes nuevas; ver caveat de atribución)
SELECT date_trunc('month', u.created_at)::date AS cohort,
       coalesce(u.channel_first, 'unknown') AS channel,
       count(DISTINCT u.id) AS signups, count(DISTINCT o.user_id) AS paying,
       round(count(DISTINCT o.user_id)*100.0/nullif(count(DISTINCT u.id),0), 2) AS conversion_pct
FROM users u
LEFT JOIN orders o ON o.user_id = u.id AND o.status = 'paid' AND o.amount > 0
WHERE u.created_at >= now() - interval '4 months'
GROUP BY 1, 2 ORDER BY 1 DESC, signups DESC;
```

**Revenue por canal** (last-touch) y **ARPU**: usa las queries homónimas de `data-model.md` si existen.

**Persona**: si `projects/<slug>/icp.md` / la skill de personas define un campo derivable (seniority, tamaño de empresa, etc.), córtalo. Si no hay un campo limpio agregado → marca la sección persona como *no disponible aún* en vez de inventar el corte.

## Caveats obligatorios (declararlos en el output)

1. **Atribución forward-only.** Si el canal se empezó a capturar tarde, el histórico será mayormente `unknown`. El corte por canal solo es confiable para signups **posteriores al deploy** de la captura. Para histórico, cruza con GA4 / la plataforma de ads — dilo, no rellenes.
2. **Canal pago ≈ 0.** Antes de atribuirlo a un bug de captura en las landings, verifica contra prod si la captura del click-id funciona (cuántas filas de atribución recientes lo traen). Si no lo trae ninguna, es probable el bug: flaggea, no concluyas. Si la captura funciona, un canal pago ≈ 0 es una señal real para revisar (campañas pausadas, o la captura que se rompió). Un caveat de "todavía no se atribuye" envejece: re-verifícalo, no lo arrastres. Ojo: el canal de una plataforma de ads también puede salir de un `utm_source` sin click-id; para paid estricto, filtra por el click-id (p. ej. `gclid`).
3. **Comps en $0.** No los sumes a revenue. Por default sí cuentan como "conversión" (el usuario activó algo), pero si la cifra de conversión se ve inflada, reporta ambas (con y sin comps).
4. **Volumen chico.** Con pocas compras, las tasas por canal/cohorte tienen ruido alto → reporta el `n`, no solo el `%`, y no alarmes por swings de pocos casos.

## Output

Crea un **issue en Linear** (team ACM) siguiendo la convención de `memory/CLAUDE.md` (estado `Backlog`, sin asignar). Como es un **reporte** (no una propuesta de cambio), usa label **`agent-report`** y título `[Report] Free→paid <mes> — X.X% (n=…)`. Body:
- **Headline**: conversión free→paid del último mes cerrado + del mes en curso (con n).
- Tabla por canal (últimas cohortes) con n y %.
- Revenue por moneda por separado (mes en curso vs mes anterior).
- Top 1-2 movimientos vs el período anterior, con contexto (no números pelados).
- "Caveats vigentes" (los de arriba que apliquen).
- Cierre "Qué miraría" — 1-2 hipótesis accionables, no un plan.

Si detectas algo claramente accionable (no solo informativo), crea además un issue separado con label `agent-proposal` y título `[Proposal] …` (convención completa en `memory/CLAUDE.md`).

Escribe siempre un espejo del brief en `queue/pending-review/YYYY-MM-DD-signup-to-paid-tracker.md` (audit local).

## Autoauditoría antes de entregar

- ¿Normalicé la moneda y excluí montos en 0 para todo lo de revenue?
- ¿Separé las monedas (no convertí sin FX)?
- ¿Declaré el caveat de atribución si corté por canal?
- ¿Reporté `n` además de `%`?
- ¿Estoy citando algún número sin fuente (regla "no inventar datos")? Si no sale de una query, no va.

## Notas de runtime

- Read-only puro: si una query intenta escribir, aborta.
- Si la conexión a la base falla, escribe un brief de error a la cola y sal con exit code != 0 (el wrapper lo captura y n8n lo loguea) — no estimes números de memoria.
- Costo objetivo < USD 0.50/run; son ~5-6 queries agregadas.
