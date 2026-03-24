# Cairo Astronomy Engine

## Structure

- `astronomy_engine/` — Starknet contract wrapper (imports engine_v6, adds `#[starknet::contract]`)
- `engine_v6/` — active computation engine
- `eval_runner/` — eval harness for `scarb cairo-run`
- `archive/` — previous engine iterations (engine_v1 through engine_v5)

## Numeric Policy

- Runtime fixed-point: `i64` scaled by `1e9`
- Intermediate arithmetic: `i128`
- Rounding: half-away-from-zero

## Input Policy

- Minute-resolution time inputs (proleptic Gregorian epoch, UTC)
- Latitude/longitude as 0.01° bins (`i16`)

## Testing

```bash
scarb test    # run all tests via snforge
```

## Deployment

```bash
cd cairo
asdf install

# declare the contract class
sncast --profile <mainnet|sepolia> declare --contract-name AstronomyEngine

# deploy an instance (use the class hash from declare output)
sncast --profile <mainnet|sepolia> deploy --class-hash <class_hash>
```

Profiles are configured in `snfoundry.toml`.
Each profile references a named account in your local accounts file.

## Integration

Call the deployed contract:

```cairo
use astronomy_engine::{IAstronomyEngineDispatcher, IAstronomyEngineDispatcherTrait};

let engine = IAstronomyEngineDispatcher { contract_address };
let signs = engine.compute_signs(minute_pg, lat_bin, lon_bin);
```

Since the contract is stateless, you can also skip deployment and use `library_call` with just the declared class hash:

```cairo
use astronomy_engine::{IAstronomyEngineLibraryDispatcher, IAstronomyEngineDispatcherTrait};

let engine = IAstronomyEngineLibraryDispatcher { class_hash };
let signs = engine.compute_signs(minute_pg, lat_bin, lon_bin);
```
