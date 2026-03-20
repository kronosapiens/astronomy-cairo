# astronomy_engine_v5 (Cairo)

`astronomy_engine_v5` is a Cairo-native astronomy runtime for sign-level chart computation.

`v5` continues the `v4` line: deeper upstream-style astronomy math (vs table ingress), deterministic fixed-point execution, and chart-oriented outputs for seven bodies plus ascendant.

## Status Snapshot (2026-03-08)

- Full staged heavy baseline (`0001-4000`, monthly x 2 locations): `96,000 / 96,000` (`100.000000%`, `0` mismatches).
- Mid-band heavy rollup (`1001-3000`): `48,000 / 48,000` (`100.000000%`, `0` mismatches).
- Early-band heavy rollup (`0001-1000`): `24,000 / 24,000` (`100.000000%`, `0` mismatches).
- Deterministic regression corpus gate: `68 / 68` pass (`0` mismatches).

Current branch is at full pass on the project's heavy sign-level evaluation grid.

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

## Final Research Report (2026-03-08)

### Final Evaluation Data

All values below are from staged artifacts `astro/evals/v5-heavy-baseline-*-20260307T180928Z.ndjson`
(excluding one aborted partial file `v5-heavy-baseline-1001-3000-20260307T180928Z.ndjson`).

| Window | Passed / Total | Accuracy | Failed |
| --- | --- | --- | --- |
| `0001-4000` | `96,000 / 96,000` | `100.000000%` | `0` |
| `1001-3000` | `48,000 / 48,000` | `100.000000%` | `0` |
| `0001-1000` | `24,000 / 24,000` | `100.000000%` | `0` |
| `1201-4000` | `67,200 / 67,200` | `100.000000%` | `0` |

### Technical Changes That Drove the Gain

1. Frame-time semantics aligned in the EQJ -> ecliptic-of-date projection stage.
: `ECLIPTIC_FRAME_TIME_SIGN` was introduced and A/B tested; the winning branch is `+1`, then used consistently at projection callsites.

2. Apparent-correction branch was isolated and kept off for the final path.
: `ENABLE_EXPLICIT_ECLIPTIC_ABERRATION_TERM` remains `false`; A/B checks showed no measurable benefit from forcing the explicit term in the current pipeline.

3. Stage-level observability was added to localize error source before changing math.
: Debug probes for planet EQJ vectors, frame lon/lat, and Cairo-vs-oracle frame projection reduced iteration risk and prevented blind tuning.

4. Deterministic gating and mismatch tooling were expanded.
: Rich mismatch logs (`expectedSigns`, `actualSigns`, longitudes), corpus generation/eval, and targeted window runs enabled stable regression control while refining parity behavior.

### Practical Conclusion

- v5 now demonstrates full pass on the project's heavy sign-level grid over `0001-4000`.
- The primary win came from pipeline-semantics parity (especially frame-time usage), not spot-correction tuning.

## Accuracy and Validation (Current)

### 1) Project Gate (`eval-light`)

- Profile: deterministic multi-era windows (`0001-4000`), 15-minute quantization, multi-location set.
- Result: `840 / 840` exact charts (`100.000000%`).

### 2) Full Heavy Baseline (`eval-cairo-engine`, staged)

- Profile: monthly samples x 2 locations, `batch-size=20`, staged 100-year files.
- Range `0001-4000`: `96,000 / 96,000` (`100.000000%`, `0` fails).
- Per-body fail counters (Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn, Asc): all `0`.

### 3) Regression Corpus Gate

- Corpus: `astro/evals/v5-heavy-planet-regression-corpus.ndjson`
- Result: `68 / 68` pass (`0` fails).

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

## ELI5: How v5 Works Under The Hood

Think of v5 like a very precise sky calculator that runs fully onchain.

1. It takes a timestamp (and for ascendant, a location). (~8% total complexity)
: Time is converted into astronomy-friendly day counts relative to J2000.

2. It computes where planets are in space. (~28% total complexity)
: For Mercury through Saturn, v5 evaluates VSOP formulas to get heliocentric positions, then subtracts Earth's position to get geocentric vectors.

3. It accounts for "what we see now" timing. (~16% total complexity)
: A fixed-iteration light-time solve adjusts for the fact that light from planets takes time to reach Earth.

4. It rotates coordinates into the zodiac frame of the date. (~18% total complexity)
: Precession + nutation transforms are applied, then vectors are projected into ecliptic longitude/latitude.

5. It converts longitude to zodiac signs. (~5% total complexity)
: Longitudes are normalized to `0..360` and mapped into 12 sign buckets (`30°` each).

6. It computes ascendant separately from horizon geometry. (~17% total complexity)
: Using local sidereal time + observer latitude/longitude, v5 solves where the eastern horizon intersects the ecliptic.

7. It does all of this with deterministic fixed-point math. (~8% total complexity)
: No floating-point randomness; same inputs always produce the same onchain outputs.

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

- Target remains sign-level parity, not full floating-point vector equivalence at every intermediate stage.
- Current heavy grid is finite (monthly x 2 locations), so untested coordinates/timestamps can still surface edge behavior.
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
