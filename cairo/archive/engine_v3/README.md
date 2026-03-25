# engine_v3 (Cairo) — Research Archive

`engine_v3` introduced VSOP87 series evaluation and a full frame-conversion chain for Mercury through Saturn.
It was the first version to compute planetary longitudes from upstream-style astronomy math rather than pre-computed tables or fitted polynomials.

## Approach

v3 replaced v1's ingress tables and v2's Chebyshev fits with truncated VSOP87 term evaluation at runtime.
For Mercury, Venus, Mars, Jupiter, and Saturn, the engine evaluates VSOP spherical coordinates (L/B/R) and then applies a multi-stage frame-conversion chain to produce ecliptic-of-date longitude.

Sun and Moon were not upgraded in v3.
They still use compact parametric approximations inherited from earlier versions.

## Technical Pipeline (Mercury..Saturn)

1. **VSOP spherical evaluation** — `vsop_gen.cairo` contains generated term tables for Earth and five planets. Each body's heliocentric L (longitude), B (latitude), R (radius) are evaluated as `sum(A * cos(B + C*t))` per polynomial order in Julian millennia.
2. **Spherical to Cartesian** — `helio_xyz_1e9` converts (L, B, R) to (x, y, z) in the VSOP ecliptic frame.
3. **VSOP ecliptic to EQJ** — `vsop_ecliptic_to_eqj_1e9` applies a fixed rotation matrix to move from the VSOP ecliptic frame to the J2000 equatorial frame.
4. **Geocentric vector** — Earth's heliocentric EQJ position is subtracted from the planet's, with a 2-iteration light-time correction loop that backdates both bodies.
5. **Precession** — `precession_from2000_1e9` applies IAU 2006 precession (5th-degree polynomials in `psia`, `omegaa`, `chia`) to rotate from J2000 to the equator of date.
6. **Nutation** — `nutation_from2000_1e9` applies an IAU2000B short model (5 dominant terms: omega, 2F-2D+2omega, 2F+2omega, 2omega, l') to rotate from mean to true equator of date.
7. **EQD to ecliptic-of-date** — `eqj_to_ecliptic_of_date_longitude_1e9` projects the equatorial-of-date vector onto the ecliptic plane using true obliquity, then extracts longitude via `atan2`.

All arithmetic uses `i64` fixed-point at `1e9` scale, with `i128` intermediates for multiply/accumulate.

## What v3 Proved

- VSOP series evaluation and the full frame-conversion chain work in Cairo fixed-point arithmetic.
- The generated data file (`vsop_gen.cairo`) is only ~31 KB, compared to ~808 KB (v1 oracle tables) and ~2.2 MB (v2 Chebyshev coefficients).
- Mercury through Saturn achieved 0 sign-level mismatches against the upstream oracle in the 1900-2100 hourly sweep.

## What v3 Did Not Have

- Sun still used a simple two-term equation-of-center approximation rather than the VSOP+frame chain (even though Earth VSOP data was already present).
- Moon still used a compact 5-term trigonometric model rather than an ELP-based series.

## Performance

| Metric | v1 | v2 | v3 |
| --- | --- | --- | --- |
| Gas (7-body benchmark) | ~44M | ~2.5M | ~152M |
| Sierra artifact | ~60 MB | ~72 MB | ~18 MB |
| Core data source | 808 KB | 2.2 MB | 31 KB |

v3 shifts complexity from large static data into runtime computation.
This dramatically shrinks deployment size but increases execution cost.

## Audit Findings

From `ASTRONOMY_AUDIT.md`:

- **Light-time backdates both bodies.**
The 2-iteration light-time loop shifts both the target planet and Earth backward.
Upstream `astronomy` only backdates the target.
For sign-level accuracy this is negligible: Earth moves ~1 deg/day and maximum light-time (Saturn) is ~1.1 hours, so the Earth position error is < 0.05 deg.
This was a documented tradeoff.

- **`if false { ... }` Cairo idiom.**
`vsop_gen.cairo` uses this pattern to force the compiler to unify span types across branches.
Not a bug.

- **IAU2000B 5-term truncation verified.**
The five dominant nutation terms and their dp/de coefficients match the standard IAU2000B short model.

- **Precession polynomials match IAU 2006.**
The 5th-degree coefficients for `psia`, `omegaa`, `chia` match Capitaine et al. 2003, converted from arcseconds to degrees at 1e9 scale.

- **Ascendant division-by-zero at poles.**
`ascendant.cairo` computes `tan(lat) = sin(lat) * 1e9 / cos(lat)`, which panics when `lat_bin = +/-900` (exactly +/-90 deg).
The ascendant is geometrically undefined at the poles, so a panic is arguably correct, but it is undocumented.
This affects v1, v2, and v3 identically.

- **Shared module duplication.**
`fixed.cairo`, `time.cairo`, `trig.cairo`, `types.cairo`, `ascendant.cairo`, and the trig/atan tables are copy-pasted across all three crates.
A bug fix in any shared module must be applied in multiple places.

## Why We Moved On

v3 demonstrated the VSOP+frame approach works, but Sun and Moon were still on earlier parametric models.
v4 upgraded the Sun path (negated Earth VSOP vector through the frame chain) and introduced an ELP-based Moon model, completing the full 7-body runtime pipeline.

## Source Structure

- `planets.cairo` — public longitude API and planet routing.
- `vsop_gen.cairo` — generated VSOP term data for Earth + Mercury..Saturn.
- `frames.cairo` — VSOP-to-EQJ rotation, IAU 2006 precession, IAU2000B nutation, EQD-to-ecliptic-of-date projection.
- `ascendant.cairo` — runtime ascendant approximation (inherited from v1/v2).
- `fixed.cairo`, `time.cairo`, `trig.cairo`, `types.cairo` — shared fixed-point primitives.
- `trig_table.cairo`, `atan_table.cairo` — lookup tables for integer trig.

## Upstream Reference

Primary reference: Don Cross, [`astronomy`](https://github.com/cosinekitty/astronomy) (MIT), package `^2.1.19`.
