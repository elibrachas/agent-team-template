# `design/` — output de Daly 🎨

Carpeta de **mockups y design briefs** que genera Daly (UX/UI designer del equipo). Es el equivalente de `queue/` pero para diseño: cada vez que Daly diseña algo, deja una carpeta acá. Va **versionada en git** — la historia visual del producto vive en `git log design/`.

## Estructura

```
design/
├── README.md                          ← este archivo
├── acme/                              ← un directorio por proyecto (= slug de projects/<slug>/)
│   ├── ACM-23-onboarding-revamp/      ← mockup activo: pedido en curso, todavía no implementado
│   │   ├── brief.md                   ← directiva: contexto, decisiones, spec para Cody
│   │   ├── mockup.html                ← prototipo autocontenido (doble click lo abre en el browser)
│   │   ├── mockup-notes.md            ← anotaciones (qué token va dónde, a11y, etc.)
│   │   └── screenshots/               ← opcional: capturas before/after de Playwright
│   └── implemented/                   ← archivo: mockups ya implementados por Cody
│       └── ACM-12-empty-state/        ← (Cody los mueve acá al abrir su PR)
└── <otro-proyecto>/
```

**Convención de carpeta**: `<IssueId>-<slug-corto-kebab>`. Slug de ≤4 palabras, derivado del título del issue. Ej.: `ACM-23-onboarding-revamp`, `ACM-45-checkout-empty-state`.

## Ciclo de vida de un mockup

1. **Daly diseña** — invocas `Daly: ...` en un issue de Linear → Daly crea `design/<slug>/<IssueId>-<slug-corto>/` con `brief.md` + `mockup.html` + `mockup-notes.md`. Si el pedido amerita ticket dedicado, crea también un issue `[Design]` linkeando la carpeta.
2. **Tú revisas** — abres `mockup.html`, lees `brief.md` y decides: implementar / pedir iteración / descartar.
3. **Cody implementa** — invocas `Cody: implementa el design de ACM-X` → Cody lee la carpeta como spec, hace los cambios en el repo del producto y abre el PR.
4. **Cody archiva** — al abrir el PR con éxito, mueve `design/<slug>/<IssueId>-<slug-corto>/` → `design/<slug>/implemented/<IssueId>-<slug-corto>/`. **No commitea el repo de agentes**: el move queda como cambio sin commitear.
5. **Tú commiteas** — en tu próximo commit del repo de agentes incluyes el rename de Cody.

## Casos especiales

- **Mockup descartado**: bórralo o muévelo a `design/<slug>/discarded/<id>-<slug-corto>/`. Borrar es válido — git log preserva la historia.
- **Iteración** (Daly genera una v2): Daly sobrescribe los archivos en la misma carpeta. Si quieres conservar versiones, renombra a `<id>-<slug-corto>-v1/` antes de pedir la v2.
- **Mockup activo por mucho tiempo** (>30 días sin implementar): probablemente cambió el design system. Pídele a Daly un refresh antes de pasarlo a Cody.

## Formato del mockup HTML

- **Autocontenido**: abre con doble click en cualquier browser. Sin `npm install`, sin build, sin dev server.
- **Tokens reales**: replica las CSS variables del design system al inicio del `<style>`. Dónde viven en el repo del producto lo declara `projects/<slug>/design-system.md`.
- **Fuentes**: las del producto vía Google Fonts `@import`, con fallback a `system-ui`.
- **Iconos**: SVG inline del set que use el producto (p. ej. [lucide.dev](https://lucide.dev)). Nada que requiera JS.
- **Mobile-first**: viewport mobile (~390px) como base y media query para desktop. Si Daly solo hizo desktop, queda declarado en `brief.md` como deuda.
- **Estados**: si una pantalla tiene loading/empty/error/success, todos visibles en la misma página o con toggle `<details>`.

## Formato del brief.md

Estructura obligatoria (Daly la respeta):

```markdown
## Contexto
Qué pidió el owner, qué restricción hay, qué insight de data lo motivó.

## Principios aplicados
Qué reglas del design system y de la guía de interfaz guiaron las decisiones.

## Decisiones
Qué elegí y por qué — componentes usados, tokens aplicados, estados manejados.

## Alternativas descartadas
Qué consideré y por qué no.

## Spec para Cody
Exactamente qué archivos del producto tocar (paths reales) y qué cambiar.

## A11y check
Qué cumple (foco visible, contraste, semántica, mobile-first) y qué queda como deuda.

## Generado por
🤖 Daly 🎨 · YYYY-MM-DD · ACM-X
```

## Por qué `design/` vive en el repo de agentes y no en el del producto

- **Permisos contenidos**: Daly solo escribe en este repo, nunca en el del producto.
- **No ensucia el repo del producto** con artefactos que no son código.
- **Un mockup nuevo no dispara CI ni deploys.**
- **Versionado junto con el sistema de agentes** — `git log design/` cuenta la historia visual.
- **Multi-proyecto**: la estructura `design/<slug>/` soporta varios productos.

Cody (que corre con cwd en el repo de agentes pero edita el repo del producto vía `--add-dir`) lee los briefs desde acá, sin copiar archivos al producto. El PR de Cody linkea la carpeta en su body para trazabilidad.
