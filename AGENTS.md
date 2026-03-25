# AGENTS

## Astronomy Engine Policy

- Primary objective: preserve or improve fidelity to the upstream `astronomy` computational pipeline.
- Prefer algorithmic parity work (time scales, transforms, precession/nutation chain, light-time path, periodic terms) over dataset-specific tuning.
- Do not use empirical spot-corrections as the main accuracy strategy.
- If any temporary correction is introduced for debugging, it must be clearly marked and removed before finalizing.
- Evaluation windows are for measurement only, not targets for hand-tuned fixes.

## Engine Versions

- `v1`–`v4`: research iterations (table ingress → Chebyshev → VSOP → full 7-body pipeline).
Archived in `cairo/crates/research/`.
See per-crate READMEs for details.
- `v5`: production engine.
>99.999% sign-level parity (100% on structured eval, 1 irreducible cusp case per ~96k random points).
- `v6`: deployment-optimized v5 with reduced trig tables (76% fewer entries).
Fits within Starknet's 4 MB contract class size limit.

See [cairo/crates/research/RESEARCH.md](cairo/crates/research/RESEARCH.md) for the full development arc.

## Running Evaluations

All commands run from `astro/`. Output is ndjson to stdout, logs to stderr.
Results stored in `astro/evals/`. Cairo eval runner lives at `cairo/eval_runner/`.

```sh
# Structured eval: every month in year range at NYC + Alexandria
cd astro && node src/cli/eval-cairo-engine.js --start-year 1900 --end-year 2100 > evals/structured.ndjson
cd astro && node src/cli/eval-cairo-engine.js --start-year 1900 --end-year 2100 --mode precision > evals/precision.ndjson

# Random eval: stratified random points across years 1–4000 (deterministic per seed)
cd astro && node src/cli/eval-random-cairo-engine.js --points 96000 --seed 42 > evals/random-96k-seed42.ndjson
cd astro && node src/cli/eval-random-cairo-engine.js --points 10000 --seed 42 --mode precision > evals/precision-10k-seed42.ndjson

# Resume interrupted random eval from index 5000
cd astro && node src/cli/eval-random-cairo-engine.js --points 96000 --seed 42 --start-index 5000 >> evals/random-96k-seed42.ndjson

# Unit tests
cd astro && node --test test/eval-harness.test.js test/eval-random-harness.test.js
```

Both scripts support `--mode signs|precision`. Structured requires `--start-year`/`--end-year`. Random uses `--points`, `--seed`, `--start-index`/`--end-index`.
Evals are slow (96k random takes hours). Use small `--points` or `--start-index`/`--end-index` for quick checks.
`npm run clean:eval` clears cached Cairo execution artifacts.
