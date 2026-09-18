#!/usr/bin/env bash
# ALTERNATIVA Linux/WSL. El runtime de referencia es WINDOWS → usar scripts/run-skill.ps1.
# Se deja por si en algún momento el runtime pasa a Linux.
# Corre una skill headless desde n8n (server local).
#   uso: ./scripts/run-skill.sh <skill-name>
#
# ⚠️ Flags version-dependent: verifica los nombres reales con `claude -p --help`
# antes de confiar en este script (--permission-mode, --allowedTools,
# --mcp-config, --model, --output-format pueden variar entre versiones).
set -euo pipefail
cd "$(dirname "$0")/.."

# Secretos del server (NO un .env.local de tu laptop). Ver docs/server-setup.md §4.
if [[ -f ./.env.server ]]; then set -a; . ./.env.server; set +a; fi

SKILL="${1:?uso: run-skill.sh <skill-name>}"

# Tiering de modelo por skill (costo). Override con ANTHROPIC_MODEL del env.
case "$SKILL" in
  signup-to-paid-tracker|funnel-monitor) MODEL="${ANTHROPIC_MODEL:-claude-sonnet-4-6}" ;;
  *)                                     MODEL="${ANTHROPIC_MODEL:-claude-sonnet-4-6}" ;;
esac

STAMP="$(date +%F)"
OUT="queue/pending-review/${STAMP}-${SKILL}.md"
mkdir -p queue/pending-review

# La skill lee Supabase (read) y crea el issue en Linear (write). Por eso el
# allowlist permite Read + los tools MCP de supabase y linear, y nada más.
# Confirma los nombres exactos de los tools MCP (mcp__supabase__*, mcp__linear__*)
# en tu CLI y ajusta --allowedTools si difieren.
PROMPT="Usa la skill ${SKILL}. Sigue su SKILL.md al pie: carga glossary + data-model, \
corre las queries read-only contra Supabase, y crea el issue en Linear (team ACM, label \
agent-proposal, estado Backlog, sin asignar) según la convención de memory/CLAUDE.md. \
Guarda también el brief en ${OUT}."

if ! claude -p "$PROMPT" \
      --model "$MODEL" \
      --mcp-config ./plugins/team-growth/.mcp.json \
      --permission-mode dontAsk \
      --allowedTools "Read" "mcp__supabase__*" "mcp__linear__*" "Write(${OUT})" \
      --output-format json > "/tmp/${SKILL}.json" 2>"/tmp/${SKILL}.err"; then
  echo "ERROR corriendo ${SKILL}. Ver /tmp/${SKILL}.err:" >&2
  cat "/tmp/${SKILL}.err" >&2
  exit 1
fi

# Salida para que n8n la loguee / postee.
jq -r '.result // "(sin .result)"' "/tmp/${SKILL}.json"
echo "---"
echo "Costo USD: $(jq -r '.total_cost_usd // "n/a"' "/tmp/${SKILL}.json")"
