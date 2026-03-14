# v5 Heavy Batch Size Benchmark (2026-03-13)

## Scope

Measured `eval-cairo-engine.js` on the v5 heavy profile over years `1-100`:

- profile: `heavy`
- years: `1-100`
- total points: `2400`
- locations: `NYC+Alexandria`
- months per year: `12`
- engine: `v5`

Each run completed with:

- `failCount = 0`
- `planetFailCount = 0`
- `ascFailCount = 0`

## Results

Sorted by wall-clock time (`/usr/bin/time -lp`):

| Batch size | Wall time (s) | User CPU (s) | Sys CPU (s) | Script elapsed (ms) | Windows |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 544.47 | 456.87 | 71.31 | 539414 | 100 |
| 5 | 597.97 | 418.03 | 125.61 | 592616 | 20 |
| 10 | 648.22 | 412.83 | 150.97 | 642848 | 10 |
| 15 | 925.05 | 411.34 | 168.78 | 919916 | 7 |
| 20 | 1102.99 | 412.79 | 199.18 | 1097717 | 5 |
| 25 | 1203.58 | 408.32 | 200.87 | 1198177 | 4 |
| 30 | 1208.02 | 410.21 | 196.62 | 1202657 | 4 |

## Point-Sub-Batch Results

Measured with:

- `--batch-size 1`
- varying `--points-per-batch`

This isolates the effect of shrinking each Cairo invocation below the default `24` points/year in heavy mode.

Sorted by wall-clock time (`/usr/bin/time -lp`):

| Points per batch | Wall time (s) | User CPU (s) | Sys CPU (s) | Script elapsed (ms) |
| --- | ---: | ---: | ---: | ---: |
| 24 | 544.47 | 456.87 | 71.31 | 539414 |
| 21 | 588.08 | 493.63 | 73.35 | 583309 |
| 18 | 594.81 | 496.49 | 77.14 | 589825 |
| 12 | 598.29 | 497.95 | 77.95 | 592931 |
| 8 | 680.24 | 555.30 | 93.63 | 674818 |
| 4 | 920.38 | 724.48 | 129.81 | 915063 |
| 2 | 1370.67 | 1052.89 | 187.97 | 1365372 |
| 1 | 2198.17 | 1670.76 | 286.32 | 2193046 |

## Takeaways

- Larger heavy batches were not faster on this machine.
- `--batch-size 1` was fastest.
- `--batch-size 5` and `--batch-size 10` were also materially better than `15+`.
- `--batch-size 25` and `--batch-size 30` were effectively tied and were the slowest tested settings.
- Within `--batch-size 1`, the default `24` points/invocation remained the fastest tested point-sub-batch setting.
- True per-point invocation (`--points-per-batch 1`) was dramatically slower.

Relative to `--batch-size 1`:

- `5` was slower by about `9.8%`
- `10` was slower by about `19.1%`
- `15` was slower by about `69.9%`
- `20` was slower by about `102.6%`
- `25` was slower by about `121.1%`
- `30` was slower by about `121.9%`

## Interpretation

The original intuition was that larger batches might win by reducing runner invocations. The measurements do not support that for the current heavy evaluator path.

Observed behavior suggests that increasing packed batch size makes each invocation disproportionately more expensive, enough to outweigh any saved launch overhead. In practice, throughput degrades steadily once batch size grows past `1-10`.

The point-sub-batch experiment shows the opposite extreme also has a cost: shrinking Cairo invocations below the default `24` points/year eventually increases total runtime sharply. For the tested range, the optimum sat at the top end of the point-sub-batch interval rather than at per-point granularity.

CPU breakdown reinforced the same story:

- In the year-batch sweep, `user` CPU stayed relatively flat once batch size was `5+`, while `sys` CPU climbed substantially as batch size grew.
- In the point-sub-batch sweep, both `user` and `sys` climbed sharply as points per batch shrank below `24`, especially at `4`, `2`, and `1`.
- The fastest settings were not the ones with the lowest `user` CPU. They were the ones with the best combined process/system overhead profile.

## Recommendation

For heavy baseline sweeps on this machine:

- prefer `--batch-size 1` for maximum throughput
- keep the default per-year heavy invocation shape (`24` points/invocation)
- do not split `--batch-size 1` further with `--points-per-batch` for throughput
- avoid assuming that larger batches improve runtime without measurement

## Related Artifacts

- Full heavy baseline summary:
  - `astro/evals/v5-heavy-baseline-20260312-overnight.ndjson`
- Timing logs and temporary benchmark outputs used for this note:
  - `/tmp/ae-heavy-1-100-b1.log`
  - `/tmp/ae-heavy-1-100-b5.log`
  - `/tmp/ae-heavy-1-100-b10.log`
  - `/tmp/ae-heavy-1-100-b15.log`
  - `/tmp/ae-heavy-1-100-b20.log`
  - `/tmp/ae-heavy-1-100-b25.log`
  - `/tmp/ae-heavy-1-100-b30.log`
