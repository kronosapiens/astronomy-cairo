# astronomy_engine_v4 (Cairo)

Research crate.
`v4` extended `v3` with upgraded Sun and Moon models and a proleptic Gregorian time domain.
It was the first version to compute all seven classical bodies plus ascendant from first-principles runtime math in Cairo.

## Lineage

- `v1`: table-ingress oracle signs; large artifact, bounded parity.
- `v2`: Chebyshev parametric runtime; very low gas, narrower model semantics.
- `v3`: VSOP/frame runtime for Mercury..Saturn; Sun and Moon not yet upgraded.
- `v4`: upgraded Sun/Moon paths, proleptic Gregorian epoch, full 7-body computation.
- `v5`: runtime/performance refinements and ascendant robustness atop `v4`.

## What v4 Changed From v3

### Sun model

`v3` used an earlier approximation for the Sun.
`v4` derives geocentric Sun longitude by evaluating Earth's VSOP heliocentric position and negating it.
The negated vector passes through the same frame chain as the outer planets: VSOP ecliptic to EQJ, precession, nutation, then ecliptic-of-date projection.
A two-iteration light-time correction is applied.

### Moon model

`v3` had no upgraded Moon path.
`v4` implements a Meeus-style 104-term harmonic series (`moon_terms.cairo`) with solar disturbance corrections.
Each term evaluates `A * sin(p*l + q*ls + r*f + s*d)` where `l, ls, f, d` are fundamental lunar/solar arguments derived from century time.
Eleven periodic correction terms are added after the main summation.
Nutation in longitude is applied to convert mean ecliptic longitude to true.
Internal century scaling uses `1e12` precision to reduce fixed-point drift at cusp edges.

### Time domain

`v3` used `minute_since_1900` as its sole input epoch.
`v4` added `minute_since_pg` (proleptic Gregorian, epoch `0001-01-01T00:00:00Z`) as the primary wide-range input.
The intended operating domain spans year 0001 through 4000.
Legacy `minute_since_1900` entry points are retained as wrappers.

### Delta-T

`v4` implements Espenak piecewise polynomial approximation for UT to TT conversion.
Fifteen year-range branches cover `y < -500` through `y >= 2150`.
The 1800-1860 branch uses higher-precision `1e12`-scale coefficients (`u^5`/`u^6`/`u^7`) to avoid quantization artifacts.

### Module structure

`v4` added `moon_terms.cairo` (104-term constant table) relative to `v3`.
All other modules are shared: `fixed`, `time`, `types`, `planets`, `ascendant`, `trig`, `trig_table`, `atan_table`, `vsop_gen`, `frames`.

## Performance and Size

From HISTORY.md benchmarks (single-sample 7-body):

| Metric | v3 | v4 |
| --- | --- | --- |
| Gas usage est. | `152,425,080` | `192,159,100` |
| Sierra artifact | `18,233,716` bytes | `18,233,717` bytes |
| `vsop_gen.cairo` | `31,376` bytes | `31,376` bytes |

The ~26% gas increase over `v3` comes from the Moon harmonic series and Sun VSOP evaluation.
The Sierra artifact size is effectively unchanged.

## Validation Results

Moon sign parity (JS mirror of the Cairo runtime path):

- `1900-2100` hourly (15-min quantized): `1,753,177 / 1,753,177` (`100%`).
- `0001-4000` hourly (15-min quantized): `35,063,279 / 35,063,280` (`99.999997%`, one cusp-edge mismatch at `3158-05-24T12:00:00Z`).

## Why v5 Followed

`v4` proved that full 7-body + ascendant computation from first principles is viable in Cairo.
`v5` addressed remaining issues:

- Ascendant solve upgraded to robust horizon-intersection form (avoiding `tan(lat)` division instability).
- Sun low-order fallback upgraded to higher-order analytic model.
- Residual alignment moved from static constants to smooth time-domain correction forms.
- Per-planet residual handling retuned for cusp-edge stability.

## Upstream Reference

- Donald Cross, [`astronomy-engine`](https://github.com/cosinekitty/astronomy) (MIT), package `^2.1.19`.
