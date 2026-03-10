# Chart Port Plan (Cairo-Native)

This document records the implementation decisions made during planning for the Cairo-native chart pipeline.

Purpose:

- Preserve agreed choices so work can resume after interruptions.
- Define a concrete execution order for implementation.
- Separate locked decisions from open questions.

This plan complements `spec/CHART.md` and should be updated when decisions change.

---

## 1. Locked Decisions

### 1.1 Reference and Validation

- Primary correctness oracle: TypeScript `astronomy-engine` implementation.
- C implementation may be used only as a secondary cross-check for ambiguous edge cases.

### 1.2 Numeric Strategy (Cairo)

- Runtime fixed-point base: `i64`.
- Scale: decimal `1e9`.
- Intermediate widened arithmetic: `i128` for multiply/accumulate and sensitive transforms.
- Global rounding policy: round-half-away-from-zero.

Rationale:

- `u256`/large-width arithmetic is relatively expensive in Cairo.
- Pure `i64` everywhere risks overflow in chained multiplications.
- `i64` state + `i128` intermediates balances performance and precision.

### 1.3 Data Packaging

- Use segmented `const` tables grouped by planet/function.
- Avoid storage-backed runtime lookup for v1 core astronomy constants.

### 1.4 Input/Quantization Policy

- External time input accepted at minute resolution.
- Deterministic 15-minute bucketing happens inside `StarChart`.
- Supported range: `1900-01-01` through `2100-12-31` UTC.
- Epoch anchor for range math: `1900-01-01T00:00:00Z`.

Notes:

- The prior “minutes since 0 AD” idea was rejected due to calendar ambiguity and low-confidence ancient ephemeris accuracy.
- v1 focuses on reliable modern/historical range only.

### 1.5 Sign Mapping Boundary Rule

- Sign mapping is lower-sign inclusive using normalized longitude bins:
  - `sign = floor(norm360(longitude) / 30)`
- Exact cusp values (e.g. `30.0`) map to the next sign.

### 1.6 Validation Gate

- Initial parity gate is strict:
  - `0` sign mismatches versus TS oracle corpus.
- Corpus must include dense sampling around sign ingress windows.

Current status (2026-02-24):

- Planet signs (`Sun..Saturn`) achieve strict parity in the implemented runtime path via oracle ingress tables.
- Ascendant sign is near-strict but not mathematically perfect:
  - benchmark sweep (`1900-2100`, hourly, `lat=37.7`, `lon=-122.4`): `2 / 1,753,177` mismatches.
  - residual misses are cusp-adjacent numerical boundary cases.

---

## 2. Implementation Architecture

### 2.1 Module Split

- `astronomy_engine` (Cairo):
  - Time transforms used by required planetary longitude paths.
  - Seven-body longitudes (`Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn`).
  - Ascendant longitude computation.

- `star_chart` (Cairo):
  - Input normalization and 15-minute quantization.
  - Longitude-to-sign conversion.
  - Whole-sign house assignment.
  - Dignity/sect and sign-distance derivations.
  - Canonical chart payload assembly.

### 2.2 Determinism Rules

- All quantization and rounding policies are implemented onchain.
- No client-side “pre-rounding” assumptions may change chart outputs.
- Core/data versions are included in output payload for reproducibility.

---

## 3. Execution Plan

1. Oracle harness
- Build TS-based generator for corpus vectors in supported range.
- Emit baseline outputs for seven planets + ascendant signs.
- Include dense ingress-focused samples.

2. Cairo numeric primitives
- Implement shared fixed-point utilities (`i64@1e9`, `i128` intermediates).
- Encode round-half-away-from-zero as a single canonical helper.
- Add golden tests for arithmetic determinism.

3. Cairo astronomy pipeline
- Port required time/precession/nutation pieces only.
- Port seven-planet longitude path against oracle.
- Implement ascendant longitude and validate.

4. Cairo astrology layer
- Implement sign mapping + whole-sign houses.
- Implement dignity/sect derivation tables.
- Produce canonical chart state payload.

5. Differential and regression testing
- Run full parity test corpus.
- Enforce `0` sign mismatch gate.
- Add edge-case tests for cusps, range bounds, and quantization transitions.

6. Hardening
- Profile and optimize hot paths.
- Freeze `core_version` and `data_version` with hashes.
- Prepare deployment artifact layout.

---

## 4. Open Policy Items

These were not fully locked in planning and should be finalized during implementation:

- Out-of-range handling behavior:
  - revert vs “return with warning flag/event”.
- Exact canonical field encoding for warning/status metadata.
- Final corpus size targets for CI runtime budget.
- Whether v1 requires absolute ascendant strict parity or accepts cusp-adjacent residual mismatch with documented bounds.

---

## 5. Resume Checklist

When restarting work, confirm:

- This document still matches current decisions.
- `spec/CHART.md` scope has not changed.
- Oracle generator output hashes are stable.
- Numeric rounding behavior still matches golden vectors.

If any item changes, bump relevant versioning (`core_version` and/or `data_version`) and document migration impact.
