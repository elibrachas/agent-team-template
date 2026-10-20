# Cómo se trabaja con este equipo (y por qué está armado así)

El resto de la documentación explica **qué** hace cada pieza. Este documento explica **por qué**: la forma de trabajar detrás del repo y las lecciones que dieron forma a cada regla. Si vas a adaptar el template, esto es lo que conviene no perder.

---

## La idea central

Los agentes no reemplazan decisiones: **reemplazan el trabajo que hay entre decisión y decisión**. Leer datos, armar un reporte, redactar una propuesta, escribir el código, probarlo, dejar el mockup listo. La persona decide qué entra al producto; los agentes hacen que decidir sea rápido porque cuando llega el momento, el trabajo ya está hecho y revisable.

Por eso todo pasa por **Linear**: es el lugar donde ya se decide. Un agente no tiene una interfaz propia; tiene un issue donde comenta.

## Un ciclo típico

```mermaid
flowchart LR
  subgraph Solo["Corre solo (cron)"]
    A[Skill de Numa / Greta / Pico] --> B["Issue [Report] / [Proposal]<br/>en Backlog, sin asignar"]
  end
  B --> C{Tú lees y decides}
  C -- "Pico: arma la propuesta" --> D[Issue con las 6 secciones]
  C -- descartar --> X[Cerrado]
  D -- "Daly: haz el mockup de ACM-12" --> E[design/acme/ACM-12-*/<br/>mockup.html + brief.md]
  E -- "Cody: implementa ACM-12" --> F[PR en el repo del producto]
  F -- "Qualy: prueba el PR" --> G[✅ / ❌ con screenshots]
  G --> H{Tú revisas y mergeas}
```

1. **Lunes temprano** corren los crons: Numa revisa el funnel, Greta la semana de SEO/AEO, Pico escanea ideas y deuda técnica. Cada uno deja un issue `[Report]` o `[Proposal]` en *Backlog*, **sin asignar y sin prioridad**. El board se llena de material, no de compromisos.
2. **Tú lees** y promueves lo que vale la pena. Lo que no, lo cierras. Nada avanza solo.
3. Cuando algo merece construirse, **llamas al siguiente agente comentando en el mismo issue**: `Daly: haz el mockup de ACM-12`, `Cody: implementa ACM-12`, `Qualy: prueba el PR`. Cada uno lee el hilo completo, así que el contexto viaja con el issue.
4. **Tú mergeas.** Ningún agente puede hacerlo.
5. Si un agente se equivocó de una forma que se va a repetir, lo marcas y **Alfred** abre un PR contra este repo para que no vuelva a pasar.

El paso 5 es el que convierte un conjunto de prompts en un sistema que mejora: los errores no se corrigen en la conversación (donde se olvidan), se corrigen en el código de los agentes (donde quedan).

## Lecciones detrás de las reglas

### Los agentes proponen, las personas deciden
Cada skill declara un nivel HITL. Nivel 1 solo lee y reporta; nivel 2 propone y espera un OK explícito; nivel 3 (ejecución autónoma con rollback) se usa en un único caso: la carga del banco de ideas del blog. No es desconfianza en el modelo: es que un error de un agente en producción cuesta mucho más que el minuto que lleva aprobar.

### Una aprobación que no suma control es un cuello de botella
El banco de ideas del blog empezó en nivel 2: Leda proponía la tanda y esperaba un "carga los topics". Una semana la aprobación no llegó, el banco se vació y el blog dejó de publicar. El filtro que decide qué idea entra (¿hay evidencia de demanda?, ¿ya hay una nota para esa pregunta?, ¿existe lo que necesita?) ya hacía todo el control; la aprobación solo agregaba espera. Por eso esa skill pasó a nivel 3: carga sola, deja el registro en un issue y la vuelta atrás es borrar la idea antes de que se escriba. La regla general sigue siendo la contraria: sube de nivel solo lo que se deshace fácil y deja rastro.

### Los issues nacen en Backlog, sin asignar y sin prioridad
Un agente que asigna o prioriza está decidiendo qué trabaja el equipo. Esa convención (label `agent-proposal`, estado `Backlog`, título `[Proposal] ...`, cuerpo con 6 secciones fijas) hace que todo lo generado por agentes sea fácil de filtrar, de revisar en bloque y de descartar sin culpa.

### Registros y decisiones van por separado
Con varios crons por proyecto, el Backlog se llena de reportes que no piden nada y las propuestas de verdad quedan enterradas: llegó un punto en que casi la mitad de los issues abiertos eran registros y había que cerrarlos a mano. La regla quedó así: todo nace en `Backlog`, pero una **decisión** (propuesta, alerta, hallazgo) lleva `agent-proposal` y espera a una persona, y un **registro** (reporte, digest, tick) lleva `agent-report`, un título fijo por serie y un issue por corrida. Ningún agente cierra sus registros: el Project Lead los archiva a los 2 días. Y una corrida sin novedades no crea issue: alcanza con el espejo local.

### La memoria envejece: verifica contra el código
La base de conocimiento de este repo (`project.json`, `data-model.md`, los overrides, `memory/`) describe el producto en un momento, y el producto cambia todos los días por fuera de aquí. En una revisión, una buena parte de las propuestas abiertas pedía algo ya hecho o partía de una premisa vieja (un proveedor que ya se había migrado, una función que se había borrado). Por eso todo agente que propone o diagnostica confirma el hecho en la rama principal del repo del producto antes de afirmarlo, y si el código desmiente a la base, manda el código y lo dice para que se corrija.

### Decidir es el cuello de botella
Cuando los agentes ya generan y priorizan bien, lo que se acumula son las decisiones pendientes: el mismo pedido repetido semana tras semana en el `[Plan]`. El Project Lead existe para eso: no genera más ideas, arma cada decisión para que se conteste con un sí o una letra, hace solo lo de bajo riesgo que se deshace con un clic y sigue lo aprobado hasta que está en producción.

### La firma anti-loop no es decorativa
Los agentes comentan en Linear con la API key de una persona. Sin una marca, el listener vería su propio comentario como un pedido nuevo y el agente se respondería a sí mismo. Por eso cada respuesta arranca **exactamente** con `🤖 <Nombre> <Emoji>:` y el listener ignora todo lo que empiece con `🤖`. "Exactamente" importa: un `**` de markdown o un paréntesis alcanzan para romperlo.

### Cody es un agente ciego
Typecheck, lint y tests pasan aunque un botón quede invisible o un ícono desalineado: el agente no ve lo que renderiza. De ahí salen tres reglas: **reusar antes de crear** (buscar el componente que ya existe en vez de reinventarlo), **usar solo los tokens del design system** (nunca un hex suelto) y **pedir review visual** en el PR. Qualy, con un browser real, es el ojo que falta; Daly deja el mockup contra el que se compara.

### El límite es de tiempo, no de plata
Corriendo contra una suscripción, el costo por corrida no es el riesgo real; el riesgo es un loop colgado que ocupa la máquina toda la noche. Cada agente declara `TimeoutMinutes` y un watchdog mata el árbol de procesos (incluidos los servidores MCP) al vencer. El presupuesto en USD queda solo como respaldo.

### Mínimo privilegio por wrapper
En modo headless no hay nadie para aprobar un permiso, así que cada wrapper pasa una **allowlist corta de tools**, configuración de MCP estricta y bases de datos en solo lectura. Los agentes leen texto de terceros (issues, páginas web, logs), lo que los expone a prompt injection: la defensa no es el prompt, es que no tengan las herramientas para hacer daño.

### Core vs. proyecto: una regla para saber dónde va cada cambio
Si el cambio mejora **cómo actúa un agente** en general (su método, sus hard stops), va al core (`scripts/agents.ps1`) y beneficia a todos los proyectos. Si cambia **el dominio** (tablas, tono, comandos de test, archivos que no se tocan), va al override del proyecto. Esta regla es la que permite que un mismo equipo opere varios productos sin que el contexto de uno contamine al otro.

### El contexto es el producto
La mayor parte de la calidad de un agente sale de lo que lee al arrancar: `brand-bible.md`, `glossary.md`, `data-model.md`, `icp.md`. Un glosario con la definición exacta de cada métrica evita que dos agentes calculen "conversión" de dos formas. Vale la pena invertir más tiempo aquí que en afinar prompts.

### Los números, con su n
Con volúmenes chicos, un 50% de caída puede ser pasar de 2 a 1. Los agentes de data reportan siempre el absoluto junto al porcentaje, declaran los caveats de la fuente y, si una query falla, lo dicen en vez de estimar de memoria.

### Modelo según lo que está en juego
Por defecto, un modelo equilibrado. Los agentes de alto impacto (propuestas de producto, código que termina en producción, cambios al propio sistema de agentes) van en el modelo más capaz con más esfuerzo de razonamiento. Los modelos se declaran explícitos en el registro para que ninguna variable de entorno decida en silencio.

### Detalles técnicos que costaron caro
- PowerShell 5.1 lee los archivos sin BOM como ANSI: los `.ps1` con emojis o tildes van en **UTF-8 con BOM**, y los JSON se leen con `-Encoding UTF8`. Si no, los acentos llegan rotos a los prompts.
- Un error de sintaxis en `scripts/agents.ps1` rompe a **todos** los agentes a la vez: se valida el parseo antes de cada cambio, con `scripts/check-ps1-parse.ps1`. Ojo con el one-liner obvio: `ParseFile` devuelve los errores por un parámetro `[ref]` y no tira excepción, así que gatear por `$?` dice "OK" aun con el script roto.
- Cuando un proveedor no tiene tokens de solo lectura (Vercel, Google Ads), el solo-lectura se arma del lado propio: un MCP que solo hace GET a paths fijos con un pin de proyectos, un rol de solo lectura en la cuenta, y un nombre de variable que el CLI del proveedor no tome solo del entorno.
- Los logs de runtime del hosting suelen guardarse ~24 h: un review semanal solo ve el último día. Si importa, el review es diario o lo dice en el reporte.
- Una función que el hosting mata por tiempo (timeout) no llega a correr su `catch`: no deja rastro en la base. Esa falla solo se ve en los logs.
- Un commit de un agente puede salir con otra identidad (autor o email de otra cuenta) aunque el listener fije `GIT_AUTHOR_*` / `GIT_COMMITTER_*`: basta una subshell que no herede el entorno y git cae al `user.email` local del repo. Algunos hostings autorizan el deploy del preview por el email del autor y lo bloquean. Por eso Cody, antes del push, compara autor y committer de sus commits contra las variables fijadas y, si no coinciden, rehace el commit con `--amend --reset-author` (mismo árbol).
- Los workflows de n8n versionados pueden divergir de los que están vivos. Antes de reimportar uno, exporta el vivo y compara.
- Nunca clones el repo dentro de una carpeta sincronizada (OneDrive, Dropbox, iCloud): corrompen `.git/`.

## Empezar sin montar todo

No necesitas los 9 agentes, n8n ni un server para aprovechar el método. Un orden razonable:

1. **Solo contexto + skills, interactivo.** Completa `projects/<slug>/` y usa las skills desde Claude Code en tu máquina. Ya obtienes reportes y propuestas con el formato del equipo.
2. **Un agente por Linear.** Monta el listener con Capi y Numa. Aprendes el circuito comentario → respuesta firmada.
3. **Cody con PRs.** Suma el agente que escribe código, con su lista de archivos que no se tocan y los comandos de gating del producto.
4. **Crons.** Automatiza los reportes que ya leías a mano.
5. **Alfred.** Cuando ya tengas errores repetidos que valga la pena corregir en el sistema.
6. **Project Lead.** Cuando lo que se acumula sean tus decisiones y no el trabajo de los agentes (sobre todo con más de un proyecto).

Cada paso funciona por sí solo; si uno no te aporta, no hace falta el siguiente.
