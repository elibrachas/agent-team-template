/**
 * state.mjs — escrituras al estado local que comparten el CLI (lead.mjs) y act.mjs.
 *
 * El tablero tiene las suyas en server.mjs, porque además respetan la simulación.
 */

import { appendJsonl, readJson, statePath, writeJson } from "./lib.mjs"

/**
 * Una línea en el registro. `actor` dice quién decidió: "owner" (un click o un
 * «sí» en el chat) o "lead" (lo hizo por su cuenta, dentro de lo que
 * lead.config.json → autonomy permite). El brief sale de aquí.
 */
export function logDecision({ actor = "owner", via = "chat", action, issue = null, detail = null }) {
  appendJsonl(statePath("decisions.jsonl"), { at: new Date().toISOString(), actor, via, action, issue, detail })
}

const CLOSED = { done: ["Done", "completed"], canceled: ["Canceled", "canceled"], duplicate: ["Duplicate", "duplicate"] }

function patchPlan(fn) {
  const path = statePath("plan.json")
  const plan = readJson(path)
  if (!plan || !fn(plan)) return
  writeJson(path, plan)
  writeJson(statePath("history", `plan-${plan.date}.json`), plan)
}

/** Refleja en el snapshot y en el plan un cierre que Linear ya aceptó, sin esperar al próximo sync. */
export function reflectClose(ids, as) {
  const [state, stateType] = CLOSED[as]
  const snapPath = statePath("snapshot.json")
  const snap = readJson(snapPath)
  if (snap) {
    const now = new Date().toISOString()
    for (const i of snap.issues) if (ids.includes(i.id)) Object.assign(i, { state, stateType, open: false, patchedAt: now })
    writeJson(snapPath, snap)
  }
  patchPlan((plan) => {
    let touched = false
    for (const c of plan.closeBatch ?? []) if (ids.includes(c.id) && c.status === "pending") ((c.status = "done"), (touched = true))
    for (const x of plan.items ?? []) if (x.type === "close" && ids.includes(x.id) && x.status === "pending") ((x.status = "done"), (touched = true))
    return touched
  })
}

/** Refleja en el snapshot un cambio de estado que no cierra (por ejemplo, a In Progress). */
export function reflectMove(id, state, stateType) {
  const snapPath = statePath("snapshot.json")
  const snap = readJson(snapPath)
  if (!snap) return
  for (const i of snap.issues) if (i.id === id) Object.assign(i, { state, stateType, patchedAt: new Date().toISOString() })
  writeJson(snapPath, snap)
}

/** Lo contrario: un cierre que se deshizo. */
export function reflectReopen(id, state, stateType) {
  const snapPath = statePath("snapshot.json")
  const snap = readJson(snapPath)
  if (snap) {
    for (const i of snap.issues) if (i.id === id) Object.assign(i, { state, stateType, open: true, patchedAt: new Date().toISOString() })
    writeJson(snapPath, snap)
  }
  patchPlan((plan) => {
    let touched = false
    for (const c of plan.closeBatch ?? []) if (c.id === id && c.status === "done") ((c.status = "reopened"), (touched = true))
    return touched
  })
}
