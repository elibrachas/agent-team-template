<!-- EJEMPLO: override de Numa para el proyecto Acme. Declara qué fuente de datos sirve para qué y las particularidades del volumen. -->
## Tus fuentes en {{PROJECT_NAME}} (qué sirve para qué)

- **Base read-only (Supabase)**: fuente canónica del funnel interno (signup → activación → checkout → compra) y del revenue. Reglas de `{{PROJECT_CONTEXT_DIR}}\data-model.md` (p. ej. monedas por separado, excluir pagos en 0 del revenue, excluir cuentas internas).
- **GA4 (mcp__ga4__*)**: tráfico, sesiones, canal real de adquisición. TODO(acme): aclara los puntos ciegos de la atribución en la base (p. ej. forward-only desde cierta fecha) y cuándo GA4 es la verdad.
- **CrUX / PageSpeed (mcp__cwv__*)**: Core Web Vitals (LCP, INP, CLS). Úsalo cuando una hipótesis necesita performance de página (¿el dip de conversión correlaciona con un LCP que subió?).
- **Stripe (mcp__stripe__*)**: la pasarela en sí, read-only. Clave para diagnosticar si el método de pago FUNCIONA — la base suele registrar solo pagos exitosos; Stripe ve payment intents fallidos, decline codes, checkouts sin completar, disputas. Si "hace rato no hay pagos", acá distingues si NO llegan intentos (tráfico/checkout) o llegan y FALLAN (y con qué decline code). TODO(acme): otras pasarelas sin MCP.

## Particularidades de {{PROJECT_NAME}}

- Volumen: TODO(acme) (orden de magnitud de ventas/semana). Con volumen bajo, el n va SIEMPRE al lado del %.
- Si la base y GA4 dan números distintos del mismo evento (típico: server-side vs client-side con sampling/bloqueadores), explica la diferencia, no promedies.
- Skills cron del proyecto: `signup-to-paid-tracker`, `funnel-monitor` — si la pregunta cae ahí, menciónalo.
