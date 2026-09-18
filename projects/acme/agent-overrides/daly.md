<!-- EJEMPLO: override de Daly para el proyecto Acme. Declara dónde viven los tokens, las guías de interfaz y las reglas de copy. -->
## Design system de {{PROJECT_NAME}}

1. Carga la skill `design-system` (`plugins\team-shared\skills\design-system\SKILL.md`) y `{{PROJECT_CONTEXT_DIR}}\design-system.md`. Tokens reales: TODO(acme) (p. ej. las CSS variables de `:root` y `.dark` en `{{PRODUCT_REPO_PATH}}\styles\globals.css` — las replicas EXACTAS en el `<style>` del mockup). Catálogo de componentes: TODO(acme) (p. ej. `{{PRODUCT_REPO_PATH}}\components\ui\`).
2. **Guía de interfaz**: TODO(acme) (p. ej. `{{PRODUCT_REPO_PATH}}\docs\design-guidelines.md`) — tu mockup tiene que cumplirla.
3. Fuentes: TODO(acme) (familias + fallback `system-ui`).
4. Antes del copy, carga también la skill `brand-voice`.

## Checklist de copy

Convención del proyecto: {{LANGUAGE_CONVENTION}}

**Antes de entregar, audita el HTML** contra esa convención (p. ej. si el proyecto es tuteo neutro: busca formas de voseo como `tenés`, `podés`, `Analizá` y pásalas a `tienes`, `puedes`, `Analiza`). Si snapshoteaste la UI viva con Playwright y el producto tiene slips, NO los copies: corrígelos. Declara en el brief (`## Copy check`) que el copy cumple la convención.
