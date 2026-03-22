# astronomy_engine_v6 (Cairo)

Identical to v5 except for reduced trig lookup tables, optimized to fit within Starknet's contract class size limit.

## Motivation

Starknet limits contract classes to 4,089,446 bytes (JSON serialized) and 81,920 felt bytecode.
The v5 engine compiled to a monolithic contract of 4,200,938 bytes — 111 KB over the limit.

Investigation revealed the cause: Sierra IR encodes every literal integer as a distinct `Const<i64, N>` type declaration.
v5 had 14,779 unique i64 constants (mostly from trig tables: 10,001 atan entries + 7,201 sin entries), consuming 4.4 MB of type declarations alone.
This motivated exploring how far the trig tables could be reduced while maintaining sign-level parity with the JS oracle.

## Sweep Methodology

A systematic sweep varied each table independently, testing against the JS oracle at increasing scale.
"Quick check" = 200-point random sample.
"At scale" = 8,000-point random samples across multiple seeds.
Failures are sign-level disagreements (zodiac sign index differs from oracle).

### Sin table sweep (atan fixed at 5,001 entries)

| Entries | Step | Quick check | At scale |
| --- | --- | --- | --- |
| 91 | 4° | 198/200 fail | — |
| 181 | 2° | pass | not tested |
| 361 | 1° | pass | 5 failures / 8,000 |
| 721 | 0.5° | pass | 3 failures / 8,000 |
| 1,801 | 0.2° | pass | 1 failure / 8,000 |
| 3,601 | 0.1° | pass | 0 failures |

### Atan table sweep (sin fixed at 361 entries)

| Entries | dz | Quick check | At scale |
| --- | --- | --- | --- |
| 11 | 0.1 | pass | not tested |
| 51 | 0.02 | pass | 1 failure / 4,000 |
| 501 | 0.002 | pass | 0 failures |

All intermediate failures were sign-boundary edge cases: bodies within thousandths of a degree of a 30° boundary where accumulated trig interpolation error tips the sign.

## Final Configuration

| | v5 | v6 | Reduction |
| --- | --- | --- | --- |
| Sin entries | 7,201 | 3,601 (0.1° step) | 50% |
| Atan entries | 10,001 | 501 (dz=0.002) | 95% |
| Total entries | 17,202 | 4,102 | 76% |
| Contract class size | 4.20 MB | 2.89 MB | 1 MB under limit |

Max angular error: ~0.0004° (unchanged from v5).

## Why Precision Barely Changed

Linear interpolation error scales as h^2 * |f''| / 8.
For sin at 0.1° step, the max interpolation error is ~3.8e-7 at 1e9 scale — about 0.4 parts per billion.

The dominant error source is fixed-point arithmetic rounding (`i64` at 1e9 scale vs IEEE 754 `float64`).

Investigation confirmed that v6 has **full algorithmic parity** with the upstream JS oracle:
- VSOP terms: 360/360 (identical truncation from full VSOP87)
- IAU2000B nutation: 5/5 terms (identical to upstream)
- Light-time semantics: both backdate Earth and target planet (upstream comment: "first-order approximation by backdating the Earth's position also")

There are no model-level improvements available without changing the upstream oracle itself.
The ~0.0004° error ceiling is the inherent precision limit of the fixed-point representation.
The v5 trig tables were ~10,000x more precise than needed.
Only sign-boundary edge cases (body within 0.001° of a 30° line) can detect the difference between v5 and v6 table sizes.

## Validation

| Dataset | Points | Failures |
| --- | --- | --- |
| Random (seed 42) | 96,000 | 0 |
| Random (seed 99) | 48,000+ | 1 (irreducible Sun cusp at year 3253) |

The single failure is the same irreducible cusp case as v5: Sun at 90.000023° (0.00002° past the Cancer boundary).
Full 96k seed 99 evaluation in progress.

## Source

All modules except `gen_sin.cairo`, `gen_atan.cairo`, and `trig.cairo` are identical to v5.
See the [v5 README](../astronomy_engine_v5/README.md) for architecture, usage, and upstream reference.
