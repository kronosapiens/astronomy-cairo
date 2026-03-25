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
sncast --profile <mainnet|sepolia> declare --package astronomy_engine --contract-name AstronomyEngine

# deploy an instance (use the class hash from declare output)
sncast --profile <mainnet|sepolia> deploy --class-hash <class_hash>
```

Profiles are configured in `snfoundry.toml`.
Each profile references a named account in your local accounts file.

Deploying the contract will cost about 3,700,000,000 L2 gas

## Integration

Call the deployed contract:

```cairo
use astronomy_engine::{IAstronomyEngineDispatcher, IAstronomyEngineDispatcherTrait};

let engine = IAstronomyEngineDispatcher { contract_address };
let signs = engine.compute_signs(minute_pg, lat_bin, lon_bin);
```

- Mainnet contract address: [`0x06b7e435e06f8c0c84c27c59a3b0be11072bd0d05f12d4aec3c8eb4f51b4d4a6`](https://voyager.online/contract/0x06b7e435e06f8c0c84c27c59a3b0be11072bd0d05f12d4aec3c8eb4f51b4d4a6)
- Sepolia contract address: [`0x02bb544b17641b85e77971ae7cf710486131bec536146f2043ca94c97880125a`](https://sepolia.voyager.online/contract/0x02bb544b17641b85e77971ae7cf710486131bec536146f2043ca94c97880125a)

Since the contract is stateless, you can also use a `library_call` with the declared class hash:

```cairo
use astronomy_engine::{IAstronomyEngineLibraryDispatcher, IAstronomyEngineDispatcherTrait};

let engine = IAstronomyEngineLibraryDispatcher { class_hash };
let signs = engine.compute_signs(minute_pg, lat_bin, lon_bin);
```

- Mainnet class hash: [`0x63d9732a1e77cf5f37dcba003e56b14216bc5b82a541553fb877aabdbe36ee4`](https://voyager.online/class/0x063d9732a1e77cf5f37dcba003e56b14216bc5b82a541553fb877aabdbe36ee4)
- Sepolia class hash: [`0x63d9732a1e77cf5f37dcba003e56b14216bc5b82a541553fb877aabdbe36ee4`](https://sepolia.voyager.online/class/0x063d9732a1e77cf5f37dcba003e56b14216bc5b82a541553fb877aabdbe36ee4)
