# Triage: darle un veredicto a cada issue

El triage responde una sola pregunta por issue: **¿qué debería pasar con esto?**
Queda en `lead/state/triage.json`. Cada mañana tría lo que entró o cambió
(`lead inbox`) y vuelve a mirar lo viejo (más abajo): un veredicto no es para siempre.

## Primero: qué clase de cosa es

El sync clasifica cada issue por su título y sus labels (`lead/scripts/model.mjs`):

| Clase | Qué es | Qué haces |
|---|---|---|
| **work** | Pide una decisión o una acción: `[Proposal]`, `[QA…]`, `[Alert]`, `[Bug]`, hallazgos sin prefijo, tareas del owner | Veredicto con criterio |
| **record** | Deja constancia de algo que ya pasó: `[Report]`, `[Plan]`, ticks. Nacen abiertos: el owner los lee en el Backlog | No se tría: `lead records --archive`. Se lee el más nuevo de cada serie, esté abierto o ya cerrado, y se archiva a los 2 días. El `[Plan]` de la semana queda hasta que llega el siguiente |
| **flow** | Pieza de un pipeline que se cierra sola (`[Content]`, `[Refresh]` agendados) | No se toca salvo que esté vieja o sea un aviso de falla |

Si un issue está mal clasificado (pasa: un `[Content] Banco de topics vacío` es
un aviso, no un post), tríalo por lo que es y no por la etiqueta.

## Los seis veredictos

| Veredicto | Cuándo | Campos que pide |
|---|---|---|
| `do` | Vale la pena y se puede arrancar | `objective`, `impact`, `effort`, `owner`, `why` (+ `next`, `cluster`, `confidence`, `urgent`) |
| `decide` | Solo el owner puede destrabarlo: es una cuestión de apetito, plata, marca o riesgo | `question`, `why` (+ lo mismo que `do` si después hay trabajo) |
| `blocked` | Depende de otra cosa: otro issue, una persona, un acceso | `blockedBy`, `why` |
| `later` | Es válido pero no ahora | `why` (+ `until` con fecha si hay un momento claro para releerlo) |
| `close` | Recomiendas cerrarlo | `closeAs` (`canceled`, `duplicate`, `done`), `why` (+ `dupOf` si es duplicado) |
| `archive` | Registro ya leído | lo pone `lead records --archive` |

El `why` es lo que le vas a decir al owner en la charla. Una oración o dos, en
lenguaje llano, con el dato que justifica el veredicto. «Higiene» no es un
porqué; «lleva 60 días sin que nadie lo pida y no mueve cobros» sí.

El `next` es la próxima acción concreta. Si es para un agente, escríbelo ya como
el comentario que se publicaría (`Cody: …`): es el que sale cuando el owner dice «sí».

## Cómo juzgar

**Objetivo** (`objective`): a qué apunta. Los valores válidos y cuánto pesa cada
uno en cada proyecto están en `lead/lead.config.json`. Por defecto pesan más
facturación, seguridad y visitas.

**Impacto** (1 a 3), contra el `strategicFocus` del proyecto, no en abstracto:

- 3 — mueve la métrica principal del proyecto o cierra una exposición real.
- 2 — mejora algo que se ve o se mide, pero no es el cuello de botella.
- 1 — prolijidad. Bien hecho, nadie lo nota.

**Esfuerzo** (1 a 3), contando el tiempo del owner, no solo el del agente:

- 1 — un PR chico o un cambio de configuración. Menos de un día.
- 2 — unos días, o necesita un mockup, o toca más de una parte.
- 3 — más de una semana, o cruza repos. Eso ya no es un issue: es un proyecto, y
  va como `decide`.

**Evidencia** (`confidence`, 1 a 3): 3 si hay un dato medido con n razonable o
el problema se reproduce; 2 si hay un indicio serio; 1 si es una hipótesis.
Con muestras chicas (pocas ventas por semana, por ejemplo) di el n y no subas de 2.

**Urgente** (`urgent: true`) va siempre arriba y es solo para tres casos: algo
roto en producción que le pega a usuarios, una exposición de seguridad
explotable, o plata que se está perdiendo hoy. Si dudas, no es urgente.

**Quién lo hace** (`owner`): `cody` (código), `qualy` (verificar, testear,
revisar logs), `numa` (una pregunta de datos), `greta` (SEO, AEO, copy),
`pico` (convertir un insight en propuesta), `daly` (mockup), `leda` (contenido),
`owner` (solo el owner tiene el acceso o la autoridad), `code` (se hace en una
sesión de Claude Code: cruza repos, es del repo de agentes, o el proyecto no
tiene team).

El puntaje lo calcula el CLI: impacto × evidencia ÷ esfuerzo, por el peso del
objetivo en ese proyecto y, más suave, por la parte de atención del proyecto.
Sirve para ordenar la bandeja, no para decidir por ti.

## Reglas que evitan los errores típicos

- **Mira qué salió antes de triar.** `lead shipped --team=<K>` lista lo que se
  mergeó en la app. La mayoría de esos cambios no nombra ningún issue, así que
  hay que leerlos: un rediseño, una migración de proveedor o un arreglo dejan
  viejas a todas las propuestas sobre esa parte.
- **El triage no es una verificación.** Se hace sobre el texto del issue, que es
  lo que un agente vio un día. Sirve para ordenar la bandeja; antes de proponer
  una tarea hay que comprobarla contra la fuente (paso 8 de la rutina). `confidence`
  3 es solo para lo que comprobaste tú; lo que dice un reporte, por medido que
  esté, es 2 y lleva su fecha en el `why` («según Pico, al <fecha>»).
- **Después de un rediseño o un deploy grande, lo propuesto antes vence.** Las
  propuestas sobre esa parte del producto pasan a `later` con fecha de mañana
  hasta que las compares con lo que quedó en `main`.
- **Lo viejo no se arrastra.** Un issue de trabajo sin actividad hace
  `proposalStaleDays` o más no puede seguir en `do` o `later` por inercia
  (`lead brief` los lista). Para cada uno: ¿ya está hecho? (→ `close` + `done`
  con evidencia) ¿la premisa sigue en pie? (si no → `close` + `canceled`) ¿lo
  vas a proponer en las próximas dos semanas? Si la respuesta es no, propón
  cerrarlo: si vuelve a importar, el agente lo va a volver a encontrar con
  datos nuevos. Un `later` lleva siempre `until` con fecha.
- **Un `later` con fecha es una decisión, y al owner ya se le dijo.** Hasta ese
  día el issue no vuelve a un lote de cierre: `lead brief` lo muestra aparte, con
  el motivo por el que quedó, y `lead plan` rechaza cancelarlo. Si de verdad
  cambió algo, primero cambia el veredicto (`close`, con el motivo nuevo) y en la
  charla le dices que es una que habías dejado y por qué ya no. Sin esta regla,
  la rutina propone cancelar con otro motivo lo que días antes se le dijo al
  owner que quedaba, y su «ciérralas» lo cancela.
- **Un proyecto archivado no se tría ni se propone.** Si salió de
  `lead.config.json`, una alerta por uno de sus crons se cierra como ruido.
- **Usa el plan de Capi.** El último `[Plan] Roadmap priorizado` de cada team ya
  tiene impacto, esfuerzo, duplicados y qué cerrar, verificado contra Linear.
  Empieza por ahí y ajusta con lo que entró después. Si no coincides con Capi,
  di por qué en el `why`.
- **Agrupa en frentes.** Varias propuestas que tocan lo mismo llevan el mismo
  `cluster` y se despachan juntas en un solo PR. Ocho issues de timeouts son un
  pedido, no ocho.
- **Un incidente repetido es una decisión, no N tareas.** Si el mismo problema
  aparece en varios issues (abuso en el registro, por ejemplo), una va como
  `decide` y las demás como `blocked` por esa decisión.
- **No cierres un hallazgo de seguridad por viejo.** Se cierra cuando está
  arreglado o cuando el owner aceptó el riesgo. Mientras tanto, `decide` o `blocked`.
- **Duplicado necesita original.** `close` + `duplicate` + `dupOf`. El detalle
  está más abajo.
- **Lo que no leíste, no lo juzgues.** Si no pudiste leer un issue (datos
  parciales), ponlo en `later` con fecha de mañana y di por qué. Es mejor que
  un veredicto inventado.
- **Higiene técnica**: por defecto `later` («se hace al tocar esa ruta»). Sube a
  `do` solo si protege algo que cobra o si el error de tipos esconde un bug real.
  Si lleva más de `proposalStaleDays` sin que nadie la pida, propón cerrarla.

## Duplicados y tareas partidas: que quede uno solo

Búscalos en cada triage; es de lo que más achica lo que el owner tiene que mirar.
Hay tres casos y se tratan distinto:

**El mismo entregable propuesto dos veces** (dos issues que se resuelven con el
mismo cambio; o el problema y la propuesta que lo arregla). Es un duplicado:

1. **Elige el que queda**: el que tiene mejor evidencia o el hilo más avanzado; a
   igualdad, el más viejo. Si el owner ya canceló uno, el nuevo se cierra contra
   ese y se lo dices: es un criterio que ya tomó.
2. **Pasa lo que el otro tenía de propio** (un dato, un caso, un archivo) al que
   queda, en un comentario que empiece con `🤖 Lead:` (así no dispara a nadie).
3. **Márcalo**: `save_issue` con `duplicateOf` en el que se cierra. En el triage:
   `close` + `closeAs: "duplicate"` + `dupOf`.
4. **Dale prioridad al que queda** (`save_issue` con `priority`), según su veredicto:
   2 (alta) si es `do` con puntaje de 70 o más, 3 (media) el resto de los `do`.

Esto es de bajo riesgo: lo haces y lo cuentas.

**El mismo trabajo partido en muchos issues** (ocho propuestas de «agregar
timeout a tal llamada», una por archivo; o un bug y la propuesta que ataca su
causa). No son duplicados: cada una tiene su lugar en el código. Llevan el
mismo `cluster` y se resuelven en un solo PR. Propónle **fundirlas**: queda un
issue con la lista completa, que es el que se pide.

1. Elige el que queda (el que mejor describe el trabajo entero).
2. Escribe, para cada issue absorbido, **qué pide hoy** en una línea: lo que
   sigue pendiente según lo que verificaste, con el archivo. No copies el
   título. Sin datos personales (ni emails ni IPs).
3. Arma el archivo y, con su sí, corre `node lead/scripts/act.mjs fuse
   --file=<ruta> --approved="<su frase>"` (con `--dry-run` muestra qué haría):

   ```json
   [
     {
       "keep": "ACM-769",
       "priority": 3,
       "includes": [
         { "id": "ACM-799", "text": "El fetch al proveedor de transcripción no tiene límite de tiempo (app/api/interview/answer/route.ts)." }
       ]
     }
   ]
   ```

   El comando le agrega al que queda la sección «Incluye también» sin tocar lo
   que ya decía (`"heading": "Also includes"` para un proyecto en inglés), le
   pone la prioridad, marca cada absorbido como duplicado de ese y lo anota a
   nombre del owner. Correrlo dos veces no repite nada.
4. En el lote del plan van como `{ "as": "duplicate", "dupOf": "<el que queda>", "lane": "ask" }`:
   el `lane` explícito evita que salgan por tu cuenta como un duplicado común.

Espera su sí porque cambia el alcance de un issue. Y es un patrón para Alfred:
el agente debería proponer una tanda, no ocho issues.

**Parecidos pero independientes** (dos mejoras de SEO en páginas distintas).
No se juntan: cada uno se decide por su cuenta.

## Por qué vía sale cada cierre

Lo que recomiendas cerrar va al lote del plan (`closeBatch`), y el CLI le pone la
vía según `lead.config.json → autonomy`:

| Cierre | Vía | Qué necesita |
|---|---|---|
| Registro ya leído | Lo cierras tú | Nada: lo arma `closeRecords` |
| Ya está hecho (`done`) | Lo cierras tú | `"verified": true` y la evidencia en el `why`: el PR, el commit, o «Capi lo verificó el lunes» |
| Ya está hecho, pero es una impresión | Espera su sí | Sin `verified` |
| Duplicado con su original | Lo cierras tú | `dupOf` |
| No se va a hacer (`canceled`), incluido lo viejo | Espera su sí, siempre | Un `why` que el owner pueda leer en una línea. En la charla van agrupados por motivo |
| Fundir varios en uno | Espera su sí | La lista de absorbidos y cuál queda |

Un aviso vencido (una alerta de hace dos semanas, un «backlog vacío» del mes
pasado) cuenta como hecho verificado: el hecho es la fecha. Una propuesta que
«seguro ya se hizo», no.

### El estado importa: los agentes lo leen

Los crons de los agentes miran en qué estado quedó cada issue, así que el estado
que eliges les dice algo (revísalo contra las skills y los wrappers si los cambias):

- **`Done`** es «ya está». Es lo que usan los propios agentes para un registro, y
  es el único estado seguro para archivar reportes.
- **`Canceled`** es una decisión: Capi, Greta y Qualy lo anotan en sus memorias
  como «no se hace, no volver a proponerlo», y para Leda es la orden de frenar
  una publicación. Úsalo solo para un rechazo de verdad, nunca para archivar.
- **`Duplicate`**: el agente que lo tenía anotado deja de re-proponerlo. Antes de
  elegir cuál queda, mira cuál figura en `projects/<slug>/roadmap.md`.

Y hay cosas que no se cierran aunque parezcan viejas:

- Un `[Content]` de un post que todavía no se publicó, y un «Banco de topics
  vacío» mientras el banco siga vacío (el publicador abre otro cada día).
- Un `[Topics] … con preguntas` o un `[Refresh] REVISAR`: esperan una respuesta.
- Un `[Retro]` con label `alfred` abierto: es la cola de Alfred.
- Una alerta de salud de menos de 24 horas.

Un efecto que conviene avisarle: el resumen semanal de Pico cuenta todo lo que
pasó a `Done`, así que una tanda grande de reportes archivados infla esa cifra
una vez.

## Formato

Un array JSON. Solo los issues que estás triando ahora:

```json
[
  {
    "id": "ACM-878",
    "verdict": "do",
    "objective": "revenue",
    "impact": 3,
    "effort": 1,
    "confidence": 2,
    "owner": "cody",
    "cluster": "checkout internacional",
    "why": "La mayoría de quienes ven el paywall son de otro país y no hay una compra en moneda extranjera en un mes.",
    "next": "Cody: implementa los pasos 2 y 3 de la propuesta de este issue en un solo PR."
  },
  {
    "id": "ACM-872",
    "verdict": "decide",
    "objective": "security",
    "question": "¿Construimos el límite de registros por IP o aceptamos el riesgo por ahora?",
    "why": "El abuso volvió tres veces en dos semanas y el límite por IP nunca se construyó."
  },
  {
    "id": "ACM-882",
    "verdict": "close",
    "closeAs": "duplicate",
    "dupOf": "ACM-174",
    "why": "Es la misma propuesta que ACM-174, que se canceló hace dos semanas."
  }
]
```

Guárdalo con `node lead/scripts/lead.mjs triage --file=<ruta>`. Si falta un campo
o un id no existe, el CLI no guarda nada y te dice qué corregir. Si el owner
corrigió un veredicto desde el tablero, el CLI no lo pisa en silencio: para
cambiarlo hace falta `--over-owner`, y se lo cuentas en la charla.
