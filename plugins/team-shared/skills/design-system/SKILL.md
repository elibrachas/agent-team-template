---
name: design-system
description: Use when proposing, designing, implementing, or reviewing UI changes in the active project — loads the project's design system (tokens, typography, component inventory, a11y guidelines and where each lives in the product repo, documented in projects/<slug>/design-system.md) plus universal UI principles. Load BEFORE any UI work — Daly always, Pico when proposing UI, Cody when implementing UI.
hitl_level: 1
owner: owner
---

# Design System

> Referencia para Daly 🎨 (siempre), Pico 🎯 (cuando una propuesta toca UI) y Cody 💻 (cuando implementa UI). Skill genérica: los tokens y componentes reales del producto los documenta `projects/<slug>/design-system.md` y viven en el repo del producto (`productRepoPath` de `project.json`). Si tu turno toca píxeles, carga esto antes de pensar.

## 1. Qué cargar

1. `projects/<slug>/design-system.md` — dónde viven los tokens, el catálogo de componentes, las guías de a11y y los patrones del producto.
2. Los **archivos reales** que ese documento señala en el repo del producto (hoja de estilos con las CSS variables, carpeta de componentes, guía de interfaz). El código manda sobre el documento: si difieren, usa el código y señala la diferencia.
3. La skill `brand-voice` antes de escribir cualquier copy del mockup.

Si el proyecto no tiene `design-system.md`, léelo directo del repo (estilos globales + componentes base) y dilo en tu entrega.

## 2. Principios universales (lo que NO se rompe, en cualquier proyecto)

### A11y
- **Foco visible** en todo lo interactivo. Nunca `outline: none` sin reemplazo.
- **Icon-only buttons** con `aria-label`; iconos decorativos con `aria-hidden="true"`.
- **Form controls** con `<label>` o `aria-label`. Errores inline junto al campo; foco al primer error en submit.
- **Imágenes** con `alt` (o `alt=""` si son decorativas) y `width`/`height` explícitos (evita CLS).
- **Semántica primero**: `<button>` para acciones, `<a>` para navegación, tablas reales; ARIA solo cuando HTML no alcanza.
- **Headings jerárquicos** sin saltar niveles. Skip link al contenido principal si hay nav.
- **Animación**: respetar `prefers-reduced-motion`. Animar solo `transform`/`opacity`. Nunca `transition: all`.

### Tipografía
- `…` (ellipsis real), no `...`. Los loading states terminan en `…` ("Cargando…").
- Espacio no separable en unidades (`10&nbsp;MB`).
- `tabular-nums` en columnas numéricas; `text-wrap: balance` en headings.

### Forms
- `autocomplete`, `name`, `type` e `inputmode` correctos. Nunca bloquear el pegado.
- Submit habilitado hasta que arranca el request; indicador de progreso durante.

### Mobile-first y estados
- Si el tráfico del proyecto es mayoritariamente mobile (ver `data-model.md` / GA4), mockupea primero a ~390px.
- Cada pantalla tiene **loading**, **empty**, **error** y **success**. Si tu mockup no los muestra, declara la deuda en el brief.

## 3. Cuándo apartarte del sistema (y cómo)

1. **Dilo explícitamente en el `brief.md`** — sección "Tokens nuevos propuestos" o "Componente nuevo propuesto".
2. **Propón el cambio al sistema** — qué token nuevo, qué valor, dónde encaja.
3. **No mockupees con un token que no está aprobado** — usa lo que existe y deja la propuesta como nota.

Si violas una regla a propósito (p. ej. una animación pesada de marketing), decláralo en el "A11y check" del brief.

## 4. Workflow por agente

- **Daly (siempre)**: carga esta skill al inicio de cada invocación. Replica los tokens reales en el `<style>` del mockup.
- **Pico (cuando propones UI)**: cárgala antes de redactar la propuesta. Si amerita un mockup concreto, invoca a Daly (`Daly: mockupea lo que propongo en ACM-X`).
- **Cody (cuando implementas UI)**: cárgala ANTES de editar. Usa los tokens y componentes existentes antes de crear nuevos. Si existe `design/<slug>/<IssueId>-<slug>/brief.md` en el repo de agentes, ese es tu spec — léelo primero.
