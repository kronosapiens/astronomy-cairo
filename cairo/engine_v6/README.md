# engine_v6 (Cairo)

Active engine, deployed via `astronomy_engine/`.
Identical to v5 except for optimized trig lookup tables and contract reorganization.

## Modules

| Module | Description |
| --- | --- |
| `planets.cairo` | Planet routing and longitude computation (VSOP87, Moon harmonics, light-time iteration) |
| `frames.cairo` | Coordinate transforms (VSOP ecliptic → J2000 EQJ → ecliptic of date, precession, nutation) |
| `ascendant.cairo` | Horizon intersection solve for ascendant longitude |
| `trig.cairo` | Lookup-table sin/cos/atan2 with linear interpolation |
| `fixed.cairo` | Fixed-point arithmetic, time conversion, rounding |
| `gen/` | Generated data: `sin.cairo`, `atan.cairo`, `vsop.cairo`, `moon.cairo` |

## Trig Table Optimization

Starknet limits contract classes to 4,089,446 bytes.
v5 compiled to 4,200,938 bytes — 111 KB over the limit.

The cause: Sierra IR encodes every literal integer as a distinct `Const<i64, N>` type declaration.
v5's 17,202 trig table entries consumed 4.4 MB of type declarations.

A systematic sweep found the minimum table sizes for sign-level parity:

### Sin table sweep (atan fixed at 5,001)

| Entries | Step | Quick (200 pts) | At scale (8,000 pts) |
| --- | --- | --- | --- |
| 91 | 4° | 198/200 fail | — |
| 181 | 2° | pass | not tested |
| 361 | 1° | pass | 5 failures |
| 721 | 0.5° | pass | 3 failures |
| 1,801 | 0.2° | pass | 1 failure |
| 3,601 | 0.1° | pass | 0 failures |

### Atan table sweep (sin fixed at 361)

| Entries | dz | Quick (200 pts) | At scale (4,000 pts) |
| --- | --- | --- | --- |
| 11 | 0.1 | pass | not tested |
| 51 | 0.02 | pass | 1 failure |
| 501 | 0.002 | pass | 0 failures |

### Final configuration

| | v5 | v6 | Reduction |
| --- | --- | --- | --- |
| Sin entries | 7,201 | 3,601 (0.1° step) | 50% |
| Atan entries | 10,001 | 501 (Δz=0.002) | 95% |
| Total entries | 17,202 | 4,102 | 76% |
| Contract class size | 4.20 MB | 2.07 MB | 2 MB headroom |

## Algorithmic Parity

v6 has full algorithmic parity with the upstream JS oracle:
- VSOP terms: 360/360 (identical truncation from full VSOP87)
- IAU2000B nutation: 5/5 terms (identical to upstream)
- Light-time semantics: both backdate Earth and target planet

Max error vs the JS oracle (10K random points, seed 42): < 0.001° (3.3 arcseconds).
This is the inherent precision limit of `i64` fixed-point vs `float64`.
There are no model-level improvements available without changing the upstream oracle.

## Fixed-Point Adaptation

The upstream algorithms assume IEEE 754 `float64` — hardware trig, automatic exponent scaling, and 53 bits of mantissa.
Porting to `i64` fixed-point (×1e9) required solving several problems:

- **Overflow in multiplication chains.**
Multiplying two 1e9-scaled values produces a 1e18-scaled intermediate, which overflows `i64`.
All multiplications widen to `i128`, rescale, then narrow back.
Polynomial evaluations (VSOP87 has 20+ terms) chain many such steps.

- **Truncation accumulation.**
Every fixed-point division or rescale truncates.
A consistent half-away-from-zero rounding policy (`div_round_half_away_from_zero`) keeps error symmetric and bounded across long computation chains.

- **Trig without hardware.**
`float64` has native sin/cos/atan.
Here, trig is a lookup table with linear interpolation — 3,601 sin entries (0.1° step) and 501 atan entries (Δz=0.002).
Table size directly trades off against contract class size on Starknet.

- **Small-over-large division.**
When a small intermediate is divided by a large one, fixed-point loses most significant digits.
`float64` handles this automatically because the mantissa shifts to preserve significance.
The computation order in several places was rearranged to keep numerators large relative to denominators.

## Computational Cost

A single `compute_signs` call (7 planets + ascendant) executes ~220,000–250,000 arithmetic operations (add, multiply, divide, sqrt, trig table lookup + interpolation).

| Component | ~Ops | Notes |
| --- | --- | --- |
| 5 outer planets | 218,000 | Light-time iteration dominates (~5 iterations each, dual VSOP eval + distance + sqrt per iteration) |
| Moon | 2,900 | 104-term harmonic series + 11 periodic corrections |
| Sun | 900 | Single VSOP eval, no light-time loop |
| Coordinate transforms | 2,000 | Precession + nutation + rotation, 7 planets |
| Ascendant | 300 | Sidereal time + horizon solve |

snforge reports ~153M L2 gas for pure `compute_signs` execution.
A real mainnet transaction (cross-contract call + storage writes) measured [~388M L2 gas](https://voyager.online/tx/0x00fb1438af550895d3bcde04216b466668dd3d2fa856a19a0126b496236cc5d1) — the ~2.5x overhead covers account validation, dispatch, and 8 storage slot writes.

## Known Limits

- Ecliptic longitude only — no latitude, declination, distance, or outer/minor bodies.
- Precision target: sub-arcsecond longitude, not full floating-point vector equivalence at every intermediate stage.
- Eval grids are finite — untested coordinates/timestamps can still surface edge behavior.

## Upstream Reference

Don Cross, [`astronomy`](https://github.com/cosinekitty/astronomy) (MIT, `^2.1.19`).
