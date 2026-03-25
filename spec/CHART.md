# Chart Construction Spec (Cairo-First)

Port the required subset of `astronomy` into Cairo/Starknet, then layer astrology derivations above it.

## 1. Scope

### In Scope

- Seven bodies: Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn.
- Ascendant sign.
- Whole-sign houses.
- Derived traits: element, modality, dignity, sect status.

### Out of Scope

- Degree-level orb logic for aspects.
- Time-lords, lots, and medieval sub-systems.
- Eclipses, rise/set, visual magnitude, constellations/stars.

## 2. Architecture

### `AstronomyEngine` (Cairo)

Port of [astronomy](https://github.com/cosinekitty/astronomy), no astrology semantics.

- Time transforms needed by astronomy model.
- Ecliptic longitudes for 7 planets.
- Ascendant computation.

### `StarChart` (Cairo)

Astrological derivation layer.

- Input normalization and quantization.
- Longitude → sign mapping.
- Whole-sign house assignment.
- Dignity/sect derivation tables.
- Canonical chart payload assembly.

Separation keeps astronomy stable while allowing chart-derivation updates in higher layers.

## 3. Locked Decisions

### Numeric Strategy

- Runtime fixed-point base: `i64`, scale `1e9`.
- Intermediate widened arithmetic: `i128` for multiply/accumulate.
- Global rounding policy: round-half-away-from-zero.

### Data Packaging

- Segmented `const` tables grouped by planet/function.
- No storage-backed runtime lookup for core astronomy constants.

### Input Policy

- Time input at minute resolution.
- Supported range: years 0001–4000 (proleptic Gregorian).
- Latitude/longitude as 0.01° bins (`i16`).

### Sign Mapping

- `sign = floor(norm360(longitude) / 30)`
- Exact cusp values (e.g. 30.0°) map to the next sign.

### Validation

- Primary oracle: TypeScript `astronomy` (`^2.1.19`).
- Gate: 0 sign mismatches in validation corpus.
- Dense sampling around sign ingress windows.

## 4. Canonical Chart State

For each chart:

- `planet_sign[7]` (0..11)
- `asc_sign` (0..11)
- Derived lookup results (house / dignity / sect / sign-aspect class)
- `core_version`

## 5. Port Strategy

### Keep

- Only code paths required for 7 planetary longitudes + ascendant.
- Dependent time/precession/nutation transforms actually used by those paths.

### Drop

- Everything not required by the longitude/ascendant paths.

### Constraint

- No ad hoc corrections (e.g. Mercury/Venus distance clamps).
- Validity comes from accurate port of the upstream engine.

## 6. Relationship to Game Mechanics

This document covers chart construction only.
Chart construction outputs deterministic sign-level state.
Game mechanics consume that state without requiring degree-level geometry.
