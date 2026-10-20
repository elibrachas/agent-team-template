#!/usr/bin/env node
/**
 * op-env.mjs — sincroniza las variables de entorno locales con 1Password.
 *
 * El objetivo: que `.env.local` deje de ser la fuente de verdad de los secretos.
 * La fuente pasa a ser un item de 1Password; en el repo queda `.env.local.tpl`,
 * que solo contiene referencias `op://` y valores públicos. Ese template SÍ se
 * commitea.
 *
 *   node scripts/op-env.mjs template   Regenera .env.local.tpl desde .env.local (no requiere login)
 *   node scripts/op-env.mjs push       Sube los valores de .env.local al item de 1Password
 *   node scripts/op-env.mjs check      Verifica que cada referencia op:// resuelva
 *   node scripts/op-env.mjs doctor     Diagnóstico completo (op, login, vault, item, drift)
 *   node scripts/op-env.mjs sanitize   Vacía los valores de un .env (solo si ya están en 1Password)
 *   node scripts/op-env.mjs exec -- <cmd>  Corre <cmd> con los secretos inyectados en memoria
 *   node scripts/op-env.mjs pull       Materializa .env.local desde el template
 *
 * Flags: --vault=<nombre> --item=<título> --env=<path> --tpl=<path> --enc=<path> --no-template
 * (vault e item también por env: OP_ENV_VAULT / OP_ENV_ITEM)
 *
 * OPCIONAL: el template funciona igual con un `.env.server` plano (los wrappers .ps1 lo leen
 * directo). op-env es para quien quiera sacar los secretos del disco: 1Password queda como fuente
 * de verdad y, para correr sin prompts (agentes desatendidos), `encrypt` deja un `.env.local.age`
 * cifrado con age por máquina que `exec` descifra a memoria. Requisitos: el CLI `op` (con la
 * integración de la app de escritorio) y `age`; `.age-recipients` en la raíz con la(s) clave(s)
 * pública(s) y la clave privada fuera del repo (AGE_KEY_FILE). `.env.local`, `.env.local.age`
 * y la clave privada NUNCA se commitean; `.env.local.tpl` y `.age-recipients` sí.
 *
 * Este script nunca imprime valores de secretos, solo nombres de variables.
 */

import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULTS = {
  // TODO(acme): tu vault e item de 1Password. También se pueden pasar por env (OP_ENV_VAULT /
  // OP_ENV_ITEM) o por flag (--vault= / --item=) sin tocar este archivo.
  vault: process.env.OP_ENV_VAULT || "Agents",
  item: process.env.OP_ENV_ITEM || "agent-team-env-local",
  env: ".env.local",
  tpl: ".env.local.tpl",
  enc: ".env.local.age",
}

/** Destinatarios (claves públicas) a los que se cifra. Commiteable. */
const RECIPIENTS_FILE = ".age-recipients"

/**
 * Clave privada de age, por máquina, fuera del repo y de carpetas sincronizadas (Dropbox, iCloud y similares). La ruta sigue
 * la convención de sops (~/.config/sops/age/keys.txt) porque es donde más
 * tooling la busca, pero aquí la usa age directamente.
 */
const AGE_KEY_FILE =
  process.env.AGE_KEY_FILE ??
  process.env.SOPS_AGE_KEY_FILE ??
  `${process.env.USERPROFILE ?? process.env.HOME}/.config/sops/age/keys.txt`

/**
 * Variables que NO son secretos y quedan con su valor literal en el template.
 * Regla general: todo es secreto salvo que esté explícitamente aquí. Es
 * deliberadamente fail-safe — una variable nueva se vaultea salvo que la
 * agregues a esta lista a propósito.
 */
const PUBLIC_VARS = new Set([
  // Clasificación inicial por nombre de variable — revisa el .tpl generado antes
  // del primer push. Regla fail-safe: lo que no está aquí (ni empieza con
  // NEXT_PUBLIC_) va al vault como secreto. TODO(acme): ajusta la lista a tus vars.
  "ANTHROPIC_MODEL",
  "DAILY_BUDGET_USD",
  "PER_RUN_BUDGET_USD",
  "SLACK_CHANNEL_AGENTS",
  "SLACK_CHANNEL_ALERTS",
  "SUPABASE_PUBLIC_KEY",
  "SUPABASE_PROJECT_REF",
  "STRIPE_PRICE_ID",
  "EMAIL_FROM",
  "GA4_PROPERTY_ID",
  "GA4_SERVICE_ACCOUNT_JSON_PATH",
  "VERCEL_PROJECT_ID",
  "META_AD_ACCOUNT_ID",
  "GOOGLE_ADS_CUSTOMER_ID",
  "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
  "GSC_SITE_URL",
  "LINEAR_TEAM_ID",
  "NOTION_DATABASE_BRIEFS",
  "NOTION_DATABASE_DECISIONS",
  "QUEUE_DIR",
  "AUDIT_DIR",
  "MEMORY_DIR",
])

// NEXT_PUBLIC_* es público por definición: Next lo inlinea en el bundle del cliente.
const isPublic = (key) => key.startsWith("NEXT_PUBLIC_") || PUBLIC_VARS.has(key)

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
}

const ok = (s) => console.log(`${c.green("✓")} ${s}`)
const warn = (s) => console.log(`${c.yellow("!")} ${s}`)
const fail = (s) => console.log(`${c.red("✗")} ${s}`)

function die(msg) {
  fail(msg)
  process.exit(1)
}

function parseArgs(argv) {
  const opts = { ...DEFAULTS, template: true }
  const positional = []

  // Todo lo que venga después de `--` es el comando a ejecutar (para `exec`).
  const sep = argv.indexOf("--")
  if (sep !== -1) {
    opts.rest = argv.slice(sep + 1)
    argv = argv.slice(0, sep)
  }

  for (const arg of argv) {
    if (arg === "--no-template") {
      opts.template = false
      continue
    }
    if (arg === "--from-op") {
      opts.fromOp = true
      continue
    }
    const m = /^--([a-z]+)=(.*)$/.exec(arg)
    if (m && m[1] in DEFAULTS) opts[m[1]] = m[2]
    else if (arg.startsWith("--")) die(`Flag desconocido: ${arg}`)
    else positional.push(arg)
  }
  return { command: positional[0], opts }
}

/**
 * Parser de dotenv que preserva comentarios y líneas en blanco, para que el
 * template generado conserve la estructura y las secciones del original.
 * Soporta valores entre comillas simples/dobles y multilínea entre comillas dobles.
 */
function parseEnvFile(text) {
  const entries = []
  const lines = text.split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (/^\s*$/.test(line)) {
      entries.push({ type: "blank" })
      continue
    }
    if (/^\s*#/.test(line)) {
      entries.push({ type: "comment", raw: line })
      continue
    }

    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m) {
      entries.push({ type: "comment", raw: line })
      continue
    }

    const key = m[1]
    let rest = m[2]
    let value

    if (rest.startsWith('"') || rest.startsWith("'")) {
      const quote = rest[0]
      // Valor multilínea: consumir líneas hasta encontrar la comilla de cierre.
      let buf = rest.slice(1)
      let closed = false
      const closingRe = new RegExp(`(^|[^\\\\])${quote}\\s*$`)
      if (closingRe.test(rest.slice(1)) || rest.slice(1).endsWith(quote)) {
        buf = rest.slice(1, rest.lastIndexOf(quote))
        closed = true
      } else {
        while (++i < lines.length) {
          if (lines[i].endsWith(quote)) {
            buf += "\n" + lines[i].slice(0, -1)
            closed = true
            break
          }
          buf += "\n" + lines[i]
        }
      }
      if (!closed) die(`Comilla sin cerrar en la variable ${key}`)
      value = quote === '"' ? buf.replace(/\\n/g, "\n").replace(/\\"/g, '"') : buf
    } else {
      // Sin comillas: cortar en el primer # que abra comentario inline.
      value = rest.replace(/\s+#.*$/, "").trim()
    }

    entries.push({ type: "var", key, value })
  }

  // Colapsar la línea en blanco final que deja el trailing newline.
  while (entries.length && entries.at(-1).type === "blank") entries.pop()
  return entries
}

function readEnv(path) {
  const abs = resolve(process.cwd(), path)
  if (!existsSync(abs)) die(`No existe ${path}. Corre esto desde la raíz del repo.`)
  const entries = parseEnvFile(readFileSync(abs, "utf8"))
  const allVars = entries.filter((e) => e.type === "var")
  if (allVars.length === 0) die(`${path} no tiene ninguna variable.`)

  // Claves repetidas: dotenv (y por lo tanto @next/env) resuelve last-wins, asi
  // que nos alineamos con eso para que lo que guardamos sea lo que la app usa.
  // Marcamos las ocurrencias perdedoras para no emitirlas en el template.
  const lastIndex = new Map()
  allVars.forEach((v, i) => lastIndex.set(v.key, i))
  allVars.forEach((v, i) => {
    v.shadowed = lastIndex.get(v.key) !== i
  })

  const dupes = [...new Set(allVars.filter((v) => v.shadowed).map((v) => v.key))]
  if (dupes.length) {
    warn(`${path} define estas variables más de una vez: ${dupes.join(", ")}`)
    console.log(c.dim("  Se usa la última ocurrencia, igual que dotenv/@next/env. Conviene borrar las repetidas."))
  }

  return { entries, vars: allVars.filter((v) => !v.shadowed) }
}

// ---------------------------------------------------------------------------
// Wrapper de `op`
// ---------------------------------------------------------------------------

/**
 * winget deja op en WinGet\Links, que no entra al PATH hasta reabrir la shell.
 * Resolvemos el binario explícitamente para que el script ande igual.
 */
function resolveOp() {
  const candidates = ["op"]
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    candidates.push(`${process.env.LOCALAPPDATA}\\Microsoft\\WinGet\\Links\\op.exe`)
    candidates.push("C:\\Program Files\\1Password CLI\\op.exe")
  }
  for (const bin of candidates) {
    const r = spawnSync(bin, ["--version"], { encoding: "utf8", shell: false })
    if (r.status === 0) return bin
  }
  return null
}

const OP = resolveOp()

/**
 * Igual que resolveOp: los shims de winget viven en WinGet\Links, que no entra
 * al PATH hasta reabrir la shell.
 *
 * age y no sops, a propósito: sops en Windows no puede leer stdin (resuelve
 * `/dev/stdin` como `C:\dev\stdin` — verificado con 3.13.3), así que cifrar con
 * sops obligaría a pasar el plaintext por un archivo temporal. age lee stdin y
 * escribe stdout nativamente en cualquier OS, y para este flujo (cifrar el
 * archivo entero, descifrar a memoria) la granularidad por clave de sops no
 * aporta nada.
 */
function resolveAge() {
  const candidates = ["age"]
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    candidates.push(`${process.env.LOCALAPPDATA}\\Microsoft\\WinGet\\Links\\age.exe`)
  }
  for (const bin of candidates) {
    const r = spawnSync(bin, ["--version"], { encoding: "utf8", shell: false, stdio: ["ignore", "pipe", "pipe"] })
    if (r.status === 0) return bin
  }
  return null
}

const AGE = resolveAge()

function age(args, { input, allowFail = false } = {}) {
  if (!AGE) die("No encontré `age`. Instálalo con: winget install FiloSottile.age")
  const r = spawnSync(AGE, args, {
    encoding: "utf8",
    input,
    stdio: input === undefined ? ["ignore", "pipe", "pipe"] : undefined,
    shell: false,
    maxBuffer: 32 * 1024 * 1024,
  })
  if (r.status !== 0 && !allowFail) {
    die(`age falló:\n  ${(r.stderr || "").trim() || "(sin stderr)"}`)
  }
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
}

/**
 * La primera llamada a `op` de cada sesión dispara la autorización contra la app
 * de escritorio (biometria) y puede tardar varios segundos, o colgarse si el
 * prompt queda sin atender. Damos un timeout explícito y un mensaje que apunte a
 * la app, en vez de quedarnos esperando para siempre.
 */
const OP_TIMEOUT_MS = 90_000

function op(args, { input, allowFail = false } = {}) {
  if (!OP) die("No encontré el CLI de 1Password (`op`). Instálalo con: winget install AgileBits.1Password.CLI")

  // `op item create/edit` interpreta cualquier stdin conectado como un template
  // JSON. spawnSync por defecto le enchufa un pipe vacio y op falla con
  // "invalid JSON in piped input". Con stdin en NUL no intenta leerlo.
  const stdio = input === undefined ? ["ignore", "pipe", "pipe"] : undefined

  const r = spawnSync(OP, args, {
    encoding: "utf8",
    input,
    stdio,
    shell: false,
    maxBuffer: 32 * 1024 * 1024,
    timeout: OP_TIMEOUT_MS,
  })

  if (r.error?.code === "ETIMEDOUT") {
    die(
      `op ${args.slice(0, 2).join(" ")} no respondió en ${OP_TIMEOUT_MS / 1000}s.\n` +
        "  Suele ser el prompt de autorización de 1Password esperando en la app.\n" +
        "  Abre 1Password, desbloquéala y vuelve a correr el comando.",
    )
  }
  if (r.status !== 0 && !allowFail) {
    const stderr = (r.stderr || "").trim()
    die(`op ${args.slice(0, 2).join(" ")} falló:\n  ${stderr || "(sin stderr)"}`)
  }
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
}

/**
 * Con la integracion de la app de escritorio, `op whoami` reporta "account is not
 * signed in" aunque el CLI funcione perfecto: busca un token de sesión del CLI,
 * mientras que los comandos reales se autorizan contra la app. Probamos con un
 * comando de verdad, que es lo único que refleja si podemos leer secretos.
 */
function isSignedIn() {
  const probe = spawnSync(OP, ["vault", "list", "--format", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    timeout: OP_TIMEOUT_MS,
  })
  // La primera llamada puede abrir el prompt biométrico; avisamos solo si tardó.
  if (probe.error?.code === "ETIMEDOUT") {
    fail("1Password no respondió — ¿quedó un prompt de autorización abierto en la app?")
    return false
  }
  return probe.status === 0
}

/** Email de la cuenta activa. `whoami` no sirve aquí (ver isSignedIn). */
function accountEmail() {
  const r = op(["account", "list", "--format", "json"], { allowFail: true })
  if (r.status !== 0) return "?"
  try {
    return JSON.parse(r.stdout)[0]?.email ?? "?"
  } catch {
    return "?"
  }
}

function requireSignIn() {
  if (isSignedIn()) return
  console.log()
  die(
    "El CLI de 1Password no puede leer secretos.\n" +
      "  Activa 1Password → Settings → Developer → «Integrate with 1Password CLI»\n" +
      "  y deja la app desbloqueada.\n" +
      "  Para ver el error crudo:  op vault list",
  )
}

function vaultExists(vault) {
  return op(["vault", "get", vault, "--format", "json"], { allowFail: true }).status === 0
}

function itemExists(vault, item) {
  return op(["item", "get", item, "--vault", vault, "--format", "json"], { allowFail: true }).status === 0
}

// ---------------------------------------------------------------------------
// Comandos
// ---------------------------------------------------------------------------

/**
 * Reconstruye las entradas del template leyendo el item de 1Password, sin tocar
 * `.env.local`. Es el camino de recuperación: si se pierde el template y ya no
 * existe el .env original, 1Password tiene todo (secretos concealed + públicas
 * en texto plano) y desde ahi se regenera.
 *
 * Se pierden los comentarios y las secciones, que solo vivian en el .env.
 */
function entriesFromOnePassword(opts) {
  requireSignIn()
  if (!itemExists(opts.vault, opts.item)) die(`El item «${opts.item}» no existe en el vault «${opts.vault}».`)

  const raw = op(["item", "get", opts.item, "--vault", opts.vault, "--format", "json", "--reveal"]).stdout
  const fields = (JSON.parse(raw).fields ?? []).filter(
    (f) => f.label && /^[A-Za-z_][A-Za-z0-9_]*$/.test(f.label) && typeof f.value === "string",
  )
  if (fields.length === 0) die(`El item «${opts.item}» no tiene campos con forma de variable de entorno.`)

  const entries = [
    { type: "comment", raw: "# Reconstruido desde 1Password con `template --from-op`." },
    { type: "comment", raw: "# Los comentarios y secciones del .env original no se conservan." },
    { type: "blank" },
    ...fields.map((f) => ({ type: "var", key: f.label, value: f.value })),
  ]
  return { entries, vars: entries.filter((e) => e.type === "var") }
}

function cmdTemplate(opts) {
  const { entries, vars } = opts.fromOp ? entriesFromOnePassword(opts) : readEnv(opts.env)
  const secrets = vars.filter((v) => !isPublic(v.key))
  const publics = vars.filter((v) => isPublic(v.key))

  const header = [
    "# ---------------------------------------------------------------------------",
    "# .env.local.tpl — template de entorno respaldado por 1Password.",
    "#",
    "# Generado por scripts/op-env.mjs. No editar a mano: agrega la variable a",
    "# .env.local y corre `node scripts/op-env.mjs push`.",
    "#",
    // Ojo: `op inject` escanea TODO el archivo buscando referencias, comentarios
    // incluidos. Un `op` + `://` literal aquí rompe la inyección entera.
    "# Este archivo SI se commitea: solo contiene referencias a 1Password y",
    "# valores públicos. Los secretos viven en el item de 1Password.",
    "#",
    `#   Vault: ${opts.vault}    Item: ${opts.item}`,
    "#",
    "#   node scripts/op-env.mjs exec -- <cmd>   corre <cmd> con los secretos inyectados en memoria",
    "#   node scripts/op-env.mjs pull            materializa un .env.local real desde este template",
    "# ---------------------------------------------------------------------------",
    "",
  ]

  const body = entries.flatMap((e) => {
    if (e.type === "blank") return [""]
    if (e.type === "comment") return [e.raw]
    if (e.shadowed) return [] // ocurrencia pisada por una posterior
    if (isPublic(e.key)) return [`${e.key}=${JSON.stringify(e.value)}`]
    return [`${e.key}="op://${opts.vault}/${opts.item}/${e.key}"`]
  })

  writeFileSync(resolve(process.cwd(), opts.tpl), header.concat(body).join("\n") + "\n", "utf8")

  ok(`${opts.tpl} generado — ${vars.length} variables`)
  console.log(c.dim(`  ${secrets.length} referenciadas desde 1Password, ${publics.length} literales (públicas)`))
  console.log(c.dim(`  públicas: ${publics.map((p) => p.key).join(", ")}`))
}

function cmdPush(opts) {
  requireSignIn()
  const { vars } = readEnv(opts.env)
  const secrets = vars.filter((v) => !isPublic(v.key))

  if (secrets.length === 0) die("No hay ningún secreto para subir.")

  if (!vaultExists(opts.vault)) {
    const created = op(["vault", "create", opts.vault, "--format", "json"], { allowFail: true })
    if (created.status !== 0) {
      die(
        `No pude crear el vault «${opts.vault}»:\n  ${created.stderr.trim()}\n\n` +
          `  Usa un vault existente:  node scripts/op-env.mjs push --vault=Personal\n` +
          `  (y actualiza el default —o OP_ENV_VAULT— para no repetirlo)`,
      )
    }
    ok(`Vault «${opts.vault}» creado`)
  }

  // Guardamos TODAS las variables, no solo los secretos: las públicas viven
  // literales en el template, y si ese archivo se pierde no habria de donde
  // sacarlas. Van como texto plano (`[text]`) para que se distingan de un
  // vistazo de los secretos (`[password]`, concealed).
  //
  // Se pasan como argv sin shell, así que no hay que escapar nada y el límite es
  // CreateProcess (32 KB), no cmd.exe (8 KB).
  const fields = vars.map((v) => `${v.key}[${isPublic(v.key) ? "text" : "password"}]=${v.value}`)
  const exists = itemExists(opts.vault, opts.item)

  const detalle = `${secrets.length} secretos + ${vars.length - secrets.length} públicas`
  if (exists) {
    op(["item", "edit", opts.item, "--vault", opts.vault, ...fields, "--format", "json"])
    ok(`Item «${opts.item}» actualizado — ${detalle}`)
  } else {
    op([
      "item",
      "create",
      "--category",
      "Secure Note",
      "--title",
      opts.item,
      "--vault",
      opts.vault,
      ...fields,
      "--format",
      "json",
    ])
    ok(`Item «${opts.item}» creado en el vault «${opts.vault}» — ${detalle}`)
  }

  if (opts.template) cmdTemplate(opts)
}

/**
 * Vacía los valores de un archivo .env dejando solo los nombres, para convertirlo
 * en un example de verdad.
 *
 * Se niega a tocar el archivo si algún valor no está guardado en 1Password: el
 * caso peligroso es un secreto huérfano cuya única copia vive en este archivo.
 */
function cmdSanitize(opts) {
  requireSignIn()
  const path = resolve(process.cwd(), opts.env)
  if (!existsSync(path)) die(`No existe ${opts.env}`)

  const entries = parseEnvFile(readFileSync(path, "utf8"))
  const withValue = entries.filter((e) => e.type === "var" && e.value.trim() !== "")

  if (!itemExists(opts.vault, opts.item)) {
    die(`El item «${opts.item}» no existe en el vault «${opts.vault}». Corre primero el push.`)
  }

  // Traemos el item una sola vez y comparamos valores en memoria.
  const stored = new Map()
  const raw = op(["item", "get", opts.item, "--vault", opts.vault, "--format", "json", "--reveal"]).stdout
  for (const f of JSON.parse(raw).fields ?? []) {
    if (f.label && typeof f.value === "string") stored.set(f.label, f.value)
  }

  const orphans = withValue.filter((e) => !isPublic(e.key) && stored.get(e.key) !== e.value)
  if (orphans.length) {
    console.log()
    fail(`No puedo vaciar ${opts.env}: estos valores no están guardados en 1Password.`)
    console.log(c.dim("  Si los borro, se pierde la única copia:\n"))
    for (const o of orphans) console.log(`    ${o.key}`)
    console.log(
      c.dim(
        `\n  Guárdalos primero:\n` +
          `    node scripts/op-env.mjs push --env=${opts.env} --item=${opts.item} --no-template\n`,
      ),
    )
    process.exit(1)
  }

  const body = entries.map((e) => {
    if (e.type === "blank") return ""
    if (e.type === "comment") return e.raw
    return `${e.key}=`
  })
  writeFileSync(path, body.join("\n") + "\n", "utf8")
  ok(`${opts.env} vaciado — ${withValue.length} valores removidos, ${entries.filter((e) => e.type === "var").length} nombres conservados`)
  console.log(c.dim(`  Todos los secretos verificados en 1Password antes de borrar.`))
}

function cmdCheck(opts) {
  requireSignIn()
  const tplPath = resolve(process.cwd(), opts.tpl)
  if (!existsSync(tplPath)) die(`No existe ${opts.tpl}. Corre primero: node scripts/op-env.mjs template`)

  // `op inject` resuelve todas las referencias de una sola pasada. Capturamos el
  // resultado solo para contar y verificar — nunca lo imprimimos.
  const r = op(["inject", "-i", tplPath], { allowFail: true })
  if (r.status !== 0) {
    die(`Hay referencias que no resuelven:\n  ${r.stderr.trim()}`)
  }

  const resolved = parseEnvFile(r.stdout).filter((e) => e.type === "var")
  const leftover = resolved.filter((v) => v.value.includes("op://"))
  const empty = resolved.filter((v) => v.value.trim() === "")

  if (leftover.length) fail(`Sin resolver: ${leftover.map((v) => v.key).join(", ")}`)
  if (empty.length) warn(`Resuelven vacío: ${empty.map((v) => v.key).join(", ")}`)
  if (!leftover.length && !empty.length) ok(`Las ${resolved.length} variables resuelven correctamente`)

  return leftover.length === 0
}

/**
 * `op run` con el template, delegando stdio al proceso hijo.
 *
 * Existe para no depender de que `op` este en el PATH: winget lo instala en
 * WinGet\Links, que recién entra al PATH al reabrir la shell, así que un script
 * de package.json que invoque `op` directo falla de forma intermitente segun
 * cuándo se abrió la terminal.
 */
function cmdExec(opts) {
  const rest = opts.rest ?? []
  if (rest.length === 0) die("Falta el comando. Ejemplo: node scripts/op-env.mjs exec -- next dev")

  // Camino preferido: descifrar con age (archivo de clave, sin biometría), que
  // es lo único que sirve para automode. Si no hay archivo cifrado, caemos a
  // `op run`, que pide autorizacion en cada invocacion.
  const encPath = resolve(process.cwd(), opts.enc)
  if (existsSync(encPath)) {
    if (!existsSync(AGE_KEY_FILE)) {
      die(`Existe ${opts.enc} pero no la clave ${AGE_KEY_FILE}.\n  Genérala con: age-keygen -o "${AGE_KEY_FILE}"`)
    }
    const dec = age(["-d", "-i", AGE_KEY_FILE, encPath])
    const vars = Object.fromEntries(
      parseEnvFile(dec.stdout)
        .filter((e) => e.type === "var")
        .map((e) => [e.key, e.value]),
    )
    // Con shell:true Node concatena comando+args sin escapar nada, así que un
    // arg con espacios se parte al llegar a cmd.exe — y el home del usuario
    // puede tener uno. Quoteamos a mano lo que lo necesite.
    const q = (a) => (a !== "" && !/[\s"]/.test(a) ? a : `"${a.replace(/"/g, '""')}"`)
    const r = spawnSync(q(rest[0]), rest.slice(1).map(q), {
      stdio: "inherit",
      shell: true, // en Windows los bins de node_modules son .cmd
      env: { ...process.env, ...vars },
    })
    process.exit(r.status ?? 1)
  }

  if (!OP) die("No encontré el CLI de 1Password (`op`). Instálalo con: winget install AgileBits.1Password.CLI")
  warn(`No existe ${opts.enc} — usando \`op run\` (va a pedir biometría). Corre \`node scripts/op-env.mjs encrypt\`.`)
  const r = spawnSync(OP, ["run", `--env-file=${opts.tpl}`, "--no-masking", "--", ...rest], {
    stdio: "inherit",
    shell: false,
  })
  process.exit(r.status ?? 1)
}

/**
 * 1Password -> archivo cifrado con age. Es el único paso que pide biometría, y
 * solo hace falta repetirlo cuando cambia algun secreto.
 *
 * El texto plano nunca toca el disco: `op inject` resuelve a memoria, age lo
 * recibe por stdin y devuelve el ciphertext (armored) por stdout.
 */
function cmdEncrypt(opts) {
  requireSignIn()
  const tplPath = resolve(process.cwd(), opts.tpl)
  const recipientsPath = resolve(process.cwd(), RECIPIENTS_FILE)
  if (!existsSync(tplPath)) die(`No existe ${opts.tpl}. Corre primero: node scripts/op-env.mjs push`)
  if (!existsSync(recipientsPath)) {
    die(`Falta ${RECIPIENTS_FILE} con la(s) clave(s) pública(s) de age.\n  El recipient sale de: age-keygen -y "${AGE_KEY_FILE}"`)
  }

  const resolved = op(["inject", "-i", tplPath])
  const count = parseEnvFile(resolved.stdout).filter((e) => e.type === "var").length
  if (count === 0) die("El template no resolvió ninguna variable.")

  const enc = age(["-e", "-a", "-R", recipientsPath], { input: resolved.stdout })
  writeFileSync(resolve(process.cwd(), opts.enc), enc.stdout, "utf8")

  ok(`${opts.enc} generado — ${count} variables cifradas con age`)
  console.log(c.dim(`  Descifra con la clave: ${AGE_KEY_FILE}`))
  console.log(c.dim("  A partir de aquí los comandos corren sin biometría."))
}

/** Materializa un .env real desde el template. Mismo motivo de PATH que cmdExec. */
function cmdPull(opts) {
  requireSignIn()
  op(["inject", "-i", opts.tpl, "-o", opts.env, "--force"])
  ok(`${opts.env} generado desde ${opts.tpl}`)
  console.log(c.dim("  Contiene secretos en claro. Sigue gitignorado — no lo commitees."))
}

/**
 * Borra el .env.local materializado al terminar la sesión de trabajo.
 *
 * El chequeo de seguridad es OFFLINE a propósito: compara las claves contra el
 * template, sin hablar con 1Password. Así no dispara un prompt biométrico justo
 * en el momento de limpiar, que es cuando menos ganas hay de que aparezca.
 */
function cmdPurge(opts) {
  const envPath = resolve(process.cwd(), opts.env)
  const tplPath = resolve(process.cwd(), opts.tpl)

  if (!existsSync(envPath)) {
    ok(`${opts.env} no existe — nada que borrar`)
    return
  }
  if (!existsSync(tplPath)) die(`No existe ${opts.tpl}: sin el template no habría cómo regenerar ${opts.env}.`)

  const envKeys = readEnv(opts.env).vars.map((v) => v.key)
  const tplKeys = new Set(
    parseEnvFile(readFileSync(tplPath, "utf8"))
      .filter((e) => e.type === "var")
      .map((v) => v.key),
  )
  const uncovered = envKeys.filter((k) => !tplKeys.has(k))
  if (uncovered.length) {
    fail(`No borro ${opts.env}: estas variables no están en el template y se perderían.`)
    for (const k of uncovered) console.log(`    ${k}`)
    console.log(c.dim(`\n  Guárdalas primero:  node scripts/op-env.mjs push\n`))
    process.exit(1)
  }

  rmSync(envPath)
  ok(`${opts.env} borrado — ${envKeys.length} variables siguen en 1Password`)
  console.log(c.dim("  Para volver a trabajar:  node scripts/op-env.mjs pull"))
}

function cmdDoctor(opts) {
  console.log(c.bold("\n1Password ↔ entorno local\n"))

  if (!OP) {
    fail("CLI `op` no encontrado — winget install AgileBits.1Password.CLI")
    return false
  }
  ok(`CLI encontrado (${op(["--version"]).stdout.trim()})`)

  if (!isSignedIn()) {
    fail("No logueado — 1Password → Settings → Developer → «Integrate with 1Password CLI»")
    console.log(c.dim("  Después de activarlo, desbloquea la app y vuelve a correr `node scripts/op-env.mjs doctor`.\n"))
    return false
  }
  ok(`Logueado como ${accountEmail()}`)

  const hasVault = vaultExists(opts.vault)
  if (hasVault) ok(`Vault «${opts.vault}» existe`)
  else warn(`Vault «${opts.vault}» todavía no existe — lo crea \`node scripts/op-env.mjs push\``)

  const hasItem = hasVault && itemExists(opts.vault, opts.item)
  if (hasItem) ok(`Item «${opts.item}» existe`)
  else warn(`Item «${opts.item}» todavía no existe — lo crea \`node scripts/op-env.mjs push\``)

  // Drift: variables que estan en .env.local pero no en el template, o al reves.
  const envPath = resolve(process.cwd(), opts.env)
  const tplPath = resolve(process.cwd(), opts.tpl)
  if (existsSync(envPath) && existsSync(tplPath)) {
    const envKeys = new Set(readEnv(opts.env).vars.map((v) => v.key))
    const tplKeys = new Set(
      parseEnvFile(readFileSync(tplPath, "utf8"))
        .filter((e) => e.type === "var")
        .map((v) => v.key),
    )
    const missingInTpl = [...envKeys].filter((k) => !tplKeys.has(k))
    const missingInEnv = [...tplKeys].filter((k) => !envKeys.has(k))
    if (missingInTpl.length) warn(`En .env.local pero no en el template: ${missingInTpl.join(", ")} → node scripts/op-env.mjs push`)
    if (missingInEnv.length) warn(`En el template pero no en .env.local: ${missingInEnv.join(", ")}`)
    if (!missingInTpl.length && !missingInEnv.length) ok("Template y .env.local están alineados")
  }

  // Solo tiene sentido resolver referencias si el item ya fue creado.
  const healthy = hasItem && existsSync(tplPath) ? cmdCheck(opts) : true
  if (!hasItem) console.log(c.dim("\n  Siguiente paso: node scripts/op-env.mjs push"))
  console.log()
  return healthy
}

// ---------------------------------------------------------------------------

const { command, opts } = parseArgs(process.argv.slice(2))

switch (command) {
  case "template":
    cmdTemplate(opts)
    break
  case "push":
    cmdPush(opts)
    break
  case "check":
    process.exit(cmdCheck(opts) ? 0 : 1)
    break
  case "doctor":
    process.exit(cmdDoctor(opts) ? 0 : 1)
    break
  case "sanitize":
    cmdSanitize(opts)
    break
  case "exec":
    cmdExec(opts)
    break
  case "pull":
    cmdPull(opts)
    break
  case "purge":
    cmdPurge(opts)
    break
  case "encrypt":
    cmdEncrypt(opts)
    break
  default:
    console.log(`
${c.bold("op-env")} — variables de entorno locales respaldadas por 1Password

  node scripts/op-env.mjs ${c.bold("template")}   Regenera .env.local.tpl desde .env.local (no requiere login)
  node scripts/op-env.mjs ${c.bold("push")}       Sube los secretos de .env.local a 1Password + regenera el template
  node scripts/op-env.mjs ${c.bold("check")}      Verifica que cada referencia op:// resuelva
  node scripts/op-env.mjs ${c.bold("doctor")}     Diagnóstico completo (op, login, vault, item, drift)
  node scripts/op-env.mjs ${c.bold("sanitize")}   Vacía los valores de un .env (solo si ya están en 1Password)
  node scripts/op-env.mjs ${c.bold("exec")} -- <cmd>  Corre <cmd> con los secretos inyectados en memoria
  node scripts/op-env.mjs ${c.bold("pull")}       Materializa .env.local desde el template
  node scripts/op-env.mjs ${c.bold("purge")}      Borra el .env.local materializado (chequeo offline)
  node scripts/op-env.mjs ${c.bold("encrypt")}    1Password → .env.local.age cifrado (para automode, sin biometría)

Flags
  --vault=<nombre>   default: ${DEFAULTS.vault}
  --item=<título>    default: ${DEFAULTS.item}
  --env=<path>       default: ${DEFAULTS.env}
  --tpl=<path>       default: ${DEFAULTS.tpl}
  --no-template      en push, no regenerar el template
  --from-op          en template, reconstruir desde 1Password en vez de .env.local

Este script nunca imprime valores de secretos, solo nombres de variables.
`)
    process.exit(command ? 1 : 0)
}
