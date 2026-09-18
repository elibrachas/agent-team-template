# aeo-strategy.md — Plan de AEO del proyecto (vivo · 🤖 Greta 📈 + 💻 Cody)

> **Plan de AEO** (Answer Engine Optimization: aparecer/ser citado en respuestas de motores de IA — ChatGPT, Perplexity, Gemini, Google AI Overviews, Claude). **Complementario al SEO, no un reemplazo.** Es un documento **vivo**: mezcla la **estrategia estable** (§3 en adelante, la brújula) con una **sección viva** (§1-§2) que se actualiza cada semana.
>
> **Quién escribe qué (contrato de edición):**
> - **Greta** (cron AEO, jueves 04:00, hora del server) **reescribe la sección viva** (§1 "Estado y avances" + §2 "Próximos pasos") cada semana, reconciliándola contra el estado de los issues en Linear. **No toca las secciones de estrategia** (§3+) salvo para reflejar un giro real, y en ese caso lo avisa en el `[Report]`.
> - **Cody** (cuando implementa un issue con label `aeo`) **agrega UNA línea de avance** a §1 al abrir el PR (append, nada más — ver su override de proyecto). No reescribe el resto.
> - **El owner** edita lo que quiera, cuando quiera (es el dueño de la estrategia).
>
> **Corto a propósito.** La sección viva se poda: Greta mantiene ~12 avances recientes; lo viejo se resume o se borra. El detalle granular por-hallazgo vive en `aeo-memory.md` (el ledger anti-repetición), no aquí.
>
> **Plantilla**: las secciones de estrategia (§3+) traen un marco genérico de AEO; completa los `TODO(acme)` con lo específico del proyecto antes de la primera corrida. La sección viva arranca vacía.

---

## 0. TL;DR

- TODO(acme): 2-3 bullets con el estado del canal de asistentes IA y la apuesta AEO del proyecto (se completa tras la primera corrida).
- **SEO gana el clic en el SERP. AEO gana la cita en la respuesta de IA.** Mismo activo (el contenido público del proyecto), distinta superficie. Por eso AEO es **complementario**: muchas mejoras sirven a las dos, y donde sirven a las dos se proponen una sola vez.
- El trabajo AEO suele ser: **medir el canal**, **cerrar gaps baratos** (acceso de crawlers, `llms.txt`, schema) y **maximizar cobertura/extractabilidad/entidad**.

---

## 1. Estado y avances  ·  SECCIÓN VIVA (Greta reescribe / Cody appendea)

**Estado actual (YYYY-MM-DD):** _(sin corridas aún — Greta lo completa en su primera corrida real)._

**Avances / cerrado** — más reciente arriba; formato `- YYYY-MM-DD · ACM-X · <qué se hizo> (PR #NNN si aplica)`:

- _(sin avances aún — Greta y Cody agregan líneas aquí)_

**En vuelo / propuesto** (resumen; el detalle por-hallazgo está en `aeo-memory.md`):

- _(nada en vuelo aún — formato: `` `id-del-hallazgo` → **ACM-X** (status): una línea de contexto ``)_

---

## 2. Próximos pasos  ·  SECCIÓN VIVA (Greta la mantiene)

Prioridad para las próximas 2-4 semanas (Greta la re-prioriza cada semana según lo que traccione):

1. _(se completa en la primera corrida — lista numerada, lo más accionable arriba)_

---

## 3. Por qué AEO (y por qué es complementario a SEO)  ·  estrategia estable

El search se está partiendo en dos superficies:
1. **El SERP clásico** (Google/Bing) → lo trabaja `seo-weekly-review`: ranking, CTR, CWV, indexación.
2. **La respuesta sintetizada de un motor de IA** (ChatGPT, Perplexity, Gemini, AI Overviews) → lo trabaja este plan: que el proyecto aparezca **citado como fuente**, y que el dato citado sea correcto y lo posicione bien.

Cada vez más preguntas de la categoría se responden dentro del LLM, sin clic a un SERP. Si el proyecto no es la fuente citada, es invisible en esa conversación — por más que rankee #1 en Google.

**Complementariedad concreta:**
- **Activo compartido**: el mismo contenido que SEO optimiza para rankear es el que un LLM puede citar. No se duplica contenido; se trabaja la misma página para dos superficies.
- **Mejoras sinérgicas**: schema FAQPage/HowTo, contenido bien estructurado y SSR, claridad de entidad → suben rich results en el SERP (SEO) **y** la extractabilidad por el LLM (AEO). Se proponen una vez (ver §7).
- **Donde divergen**: SEO se ocupa de posición/CTR/CWV; AEO de acceso del crawler de IA, extractabilidad-para-LLM, autoridad/citation-worthiness y el canal AI Assistant. AEO **no** re-propone temas de ranking puro — los cede a SEO.

---

## 4. Restricción de voz y posicionamiento (no negociable)  ·  estrategia estable

- **Posicionamiento**: TODO(acme): cómo se posiciona el producto (p. ej. qué NO prometer). Fuente: `projects/<slug>/brand-bible.md`.
- **Idioma y registro**: TODO(acme): idioma(s) del sitio y registro (tuteo/voseo/usted) según `brand-bible.md`.
- Antes de cualquier copy (incl. el contenido de un `llms.txt`, respuestas FAQ nuevas): cargar `team-shared/skills/brand-voice`.

Importa en AEO porque los LLMs citan literal: si el copy promete de más, esa frase es la que se reproduce en la respuesta del motor.

---

## 5. Los 3 pilares de AEO  ·  estrategia estable

### Pilar A — Acceso del crawler (estar permitido)
El motor de IA no puede citar lo que no puede leer.
- **robots.txt**: los crawlers de IA (GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended, CCBot, Amazonbot) deben poder crawlear las rutas públicas. **Estado conocido**: TODO(acme).
- **`llms.txt` / `llms-full.txt`**: convención emergente (raíz del sitio) que le dice al LLM dónde está el contenido clave. **Estado conocido**: TODO(acme).

### Pilar B — Extractabilidad (ser citable)
- **SSR / contenido en el HTML inicial**: los crawlers de IA ejecutan JS peor que Googlebot. La respuesta tiene que estar en el HTML servido.
- **Estructura de respuesta**: definición concisa arriba, H2 en forma de pregunta, listas/tablas, pasos numerados (HowTo).
- **Schema estructurado**: FAQPage, HowTo, Article, Organization. El trabajo suele ser **cobertura/wiring** — qué ruta emite cada schema.
- **Claridad de entidad**: Organization/WebSite/sameAs consistentes para que el motor ligue el nombre del proyecto a su categoría.

### Pilar C — Autoridad / citation-worthiness (ser elegido)
- Densidad factual, frescura, originalidad (datos propios del producto), señales E-E-A-T.
- **Caveat de scope**: si la calidad del contenido la generan workflows u otros agentes, AEO **no regenera contenido** — audita, propone estructura/wiring/freshness, y cuando el gap es de calidad de fondo lo deriva.

---

## 6. Cómo medimos AEO (y los límites honestos)  ·  estrategia estable

| Capa | Métrica | Fuente | Límite |
|------|---------|--------|--------|
| **Lagging KPI** | Sesiones del canal "AI Assistant" (trend WoW/28d) + conversión downstream | GA4; conversión cruzada con la base | Atribución forward-only; n chico → reportar `n`, no solo `%` |
| **Leading indicator** | Checklist de readiness: `llms.txt`, % de rutas con schema, SSR/extractabilidad, entidad | Auditoría read-only del repo del producto | Proxy de "citabilidad", no de citas reales |
| **Pulso cualitativo** | ¿Aparecemos para las queries de alta intención? ¿Quién nos gana la cita? | **WebSearch** (built-in) | **WebSearch es PROXY** de la respuesta real — direccional, NO cuantificar "citation share" |

**Queries de probing (núcleo fijo)**: TODO(acme): 5-6 preguntas de alta intención de la categoría, en el idioma del sitio.

**El probing real** (consultar de verdad a los motores y leer su respuesta citada) necesita una API de answer-engine o un browser MCP. Está en el **backlog (v2)**; hasta entonces, el probing es el proxy de WebSearch, declarado como tal.

---

## 7. Complementariedad operativa con SEO (anti-duplicación)  ·  estrategia estable

- La reconciliación semanal de `aeo-weekly-review` lee **ambos** boards de Linear (labels `aeo` **y** `seo`) antes de proponer.
- **Mejora que sirve a las dos superficies**: si SEO ya la tiene como issue, **NO abrir uno nuevo** — comentar el existente con el rationale AEO y registrarlo en `aeo-memory.md` apuntando a ese issue.
- **AEO cede a SEO** en: posición/ranking, CTR del SERP, CWV, indexación. **AEO es dueña de**: acceso de crawler de IA, `llms.txt`, extractabilidad-para-LLM, cobertura de schema *para extracción*, entidad/autoridad para citación, y el canal AI Assistant.

---

## 8. Horizontes  ·  estrategia estable

- **Ahora**: instrumentar el canal, confirmar acceso de crawler, shippear `llms.txt`, ampliar cobertura FAQ/HowTo, auditar extractabilidad.
- **Próximo**: entidad/autoridad (Organization/sameAs, E-E-A-T); infra de probing real (API de answer-engine / browser MCP).
- **Después**: ángulos de contenido AEO dedicados — SOLO si el canal prueba que convierte, coordinado con quien genere el contenido, sin regenerar lo existente.

TODO(acme): pon fechas/trimestres concretos si te sirven.

---

## 9. Guardrails / no-goals  ·  estrategia estable

- **No regenerar contenido** — AEO audita/optimiza/estructura.
- **No spammear schema** ni meter FAQ falsas para gamear extracción.
- **No bloquear crawlers reflexivamente** — bloquear GPTBot "para proteger contenido" mata la citabilidad; si el owner lo quisiera, es una decisión de negocio explícita.
- **No sobre-invertir antes de que el canal pruebe conversión** — mientras el canal sea chico y sin conversiones, la apuesta es barata (schema wiring, entidad); el contenido AEO dedicado (caro) espera señal.
- **Honestidad de medición** — WebSearch es proxy; atribución forward-only y n chico. Reportar `n`, declarar el proxy, no inventar "citation share".
