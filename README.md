# agent-team-template

Template para correr un **equipo de agentes de Claude Code** que opera un producto de software: analizan datos, proponen mejoras, diseñan mockups, escriben código (vía PR), hacen QA, publican contenido y hasta **mejoran a los otros agentes**. Siempre con una persona en el medio de cada decisión que importa.

No es una app ni un framework: es un repo de **configuración versionada** (system prompts, skills, wrappers de PowerShell, configs de MCP y workflows de n8n) que Claude Code consume en dos entornos:

- **Server headless** (Windows): `claude -p` disparado por crons y webhooks de **n8n**.
- **Claude Code / Cowork desktop**: uso interactivo y revisión humana.

El repo trae un proyecto de ejemplo, **Acme** (`projects/acme`, team de Linear `ACM`), que puedes copiar como punto de partida para tu propio producto.

---

## Cómo funciona en 1 minuto

- Hay **9 agentes** con identidad propia (nombre, emoji, rol, modelo, herramientas). Su identidad es código: vive en [`scripts/agents.ps1`](scripts/agents.ps1).
- Los llamas **comentando en un issue de Linear** con `Nombre: pedido`:
  ```
  Numa: ¿cuánto convirtió ayer por canal?
  ```
  Un workflow de n8n recibe el webhook, detecta el nombre y corre el agente con `claude -p`. El agente responde en el mismo issue con un comentario firmado `🤖 Numa 📊: ...`.
- Algunos agentes **corren solos por cron** (skills programadas en n8n): reportes diarios, un pulso diario del funnel a Discord, revisiones semanales de SEO/AEO y de seguridad, escaneo de deuda técnica, el banco de ideas del blog, priorización del roadmap.
- Cada skill declara un **nivel HITL** (human-in-the-loop): **1** = lee y reporta, **2** = propone y espera tu OK, **3** = ejecuta una acción reversible con audit (hoy solo la carga del banco de ideas del blog).
- Los cambios de código **siempre son PRs**: Cody abre el PR en el repo del producto; tú lo revisas y lo mergeas.
- **Alfred** es un meta-agente: cuando un agente actúa mal, diagnostica la causa raíz y abre un PR contra **este** repo (prompts, wrappers, skills, docs).
- Arriba de todo hay un **Project Lead** opcional: Claude Code en tu máquina, con la skill `.claude/skills/project-lead`, que cada mañana ordena lo que propusieron los agentes en todos tus proyectos, lo verifica contra lo que ya salió en cada app y te deja hasta tres tareas listas para un sí; después las sigue hasta producción. No reemplaza a Capi, que sigue siendo el PM de cada proyecto. Detalle: [`lead/README.md`](lead/README.md).

```mermaid
flowchart LR
  U["Tú comentas en Linear<br/>Numa: ¿cuánto convirtió ayer?"] --> W[Webhook]
  W --> N["n8n<br/>regex ^Nombre:"]
  N --> R["respond-linear.ps1<br/>prompt = core + proyecto"]
  R --> C["claude -p<br/>allowlist de tools + timeout"]
  C --> L["🤖 Numa 📊: respuesta<br/>en el mismo issue"]
  L -. "el listener ignora 🤖" .-> N
```

👉 Manual de uso del día a día: [`docs/como-usar-los-agentes.md`](docs/como-usar-los-agentes.md).
👉 **Por qué está armado así** (la forma de trabajar y las lecciones detrás de cada regla): [`docs/como-trabajo.md`](docs/como-trabajo.md).

## Qué necesitas

| Pieza | Para qué | ¿Obligatoria? |
|---|---|---|
| **Claude Code** con suscripción (login OAuth) o API key | Es el runtime de todos los agentes | Sí |
| **Linear** (+ API key) | Donde llamas a los agentes y donde dejan su trabajo | Sí, tal como viene ([alternativas](docs/alternativas.md)) |
| **GitHub** + `gh` CLI | Cody y Alfred abren PRs | Para Cody y Alfred |
| **n8n** (self-hosted) | Crons y el listener de comentarios | Para el modo headless ([alternativas](docs/alternativas.md)) |
| Una máquina **Windows** siempre prendida | Corre n8n y los wrappers de PowerShell | Para el modo headless (portable a Linux/macOS con `run-skill.sh` como referencia) |
| Supabase, GA4, Search Console, Stripe, Vercel, Google Ads, MySQL… | Fuentes de datos de los agentes, vía MCP y siempre en solo lectura | Opcionales: activas solo las que uses |
| **1Password** (CLI `op`) + **age** | Guardar los secretos fuera del repo y descifrarlos a memoria al correr | Opcional: también funciona con archivos `.env` planos en el server ([guía](docs/secretos.md)) |
| **Node 18+** | Claude Code, los MCP propios, el Project Lead y los scripts de `npm run` | Sí |

¿Solo quieres probar el método? Empieza sin server: completa el contexto de tu proyecto y usa las skills desde Claude Code en tu máquina. El camino paso a paso está en [`docs/como-trabajo.md`](docs/como-trabajo.md#empezar-sin-montar-todo).

## El equipo

| Agente | Rol | Qué hace |
|---|---|---|
| **Capi** 🫒 | Project Lead / routing | Responde, rutea al agente correcto, crea issues para trackear trabajo y prioriza el roadmap. |
| **Numa** 📊 | Data | Funnel, conversión, revenue y anomalías (Supabase, GA4, Stripe — solo lectura). |
| **Greta** 📈 | Growth | Ads, SEO, AEO, email y copy customer-facing. Revisiones semanales por cron. |
| **Pico** 🎯 | Product | Convierte insights en propuestas (`[Proposal]`) y escanea ideas de producto. |
| **Cody** 💻 | Code | Lee y escribe el repo del producto, corre el gating local y **abre PRs**. Nunca mergea. |
| **Qualy** 🧪 | QA | Tests, smoke de producción no destructivo y review visual de previews. Reporta PASS/FAIL. |
| **Daly** 🎨 | UX/UI | Escribe **mockups HTML reales** + un brief para Cody en `design/`. |
| **Leda** 📖 | Contenido | Mejora drafts del blog, genera la imagen, agenda y publica con ventana de cancelación. |
| **Alfred** 🎩 | Meta-agente | Mejora a los otros agentes con PRs a este repo. |

---

## Estructura del repo

```
agent-team-template/
├── .claude-plugin/marketplace.json  # registro de los plugins propios
├── .claude/skills/project-lead/     # skill del Project Lead (corre en tu máquina, no en el server)
├── package.json        # sin dependencias: solo scripts `npm run env:*` y `npm run lead:*`
├── plugins/
│   ├── team-shared/    # brand voice, glossary, personas, design system + skills de contenido
│   ├── team-growth/    # skills de growth/SEO/AEO/funnel + configs de MCP
│   ├── team-data/      # queries de solo lectura
│   └── team-pm/        # insight → propuesta → roadmap
├── projects/
│   └── acme/           # bundle de configuración del proyecto de ejemplo
│       ├── project.json         # metadatos, IDs, paths, agentes habilitados
│       ├── *.md                 # contexto: brand-bible, glossary, data-model, icp, product-catalog, roadmap
│       ├── agent-overrides/     # rol de cada agente EN este proyecto
│       └── skills/              # skills propias del proyecto
├── scripts/            # runtime headless (PowerShell)
│   ├── agents.ps1      # ⭐ registry de agentes (identidad, modelo, tools, timeout)
│   ├── project.ps1     # resolución de proyecto, env y prompt
│   ├── run-skill.ps1   # wrapper de crons: corre una skill vía `claude -p`
│   ├── respond-linear.ps1  # listener: responde comentarios `Nombre:` en Linear
│   ├── run-*.ps1       # wrappers dedicados (Alfred, roadmap de Capi, scan de Cody, SEO/AEO de Greta, Qualy…)
│   ├── sync-*.ps1      # ponen al día la copia viva de este repo y las de los repos del producto
│   ├── seed-topics.ps1 # carga ideas al banco `topics` del CMS (lo usa Leda)
│   ├── op-env.mjs      # secretos con 1Password + age (`npm run env:*`)
│   └── mcp-*/          # MCPs propios (Core Web Vitals, Search Console, Vercel, MySQL)
├── lead/               # Project Lead: sync de Linear, CLI, tablero local opcional (estado en lead/state/, NO se versiona)
├── automation/n8n/     # ⭐ workflows de n8n (crons + listener), fuente versionada
├── memory/             # knowledge base que carga cada agente al arrancar
├── design/             # output de Daly (mockups + briefs) — SÍ se versiona
├── docs/               # arquitectura, setup, manual de uso
├── evals/              # casos de prueba por skill
├── queue/              # cola HITL compartida — NO se versiona
└── audit/              # log de corridas — NO se versiona
```

---

## Quickstart

1. **Clona** el repo en tu máquina (y, más adelante, en el server).
2. **Copia el proyecto de ejemplo**: `projects/acme` → `projects/<tu-slug>`.
3. **Completa `project.json`**: nombre, `ownerName`, team de Linear (`teamKey` + `teamId`), `productRepoPath`, `productRepoUrl`, `productUrl`, stack, convención de idioma, foco estratégico y agentes habilitados; y, si aplican, `productRepos` (producto en varios repos), `vercel` (qué proyectos de Vercel pueden leer los agentes) y `payload` (el CMS del blog). Todo lo marcado con `TODO(acme):` o `{{PLACEHOLDER}}` lo completas tú; cada bloque trae un `$comment` que explica para qué sirve.
4. **Escribe el contexto** del proyecto (`brand-bible.md`, `glossary.md`, `data-model.md`, `icp.md`, `product-catalog.md`) y ajusta los `agent-overrides/`. Atajo: pídele a Claude que los redacte a partir del repo de tu producto y revísalos.
5. **Secretos**: copia `.env.example` → `.env.server` (core) y `.env.acme.example` → `.env.<tu-slug>` (por proyecto). Ambos quedan fuera de git. En tu máquina puedes usar en cambio 1Password + age con `.env.local.tpl` y `npm run env:*` ([`docs/secretos.md`](docs/secretos.md)).
6. **Instala los plugins** en Claude Code / Cowork: *Settings → Plugins → Add marketplace → Local folder* → apunta a este repo → instala `team-shared`, `team-growth`, `team-data` y `team-pm`.
7. **Server headless**: sigue [`docs/server-setup.md`](docs/server-setup.md) (Node + Claude Code CLI, keys, smoke tests).
8. **Importa los workflows de n8n** desde `automation/n8n/` (inactivos), pruébalos con *Execute Workflow* y recién después actívalos.
9. **(Opcional) Project Lead**: en tu máquina, con `LINEAR_API_KEY` en el entorno (o vía `scripts/op-env.mjs`) y `gh` logueado, completa `lead/lead.config.json` con tus proyectos, corre `npm run lead:sync` para bajar Linear y, en Claude Code dentro de este repo, pide «arma el plan de hoy». La rutina diaria se programa como tarea de la app de escritorio con los prompts de `lead/scheduled-tasks/` ([`lead/README.md`](lead/README.md)).

Checklist completo para sumar un proyecto: [`docs/add-a-new-project.md`](docs/add-a-new-project.md).

---

## Principios de diseño

- **Identidad como código.** Nombre, emoji, rol, modelo, herramientas y timeout de cada agente viven en `scripts/agents.ps1`. Cambiar cómo actúa un agente es un diff revisable, no un ajuste perdido en una UI.
- **Core vs. overrides por proyecto.** Un solo equipo sirve a varios proyectos. Lo que mejora *cómo trabaja un agente* va al core (`agents.ps1`, wrappers); lo que cambia *el dominio* (tablas, tono, stack, comandos de gating) va a `projects/<slug>/`. Mejoras una vez y impacta en todos los proyectos.
- **Human-in-the-loop siempre.** Los agentes proponen; las personas deciden. Nada se mergea, se publica ni se ejecuta en producción sin un gate humano explícito (review de PR, aprobación del issue, ventana de cancelación).
- **Cambios de código solo por PR.** Cody y Alfred abren PRs; nunca mergean.
- **Firmas anti-loop.** Los agentes comentan con la API key de una persona, así que cada respuesta arranca con `🤖 <Nombre> <Emoji>:` y el listener ignora todo comentario que empiece con `🤖`.
- **Guard de runaway por tiempo, no por presupuesto.** Con una suscripción, el costo no limita; el riesgo real es un loop colgado. Cada agente declara `TimeoutMinutes` y un watchdog mata el árbol de procesos al vencer. `--max-budget-usd` queda como respaldo.
- **Mínimo privilegio en headless.** `--strict-mcp-config`, `--permission-mode dontAsk` y una allowlist de tools corta por wrapper. Los MCP de datos corren en `--read-only`.
- **Cero secretos en el repo.** Los `.mcp.json` usan `${VARIABLE}`; los valores viven en `.env.server` / `.env.<slug>` (o en 1Password, con `.env.local.tpl` + `.env.local.age`), que están en `.gitignore`.
- **Verificar contra el código, no contra la memoria.** La base de conocimiento envejece y las apps cambian todos los días por fuera de Linear. Un agente que propone o diagnostica confirma el hecho en la rama principal del producto antes de afirmarlo; si el código desmiente al contexto, manda el código.
- **Un board que se puede leer.** Lo que pide una decisión y lo que solo deja constancia se separan por label; los registros se archivan solos a los 2 días y una corrida sin novedades no crea issue.

---

## Seguridad

- **Nunca** commitees secretos: van en `.env.server` / `.env.<slug>` o en 1Password. El `.gitignore` cubre `.env*` (incluidos `.env.local` y `.env.local.age`), `secrets/`, `*.pem`, `*.key` y service accounts; solo se versionan los `*.example` y `.env.local.tpl`, que no llevan valores.
- **Nunca** pongas PII en el repo, en `queue/` ni en Linear: los agentes trabajan con agregados.
- Los MCP de datos van en modo **read-only**; las skills de data nunca escriben en producción. Cuando el proveedor no tiene tokens de solo lectura (Vercel, Google Ads), el solo-lectura se impone del lado del repo: un MCP que solo hace GET con un pin de proyectos, o un rol de solo lectura en la cuenta, y una allowlist que limita qué agentes lo llaman. Detalle en [`docs/`](docs/README.md).
- Si se filtra una key, **rótala** (Anthropic, GitHub, Linear, Supabase, Stripe, Vercel, etc.).
- El nivel 3 (ejecución sin aprobación previa) se usa en un único caso, acotado y reversible: la carga del banco de ideas del blog, con registro en Linear y vuelta atrás documentada. Nada de nivel 3 toca código, pagos ni datos de clientes.
- Revisa la allowlist de tools de cada wrapper antes de habilitar un agente nuevo: es la principal barrera entre un prompt y tu infraestructura. Los agentes que leen texto de terceros (issues, web, logs) están expuestos a prompt injection; por eso ninguno puede mergear, publicar sin ventana ni escribir en producción.

---

## Adáptalo

- **Sin n8n o sin Linear**: n8n solo dispara scripts (se reemplaza con el Programador de tareas, cron o GitHub Actions); Linear es el tablero y se porta a GitHub Issues, Jira, Notion o Slack manteniendo el mismo patrón. Guía completa, con ejemplos y checklist: [`docs/alternativas.md`](docs/alternativas.md).
- **Otro sistema operativo**: el runtime vivo es PowerShell sobre Windows; `scripts/run-skill.sh` queda como referencia para Linux/macOS.
- **Menos agentes**: deshabilítalos en `project.json` (`"enabled": false`). Empieza con Capi + Numa + Cody y suma el resto.
- **Agentes nuevos**: agrega una entrada en `scripts/agents.ps1`, su nombre a la regex del listener y, si corre por cron, una skill + un workflow basado en `automation/n8n/_template-skill-cron.json`.
- **Otras fuentes de datos**: cambia los MCP del `.mcp.json` al que apunta `project.json → mcpConfig` (en `plugins/team-growth/` o uno propio en `projects/<slug>/`) y describe tus tablas en `data-model.md`. Si tu base no es Supabase, el MCP MySQL de `scripts/mcp-mysql/` es el modelo a seguir ([`docs/mysql-readonly-source.md`](docs/mysql-readonly-source.md)).
- **Producto en varios repos**: decláralos en `project.json → productRepos`; los agentes de análisis los leen todos y Cody escribe solo en los que no son `readOnly` ([`projects/README.md`](projects/README.md)).

---

## Documentación

Índice completo en [`docs/README.md`](docs/README.md).

---

## Créditos y licencia

Creado por Eliana Bracciaforte a partir del equipo de agentes con el que opera sus propios productos. Publicado bajo licencia [MIT](LICENSE).
