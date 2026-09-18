# Glosario interno — Acme (EJEMPLO)

> **Acme es un SaaS de ejemplo; reemplaza todo.** Definiciones canónicas del proyecto. Lo carga la skill `glossary` y todo agente que reporte métricas (Numa, Greta, Pico, Capi). Regla: **si una métrica o término no está acá, agrégalo antes de exponerlo en un output.** Cada definición tiene que decir de dónde sale el dato (tabla/evento en `data-model.md`).

## Productos y surfaces

_Guía_: nombre canónico de cada producto, plan, feature y página clave, con su ruta. Evita que los agentes inventen nombres.

| Término | Qué es | Dónde vive |
|---------|--------|------------|
| _Editor de presupuestos_ | Feature principal: arma un presupuesto desde el catálogo | `/app/quotes/new` |
| _Plan Free_ | Hasta N presupuestos por mes | `/pricing` |
| _Plan Pro_ | Presupuestos ilimitados + marca propia | `/pricing` |

## Métricas core

_Guía_: numerador, denominador, ventana y filtros exactos.

| Métrica | Definición | Fuente |
|---------|------------|--------|
| _Signups_ | Cuentas creadas en el período (excluye cuentas internas/test) | `users.created_at` |
| _Activación_ | % de signups que envían su primer presupuesto dentro de 7 días | `events` (`quote_sent`) |
| _Conversión free→paid_ | % de una cohorte de signup que paga al menos una vez (siempre con n) | `payments` |
| _MRR_ | Suma de suscripciones activas normalizadas a mes, por moneda | `subscriptions` |

## Canales de adquisición

_Guía_: buckets canónicos y la regla con la que se derivan (UTM, referrer, click id). Aclara desde cuándo existe la atribución (forward-only) y sus puntos ciegos.

- _Ej._ `organic_search`, `paid_search`, `ai_assistant`, `referral`, `direct`, `email`.

## Funnel comercial

_Guía_: etapas en orden con el evento/campo que marca cada una. `funnel-monitor` y `signup-to-paid-tracker` usan exactamente esta lista.

1. _signup_ → 2. _activación_ (primer presupuesto enviado) → 3. _checkout visto_ → 4. _checkout iniciado_ → 5. _compra_ → 6. _recompra/renovación_

## Estados de pago

_Guía_: qué estados existen y cuáles cuentan como venta. _Ej._ `succeeded` cuenta; `pending`, `failed`, `refunded` no.

## Segmentos de usuario

_Guía_: _ej._ free, pagador, pagador recurrente, churned, cuenta interna (excluir siempre).

## Convenciones internas

- _Ej._ Zona horaria de reporte: UTC. Monedas siempre por separado, nunca sumadas.
- _Ej._ Un porcentaje siempre va con su n al lado: "3,1% (n=12)".
- _Ej._ Issues de agentes en Linear: team ACM, ver convención en `memory/CLAUDE.md`.
