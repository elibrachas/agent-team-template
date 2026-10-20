# Seguir una tarea hasta producción

Despachar es barato. Lo caro es lo que queda a medio camino: una corrida que
falló en silencio, un PR que nadie mira, un cambio mergeado que nadie verificó.
El owner aprueba una tarea una vez; de ahí en más el trabajo de que llegue es tuyo.

La tabla de «lo que ves → qué haces» está en `SKILL.md`. Aquí va el detalle.

## Apenas sale el pedido

El issue pasa a In Progress: `node lead/scripts/act.mjs start --ids=<ID>
--actor=lead`. El owner mira Linear para saber en qué se está trabajando, y un
issue en Backlog con un agente adentro no se ve. Cody suele moverlo solo cuando
abre el PR, pero no cuando contesta con una pregunta: no dependas de eso. Es
siempre, para cualquier agente y cualquier tipo de issue.

Y el pedido es un comentario que empieza con `<Agente>:`. Un issue nuevo, o un
`Cody: …` escrito en su descripción, no dispara nada: el listener solo mira
comentarios.

## Cuando la tarea la hace una sesión local

A veces el owner prefiere que algo lo haga una sesión de Claude Code en su
máquina y no un agente del server («hazlo como tarea local aquí»). Se la dejas
armada (con `spawn_task` si lo tienes), parada en la copia local del repo del
producto, y el pedido tiene que valerse solo: el link del issue, lo que
verificaste hoy con archivo y línea, qué hay que hacer, qué queda afuera, y cómo
se entrega (rama desde `origin/main`, PR con el ID del issue en el título, sin
mergear, sin comentar en Linear).

La registras igual que las otras, con `lead task <ID> dispatched --agent=local
--actor=owner`, y el issue pasa a In Progress. No hay pedido que reenviar ni
corrida que pueda fallar: `lead follow` la encuentra por el PR. Si pasa un día
sin PR, pregúntale al owner si la arrancó. Verificar el PR y lo que sale en
producción sigue siendo tuyo.

## Qué le escribes al agente en cada caso

Todo esto se publica sin pedirle otro sí, porque es la misma tarea que aprobó.
Siempre en el mismo issue, y siempre dentro del alcance del pedido original.

- **No respondió en 3 horas.** Publica de nuevo el mismo comentario (está en la
  tarea). Si falla dos veces seguidas, no insistas: avísale al owner que ese
  agente no está respondiendo. Suele ser el límite de su cuenta o el server.
- **Checks en rojo.** Mira cuál falla (`gh pr checks <n> --repo <repo>`) y dilo:
  `Cody: en tu PR falla <job>: <el error, en una línea>. Arréglalo en el mismo PR, sin ampliar el alcance.`
- **El cambio se ve.**
  `Qualy: testea el preview del PR <url>. Tiene que pasar esto: <dos o tres comportamientos concretos del issue>. Pruébalo también en mobile.`
- **Qualy encontró algo.**
  `Cody: Qualy encontró esto en el preview de tu PR: <el hallazgo>. Corrígelo en el mismo PR.`
- **El agente preguntó algo.** Contesta tú solo si la respuesta está en el issue,
  en el repo o en una decisión que el owner ya tomó, y di de dónde sale:
  `Cody: usa el endpoint que ya existe en app/api/checkout (es el que cita el issue). Sigue con eso.`
  Si es una preferencia del owner, no la adivines: se la pasas con las opciones.

## Cuando el agente pregunta en vez de construir

Es lo mejor que puede pasar con un pedido mal planteado: Cody leyó el código y
vio que la premisa no cierra. No se lo reenvíes al owner tal cual.

1. **Verifica lo que afirma** en la rama principal (el archivo, la ruta, el
   endpoint). Suele tener razón, pero la decisión se toma sobre lo que viste tú.
2. **Llévasela como decisión rápida**: la pregunta en una línea, las opciones
   del agente resumidas en media línea cada una, cuál recomiendas y por qué.
3. Con su letra, contéstale al agente en el mismo issue (`Cody: ve con la A…`).
   Es la misma tarea: no hace falta otro sí.
4. Si el pedido estaba mal por algo que no miraste, anota qué habrías tenido
   que leer: es un criterio para la próxima verificación.

## Cómo verificas y le pasas un PR

Léelo tú primero (`gh pr view <n> --repo <repo> --json title,additions,deletions,changedFiles,files`
y `gh pr diff <n> --repo <repo>`). Si hace más de lo pedido, o toca algo que el
pedido decía que no tocara, no se lo pases: devuélveselo a Cody.

Después comprueba lo que el diff da por cierto, contra la fuente:

- **Lo que escribe en la base**: que la tabla, las columnas y los valores que
  usa existan (`information_schema`, los `check` de la tabla). Un `update` a una
  columna que no existe pasa el build y falla en producción.
- **Los helpers que importa**: que estén en la rama principal con esa firma.
- **El número que cita** («11 trabajos colgados»): repítelo hoy.
- **Lo que dijo el revisor automático**, si el repo tiene uno (Codex, por
  ejemplo, revisa solo cada PR unos minutos después de que se abre:
  `gh api repos/<repo>/pulls/<n>/comments`). No le pases el PR al owner sin
  haberlo leído; si todavía no llegó, espéralo o dile que falta. Comprueba cada
  observación en la rama del PR: las que son ciertas se las pasas al agente en
  el mismo issue (es la misma tarea, no hace falta otro sí), y las que no, le
  cuentas por qué. Un PR que se pasa como «hace los tres puntos» puede tener
  tres observaciones ciertas dos minutos después.
- **El preview**: ábrelo si puedes. Los de Vercel suelen pedir login; en ese caso
  di «el build pasa, el preview no lo pude abrir», no «probado».
- **Qué vas a mirar después del merge** para saber que funcionó. Anótalo en la
  tarea (`--note`), así no depende de que te acuerdes.

Cuando está bien, le escribes cuatro cosas y el link:

1. **Qué cambia** para quien usa el producto, en una oración.
2. **Cuánto**: archivos y líneas. Si toca pagos, auth o una migración, eso va primero.
3. **Qué se comprobó**: los checks, lo que verificaste tú y contra qué, y lo
   que verificó Qualy. Y lo que no se pudo comprobar.
4. **Qué mirar**, si hay algo. Si no hay nada: «no necesita tu ojo, es para mergear».

Ejemplo: «ACM-131 está listo para mergear: sube Next.js de 16.3.3 a 16.3.8 y
sharp a 0.35.5. Son 2 archivos (package.json y el lockfile). Checks en verde y
el build del preview levanta. No necesita tu ojo. <link>»

Muévela a `needs-owner` con el PR anotado. Mándale una notificación si no está
en el chat: es de las pocas cosas que justifican interrumpirlo.

## Después del merge

1. **El deploy terminó bien.** Con el conector de Vercel si lo tienes, o mirando
   el estado del commit en `main` (`gh api repos/<repo>/commits/main/status`).
2. **El efecto se ve en producción.** Abre la página, repite el número en la
   base (lo que anotaste al verificar el PR), o pídele a Qualy si es un flujo
   con login. Un merge sin esto no está hecho.
3. **Cierra.** El issue a Done por el conector, `lead log <ID> close-done --actor=lead`,
   y `lead task <ID> done --note="en producción: <evidencia>"`. Si el PR resolvió
   issues hermanos del mismo frente, ciérralos también.
4. **Cuéntaselo en una línea**: «ACM-131 está en producción. Issue cerrado.»

Si el deploy falló o el cambio no se ve, la tarea no está hecha: vuelve a
`pr-open` y se lo dices a Cody con el error.

## Cuándo volver a mirar

| Estás esperando | Vuelve a mirar en |
|---|---|
| A Cody, recién pedido | 30 minutos |
| A Cody, pasada la primera media hora | cada 30 minutos, hasta 3 horas |
| A un agente que solo lee (Numa, Greta, Pico, Capi, Qualy) | 15 minutos |
| Checks corriendo, o un deploy | 10 minutos |
| Al owner | No se mira en loop: va una vez en la charla siguiente |

Entre la rutina de una mañana y la siguiente, el seguimiento corre solo: la
tarea programada «Seguimiento (Project Lead)» (`seguimiento-del-lead`, en
`~/.claude/scheduled-tasks/`, fuera del repo; el prompt está en
`lead/scheduled-tasks/seguimiento-del-lead.md`) se dispara cada dos horas en
horario de trabajo, hace el sync y `lead follow`, y actúa como dice esta
referencia. Se apaga sola cuando no queda nada en marcha, así que **cada vez
que publiques un pedido fíjate que esté activa** (`update_scheduled_task`,
`enabled: true`). No despierta la máquina: si la app estaba cerrada, corre al
abrirla.

Para una espera corta dentro de una charla abierta (checks corriendo, un
deploy) puedes además programar **una** revisión de una sola vez en ese chat,
con un texto que se entienda solo: «Seguimiento del lead: corre el sync y
`lead follow`, y actúa como dice la skill project-lead». Cuando se dispara,
haces la revisión y decides si programas la siguiente.

En cada revisión le escribes solo si algo cambió o te necesita. «Sigue todo
igual» no es un mensaje. Si desde tu último mensaje Qualy reportó algo de
seguridad (la sección «Seguridad» de `lead brief` lo marca «nuevo»), eso va
primero, aunque no sea de una tarea en marcha: qué es, el riesgo real y qué
propones.

Si la sesión se cerró y no hubo revisiones, no se pierde nada: la rutina de la
mañana arranca por `lead follow`.

## Cuándo soltar

- **Dos corridas fallidas seguidas**: avísale; no es un problema de la tarea.
- **Tres idas y vueltas entre Cody y Qualy sin cerrar**: para y pásale el cuadro.
  El pedido estaba mal definido; hay que reescribirlo, no insistir.
- **Cinco días esperando al owner**: pregúntale una vez si sigue o se deja, y
  anota la respuesta. Una tarea que nadie va a mergear ocupa uno de los tres lugares.
