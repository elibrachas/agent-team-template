# El plan del día

El plan no es una lista de recomendaciones: es lo que vas a llevar adelante hoy
y lo poco que necesitas del owner para hacerlo. Es el respaldo de la charla:
lo que le dices en el chat sale de aquí, y lo que el owner contesta queda anotado
aquí. Tiene cuatro partes: las **tareas que propones**, las **decisiones
rápidas**, lo que **solo el owner** puede hacer, y los **cierres**.

## Las tareas que propones

Hay lugar para tres tareas en marcha a la vez (`limits.tasksInFlight`). Propones
las que entran: si hay una en marcha, propones dos. Si ya hay tres, ninguna: en
vez de eso le dices qué falta para que una termine. Terminar gana siempre.

Elígelas en este orden:

1. **Lo que está roto o expuesto.** Producción caída, una vulnerabilidad
   explotable, plata que se pierde hoy. Entra aunque rompa el reparto entre
   proyectos, y aunque no haya lugar.
2. **Lo mejor de «hacer»**, por puntaje, repartido según la parte de atención de
   cada proyecto (`attentionShare`). El reparto es una guía: un día puede ser
   todo de un proyecto si ahí está lo urgente, pero en la semana tiene que cerrar.
3. **Un frente entero vale por una tarea.** Si varias propuestas se resuelven en
   un solo PR (el mismo `cluster`), es un pedido que las nombra a todas.

Y dos frenos:

- **Pedidos a Cody**: no más de dos por repo por día, y ninguno a un repo que ya
  tiene tres PRs abiertos esperando al owner. Cada pedido vuelve como un PR;
  despachar es barato, revisar no.
- **Lo que necesita un paso previo del owner** (un acceso, una decisión) no se
  propone como tarea: va en «solo tú», y la tarea entra cuando eso esté.

El CLI hace cumplir los topes: no instala un plan con más acciones que
`planItemsMax`, con más minutos del owner que `ownerMinutesPerDay`, ni con más
pedidos que lugares libres. Lo roto o expuesto entra igual si lo marcas
`"urgent": true`. Tampoco acepta un pedido sobre un issue cerrado o que no esté
en el snapshot. Si algo no entra, va a `notes` o queda en la bandeja.

## Lo que solo el owner puede hacer

Unos `ownerMinutesPerDay` minutos como mucho, en este orden:

1. **Lo que ya está hecho y espera su merge.** Trabajo terminado que no llega a
   producción hasta que el owner lo mira. Va con el PR ya leído por ti
   (`references/follow.md`).
2. **Lo que destraba a otros.** Un acceso, mirar algo en un panel al que nadie
   más entra. Suelen ser cinco minutos que liberan días de un agente.
3. **Decisiones rápidas** (`decide`): hasta tres por charla, y de las difíciles
   no más de una. Cada una con dos o tres opciones, la que recomiendas primera y
   marcada, y armada para que se conteste con una letra sin abrir el issue.
   Antes de llevarle la pregunta de un agente, verifica lo que el agente afirma.

Lo que queda afuera no se pierde: sigue en la bandeja con su veredicto, y entra
cuando le toque.

## Los tipos de acción

Cada item tiene `type`, `title`, `why`, y `minutes` (los minutos **del owner**).
El título dice qué pasa, en sus palabras, no el título del issue.

| `type` | Qué es | Campos propios |
|---|---|---|
| `dispatch` | Se le pide a un agente comentando en el issue | `id`, `agent`, `comment`, `checked` |
| `you` | Lo hace el owner: un panel, un mensaje a alguien, un acceso | `steps` (lista), `links` opcional |
| `decide` | Una decisión con opciones | `question`, `options: [{label, comment?}]` |
| `review` | Un PR o un preview para mirar y mergear | `links: [{label, url}]` |
| `code` | Se hace en una sesión de Claude Code | `prompt` (autocontenido) |
| `close` | Cerrar un issue puntual que merece mención | `id`, `closeAs`, `dupOf` |

**`checked`** es obligatorio en un `dispatch` (el CLI no instala el plan sin
él) y conviene en un `code`. Dice qué miraste hoy contra la fuente y qué viste,
con la fuente y el número, y también lo que no pudiste verificar:

- «`main` de acme-app, hoy: next 16.3.3 y sharp ^0.35.4. El rango vulnerable es el que da Qualy; no lo verifiqué.»
- «`main` de acme-app, hoy: `/auth/confirm` es un route handler que redirige a login; el registro borra la cuenta pendiente antes de cada intento (`api/auth/reset-pending-signup`). Los emails salen por el proveedor nuevo.»
- «Base de Acme, hoy: 48 de 157 registros por email de la última semana siguen sin confirmar. El mecanismo es de los logs de Qualy de hace dos días y no lo verifiqué.»

«Lo dice el issue» o «según el reporte de Pico» no es una verificación. Se lo
dices en la charla junto al porqué: es lo que le dice cuánto confiar.

Un pedido que nombra una página, una ruta, una tabla o un proveedor exige que
los hayas leído hoy en la rama principal: si no, el pedido describe como página
lo que es un redirect, o manda a mirar un proveedor que la app ya no usa. El
`comment` se escribe sobre lo que hay en el código, no sobre lo que el issue cree.

En un `decide`, cada opción que lleva `comment` publica ese comentario en el
issue al elegirla (por ejemplo `Cody: avanza con la prueba en seco`). Una opción
sin `comment` solo registra la elección; mañana la lees en `lead status` y actúas.

En un `code`, el `prompt` lo va a leer una sesión nueva que no sabe nada: di el
repo, el problema, qué quieres como resultado y qué no tocar. Y pídele que
verifique por su cuenta los datos que le pasas.

## Cómo escribirle a un agente

El `comment` de un `dispatch` se publica tal cual en Linear, con la cuenta del
owner. Reglas que salen de cómo funciona el listener y de errores ya cometidos:

- **Empieza con `<Agente>:`** en texto plano. Sin `@` (Linear lo convierte en
  mención y no dispara) y nunca con 🤖 (el listener ignora esos comentarios).
- **En primera persona, como lo escribiría el owner.** «Cody: implementa…», no
  «el lead solicita…».
- **Di qué hacer y dónde cortar.** El agente lee el issue y el hilo: no repitas
  la propuesta. Suma lo que el issue no dice: qué pasos sí y cuáles no, qué va en
  el mismo PR, qué no tocar, qué te tiene que avisar.
- **Un pedido por comentario.** Si son tres issues en un PR, nómbralos a los tres
  en un solo comentario, en el issue principal.

Qué le pides a cada uno:

- **Cody** — implementar un issue aprobado; abre un PR y nunca mergea. Para algo
  dudoso, pídele primero el diagnóstico o la estimación («Cody: diagnostica… y
  dime el alcance antes de arreglarlo»).
- **Qualy** — verificar: «testea el preview del PR de X», «revisa si este patrón
  se repite en los logs desde tal fecha».
- **Numa** — una pregunta de datos concreta, con el período y pidiendo el n.
- **Greta** — SEO, AEO, copy de cara al cliente (carga la voz de marca).
- **Pico** — convertir un dato en una propuesta acotada.
- **Daly** — un mockup antes de construir UI nueva.
- **Leda** — contenido del blog; `Leda: stop <ID>` frena una publicación.
- **Capi** — una duda sobre el plan de un proyecto. No le pidas priorizar el día: eso es tuyo.
- **Alfred** — no se lo llama desde el plan. Va por las recomendaciones (`references/alfred.md`).

### Cuando el cambio se ve

Cody es un agente ciego: corre typecheck, lint y tests, y esos pasan aunque el
botón quede invisible. Por eso:

1. **UI nueva o un cambio de layout** → primero `Daly: haz un mockup de…`.
   Recién con el mockup aprobado va `Cody: implementa el design de…`.
2. **Un cambio visual chico** (cambiar un enlace, reusar un botón que ya existe)
   → puede ir directo a Cody, pero el comentario le pide que reuse los
   componentes existentes y que avise cuando abra el PR.
3. **Todo PR que toca UI** → al día siguiente el plan trae
   `Qualy: testea el preview del PR de…` **antes** del item de revisar y mergear.

## Lo que acompaña al plan

- **`headline`** — una o dos oraciones: qué pesa hoy y cuánto le lleva. Es lo
  primero que lee; que se entienda sin contexto.
- **`focus`** — una línea por proyecto con lo que hoy importa ahí (`{team, text}`).
- **`signals`** — lo que sacaste de los reportes: `{team, level, text, issue}`.
  `level`: `alert`, `serious`, `warn`, `good`, `info`. Con el número y su n. Tres
  a seis; si todo está igual que ayer, no hace falta inventar señales.
- **`closeRecords: {}`** — el CLI agrega solo al lote los registros que ya
  tienen `recordAutoArchiveDays` días (2). Los más nuevos quedan abiertos para
  que el owner los lea, y el `[Plan]` de la semana queda hasta que llega el
  siguiente. Un `minAgeDays` más bajo que el de la config no cuenta: manda el piso.
- **`closeBatch`** — todo lo que recomiendas cerrar: `{id, as, dupOf?, verified?, why}`.
  El CLI le pone a cada uno su vía (`references/triage.md`): lo que solo constata
  un hecho lo cierras tú con `act.mjs close --lane=auto`; lo demás espera su sí.
  `"verified": true` solo con evidencia dura, y la evidencia va en el `why`.
- **`notes`** — una aclaración operativa si hace falta (por ejemplo, mandar los
  pedidos a Cody de a uno porque comparten el límite de su cuenta).

## El día siguiente

El plan de mañana empieza por lo que dejó el de hoy:

- **Lo que está en marcha no se vuelve a proponer: se sigue.** `lead follow` dice
  dónde está cada tarea y qué paso toca (`references/follow.md`). Un PR listo
  abre la charla en «Para mergear», con lo que verificaste.
- Lo que el owner salteó vuelve una vez. Si lo saltea de nuevo, no insistas:
  pregúntale si lo saca del plan, y registra la respuesta.
- Lo que el owner decidió en un `decide` sin comentario te toca ejecutarlo o planearlo.
- Lo que reabrió después de que lo cerraste es una corrección de criterio:
  ajusta el triage y, si vale para otros días, guárdalo en tu memoria.

## Formato

```json
{
  "headline": "Hoy pesa que nadie de otro país puede pagar. Lo tuyo son 15 minutos; lo demás sale con un click.",
  "focus": [{ "team": "ACM", "text": "Que alguien de otro país pueda pagar." }],
  "items": [
    {
      "id": "ACM-878",
      "type": "you",
      "title": "Mira la página de pago como la ve un comprador",
      "why": "15 personas hicieron clic en pagar con tarjeta en el último mes y ninguna lo intentó. Solo tú entras a esa configuración.",
      "objective": "revenue",
      "minutes": 10,
      "steps": ["Abre en incógnito los dos links de pago en moneda extranjera.", "Anota nombre, logo y monto.", "Deja en el issue lo que viste."]
    },
    {
      "id": "ACM-131",
      "type": "dispatch",
      "agent": "cody",
      "title": "Que Cody suba Next.js en acme-app",
      "why": "Vulnerabilidad crítica en la versión que corre en producción.",
      "checked": "`main` de acme-app, hoy: next 16.3.3, dentro del rango vulnerable del advisory.",
      "objective": "security",
      "urgent": true,
      "minutes": 2,
      "comment": "Cody: sube next a 16.3.6 o superior en un solo PR. Corre el build antes de abrirlo."
    },
    {
      "id": "ACM-105",
      "type": "decide",
      "title": "¿Arrancamos a drenar la cola de revisión manual?",
      "why": "La cola sube en cada reporte de las últimas dos semanas. La propuesta ya está medida.",
      "checked": "Base de Acme, hoy: 195 en la cola, contra 120 hace dos semanas.",
      "minutes": 3,
      "question": "¿Hacemos la prueba en seco de ACM-105 y ACM-124 juntas?",
      "options": [
        { "label": "Sí, prueba en seco", "comment": "Cody: corre la prueba en seco de este issue junto con ACM-124 y muéstrame el resultado antes de aplicar nada." },
        { "label": "Todavía no" }
      ]
    }
  ],
  "closeRecords": {},
  "closeBatch": [
    { "id": "ACM-882", "as": "duplicate", "dupOf": "ACM-174", "why": "Cody volvió a proponer algo cancelado hace dos semanas." },
    { "id": "ACM-70", "as": "done", "verified": true, "why": "Se resolvió dentro de ACM-167, que se mergeó ayer: el sitemap ya emite lastModified." },
    { "id": "ACM-84", "as": "canceled", "why": "Es sobre la lista de espera, que ya no existe." }
  ],
  "signals": [{ "team": "ACM", "level": "info", "issue": "ACM-895", "text": "El mes va en 1,8% de free a pago: 387 registros y 7 pagos al día 7." }],
  "notes": ""
}
```

Guárdalo con `node lead/scripts/lead.mjs plan --file=<ruta>`. El plan anterior
queda archivado en `lead/state/history/`.
