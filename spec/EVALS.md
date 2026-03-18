# Astronomy Engine Evaluation Spec

This document defines how astronomy-engine correctness is measured in this repository.

Its purpose is to make evaluation work:

- reproducible
- composable
- resumable
- useful for diagnosis, not just pass/fail reporting

This spec is a reference for `astro/` tooling, Cairo eval runners, and any future CI or milestone gates.

---

## 1. Principles

### 1.1 Upstream Fidelity First

The primary goal of evaluation is to measure fidelity to the upstream `astronomy-engine` computational pipeline.

Evaluation should prefer:

- algorithm-stage parity
- transform/time-scale correctness
- broad-range validation
- deterministic regression gates

Evaluation should not optimize for:

- narrow benchmark-window wins
- hand-tuned spot corrections
- silent benchmark exclusions

### 1.2 Observability Is Part of Correctness Work

A long-running evaluation that produces no progress signal is operationally weak, even if its final result is technically correct.

All substantial eval harnesses should emit enough information to answer:

- what is running
- how far it has progressed
- whether it can be resumed
- what exact configuration produced the result

This requirement applies to the operational surface of the harness, not to the scientific meaning of any single result row.

Progress/cursor metadata may describe the state of a particular process.
Result rows must remain valid and reusable even if the originating process is interrupted, resumed, split into multiple smaller runs, or never emits a final "done" event.

### 1.3 Determinism

All evaluation modes must be deterministic from explicit inputs:

- engine version
- date range
- location set
- seed
- sample count
- batch/chunk size
- oracle definition

If a run cannot be reproduced from its recorded inputs, it is not a valid baseline artifact.

---

## 2. Evaluation Layers

We use multiple layers of evaluation. No single layer is sufficient by itself.

### 2.1 Unit Tests

Purpose:

- validate arithmetic primitives
- validate time conversions
- validate transform helpers
- validate fixed regression snapshots

Examples:

- `scarb test`
- `node --test`

These should be fast and local.

### 2.2 Corpus Gates

Purpose:

- enforce deterministic regression checks on known-hotspot points
- catch reintroductions of previously fixed failures

Properties:

- small enough to run frequently
- fixed inputs
- zero ambiguity about expected outputs

Corpus gates are the first hard correctness gate after local code changes.

### 2.3 Structured Window Sweeps

Purpose:

- measure engine behavior over bounded year windows and fixed location sets
- support milestone reporting
- compare versions under controlled sampling density

Examples:

- `eval-light`
- `eval-heavy`

These runs produce summary rows by year window and are used for milestone baselines.

### 2.4 Random Differential Evaluation

Purpose:

- probe for unexpected failures outside curated corpora
- sample across broad temporal and geographic ranges
- stress the engine against varied conditions

Random evaluation is exploratory coverage, not a substitute for deterministic corpus gates.

Because these runs can be long, they must support:

- resumability via `--start-index` / `--end-index` (derived from inspecting existing output)
- self-contained, job-invariant result rows

### 2.5 Diagnostic Mismatch Analysis

Purpose:

- explain failures, not just count them
- localize drift by planet, region, year bucket, or cusp distance

Examples:

- mismatch logs
- mismatch corpus generation
- point-level detail probes
- frame/planet debug probes

This layer is for root-cause analysis after failures are discovered elsewhere.

---

## 3. Oracle Policy

### 3.1 Primary Oracle

The primary correctness oracle is the TypeScript `astronomy-engine` package used in `astro/`.

### 3.2 Secondary Cross-Checks

Other implementations may be used only as secondary references when diagnosing ambiguity.

They must not silently replace the primary oracle in reporting.

### 3.3 Expected Output Domain

The current primary correctness domain is sign-level output for:

- Sun
- Moon
- Mercury
- Venus
- Mars
- Jupiter
- Saturn
- Ascendant

Unless explicitly stated otherwise, evaluation refers to exact sign equality against the oracle.

---

## 4. Evaluation Modes

## 4.1 Light Eval

Purpose:

- fast sanity gate
- developer-loop validation

Requirements:

- deterministic
- bounded runtime
- representative multi-era coverage

Use:

- before and after targeted fixes
- before broader heavy runs

## 4.2 Heavy Eval

Purpose:

- milestone baseline
- broad structured coverage across large date ranges

Requirements:

- deterministic year-window summaries
- explicit engine/profile/date-range metadata
- one heavy run at a time

Operational rule:

- do not run multiple heavy eval processes concurrently in the same workspace

## 4.3 Random Eval

Purpose:

- wide exploratory coverage
- long unattended validation

Requirements:

- deterministic sample generation from `(seed, sampleIndex)`
- all output to stdout as ndjson
- resumable via `--start-index` / `--end-index`

Random eval must be composable:

- any index range can be run independently
- outputs from different runs can be concatenated and deduplicated
- a row is identical regardless of which job produced it

---

## 5. Output Contracts

Output artifacts should be append-only NDJSON written to stdout.

Every entry in these output files should be a stand-alone piece of data.
It should be possible to aggregate, splice, recombine outputs accurately, using only the data stored on the NDJSON entries.

It should also be possible to scan a results file, determine gaps in coverage, and run the evaluation script only to fill those gaps.
We must never require a job to run to completion for the intermediate results to be valid, and should assume that long-running evaluation jobs may be killed at any time.

This is the primary rule for NDJSON artifacts:

- every result row must be self-contained and process-boundary-independent

In practice, that means a row must not depend on:

- a final completion marker
- cumulative totals from prior rows
- a separate state file
- assumptions about whether the run was executed as one job or many jobs

A stronger form of this rule: **result rows must be job-invariant.**
A given point's row must be byte-identical regardless of what job produced it.
Rows must not contain job-level configuration (run size, batch size, year range, include-passes mode) — only the fields that describe the point and its result.
Two runs with different `--points` or `--start-index` / `--end-index` values but the same `seed` and `sampleIndex` must produce identical output rows.
This means outputs from different jobs can be concatenated, deduplicated, and analyzed without distinguishing which job produced which row.

### 5.1 Result Rows

Each result row represents one evaluated point.
All output goes to stdout as ndjson.
Aggregations (pass/fail counts, per-planet breakdowns, timing) are derived by consumers, not emitted by the tool.

Minimum fields:

- `type`
- `engine`
- `seed`
- `sampleIndex`
- timestamp/date components
- `latBin`
- `lonBin`
- expected signs
- actual signs
- mismatch mask

Recommended fields:

- actual longitudes
- year bucket
- latitude stratum

### 5.2 Resumability

Resumability is achieved by inspecting existing output, not by maintaining state files.
To resume an interrupted run, scan the output for completed `sampleIndex` values, identify gaps, and re-run with `--start-index` / `--end-index` targeting the missing range.
The tool does not need a `--resume` flag or a state file.

---

## 6. Pass/Fail Semantics

### 6.1 Corpus Gate

Corpus gates are strict.

Default expectation:

- `0` sign mismatches

If a corpus gate fails, the engine is not baseline-clean.

### 6.2 Light and Heavy Structured Sweeps

These are used both as hard gates and as measurement tools.

For milestone baselines, report:

- total pass/fail counts
- per-body fail counts
- date window
- sampling density
- location set

### 6.3 Random Eval

Random eval is primarily a discovery mechanism.

Its result should be interpreted as:

- `0` mismatches: no discovered failures in sampled space
- `>0` mismatches: at least one discovered counterexample, requiring triage

Random eval should not hide discovered mismatches behind aggregate percentages alone.

---

## 7. Operational Rules

### 7.1 Preserve One-Command Reproducibility

Any reported eval artifact should be reproducible from a single documented command plus its versioned inputs.

### 7.2 Prefer Bounded Diagnostics Before Full Sweeps

When debugging:

- use mismatch corpora first
- then hotspot windows
- then broader heavy sweeps

Do not default to full-range heavy reruns for every hypothesis.

### 7.3 One Row Type, One Stream

All result rows go to stdout as ndjson.
Aggregations and summaries are derived by consumers (`grep`, `jq`, etc.), not emitted by the tool.
Do not split output across multiple files or row types within a single tool.

### 7.4 Make Interrupted Runs Useful

If a run is stopped midway, the partial outputs should still answer:

- which points were evaluated
- whether mismatches were found
- where to resume

That information should be derivable from the emitted rows themselves (via `sampleIndex`), not from a separate state file or terminal marker.

---

## 8. Current Repository Mapping

Current tooling in this repository maps to this spec as follows:

- `astro/src/cli/eval-cairo-engine.js`
  - structured light/heavy window sweeps
- `astro/src/cli/eval-random-cairo-engine.js`
  - random evaluation with stdout ndjson output, resumable via `--start-index` / `--end-index`
- `astro/src/cli/eval-mismatch-corpus.js`
  - deterministic regression corpus gate
- `astro/src/cli/build-mismatch-corpus.js`
  - corpus construction from discovered failures
- `astro/src/cli/analyze-mismatch-log.js`
  - mismatch aggregation and diagnostic reporting
- `cairo/scripts/compare-v5-chart-parity.js`
  - targeted parity checks against oracle-generated expectations

---

## 9. Recommended Workflow

For most engine changes:

1. Run local unit tests.
2. Run corpus gate.
3. Run light eval.
4. Run targeted hotspot or mismatch-window checks if needed.
5. Run heavy or random eval only when the earlier gates are clean or when doing milestone measurement.

For long unattended validation:

1. Start random evaluation, piping stdout to an ndjson file.
2. If interrupted, inspect the output for the highest `sampleIndex`.
3. Re-run with `--start-index` covering the gap, appending to the same file.

---

## 10. Future Extensions

Likely future additions:

- CI-specific reduced eval profile
- standardized artifact naming convention
- machine-readable manifest for milestone baselines
- chunk-merging utilities for distributed or multi-session runs
- explicit stage-level diagnostic schema for vector/frame drift analysis

Until then, new eval tooling should conform to the principles in this document rather than inventing ad hoc output formats.
