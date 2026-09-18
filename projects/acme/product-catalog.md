# Product Catalog — Acme (EJEMPLO)

> **Acme es un SaaS de ejemplo; reemplaza todo.** Catálogo operativo de productos, planes y precios. Lo leen Growth (ads, SEO, contenido, landings), Data (margen, ARPU, conversión) y PM (propuestas).
>
> **Fuente de verdad del pricing**: el repo del producto (indica aquí los archivos exactos, p. ej. `lib/plans.ts` y la página `/pricing`). Si este documento y el repo divergen, gana el repo.

## 1. Planes

_Guía_: una subsección por plan/producto con precio por moneda, límites, qué incluye y cómo se cobra (suscripción, créditos, pago único).

### Free
- _Ej._ Hasta 5 presupuestos por mes, con marca de agua de Acme.

### Pro
- _Ej._ USD 12/mes o USD 120/año. Presupuestos ilimitados, marca propia, seguimiento de aceptación.

### Consumo / límites por flujo (si aplica)
_Guía_: si el producto cobra por uso (créditos, llamadas de IA), tabla de cuánto consume cada flujo.

### Cómo se comunica al cliente
_Guía_: el nombre y la forma exacta de presentar los precios (con impuestos o sin, moneda local, etc.).

### Margen (cost-side)
_Guía_: costo variable por unidad (IA, storage, pasarela) para que Data pueda calcular margen. Marca como estimación si no está medido.

## 2. Productos discontinuados

_Guía_: lista de lo que ya no se vende, con la regla para los agentes (p. ej. "no proponer ni escribir copy sobre X").

- _Ninguno en el ejemplo._

## 3. Política de pricing

- Quién aprueba cambios de precio: _el owner_.
- Frecuencia de revisión: TODO(acme).
- Descuentos / cupones: TODO(acme).
- Reembolsos: TODO(acme) (enlaza a la página legal).

## 4. Surfaces de discovery y checkout

| Surface | Tipo | URL |
|---------|------|-----|
| Pricing público | Página de precios | `https://acme.example/pricing` |
| Checkout | Selector de pago | `https://acme.example/checkout` |
| Retorno | Éxito / error | `/checkout/success`, `/checkout/error` |

## 5. Variables de configuración relevantes

_Guía_: variables de entorno o constantes del producto que definen precios o límites (sin valores secretos), para que Data sepa qué representa cada cosa.

| Variable | Significado |
|----------|-------------|
| `PRICE_PRO_MONTHLY` | _Ej._ id del precio mensual del plan Pro en la pasarela |
| `FREE_QUOTES_LIMIT` | _Ej._ límite mensual del plan Free |
