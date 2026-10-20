/*
 * app.js — front del tablero del Project Lead.
 *
 * Regla de seguridad: los títulos y comentarios vienen de Linear (texto escrito
 * por agentes). Nunca entran al DOM como HTML: todo pasa por h(), que solo crea
 * nodos de texto. Los links se filtran con safeUrl().
 */

const TOKEN = document.querySelector('meta[name="lead-token"]').content
const TABS = [
  ["hoy", "Hoy"],
  ["bandeja", "Bandeja"],
  ["proyectos", "Proyectos"],
  ["agentes", "Agentes"],
  ["registro", "Registro"],
]
const VERDICT_ORDER = ["do", "decide", "untriaged", "blocked", "later", "close", "archive"]
const VERDICT_TITLE = {
  do: "Para hacer",
  decide: "Necesitan una decisión tuya",
  untriaged: "Sin triar todavía",
  blocked: "Bloqueados por algo externo",
  later: "Después",
  close: "Recomiendo cerrar",
  archive: "Registros para archivar",
}
const VERDICT_NOTE = {
  do: "Ordenados por puntaje: impacto por evidencia, dividido por esfuerzo.",
  untriaged: "Entraron después del último triage. El lead los ordena mañana a primera hora.",
  archive: "Reportes y planes ya leídos. No piden decisión.",
}
const LEVELS = ["", "bajo", "medio", "alto"]

const S = {
  data: null,
  tab: location.hash.slice(1) || localStorage.getItem("lead-tab") || "hoy",
  filters: { team: "", verdict: "", objective: "", source: "", q: "", records: false },
  shown: {},
}

// ------------------------------------------------------------------ helpers

function h(tag, props, ...kids) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue
    if (k === "class") el.className = v
    else if (k === "text") el.textContent = v
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v)
    else if (k === "data") for (const [dk, dv] of Object.entries(v)) el.dataset[dk] = dv
    else if (k === "vars") for (const [sk, sv] of Object.entries(v)) el.style.setProperty(sk, sv)
    else if (["value", "checked", "disabled", "selected", "open", "readOnly", "type", "href", "title", "id", "placeholder", "rows"].includes(k)) el[k] = v
    else el.setAttribute(k, v === true ? "" : v)
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)))
  }
  return el
}

const safeUrl = (u) => (typeof u === "string" && /^https:\/\/(linear\.app|github\.com)\//.test(u) ? u : null)

function link(label, url, props = {}) {
  const href = safeUrl(url)
  return href ? h("a", { href, target: "_blank", rel: "noopener noreferrer", ...props }, label) : h("span", props, label)
}

const proj = (team) => (team ? h("span", { class: "proj", data: { team } }, team) : null)

function ago(iso) {
  if (!iso) return ""
  const min = (Date.now() - new Date(iso).getTime()) / 60000
  if (min < 60) return `hace ${Math.max(1, Math.round(min))} min`
  if (min < 60 * 24) return `hace ${Math.round(min / 60)} h`
  return `hace ${Math.round(min / 1440)} d`
}

const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
const longDate = (d) => new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long" }).format(d)
const cut = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim()
  return t.length > n ? t.slice(0, n - 1) + "…" : t
}
const agentName = (key) => S.data.agents[key]?.name ?? (key === "code" ? "Claude Code" : key === "owner" ? "tú" : key === "agente" ? "un agente" : key === "human" ? "una persona" : (key ?? "—"))

let toastTimer
function toast(msg) {
  const el = document.getElementById("toast")
  el.textContent = msg
  el.classList.add("show")
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove("show"), 5200)
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

async function post(path, body) {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Lead-Token": TOKEN },
    body: JSON.stringify(body ?? {}),
  })
  return r.json()
}

/**
 * Ejecuta una acción del tablero. Si Linear está en solo lectura y la acción
 * era un comentario, lo deja en el portapapeles: el click nunca se pierde.
 */
async function act(body, { ok, button, fallback } = {}) {
  if (button) button.disabled = true
  try {
    // Con cada acción va la versión del plan que se está mirando: si cambió, el servidor no la ejecuta.
    const res = await post("/api/action", { ...body, planAt: S.data.plan?.generatedAt ?? null })
    if (res.state) S.data = res.state
    if (res.ok) toast(res.result?.dryRun ? `Simulado, no se escribió nada: ${ok}` : ok)
    else if (res.code === "linear-unavailable" && fallback) {
      const copied = await copy(fallback.text)
      toast(copied ? `Linear está en solo lectura. Copié el texto: pégalo en ${fallback.issue}.` : `Linear está en solo lectura. Abre ${fallback.issue} y pega el comentario a mano.`)
    } else toast(res.error ?? "No se pudo completar la acción.")
    render()
    return res
  } catch {
    toast("El tablero no responde. Fíjate si el servidor sigue corriendo.")
  } finally {
    if (button) button.disabled = false
  }
}

// ------------------------------------------------------------------- marco

function renderChrome() {
  const { meta, snapshot, plan } = S.data
  document.getElementById("today").textContent = longDate(new Date()).replace(/^./, (c) => c.toUpperCase())
  document.getElementById("freshness").textContent = snapshot ? `Datos de Linear de ${ago(snapshot.generatedAt)}` : "Todavía no hay datos de Linear"

  const notices = document.getElementById("notices")
  notices.replaceChildren()
  const notice = (cls, ...kids) => notices.append(h("div", { class: `notice ${cls}` }, h("span", { class: `status ${cls === "critical" ? "alert" : "warn"}` }), h("p", null, ...kids)))
  if (!meta.dryRun && !meta.linear.ok)
    notice(
      "critical",
      meta.linear.reason === "sin key" ? "El tablero arrancó sin la key de Linear" : "Linear rechazó la key",
      ", así que está en solo lectura. Puedes leer todo; cada acción te deja el texto copiado para pegarlo en Linear. Para arreglarlo: rota ",
      h("code", null, "LINEAR_API_KEY"),
      " donde guardas los secretos (con op-env: en 1Password y después ",
      h("code", null, "npm run env:encrypt"),
      ") y reinicia el tablero.",
    )
  if (meta.dryRun) notice("", "Modo simulación: estás sobre una copia. Puedes probar todos los botones; nada se escribe en Linear ni queda guardado.")
  if (snapshot && snapshot.source !== "linear-api")
    notice("", "Los datos de hoy vienen de una carga parcial: faltan descripciones, comentarios y «quién tiene la pelota». Se completan en el primer sync con una key válida.")
  if (snapshot && meta.snapshotAgeMinutes > 60 * 20) notice("", "Los datos tienen más de 20 horas. Toca «Actualizar datos» antes de decidir.")
  if (plan && plan.date !== localDate()) notice("", `El plan que ves es del ${longDate(new Date(plan.date + "T12:00:00"))}. Todavía no hay plan para hoy.`)

  const openWork = snapshot ? snapshot.issues.filter((i) => i.class === "work").length : 0
  const list = document.getElementById("tablist")
  list.replaceChildren(
    ...TABS.map(([key, label]) =>
      h(
        "button",
        {
          class: "tab",
          role: "tab",
          type: "button",
          "aria-selected": String(S.tab === key),
          onclick: () => {
            S.tab = key
            localStorage.setItem("lead-tab", key)
            history.replaceState(null, "", `#${key}`)
            render()
          },
        },
        label,
        key === "bandeja" && openWork ? h("span", { class: "count" }, openWork) : null,
      ),
    ),
  )
}

function emptyState(title, body) {
  return h("div", { class: "sheet empty-state" }, h("h2", null, title), h("p", null, body))
}

/** Un comentario se revisa entero antes de enviarlo: la caja crece hasta mostrarlo completo. */
function autosize(root = document) {
  for (const ta of root.querySelectorAll("textarea")) {
    ta.style.setProperty("height", "auto")
    ta.style.setProperty("height", `${Math.min(ta.scrollHeight + 2, 420)}px`)
  }
}

function render() {
  if (!S.data) return
  renderChrome()
  const views = { hoy: viewToday, bandeja: viewInbox, proyectos: viewProjects, agentes: viewAgents, registro: viewLog }
  document.getElementById("main").replaceChildren((views[S.tab] ?? viewToday)())
  autosize()
}

// --------------------------------------------------------------------- Hoy

const isResolved = (x) => x.status === "done" || x.status === "dispatched"

const TYPE_LABEL = {
  dispatch: (x) => `Va a ${agentName(x.agent)}`,
  decide: () => "Decides tú",
  you: () => "Lo haces tú",
  review: () => "Revisas y mergeas",
  code: () => "Se hace en Claude Code",
  close: () => "Se cierra",
}

function planAction(x) {
  const skip = h("button", { class: "btn quiet", type: "button", onclick: (e) => act({ type: "planStatus", planItem: x.n, status: "skipped" }, { ok: "Salteado por hoy", button: e.target }) }, "Saltear hoy")
  const done = (label = "Marcar hecho") =>
    h("button", { class: "btn", type: "button", onclick: (e) => act({ type: "planStatus", planItem: x.n, status: "done" }, { ok: "Hecho", button: e.target }) }, label)
  const open = x.url ? link("Abrir en Linear", x.url, { class: "btn quiet" }) : null
  const links = (x.links ?? []).map((l) => link(l.label, l.url, { class: "btn quiet" }))

  if (x.type === "dispatch") {
    const ta = h("textarea", { value: x.comment ?? "", "aria-label": `Comentario para ${agentName(x.agent)}` })
    return [
      ta,
      h(
        "div",
        { class: "btn-row" },
        h(
          "button",
          {
            class: "btn",
            type: "button",
            onclick: (e) =>
              act(
                { type: "dispatch", issue: x.id, agent: x.agent, comment: ta.value, planItem: x.n },
                { ok: `Enviado a ${agentName(x.agent)} en ${x.id}`, button: e.target, fallback: { text: ta.value, issue: x.id } },
              ),
          },
          `Enviar a ${agentName(x.agent)}`,
        ),
        open,
        skip,
      ),
    ]
  }

  if (x.type === "decide") {
    return [
      x.question ? h("p", null, x.question) : null,
      h(
        "div",
        { class: "btn-row" },
        ...(x.options ?? []).map((o) =>
          h(
            "button",
            {
              class: "btn",
              type: "button",
              title: o.comment ? `Comenta en ${x.id}: ${cut(o.comment, 160)}` : null,
              onclick: (e) =>
                act(
                  { type: "decide", planItem: x.n, choice: o.label, comment: o.comment ?? null, issue: x.id },
                  { ok: `Decidido: ${o.label}`, button: e.target, fallback: o.comment ? { text: o.comment, issue: x.id } : null },
                ),
            },
            o.label,
          ),
        ),
        open,
        skip,
      ),
    ]
  }

  if (x.type === "code") {
    const ta = h("textarea", { value: x.prompt ?? "", readOnly: true, "aria-label": "Prompt para Claude Code" })
    return [
      ta,
      h(
        "div",
        { class: "btn-row" },
        h("button", { class: "btn", type: "button", onclick: async () => toast((await copy(ta.value)) ? "Prompt copiado. Pégalo en una sesión nueva de Claude Code." : "No pude copiar: selecciona el texto a mano.") }, "Copiar prompt"),
        done(),
        open,
        skip,
      ),
    ]
  }

  if (x.type === "close") {
    const label = { canceled: "Cerrar como cancelado", duplicate: `Cerrar como duplicado${x.dupOf ? " de " + x.dupOf : ""}`, done: "Cerrar como hecho" }[x.closeAs] ?? "Cerrar"
    return [
      h(
        "div",
        { class: "btn-row" },
        h("button", { class: "btn", type: "button", onclick: (e) => act({ type: "close", issue: x.id, as: x.closeAs, dupOf: x.dupOf, planItem: x.n }, { ok: `${x.id} cerrado`, button: e.target }) }, label),
        open,
        skip,
      ),
    ]
  }

  // you / review
  return [
    x.steps?.length ? h("ol", { class: "steps" }, ...x.steps.map((s) => h("li", null, s))) : null,
    h("div", { class: "btn-row" }, done(), ...links, open, skip),
  ]
}

function planItem(x, isNext) {
  const resolved = isResolved(x)
  const cls = ["plan-item", resolved ? "is-done" : "", x.status === "skipped" ? "is-skipped" : "", isNext ? "is-next" : ""].join(" ")
  const body = [h("h3", { class: "plan-title" }, h("span", null, x.title))]
  const meta = h(
    "div",
    { class: "plan-meta" },
    proj(x.team),
    x.id ? link(x.id, x.url) : null,
    h("span", null, TYPE_LABEL[x.type]?.(x) ?? x.type),
    x.minutes && !resolved ? h("span", null, `${x.minutes} min tuyos`) : null,
    x.status === "dispatched" ? h("span", { class: "status good" }, "Enviado") : null,
    x.status === "done" ? h("span", { class: "status good" }, "Hecho") : null,
    x.status === "skipped" ? h("span", { class: "status info" }, "Salteado hoy") : null,
  )

  if (resolved || x.status === "skipped") {
    body.push(
      h(
        "div",
        { class: "btn-row", style: null },
        h("button", { class: "btn quiet", type: "button", onclick: (e) => act({ type: "planStatus", planItem: x.n, status: "pending" }, { ok: "Volvió a pendientes", button: e.target }) }, "Volver a pendiente"),
      ),
    )
  } else {
    body.push(
      h("p", { class: "plan-why" }, x.why),
      // Qué miró el lead hoy contra la fuente antes de proponerlo, y qué no pudo verificar.
      x.checked ? h("p", { class: "plan-why" }, h("b", null, "Verificado hoy. "), x.checked) : null,
      h("div", { class: "plan-action" }, ...planAction(x)),
    )
  }
  return h("li", { class: cls }, h("div", { class: "plan-num", "aria-hidden": "true" }, x.n), h("div", null, meta, ...body))
}

function viewToday() {
  const { plan, snapshot } = S.data
  if (!plan)
    return emptyState(
      "Todavía no hay plan",
      "El lead lo arma cada mañana. Para tenerlo ahora, abre Claude Code en este repo y escribe «arma el plan de hoy». Mientras tanto, la Bandeja muestra todo lo que está abierto.",
    )

  const items = plan.items
  const next = items.find((x) => x.status === "pending")
  const resolved = items.filter(isResolved).length
  const left = items.filter((x) => x.status === "pending").reduce((a, x) => a + (x.minutes ?? 5), 0)

  const budget = h(
    "div",
    { class: "budget" },
    h(
      "div",
      { class: "budget-bar", role: "img", "aria-label": `${resolved} de ${items.length} acciones resueltas` },
      ...items.map((x) =>
        h("div", {
          class: `budget-seg ${isResolved(x) ? "done" : x.status === "skipped" ? "skipped" : x === next ? "next" : ""}`,
          vars: { "--w": String(x.minutes ?? 5) },
          title: `${x.n}. ${cut(x.title, 80)} (${x.minutes ?? 5} min)`,
        }),
      ),
    ),
    h(
      "p",
      { class: "budget-label" },
      items.length === resolved
        ? `Las ${items.length} acciones de hoy están resueltas.`
        : `${resolved} de ${items.length} acciones resueltas. Te quedan unos ${left} minutos de atención.`,
    ),
  )

  const main = h(
    "div",
    null,
    plan.headline ? h("p", { class: "headline" }, plan.headline) : null,
    budget,
    plan.focus?.length ? h("ul", { class: "focus-lines" }, ...plan.focus.map((f) => h("li", null, proj(f.team), h("span", null, f.text)))) : null,
    h("ol", { class: "plan sheet" }, ...items.map((x) => planItem(x, x === next))),
    plan.notes ? h("p", { class: "plan-why", style: null }, plan.notes) : null,
  )

  return h("div", { class: "today" }, main, rail(plan, snapshot))
}

function rail(plan, snapshot) {
  // 0 — Lo que ya aprobaste y el lead sigue hasta que esté hecho
  const OPEN_STAGES = ["dispatched", "pr-open", "verifying", "needs-owner", "merged"]
  const flying = (S.data.tasks ?? []).filter((t) => OPEN_STAGES.includes(t.stage))
  const tasks = flying.map((t) =>
    h(
      "li",
      null,
      h("span", null, proj(t.team), " ", link(t.id, t.url)),
      h("span", null, cut(t.title, 90)),
      h(
        "span",
        { class: "line-2" },
        h("span", { class: `status ${t.stage === "needs-owner" ? "warn" : "info"}` }, S.data.taskStages?.[t.stage] ?? t.stage),
        ` ${ago(t.stageAt)} · ${agentName(t.agent)}`,
      ),
      t.pr ? h("span", { class: "line-2" }, link("Ver el pull request", t.pr)) : null,
    ),
  )

  // 1 — Lo que te espera a ti
  const waiting = []
  for (const p of (snapshot?.prs?.open ?? []).filter((p) => !p.draft).sort((a, b) => b.ageDays - a.ageDays))
    waiting.push(
      h(
        "li",
        null,
        h("span", null, proj(p.team), " ", link(`${p.repo.split("/")[1]} #${p.number}`, p.url)),
        h("span", null, cut(p.title, 90)),
        h("span", { class: "line-2" }, `Pull request abierto ${p.ageDays === 0 ? "hoy" : `hace ${p.ageDays} d`}; checks: ${{ passing: "pasan", failing: "fallan", pending: "corriendo", none: "sin checks" }[p.checks]}`),
      ),
    )
  // Solo trabajo que sigue vivo: en un reporte, un último comentario de un agente no espera nada.
  const answered = (snapshot?.issues ?? [])
    .filter((i) => i.class === "work" && i.ball?.with === "owner" && i.comments?.lastKind === "bot")
    .filter((i) => !["close", "archive", "later"].includes(S.data.triage.items[i.id]?.verdict))
    .sort((a, b) => b.ball.since.localeCompare(a.ball.since))
  for (const i of answered.slice(0, 8))
    waiting.push(
      h(
        "li",
        null,
        h("span", null, proj(i.team), " ", link(i.id, i.url)),
        h("span", null, cut(i.title, 90)),
        h("span", { class: "line-2" }, `${agentName(i.ball.agent)} dejó el último comentario ${ago(i.ball.since)}`),
      ),
    )
  for (const i of (snapshot?.issues ?? []).filter((i) => i.ball?.with === "agent" && Date.now() - new Date(i.ball.since).getTime() > 3 * 3600_000))
    waiting.push(
      h(
        "li",
        null,
        h("span", null, proj(i.team), " ", link(i.id, i.url)),
        h("span", { class: "status warn" }, `${agentName(i.ball.agent)} no respondió`),
        h("span", { class: "line-2" }, `Lo llamaste ${ago(i.ball.since)}. Suele ser una corrida caída: vuelve a comentar para reintentar.`),
      ),
    )

  // 2 — Señales
  const signals = (plan.signals ?? []).map((s) =>
    h(
      "li",
      null,
      h("span", null, proj(s.team), " ", h("span", { class: `status ${s.level ?? "info"}` }, { alert: "Urgente", serious: "Serio", warn: "Atención", good: "Bien", info: "Dato" }[s.level ?? "info"])),
      h("span", null, s.text),
      s.issue ? h("span", { class: "line-2" }, link(s.issue, `https://linear.app/${S.data.config.linearWorkspace ?? "tu-workspace"}/issue/${s.issue}`)) : null,
    ),
  )

  // 3 — Cierres. Lo de bajo riesgo lo cierra el lead cuando la app se lo permite; si no,
  // queda aquí junto con lo que es decisión del owner, y sale todo con un click suyo.
  const pending = (plan.closeBatch ?? []).filter((c) => c.status === "pending").sort((a, b) => (a.lane === "auto") - (b.lane === "auto"))
  const autoLeft = pending.filter((c) => c.lane === "auto").length
  const askLeft = pending.length - autoLeft
  const today = localDate()
  const autoDone = S.data.decisions.filter((d) => d.actor === "lead" && /^close-/.test(d.action) && !d.dryRun && localDate(new Date(d.at)) === today).length
  const autoNote = autoDone ? `Hoy el lead ya cerró ${autoDone} por su cuenta. Están en Registro.` : ""
  const batchNote = [
    askLeft ? `${askLeft} ${askLeft === 1 ? "es decisión tuya" : "son decisión tuya"}: cosas que no se hicieron y conviene cerrar.` : null,
    autoLeft ? `${autoLeft} ${autoLeft === 1 ? "es" : "son"} de bajo riesgo: reportes ya leídos, avisos vencidos y cosas que ya están hechas.` : null,
    "Desmarca lo que no quieras cerrar.",
  ]
    .filter(Boolean)
    .join(" ")
  const boxes = pending.map((c) => ({ c, box: h("input", { type: "checkbox", checked: true }) }))
  const closer = pending.length
    ? h(
        "details",
        null,
        h("summary", { class: "small" }, `Ver los ${pending.length} y elegir`),
        h(
          "div",
          { class: "batch-list" },
          ...boxes.map(({ c, box }) =>
            h(
              "label",
              null,
              box,
              h(
                "span",
                null,
                h("b", null, c.id),
                c.lane === "auto" ? null : " ",
                c.lane === "auto" ? null : h("span", { class: "status warn" }, "decisión tuya"),
                ` ${cut(c.title, 80)} `,
                h("span", { class: "muted" }, `— ${{ canceled: "cancelar", duplicate: `duplicado de ${c.dupOf ?? "otro"}`, done: "dar por hecho" }[c.as]}: ${c.why}`),
              ),
            ),
          ),
        ),
      )
    : null

  return h(
    "aside",
    { class: "rail" },
    h(
      "section",
      { class: "sheet" },
      h("h2", null, "En marcha"),
      tasks.length ? h("ul", { class: "rail-list" }, ...tasks) : h("p", { class: "empty" }, "Ninguna tarea en seguimiento. Cuando apruebas un pedido, el lead lo sigue hasta que esté en producción."),
    ),
    h("section", { class: "sheet" }, h("h2", null, "Te esperan"), waiting.length ? h("ul", { class: "rail-list" }, ...waiting) : h("p", { class: "empty" }, "No hay pull requests ni respuestas de agentes esperándote.")),
    h("section", { class: "sheet" }, h("h2", null, "Señales"), signals.length ? h("ul", { class: "rail-list" }, ...signals) : h("p", { class: "empty" }, "Sin señales nuevas en los reportes de hoy.")),
    h(
      "section",
      { class: "sheet" },
      h("h2", null, "Propongo cerrar"),
      autoNote ? h("p", { class: "empty" }, autoNote) : null,
      pending.length
        ? [
            h("p", { class: "empty" }, batchNote),
            closer,
            h(
              "div",
              { class: "btn-row", style: null },
              h(
                "button",
                {
                  class: "btn",
                  type: "button",
                  onclick: async (e) => {
                    const ids = boxes.filter((b) => b.box.checked).map((b) => b.c.id)
                    if (!ids.length) return toast("No hay ninguno tildado.")
                    const res = await act({ type: "closeBatch", ids }, { ok: `Cerrados ${ids.length}`, button: e.target })
                    if (res?.ok && res.result.failed?.length) toast(`Cerré ${res.result.done.length}; fallaron ${res.result.failed.length}. Prueba de nuevo con los que quedan.`)
                  },
                },
                "Cerrar los tildados",
              ),
            ),
          ]
        : h("p", { class: "empty" }, "Nada espera tu sí para cerrarse."),
    ),
  )
}

// ----------------------------------------------------------------- Bandeja

function entryOf(i) {
  return S.data.triage.items[i.id] ?? null
}

function inboxRows() {
  const f = S.filters
  const q = f.q.trim().toLowerCase()
  return S.data.snapshot.issues
    .filter((i) => f.records || i.class === "work")
    .filter((i) => !f.team || i.team === f.team)
    .filter((i) => !f.source || i.source === f.source)
    .map((i) => ({ i, t: entryOf(i) }))
    .filter(({ t }) => !f.verdict || (t?.verdict ?? "untriaged") === f.verdict)
    .filter(({ t }) => !f.objective || t?.objective === f.objective)
    .filter(({ i, t }) => !q || `${i.id} ${i.title} ${t?.why ?? ""} ${t?.cluster ?? ""}`.toLowerCase().includes(q))
}

function rowBody(i, t) {
  const dl = h("dl", null)
  const add = (k, v) => v && dl.append(h("dt", null, k), h("dd", null, v))
  add("Por qué", t?.why)
  add("Próximo paso", t?.next)
  add("Pregunta", t?.question)
  add("Bloqueado por", t?.blockedBy)
  add("Objetivo", t?.objective ? S.data.config.objectives[t.objective]?.label : null)
  add("Frente", t?.cluster)
  add("Origen", `${agentName(i.source)}, ${i.ageDays === 0 ? "hoy" : `hace ${i.ageDays} d`}; sin movimiento hace ${i.idleDays} d`)
  add("Qué propone", i.sections?.propuesta || i.summary)
  const last = i.comments?.tail?.at(-1)
  add("Último comentario", last ? `${last.kind === "bot" ? agentName(last.agent) : "Tú"}, ${ago(last.at)}: ${last.text}` : null)
  if (t?.overriddenBy) add("Tu corrección", `Lo pasaste de «${S.data.verdicts[t.overriddenFrom] ?? "sin triar"}» a «${S.data.verdicts[t.verdict]}»${t.overrideNote ? `: ${t.overrideNote}` : ""}`)

  const owner = t?.owner in S.data.agents ? t.owner : null
  const draft = t?.next && /^\s*\w+\s*:/.test(t.next) ? t.next : owner ? `${agentName(owner)}: ` : ""
  const ta = owner ? h("textarea", { value: draft, "aria-label": `Comentario para ${agentName(owner)}` }) : null

  const closeAs = h("select", { "aria-label": "Cómo cerrarlo" }, h("option", { value: "canceled" }, "cancelado"), h("option", { value: "duplicate" }, "duplicado"), h("option", { value: "done" }, "hecho"))
  if (t?.closeAs) closeAs.value = t.closeAs
  const verdict = h("select", { "aria-label": "Cambiar veredicto" }, ...Object.entries(S.data.verdicts).map(([k, label]) => h("option", { value: k, selected: t?.verdict === k }, label)))

  return h(
    "div",
    { class: "row-body" },
    dl,
    ta,
    h(
      "div",
      { class: "btn-row" },
      owner
        ? h(
            "button",
            {
              class: "btn",
              type: "button",
              onclick: (e) => act({ type: "dispatch", issue: i.id, agent: owner, comment: ta.value }, { ok: `Enviado a ${agentName(owner)} en ${i.id}`, button: e.target, fallback: { text: ta.value, issue: i.id } }),
            },
            `Enviar a ${agentName(owner)}`,
          )
        : null,
      i.stateType === "backlog" ? h("button", { class: "btn quiet", type: "button", onclick: (e) => act({ type: "accept", issue: i.id }, { ok: `${i.id} pasó a Todo`, button: e.target }) }, "Mover a Todo") : null,
      link("Abrir en Linear", i.url, { class: "btn quiet" }),
    ),
    h(
      "div",
      { class: "btn-row" },
      h("label", { class: "small muted" }, "Cerrar como ", closeAs),
      h("button", { class: "btn danger", type: "button", onclick: (e) => act({ type: "close", issue: i.id, as: closeAs.value, dupOf: t?.dupOf ?? null }, { ok: `${i.id} cerrado`, button: e.target }) }, "Cerrar"),
      h("label", { class: "small muted" }, "No coincido, es ", verdict),
      h("button", { class: "btn quiet", type: "button", onclick: (e) => act({ type: "override", issue: i.id, verdict: verdict.value }, { ok: "Anotado. El lead lo toma mañana.", button: e.target }) }, "Corregir veredicto"),
    ),
  )
}

function inboxRow({ i, t }) {
  const facts = []
  if (t?.verdict === "do") {
    if (t.urgent) facts.push(h("span", { class: "status alert" }, "Urgente"))
    facts.push(h("span", { class: "chip" }, `impacto ${LEVELS[t.impact] ?? "?"}, esfuerzo ${LEVELS[t.effort] ?? "?"}`))
    if (t.owner) facts.push(h("span", { class: "chip solid" }, agentName(t.owner)))
  } else if (t?.verdict === "close") facts.push(h("span", { class: "chip" }, { canceled: "cancelar", duplicate: `dup. de ${t.dupOf ?? "?"}`, done: "ya está hecho" }[t.closeAs] ?? "cerrar"))
  facts.push(h("span", { class: "chip" }, i.ageDays === 0 ? "hoy" : `${i.ageDays} d`))

  const row = h("details", { class: "row" }, h("summary", null, proj(i.team), h("span", { class: "id" }, i.id), h("span", { class: "title" }, i.title), h("span", { class: "facts" }, ...facts)))
  // El detalle se arma recién al abrir: la bandeja puede tener cientos de filas.
  row.addEventListener("toggle", () => {
    if (row.open && row.childElementCount === 1) {
      row.append(rowBody(i, t))
      autosize(row)
    }
  })
  return row
}

function viewInbox() {
  const { snapshot, config, agents } = S.data
  if (!snapshot) return emptyState("Sin datos de Linear", "Toca «Actualizar datos» para bajar los issues abiertos.")
  const f = S.filters
  const rerender = () => render()
  const sel = (key, label, options) =>
    h(
      "label",
      null,
      label,
      h(
        "select",
        { onchange: (e) => ((f[key] = e.target.value), rerender()) },
        h("option", { value: "" }, "todos"),
        ...options.map(([v, l]) => h("option", { value: v, selected: f[key] === v }, l)),
      ),
    )
  const records = snapshot.issues.filter((i) => i.class !== "work").length
  const search = h("input", { type: "search", placeholder: "Buscar por título, id o motivo", value: f.q, "aria-label": "Buscar" })
  search.addEventListener("input", () => {
    f.q = search.value
    const pos = search.selectionStart
    render()
    const again = document.querySelector('.filters input[type="search"]')
    again.focus()
    again.setSelectionRange(pos, pos)
  })

  const filters = h(
    "div",
    { class: "filters" },
    search,
    sel("team", "Proyecto", config.projects.map((p) => [p.teamKey, p.name])),
    sel("verdict", "Veredicto", VERDICT_ORDER.map((v) => [v, VERDICT_TITLE[v]])),
    sel("objective", "Objetivo", Object.entries(config.objectives).map(([k, o]) => [k, o.label])),
    sel("source", "Origen", Object.entries(agents).map(([k, a]) => [k, a.name])),
    h("label", null, h("input", { type: "checkbox", checked: f.records, onchange: (e) => ((f.records = e.target.checked), rerender()) }), `Incluir los ${records} registros`),
  )

  const rows = inboxRows()
  const groups = new Map(VERDICT_ORDER.map((v) => [v, []]))
  for (const r of rows) groups.get(r.t?.verdict ?? "untriaged")?.push(r)
  groups.get("do").sort((a, b) => (b.t.score ?? 0) - (a.t.score ?? 0))

  const out = [filters]
  for (const [v, list] of groups) {
    if (!list.length) continue
    const limit = S.shown[v] ?? 25
    out.push(h("div", { class: "group-head" }, h("h2", null, `${VERDICT_TITLE[v]} (${list.length})`), VERDICT_NOTE[v] ? h("span", { class: "group-note" }, VERDICT_NOTE[v]) : null))
    out.push(...list.slice(0, limit).map(inboxRow))
    if (list.length > limit)
      out.push(h("div", { class: "more" }, h("button", { class: "btn quiet", type: "button", onclick: () => ((S.shown[v] = limit + 50), render()) }, `Mostrar ${Math.min(50, list.length - limit)} más`)))
  }
  if (!rows.length) out.push(h("div", { class: "empty-state" }, h("h2", null, "Nada con esos filtros"), h("p", null, "Prueba quitando alguno, o marca «Incluir los registros».")))
  return h("div", { class: "sheet" }, ...out)
}

// --------------------------------------------------------------- Proyectos

function viewProjects() {
  const { snapshot, config, triage, plan } = S.data
  if (!snapshot) return emptyState("Sin datos de Linear", "Toca «Actualizar datos».")
  return h(
    "div",
    { class: "projects" },
    ...config.projects.map((p) => {
      const s = snapshot.stats.byTeam[p.teamKey]
      const c = s.openByClass ?? {}
      const work = c.work ?? 0
      const record = c.record ?? 0
      const flow = c.flow ?? 0
      const net = s.created7d - s.done7d - s.canceled7d
      const todo = snapshot.issues.filter((i) => i.team === p.teamKey && triage.items[i.id]?.verdict === "do").length
      const decide = snapshot.issues.filter((i) => i.team === p.teamKey && triage.items[i.id]?.verdict === "decide").length
      const inPlan = plan ? plan.items.filter((x) => x.team === p.teamKey).length : 0
      return h(
        "section",
        { class: "sheet project" },
        h("div", null, h("h2", null, proj(p.teamKey), p.name), h("p", { class: "north" }, p.northStar)),
        h(
          "div",
          { class: "facts-list" },
          h("p", null, h("b", null, `${s.open} issues abiertos`), `, de los cuales ${work} piden una decisión o una acción.`),
          h(
            "div",
            null,
            h("div", { class: "compo", role: "img", "aria-label": `${work} de trabajo, ${record} registros, ${flow} de flujo` }, h("span", { class: "work", vars: { "--w": String(work || 0.01) }, title: `Trabajo: ${work}` }), h("span", { class: "record", vars: { "--w": String(record || 0.01) }, title: `Registros: ${record}` }), h("span", { class: "flow", vars: { "--w": String(flow || 0.01) }, title: `Flujo: ${flow}` })),
            h("div", { class: "compo-legend" }, h("span", { vars: { "--sw": "var(--ink)" } }, `Trabajo ${work}`), h("span", { vars: { "--sw": "var(--ink-3)" } }, `Registros ${record}`), flow ? h("span", { vars: { "--sw": "var(--rule)" } }, `Flujo ${flow}`) : null),
          ),
          h("p", null, `Últimos 7 días, sin contar reportes: entraron ${s.created7d}, se hicieron ${s.done7d} y se cancelaron ${s.canceled7d}. `, h("b", null, net > 0 ? `El backlog de trabajo creció en ${net}.` : net < 0 ? `El backlog de trabajo bajó en ${-net}.` : "El backlog de trabajo quedó igual.")),
          h("p", null, `${s.stale30} llevan 30 días o más sin moverse.`),
          h("p", null, `Triage: ${todo} para hacer, ${decide === 1 ? "1 espera" : `${decide} esperan`} una decisión tuya. Hoy tiene ${inPlan} ${inPlan === 1 ? "acción" : "acciones"} en el plan (su parte de tu atención es ${Math.round(p.attentionShare * 100)}%).`),
        ),
      )
    }),
  )
}

// ----------------------------------------------------------------- Agentes

function viewAgents() {
  const { snapshot, agents, alfred } = S.data
  const stats = snapshot?.stats.byAgent ?? {}
  const recs = snapshot?.stats.recordsBySource ?? {}
  const pct = (v) => (v == null ? "—" : `${v}%`)

  const table = h(
    "div",
    { class: "sheet table-wrap" },
    h(
      "table",
      null,
      h(
        "thead",
        null,
        h(
          "tr",
          null,
          h("th", null, "Agente"),
          h("th", { class: "num" }, "Propuestas abiertas"),
          h("th", { class: "num" }, "Creadas en 30 d"),
          h("th", { class: "num" }, "Decididas"),
          h("th", null, "De las decididas, se hicieron"),
          h("th", { class: "num" }, "Duplicadas"),
          h("th", { class: "num" }, "Quietas 3 semanas o más"),
          h("th", { class: "num" }, "Registros abiertos"),
        ),
      ),
      h(
        "tbody",
        null,
        ...Object.entries(agents).map(([key, a]) => {
          const s = stats[key]
          return h(
            "tr",
            null,
            h("td", null, h("b", null, `${a.emoji} ${a.name}`), h("div", { class: "small muted" }, a.role)),
            h("td", { class: "num" }, s?.open ?? "—"),
            h("td", { class: "num" }, s?.created30d ?? "—"),
            h("td", { class: "num" }, s?.decided ?? "—"),
            h("td", null, s?.decided ? h("div", { class: "rate", title: `${s.done} hechas de ${s.decided} decididas` }, h("span", null, pct(s.acceptRate)), h("div", { class: "rate-track" }, h("div", { class: "rate-fill", vars: { "--w": `${s.acceptRate}%` } }))) : "—"),
            h("td", { class: "num" }, s?.decided ? pct(s.dupRate) : "—"),
            h("td", { class: "num" }, s?.staleOpen ?? "—"),
            h("td", { class: "num" }, recs[key] ?? "—"),
          )
        }),
      ),
    ),
  )

  const caveat = h(
    "p",
    { class: "small muted", style: null },
    snapshot?.source === "linear-api"
      ? `Cuenta lo que cada agente propuso como trabajo (propuestas, hallazgos, alertas) y cómo terminó en los últimos ${snapshot.window?.closedDays ?? 45} días. Los reportes van aparte, en «Registros abiertos».`
      : "Con la carga parcial de hoy, el autor se deduce del título: una parte de las propuestas queda sin atribuir y estos números subestiman a Pico y a Cody. Se corrigen solos en el primer sync completo.",
  )

  const drafts = alfred.items.filter((r) => r.status === "draft")
  const others = alfred.items.filter((r) => r.status !== "draft")
  const recCard = (r) =>
    h(
      "article",
      { class: "sheet rec" },
      h("div", { class: "btn-row" }, h("span", { class: "chip solid" }, r.agent === "todos" ? "Todo el equipo" : agentName(r.agent))),
      h("h3", null, r.title),
      h("p", null, r.pattern),
      h("ul", { class: "evidence" }, ...r.evidence.map((e) => h("li", null, e))),
      h("p", null, h("b", null, "Cambio propuesto: "), r.proposal),
      r.artifact ? h("p", { class: "muted" }, h("b", null, "Dónde habría que tocar: "), r.artifact) : null,
      r.expected ? h("p", { class: "muted" }, h("b", null, "Cómo sabríamos que funcionó: "), r.expected) : null,
      r.status === "draft"
        ? h(
            "div",
            { class: "btn-row" },
            h("button", { class: "btn", type: "button", onclick: (e) => act({ type: "alfredSend", rec: r.id }, { ok: "Enviado a Alfred", button: e.target }) }, "Enviar a Alfred"),
            h("button", { class: "btn quiet", type: "button", onclick: (e) => act({ type: "alfredDismiss", rec: r.id }, { ok: "Descartada", button: e.target }) }, "Descartar"),
          )
        : r.status === "sent" && r.triggerPending
          ? h(
              "div",
              { class: "btn-row" },
              h("p", { class: "rec-sent" }, `Se creó ${r.linearIssue ?? "el issue"}, pero no se pudo disparar a Alfred.`),
              h("button", { class: "btn", type: "button", onclick: (e) => act({ type: "alfredSend", rec: r.id }, { ok: "Alfred disparado", button: e.target }) }, "Disparar a Alfred"),
            )
          : h("p", { class: "rec-sent" }, r.status === "sent" ? `Enviada a Alfred como ${r.linearIssue ?? "issue"}.` : "Descartada."),
    )

  return h(
    "div",
    null,
    table,
    h("div", { class: "more" }, caveat),
    h(
      "div",
      { class: "recs" },
      h("h2", { class: "section-title" }, `Recomendaciones para Alfred (${drafts.length} sin enviar)`),
      drafts.length || others.length
        ? [...drafts.map(recCard), ...others.map(recCard)]
        : h("p", { class: "muted" }, "El lead todavía no encontró un patrón que amerite cambiar a un agente. Aparecen aquí cuando el mismo problema se repite en varios issues."),
    ),
  )
}

// ---------------------------------------------------------------- Registro

function viewLog() {
  const log = [...S.data.decisions].reverse()
  if (!log.length) return emptyState("Todavía no decidiste nada desde aquí", "Cada click que cambie algo queda anotado: qué, cuándo y sobre qué issue. El lead lo lee cada mañana para aprender tu criterio.")
  const label = {
    dispatch: "Enviado a un agente",
    comment: "Comentario",
    accept: "Aceptado",
    "close-canceled": "Cancelado",
    "close-duplicate": "Cerrado por duplicado",
    "close-done": "Dado por hecho",
    "plan-done": "Hecho",
    "plan-skipped": "Salteado",
    "plan-pending": "Vuelto a pendiente",
    decide: "Decisión",
    override: "Veredicto corregido",
    "alfred-send": "Enviado a Alfred",
    "alfred-dismiss": "Recomendación descartada",
    reopen: "Reabierto",
  }
  const name = (d) => label[d.action] ?? (d.action.startsWith("task-") ? `Tarea: ${S.data.taskStages?.[d.action.slice(5)] ?? d.action.slice(5)}` : d.action)
  const detail = (d) => {
    const x = d.detail
    if (!x) return ""
    if (typeof x === "string") return x
    return x.comment ?? x.choice ?? x.note ?? x.why ?? x.title ?? (x.to ? `${x.from ?? "sin triar"} → ${x.to}` : "")
  }
  return h(
    "ul",
    { class: "sheet log" },
    ...log.map((d) =>
      h(
        "li",
        null,
        h("span", { class: "muted" }, new Date(d.at).toLocaleString("es", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })),
        h("span", null, h("b", null, name(d)), d.actor === "lead" ? " · lo hizo el lead" : "", d.dryRun ? " (simulado)" : ""),
        h("span", null, d.issue ? h("b", null, d.issue + " ") : null, cut(detail(d), 220)),
      ),
    ),
  )
}

// ------------------------------------------------------------------ arranque

document.getElementById("refresh").addEventListener("click", async (e) => {
  const btn = e.target
  btn.disabled = true
  btn.textContent = "Actualizando…"
  try {
    const res = await post("/api/sync")
    if (res.state) S.data = res.state
    toast(res.ok ? "Datos actualizados desde Linear." : /key|autentic|rechaz/i.test(res.output ?? "") ? "Linear rechazó la key: sigo mostrando los datos anteriores." : `No pude actualizar: ${cut(res.output, 140)}`)
    render()
  } catch {
    toast("El tablero no responde. Fíjate si el servidor sigue corriendo.")
  } finally {
    btn.disabled = false
    btn.textContent = "Actualizar datos"
  }
})

if (!TABS.some(([key]) => key === S.tab)) S.tab = "hoy"
window.addEventListener("hashchange", () => {
  const key = location.hash.slice(1)
  if (key !== S.tab && TABS.some(([k]) => k === key)) {
    S.tab = key
    render()
  }
})

fetch("/api/state")
  .then((r) => r.json())
  .then((data) => {
    S.data = data
    render()
  })
  .catch(() => {
    document.getElementById("main").replaceChildren(emptyState("No pude leer el estado", "El servidor del tablero no respondió. Reinícialo con «npm run lead:dashboard»."))
  })
