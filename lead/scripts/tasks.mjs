/**
 * tasks.mjs — las tareas que el owner aprobó y el lead sigue hasta que estén hechas.
 *
 * El plan del día se archiva cada mañana; una tarea no. Nace cuando un pedido a
 * un agente sale hacia Linear con el sí del owner, y vive hasta que el cambio
 * está en producción (o se decide dejarla). Es lo que permite retomar mañana lo
 * que se pidió hoy, en vez de volver a proponerlo.
 */

import { readJson, statePath, writeJson } from "./lib.mjs"

/** En qué punto está una tarea. El orden es el camino normal de un pedido a Cody. */
export const TASK_STAGES = {
  dispatched: "esperando al agente",
  "pr-open": "con PR abierto",
  verifying: "en verificación",
  "needs-owner": "te espera a ti",
  merged: "mergeado, falta verificar",
  done: "hecho",
  dropped: "se dejó",
}
export const OPEN_STAGES = ["dispatched", "pr-open", "verifying", "needs-owner", "merged"]

export const loadTasks = () => readJson(statePath("tasks.json"), { version: 1, items: [] })
export const openTasks = (store = loadTasks()) => store.items.filter((t) => OPEN_STAGES.includes(t.stage))

function save(store) {
  store.updatedAt = new Date().toISOString()
  writeJson(statePath("tasks.json"), store)
}

/**
 * Abre una tarea cuando sale el pedido. Si ya había una viva para ese issue (un
 * reenvío, o una corrección sobre el mismo PR), no abre otra: vuelve a esperar
 * al agente y anota el pedido nuevo.
 */
export function startTask({ id, agent, comment = null, title = "", url = null, team = null, via = "chat" }) {
  const store = loadTasks()
  const now = new Date().toISOString()
  let task = store.items.find((t) => t.id === id && OPEN_STAGES.includes(t.stage))
  if (task) {
    Object.assign(task, { stage: "dispatched", stageAt: now, waitingOn: agent, dispatches: (task.dispatches ?? 1) + 1 })
    task.notes.push({ at: now, text: `Nuevo pedido a ${agent}${comment ? `: ${comment}` : ""}` })
  } else {
    task = {
      id,
      team: team ?? id.split("-")[0],
      title,
      url,
      agent,
      waitingOn: agent,
      comment,
      approvedAt: now,
      via,
      stage: "dispatched",
      stageAt: now,
      dispatches: 1,
      pr: null,
      notes: [],
      doneAt: null,
    }
    store.items.push(task)
  }
  save(store)
  return task
}

export function moveTask(id, stage, { pr = null, note = null, waitingOn = null } = {}) {
  if (!(stage in TASK_STAGES)) throw new Error(`Etapa inválida «${stage}» (válidas: ${Object.keys(TASK_STAGES).join(", ")})`)
  const store = loadTasks()
  const task = store.items.find((t) => t.id === id && OPEN_STAGES.includes(t.stage)) ?? store.items.filter((t) => t.id === id).at(-1)
  if (!task) throw new Error(`${id} no es una tarea en seguimiento. Las tareas nacen con «lead mark <n> dispatched».`)
  const now = new Date().toISOString()
  if (task.stage !== stage) Object.assign(task, { stage, stageAt: now })
  if (pr) task.pr = pr
  if (stage === "needs-owner") task.waitingOn = "owner"
  else if (waitingOn) task.waitingOn = waitingOn
  if (note) task.notes.push({ at: now, text: note })
  task.doneAt = stage === "done" || stage === "dropped" ? now : null
  save(store)
  return task
}

/**
 * Lo que el snapshot dice hoy de una tarea y el paso que sugiere. No decide
 * nada: el lead lee el hilo y actúa. Esto le ahorra armar el cuadro a mano.
 */
export function taskSignals(task, snap, now = Date.now()) {
  const issue = snap?.issues?.find((i) => i.id === task.id) ?? null
  // Un PR que el hilo menciona puede ser de otra cosa: Alfred corrigiendo el repo de
  // agentes desde el issue de un pedido a Cody. El PR de la tarea está en el repo de quien la hace.
  const team = issue?.team ?? task.team ?? null
  const sameRepo = (p) => (task.agent === "alfred" ? p.project === "agents" : !team || p.team === team)
  const mine = (p) => (task.pr && p.url === task.pr) || (sameRepo(p) && (p.issue === task.id || (issue?.prUrls ?? []).includes(p.url)))
  const openPrs = (snap?.prs?.open ?? []).filter(mine)
  const mergedPrs = (snap?.prs?.merged ?? []).filter(mine)
  const last = issue?.comments?.tail?.at(-1) ?? null
  const hours = (now - new Date(task.stageAt).getTime()) / 3_600_000

  let hint
  if (issue && !issue.open)
    hint =
      issue.stateType === "completed"
        ? "El issue ya está cerrado como hecho: cierra la tarea."
        : `El issue se cerró como «${issue.state}»: confirma en el hilo y deja la tarea.`
  else if (mergedPrs.length && !openPrs.length) hint = "El PR está mergeado: verifica que el deploy salió bien y que el cambio se ve en producción. Después cierra el issue y la tarea."
  else if (openPrs.some((p) => p.checks === "failing")) hint = "El PR tiene checks en rojo: pídele al agente que los arregle. Es la misma tarea, no hace falta otro sí."
  else if (openPrs.some((p) => p.checks === "pending")) hint = "Los checks están corriendo: vuelve a mirar en unos minutos."
  else if (openPrs.length)
    hint =
      task.stage === "needs-owner"
        ? "El PR está listo y espera al owner: recuérdaselo con el link y qué mirar."
        : "Hay PR con checks en verde. Si el cambio se ve, pídele a Qualy que pruebe el preview; si no, pásaselo al owner con un resumen de qué cambia."
  else if (task.stage === "dispatched" && task.agent === "local")
    hint = "La hace una sesión local de Claude Code, no un agente: no hay pedido que reenviar. Si no aparece un PR que nombre el issue, pregúntale al owner si la arrancó."
  else if (task.stage === "dispatched" && last?.kind === "bot" && last.at > task.stageAt) hint = "El agente respondió y no hay PR: lee el hilo. Puede ser una pregunta, un bloqueo o un diagnóstico."
  else if (task.stage === "dispatched" && hours > 3) hint = `Pasaron ${Math.round(hours)} h sin respuesta: la corrida probablemente falló. Reenvía el mismo pedido.`
  else if (task.stage === "dispatched") hint = "Dentro del tiempo normal de una corrida."
  else hint = "Sin cambios desde la última vez."

  // Lo que un agente ya tiene se tiene que ver «In Progress» en Linear: si no, no se sabe qué
  // se está trabajando.
  const notStarted = Boolean(issue?.open && ["backlog", "unstarted", "triage"].includes(issue.stateType))
  if (notStarted) hint = `El issue sigue en «${issue.state}»: pásalo a In Progress (act.mjs start --ids=${task.id} --actor=lead). ${hint}`

  return { issue, openPrs, mergedPrs, last, hours, hint, notStarted }
}
