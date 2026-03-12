#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT_DIR"

STAMP="20260307T180928Z"
LOG_DIR="astro/evals/logs"
OUT_DIR="astro/evals"
MASTER_LOG="$LOG_DIR/v5-heavy-baseline-full-$STAMP.log"

run_range() {
  local start_year="$1"
  local end_year="$2"
  local out_file="$OUT_DIR/v5-heavy-baseline-${start_year}-${end_year}-${STAMP}.ndjson"

  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] START range=${start_year}-${end_year} out=${out_file}" | tee -a "$MASTER_LOG"
  node astro/src/cli/eval-cairo-engine.js \
    --profile heavy \
    --engine v5 \
    --start-year "$start_year" \
    --end-year "$end_year" \
    --batch-size 20 \
    --quiet | tee "$out_file"
  local rc=${PIPESTATUS[0]}
  if [[ $rc -ne 0 ]]; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] FAIL range=${start_year}-${end_year} exit=${rc}" | tee -a "$MASTER_LOG"
    exit "$rc"
  fi
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] DONE range=${start_year}-${end_year}" | tee -a "$MASTER_LOG"
}

# Phase 1: 1201-4000
for start in $(seq 1201 100 4000); do
  end=$((start + 99))
  if [[ $end -gt 4000 ]]; then end=4000; fi
  run_range "$start" "$end"
done

# Phase 2: 0001-1000
for start in $(seq 1 100 1000); do
  end=$((start + 99))
  if [[ $end -gt 1000 ]]; then end=1000; fi
  run_range "$start" "$end"
done

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ALL_DONE stamp=${STAMP}" | tee -a "$MASTER_LOG"
