# v5 Parity Next Steps (Planet Pipeline)

## What We Learned

- Ascendant mismatches are currently not the issue in sampled windows.
- Planet mismatches dominate, especially Saturn, then Mercury/Jupiter/Venus/Mars.
- In collected mismatch samples, all mismatches are very near sign boundaries:
  - 76 / 84 are within 0.1 deg of a cusp.
  - 84 / 84 are within 0.5 deg.
  - 84 / 84 are within 1.0 deg.
- This indicates threshold-edge drift, not gross positional failure.

## Artifacts

- Summary eval data (updated schema):
  - `astro/evals/v5-heavy.ndjson`
- Regional profiling (per-planet counters):
  - `astro/evals/v5-heavy-diagnostics.ndjson` (3401-3600)
- Mismatch logs:
  - `astro/evals/v5-heavy-mismatches-1001-3000.ndjson` (partial through 1100)
  - `astro/evals/v5-heavy-mismatches-3461-3500.ndjson`
  - `astro/evals/v5-heavy-mismatches-3081-3140.ndjson` (partial through 3100)
- Analyzer outputs:
  - `astro/evals/v5-heavy-mismatches-combined-summary.md`
  - `astro/evals/v5-heavy-mismatches-combined-summary.json`
- Regression corpus:
  - `astro/evals/v5-heavy-planet-regression-corpus.ndjson`

## Immediate Execution Plan

1. Keep broad sweeps in fast mode (no `--mismatch-log`).
2. Use `--mismatch-log` only on narrow windows where `failCount > 0`.
3. Add one more evaluator metric: signed delta-to-cusp direction for failed planet bits.
   - Goal: identify whether Cairo tends to lag/lead boundaries consistently.
4. Focus parity work on outer planet sign-boundary timing:
   - Prioritize Saturn and Jupiter first.
   - Verify TT/light-time/frame path parity at sub-degree precision around known mismatch minutes.
5. Gate each change against the regression corpus and `1001-3000` heavy summary.

## Target

- Reach >= 99.99% chart accuracy in 1001-3000 heavy window.
- At current sample density (48,000 points), this implies <= 5 chart fails.

