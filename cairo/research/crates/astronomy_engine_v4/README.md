# astronomy_engine_v4 (Cairo)

`astronomy_engine_v4` is a Cairo-native astronomy runtime for sign-level chart computation.

This crate is a higher-fidelity adaptation of the JavaScript [`astronomy-engine`](https://github.com/cosinekitty/astronomy) planetary path than `v2` and `v3`, while remaining constrained to Cairo fixed-point arithmetic and chart-oriented outputs.

## Purpose

- Provide deterministic onchain longitude/sign outputs for the seven classical chart bodies.
- Improve upstream-model fidelity for Mercury/Venus/Mars/Jupiter/Saturn relative to `v2`.
- Extend `v3` with Sun/Moon-path precision and stability improvements aimed at wider practical range.
- Keep all computation Cairo-native with no runtime table ingress dependency.

## Version Lineage (v1 -> v4)

- `v1`: table-driven oracle ingress for planet signs; strongest deterministic parity for bounded chart window, large artifact footprint.
- `v2`: Chebyshev parametric runtime; major gas reduction versus `v1`, still focused on 1900-2100 corpus parity.
- `v3`: deeper VSOP+frame runtime for Mercury..Saturn; moved complexity from tables to runtime math, did not yet complete Sun/Moon fidelity path.
- `v4`: extends `v3` with upgraded Sun path, upgraded Moon term-chain/stability/parity handling, and proleptic-Gregorian (`minute_since_pg`) runtime entrypoints for wider practical epoch support.

## What Changed From v3

- Sun path upgraded: geocentric Sun is derived from Earth VSOP and routed through the same frame chain (`EQJ -> precession -> nutation -> ecliptic-of-date`).
- Moon path upgraded: expanded term-chain, `delta_t` post-2050 stability fix, higher-precision internal century scaling (`t` at `1e12`), and higher-precision `delta_t` coefficients in the 1800-1860 branch.
- Validation/tooling upgraded: dedicated Moon parity CLI and diagnostics (`astro/src/cli/compare-v3-moon-parity.js`, `astro/src/oracle/v3-moon-model.js`).
- Time-domain target expanded: intended operating domain is about `±2000` years around J2000, while exhaustive mismatch stats are currently published for `1900-2100`.
- Cost/size tradeoff versus `v3`: currently higher gas with effectively identical Sierra artifact size in exchange for the above fidelity/range improvements.

## Upstream Reference and Attribution

Primary reference implementation:

- `astronomy-engine` JavaScript package (`^2.1.19`)
- Author: Donald Cross
- Repo: <https://github.com/cosinekitty/astronomy>
- License: MIT

This crate should be cited as:

1. Cairo adaptation in this repository (`cairo/crates/astronomy_engine_v4`).
2. Upstream reference implementation: Donald Cross, `astronomy-engine`.

If publishing benchmark or parity numbers, include both references.

## Adaptation Process

This port explores a deeper upstream-style chain than `v2` by evaluating truncated VSOP terms directly at runtime and applying frame conversions before deriving ecliptic longitudes.

### Engineering Decisions

#### Numeric model

- Runtime scalar: `i64`, fixed-point `1e9`.
- Intermediates: `i128` for multiply/accumulate and matrix/trig combinations.
- Integer-only trig and angle math (lookup/interpolation based) consistent with existing Cairo runtime utilities.

Why:

- Cairo cost profile favors bounded integer math over floating-point emulation.
- `i64 + i128` remains the practical precision/performance tradeoff for onchain sign-level computation.

#### Time contract

- Legacy compatibility input: `minute_since_1900` (`1900-01-01T00:00:00Z` epoch).
- Primary wide-range input: `minute_since_pg` (`0001-01-01T00:00:00Z` proleptic Gregorian epoch).
- Intended model operating domain: roughly `0001-01-01` through `4000-12-31` (about `±2000` years around J2000).
- Current exhaustive parity-validation window: `1900-01-01` to `2100-01-01`.

#### Planet model strategy

- Sun uses Earth VSOP-derived geocentric vector + frame chain.
- Moon uses expanded harmonic term-chain with fixed-point parity/stability corrections.
- Mercury/Venus/Mars/Jupiter/Saturn use generated VSOP term data (`vsop_gen.cairo`) with runtime series evaluation.
- Two-iteration light-time correction backdates both target and Earth in the VSOP branch.

#### Frame/transform strategy

For Mercury..Saturn, runtime path applies:

1. VSOP spherical evaluation (`L/B/R`) -> Cartesian ecliptic.
2. VSOP rotation to EQJ.
3. Precession (J2000 -> of-date).
4. Nutation (IAU2000B short series).
5. EQD -> true ecliptic-of-date longitude.

This closes a major semantic gap that dominated mismatch rates in simpler VSOP-only attempts.

### Ported / Preserved

1. Deterministic minute-based runtime interface used by existing chart crates.
2. Seven-body longitude API and shared ascendant approximation module.
3. Oracle-driven parity workflow against upstream `astronomy-engine` during development.

### Adapted (Equivalent Outcome, Different Mechanics)

1. Full upstream floating-point/vector stack is represented as fixed-point integer math.
2. VSOP term sets are truncated to practical per-order limits for Cairo cost control.
3. Light-time solver is fixed-iteration (2) rather than convergence-loop based.

### Dropped / Deferred

1. Full upstream feature surface (all bodies and all coordinate APIs).
2. Full upstream-equivalent Moon model and strict floating-point operation-order parity.
3. Fully generalized runtime generator pipeline checked into this crate (the generated artifact is committed).

## Implementation Structure

- `planets.cairo`: public longitude API and planet-specific routing.
- `vsop_gen.cairo`: generated VSOP term data/evaluators (Earth + Mercury..Saturn).
- `frames.cairo`: VSOP->EQJ rotation, precession/nutation, EQJ->ecliptic-of-date conversion.
- `ascendant.cairo`: inherited runtime ascendant approximation.
- `fixed.cairo`, `time.cairo`, `trig.cairo`, `types.cairo`: shared fixed-point/runtime primitives.

## Known Limits and Practical Notes

- Planet fidelity work in `v4` currently tracks full sign-parity in published Moon validation windows.
- Sun is now routed through the VSOP + frame chain (`Earth` heliocentric -> geocentric Sun vector -> EQJ -> ecliptic-of-date).
- Moon remains harmonic-approximation based (expanded term set), not a full upstream ELP/MPP02-equivalent port.
- Moon runtime currently applies no additional global parity bias (`A=0`, `B=0`, `C=0`).
- A `delta_t` scaling bug in post-2050 branches was fixed; the prior branch blow-up is gone.
- The 1800-1860 `delta_t` polynomial branch now uses higher-precision fractional coefficients (`u^5/u^6/u^7`) to avoid quantization artifacts that previously caused a mismatch cluster in the 1830s-1850s.
- Published mismatch statistics now include a full hourly sweep over `0001-4000` (15-minute quantized).
- Ascendant path in `v4` is currently identical to `v1`/`v2`, so accuracy is unchanged (~99.99987%).
- `vsop_gen.cairo` is generated data and should not be edited manually.

## v1 vs v2 vs v3 vs v4 Comparison

All numbers below are from current workspace builds/tests.

### Runtime Gas (single-sample 7-body benchmark tests)

| Metric | v1 (`astronomy_engine_v1`) | v2 (`astronomy_engine_v2`) | v3 (`astronomy_engine_v3`) | v4 (`astronomy_engine_v4`) |
| --- | --- | --- | --- | --- |
| Benchmark test | `benchmark_lookup_all_planet_signs` | `benchmark_parametric_all_planets_cheby` | `benchmark_parametric_all_planets_cheby` | `benchmark_parametric_all_planets_cheby` |
| Gas usage est. | `44,183,350` | `2,458,170` | `152,425,080` | `192,159,100` |

Estimated STRK fee range for this benchmark (L2 gas component only, `3-10 gFri`):

| Metric | v1 | v2 | v3 | v4 |
| --- | --- | --- | --- | --- |
| STRK at `3 gFri` | `0.13255005` | `0.00737451` | `0.45727524` | `0.57647730` |
| STRK at `10 gFri` | `0.44183350` | `0.02458170` | `1.52425080` | `1.92159100` |

Interpretation:

- `v2` optimizes gas aggressively via runtime Chebyshev lookup/eval.
- `v3`/`v4` are much heavier due to deeper runtime astronomy math, with `v4` currently above `v3`.
- `v4` vs `v3` delta (current benchmarks): `+39,734,020` gas (~`+26.07%`).

### Size Footprint

| Metric | v1 | v2 | v3 | v4 |
| --- | --- | --- | --- | --- |
| Core generated data source | `oracle_signs.cairo` = `808,011` bytes | `cheby_data.cairo` = `2,251,214` bytes | `vsop_gen.cairo` = `31,376` bytes | `vsop_gen.cairo` = `31,376` bytes |
| Sierra artifact | `59,589,267` bytes | `72,129,199` bytes | `18,233,716` bytes | `18,233,717` bytes |

Interpretation:

- `v3`/`v4` shift complexity from large static data blobs into runtime computation.
- This dramatically shrinks data/code artifact size versus `v1`/`v2`, but increases execution cost.
- `v4` vs `v3` delta (current build): `+1` byte Sierra (effectively identical artifact footprint).

### Planet-Sign Parity Snapshot

Published parity benchmarks in this repository use the `1900-2100` validation window (hourly, 15-minute quantized).

| Metric | v1 | v2 | v3 | v4 |
| --- | --- | --- | --- | --- |
| Planet signs (Sun..Saturn) | `0` mismatches (table-ingress parity by construction) | `0` mismatches | Not targeted end-to-end (Sun/Moon pre-upgrade) | Moon: `100%` (`1,753,177 / 1,753,177`), Mercury..Saturn: `0` mismatches |

Moon current snapshot (same sweep profile, JS mirror of the v4 runtime path):

- `1900-2100` (hourly, 15-minute quantized): `100%` (`1,753,177 / 1,753,177`, `0` mismatches)
- Edge sampled windows (`6h` step): `0001-0200` -> `0 / 292,192` mismatches, `3800-4000` -> `0 / 293,656` mismatches
- Full wide sweep (`0001-4000`, hourly, 15-minute quantized): `35,063,279 / 35,063,280` correct (`99.999997148014%`, `1` mismatch)

Notes:

- Recent precision uplift: internal Moon-century scaling changed from `1e9` to `1e12`, removing the dominant quantization source in cusp-edge cases for published windows.
- The remaining single mismatch is a cusp-edge fixed-point event (`3158-05-24T12:00:00Z`) with about `9.09e-7°` longitude delta; semantic mirror matches upstream at that point.
- Large absolute `delta_t` values in far epochs are expected in this model family; they are not treated as instability by default parity sweeps.
- A focused post-2050 stability check (`2049-2051`) is currently `0/17,521` mismatches.
- Semantic mirror checks against upstream are `0` mismatches in the same sweeps; residual differences are from fixed-point approximation drift.

## Validation Workflow

From repo root:

```bash
# Run v4 tests.
scarb test -p astronomy_engine_v4 --manifest-path cairo/Scarb.toml

# Build artifact for size inspection.
scarb build -p astronomy_engine_v4 --manifest-path cairo/Scarb.toml
```

## Future Directions

The runtime is now validated with full hourly sweeps across `0001-4000` (15-minute quantized). Remaining work is about removing the last cusp-edge fixed-point miss and/or extending validation density (e.g., 15-minute sweeps across wider windows).

### Sun upgrade (completed)

Earth VSOP data already exists in `vsop_gen.cairo` and the frame chain is in `frames.cairo`.
The geocentric Sun is simply the negated heliocentric Earth vector, run through the existing EQJ→precession→nutation→ecliptic-of-date chain.
Completed in `v4` via a VSOP-Earth-derived geocentric Sun vector path.

### Moon upgrade (implemented, further extension optional)

The Moon orbits Earth, not the Sun, so VSOP does not apply.
The upstream `astronomy-engine` uses a truncated ELP/MPP02 lunar model — hundreds of trigonometric terms of the form `A * sin(D*d + M*m + M'*m' + F*f)` where `d, m, m', f` are fundamental lunar/solar arguments.

Current status:

- Expanded Moon term-chain + nutation correction are implemented.
- Post-2050 `delta_t` branch stability issue is fixed.
- Internal Moon `t` precision was increased (`1e12` century scale) to remove fixed-point cusp-edge drift in validated windows.
- Global Moon bias remains disabled (`A=0`, `B=0`, `C=0`).

### Ascendant upgrade (partial)

`v4` now reuses shared frame-side sidereal/obliquity inputs (`frames.cairo`), but the ascendant projection itself is still the compact approximation branch. A full upstream-equivalent horizon transform path remains optional future work.

## Scope Boundary

`astronomy_engine_v4` is an experimental higher-fidelity Cairo port path focused on planetary sign accuracy mechanics for all seven classical bodies at chart-sign resolution. It is not yet a complete full-surface replacement for upstream `astronomy-engine`.
