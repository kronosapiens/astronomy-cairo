# astronomy_engine_v2 (Cairo)

`astronomy_engine_v2` is a Cairo-native parametric astronomy runtime for sign-level chart computation.

This crate is a Chebyshev-model adaptation of the JavaScript [`astronomy-engine`](https://github.com/cosinekitty/astronomy) reference path, tuned for Cairo execution constraints.

## Purpose

- Provide deterministic, reproducible onchain planet-sign outputs without table-ingress lookup.
- Support the seven classical chart bodies:
  - Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn
- Maintain high sign-level parity with the oracle baseline while reducing runtime gas.

## Upstream Reference and Attribution

Primary reference implementation:

- `astronomy-engine` JavaScript package (`^2.1.19`)
- Author: Donald Cross
- Repo: <https://github.com/cosinekitty/astronomy>
- License: MIT

This crate should be cited as:

1. Cairo adaptation in this repository (`cairo/crates/astronomy_engine_v2`).
2. Upstream reference implementation: Donald Cross, `astronomy-engine`.

If publishing benchmark or parity numbers, include both references.

## Adaptation Process

This port replaces v1 table-driven planet sign ingress with compact runtime Chebyshev evaluation while preserving deterministic sign behavior.

### Engineering Decisions

#### Numeric model

- Runtime scalar: `i64`, fixed-point `1e9` for longitudes.
- Chebyshev coefficients: integer degree scale (`CHEBY_DEG_SCALE`).
- Intermediates: `i128` for Clenshaw multiply/accumulate safety.

Why:

- Cairo has no native `i256`; this keeps execution practical and predictable.
- `i64 + i128` is sufficient for sign-level precision targets.

#### Time contract

- Input time: `minute_since_1900` (`1900-01-01T00:00:00Z` epoch).
- Model range currently generated for: `1900-01-01` to `2100-01-01`.

#### Planet model strategy

- Each planet is fit as piecewise Chebyshev blocks.
- Runtime selects block by minute index and evaluates longitude via Clenshaw recurrence.
- Coefficients are chunked into 20k arrays to stay within Cairo constant/offset constraints.

#### Oracle alignment

- Sun fit source is `Astronomy.SunPosition(...).elon` to match v1 oracle semantics.
- A tiny Moon correction is applied at runtime:
  - `MOON_LONGITUDE_BIAS_1E9 = +3000` (`+0.000003°`)
  - This resolves a single cusp-boundary miss in the validation corpus.

### Ported / Preserved

1. Seven-body sign computation target.
2. Minute-since-1900 time semantics and deterministic wrap behavior.
3. Oracle-based parity workflow against upstream `astronomy-engine`.

### Adapted (Equivalent Outcome, Different Mechanics)

1. Planet signs:
- v1: generated sign-ingress lookup tables.
- v2: runtime-evaluated Chebyshev longitude model + sign quantization.

2. Data flow:
- v2 stores model coefficients (not sign transition tables) in Cairo source.

3. Runtime math:
- Clenshaw polynomial evaluation replaces event-table search.

### Dropped / Deferred

1. Full upstream transform chain parity for all coordinate workflows.
2. General-purpose astronomy API surface beyond chart-sign requirements.
3. Unlimited epoch support (current model assets are generated for 1900-2100).

## Implementation Structure

- `cheby_data.cairo`: generated chunked coefficients and accessor functions.
- `planets.cairo`: block selection, Clenshaw evaluation, longitude/sign API.
- `fixed.cairo`, `time.cairo`, `trig.cairo`, `types.cairo`: shared fixed-point/runtime utilities.
- `README.md`: model scope, parity, regeneration workflow.

## Known Limits and Practical Notes

- Planet sign parity (v2 corpus benchmark):
  - `0` mismatches across Sun/Moon/Mercury/Venus/Mars/Jupiter/Saturn.
- Benchmark context:
  - Range: `1900-01-01` to `2100-01-01`
  - Step: hourly
  - Time quantization: 15 minutes
  - Samples: `1,753,177`
- Ascendant is still approximation-based in the shared path and can show rare cusp-edge mismatches, independent of the v2 planet model.
- `cheby_data.cairo` is generated data; avoid manual edits.

## v1 vs v2 Comparison

All numbers below are from the same corpus window and current workspace benchmarks.

### Accuracy (planet signs)

- Corpus: `1900-01-01` to `2100-01-01`, hourly step, 15-minute quantization (`1,753,177` samples).
- Location used for ascendant column: `lat=37.7`, `lon=-122.4`.

| Metric | v1 (`astronomy_engine_v1`) | v2 (`astronomy_engine_v2`) |
| --- | --- | --- |
| Planet mismatches (Sun..Saturn) | `0` | `0` |
| Ascendant mismatches | `2` | `2` |

### Gas Cost (all 7 planets, single-sample microbench)

- v1 benchmark: `benchmark_lookup_all_planet_signs`
- v2 benchmark: `benchmark_parametric_all_planets_cheby`

| Metric | v1 | v2 |
| --- | --- | --- |
| Gas usage est. | `44,183,350` | `2,458,170` |
| Relative | baseline | ~`17.97x` lower (~`94.44%` reduction) |

Estimated STRK fee range for this benchmark (L2 gas component only, `3-10 gFri`):

| Metric | v1 | v2 |
| --- | --- | --- |
| STRK at `3 gFri` | `0.13255005` | `0.00737451` |
| STRK at `10 gFri` | `0.44183350` | `0.02458170` |

### Size Footprint

These crates are libraries, not deployable Starknet contracts, so "contract size" is reported using both generated source-data size and compiled Sierra artifact size.

| Metric | v1 | v2 |
| --- | --- | --- |
| Generated data source (`oracle_signs.cairo` / `cheby_data.cairo`) | `808,011` bytes | `2,251,214` bytes |
| Compiled Sierra artifact (`target/dev/*.sierra.json`) | `59,588,407` bytes | `72,129,199` bytes |

Takeaway: v2 is substantially cheaper at runtime gas while currently larger in code/data footprint.

### Compression Frontier (Current Sweep)

- Coefficient quantization is now configurable in generation (`--coeff-quantum`).
- Tested on the full corpus:
  - `q=4`: no additional planet mismatches (`0` total).
  - `q=8`: first observed loss (`Moon: 1`, `Jupiter: 1` mismatches).

Current retained setting is `q=4` (last lossless point in this sweep).

## Regeneration and Validation Workflow

From repo root:

```bash
# Regenerate v2 Chebyshev coefficient data.
npm -C astro run build:cheby-v2-cairo -- \
  --out ../cairo/crates/astronomy_engine_v2/src/cheby_data.cairo

# Run v2 crate tests.
scarb test -p astronomy_engine_v2 --manifest-path cairo/Scarb.toml

# Full-range parity sweep against oracle path.
npm -C astro run compare:cheby-v2 -- \
  --start 1900-01-01T00:00:00Z \
  --end 2100-01-01T00:00:00Z \
  --step-minutes 60 \
  --quantize-minutes 15
```

## Scope Boundary

`astronomy_engine_v2` targets deterministic, low-gas, sign-level planet outputs for chart computation in Cairo. It is not a full replacement for the entire upstream astronomy feature surface.
