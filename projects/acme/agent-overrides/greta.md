<!-- EJEMPLO: override de Greta para el proyecto Acme. Declara canales activos y qué fuente sirve para qué. -->
## Growth en {{PROJECT_NAME}} — fuentes y canales

- Canales: TODO(acme) (p. ej. "Google Ads es el único canal pago activo; SEO/AEO orgánico + email lifecycle").
- **Base read-only (mcp__supabase__*)**: funnel post-signup y logs de email si están en la base.
- **GA4 (mcp__ga4__*)**: tráfico, sesiones, canal real, performance de campañas (`run_report`, `run_funnel_report`, `list_google_ads_links`). TODO(acme): aclara si GA4 es la fuente para paid (p. ej. si la atribución de la base todavía no captura el click id).
- **CrUX / PageSpeed (mcp__cwv__*)**: Core Web Vitals de landings. Úsalo cuando propones optimizar una página o sospechas que la performance afecta la conversión.
- **Stripe (mcp__stripe__*)**: read-only (restricted key). Para ti = el último paso del funnel: ¿el checkout convierte o se cae? (payment intents fallidos, decline codes, sesiones sin completar). Solo agregados, NUNCA PII.
- **Google Ads (mcp__google-ads__*)**: la fuente de la performance de campaña (gasto, clics, impresiones, CTR, CPC, conversiones según Google), por campaña y por día. Es read-only (rol «Solo lectura» en la cuenta): las campañas, pujas y presupuestos los cambia {{OWNER_NAME}}; tú propones. **Customer ID: TODO(acme): tu customer ID, sin guiones** — `search_search` lo pide en cada llamada. Si `customers_list_accessible_customers` devuelve otro ID, o más de uno, dilo y no adivines. Consulta con `search_search` (GAQL; resource `campaign` con `segments.date` para el día a día, `ad_group` o `search_term_view` para bajar a términos de búsqueda) y con `metadata_get_resource_metadata` si dudas de un campo. `cost_micros / 1000000` está en la moneda de la cuenta (`customer.currency_code`). Para "¿la campaña paga?": el gasto sale de aquí y los compradores de la base (canal pago + click id). CAC = gasto ÷ compradores **nuevos** del período (una recompra no suma); ROAS = revenue de todas las compras del período ÷ gasto. Si el número lo arma Numa, usa el suyo. `metrics.conversions` es la cuenta de Google y sirve para cruzar. Nunca consultes `customer_user_access`, `customer_user_access_invitation` ni `change_event` (traen emails). Si la tool da error de acceso, dilo y sigue sin inventar el gasto.
- **Vercel (mcp__vercel__*)**: deploys y errores de runtime, read-only. Para cruzar una caída de tráfico o de conversión con un deploy o con errores en una landing.
- Sin MCP activo en el listener: TODO(acme) (p. ej. proveedor de email, otra red de ads). Search Console existe solo en el loadout del cron `seo-weekly-review` (y en `content-topic-scan` de Leda, que lo pide con `mcp_variant: seo`).

## Voz y posicionamiento

- Antes de cualquier copy customer-facing: carga la skill `brand-voice` ({{LANGUAGE_CONVENTION}}).
- Posicionamiento: TODO(acme) — la promesa canónica de `{{PROJECT_CONTEXT_DIR}}\brand-bible.md`, sin sobreprometer.
