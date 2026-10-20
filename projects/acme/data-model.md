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
- `first_touch_gclid`, `last_touch_gclid` (o el click id de tu red de ads): lo que prueba que el usuario vino de **un anuncio**. Ojo: un canal `google` (o `paid_search`) no siempre es pago — la función que deriva el canal suele devolver lo mismo para un `utm_source` manual sin click id. Para métricas de canal pago (CAC, ROAS), exige el click id.
- _Guía_: documenta dónde vive la derivación del canal en el repo del producto (una función pura, única fuente del mapeo: ninguna skill lo reimplementa) y verifica contra la base, con fecha, que el click id efectivamente se captura en las landings de ads. Si nunca lo verificaste, dilo aquí: el canal pago no es confiable hasta entonces.

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

### CAC por canal

**Gasto**: se lee en vivo del MCP read-only de Google Ads (`mcp__google-ads__*`, solo Numa y Greta; ver `docs/google-ads-readonly-source.md`), no de la base. Alcanza para un análisis puntual con los compradores del canal pago de la base: canal pago **y click id** (`last_touch_gclid is not null` para last-touch; `first_touch_gclid` para first-touch). Con las reglas de revenue de arriba:

- **CAC** = gasto ÷ compradores **nuevos** del período (usuarios distintos cuya primera compra pagada cae en el período; una recompra no suma, si no el CAC sale más bajo de lo que es).
- **ROAS** = revenue de todas las compras del período ÷ gasto.
- El gasto viene en `cost_micros` y en la moneda de la cuenta de Google Ads: no lo sumes con revenue de otra moneda sin un tipo de cambio declarado.

**Lo que falta para tenerlo en SQL** (opcional): una tabla diaria de gasto en la base del producto, para joinear y tener historia sin depender de la API. Forma sugerida:

```sql
-- PROPUESTA: no existe hasta que la construyas. Que ningún agente la consulte antes.
create table ads_spend (
  date          date        not null,  -- día en la zona horaria de la cuenta de Google Ads
  channel       text        not null,  -- mismo valor que la función que deriva el canal
  account_id    text        not null,  -- customer ID sin guiones
  campaign_id   text        not null,
  campaign_name text        not null,
  currency      text        not null,  -- lower(customer.currency_code)
  spend_cents   bigint      not null,  -- round(cost_micros / 10000): centavos, como amount_cents
  clicks        integer     not null,
  impressions   integer     not null,
  platform_conversions numeric,        -- lo que Google se atribuye; NO es la compra
  synced_at     timestamptz not null default now(),
  primary key (date, channel, campaign_id)
);
```

La carga sería un job diario del producto que lee la API con la misma service account y hace upsert de los últimos 7 días en cada corrida (Google recalcula las conversiones recientes). Solo service role; sin lectura pública.

_Otras métricas a documentar según tu negocio_: ARPU, tasa de recompra/renovación, tiempo a primera compra.

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
