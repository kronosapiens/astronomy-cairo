# astronomy_engine (Cairo)

`astronomy_engine_v1` is a Cairo-native astronomy engine, offering fully-onchain conversions of lat/lon/time inputs to sign-level outputs.

This crate is a partial adaptation of the JavaScript [`astronomy-engine`](https://github.com/cosinekitty/astronomy) model into Cairo, not a one-to-one port.

## Purpose

- Provide deterministic, reproducible astronomy primitives in Cairo.
- Support the seven classical chart bodies:
  - Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn
- Support ascendant computation for sign-level chart derivation.
- Keep runtime arithmetic efficient for Cairo VM / Starknet constraints.

## Upstream Reference and Attribution

Primary reference implementation:

- `astronomy-engine` JavaScript package (`^2.1.19`)
- Author: Donald Cross
- Repo: <https://github.com/cosinekitty/astronomy>
- License: MIT

This crate should be cited as:

1. Cairo adaptation in this repository (`cairo/crates/astronomy_engine_v1`).
2. Upstream reference implementation: Donald Cross, `astronomy-engine`.

If publishing benchmarks, parity numbers, or derived tables, include both references.

## Adaptation Process

This port was done as a constrained adaptation enabling deterministic onchain astrology-specific outputs, not as a full astronomical simulator.

### Engineering Decisions

#### Numeric model

- Runtime scalar: `i64`, fixed-point `1e9` scale.
- Intermediates: `i128` for multiply/accumulate safety.
- Rounding rule: half-away-from-zero in shared helpers.

Why:

- Cairo does not have native `i256`; wide integer emulation is expensive.
- `i64` state + `i128` intermediates is the best cost/precision tradeoff for this use case.

#### Time/location contract

- Time input: `minute_since_1900` (`1900-01-01T00:00:00Z` epoch).
- Range target for current data assets: 1900-2100.
- Location input bins: `0.1°` (`lat_bin`, `lon_bin`).

#### Planet strategy

- Runtime planet signs are table-backed from oracle ingress data.
- `oracle_signs.cairo` is generated from the JS oracle path and used for deterministic sign parity.
- Large tables (notably Moon) are segmented to stay within Cairo practical limits.

#### Ascendant strategy

- Computed at runtime via fixed-point trig/sidereal approximation path.
- Includes higher-order sidereal terms and compact nutation/equation-of-equinoxes correction.
- Designed for sign-level accuracy under agreed quantization constraints.

### Ported / Preserved

1. Core coordinate intent for chart use:
- Ecliptic longitudes for the seven classical bodies.
- Ascendant derivation using sidereal-time-based horizon/ecliptic relationship.

2. Deterministic oracle parity workflow:
- A JS oracle harness (using upstream `astronomy-engine`) was used to generate/sign-check corpora.
- Cairo behavior was continuously tested against this oracle during implementation.

3. Time and angle normalization semantics:
- Stable epoch mapping and wrap rules were retained in deterministic fixed-point form.

### Adapted (Equivalent Outcome, Different Mechanics)

1. Planet signs:
- Instead of recomputing full high-fidelity planetary pipelines onchain, sign ingress tables were generated offchain from oracle outputs and embedded as Cairo constants.
- Runtime uses table lookup for sign parity.

2. Trigonometry:
- Replaced floating-point trig with fixed-point lookup/interpolation (`sin`, `atan`) compatible with Cairo integer arithmetic.

3. Sidereal/obliquity path:
- Implemented compact polynomial/correction forms that preserve sign-level behavior with very low mismatch, rather than full upstream transform stack.

### Major Departure from Upstream: Parametric vs Table-Driven Runtime

Upstream `astronomy-engine` is primarily a compact parametric model:

- Store coefficient/model data.
- Evaluate equations at runtime to compute positions.

This Cairo port intentionally makes a different tradeoff for planet signs:

- Generate sign-ingress events from the upstream oracle offchain.
- Embed those events as Cairo constants.
- Perform deterministic runtime lookup onchain.

Why this departure was chosen:

1. Deterministic sign parity:
- For a sign-level astrology engine, table lookup is the most direct way to preserve oracle sign behavior.

2. Cairo execution economics:
- Full parametric evaluation requires more heavy arithmetic and precision management in Cairo.

3. Implementation risk reduction:
- Large astronomical transform/series ports are harder to validate and maintain.
- Table-backed sign lookup sharply reduces cusp-drift debugging surface for planets.

Tradeoff acknowledged:

- This increases source/data size versus a compact parametric runtime.
- It is a deliberate trade of size for deterministic behavior and lower onchain compute complexity.

### Dropped / Deferred

1. Full strict transform-chain parity:
- No full precession/nutation matrix chain parity for all coordinate transforms.
- No full general-purpose `ECT -> EQD -> HOR` vector pipeline equivalent onchain.

2. Full physical model surface:
- Not targeting all bodies/features from upstream.
- Not porting complete periodic-term models for general astronomical querying.

3. Unlimited epoch support:
- v1 data/runtime assumptions are tuned for 1900-2100 chart use.

### Why These Choices Were Made

1. Cairo arithmetic economics:
- Large-width arithmetic and high-precision floating-style pipelines are expensive in Cairo.
- `i64` fixed-point with `i128` intermediates gives strong determinism and manageable cost.

2. Product requirements:
- The chart engine consumes 15-minute time buckets and `0.1°` location bins.
- Sign-level deterministic correctness was the target, not sub-arcminute astronomy outputs.

3. Risk and maintainability:
- Table-backed planet signs reduce runtime complexity and eliminate major parity drift risk.
- A compact ascendant model keeps execution feasible while preserving practical chart correctness.

4. Explicit tradeoff:
- Remaining tiny ascendant cusp-edge mismatches were accepted versus doubling complexity with a full upstream-equivalent transform stack.

## Implementation Structure

- `fixed.cairo`: fixed-point helpers (`norm360`, deterministic rounding).
- `time.cairo`: minute-since-1900 to days-since-J2000 transforms.
- `trig.cairo`: deterministic `sin/cos/atan2` over fixed-point degrees.
- `trig_table.cairo`: sine lookup table used by `trig.cairo`.
- `atan_table.cairo`: arctangent ratio lookup table.
- `ascendant.cairo`: runtime ascendant longitude approximation.
- `planets.cairo`: approximation code retained for experimentation/reference.
- `oracle_signs.cairo`: generated ingress sign tables + runtime lookup.
- `types.cairo`: planet index constants.

## Known Limits and Practical Notes

- Planet sign path is strict-parity by construction against generated ingress data.
  - Measured in benchmark sweeps: 0 mismatches (100% accuracy for sampled range/window).
- Estimated STRK fee for the v1 7-body benchmark (`benchmark_lookup_all_planet_signs`, gas `44,183,350`), L2 gas component only:
  - At `3 gFri`: `0.13255005 STRK`
  - At `10 gFri`: `0.44183350 STRK`
- Ascendant is very high accuracy (99.999872%) but still approximation-based.
  - Measured benchmark A (`37.7`, `-122.4`, San Francisco Bay Area): 2 mismatches
  - Measured benchmark B (`40.7`, `-74.0`, New York City area): 5 mismatches
  - Measured benchmark C (`-33.9`, `151.2`, Sydney area): 2 mismatches
  - Measured benchmark D (`89.0`, `0.0`, North Pole along the Greenwich meridian): 0 mismatches
  - Those residual errors are cusp-adjacent boundary flips; eliminating them likely requires a full upstream-equivalent transform-chain port.
- Benchmark context for the figures above:
  - Time range: `1900-01-01` to `2100-01-01`
  - Step: hourly, quantized to 15-minute slots (`1,753,177` steps)
  - Locations tested: `37.7,-122.4`, `40.7,-74.0`, `-33.9,151.2`, `89.0,0.0`
- `oracle_signs.cairo` is generated data; avoid manual edits.
- `oracle_signs.cairo.partial` is an intermediate artifact and not runtime-critical.

## Regeneration and Validation Workflow

From repo root:

```bash
# Regenerate ingress tables
node astro/src/cli/export-ingress-cairo.js cairo/crates/astronomy_engine_v1/src/oracle_signs.cairo

# Cairo tests
scarb test -p astronomy_engine_v1 -p star_chart --manifest-path cairo/Scarb.toml

# Runtime parity sweep (JS oracle vs Cairo runtime model)
npm -C astro run compare:cairo-runtime -- \
  --start 1900-01-01T00:00:00Z \
  --end 2100-01-01T00:00:00Z \
  --step-minutes 60 \
  --quantize-minutes 15 \
  --lat-bin 377 \
  --lon-bin -1224
```

## Scope Boundary

This crate currently targets sign-level chart correctness and deterministic onchain execution, not full astronomical-feature parity for all coordinate systems and physical effects.
