# Chart Construction Spec (Cairo-First)

This document defines the current chart-construction direction.

Primary approach: port the required subset of `astronomy-engine` into Cairo/Starknet, then layer astrology/game derivations above it.

This replaces earlier prototype assumptions (randomized or plausibility-clamped placements) for production chart generation.

---

## 1. Scope and Goals

### Goals

- Deterministic, reproducible chart generation from quantized mint inputs.
- Onchain-computable astronomy core with explicit versioning.
- Sign-level outputs for deterministic chart state.

### In Scope (v1)

- Seven bodies: `Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn`.
- Ascendant sign.
- Whole-sign houses.
- Derived traits from sign placement:
  - element
  - modality
  - dignity
  - sect status

### Explicitly Out of Scope (v1)

- Degree-level orb logic for aspects.
- Higher-layer interaction semantics beyond chart construction.
- Time-lords, lots, and medieval sub-systems.

---

## 2. Canonical Chart State

For each minted chart, canonical state is:

- `planet_sign[7]` (0..11)
- `asc_sign` (0..11)
- derived lookup results (house / dignity / sect / sign-aspect class)
- `core_version`
- `data_version`

Notes:

- We do not require persisting exact longitudes in canonical chart state.
- Longitudes may be computed internally to derive sign placements.

---

## 3. Architecture

### 3.1 `AstronomyEngine` (Cairo)

Port of [astronomy-engine](https://github.com/cosinekitty/astronomy), no astrology semantics.

Responsibilities:

- Time transforms needed by astronomy model
- Ecliptic longitudes for 7 planets
- Ascendant computation

### 3.2 `StarChart` (Cairo)

Astrological derivation layer.

Responsibilities:

- input quantization (`time`, `lat`, `lon`)
- longitude -> sign mapping
- whole-sign house mapping
- dignity/sect derivation tables
- sign-distance aspect class derivation

Separation keeps astronomy stable while allowing chart-derivation updates in higher layers.

---

## 4. Port Strategy (from `astronomy-engine`)

Reference implementation for correctness is `astronomy-engine`.

### Keep

- Only code paths required to compute:
  - 7 planetary longitudes
  - ascendant
- Dependent time/precession/nutation transforms actually used by those paths.

### Drop

- Eclipses, rise/set search, visual magnitude, constellations/stars.
- Unused bodies/features outside the current chart-computation scope.

### Important Constraint

- No ad hoc rules (for example Mercury/Venus distance clamps).
- Validity should come accurate port of existing engine.

---

## 5. Numeric/Data Plan

### Numeric

- Cairo fixed-point arithmetic for runtime math.
- Global precision + rounding policy is versioned and frozen per core version.

### Data

- Start from the same model/data basis as `astronomy-engine`.
- Convert to Cairo-friendly constants/tables during build.
- Version and hash datasets used by deployed contracts.

Design target:

- Keep deployed data footprint operationally manageable (sub-MB preferred for v1).

---

## 6. Validation Requirements

### 6.1 Differential Accuracy

Against JS oracle (`astronomy-engine`) across supported range:

- Track angular error by planet.
- Track sign parity by planet.

### 6.2 Sign Stability Gate

- Zero sign mismatches in validation corpus for supported range.
- Extra dense sampling near sign ingress windows.

### 6.3 Determinism Gate

- Same input + same versions -> identical output.
- Golden vector tests for Cairo fixed-point behavior.

### 6.4 Runtime Gate

- Mint-time compute cost within acceptable Starknet budget.

---

## 7. Supported Range and Versioning

Initial supported range target:

- `1900-01-01` through `2100-12-31` UTC

Policy:

- Inputs outside supported range are accepted, with warning.
- Extending range requires a new `data_version` plus validation report.
- Old versions remain reproducible.

---

## 8. Delivery Phases

1. JS oracle harness
- Lock reference outputs from `astronomy-engine` for required inputs.
- Produce reusable validation corpus.

2. Cairo math primitives
- Rely on [Alexandria](https://github.com/keep-starknet-strange/alexandria) library for core math
- Add deterministic rounding as needed.

3. Cairo longitude pipeline
- Implement 7-planet longitude path.
- Verify against oracle.

4. Cairo ascendant pipeline
- Implement ascendant/sign derivation path.
- Verify against oracle.

5. Astrology derivation layer
- Whole-sign houses + dignity + sect derivations.
- Produce canonical chart state payload.

6. Hardening
- Performance profiling.
- Version locking.
- Deployment-ready data packaging.

---

## 9. Relationship to Game Mechanics

This document only covers chart construction.

Combat/encounter resolution remains defined in `spec/MECHANICS.md`.

Key interface contract between systems:

- Chart construction outputs deterministic sign-level state.
- Mechanics consumes that state without requiring degree-level geometry.
