# Recomendaciones para Alfred

Alfred es el agente que mejora a los otros agentes: cambia prompts, skills y
wrappers del repo de agentes y abre un PR que el owner revisa. Por su canal de
siempre solo se entera de un problema cuando el owner corrige fuerte a un
agente. Tú ves algo que ese canal no ve: **el patrón a lo largo de semanas y de
proyectos**. Esa es tu parte.

Cómo trabaja Alfred, qué artefacto corresponde a cada síntoma y sus reglas:
`docs/alfred.md`. Léelo antes de escribir la primera recomendación.

## Qué es un patrón (y qué no)

Una recomendación vale cuando el mismo problema se repite y la causa está en
cómo trabaja el agente, no en un caso. Señales concretas que ya tienes en los datos:

- **Un agente propone mucho y se hace poco.** `lead status` y la pestaña Agentes
  del tablero muestran, por agente: abiertas, creadas en 30 días, decididas,
  porcentaje hecho, duplicadas, quietas. Un porcentaje bajo de hechas o muchas
  quietas quiere decir que propone cosas que no importan o más rápido de lo que
  se puede consumir.
- **Lo mismo reportado varias veces.** Duplicados, o un hallazgo que reaparece
  después de cancelado.
- **Ruido que tapa.** Registros que quedan abiertos, títulos que cambian de
  formato, un issue por cada corrida sin novedad.
- **Decisiones del owner que se repiten.** Si cancela siempre el mismo tipo de
  propuesta, o corrige siempre el mismo veredicto, el criterio le falta al
  agente (o a ti).
- **Algo que un agente no ve por diseño.** Por ejemplo, una vulnerabilidad en
  una dependencia compartida que se reporta proyecto por proyecto.
- **Los agentes creen algo de la app que ya no es cierto.** Un proveedor que
  cambió, una página que se rediseñó, una tabla que se renombró. Lo ves cuando
  verificas contra la rama principal (`lead shipped`) y el issue dice otra cosa.
  El artefacto es la base de conocimiento del proyecto (`projects/<slug>/`,
  `memory/`), y la evidencia son los issues que repiten el dato viejo.
- **Disparos que fallan.** Comentarios `<Agente>:` sin respuesta de forma
  recurrente apuntan al wrapper o al timeout, no al prompt.

No es para Alfred:

- Un error puntual. Eso lo arregla el agente cuando se le avisa.
- Un problema del producto. Eso es de Cody.
- Algo que se resuelve en n8n o en un panel (apagar un cron, rotar un token). Eso
  es una acción del owner y va al plan como `you`.
- Tu propio criterio. Si el que priorizó mal fuiste tú, corrige esta skill.

## Cuánta evidencia

**Al menos tres casos concretos, con sus issues.** Sin ids no es una
recomendación, es una opinión, y el CLI no la guarda. Si los números salen de
una atribución aproximada (por título), dilo.

Propón pocas: hasta tres por semana. Cada una termina en un PR que el owner tiene
que revisar, y el objetivo es que le llegue menos trabajo, no más.

## Qué tiene que decir

- **`title`** — el comportamiento, en una línea. Se convierte en
  `[Retro] <Agente>: <title>`.
- **`pattern`** — qué pasa y qué le cuesta al owner. Dos o tres oraciones.
- **`evidence`** — la lista de casos, cada uno con sus ids y su número.
- **`artifact`** — dónde crees que está la causa. Si no estás seguro, dilo:
  el diagnóstico es de Alfred. Regla del repo: cómo actúa un agente en general
  es core (`scripts/agents.ps1` o su wrapper); el dominio de un proyecto es el
  override (`projects/<slug>/agent-overrides/`); el método de una skill es su `SKILL.md`.
- **`proposal`** — el cambio de comportamiento que pides, no el diff. Mínimo y verificable.
- **`expected`** — cómo vas a saber, mirando los números en unas semanas, que funcionó.
- **`agent`** — una clave del roster (`qualy`, `cody`, …) o `todos`.
- **`scope`** — `core` o el slug del proyecto.

```json
[
  {
    "id": "2026-10-07-qualy-re-reporta-hallazgos",
    "agent": "qualy",
    "title": "Vuelve a abrir como issue nuevo un hallazgo que ya estaba reportado o descartado",
    "pattern": "La revisión de logs encuentra el mismo problema en corridas sucesivas y cada vez abre un issue nuevo. La mitad de lo que reporta termina cancelado o duplicado.",
    "evidence": [
      "La misma policy de RLS reportada cinco veces (ACM-807, ACM-810, ACM-820, ACM-827, ACM-845).",
      "Tildes del home: seis issues, todos cancelados (ACM-687, ACM-765, ACM-796, ACM-603, ACM-797, ACM-602).",
      "Decididos en 45 días: 57, de los cuales 22 cancelados y 6 duplicados."
    ],
    "artifact": "La skill de revisión de logs de Qualy (a diagnosticar si tiene memoria entre corridas)",
    "proposal": "Antes de crear un hallazgo, buscar por causa raíz en los issues abiertos y en los cerrados de los últimos 45 días; comentar el existente en vez de abrir otro; no re-reportar lo cancelado salvo que empeore.",
    "expected": "Duplicados en 0 y cancelados por debajo del 20% de lo decidido, a 30 días.",
    "scope": "core"
  }
]
```

Guárdalas con `node lead/scripts/lead.mjs alfred --file=<ruta>`. Quedan como
borrador en `lead status`. El `id` es tuyo y estable (una fecha y un slug
sirven): si mejoras una recomendación que sigue en borrador, reúsalo.

## Cómo llega a Alfred

Con `autonomy.sendAlfredRecommendations` en `false` (el default), **no la mandas
tú**. Se la cuentas en la charla en dos líneas (qué pasa y qué pides) y esperas
su sí. Si la descarta, queda registrado y no la vuelves a proponer salvo con
evidencia nueva.

Con su sí («mándale a Alfred la de Qualy», «mándalas»), corre
`node lead/scripts/act.mjs retro --recs=<id>,<id> --approved="<su frase>"` (o
`--recs=all` para todos los borradores). Hace tres cosas:

1. Crea un issue `[Retro] <Agente>: …` por recomendación, con label `alfred`, en
   el team de `lead.config.json → alfred.teamKey` y **ya en In Progress**.
2. Publica **un comentario `Alfred: …`** en el primero, que nombra a todos. Es
   lo que lo dispara: un issue nuevo no arranca a nadie, y no cuentes con el
   barrido diario. Va uno solo porque Alfred trabaja sobre un único clon
   del repo: nueve comentarios serían nueve corridas a la vez pisándose. En una
   corrida los procesa uno por uno.
3. Marca cada recomendación como enviada y lo anota. Si el issue se creó y el
   comentario falló, queda enviada con el disparo pendiente: volver a correr el
   mismo comando reintenta solo el comentario, sin crear otro `[Retro]`.

Antes de correrlo relee cada una: si un dato cambió desde que la escribiste,
corrígela con `lead alfred --file` primero. Si el cambio propuesto dice que
algo «va adjunto», adjúntalo como comentario `🤖 Lead:` en el issue recién
creado. Si son muchas, una corrida de Alfred puede no alcanzar: al otro día mira
cuáles quedaron sin su comentario y dispáralo de nuevo por las que falten,
siempre de a una corrida.

## Cerrar el círculo

Una recomendación enviada no termina ahí. En las semanas siguientes:

1. ¿Alfred abrió el PR? Aparece entre los PRs del repo de agentes en `lead status`.
   Si el owner no lo revisó, va al plan como `review`.
2. ¿Se mergeó? Entonces mira el número que pusiste en `expected`.
3. ¿Se movió? Si sí, díselo en una señal del plan. Si no, la causa era otra:
   escribe una recomendación nueva con lo que aprendiste, no repitas la anterior.
