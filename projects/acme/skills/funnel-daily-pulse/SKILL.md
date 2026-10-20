---
name: funnel-daily-pulse
description: Use when sending the project's short DAILY funnel pulse to Discord — Numa reads the last 24 h (signups, activations, payments, traffic and the key funnel events) against the prior 7-day daily average and returns ONE compact Discord message (≤1800 chars). Read-only, no Linear issue; the weekly/4-hourly funnel skills keep the full analysis.
hitl_level: 1
owner: owner
agent: numa
schedule: "30 8 * * *"   # todos los días 08:30 (hora del server). Cron: automation/n8n/numa-daily-pulse.json (run-skill.ps1 -DiscordWebhookVar DISCORD_WEBHOOK_NUMA)
inputs:
  - "supabase (read-only) — la base del producto: signups, activaciones, pagos y eventos del funnel según projects/<slug>/data-model.md. Fuente PRINCIPAL (si la base es MySQL, mcp__mysql__*)"
  - "stripe (mcp__stripe__*) — cobros y suscripciones nuevas (si la cuenta es compartida con otro negocio, filtra por los productos de este)"
  - "ga4 (mcp__ga4__*) — sesiones y eventos clave del funnel del día anterior"
  - "projects/<slug>/data-model.md (queries canónicas, exclusiones) + glossary.md (definiciones)"
outputs:
  - "Discord: UN mensaje (lo postea scripts/run-skill.ps1 -DiscordWebhookVar DISCORD_WEBHOOK_NUMA) — tu respuesta final ES ese mensaje"
  - "queue/pending-review/YYYY-MM-DD-<slug>-funnel-daily-pulse.md (espejo; lo escribe el wrapper)"
cost_budget_usd: 1
---

# funnel-daily-pulse (Numa 📊, todos los días)

> **HITL 1 — read-only.** Un pulso de 20 segundos de lectura en el celular: qué pasó en las
> últimas 24 h del funnel y si algo se salió de lo normal. **No es el análisis**: eso es
> `signup-to-paid-tracker` / `funnel-monitor`. Aquí no hay interpretación larga ni propuestas.
> Corre vía `scripts/run-skill.ps1 -Skill funnel-daily-pulse -Project <slug> -DiscordWebhookVar DISCORD_WEBHOOK_NUMA`.
> **No creas issues en Linear.** Tu respuesta final es el mensaje de Discord, tal cual.

## Ventanas

La fecha y el día de la semana de la corrida te los pasa el wrapper en el prompt: úsalos para el
encabezado, no los calcules.

- **Hoy** = las últimas 24 h hasta el momento de la corrida (`created_at >= now() - interval '1 day'`).
- **Base** = promedio DIARIO de los 7 días anteriores a esa ventana
  (`created_at >= now() - interval '8 days' and created_at < now() - interval '1 day'`, dividido 7).
  Con volúmenes chicos el promedio suele ser < 1: muéstralo con un decimal y **siempre con el número
  crudo al lado**. Nunca porcentajes de variación sobre bases chicas.
- GA4: "ayer" completo (`yesterday`) vs promedio de los 7 días previos (`8daysAgo`..`2daysAgo`).

## Qué mides (y de dónde) — aplica SIEMPRE las exclusiones de `data-model.md`

TODO(acme): ajusta la lista a las etapas de tu funnel (`glossary.md`). Ejemplo para Acme:

1. **Registros** (base): cuentas nuevas sin las internas/test.
2. **Activación** (base): cuentas que hicieron la acción de activación (p. ej. enviar su primer
   presupuesto) en la ventana.
3. **Pagos** — base: pagos exitosos con monto > 0 en la ventana, por moneda. Stripe: cobros
   exitosos y suscripciones nuevas **solo de los productos del proyecto**. Monto con el `n`. Si base
   y Stripe no coinciden, muestra los dos (no los promedies).
4. **Tráfico** (GA4, ayer): sesiones de la propiedad y los 1-2 eventos clave del funnel.
5. **Canal**: si la atribución lo permite, cuántos de los registros llegaron por un canal pago (con
   click id). Si es 0, no lo muestres.

Todas las queries son de LECTURA, con columnas nombradas y agregados (nunca `SELECT *` ni columnas
de PII; si la base es MySQL, un `SELECT command denied` es un permiso por columna a propósito: no
reintentes con variantes).

## Cuándo marcar algo (máximo 2 líneas de alertas)

**Solo cosas de la VENTANA de 24 h** (o una fuente caída ahora). Una discrepancia histórica (p. ej.
un cobro viejo en Stripe sin match en la base) NO va al pulso: se repetiría todos los días. Es
material del análisis semanal; menciónala, si quieres, en tus notas de trabajo fuera de las marcas
`<discord>`, nunca dentro del mensaje.

- 🎉 **Primer X**: primer pago de un plan, primer registro por un canal nuevo — vale la pena celebrarlo.
- ⚠️ **Fuera de rango**: un valor de hoy ≥ 3× la base (con base ≥ 1) o 0 cuando la base es ≥ 2.
- ⚠️ **Tracking roto**: GA4 con 0 sesiones, o eventos en la base pero 0 del evento equivalente en GA4.
- 🔴 **Fuente caída**: si la base no responde es un incidente → una línea con qué revisar. Si Stripe
  o GA4 fallan, lo mismo con su nombre. Los números de esa fuente van como `—`.

Si no hay nada que marcar, no agregues la sección: un día tranquilo es un mensaje corto.

## Formato del mensaje (Discord markdown — cópialo, complétalo, borra lo que no aplique)

Tu respuesta final lleva el mensaje entre una línea `<discord>` y una línea `</discord>`, cada marca
sola en su línea: el wrapper postea SOLO eso (y si repites las marcas en una oración, toma el último
bloque). Tus notas de trabajo (resumen de datos, dudas) pueden ir antes, afuera de las marcas:
quedan en el espejo de `queue/`, no en Discord.

```
<discord>
**📊 <nombre del producto> · pulso diario** — <día dd-mmm> · últimas 24 h (prom. 7 d)
• Registros: **<n>** · activados: **<n>**  (<b> · <b>)
• Pagos: **<n>** · <moneda> <monto>  (<b>)
• Visitas: **<n>** sesiones (<b>) · <evento clave>: <n>
⚠️ <alerta, si hay>
-# Fuentes: base ✅ · Stripe ✅ · GA4 ✅ — Numa 📊
</discord>
```

Reglas del mensaje:
- **≤ 1200 caracteres idealmente, 1800 como tope duro** (el wrapper recorta lo que pase de ~2000).
  Sin tablas (Discord no las renderiza), sin títulos `#`, sin links largos.
- Números en crudo + base entre paréntesis. Sin porcentajes de variación.
- **Nunca PII**: nada de emails, nombres, dominios de clientes ni últimos 4 de tarjetas.
- Idioma interno del equipo (es para el owner, no customer-facing).
- La línea `-# Fuentes:` es obligatoria (Discord la muestra chiquita) y declara ✅ / ⛔ por fuente.
- No pongas menciones (`@everyone`, `@here`): el wrapper las anula igual.
