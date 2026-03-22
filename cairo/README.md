# Cairo Astronomy Engine

## Structure

- `research/` — active research workspace
  - `astronomy_engine_v1` through `v6` — engine iterations (see per-crate READMEs)
  - `astronomy_engine_api` — library API wrapping the active engine
  - `astronomy_engine_eval_runner` — eval harness for `scarb cairo-run`

- `crates/astronomy_engine/` — Starknet contract wrapper (imports v6, adds `#[starknet::contract]`)

## Numeric Policy

- Runtime fixed-point: `i64` scaled by `1e9`
- Intermediate arithmetic: `i128`
- Rounding: half-away-from-zero

## Input Policy

- Minute-resolution time inputs (proleptic Gregorian epoch)
- Latitude/longitude as 0.01° bins (`i16`)

## Testing

```bash
cd research && scarb test   # run engine unit tests
scarb build                  # build deployable contract
```
