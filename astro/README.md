# `astro` package

Oracle and evaluation tooling for the Cairo astronomy-engine workspace.

**All eval results go to stdout (ndjson). Progress and diagnostics go to stderr.**
Redirect stdout to capture results: `> evals/output.ndjson`.
See [../spec/EVALS.md](../spec/EVALS.md) for the full evaluation specification.

## Evaluation

Structured eval (12 months x 2 locations per year, deterministic grid):

```bash
node src/cli/eval-cairo-engine.js --start-year 2000 --end-year 2100 > evals/structured.ndjson
```

Random eval (seed-deterministic sampling across full date/location range):

```bash
node src/cli/eval-random-cairo-engine.js --points 1000 --seed 42 > evals/random.ndjson
```

Fill a gap in an interrupted random run:

```bash
node src/cli/eval-random-cairo-engine.js --points 1000 --seed 42 \
  --start-index 48 --end-index 96 >> evals/run.ndjson
```

Precision mode (per-point angular error vs oracle):

```bash
node src/cli/eval-cairo-engine.js --start-year 2000 --end-year 2010 --mode precision > evals/precision.ndjson
```

## Other CLI tools

Build sign-level oracle corpus:

```bash
node src/cli/generate-corpus.js \
  --start 2026-01-01T00:00:00Z \
  --end 2026-01-02T00:00:00Z \
  --step-minutes 60 \
  --lat-bins 3770 \
  --lon-bins -12240
```
