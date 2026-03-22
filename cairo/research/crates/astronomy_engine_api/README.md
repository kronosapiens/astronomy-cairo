# astronomy_engine_api

Stable function interface between the eval runner and the active engine.
Wraps the engine crate (currently v6) with `engine_id` dispatch, range validation, and sign conversion.

The eval runner calls these functions via `scarb cairo-run`.
The JS eval harness (`astro/src/cli/`) constructs argument payloads and invokes them.

## Functions

| Function | Description |
| --- | --- |
| `compute_engine_signs_pg` | All 8 zodiac signs (7 planets + ascendant) |
| `compute_engine_all_longitudes_pg_1e9` | All 8 ecliptic longitudes (degrees × 1e9) |
| `compute_engine_planet_longitudes_pg_1e9` | 7 planet longitudes without ascendant |
| `compute_engine_planet_debug_frame_pg_1e9` | Debug: EQJ vector + frame projection for one planet |
| `compute_engine_frame_from_eqj_1e9` | Debug: project an arbitrary EQJ vector to ecliptic frame |
| `engine_supported_minute_range` | Returns (min, max) supported minute range |

## Switching engines

Change the dependency in `Scarb.toml` from `astronomy_engine_v6` to a future version, and update the `use` imports in `lib.cairo`.
The `engine_id` parameter is a legacy artifact — it always asserts `== 5`.
