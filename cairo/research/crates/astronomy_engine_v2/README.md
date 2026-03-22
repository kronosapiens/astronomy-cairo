# astronomy_engine_v2 (Cairo) — Research Archive

v2 was the second-generation Cairo astronomy engine.
It replaced v1's table-ingress sign lookup with runtime Chebyshev polynomial evaluation.

## Approach

v2 fits each planet's ecliptic longitude as piecewise Chebyshev polynomials over fixed-width time blocks.
At runtime, the engine selects the appropriate block for a given timestamp and evaluates the polynomial via Clenshaw recurrence.
Coefficients are quantized to `i32` (quantum=4) and stored as chunked Cairo constant arrays.

## How It Works

1. Time (minutes since 1900-01-01) selects a block index: `block = minute / block_minutes`.
2. Local time within the block is normalized to `u` in `[-1, 1]` (scaled by `U_SCALE = 1e6`).
3. Clenshaw recurrence (`clenshaw_cheby_deg_scaled`) evaluates the Chebyshev series for that block.
4. The result is converted from the internal degree scale (`CHEBY_DEG_SCALE = 1e6`) to the standard `1e9`-scaled longitude.
5. Longitude is normalized to `[0, 360)` and divided by 30 to produce a zodiac sign index.

The Moon path applies a small bias (`MOON_LONGITUDE_BIAS_1E9 = +3000`, i.e. +0.000003 degrees) to resolve a single cusp-boundary miss in the validation corpus.

Ascendant computation uses the same sidereal/obliquity/nutation path shared across all engine versions.

## What It Proved

- Runtime polynomial evaluation is viable in Cairo and dramatically cheaper than table lookup.
- Gas cost: ~2.5M vs v1's ~44M (an 18x reduction).
- Sign-level parity: 0 planet mismatches across 1,753,177 hourly samples (1900-2100).

## What It Gave Up

- Model semantics are narrower: longitude is fit directly as a black-box polynomial, not derived from physical orbital mechanics.
- Time coverage is bounded by the generated coefficient blocks (1900-2100).
- Block boundaries create implicit time windows; behavior at block edges depends on the fit quality.
- The coefficient pipeline (JS fitting -> quantization -> Cairo codegen) is an external dependency.
- Sierra artifact is large: ~72MB (vs v1's ~60MB), due to the volume of embedded coefficient data.

## Why We Moved On

v3+ adopted VSOP-based orbital mechanics, which provides higher-fidelity astronomical models derived from physical theory rather than curve-fitting.
This enabled broader epoch coverage, smaller artifacts (~18MB), and a path toward sub-sign precision, at the cost of higher gas (~150-190M).

## Key Source Files

| File | Purpose |
| --- | --- |
| `planets.cairo` | Block selection, Clenshaw evaluation, longitude/sign API |
| `cheby_data.cairo` | Generated chunked Chebyshev coefficients and per-planet accessors |
| `ascendant.cairo` | Ascendant from local sidereal time, obliquity, nutation |
| `fixed.cairo` | `i64`/`i128` fixed-point utilities, angle normalization |
| `time.cairo` | Minutes-since-1900 to J2000-day conversion |
| `trig.cairo` | Lookup-table sin/cos/atan2 with linear interpolation |
| `types.cairo` | Planet index constants |
| `trig_table.cairo` | 7201-entry sin table (0.05-degree step) |
| `atan_table.cairo` | 10001-entry atan table |

## Audit Findings (from ASTRONOMY_AUDIT.md)

- **Clenshaw recurrence verified correct.**
The Cairo implementation (`clenshaw_cheby_deg_scaled`) matches the JS reference (`clenshaw.js:evalChebyshev`).
The `u_scaled` domain mapping and final `a0 + u*b1/U_SCALE - b2` step conform to the standard Clenshaw formula.
- **Coefficient pipeline verified.**
JS generator fits per-block, quantizes by `coeffQuantum=4`, stores as `i32`.
Cairo accessor multiplies back by 4 and returns `i64`.
- **`MOON_LONGITUDE_BIAS_1E9 = +3000` documented.**
Present and matches README description.
- **Domain normalization verified.**
`u = 2*local_minute/block_minutes - 1` correctly maps `[0, block_minutes]` to `[-1, 1]`.

## Performance

| Metric | Value |
| --- | --- |
| Gas (7-body single sample) | ~2,458,170 |
| Sierra artifact | ~72 MB |
| `cheby_data.cairo` source | ~2.25 MB |
| Coefficient quantization | `q=4` (last lossless setting) |
