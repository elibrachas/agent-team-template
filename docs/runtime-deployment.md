# Runtime y deployment

> Cómo corre este repo en producción, a nivel conceptual. Complementa [`architecture.md`](architecture.md) (visión). Los pasos exactos y los comandos del server Windows viven en **[`server-setup.md`](server-setup.md)**, que es la fuente de verdad operativa; los ejemplos en bash de este documento son ilustrativos.

## 1. Modelo de ejecución (dos entornos, mismo repo)

| Entorno | Para qué | Cómo corre |
|---------|----------|------------|
| **Claude Code / Cowork desktop** (máquina del owner) | Exploración, decisiones, revisión de PRs, aprobaciones HITL 2 | Marketplace instalado, uso interactivo |
| **Server headless** (donde vive n8n) | Skills desatendidas por cron + listener de Linear | Claude Code CLI headless (`claude -p`), disparado por n8n |

El repo se versiona en GitHub (privado). La máquina del owner y el server hacen `git pull`. En el server el repo es un `git clone` plano, **fuera** de carpetas sincronizadas (OneDrive, Dropbox, iCloud), que corrompen `.git/`.

## 2. ¿Hace falta exponer algo a internet? **No para los agentes.**

El repo de agentes **no es un servicio**: no escucha ningún puerto ni recibe tráfico entrante. Es la CLI de Claude Code que n8n invoca por shell (`claude -p ...`). Solo hace llamadas **salientes** (Linear, Supabase, Google, GitHub) y escribe en el filesystem local (`queue/`, `audit/`).

- Lo único que necesita recibir webhooks es **n8n** (el listener de Linear). Para eso alcanza con el mecanismo que ya uses para exponer n8n (un túnel tipo Cloudflare Tunnel, un reverse proxy, o n8n cloud).
- No expongas el repo de agentes ni la CLI al exterior.

```
[comentario "Numa: ..." en Linear] ──► webhook ──► [n8n] (expuesto por tu túnel/proxy)
                                                     │ Execute Command
                                                     ▼
                                     respond-linear.ps1 → claude -p
                                     (lee Linear/Supabase vía MCP, responde con 🤖)
```

## 3. El loop HITL en este modelo

- **HITL 1 (solo lectura):** cron de n8n → wrapper → `claude -p` → el agente crea un issue en Linear (vía MCP) y el wrapper espeja el brief en `queue/pending-review/`. No espera a nadie.
- **HITL 2 (propone y espera):** el agente propone (issue `[Proposal]`, PR, mockup) y la persona decide en Linear o en GitHub. La siguiente acción se dispara con un nuevo comentario `Nombre: ...`. Los agentes no se disparan entre sí.
- **Audit:** cada corrida deja una línea en `audit/YYYY-MM-DD.jsonl`. `queue/` y `audit/` no se versionan.

## 4. Cómo se invoca una skill headless

Patrón general (⚠️ los nombres de algunas flags cambian entre versiones de la CLI; verifica con `claude --version` y `claude --help`):

```bash
claude -p "Usa la skill signup-to-paid-tracker y genera el brief de hoy." \
  --mcp-config ./plugins/team-growth/.mcp.json \
  --strict-mcp-config \
  --permission-mode dontAsk \
  --allowedTools "Read,mcp__supabase__*,mcp__linear__*" \
  --max-budget-usd 20 \
  --output-format json
```

Claves:
- **Selección de skill**: en `-p` no hay slash-commands; se nombra la skill en el prompt y el `description:` del frontmatter la dispara. Nombrarla explícitamente es lo más determinístico.
- **Permisos desatendidos**: hace falta un modo que NO pida confirmación (si no, el cron se cuelga). Usa un modo restrictivo + allowlist mínima, NO un bypass total. Lo que queda fuera del allowlist se deniega.
- **MCP**: `--mcp-config <archivo>` carga el `.mcp.json`; los `${VAR}` se resuelven desde el **env del proceso**, así que el wrapper exporta las variables antes de llamar a `claude`. `--strict-mcp-config` evita mezclar MCP configurados a nivel usuario de la máquina.
- **Output**: `--output-format json` y se parsea `.result` (y `.total_cost_usd` para el log).
- **Plugins**: se instalan una vez (`/plugin marketplace add <path>` + `/plugin install <plugin>@agent-team-template`) o se cargan por corrida con `--plugin-dir`. Para crons, instalarlos una vez es más rápido.

### Wrapper de cron (ilustrativo, en bash)

```bash
#!/usr/bin/env bash
set -euo pipefail
cd /opt/agent-team-template

# Secretos: archivo SOLO del server, chmod 600
set -a; . ./.env.server; set +a

OUT="queue/pending-review/$(date +%F)-signup-to-paid-tracker.md"
claude -p "Usa la skill signup-to-paid-tracker y devuelve el brief de hoy." \
  --mcp-config ./plugins/team-growth/.mcp.json \
  --strict-mcp-config \
  --permission-mode dontAsk \
  --allowedTools "Read,mcp__supabase__*,mcp__linear__*" \
  --output-format json > /tmp/s2p.json

jq -r '.result' /tmp/s2p.json > "$OUT"
```

El wrapper real (`scripts/run-skill.ps1`) agrega carga de `.env.<slug>`, resolución del proyecto, watchdog de tiempo y audit.

## 5. Secretos en el server

- Los secretos del server viven en `.env.server` (core) y `.env.<slug>` (por proyecto), creados a mano en el server y restringidos a tu usuario (`icacls` en Windows, `chmod 600` en Linux). Nunca viajan por git ni por carpetas sincronizadas.
- Mínimo para activar data: `SUPABASE_ACCESS_TOKEN` (PAT) + `SUPABASE_PROJECT_REF` + `LINEAR_API_KEY`.
- Los `.mcp.json` referencian esas variables como `${...}`; el wrapper las exporta antes de `claude`.

## 6. Billing

Los agentes headless pueden correr contra una **suscripción de Claude** (login OAuth de la CLI) en lugar de la API key: los wrappers borran `ANTHROPIC_API_KEY` del env antes de invocar `claude` para que no se use la key por accidente. En ese modo comparten rate limits con tu uso interactivo, y el costo que reporta la CLI es nominal. Por eso el guard principal contra loops es el **tiempo** (`TimeoutMinutes` por agente + watchdog), con `--max-budget-usd` como respaldo. Si prefieres facturación por API, deja la key y ajusta los topes de presupuesto.

## 7. Checklist de activación (primera skill)

1. **[higiene]** Genera un PAT de Supabase dedicado para el MCP (el MCP fuerza read-only) y una API key de Linear.
2. **[server]** Instala Node + Claude Code CLI. Anota los nombres reales de las flags (`claude --help`).
3. **[server]** `git clone` del repo en una ruta fuera de carpetas sincronizadas.
4. **[server]** Crea `.env.server` y `.env.<slug>` con permisos restringidos.
5. **[server]** Instala el marketplace una vez (o decide usar `--plugin-dir` por corrida).
6. **[verificar MCP]** Smoke test: corre la skill a mano con `-DryRun` y después real. Confirma que **lee la base y no pide confirmación**. Si se cuelga, ajusta el modo de permisos o el allowlist.
7. **[corrida real]** Revisa el brief en `queue/pending-review/` y el issue en Linear. ¿Los números coinciden con tu fuente? ¿Declaró los caveats del `data-model.md`?
8. **[n8n]** Importa el workflow del cron (Schedule Trigger → Execute Command → NoOp), pruébalo con *Execute Workflow* y actívalo.
9. **[soak]** Déjalo correr una semana antes de sumar la siguiente skill.
10. **[desktop]** Instala el mismo marketplace en Claude Code / Cowork para uso interactivo.

## 8. Seguridad (no negociable)

- MCP de base de datos **siempre `--read-only`**. Las skills de data nunca escriben en producción.
- `--allowedTools` mínimo por wrapper. Nada de `Bash` genérico salvo en los wrappers que lo necesitan (Cody, Alfred, Pico-shipped) y con alcance documentado.
- Secretos con permisos restringidos, fuera de git y de carpetas sincronizadas.
- PII nunca sale de la base hacia `queue/` ni Linear. Solo agregados.
