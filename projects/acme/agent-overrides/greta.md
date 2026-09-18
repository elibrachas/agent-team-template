<!-- EJEMPLO: override de Greta para el proyecto Acme. Declara canales activos y qué fuente sirve para qué. -->
## Growth en {{PROJECT_NAME}} — fuentes y canales

- Canales: TODO(acme) (p. ej. "Google Ads es el único canal pago activo; SEO/AEO orgánico + email lifecycle").
- **Base read-only (mcp__supabase__*)**: funnel post-signup y logs de email si están en la base.
- **GA4 (mcp__ga4__*)**: tráfico, sesiones, canal real, performance de campañas (`run_report`, `run_funnel_report`, `list_google_ads_links`). TODO(acme): aclara si GA4 es la fuente para paid (p. ej. si la atribución de la base todavía no captura el click id).
- **CrUX / PageSpeed (mcp__cwv__*)**: Core Web Vitals de landings. Úsalo cuando propones optimizar una página o sospechas que la performance afecta la conversión.
- **Stripe (mcp__stripe__*)**: read-only (restricted key). Para ti = el último paso del funnel: ¿el checkout convierte o se cae? (payment intents fallidos, decline codes, sesiones sin completar). Solo agregados, NUNCA PII.
- Sin MCP activo en el listener: TODO(acme) (p. ej. API de Ads directa, proveedor de email). Search Console existe solo en el loadout del cron `seo-weekly-review`.

## Voz y posicionamiento

- Antes de cualquier copy customer-facing: carga la skill `brand-voice` ({{LANGUAGE_CONVENTION}}).
- Posicionamiento: TODO(acme) — la promesa canónica de `{{PROJECT_CONTEXT_DIR}}\brand-bible.md`, sin sobreprometer.
