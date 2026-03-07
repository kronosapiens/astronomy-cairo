# v5 Engine Research Context

This document is the persistent working context for improving `astronomy_engine_v5`.

## Primary Goal

- Achieve **>= 99.99% chart-level accuracy** in the `1001-3000` heavy evaluation window.
- At current heavy sampling density (`48,000` points for `1001-3000`), this means roughly **<= 5 chart fails**.

## Non-Negotiable Process Rules

- Never run more than **one heavy eval process at a time**.
- Before starting a new heavy eval, ensure no other heavy eval is running.
- Prefer smaller targeted windows for diagnostics; use full sweeps only for milestone checks.
- Keep this file updated as part of the work in every agent session.

## Current Evaluation Pipeline

## Core runner

- Script: `astro/src/cli/eval-cairo-engine.js`
- Key flags:
  - `--profile heavy|light`
  - `--start-year <inclusive>`
  - `--end-year <inclusive>`
  - `--batch-size <years>`
  - `--max-batch <points per batch guard>`
  - `--mismatch-log <path>` (slow path; logs only failed points)

## Current output row format

Each summary row is year-range scoped (no batch index), e.g.:

```json
{"tsUtc":"...","engine":"v5","profile":"heavy","yearStart":1001,"yearEnd":1020,"passCount":476,"failCount":4,"planetFailCount":4,"ascFailCount":0,"sunFailCount":0,"moonFailCount":0,"mercuryFailCount":0,"venusFailCount":0,"marsFailCount":0,"jupiterFailCount":0,"saturnFailCount":4,"elapsedMs":...}
```

## Analyzer / corpus tools

- `astro/src/cli/analyze-mismatch-log.js`
  - Aggregates masks, planets, locations, year buckets.
  - `--with-cusp` computes distance to nearest sign boundary for mismatched planet bits.
- `astro/src/cli/build-mismatch-corpus.js`
  - Builds deduplicated regression corpus from mismatch logs.
- `astro/src/cli/eval-mismatch-corpus.js`
  - Deterministic gate over corpus; reports total + per-planet fails and failed point masks.

## Useful commands

```bash
# Fast regional profiling (preferred default)
node astro/src/cli/eval-cairo-engine.js --profile heavy --engine v5 --start-year 2801 --end-year 3200 --batch-size 20 --quiet

# Targeted mismatch details (slow)
node astro/src/cli/eval-cairo-engine.js --profile heavy --engine v5 --start-year 3461 --end-year 3500 --batch-size 20 --mismatch-log astro/evals/v5-heavy-mismatches-3461-3500.ndjson --quiet

# Analyze mismatch file
node astro/src/cli/analyze-mismatch-log.js --in astro/evals/v5-heavy-mismatches-3461-3500.ndjson --out-prefix astro/evals/v5-heavy-mismatches-3461-3500-summary --year-bucket 20 --with-cusp

# Build mismatch corpus
node astro/src/cli/build-mismatch-corpus.js --in astro/evals/v5-heavy-mismatches-1001-3000.ndjson,astro/evals/v5-heavy-mismatches-3461-3500.ndjson --out astro/evals/v5-heavy-planet-regression-corpus.ndjson

# Evaluate mismatch corpus
node astro/src/cli/eval-mismatch-corpus.js --corpus astro/evals/v5-heavy-planet-regression-corpus.ndjson --out astro/evals/v5-heavy-planet-regression-corpus-eval.json
```

## Baseline Results (So Far)

- Full `1-4000` heavy: `94,640` pass / `1,360` fail => `98.5833%`.
- `1001-3000` heavy: `47,814` pass / `186` fail => `99.6125%`.
- `1900-2100` heavy: `4,814` pass / `10` fail => `99.7927%`.

## Observed Failure Pattern

- In sampled hotspot windows, **ascendant fails are zero**.
- Current misses are planet-side and clustered near sign cusps.
- Combined mismatch analysis (`84` sampled rows):
  - Planet contributions: Saturn `32`, Mercury `14`, Jupiter `14`, Venus `12`, Mars `12`.
  - Cusp distance: `76/84` within `0.1°`, `84/84` within `0.5°`.
  - Strong indication: mostly **boundary timing/parity drift**, not large absolute-position failure.

## Approaches Tried and Outcome

1. Added split counters (`planetFailCount`, `ascFailCount`, per-planet counts)
- Outcome: successful; major visibility improvement.

2. Added full mismatch logging (`--mismatch-log`) with per-point masks
- Outcome: successful but slow on wide windows; useful only for targeted slices.

3. Added mismatch analyzer and cusp-distance mode
- Outcome: successful; showed cusp-edge dominance.

4. Added mismatch regression corpus and corpus evaluator
- Outcome: successful; enables deterministic gating.

5. Time-scale rounding tweak in v5 planet path (`T` conversion rounding)
- Outcome: no measurable fail reduction in hotspot A/B checks.

6. Started apparent-correction parity work (annual-aberration style correction + lon/lat helper)
- Status: in progress; requires follow-up validation and likely deeper upstream-parity alignment.

## Recommended Next Work

1. Continue apparent-position parity work for planets (especially Saturn/Jupiter path).
2. Use mismatch logs only on 20-100 year hotspot slices.
3. Gate each change on:
   - regional heavy summaries (fast)
   - mismatch corpus eval (deterministic)
4. Update this document after each significant change:
   - what changed
   - windows tested
   - before/after fail deltas (total + per-planet)
   - conclusion and next action.

