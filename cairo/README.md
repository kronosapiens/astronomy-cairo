# Cairo Astronomy Engine Workspace

This workspace contains the active Cairo astronomy-engine crates plus retained historical reference crates.

## Active Workspace Members

- `astronomy_engine_v5`
- `astronomy_engine_api`
- `astronomy_engine_eval_runner`

Historical R&D crates (`v1`..`v4`, `star_chart`) remain in `crates/` for reference but are not active workspace members.

## Numeric Policy

- Runtime fixed-point: `i64` scaled by `1e9`
- Intermediate arithmetic: `i128`
- Rounding: half-away-from-zero

## Input Policy

- Minute-resolution time inputs
- Latitude/longitude bins in `0.1°`
- Deterministic 15-minute quantization where chart-level derivation requires it

## Testing

Run all active Cairo tests:

```bash
scarb test
```

Core coverage includes:

- fixed-point arithmetic and angle normalization
- time conversion and calendar transforms
- planetary longitude computation
- ascendant computation
- eval-runner parity checks against oracle-generated expectations
