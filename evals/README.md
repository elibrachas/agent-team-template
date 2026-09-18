# Evals

Casos de prueba por skill. Estructura: una carpeta por skill; adentro, casos en JSON o markdown + un script runner.

```
evals/
├── funnel-monitor/
│   ├── cases/
│   │   ├── 01-baseline.json
│   │   └── ...
│   └── run.sh
├── seo-weekly-review/
│   └── ...
└── results/         # gitignored
```

Objetivo sugerido: cada skill crítica con al menos 10 casos antes de subirle el nivel de HITL.

## Cómo correr

```bash
# Eval individual
./evals/funnel-monitor/run.sh

# Todos los evals
./evals/run-all.sh
```

TODO: el template no incluye todavía casos ni `run-all.sh`. Empieza por las skills que tocan producción o crean issues.
