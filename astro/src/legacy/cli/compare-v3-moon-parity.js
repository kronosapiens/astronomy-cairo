#!/usr/bin/env node
import fs from "node:fs";
import * as Astronomy from "astronomy-engine";
import { getNumberArg, parseArgs, requireStringArg } from "../../cli/args.js";
import { EPOCH_1900_UNIX_MS } from "../../oracle/corpus.js";
import { moonParityRow, moonParityRowDetailed } from "../oracle/v3-moon-model.js";

function parseDate(value, key) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new Error(`Invalid --${key}: ${value}`);
  }
  return ms;
}

function toMinuteSince1900(unixMs) {
  return Math.floor((unixMs - EPOCH_1900_UNIX_MS) / 60_000);
}

function buildReplayMinutes(centers, quantizeMinutes, replayWindowMinutes, replayStepMinutes) {
  const out = new Set();
  for (const center of centers) {
    for (let dt = -replayWindowMinutes; dt <= replayWindowMinutes; dt += replayStepMinutes) {
      const m = Math.floor((center + dt) / quantizeMinutes) * quantizeMinutes;
      out.add(m);
    }
  }
  return [...out].sort((a, b) => a - b);
}

function getBooleanArg(args, key, fallback = false) {
  const value = args[key];
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error(`Invalid boolean argument --${key}=${value}`);
}

function main() {
  const t0 = Date.now();
  const args = parseArgs(process.argv.slice(2));

  const start = parseDate(requireStringArg(args, "start"), "start");
  const end = parseDate(requireStringArg(args, "end"), "end");
  if (start > end) {
    throw new Error("--start must be <= --end");
  }

  const stepMinutes = getNumberArg(args, "step-minutes", 60);
  const quantizeMinutes = getNumberArg(args, "quantize-minutes", 15);
  const mismatchLimit = getNumberArg(args, "mismatch-limit", 100);
  const replayFromPath = typeof args["replay-from"] === "string" ? args["replay-from"] : null;
  const replayWindowMinutes = getNumberArg(args, "replay-window-minutes", 240);
  const replayStepMinutes = getNumberArg(args, "replay-step-minutes", quantizeMinutes);
  const detailed = getBooleanArg(args, "detailed", false);
  const instabilityDeltaTSec = getNumberArg(args, "instability-delta-t-sec", 1.0);
  const outPath = typeof args.out === "string" ? args.out : null;

  const mismatchRows = [];
  let mismatchCount = 0;
  let unstableCount = 0;
  let firstUnstableRow = null;
  let samples = 0;

  const replayCenters = [];
  if (replayFromPath) {
    const replaySource = JSON.parse(fs.readFileSync(replayFromPath, "utf8"));
    for (const row of replaySource.mismatchRows || []) {
      if (Number.isFinite(row.minuteSince1900)) replayCenters.push(row.minuteSince1900);
    }
  }

  const replayMinutes =
    replayCenters.length > 0
      ? buildReplayMinutes(replayCenters, quantizeMinutes, replayWindowMinutes, replayStepMinutes)
      : null;

  let semanticMismatchCount = 0;
  let fixedVsSemanticSignDiffCount = 0;
  let fixedSemanticAbsDeltaSum = 0;

  const runSample = (minute) => {
    const qMinute = Math.floor(minute / quantizeMinutes) * quantizeMinutes;
    const qMs = EPOCH_1900_UNIX_MS + qMinute * 60_000;
    const oracleLonDeg = Astronomy.EclipticGeoMoon(new Date(qMs)).lon;

    const row = (detailed ? moonParityRowDetailed : moonParityRow)({
      minuteSince1900: minute,
      quantizeMinutes,
      oracleLonDeg,
    });

    // Large absolute delta_t values are expected in ancient/future epochs.
    // "Unstable" here means fixed-point runtime diverges from semantic mirror.
    if (detailed) {
      const deltaTDrift = Math.abs(row.stageDeltas.deltaTSec);
      if (!Number.isFinite(deltaTDrift) || deltaTDrift > instabilityDeltaTSec) {
        unstableCount += 1;
        if (firstUnstableRow === null) {
          firstUnstableRow = {
            timestampUtc: new Date(qMs).toISOString(),
            minuteSince1900: qMinute,
            deltaTSec: row.diagnostics.deltaTSec,
            semanticDeltaTSec: row.diagnostics.deltaTSec - row.stageDeltas.deltaTSec,
            deltaTDrift,
          };
        }
      }
    }

    if (row.mismatch) {
      mismatchCount += 1;
    }
    const semanticSignDiffOracle = detailed ? row.semanticSign !== row.oracleSign : false;
    const semanticSignDiffFixed = detailed ? row.semanticSign !== row.modelSign : false;
    if (semanticSignDiffOracle) semanticMismatchCount += 1;
    if (semanticSignDiffFixed) fixedVsSemanticSignDiffCount += 1;
    if (detailed) fixedSemanticAbsDeltaSum += Math.abs(row.fixedMinusSemanticDeg);

    const rowInteresting = row.mismatch || semanticSignDiffOracle || semanticSignDiffFixed;
    if (rowInteresting) {
      if (mismatchRows.length < mismatchLimit) {
        mismatchRows.push({
          timestampUtc: new Date(qMs).toISOString(),
          ...row,
        });
      }
    }

    samples += 1;
  };

  if (replayMinutes) {
    for (const minute of replayMinutes) {
      runSample(minute);
    }
  } else {
    for (let t = start; t <= end; t += stepMinutes * 60_000) {
      runSample(toMinuteSince1900(t));
    }
  }

  const summary = {
    detailed,
    mode: replayMinutes ? "replay" : "sweep",
    samples,
    mismatchCount,
    mismatchRate: samples === 0 ? 0 : mismatchCount / samples,
    semanticMismatchCount: detailed ? semanticMismatchCount : null,
    semanticMismatchRate: detailed ? (samples === 0 ? 0 : semanticMismatchCount / samples) : null,
    fixedVsSemanticSignDiffCount: detailed ? fixedVsSemanticSignDiffCount : null,
    meanAbsFixedSemanticDeltaDeg: detailed ? (samples === 0 ? 0 : fixedSemanticAbsDeltaSum / samples) : null,
    stepMinutes,
    quantizeMinutes,
    replayFromPath,
    replayWindowMinutes: replayMinutes ? replayWindowMinutes : null,
    replayStepMinutes: replayMinutes ? replayStepMinutes : null,
    replayCenterCount: replayMinutes ? replayCenters.length : null,
    unstableCount: detailed ? unstableCount : null,
    firstUnstableRow: detailed ? firstUnstableRow : null,
    instabilityDeltaTSec: detailed ? instabilityDeltaTSec : null,
    range: {
      startUtc: new Date(start).toISOString(),
      endUtc: new Date(end).toISOString(),
    },
    runtimeMs: Date.now() - t0,
    mismatchRows,
  };

  if (outPath) {
    fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  }

  console.log(JSON.stringify(summary, null, 2));
}

main();
