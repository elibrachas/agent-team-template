# =============================================================================
# agent-team-template — setup-git.ps1
# =============================================================================
# Guía paso a paso para inicializar git en TU copia del template, hacer el primer
# commit y conectarla con un repo privado de GitHub.
#
# USO RECOMENDADO: NO correr todo de una. Abrir en una terminal de PowerShell
# y copiar bloque por bloque, leyendo qué hace cada uno.
# =============================================================================

# Posicionarse en el repo — TODO(acme): ajusta la ruta a donde clonaste/copiaste el template.
Set-Location "$HOME\projects\agent-team-template"
Get-Location  # debe mostrar la ruta correcta

# -----------------------------------------------------------------------------
# 1) Verificar git instalado
# -----------------------------------------------------------------------------
git --version
# Si dice "no se reconoce el comando", instalar git: https://git-scm.com/download/win

# -----------------------------------------------------------------------------
# 2) Configurar identidad de git (si no la tienes global ya configurada)
# -----------------------------------------------------------------------------
# Verificar primero:
git config --global user.name
git config --global user.email

# Si están vacíos, configurarlos:
# git config --global user.name "{{OWNER_NAME}}"
# git config --global user.email "owner@example.com"

# Defaults útiles para Windows:
git config --global core.autocrlf input        # mantiene LF en repo, CRLF en working dir
git config --global init.defaultBranch main
git config --global pull.rebase false

# -----------------------------------------------------------------------------
# 3) git init + primer commit
# -----------------------------------------------------------------------------
git init
git status                                      # ver qué va a entrar al commit (¡ningún .env real!)
git add .
git status                                      # confirmar antes de commitear
git commit -m "chore: initial scaffold from agent-team-template"

# -----------------------------------------------------------------------------
# 4) (SOLO si el repo vive dentro de una carpeta sincronizada: OneDrive/Dropbox)
# -----------------------------------------------------------------------------
# El sync y git compiten por escribir en .git/ y eso puede corromper el repo.
# Lo más sano es mover el repo FUERA de la carpeta sincronizada. Si no puedes,
# en OneDrive puedes marcar .git/ como cloud-only ("Unpinned") sin afectar git local:
# attrib +U "<ruta-del-repo>\.git" /S /D

# -----------------------------------------------------------------------------
# 5) Crear el repo remoto en GitHub privado
# -----------------------------------------------------------------------------
# Opción A: con GitHub CLI (recomendado — un comando)
# Instalar gh primero si no lo tienes: winget install --id GitHub.cli
#
# gh auth login                                # autenticar con el browser
# gh repo create agent-team-template --private --source=. --remote=origin --push

# Opción B: manual desde la web
#   1. Ir a https://github.com/new
#   2. Repository name: agent-team-template (o el nombre que prefieras)
#   3. Visibility: Private
#   4. NO inicializar con README, .gitignore ni LICENSE (ya los tenemos)
#   5. Create repository
#   6. Copiar la URL HTTPS (https://github.com/your-org/agent-team-template.git)
#   7. Volver aquí y correr:
#
# git remote add origin https://github.com/your-org/agent-team-template.git
# git branch -M main
# git push -u origin main

# -----------------------------------------------------------------------------
# 6) Verificación post-push
# -----------------------------------------------------------------------------
git remote -v                                   # debe mostrar origin con la URL
git log --oneline -5                            # debe mostrar el commit inicial
git status                                      # debe decir "working tree clean"

# -----------------------------------------------------------------------------
# 7) (OPCIONAL — para más adelante) Setup del server local
# -----------------------------------------------------------------------------
# El runtime de referencia es un server Windows, repo en C:\agents\agent-team-template.
# Los pasos completos (Node, Claude Code CLI, .env.server con icacls, MCPs,
# smoke test, workflows de n8n) están en docs\server-setup.md — esa es la
# fuente de verdad. Resumen mínimo:
#
#   git clone https://github.com/your-org/agent-team-template.git C:\agents\agent-team-template
#   # crear .env.server desde .env.example (NO copiar el .env de tu laptop)
#   # importar workflows de automation\n8n\ en n8n
#
# Para auto-pull en push: webhook de GitHub → n8n →
#   cd C:\agents\agent-team-template; git pull origin main
#   (o scripts\sync-agents-repo.ps1, que hace fast-forward solo si el árbol está limpio)

# =============================================================================
# LISTO. Próximo paso humano: completar el contexto de TU proyecto:
#   - projects/acme/project.json (name, ownerName, linear.teamId/teamKey, repo, stack...)
#   - el contexto del proyecto (brand-bible, glossary, data-model, icp, product-catalog)
#   - las skills compartidas de plugins/team-shared (brand-voice, glossary, ...)
# Esto es bloqueante: sin contenido en estos archivos, los agentes no tienen
# contexto real de tu producto y los outputs van a ser genéricos.
# =============================================================================
