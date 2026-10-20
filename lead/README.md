# Project Lead

El líder de proyecto del owner. No recomienda tareas: las lleva. Cada mañana
ordena lo que proponen los agentes en los teams de Linear de cada proyecto
(`lead.config.json → projects`; en el ejemplo, solo Acme / `ACM`), lo compara
con lo que ya salió en cada app, cierra lo que sobra, junta lo repetido,
propone hasta tres tareas y, con un sí, las pide, las sigue hasta que están en
producción y verifica que quedaron bien.

**Todo pasa en una charla.** No hay que entrar a ningún tablero: el lead abre
un chat con las prioridades y sus links a Linear, lo que limpió, las decisiones
ya armadas para contestar con una letra y el trabajo que ya verificó.

No es un agente más del server. Es Claude Code en tu máquina, siguiendo la skill
[`.claude/skills/project-lead`](../.claude/skills/project-lead/SKILL.md), con
tres piezas: un sync determinístico, un CLI y un script que cierra issues en
Linear. Hay además un tablero local, opcional.

```
Linear + GitHub ──sync.mjs──▶ lead/state/snapshot.json
  (issues, PRs abiertos y lo que salió en cada app)
                                   │
     el lead verifica, tría, arma el plan y sigue las tareas (lead.mjs)
                                   │
           triage.json · plan.json · tasks.json · alfred.json
                    │                              │
   bajo riesgo: lo hace y avisa          lo demás: espera tu sí
   (act.mjs, conector de Linear)         («sí, la 1», «A1», «ciérralas»,
                    │                     «fúndelas» en el chat)
                    └──────────────┬───────────────┘
                                   ▼
      Linear: un comentario «Cody: …», un cambio de estado, un duplicado
                                   └──▶ decisions.jsonl (quién decidió qué)
```

## Qué hace solo, qué te pregunta y qué es tuyo

| | Qué entra | Cómo te enteras |
|---|---|---|
| **Lo hace y avisa** | Archivar reportes ya leídos, cerrar lo que ya está en producción (con evidencia), juntar duplicados y darle prioridad al que queda, empujar y verificar una tarea que ya aprobaste | En «Hice» de la charla, con el link de lo que querrías poder deshacer |
| **Te propone** | Tareas nuevas (hasta tres en marcha a la vez), cerrar lo viejo o lo que no se va a hacer, fundir varios issues en uno, cambios para Alfred | Contestas «sí, la 1», «ciérralas», «fúndelas» |
| **Solo tú** | Mergear un PR, decisiones de producto o de plata, credenciales, lo que le habla a un cliente | Te llega resuelto: el PR ya leído y verificado, o una decisión con opciones para contestar con una letra |

Un «sí» vale para la tarea entera: publica el pedido y después sigue solo
(reenvía si el agente no respondió, le pide a Qualy que pruebe el preview, le
devuelve a Cody lo que haya que corregir) hasta dejarte el PR listo para mergear.
Cuando lo mergeas, verifica que esté en producción y cierra el issue.

Puedes contestarle como te salga: «sí», «ok», «adelante», «dale», «ciérralas» o
«cerralas», todo vale. El lead entiende la intención; los scripts no interpretan
la frase, la anotan tal cual como prueba de tu sí.

Todo lo que cierra se deshace: «reabre ACM-123» en el chat, o
`node lead/scripts/act.mjs reopen --ids=ACM-123 --actor=owner`.

**En Linear se ve en qué se está trabajando**: apenas un agente recibe un
pedido, su issue pasa a In Progress. **Fundir** deja un solo issue donde había
varios: el que queda suma en su descripción lo que pedían los otros, que pasan
a duplicados de ese.

### Permisos

La app de Claude tiene su propio control de seguridad, aparte de lo que diga
`lead.config.json`, y puede frenar un cierre en lote grande. Cuando frena algo,
el lead no lo intenta por otro camino: te lo dice en la charla y sale con tu
«ciérralas», o con este comando:

```bash
node lead/scripts/act.mjs close --lane=auto
```

Para que el lead los haga solo cada mañana, la regla la agregas tú en
`~/.claude/settings.json` (el lead no toca sus propios permisos):

```json
{ "permissions": { "allow": ["Bash(node lead/scripts/act.mjs close --lane=auto)"] } }
```

Es una regla exacta: permite ese comando y ningún otro. Lo que ese comando
cierra sale del plan del día: reportes ya leídos, duplicados, y lo que el lead
marcó como hecho con su evidencia. Nunca incluye cancelar una propuesta, y todo
se puede reabrir. Si prefieres que te lo pregunte cada vez, no hace falta agregar nada.

## Ponerlo en marcha

1. **Proyectos** — en [`lead.config.json`](lead.config.json), un proyecto por
   cada team de Linear que quieras que lleve: `slug` (la carpeta de
   `projects/<slug>/`), `teamKey`, `name`, `attentionShare` y `northStar`
   (reemplaza el `TODO(acme)`). `linearWorkspace` es el slug de tu workspace de
   Linear y `agentsRepo` el `owner/repo` de este repo en GitHub. Los repos de
   cada producto salen de `projects/<slug>/project.json` (`productRepoUrl`, o
   `productRepos[]` con `readOnly` para los que no mergeas).
2. **Alfred** — `alfred.teamKey` es el team donde el lead crea los `[Retro]`:
   tiene que ser uno que barra la corrida diaria de Alfred y tener el label `alfred`.
3. **Credenciales** — `LINEAR_API_KEY` (ver [Credenciales](#credenciales)) y
   el CLI `gh` con sesión (`gh auth login`) para los PRs.
4. **Colores del tablero** — si sumas proyectos, agrega un selector
   `.proj[data-team="<KEY>"]` en `app/public/app.css` (opcional: sin él, gris).
5. **Probar** — `npm run lead:selftest` (no usa red ni toca tu estado) y
   después `npm run lead:sync`.
6. **Las tareas programadas** — ver [Las tareas programadas](#las-tareas-programadas).

**Varios proyectos.** `attentionShare` reparte tu atención: con Acme (`ACM`) en
0.6 y Beta (`BET`) en 0.4, a igual mérito gana la tarea de Acme y, en la semana,
Acme se lleva más o menos 6 de cada 10 lugares del plan. Es una guía, no un
cupo: lo roto o expuesto entra igual, sea del proyecto que sea.

## Para usarlo

**Lo normal es no hacer nada.** Cada mañana la tarea programada «Hoja del día»
corre la rutina y te abre un chat. Le contestas ahí. La charla trae, en este
orden y con sus links:

1. **Seguridad** — va siempre: lo que reportó Qualy en cada proyecto, de lo más grave a lo menos, con el riesgo real y qué propone; y lo que se resolvió en la semana.
2. **Números** — una línea por proyecto con el número de su `northStar`, con su n, la fecha y de dónde sale.
3. **Para mergear** — los PRs que ya leyó y verificó, con qué comprobó y qué no pudo.
4. **Decisiones rápidas** — cada una con dos o tres opciones y su recomendación. Se contestan con una letra.
5. **Limpieza** — lo que cerró y juntó por su cuenta, y lo que propone cerrar (lo viejo, agrupado por motivo) o fundir.
6. **Lo que sigue** — las tareas que entran en los lugares libres, con lo que verificó hoy de cada una.
7. **Solo tú** — lo que nadie más puede hacer.

**Hablarle al lead** — en cualquier sesión de Claude Code en este repo: «sí, la
1», «A1», «mergeé la 2», «ciérralas», «fúndelas», «¿cómo vamos?», «reabre
ACM-123», «mándale a Alfred la de Qualy», «esto hazlo tú».

**La rutina de la mañana** corre sola como tarea programada de la app de
escritorio («Hoja del día»). Para pedirla a mano, en Claude Code: «arma el plan
de hoy».

**El seguimiento entre horas** es otra tarea programada, «Seguimiento (Project
Lead)»: cada dos horas en horario de trabajo mira lo que ya se le mandó a un
agente o a una sesión local, lee y verifica los PRs, pasa al agente lo que
encuentre, y cierra lo que ya está en producción. No propone nada nuevo. Se
apaga sola cuando no queda nada en marcha y el lead la vuelve a prender al
publicar un pedido. Tampoco despierta la máquina.

**Ver qué salió en una app** — lo que se mergeó en los últimos 45 días, que es
contra lo que el lead verifica cada propuesta:

```bash
node lead/scripts/lead.mjs shipped --team=ACM
```

### El tablero (opcional)

Muestra lo mismo que la charla, con botones. No forma parte de la rutina. Para
levantarlo — queda en segundo plano, sin ventana, y si ya había uno corriendo
lo reemplaza:

```bash
npm run lead:start
```

Se apaga con `npm run lead:stop`. Si prefieres tenerlo en una ventana y que se
abra solo en el navegador: `npm run lead:dashboard` o, en Windows, doble click
en `lead/abrir-tablero.cmd`.

**Probar sin tocar nada** — la simulación trabaja sobre una copia del estado:
se puede clickear todo y nada llega a Linear ni queda guardado.

```bash
npm run lead:simulacion
```

## Las tareas programadas

Viven en la app de escritorio de Claude, fuera del repo
(`~/.claude/scheduled-tasks/<nombre>/SKILL.md`). Los prompts para crearlas
están en [`scheduled-tasks/`](scheduled-tasks/): reemplaza `{{REPO_PATH}}` por
la ruta de tu checkout y crea cada tarea con su prompt.

| Tarea | Prompt | Cuándo |
|---|---|---|
| «Hoja del día» (`hoja-del-dia`) | [`scheduled-tasks/hoja-del-dia.md`](scheduled-tasks/hoja-del-dia.md) | Todos los días a las 8:30 (la misma hora del `schedule` de la skill) |
| «Seguimiento (Project Lead)» (`seguimiento-del-lead`) | [`scheduled-tasks/seguimiento-del-lead.md`](scheduled-tasks/seguimiento-del-lead.md) | Cada dos horas, de 10 a 18 |

## Dónde corre

Todo corre en tu máquina; no hay nada en la nube. La rutina es una tarea
programada de la app de escritorio de Claude. El tablero, si lo levantas, es un
proceso de Node que escucha solo en `127.0.0.1:4747`.

Los agentes no dependen de nada de esto. Viven en el server y siguen con sus
crons aunque tu máquina esté apagada, y desde Linear se les puede seguir
escribiendo `Cody: …` desde cualquier dispositivo.

La tarea **nunca despierta la máquina**. Si a las 8:30…

| …la máquina está | Qué pasa |
|---|---|
| prendida, con la app abierta | Corre la rutina completa. |
| suspendida | Sigue suspendida y la corrida se saltea. Al despertarla, la app lanza una corrida de recuperación. |
| apagada, o con la app cerrada | Nada, hasta que se abra la app de Claude. Ahí lanza la corrida de recuperación. |

La corrida de recuperación es una sola aunque se hayan perdido varios días, y
lo que hace depende de la hora a la que arranca:

- **Entre las 6 y las 14**: la rutina completa.
- **Fuera de ese horario**: sincroniza y avisa en cuatro líneas. El plan se
  arma recién cuando se lo pides («arma el plan»).

Esa regla vive en el prompt de la tarea (`scheduled-tasks/hoja-del-dia.md`).

El tablero sobrevive a una suspensión, pero no a un apagado ni a un reinicio:
vuelve con la corrida siguiente o con `npm run lead:start`.

## Qué hay en el tablero

Si lo levantas:

| Pestaña | Para qué |
|---|---|
| **Hoy** | Las tareas que propone (con el comentario para el agente ya escrito) y lo que solo tú puedes hacer. El resaltador marca la próxima. Al costado: lo que está en marcha y en qué etapa, lo que te espera (PRs, respuestas), las señales de los reportes y lo que propone cerrar. |
| **Bandeja** | Todo lo abierto que pide una decisión, agrupado por veredicto del lead y ordenado por puntaje. Cada fila se abre con el porqué y los botones. |
| **Proyectos** | Por producto: cuánto hay abierto, cuánto es trabajo y cuánto registro, si el backlog crece o baja. |
| **Agentes** | Qué propuso cada agente y cómo terminó, y las recomendaciones del lead para Alfred. |
| **Registro** | Cada decisión tomada desde el tablero o por chat. |

## Ajustarlo

Todo lo que es criterio está en [`lead.config.json`](lead.config.json):

- `projects[].attentionShare` — cuánta de tu atención va a cada producto.
- `projects[].objectiveWeights` — cuánto pesa cada objetivo (facturación,
  visitas, seguridad…) en ese producto.
- `limits` — cuántas tareas van en marcha a la vez (`tasksInFlight`, 3 por
  defecto), cuántos minutos tuyos entran en un día (`ownerMinutesPerDay`),
  cuántos pedidos a Cody por repo, cuándo algo se considera viejo.
- `autonomy` — qué hace el lead sin esperar tu sí. Está en `true` lo que solo
  constata un hecho y se deshace con un click; en `false`, lo que arranca
  trabajo nuevo. Pon cualquiera en `false` y vuelve a preguntarte.
- `alfred.teamKey` — dónde se crean los `[Retro]` para Alfred.

El foco estratégico de cada producto no se repite aquí: sale de
`projects/<slug>/project.json → strategicFocus`.

## Dónde vive el estado

En `lead/state/` del **checkout principal** del repo, aunque la sesión corra en
un worktree (los scripts lo resuelven con `git rev-parse --git-common-dir`). No
se versiona. Se puede mover con la variable `LEAD_STATE_DIR`.

| Archivo | Qué guarda | Quién lo escribe |
|---|---|---|
| `snapshot.json` | Issues abiertos, cerrados de los últimos 45 días, PRs, estadísticas | `sync.mjs` |
| `triage.json` | El veredicto del lead para cada issue | `lead.mjs triage` / el tablero cuando corriges uno |
| `plan.json` | La Hoja del día, con el lote de cierres y la vía de cada uno | `lead.mjs plan` / el tablero al marcar avances |
| `tasks.json` | Las tareas aprobadas y en qué etapa está cada una, hasta producción | `lead.mjs mark … dispatched` / `task` / el tablero al enviar un pedido |
| `alfred.json` | Recomendaciones para Alfred | `lead.mjs alfred` / el tablero al enviar o descartar |
| `decisions.jsonl` | Cada decisión, con fecha y quién la tomó (`owner` o `lead`) | el tablero, `act.mjs` y `lead.mjs mark` / `task` / `log` |
| `history/` | Los planes de los días anteriores | `lead.mjs plan` |

## Credenciales

El sync, `act.mjs` y el tablero usan `LINEAR_API_KEY` (una personal API key de
Linear). La buscan en este orden:

1. **El entorno.** Si la variable ya está definida, se usa esa.
2. **`.env.local.age`**, con el mismo esquema del resto del repo
   (`scripts/op-env.mjs`, 1Password + age): si la variable no está, el script se
   re-ejecuta envuelto en `op-env exec` y la descifra a memoria. Nunca se
   imprime ni se escribe en disco en claro.

El tablero, que queda corriendo todo el día, se queda solo con esa variable: saca
del entorno el resto de lo que descifró.

Si Linear la rechaza, el sync sale con código 2 y el tablero pasa a solo
lectura (cada botón deja el texto copiado para pegar en Linear). Para rotarla:

1. Linear → Settings → Security & access → Personal API keys → crear una nueva.
2. Reemplazarla donde la guardas: con op-env, en el campo `LINEAR_API_KEY` del
   item de 1Password que usa `scripts/op-env.mjs`, y desde la raíz del repo
   `npm run env:encrypt` (pide biometría una vez); si la defines en el entorno, ahí.
3. Reiniciar el tablero.

Los PRs salen del CLI `gh` con la sesión que ya tiene la máquina.

## Seguridad del tablero

El tablero puede comentar en Linear, y un comentario `Cody: …` dispara trabajo
real en el server. Por eso:

- escucha solo en `127.0.0.1`;
- valida `Host` y `Origin`, y toda escritura exige un token que nace en cada
  arranque y solo viaja dentro de la página;
- una escritura solo vale si sale de la página (la cabecera que manda un
  navegador y no un script) y sobre la versión del plan que la página está
  mostrando: si el plan cambió, el click no se ejecuta y la página se actualiza;
- no hay scripts inline (CSP) y el front nunca inserta texto de Linear como HTML;
- el issue, el agente y el comentario de una decisión salen del plan guardado,
  no de lo que mande el navegador;
- un pedido a un agente no sale dos veces, ni a un issue que en Linear ya está
  cerrado; y un cierre no pisa un issue que alguien movió después del último sync.

## Archivos

```
lead/
  lead.config.json        proyectos, pesos, límites, autonomía, team de Alfred
  abrir-tablero.cmd       lanzador de doble click (Windows)
  scheduled-tasks/        los prompts de las dos tareas programadas
  scripts/
    lib.mjs               estado, secretos, cliente de Linear, roster
    model.mjs             cómo se clasifica un issue + estadísticas
    github.mjs            PRs abiertos, recién mergeados, y lo que salió en cada app
    sync.mjs              Linear + GitHub → snapshot.json
    lead.mjs              CLI del lead (solo estado local)
    act.mjs               lo que cambia issues en Linear: cerrar el lote, reabrir, pasar a In Progress, fundir, mandar a Alfred
    tasks.mjs             las tareas en marcha y sus etapas
    state.mjs             el registro de decisiones y el reflejo local de un cierre
    start-dashboard.mjs   deja el tablero corriendo en segundo plano (o lo apaga)
    selftest.mjs          prueba de humo, sin red y sin tocar el estado real
  app/
    server.mjs            servidor local (sin dependencias)
    public/               index.html · app.css · app.js
  state/                  runtime, no se versiona
.claude/skills/project-lead/   la skill: SKILL.md + references/
```

## Límites conocidos

- **«Lo que salió en cada app» no sabe qué issue resuelve cada cambio.** Solo
  marca los que nombran un id (`ACM-123`) en el título o en la rama, y la
  mayoría no nombra ninguno. Cruzar un cambio con una propuesta es lectura del
  lead, no del script. Trae 45 días (`sync.shippedDays`) de los repos donde
  mergeas; los de solo lectura no entran.
- **Los previews de un PR pueden pedir login** (los de Vercel, por ejemplo): el
  lead puede leer el diff y comprobar la base, pero no abrir el preview. Lo que
  se ve lo prueba Qualy.
- El resumen semanal de Pico cuenta todo lo que pasó a `Done`, así que la
  primera tanda grande de reportes archivados va a inflar esa cifra una vez.
- El autor de un issue se deduce de la firma del cuerpo («Generado por 🤖 …») y,
  si falta, del título (`model.mjs` tiene las reglas: si sumas una skill que abre
  issues con otro formato, agrégala ahí). Las propuestas sin firma quedan como
  «un agente».
- `codyDispatchesPerRepoPerDay` y `openPrsBeforeNewDispatch` son reglas de la
  skill, no validaciones del CLI.
- La tarea programada corre solo con la app de escritorio abierta y la máquina
  despierta. Si perdió su hora, corre una vez al volver: ver
  [Dónde corre](#dónde-corre).
