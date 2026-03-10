# Mismatch Analysis

- Source: `/Users/kronosapiens/code/personal/astronomy-engine/astro/evals/v5-heavy-mismatches-3461-3500.ndjson`
- Rows: 40
- Year range: 3461..3498
- Year bucket size: 20

## By Planet Bit

| Component | Count |
|---|---:|
| Sun | 0 |
| Moon | 0 |
| Mercury | 6 |
| Venus | 8 |
| Mars | 6 |
| Jupiter | 6 |
| Saturn | 14 |
| Ascendant | 0 |

## Top Masks

| Mask | Count |
|---:|---:|
| 64 | 14 |
| 8 | 8 |
| 16 | 6 |
| 32 | 6 |
| 4 | 6 |

## Cusp Distance

Distance to nearest sign boundary (degrees) for mismatched planet bits.

| Scope | N | <0.01 | <0.1 | <0.5 | <1.0 | >=1.0 |
|---|---:|---:|---:|---:|---:|---:|
| Overall | 40 | 0 | 32 | 40 | 40 | 0 |
| Mercury | 6 | 0 | 6 | 6 | 6 | 0 |
| Venus | 8 | 0 | 8 | 8 | 8 | 0 |
| Mars | 6 | 0 | 4 | 6 | 6 | 0 |
| Jupiter | 6 | 0 | 4 | 6 | 6 | 0 |
| Saturn | 14 | 0 | 10 | 14 | 14 | 0 |

### Signed Cusp Side

| Scope | N | Neg | Pos | Zero | Mean Signed Offset (deg) |
|---|---:|---:|---:|---:|---:|
| Overall | 40 | 0 | 40 | 0 | 0.066815 |
| Mercury | 6 | 0 | 6 | 0 | 0.045750 |
| Venus | 8 | 0 | 8 | 0 | 0.036721 |
| Mars | 6 | 0 | 6 | 0 | 0.089907 |
| Jupiter | 6 | 0 | 6 | 0 | 0.077608 |
| Saturn | 14 | 0 | 14 | 0 | 0.078519 |

## Signed Sign Delta

| Scope | N | Lead (+) | Lag (-) | Exact (0) |
|---|---:|---:|---:|---:|
| Overall | 40 | 0 | 40 | 0 |
| Mercury | 6 | 0 | 6 | 0 |
| Venus | 8 | 0 | 8 | 0 |
| Mars | 6 | 0 | 6 | 0 |
| Jupiter | 6 | 0 | 6 | 0 |
| Saturn | 14 | 0 | 14 | 0 |

### Delta Histogram (Overall)

| Delta | Count |
|---:|---:|
| -1 | 40 |

## Longitude Delta (Deg)

| Scope | N | Mean Signed | Mean Abs | <0.01 | <0.1 | <0.5 | <1.0 | >=1.0 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Overall | 40 | -0.139186 | 0.139186 | 0 | 0 | 40 | 40 | 0 |
| Mercury | 6 | -0.122256 | 0.122256 | 0 | 0 | 6 | 6 | 0 |
| Venus | 8 | -0.144987 | 0.144987 | 0 | 0 | 8 | 8 | 0 |
| Mars | 6 | -0.135666 | 0.135666 | 0 | 0 | 6 | 6 | 0 |
| Jupiter | 6 | -0.142106 | 0.142106 | 0 | 0 | 6 | 6 | 0 |
| Saturn | 14 | -0.143383 | 0.143383 | 0 | 0 | 14 | 14 | 0 |

## By Location

| Location | Count |
|---|---:|
| Alexandria | 20 |
| NYC | 20 |

## By Year Bucket

| Years | Count |
|---|---:|
| 3481-3500 | 22 |
| 3461-3480 | 18 |
