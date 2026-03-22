# astronomy_engine_v6 (Cairo)

Active engine, deployed via `cairo/crates/astronomy_engine/`.
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

The ~0.0004° error ceiling is the inherent precision limit of `i64` fixed-point vs `float64`.
There are no model-level improvements available without changing the upstream oracle.

## Known Limits

- Ecliptic longitude only — no latitude, declination, distance, or outer/minor bodies.
- Precision target: sub-arcsecond longitude, not full floating-point vector equivalence at every intermediate stage.
- Eval grids are finite — untested coordinates/timestamps can still surface edge behavior.

## Upstream Reference

Donald Cross, [`astronomy-engine`](https://github.com/cosinekitty/astronomy) (MIT, `^2.1.19`).
