# engine_v5 (Cairo)

Deterministic onchain ephemeris for the seven classical planets.
Computes ecliptic longitudes for Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn, and the ascendant — accurate to ~1.4 arcseconds against the upstream oracle across 4,000 years.
Sufficient for fully onchain natal chart computation, with precision supporting degree-level work (aspects, transits, progressions).

- **Input:** timestamp (minutes since proleptic Gregorian epoch) + observer location (0.01° lat/lon bins)
- **Output:** ecliptic longitudes (`i64` scaled by `1e9`) or zodiac sign indices (0–11)
- **Range:** years 0001 AD – 4000 AD
- **Precision:** < 0.0004° (within professional ephemeris thresholds of 0.01°)
- **Gas cost:** ~184M (7-body + ascendant)
- **Source size:** ~396 KB

Ported from Don Cross's [astronomy](https://github.com/cosinekitty/astronomy) (JS/TypeScript, MIT), adapted for Cairo's deterministic fixed-point execution model.

## Usage

All timestamps are minutes since the proleptic Gregorian epoch (0001 AD).
All longitudes are returned as `i64` scaled by `1e9` (i.e. degrees × 10⁹).

```cairo
use engine_v5::planets::{
    all_planet_longitudes_pg_1e9,
    approximate_planet_longitude_pg_1e9,
    SUN, MOON, MERCURY,
};
use engine_v5::ascendant::approximate_ascendant_longitude_pg_1e9;

// All 7 planet longitudes at once (Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn)
let longitudes: [i64; 7] = all_planet_longitudes_pg_1e9(minute_since_pg);

// Single planet longitude (planet indices: SUN=0, MOON=1, MERCURY=2, ..., SATURN=6)
let sun_lon: i64 = approximate_planet_longitude_pg_1e9(SUN, minute_since_pg);

// Ascendant (requires observer location as 0.01° bins, e.g. 4070 = 40.70°N)
let asc_lon: i64 = approximate_ascendant_longitude_pg_1e9(minute_since_pg, lat_bin, lon_bin);
```

## How It Works

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

## Architecture

| Module | Description |
| --- | --- |
| `planets.cairo` | Planet routing and longitude computation (VSOP87, Moon harmonics, light-time iteration) |
| `frames.cairo` | Coordinate transforms (VSOP ecliptic → J2000 EQJ → ecliptic of date, precession, nutation) |
| `ascendant.cairo` | Horizon intersection solve for ascendant longitude |
| `trig.cairo` | Lookup-table sin/cos/atan2 with linear interpolation |
| `fixed.cairo` | Fixed-point arithmetic, time conversion, rounding |
| `gen_vsop.cairo`, `gen_moon.cairo`, `gen_sin.cairo`, `gen_atan.cairo` | Generated data (do not edit) |

## What v5 Changed from v4

v5 starts from v4's complete 7-body pipeline and focuses on correctness refinements:

- **Ascendant solve** upgraded to robust horizon-intersection form (avoids explicit `tan(lat)` division instability near poles).
- **Frame-time semantics** corrected in the EQJ → ecliptic-of-date projection stage.
This was the primary breakthrough — an A/B test on `ECLIPTIC_FRAME_TIME_SIGN` identified that the frame-time convention was the dominant source of remaining parity gaps.
- **Explicit ecliptic aberration term** tested and rejected — no measurable benefit.
- **Stage-level debug probes** added for EQJ vectors and frame projections, enabling isolation of error sources to the frame-projection stage rather than the EQJ solve.

## Research History

### The Frame-Time Discovery (2026-03-07)

v4 had achieved ~99.95% sign parity but persistent mismatches remained, concentrated in outer planets (Saturn, Jupiter) in the year 3000+ range.
The mismatches showed a consistent pattern: all were one-sign lags (`delta=-1`) with a uniform longitude drift of ~0.139°.

Stage-level probes isolated the error to the frame-projection stage:
- EQJ vectors matched upstream to ~0.000055° (negligible).
- Frame projection contributed ~0.139° of the total ~0.139° error.
- Projecting Cairo EQJ vectors through the upstream frame function confirmed the bias originated in Cairo's `eqj_to_ecliptic_of_date` path.

An A/B test on the frame-time sign convention (`+tt` vs `-tt`) identified the correct branch.
With the corrected convention, the 68-point regression corpus went from 68/68 failures to 68/68 pass.
The full heavy baseline (96,000 structured points, years 0001-4000) then achieved 100% parity.
Random evals surface 1 irreducible cusp-boundary case per ~96,000 points (Sun within 0.00003° of a sign boundary).

### Methodology

The diagnostic approach that drove the final win:
1. Rich mismatch logging with per-point expected/actual signs, longitudes, and cusp distances.
2. Stage-level debug probes (EQJ vector + frame projection) to localize drift.
3. Source-isolation split: projecting Cairo EQJ through upstream frame (and vice versa) to attribute error to the correct stage.
4. Deterministic A/B testing on parity toggles against a fixed regression corpus.

The key insight was that **pipeline-semantics parity** (especially frame-time usage) mattered far more than arithmetic precision or constant tuning.
Multiple spot-correction attempts (symmetric rounding, VSOP clamps, higher-precision lanes, trig interpolation changes) produced zero measurable improvement — the frame convention was the only thing that mattered.

### Removed Tools

The following diagnostic tools were built during v5 research and later removed:
- `probe-v5-planet-frame.js` — CLI tool for inspecting per-planet EQJ vectors and frame projections at specific timestamps.
Used to produce the stage-level diagnostic data that localized the frame-time bug.
- `analyze-mismatch-log.js` — parsed mismatch logs to compute cusp-side offsets, sign-delta histograms, and per-planet longitude drift statistics.
Produced the `delta=-1` uniform lag finding.
- `build-mismatch-corpus.js` / `eval-mismatch-corpus.js` — built and ran regression gate corpora from mismatch points.
Superseded by the random eval with fixed seeds.
- `compare-v5-chart-parity.js` — early parity comparison script, superseded by the eval harness.

## Known Limits

- **Scope:** ecliptic longitude only — no latitude, declination, distance, or outer/minor bodies.
- **Precision target:** sub-arcsecond longitude, not full floating-point vector equivalence at every intermediate stage.
- Eval grids are finite — untested coordinates/timestamps can still surface edge behavior.
- **Trig tables:** v5 uses 7,201 sin entries (0.05° step) and 10,001 atan entries (Δz=0.0001).
These are substantially over-provisioned for sign-level accuracy.
v6 demonstrates that ~4,100 total entries suffice — see the v6 README for the optimization analysis.

## Upstream Reference

Primary reference: Don Cross, [`astronomy`](https://github.com/cosinekitty/astronomy) (MIT, `^2.1.19`).
Cairo adaptation lives in this crate; all astronomy math derives from the upstream model.
