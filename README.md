# Cairo Astronomy Engine

Deterministic onchain ephemeris for Starknet.
Computes ecliptic longitudes for Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn, and the ascendant.

- **Range:** years 0001 AD – 4000 AD
- **Precision:** < 0.0004° (~1.4 arcseconds)
- **Sign accuracy:** >99.999% against [astronomy-engine](https://github.com/cosinekitty/astronomy)
- **Contract size:** 2.07 MB (limit: 4.09 MB)
- **Gas cost:** ~190M per full chart (7 planets + ascendant)

Ported from Don Cross's [astronomy-engine](https://github.com/cosinekitty/astronomy) (MIT) with full algorithmic parity: identical VSOP terms (360/360), identical IAU2000B nutation (5/5 terms), identical light-time semantics.
The ~0.0004° residual is the inherent precision difference between `i64` fixed-point and IEEE 754 `float64`.

## Starknet Interface

```cairo
#[starknet::interface]
trait IAstronomyEngine {
    /// Zodiac sign indices (0=Aries..11=Pisces) for 7 planets + ascendant.
    fn compute_signs(minute_pg: i64, lat_bin: i16, lon_bin: i16) -> [i64; 8];

    /// Ecliptic longitudes (degrees × 1e9) for 7 planets + ascendant.
    fn compute_longitudes(minute_pg: i64, lat_bin: i16, lon_bin: i16) -> [i64; 8];

    /// Ecliptic longitudes (degrees × 1e9) for 7 planets without ascendant.
    fn compute_planet_longitudes(minute_pg: i64) -> [i64; 7];

    /// Single planet longitude (degrees × 1e9). Planet: 0=Sun..6=Saturn.
    fn compute_planet_longitude(planet: u8, minute_pg: i64) -> i64;

    /// Ascendant longitude (degrees × 1e9).
    fn compute_ascendant_longitude(minute_pg: i64, lat_bin: i16, lon_bin: i16) -> i64;

    /// Supported input range (min_minute_pg, max_minute_pg).
    fn supported_minute_range() -> (i64, i64);
}
```

**Inputs:**
- `minute_pg` — minutes since 0001-01-01T00:00:00Z (proleptic Gregorian).
- `lat_bin`, `lon_bin` — observer coordinates in 0.01° bins (e.g. `4070` = 40.70°N, `-7400` = 74.00°W).

**Outputs:**
- Longitudes are `i64` scaled by 1e9 (e.g. `90_000_000_000` = 90.0°).
- Sign indices are 0–11 (Aries=0, Taurus=1, ..., Pisces=11).

## How It Works

1. **Time conversion.** Timestamp → J2000 day count, UT→TT via Espenak delta-T polynomial.
2. **Heliocentric positions.** VSOP87 series evaluation for Earth + target planet.
3. **Light-time correction.** Iterative solve backdating both bodies to account for light travel time.
4. **Frame rotation.** IAU 2006 precession + IAU2000B nutation → ecliptic-of-date longitude via atan2.
5. **Moon.** Meeus-style 104-term harmonic series with solar disturbance corrections.
6. **Ascendant.** Horizon-ecliptic intersection from local sidereal time + observer latitude.

All arithmetic is deterministic `i64` fixed-point (1e9 scale) with `i128` intermediates.
Same inputs always produce the same outputs.

## Validation

| Dataset | Points | Failures |
| --- | --- | --- |
| Random (seed 42) | 96,000 | 0 |
| Random (seed 99) | 96,000 | 1 |
| Structured (years 1–4000) | 96,000 | 0 |

A failure is a point where the Cairo engine and the JS oracle disagree on the zodiac sign (30° bucket) of any of the 8 bodies.

The single failure is Sun at 90.000023° — 0.00002° past the Cancer boundary.
At sub-arcsecond precision, sign disagreements this close to a 30° boundary are irreducible.

| Precision dataset | Points | Max error | Worst body |
| --- | --- | --- | --- |
| Structured (every 100y) | 960 | 0.000365° | Mercury |
| Random (seed 42) | 960 | 0.000382° | Mercury |

## Building

```bash
cd cairo && scarb build                # build the Starknet contract
cd cairo/crates/research && scarb test # run engine unit tests
cd astro && npm test            # run JS oracle tests
```

## Repository Layout

```
cairo/crates/
  astronomy_engine/            Starknet contract (thin wrapper)
  research/
    astronomy_engine_v6/       Active engine (source of truth)
    astronomy_engine_v1..v5/   Research iterations

astro/
  src/                         JS oracle (astronomy-engine wrapper) and eval tools
  evals/                       Evaluation results (ndjson)

spec/                          Design specs and domain reference
```

## Further Reading

- [spec/CHART.md](./spec/CHART.md) — chart construction spec
- [spec/EVALS.md](./spec/EVALS.md) — evaluation framework
- [astro/README.md](./astro/README.md) — eval CLI usage
- [cairo/crates/research/RESEARCH.md](./cairo/crates/research/RESEARCH.md) — v1 through v6 development arc

## Upstream Reference

All astronomy math derives from Donald Cross's [`astronomy-engine`](https://github.com/cosinekitty/astronomy) (MIT, `^2.1.19`).
