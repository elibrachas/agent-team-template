# Design System — Acme (EJEMPLO)

> **Acme es un SaaS de ejemplo; reemplaza todo.** Mapa del design system del producto: qué hay y **dónde vive en el repo del producto**. Lo carga la skill `team-shared/skills/design-system` (Daly siempre, Pico al proponer UI, Cody al implementar UI). Este documento apunta a los archivos reales; si difiere del código, gana el código.

## 1. Fuentes canónicas

| Qué | Path en el repo del producto | Nota |
|-----|------------------------------|------|
| Tokens (CSS variables, light/dark) | _ej._ `styles/globals.css` | Daly los replica EXACTOS en el `<style>` del mockup |
| Config de componentes | _ej._ `components.json` | librería y estilo (p. ej. shadcn/ui) |
| Componentes base | _ej._ `components/ui/` | reusar antes de crear |
| Componentes de marketing | _ej._ `components/marketing/` | CTAs, heros, etc. |
| Guía de interfaz / a11y | _ej._ `docs/design-guidelines.md` | la "biblia" de UX-correctness |

## 2. Tokens

_Guía_: lista los tokens con su nombre (no hace falta copiar los valores si viven en el repo): colores semánticos (`--background`, `--foreground`, `--primary`, `--muted`, `--destructive`, `--ring`…), radius, tipografías (familia + fallback), escala de espaciado, set de iconos.

## 3. Componentes disponibles

_Guía_: inventario corto de los componentes base (Button, Card, Input, Dialog…) y sus variantes. Marca los que tienen reglas de uso especiales.

## 4. Patrones del producto

_Guía_: cómo se hacen las cosas aquí — botón primario, input con label, card, empty state, loading state. Un snippet corto por patrón si ayuda.

_Ejemplo_: "El CTA inline del blog ya existe como componente (`components/marketing/<cta>.tsx`); reusarlo, nunca crear una card nueva a mano."

## 5. Particularidades del proyecto

- _Ej._ Tráfico mayoritariamente mobile → mockups mobile-first (~390px).
- _Ej._ Dark mode obligatorio en toda pantalla nueva.
- Copy: respetar `project.json → languageConvention` (ver skill `brand-voice`).
