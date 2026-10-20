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

## 2. Semáforo por feature — léelo antes de escribir copy o proponer

_Guía_: lo que el sitio y el producto **realmente** ofrecen hoy, feature por feature. Es la tabla que lee cualquier agente que escribe copy (Leda, Greta) o propone (Pico) para no afirmar algo que no existe. Fuente: el repo del producto (las páginas públicas y el roadmap); si el sitio cambia, gana el sitio, y si una fila de aquí contradice lo que el agente ve en el código, lo avisa en su brief. Pon la fecha de la última actualización.

**Regla dura (cualquier agente que escriba copy):**
- 🟢 **Publicado**: se puede afirmar, con las palabras del sitio.
- 🟡 **Próximamente**: solo con la etiqueta literal que use el sitio (p. ej. "(coming soon)"), nunca en presente ni como argumento de compra.
- 🔴 **No existe**: no se escribe, no se insinúa, no se mide.
- **¿No está en la tabla o tienes dudas?** No lo afirmes. Si el texto lo necesita, sácalo del texto y anótalo como `[VERIFICAR] <qué y por qué>` en el issue y en el brief, para que el owner lo confirme. `[VERIFICAR]` nunca va en el cuerpo de una nota (las notas se publican solas).

| Feature | Semáforo | Qué se puede escribir |
|---|---|---|
| _Ej._ Plan Free (5 presupuestos por mes) y Pro | 🟢 | Lo de la página `/pricing`, con sus precios exactos |
| _Ej._ Dominio propio para los presupuestos | 🟡 | "(coming soon)" |
| _Ej._ Cobro por uso / facturación anual | 🔴 | Nada |
| TODO(acme) | | |

## 3. Productos discontinuados

_Guía_: lista de lo que ya no se vende, con la regla para los agentes (p. ej. "no proponer ni escribir copy sobre X"). Si un producto se retira, muévelo aquí con la fecha y deja sus datos solo como histórico: los agentes no lo proponen ni citan sus precios como vigentes.

- _Ninguno en el ejemplo._

## 4. Política de pricing

- Quién aprueba cambios de precio: _el owner_.
- Frecuencia de revisión: TODO(acme).
- Descuentos / cupones: TODO(acme).
- Reembolsos: TODO(acme) (enlaza a la página legal).

## 5. Surfaces de discovery y checkout

| Surface | Tipo | URL |
|---------|------|-----|
| Pricing público | Página de precios | `https://acme.example/pricing` |
| Checkout | Selector de pago | `https://acme.example/checkout` |
| Retorno | Éxito / error | `/checkout/success`, `/checkout/error` |

## 6. Variables de configuración relevantes

_Guía_: variables de entorno o constantes del producto que definen precios o límites (sin valores secretos), para que Data sepa qué representa cada cosa.

| Variable | Significado |
|----------|-------------|
| `PRICE_PRO_MONTHLY` | _Ej._ id del precio mensual del plan Pro en la pasarela |
| `FREE_QUOTES_LIMIT` | _Ej._ límite mensual del plan Free |
