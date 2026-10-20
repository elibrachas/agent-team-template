#!/usr/bin/env node
/**
 * start-dashboard.mjs — deja el tablero corriendo en segundo plano y vuelve.
 *
 *   node lead/scripts/start-dashboard.mjs           levanta (o reinicia) el tablero
 *   node lead/scripts/start-dashboard.mjs --open    y además lo abre en el navegador
 *   node lead/scripts/start-dashboard.mjs --stop    lo apaga
 *
 * Lo usa la rutina de la mañana: el tablero queda vivo aunque la sesión de
 * Claude que lo arrancó se cierre, sin ventana de consola, y siempre con el
 * código y la key del día (si ya había uno corriendo, lo reemplaza).
 *
 * La key se descifra aquí, en primer plano, y el tablero la recibe por entorno:
 * así el proceso que queda corriendo no necesita abrir otra consola.
 */

import { spawn } from "node:child_process"
import { join } from "node:path"
import { LEAD_DIR, dropUnneededSecrets, ensureEnv } from "./lib.mjs"

ensureEnv(["LINEAR_API_KEY"], import.meta.url, { optional: true })
dropUnneededSecrets(["LINEAR_API_KEY"])

const port = Number(process.argv.find((a) => a.startsWith("--port="))?.slice(7) ?? process.env.LEAD_PORT ?? 4747)
const url = `http://127.0.0.1:${port}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ping = async () => (await fetch(`${url}/api/ping`, { signal: AbortSignal.timeout(1000) })).json()

if (process.argv.includes("--stop")) {
  try {
    const running = await ping()
    if (running.app === "project-lead") {
      process.kill(running.pid)
      console.log(`✓ tablero apagado (estaba en ${url})`)
    }
  } catch {
    console.log("No había ningún tablero corriendo.")
  }
  process.exit(0)
}

const args = [join(LEAD_DIR, "app", "server.mjs"), "--replace", `--port=${port}`]
if (process.argv.includes("--open")) args.push("--open")
if (process.argv.includes("--dry-run")) args.push("--dry-run")

const child = spawn(process.execPath, args, {
  detached: true,
  stdio: "ignore",
  windowsHide: true,
  env: { ...process.env, LEAD_ENV_REEXEC: "1" },
})
child.unref()

for (let i = 0; i < 60; i++) {
  await sleep(250)
  try {
    const up = await ping()
    if (up.app === "project-lead" && up.pid === child.pid) {
      const linear = up.dryRun ? "simulación, no escribe" : up.linear.ok ? `conectado como ${up.linear.viewer}` : `solo lectura (${up.linear.reason})`
      console.log(`✓ tablero corriendo en ${url} — Linear: ${linear}`)
      process.exit(0)
    }
  } catch {
    // todavía arrancando
  }
}
console.error(`✗ El tablero no respondió en 15 segundos. Prueba en primer plano para ver el error: node lead/app/server.mjs`)
process.exit(1)
