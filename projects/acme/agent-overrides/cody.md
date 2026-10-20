<!-- EJEMPLO: override de Cody para el proyecto Acme. Declara stack, comandos de gating, lista NO-TOCAR y reglas de UI. Reemplaza todo por lo de tu repo. -->
## Reglas de {{PROJECT_NAME}} (el producto en `{{PRODUCT_REPO_PATH}}`)

### Archivos guía (leer COMPLETOS antes de cualquier edit)
`{{PRODUCT_REPO_PATH}}\AGENTS.md` y `{{PRODUCT_REPO_PATH}}\CLAUDE.md` (si existen). TODO(acme): lista las reglas durables que más importan (p. ej. "los clientes de base de datos salen de `lib/db/*` respetando RLS", "los límites del plan se validan en el server", "cómo se cachean las páginas").

### Gating local (paso 6 del workflow) — comandos exactos
TODO(acme): los comandos reales de tu repo. Si el repo arrastra errores pre-existentes, el bar NO es "todo limpio" sino **no introducir nada nuevo**:

a. ANTES de tocar nada (recién brancheado desde main), mide el baseline y anota los números:
   `pnpm typecheck 2>&1 | grep -c "error TS"`
   `pnpm lint 2>&1 | grep -cE "error|warning"`
b. DESPUÉS de tus cambios, corre los tres y compara contra el baseline:
   `pnpm typecheck` — el conteo NO puede subir y ningún error nuevo puede estar en un archivo que tocaste.
   `pnpm lint` — sin errores/warnings NUEVOS, sobre todo en lo que tocaste.
   `pnpm test` — los fallos pre-existentes documentados (lístalos aquí) están permitidos; no introduzcas NUEVOS.

Package manager: `pnpm`. Deploy: TODO(acme) (p. ej. Vercel con preview automático por PR). CI: TODO(acme) (si no hay CI, el gating es local).

### Lista NO-TOCAR de {{PROJECT_NAME}}
TODO(acme): ajusta a tu repo. Ejemplo: migraciones de base (source of truth), config del CMS, `vercel.json`, `.env*`, `.github/`, certificados. Solo tocas: `lib/`, `components/`, `app/`, `docs/`, `test/`, `styles/`, `types/`. No toques `package.json` ni el lockfile salvo que el cambio requiera deps nuevas y lo declares en el PR.

### Design system / reglas de UI
- Si tocas UI, carga SIEMPRE la skill `design-system` (`plugins\team-shared\skills\design-system\SKILL.md`) y `{{PROJECT_CONTEXT_DIR}}\design-system.md`.
- Reusa los componentes existentes antes de crear uno nuevo. Una implementación que hace a mano algo que ya existe como componente está MAL por definición.
- Copy customer-facing: {{LANGUAGE_CONVENTION}}

### Tests del PR body
En "qué corrió OK" lista typecheck, lint y tests, con nota de los fallos pre-existentes permitidos.

### Modo SCAN de deuda técnica (read-only, distinto a este modo writes-code)
Además de implementar, corres un **scan semanal de deuda técnica** con la skill `tech-debt-scan` vía `scripts/run-cody-scan.ps1`. En ESE modo eres **READ-ONLY**: sin Edit/Write, sin git/PR — solo escaneas el repo (incluido el conteo de gating como métrica de deuda) y propones hasta 3-5 `[Proposal]` de ingeniería que alimentan el roadmap. Antes de proponer, lee `{{PROJECT_CONTEXT_DIR}}\roadmap.md` para dedupe. Cuando {{OWNER_NAME}} decide implementar una, te invoca `Cody:` y vuelves al modo writes-code.

### Avance del plan AEO (excepción autorizada a escribir en el repo de agentes)
Cuando el issue que implementas tiene el **label `aeo`** (viene del stream AEO de Greta), además de tu PR dejas registrado el avance en el plan vivo de AEO.

- **Cuándo**: recién DESPUÉS de abrir el PR con éxito. Si el PR no salió, no toques el plan.
- **Qué**: agrega UNA sola línea al tope de la lista **"Avances / cerrado"** de la sección **§1 "Estado y avances"** de `plugins/team-growth/skills/aeo-weekly-review/aeo-strategy.md`. Más reciente arriba. Formato exacto:
  `- YYYY-MM-DD · {{LINEAR_TEAM_KEY}}-X · <qué shippeaste en una frase> (PR #NNN)`
  Si está el bullet placeholder "_(sin avances aún…)_", reemplázalo por el tuyo.
- **Cómo**: `Edit` para insertar SOLO ese bullet. **Append-only**: no reescribas ni reordenes el resto; no toques §2 ni §3+ (son de Greta/{{OWNER_NAME}}). Si no encuentras §1, no inventes: menciónalo en tu comentario de Linear.
- **No commitees el repo de agentes** — el cambio queda en el working tree y lo commitea {{OWNER_NAME}}. Tu commit/push/PR es SOLO del repo del producto.
