# topic-memory.md — ledger del banco de ideas del blog (🤖 Leda 📖)

> Lo reescribe `content-topic-scan` cada semana (único write permitido de esa skill). El owner lo
> puede editar a mano. Sirve para no recargar lo ya cargado o descartado, saber qué notas
> publicadas todavía necesitan su refresh y qué notas se pisan entre sí.
>
> **Estado**: _(sin corridas todavía — el primer scan completa esta línea con el tamaño del banco y
> la cantidad de notas publicadas)._

## Propuestas y cargas

| fecha | keyword | tipo | prioridad | estado | issue | nota |
|---|---|---|---|---|---|---|
| _YYYY-MM-DD_ | _refresh: ejemplo-de-slug_ | _refresh_ | _1_ | _cargado_ | _ACM-123_ | _Ej.: 1.200 impr / pos 9 / CTR 0,8% — la nota no responde la pregunta en el primer párrafo_ |

Estados: `cargado` (con la fecha y el issue) · `ya estaba` · `falló la carga` · `descartado` (con
el motivo) · `pregunta para el owner`.

## Refresh pendientes (notas publicadas con demanda que no están al estándar)

Ordenadas por impresiones en Search Console (90 días, con la fecha del corte). Sácalas de la lista
cuando su refresh esté publicado.

- _(vacío)_ — formato: `` `<slug>` `` — impresiones, posición, CTR. Qué búsqueda recibe y por qué la
  nota no la responde.

## Canibalizaciones conocidas (notas que responden la misma pregunta)

Se resuelven con un refresh de la más fuerte que absorba el ángulo de las otras y las enlace. Si
conviene consolidar (redirigir las débiles a la fuerte), es pregunta para el owner y trabajo de Cody.

- _(vacío)_ — formato: **<tema>**: `` `<slug-fuerte>` `` (impr) · `` `<slug-débil>` `` (impr).

## Preguntas abiertas para el owner (no son topics)

- _(vacío)_ — p. ej. notas publicadas fuera del foco del producto (¿se dejan, se despublican o se
  redirigen?), categorías fuera de la taxonomía, slugs con caracteres rotos (cambiar un slug cambia
  la URL y necesita redirect: no lo hace un refresh).

## Descartes permanentes (no proponer)

- Temas fuera del foco del producto (`project.json → strategicFocus`) o de su audiencia (`icp.md`).
- Preguntas que ya responde una página del producto (TODO(acme): las páginas programáticas o de
  documentación que el blog no debe duplicar).
- TODO(acme): notas de tráfico alto pero de baja intención que no conviene alimentar.
