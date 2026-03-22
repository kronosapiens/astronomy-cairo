# Research Summary

This document traces the development of a deterministic onchain astronomy engine in Cairo, from initial prototype to deployment-ready artifact.
The engine computes ecliptic longitudes for seven classical bodies (Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn) plus the ascendant, validated at 99.997% sign-level parity against a professional ephemeris across 4,000 years.

## The Arc: v1 → v6

### v1 — Table Ingress (baseline)

Pre-computed sign ingress timestamps for each planet, stored as lookup tables in Cairo.
The runtime does a linear scan to find which sign a planet occupies at a given time.
Ascendant is computed at runtime via sidereal time and trig.

**Outcome:** 100% sign parity within the table's time range, but the oracle tables are ~808 KB of generated source, producing a ~60 MB Sierra artifact.
Gas: ~44M per query.

**Why we moved on:** Large artifact size, and the approach can't extend beyond the pre-computed time range without regenerating tables.

→ [v1 README](cairo/research/crates/astronomy_engine_v1/README.md)

### v2 — Chebyshev Polynomials

Replaced tables with Chebyshev polynomial fits evaluated at runtime via Clenshaw recurrence.
Coefficients are pre-computed per time block and stored as quantized `i32` arrays.

**Outcome:** Gas dropped dramatically to ~2.5M (18x reduction from v1).
But the data file grew to ~2.2 MB (72 MB Sierra) because of the per-block coefficient storage.
Model semantics were narrower — block boundaries and coefficient quantization introduced subtle artifacts.

**Why we moved on:** Wanted higher-fidelity astronomical models that compute from first principles rather than fitting to observed data.

→ [v2 README](cairo/research/crates/astronomy_engine_v2/README.md)

### v3 — VSOP + Frame Transforms

First version to compute planetary positions from upstream-style astronomy math.
Evaluates truncated VSOP87 series for heliocentric coordinates, applies a full frame-conversion chain (VSOP ecliptic → J2000 EQJ → precession → IAU2000B nutation → ecliptic of date), and extracts longitude via atan2.

**Outcome:** Data footprint collapsed to ~31 KB (VSOP terms only), Sierra dropped to ~18 MB.
Mercury through Saturn achieved 0 sign-level mismatches in the 1900–2100 range.
But Sun and Moon still used earlier parametric approximations.
Gas rose to ~152M due to the computational complexity.

**Why we moved on:** Needed to upgrade Sun and Moon to the same VSOP/frame pipeline.

→ [v3 README](cairo/research/crates/astronomy_engine_v3/README.md)

### v4 — Complete 7-Body Pipeline

Upgraded the Sun path to use the negated Earth VSOP vector through the full frame chain.
Introduced a Meeus-style 104-term harmonic Moon model with solar disturbance corrections.
Added the Espenak piecewise delta-T polynomial for UT→TT conversion.
Expanded the time domain to years 0001–4000 (proleptic Gregorian).

**Outcome:** All seven bodies plus ascendant computed from first principles.
Gas: ~192M.
Achieved ~99.95% sign parity, with persistent mismatches concentrated in outer planets (Saturn, Jupiter) in the far-future range.

**Why we moved on:** The remaining ~0.05% mismatches needed diagnostic investigation, not more model changes.

→ [v4 README](cairo/research/crates/astronomy_engine_v4/README.md)

### v5 — The Frame-Time Fix (production)

Starting from v4, focused on correctness refinements rather than new features.
The key breakthrough was a stage-level diagnostic methodology: debug probes for EQJ vectors and frame projections isolated the remaining parity gap to the frame-projection stage.
An A/B test on the frame-time sign convention identified the correct branch, immediately resolving all remaining mismatches.

**Outcome:** 100% sign parity on the 96,000-point structured eval (years 0001–4000, deterministic grid).
On random evals, 1 irreducible cusp-boundary failure per ~96,000 points (Sun within 0.00003° of a sign boundary).
Max angular error: ~0.0004° (~1.4 arcseconds).
Gas: ~184M.

The primary lesson: **pipeline-semantics parity matters far more than arithmetic precision**.
Multiple spot-correction attempts (symmetric rounding, VSOP clamps, higher-precision lanes) produced zero improvement — the frame convention was the only thing that mattered.

→ [v5 README](cairo/research/crates/astronomy_engine_v5/README.md)

### v6 — Deployment Optimization

Identical to v5 except for reduced trig lookup tables, motivated by the Starknet contract class size limit (4,089,446 bytes).
The v5 monolith compiled to 4,200,938 bytes — 111 KB over the limit.

Investigation revealed that Sierra IR encodes every literal integer as a distinct `Const<i64, N>` type.
v5's 17,202 trig table entries consumed 4.4 MB of type declarations alone.

A systematic sweep found that the sin table could be reduced from 7,201 to 3,601 entries (0.1° step) and the atan table from 10,001 to 501 entries — a 76% reduction in total entries — while maintaining sign parity across 12,000+ random points (matching v5's accuracy profile).

**Outcome:** Monolithic contract class at 2.89 MB (1 MB under the limit).
Max angular error unchanged at ~0.0004°.

Further investigation confirmed that v6 has **full algorithmic parity** with the upstream JS oracle: identical VSOP terms (360/360), identical nutation terms (5/5), and identical light-time semantics.
The ~0.0004° error ceiling is the inherent precision difference between `i64` fixed-point arithmetic and IEEE 754 `float64` — there are no model-level improvements available without changing the upstream oracle itself.

→ [v6 README](cairo/research/crates/astronomy_engine_v6/README.md)

## Performance and Size Across Versions

| Engine | Gas | Sierra | Core Data | Approach |
| --- | --- | --- | --- | --- |
| v1 | ~44M | ~60 MB | 808 KB | Table ingress |
| v2 | ~2.5M | ~72 MB | 2.2 MB | Chebyshev polynomials |
| v3 | ~152M | ~18 MB | 31 KB | VSOP + frames (5 planets) |
| v4 | ~192M | ~18 MB | 31 KB | VSOP + frames (7 bodies) |
| v5 | ~184M | ~18 MB | 31 KB | v4 + frame-time fix |
| v6 | ~184M | ~10 MB | 31 KB | v5 + table optimization |

## Evaluation Infrastructure

The project uses a two-layer validation approach:

1. **Structured eval** — deterministic grid: 12 months × 2 locations per year, covering years 0001–4000.
Produces 96,000 points with full reproducibility.

2. **Random eval** — seed-deterministic sampling with stratified year buckets and latitude bands.
Batches 24 points per Cairo execution for efficiency.
Fixed seeds serve as regression tests.

Both compare Cairo sign indices against a JS oracle backed by Don Cross's [astronomy-engine](https://github.com/cosinekitty/astronomy) library.

Eval tooling lives in `astro/src/cli/`.
Results live in `astro/evals/`.

## Repository Structure

```
cairo/
  crates/              # Deployable contract crates (v6-based)
  research/            # Research workspace (v1-v6, eval runner)

astro/
  src/engine.js        # JS oracle (astronomy-engine wrapper)
  src/cli/             # Eval harness CLI tools
  evals/               # Evaluation results (ndjson)

spec/                  # Specifications and domain reference
```

## Upstream Reference

All astronomy math derives from Donald Cross's [`astronomy-engine`](https://github.com/cosinekitty/astronomy) (MIT, `^2.1.19`).
The Cairo implementation is a deterministic fixed-point adaptation of the upstream model.
