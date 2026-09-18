# Data Model — Acme (EJEMPLO)

> **Acme es un SaaS de ejemplo; reemplaza todo.** Schema canónico que lee toda skill que escribe SQL (Numa, Greta, Pico, Qualy). Si el modelo cambia, **este archivo se actualiza primero**; la fuente de verdad final son las migraciones del repo del producto.
>
> Buenas prácticas: anota cuándo y contra qué base validaste el documento, marca los conteos como "snapshot (orden de magnitud)" y documenta los **caveats de calidad de datos** — son lo que más errores evita.

## Warehouse

_Guía_: motor, si es la misma base de prod o un warehouse aparte, schema, credenciales que usan los agentes (siempre read-only), zona horaria de reporte, unidad de los montos, monedas.

_Ejemplo Acme_:
- Engine: Postgres (Supabase), que es también la base de prod. Schema `public`.
- Acceso de agentes: MCP de Supabase en `--read-only` con un PAT (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` en `.env.acme`).
- TZ de reporte: UTC. Montos en **centavos** (`amount_cents`), dividir por 100 al reportar.
- Monedas: reportar siempre por separado; nunca sumar monedas distintas sin FX explícita.

## Tablas core

_Guía_: una subsección por tabla relevante con propósito, columnas clave (no hace falta el schema completo), cardinalidad aproximada y caveats. No incluyas columnas con PII salvo para decir "no consultar".

### `users` — cuentas
- Columnas clave: `id`, `created_at`, `plan`, `is_internal` (excluir siempre en métricas).
- PII: `email`, `name` — **nunca** se seleccionan en queries de agentes.

### `quotes` — presupuestos creados
- Columnas clave: `id`, `user_id`, `created_at`, `status` (`draft` / `sent` / `accepted`).

### `payments` — pagos
- Columnas clave: `id`, `user_id`, `created_at`, `amount_cents`, `currency`, `status`.
- Caveat de ejemplo: existen pagos en 0 (cortesías) → para revenue filtrar `amount_cents > 0`.

### `subscriptions` — suscripciones
- Columnas clave: `user_id`, `plan`, `status`, `current_period_end`.

## Capa de atribución y funnel

_Guía_: cómo se registra el canal de adquisición y los eventos del funnel; desde cuándo existe (¿forward-only?) y qué puntos ciegos tiene.

### `events` — eventos de producto
- Columnas clave: `user_id`, `event_type`, `created_at`, `properties` (jsonb).
- Eventos del funnel (ver `glossary.md`): `quote_sent`, `checkout_viewed`, `checkout_started`.

### `user_acquisition` — canal por usuario (opcional)
- `channel_first`, `channel_last`, `utm_*`. Forward-only desde que se implementó.

## Views agregadas (canónicas)

_Guía_: views que ya resuelven métricas diarias; los agentes deberían preferirlas a recalcular.

- _Ej._ `daily_metrics` — signups, activaciones y pagos por día.

## Métricas canónicas (SQL)

> **Estas queries son EJEMPLOS** sobre las tablas ficticias de arriba. Reemplázalas por las tuyas y valídalas contra la base antes de que un agente las use.

### Revenue últimos 30 días, por moneda
```sql
-- EJEMPLO: adapta a tu schema
select lower(currency) as currency, sum(amount_cents) / 100.0 as revenue, count(*) as n
from payments
where status = 'succeeded' and amount_cents > 0
  and created_at >= now() - interval '30 days'
group by 1;
```

### Conversión free → paid por cohorte mensual de signup
```sql
-- EJEMPLO: adapta a tu schema
select date_trunc('month', u.created_at) as cohort,
       count(*) as signups,
       count(distinct p.user_id) as payers,
       round(100.0 * count(distinct p.user_id) / nullif(count(*), 0), 2) as pct
from users u
left join payments p on p.user_id = u.id and p.status = 'succeeded'
where not u.is_internal
group by 1 order by 1;
```

### Funnel drop-off (últimos 28 días)
```sql
-- EJEMPLO: adapta a tu schema
select event_type, count(distinct user_id) as users
from events
where created_at >= now() - interval '28 days'
  and event_type in ('quote_sent', 'checkout_viewed', 'checkout_started')
group by 1;
```

_Otras métricas a documentar según tu negocio_: ARPU, tasa de recompra/renovación, tiempo a primera compra, CAC por canal (requiere tabla de gasto en ads).

## Convenciones

- Fechas `YYYY-MM-DD` en parámetros externos.
- Nunca `SELECT *`: explicitar columnas.
- Siempre excluir cuentas internas/test.
- Un % siempre con su n.
- Las skills de data son **READ-ONLY**. Cualquier write se hace con migraciones/scripts versionados en el repo del producto, nunca improvisado por un agente.

## Reglas de seguridad

- Los agentes nunca tienen permisos de escritura sobre la base.
- Solo agregados (counts, sums, tasas). Nada de PII individual (emails, nombres, contenido de usuarios) hacia el repo de agentes, las colas o Linear.
- Preferir un token con scope read-only en vez de la clave de servicio cruda.
