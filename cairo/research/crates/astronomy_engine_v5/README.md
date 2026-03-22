# astronomy_engine_v5 (Cairo)

Deterministic onchain ephemeris for the seven classical planets.
Computes ecliptic longitudes for Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn, and the ascendant — accurate to ~1.4 arcseconds against the upstream oracle across 4,000 years.
Sufficient for fully onchain natal chart computation, with precision supporting degree-level work (aspects, transits, progressions).

- **Input:** timestamp (minutes since proleptic Gregorian epoch) + observer location (0.01° lat/lon bins)
- **Output:** ecliptic longitudes (`i64` scaled by `1e9`) or zodiac sign indices (0–11)
- **Range:** years 0001 AD – 4000 AD
- **Precision:** < 0.0004° (within professional ephemeris thresholds of 0.01°)
- **Gas cost:** ~184M (7-body + ascendant)
- **Source size:** ~396 KB

Ported from Don Cross's [astronomy-engine](https://github.com/cosinekitty/astronomy) (JS/TypeScript, MIT), adapted for Cairo's deterministic fixed-point execution model.

## Usage

All timestamps are minutes since the proleptic Gregorian epoch (0001 AD)
All longitudes are returned as `i64` scaled by `1e9` (i.e. degrees × 10⁹).

```cairo
use astronomy_engine_v5::planets::{
    all_planet_longitudes_pg_1e9,
    approximate_planet_longitude_pg_1e9,
    SUN, MOON, MERCURY,
};
use astronomy_engine_v5::ascendant::approximate_ascendant_longitude_pg_1e9;

// All 7 planet longitudes at once (Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn)
let longitudes: [i64; 7] = all_planet_longitudes_pg_1e9(minute_since_pg);

// Single planet longitude (planet indices: SUN=0, MOON=1, MERCURY=2, ..., SATURN=6)
let sun_lon: i64 = approximate_planet_longitude_pg_1e9(SUN, minute_since_pg);

// Ascendant (requires observer location as 0.01° bins, e.g. 4070 = 40.70°N)
let asc_lon: i64 = approximate_ascendant_longitude_pg_1e9(minute_since_pg, lat_bin, lon_bin);
```

## How It Works

Think of v5 like a very precise sky calculator that runs fully onchain.

1. **Time conversion.**
It takes a timestamp (and for ascendant, a location).
Time is converted into astronomy-friendly day counts relative to J2000.

2. **Planet positions.**
For Mercury through Saturn, v5 evaluates VSOP formulas to get heliocentric positions, then subtracts Earth's position to get geocentric vectors.

3. **Light-time correction.**
A fixed-iteration solve adjusts for the fact that light from planets takes time to reach Earth.

4. **Frame rotation.**
Precession + nutation transforms are applied, then vectors are projected into ecliptic longitude/latitude of the date.

5. **Ascendant.**
Using local sidereal time + observer latitude/longitude, v5 solves where the eastern horizon intersects the ecliptic.

6. **Fixed-point math throughout.**
No floating-point randomness; same inputs always produce the same onchain outputs.

The engine outputs ecliptic longitudes directly.
Sign indices (0–11) are also available as a convenience mapping.

## Evaluation Results

### Sign accuracy (whole-house)

| Dataset | Points | Failures |
| --- | --- | --- |
| Random (seed 42, 0.1° locations) | 96,000 | 0 |
| Random (seed 99, 0.01° locations) | 96,000 | 1 |
| Structured (years 1–4000, 12 months × 2 locations) | 96,000 | 0 |

**99.997% accuracy** at 95% confidence (1 failure in 192,000 random points).
The structured dataset provides additional coverage across the full 4,000-year range.

The single failure is a cusp-boundary case: Sun at 90.000029° (year 3253), where the true longitude falls within 0.00003° of the Gemini/Cancer boundary.
At sub-arcsecond precision, sign disagreements near exact 30° boundaries are irreducible — any two ephemerides that differ by even 0.0001° will disagree on sign when the true position is that close to a boundary.

### Degree precision

| Dataset | Points | Max error | Worst body |
| --- | --- | --- | --- |
| Structured (every 100y, years 1–3901) | 960 | 0.000365° | Mercury |
| Random (seed 42) | 960 | 0.000382° | Mercury |

All errors under 0.001°.
For reference: 0.0004° ≈ 1.4 arcseconds.
Professional ephemeris threshold is ~36 arcseconds (0.01°).

Eval tooling and dataset details: see [`astro/README.md`](../../../astro/README.md).

## Architecture

| Module | Description |
| --- | --- |
| `planets.cairo` | Planet routing and longitude computation (VSOP87, Moon harmonics, light-time iteration) |
| `frames.cairo` | Coordinate transforms (VSOP ecliptic → J2000 EQJ → ecliptic of date, precession, nutation) |
| `ascendant.cairo` | Horizon intersection solve for ascendant longitude |
| `trig.cairo` | Lookup-table sin/cos/atan2 with linear interpolation |
| `fixed.cairo` | Fixed-point arithmetic, time conversion, rounding |
| `gen_vsop.cairo`, `gen_moon.cairo`, `gen_sin.cairo`, `gen_atan.cairo` | Generated data (do not edit) |

## Known Limits

- **Scope:** ecliptic longitude only — no latitude, declination, distance, or outer/minor bodies.
- **Precision target:** sub-arcsecond longitude, not full floating-point vector equivalence at every intermediate stage.
- Eval grids are finite — untested coordinates/timestamps can still surface edge behavior.

## Upstream Reference

Primary reference: Donald Cross, [`astronomy-engine`](https://github.com/cosinekitty/astronomy) (MIT, `^2.1.19`).
Cairo adaptation lives in this crate; all astronomy math derives from the upstream model.
