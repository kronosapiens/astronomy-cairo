# eval_runner

Cairo entry points for the JS evaluation harness.
Each public function is called via `scarb cairo-run --function <name>` with arguments passed as a JSON file.
Imports directly from `engine_v6`.

The JS harness (`astro/src/cli/lib/eval-core.js`) constructs argument payloads, invokes `scarb cairo-run`, and parses the `returning [...]` output.

## Functions

| Function | Called by | Description |
| --- | --- | --- |
| `eval_batch_fail_count` | — | Simple batch pass/fail count (legacy) |
| `eval_batch_fail_breakdown` | `runCairoBatch` | Batch eval returning 10-tuple: chart/planet/asc/per-body fail counts |
| `eval_point_longitudes` | `runCairoPointLongitudes` | Single-point 8-tuple of longitudes (1e9-scaled) |
| `eval_point_mismatch_mask` | — | Single-point 8-bit mismatch bitmask |
| `eval_point_mismatch_detail` | `runCairoPointMismatchDetail` | Mask + signs + longitudes (16-tuple) |
| `eval_point_planet_debug_frame` | — | Debug: per-planet EQJ + frame internals |
| `eval_frame_from_eqj` | — | Debug: project EQJ vector through Cairo frame |

## Data flow

```
JS eval script
  → constructs [point_data, expected_signs] as JSON
  → scarb cairo-run --function eval_batch_fail_breakdown --arguments-file /tmp/args.json
  → parses "returning [...]" from stdout
  → emits ndjson results
```

Batch functions pack 24 points per invocation for efficiency.
Per-point functions are used for mismatch drill-down and precision measurement.
