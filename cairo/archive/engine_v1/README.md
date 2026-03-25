# engine_v1 (Cairo) — Research Archive

v1 was the first Cairo astronomy engine.
It used pre-computed sign ingress tables to achieve deterministic sign-level parity for seven classical bodies, plus a runtime ascendant computation.

## Approach

Planet signs are determined by table lookup, not runtime computation.
Offchain, the JS oracle (`astronomy`) was used to generate sign ingress timestamps for each body over 1900-2100.
These ingress events were embedded as Cairo constant arrays in `oracle_signs.cairo`.
At runtime, a linear scan finds the last ingress before the query timestamp and returns its sign.

The ascendant is computed at runtime via a sidereal time + horizon/ecliptic intersection path using fixed-point trig.

## How It Works

1. `planet_sign_from_minute(planet, minute)` dispatches to the appropriate ingress table.
2. `lookup_sign` performs an O(n) linear scan over `(minute, sign)` pairs, returning the sign of the last entry at or before the query time.
3. Moon ingress data is segmented into 5 chunks (`MOON_INGRESS_0` through `MOON_INGRESS_4`, ~8000 entries each) to stay within Cairo practical limits.
4. The ascendant path in `ascendant.cairo` computes GMST, applies nutation/equation-of-equinoxes, derives LST, then solves the ecliptic-horizon intersection with eastern branch selection.

Numeric model: `i64` fixed-point at `1e9` scale, `i128` intermediates.
Time input: `minute_since_1900` (minutes from `1900-01-01T00:00:00Z`).
Location input: `0.1°` bins (`lat_bin`, `lon_bin`).

## What It Proved

- 100% sign parity for all seven bodies over the 1900-2100 range (by construction — the tables *are* the oracle output).
- Ascendant accuracy of 99.999872% (2-5 cusp-edge mismatches per location over 1,753,177 hourly samples).
- Feasible gas cost (~44M gas for a full 7-body sign lookup).

## Why We Moved On

- **Artifact size**: `oracle_signs.cairo` is 808,011 bytes; the compiled Sierra artifact is ~60MB.
- **Table generation dependency**: sign tables must be regenerated from the JS oracle whenever the upstream model or time range changes.
- **No longitude output**: the table path only returns signs, not longitudes.
- Later versions (v2+) pursued parametric runtime computation to eliminate both the artifact size and the offchain generation dependency.

## Key Source Files

| File | Purpose |
| --- | --- |
| `oracle_signs.cairo` | Generated ingress tables + `lookup_sign` / `planet_sign_from_minute` (808KB) |
| `ascendant.cairo` | Runtime ascendant via GMST/LST + ecliptic-horizon intersection |
| `planets.cairo` | Approximate longitude code, retained for reference — **dead code in v1 runtime** |
| `trig.cairo` | Deterministic `sin`/`cos`/`atan2` via lookup table + linear interpolation |
| `trig_table.cairo` | Sine lookup table (0.05° step, 7201 entries) |
| `atan_table.cairo` | Arctangent ratio lookup table (10001 entries) |
| `fixed.cairo` | `norm360`, `div_round_half_away_from_zero`, scale constant |
| `time.cairo` | `minute_since_1900` to `days_since_j2000` conversion |
| `types.cairo` | Planet index constants |

## Performance

| Metric | Value |
| --- | --- |
| Gas (7-body benchmark) | `44,183,350` |
| Sierra artifact | `59,589,267` bytes (~60MB) |
| `oracle_signs.cairo` | `808,011` bytes |

## Audit Findings (from ASTRONOMY_AUDIT.md)

- **`lookup_sign` is O(n) linear scan**: binary search would be faster, but acceptable given table sizes and the 44M gas budget.
- **`planets.cairo` is dead code**: the Saturn path is missing a -1° correction present in the JS model. Not a runtime issue since oracle tables are the actual path.
- **Ascendant div-by-zero at poles**: `tan(lat)` computation panics if `lat_bin = ±900` (exactly ±90°). The ascendant is geometrically undefined there, but the panic is undocumented.
- **Shared module duplication**: `fixed.cairo`, `time.cairo`, `trig.cairo`, `types.cairo`, `ascendant.cairo`, and table files are copy-pasted across v1/v2/v3 crates.

## Ingress Table Structure

Each table is an array of `(u32, u8)` pairs: `(minute_since_1900, sign_index)`.

| Table | Entries |
| --- | --- |
| `SUN_INGRESS` | 2,413 |
| `MOON_INGRESS_0..4` | 32,245 total (5 segments) |
| `MERCURY_INGRESS` | 2,982 |
| `VENUS_INGRESS` | 2,549 |
| `MARS_INGRESS` | 1,386 |
| `JUPITER_INGRESS` | 304 |
| `SATURN_INGRESS` | 170 |
