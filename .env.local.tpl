# ---------------------------------------------------------------------------
# .env.local.tpl — template de entorno respaldado por 1Password (EJEMPLO).
#
# Lo genera scripts/op-env.mjs (`npm run env:template` / `npm run env:push`).
# No lo edites a mano: agrega la variable a .env.local y corre `npm run env:push`.
#
# Este archivo SÍ se commitea: solo contiene referencias a 1Password y valores
# públicos (los de PUBLIC_VARS en scripts/op-env.mjs). Los secretos viven en el
# item de 1Password.
#
#   Vault: Agents    Item: agent-team-env-local
#   (son los defaults de scripts/op-env.mjs; cámbialos ahí, con OP_ENV_VAULT /
#    OP_ENV_ITEM o con --vault= / --item=, y regenera este archivo)
#
#   node scripts/op-env.mjs exec -- <cmd>   corre <cmd> con los secretos en memoria
#   npm run env:encrypt                     1Password → .env.local.age (sin biometría después)
#   npm run env:pull                        materializa un .env.local real desde este template
#
# Guía completa: docs/secretos.md. El server headless NO usa este archivo: sus
# wrappers leen .env.server + .env.<slug> (plantillas .env.example y .env.acme.example).
# ---------------------------------------------------------------------------

# =========================================================
# agent-team-template — entorno de tu máquina (Claude Code interactivo + Project Lead)
# =========================================================

# --- Claude / Anthropic ---
ANTHROPIC_API_KEY="op://Agents/agent-team-env-local/ANTHROPIC_API_KEY"

# --- Modelo y límites de presupuesto ---
ANTHROPIC_MODEL="claude-sonnet-4-6"
DAILY_BUDGET_USD="20"
PER_RUN_BUDGET_USD="3"

# --- GitHub (gh / PRs) ---
GH_TOKEN="op://Agents/agent-team-env-local/GH_TOKEN"

# =========================================================
# Supabase — base de producción del producto (read-only para los agentes)
# =========================================================
SUPABASE_PROJECT_REF="your-project-ref"
SUPABASE_ACCESS_TOKEN="op://Agents/agent-team-env-local/SUPABASE_ACCESS_TOKEN"

# =========================================================
# Pagos (read-only)
# =========================================================
STRIPE_RESTRICTED_KEY="op://Agents/agent-team-env-local/STRIPE_RESTRICTED_KEY"

# =========================================================
# Analytics
# =========================================================
GOOGLE_API="op://Agents/agent-team-env-local/GOOGLE_API"
GOOGLE_SERVICE_ACCOUNT_EMAIL="op://Agents/agent-team-env-local/GOOGLE_SERVICE_ACCOUNT_EMAIL"
# GA4 + Search Console (la key JSON de la service account es un ARCHIVO fuera del repo, no una variable)
GA4_PROPERTY_ID="YOUR_GA4_PROPERTY_ID"
GA4_SERVICE_ACCOUNT_JSON_PATH="./secrets/ga4-sa.json"
GSC_SITE_URL="sc-domain:acme.example"

# --- Vercel (MCP read-only scripts/mcp-vercel: deploys + build logs + errores de runtime) ---
# Token de la cuenta (todo el team; Vercel no tiene tokens read-only: el solo-lectura lo impone
# el MCP). En el item de 1Password el campo puede llamarse VERCEL_TOKEN; aquí se expone como
# VERCEL_API_TOKEN a propósito: el CLI de Vercel toma VERCEL_TOKEN del entorno y dejaría a
# cualquier agente con Bash autenticado para deployar.
VERCEL_API_TOKEN="op://Agents/agent-team-env-local/VERCEL_TOKEN"
# Proyecto para corridas locales sin wrapper. En el server el pin sale de projects/<slug>/project.json → vercel.
VERCEL_PROJECT_ID="{{VERCEL_PROJECT_ID_APP}}"

# =========================================================
# Paid acquisition
# =========================================================
# --- Google Ads (MCP oficial read-only, docs/google-ads-readonly-source.md) ---
# Sin secreto propio: autentica con la key JSON de la service account de GA4. Sin developer token.
GOOGLE_ADS_CUSTOMER_ID="TODO-tu-customer-id"
GOOGLE_ADS_LOGIN_CUSTOMER_ID=""

# =========================================================
# PM & docs
# =========================================================
# --- Linear (también la usa el Project Lead: lead/scripts/sync.mjs y act.mjs) ---
LINEAR_API_KEY="op://Agents/agent-team-env-local/LINEAR_API_KEY"

# --- Notion (opcional) ---
NOTION_TOKEN="op://Agents/agent-team-env-local/NOTION_TOKEN"
NOTION_DATABASE_BRIEFS=""
NOTION_DATABASE_DECISIONS=""

# =========================================================
# AI providers (sub-llamadas de skills; los agentes corren con Claude)
# =========================================================
GEMINI_API_KEY="op://Agents/agent-team-env-local/GEMINI_API_KEY"

# =========================================================
# Project Lead (opcional, no son secretos: si los necesitas, ponlos en tu entorno)
# =========================================================
# LEAD_CONFIG       ruta alternativa a lead/lead.config.json
# LEAD_STATE_DIR    dónde vive el estado (default: lead/state/ del checkout principal)
# LEAD_PORT         puerto del tablero local (default 4747, solo 127.0.0.1)
# LEAD_DRY_RUN      1 = simulación sobre una copia del estado
# LINEAR_TIMEOUT_MS tope por llamada a la API de Linear

# =========================================================
# Paths runtime
# =========================================================
QUEUE_DIR="./queue"
AUDIT_DIR="./audit"
MEMORY_DIR="./memory"
