---
name: design-system
description: Use when proposing, designing, implementing, or reviewing UI changes in the active project — loads the project's design system (tokens, typography, component inventory, a11y guidelines and where each lives in the product repo, documented in projects/<slug>/design-system.md) plus universal UI principles. Load BEFORE any UI work — Daly always, Pico when proposing UI, Cody when implementing UI.
hitl_level: 1
owner: owner
---

# Design System

> Referencia para Daly 🎨 (siempre), Pico 🎯 (cuando una propuesta toca UI) y Cody 💻 (cuando implementa UI). Skill genérica: los tokens y componentes reales del producto los documenta `projects/<slug>/design-system.md` y viven en el repo del producto (`productRepoPath` de `project.json`). Si tu turno toca píxeles, carga esto antes de pensar.

## 1. Qué cargar

1. `projects/<slug>/design-system.md` — dónde viven los tokens, el catálogo de componentes, las guías de a11y y los patrones del producto. Si declara las **reglas de dirección** del sistema (las 3-5 que mandan, p. ej. "una sola acción primaria por pantalla", "el color de acento nunca va como texto"), internalízalas antes de cualquier píxel.
2. Los **archivos reales** que ese documento señala en el repo del producto: la **fuente de verdad de los tokens** (p. ej. un `tokens.ts` del que se genera el CSS, o la hoja de estilos con las CSS variables), la carpeta de componentes y la guía de interfaz. El código manda sobre el documento: si difieren, usa el código y señala la diferencia. Si tu memoria o un doc viejo nombra un archivo de tokens que ya no existe en el repo (un rediseño puede borrarlo), está desactualizado: búscalo en el repo y avisa para que se corrija el `design-system.md`.
3. Si el producto tiene un **catálogo vivo** (una página que muestra tokens y componentes con datos reales) o puedes navegar el sitio con Playwright, úsalo: lo que se renderiza es la fuente de verdad final. Toma screenshots cuando dudes.
4. La skill `brand-voice` antes de escribir cualquier copy del mockup.

Si el proyecto no tiene `design-system.md`, léelo directo del repo (estilos globales + componentes base) y dilo en tu entrega.

## 2. Principios universales (lo que NO se rompe, en cualquier proyecto)

### A11y
- **Foco visible** en todo lo interactivo. Nunca `outline: none` sin reemplazo.
- **Icon-only buttons** con `aria-label`; iconos decorativos con `aria-hidden="true"`.
- **Form controls** con `<label>` o `aria-label`. Errores inline junto al campo; foco al primer error en submit.
- **Imágenes** con `alt` (o `alt=""` si son decorativas) y `width`/`height` explícitos (evita CLS).
- **Semántica primero**: `<button>` para acciones, `<a>` para navegación, tablas reales; ARIA solo cuando HTML no alcanza.
- **Headings jerárquicos** sin saltar niveles. Skip link al contenido principal si hay nav.
- **Enlaces dentro de párrafos**: siempre subrayados (el color solo no los distingue → axe `link-in-text-block`).
- **Contraste**: todo par texto/fondo cumple AA. Un color de acento que no llega a 3:1 sobre el fondo nunca va como texto, ni como línea o barra de un gráfico. Si el proyecto tiene una lista de pares de contraste testeados, un par nuevo entra ahí.
- **Touch**: `touch-action: manipulation` en lo interactivo.
- **Animación**: respetar `prefers-reduced-motion`. Animar solo `transform`/`opacity`. Nunca `transition: all`.

### Jerarquía de acciones
- **Una sola acción primaria por pantalla** (el CTA con el color de acción del sistema). Todo lo demás es secundario, outline o ghost. Verifica el contraste del texto sobre el color de acción: no asumas que el texto blanco pasa AA.
- Usa los **tokens por rol** del sistema (fondo, superficie, texto, acción, error…), no hex sueltos. Si el proyecto tiene un check de tokens (un script que cuenta los hex fuera del sistema), respétalo: frena el deploy.

### Tipografía
- `…` (ellipsis real), no `...`. Comillas tipográficas, no rectas. Los loading states terminan en `…` ("Cargando…").
- Espacio no separable en unidades (`10&nbsp;MB`).
- `tabular-nums` en columnas numéricas; `text-wrap: balance` en headings.

### Forms
- `autocomplete`, `name`, `type` e `inputmode` correctos. Nunca bloquear el pegado. Placeholders con un ejemplo y `…`. Spellcheck off en emails y códigos.
- Submit habilitado hasta que arranca el request; indicador de progreso durante.

### Iconos en el mockup
- En el mockup HTML, embebe los SVG inline (de la librería de iconos del producto, p. ej. lucide). **No** uses clases que requieren JS (`<i class="…">`): el mockup tiene que abrir con doble clic.

### Mobile-first y estados
- Si el tráfico del proyecto es mayoritariamente mobile (ver `data-model.md` / GA4), mockupea primero a ~390px. Revisa 320/360/390 px: un `truncate` puede empujar el `min-content` y desbordar.
- Cada pantalla tiene **loading**, **empty**, **error** y **success**. Si tu mockup no los muestra, declara la deuda en el brief.

## 3. Cuándo apartarte del sistema (y cómo)

1. **Dilo explícitamente en el `brief.md`** — sección "Tokens nuevos propuestos" o "Componente nuevo propuesto".
2. **Propón el cambio al sistema** — qué token o rol nuevo, qué valor, dónde encaja (en la fuente de verdad de los tokens, no en el CSS generado), y que pase AA.
3. **No mockupees con un token que no está aprobado** — usa lo que existe y deja la propuesta como nota.

Si violas una regla a propósito (p. ej. una animación pesada de marketing), decláralo en el "A11y check" del brief.

## 4. Workflow por agente

- **Daly (siempre)**: carga esta skill al inicio de cada invocación. Replica los tokens reales (por rol, del tema que el producto emite hoy) en el `<style>` del mockup.
- **Pico (cuando propones UI)**: cárgala antes de redactar la propuesta. Si amerita un mockup concreto, invoca a Daly (`Daly: mockupea lo que propongo en ACM-X`).
- **Cody (cuando implementas UI)**: cárgala ANTES de editar. Usa los tokens por rol y los componentes existentes antes de crear nuevos; nunca hex sueltos. Si existe `design/<slug>/<IssueId>-<slug>/brief.md` en el repo de agentes, ese es tu spec — léelo primero.

## 5. Mantener vivo el `design-system.md` del proyecto

El documento del proyecto se desactualiza en cada rediseño. Que cierre con una sección **"Last reviewed"**: fecha de la última revisión, qué cambió de fondo (p. ej. "la fuente de verdad de los tokens pasó a `tokens.ts`") y cuándo toca la próxima (cuando cambien tokens o roles, entren componentes nuevos o se active un tema nuevo, como el modo oscuro). Cuando un agente detecta que el doc y el repo difieren, lo dice en su entrega para que se corrija.
