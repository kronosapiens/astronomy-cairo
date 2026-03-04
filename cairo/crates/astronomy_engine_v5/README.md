# astronomy_engine_v5 (Cairo)

`astronomy_engine_v5` is a Cairo-native astronomy runtime for sign-level chart computation.

`v5` continues the `v4` line: deeper upstream-style astronomy math (vs table ingress), deterministic fixed-point execution, and chart-oriented outputs for seven bodies plus ascendant.

## Status Snapshot (2026-02-27)

- `eval-light` (project gate): `840 / 840` exact charts (`100.000000%`, `0` mismatches).
- `eval-heavy` (`casesPerWindow=80`): `1672 / 1760` (`95.000000%`, `88` mismatches).
- Practical mid-range Cairo sweep (`1000-3000`, denser profile): `2376 / 2400` (`99.000%`, `24` mismatches).

This is production-credible for modern-user chart ranges, with known deep-time miss pockets documented below.

## Purpose

- Deterministic onchain longitude/sign outputs for Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn, plus ascendant.
- Higher model fidelity than `v2`, with substantially smaller deployment footprint than table-heavy approaches.
- Preserve Cairo-native execution (no runtime external data ingress).

## Lineage (v1 -> v5)

- `v1`: table-ingress oracle signs; strongest bounded parity, large artifact.
- `v2`: Chebyshev parametric runtime; very low gas, narrower model semantics.
- `v3`: VSOP/frame runtime for Mercury..Saturn; Sun/Moon not yet fully upgraded.
- `v4`: upgraded Sun/Moon paths + wide proleptic Gregorian runtime entrypoints.
- `v5`: starts from `v4`, focuses on runtime/performance refinements and ascendant robustness.

## Upstream Reference

Primary reference:

- Donald Cross, [`astronomy-engine`](https://github.com/cosinekitty/astronomy) (MIT), package `^2.1.19`.

Citation guidance:

1. Cairo adaptation: `cairo/crates/astronomy_engine_v5`.
2. Upstream model: Donald Cross, `astronomy-engine`.

## What v5 Changed vs v4

- Ascendant solve upgraded to robust horizon-intersection form (avoids explicit `tan(lat)` division instability).
- Sun low-order fallback upgraded to higher-order analytic model.
- Residual alignment moved from static constants to smooth time-domain correction forms.
- Mercury/Venus/Mars/Saturn residual handling retuned for cusp-edge stability in project eval gates.

## Accuracy and Validation

### 1) Project Gate (`eval-light`)

- Profile: deterministic multi-era windows (`0001-4000`), 15-minute quantization, multi-location set.
- Result: `840 / 840` exact charts (`100.000000%`).

### 2) Broad Stress (`eval-heavy_v1`)

- `casesPerWindow=80`
- Total: `1672 / 1760`
- Accuracy: `95.000000%`
- Error rate: `50,000` per million
- Largest miss clusters:
  - `edge_0100_0200`: `36 / 80`
  - `uniform_1667_1867`: `56 / 80`
  - `cusp_2800_2820`: `68 / 80`

### 3) 100-Year Bin Sweep (`eval_heavy_century_bins_v1`)

Parameters: `stepMinutes=720`, `quantizeMinutes=15`, eval-heavy 12-location set, `maxCases=80` per century bin.

- Total `0001-4001`: `3116 / 3200` (`97.375%`, `84` failures, `26,250` per million).

Millennium rollup:

| Interval | Passed / Total | Accuracy | Failed |
| --- | --- | --- | --- |
| `0001-1001` | `752 / 800` | `94.000%` | `48` |
| `1001-2001` | `800 / 800` | `100.000%` | `0` |
| `2001-3001` | `800 / 800` | `100.000%` | `0` |
| `3001-4001` | `764 / 800` | `95.500%` | `36` |

### 4) Denser Cairo Sweeps (`maxCases=120` per century)

Matching profile across three bands: `stepMinutes=720`, `quantizeMinutes=15`, eval-heavy 12-location set.

| Band | Passed / Total | Accuracy | Failed | Error / million | Duration |
| --- | --- | --- | --- | --- | --- |
| `0001-1001` | `1152 / 1200` | `96.000%` | `48` | `40,000` | `151,005 ms` |
| `1000-3000` | `2376 / 2400` | `99.000%` | `24` | `10,000` | `279,517 ms` |
| `3000-4000` | `1176 / 1200` | `98.000%` | `24` | `20,000` | `154,853 ms` |

Miss bins in these denser runs:

- `0001-1001`: `0001-0101`, `0101-0201`, `0301-0401`, `0401-0501` (`108/120` each).
- `1000-3000`: `1000-1100`, `1400-1500` (`108/120` each).
- `3000-4000`: `3700-3800` (`96/120`).

## Moon Snapshot

Current moon-path validation (JS mirror of runtime path):

- `1900-2100` hourly (15-minute quantized): `1,753,177 / 1,753,177` (`100%`).
- Edge windows (`6h` step):
  - `0001-0200`: `0 / 292,192` mismatches
  - `3800-4000`: `0 / 293,656` mismatches
- Full sweep (`0001-4000`, hourly, 15-minute quantized):
  - `35,063,279 / 35,063,280` (`99.999997148014%`, one cusp-edge mismatch)

## Performance and Size (v1-v5)

### Runtime Gas (single-sample 7-body benchmark)

| Engine | Gas usage est. |
| --- | --- |
| `v1` | `44,183,350` |
| `v2` | `2,458,170` |
| `v3` | `152,425,080` |
| `v4` | `192,159,100` |
| `v5` | `184,328,770` |

Estimated STRK range (`3-10 gFri`, L2 gas component only):

- `v5`: `0.55298631` -> `1.84328770` STRK (for the benchmark above).

### Artifact/Footprint

| Engine | Core generated data source | Sierra artifact |
| --- | --- | --- |
| `v1` | `oracle_signs.cairo` = `808,011` bytes | `59,589,267` bytes |
| `v2` | `cheby_data.cairo` = `2,251,214` bytes | `72,129,199` bytes |
| `v3` | `vsop_gen.cairo` = `31,376` bytes | `18,233,716` bytes |
| `v4` | `vsop_gen.cairo` = `31,376` bytes | `18,233,717` bytes |
| `v5` | `vsop_gen.cairo` = `31,376` bytes | `18,265,410` bytes |

## Architecture

- `planets.cairo`: public longitude API and planet routing.
- `vsop_gen.cairo`: generated VSOP term data/evaluators (Earth + Mercury..Saturn).
- `frames.cairo`: VSOP->EQJ, precession/nutation, EQJ->ecliptic-of-date.
- `ascendant.cairo`: robust ascendant horizon-intersection solve with eastern-branch selection.
- `fixed.cairo`, `time.cairo`, `trig.cairo`, `types.cairo`: shared primitives.

## Porting Decisions

### Ported from upstream concepts

- VSOP-driven planetary evaluation.
- Frame/transform chain structure.
- Light-time-aware geocentric solve pattern.
- J2000-centered time framing.

### Cairo-specific adaptation

- Integer fixed-point (`i64` with `i128` intermediates, `1e9` scale).
- Deterministic lookup/interpolation trig.
- Fixed-iteration light-time solve.
- Runtime/gas-aware truncation choices.

## Known Limits

- Target is sign-level parity, not full floating-point vector equivalence at every intermediate stage.
- Residual misses are structured in deep-time pockets; this is expected under current numeric/trig constraints.
- `vsop_gen.cairo` is generated and should not be edited manually.

## Exploration Log (Condensed)

Focused non-empirical attempts against persistent Mars-window misses (`0001-0200`, known `p4` pockets):

- Rounded frame transform lane.
- Symmetric-rounding substitutions in VSOP/frame math.
- Upstream-style per-order VSOP longitude clamp.
- Higher-precision VSOP `t` lane (`1e12`).
- Rounded light-time distance (`isqrt` nearest).
- `atan2` ratio/interpolation symmetric rounding.

Outcome: no measured reduction in the persistent miss set; changes reverted.

Interpretation: meaningful additional gains likely require heavier structural work (broader high-precision lane and/or higher-fidelity trig/angle stack), not local arithmetic tweaks.

## Validation Workflow

From `cairo/`:

```bash
scarb test -p astronomy_engine_v5
scarb build -p astronomy_engine_v5
```

From repo root (real Cairo runtime parity harness):

```bash
node cairo/scripts/compare-v5-chart-parity.js \
  --start 1900-01-01T00:00:00Z \
  --end 1900-01-01T12:00:00Z \
  --step-minutes 180 \
  --locations "377,-1224" \
  --max-cases 4
```

## Scope Boundary

`v5` is the performance-oriented continuation of the higher-fidelity `v4` port line, balancing deterministic chart-sign correctness with practical Starknet deployment footprint.
