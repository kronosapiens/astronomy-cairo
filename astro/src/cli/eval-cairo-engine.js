#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs, getNumberArg, getStringArg } from "./args.js";
import { oracleAscSign, oraclePlanetSign } from "../engine.js";

const ENGINE_CONFIG = {
  v5: { id: 5, startYear: 1, endYear: 4000 },
};

const NYC = { name: "NYC", latBin: 407, lonBin: -740 };
const ALEXANDRIA = { name: "Alexandria", latBin: 312, lonBin: 299 };
const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(CLI_DIR, "..", "..", "..");
const CAIRO_DIR = path.join(REPO_ROOT, "cairo");

function runScarb(args, cwd) {
  const scarbBin = process.env.SCARB_BIN || "scarb";
  return execFileSync(scarbBin, args.map(String), {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function makeUtcDate(year, month, day) {
  const dt = new Date(Date.UTC(0, month - 1, day, 0, 0, 0));
  dt.setUTCFullYear(year);
  return dt;
}

const EPOCH_PG_MS = makeUtcDate(1, 1, 1).getTime();

function minuteSincePg(unixMs) {
  return Math.floor((unixMs - EPOCH_PG_MS) / 60_000);
}

function computeExpectedSignsForPoint(unixMs, latBin, lonBin) {
  const planetSigns = [
    oraclePlanetSign("Sun", unixMs),
    oraclePlanetSign("Moon", unixMs),
    oraclePlanetSign("Mercury", unixMs),
    oraclePlanetSign("Venus", unixMs),
    oraclePlanetSign("Mars", unixMs),
    oraclePlanetSign("Jupiter", unixMs),
    oraclePlanetSign("Saturn", unixMs),
  ];
  const asc = oracleAscSign(unixMs, latBin, lonBin);
  return [...planetSigns, asc];
}

function parseReturnArray(rawOutput) {
  const marker = "returning";
  const idx = rawOutput.lastIndexOf(marker);
  if (idx < 0) {
    throw new Error(`Could not parse cairo-run output: missing '${marker}' marker`);
  }
  const start = rawOutput.indexOf("[", idx);
  const end = rawOutput.lastIndexOf("]");
  if (start < 0 || end < 0 || end < start) {
    throw new Error("Could not parse cairo-run output array");
  }
  return JSON.parse(rawOutput.slice(start, end + 1));
}

function runCairoBatch({ engineId, packedPoints, expectedPacked, noBuild }) {
  const argsPayload = [engineId, packedPoints, expectedPacked];
  const tmpPath = path.join(os.tmpdir(), `eval_batch_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}.json`);
  fs.writeFileSync(tmpPath, `${JSON.stringify(argsPayload)}\n`, "utf8");

  try {
    const cmdArgs = [
      "cairo-run",
      "-p",
      "astronomy_engine_eval_runner",
      "--function",
      "eval_batch_fail_breakdown",
      "--arguments-file",
      tmpPath,
    ];
    if (noBuild) cmdArgs.push("--no-build");

    const out = runScarb(cmdArgs, CAIRO_DIR);
    const values = parseReturnArray(out).map((x) => Number(x));
    if (values.length !== 10) {
      throw new Error(`Unexpected cairo-run return shape: expected 10 values, got ${values.length}`);
    }
    return {
      failCount: values[0],
      planetFailCount: values[1],
      ascFailCount: values[2],
      sunFailCount: values[3],
      moonFailCount: values[4],
      mercuryFailCount: values[5],
      venusFailCount: values[6],
      marsFailCount: values[7],
      jupiterFailCount: values[8],
      saturnFailCount: values[9],
    };
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
}

function runCairoPointMismatchMask({ engineId, minutePg, latBin, lonBin, expectedSigns, noBuild }) {
  const argsPayload = [engineId, minutePg, latBin, lonBin, expectedSigns];
  const tmpPath = path.join(os.tmpdir(), `eval_point_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}.json`);
  fs.writeFileSync(tmpPath, `${JSON.stringify(argsPayload)}\n`, "utf8");

  try {
    const cmdArgs = [
      "cairo-run",
      "-p",
      "astronomy_engine_eval_runner",
      "--function",
      "eval_point_mismatch_mask",
      "--arguments-file",
      tmpPath,
    ];
    if (noBuild) cmdArgs.push("--no-build");
    const out = runScarb(cmdArgs, CAIRO_DIR);
    const values = parseReturnArray(out).map((x) => Number(x));
    if (values.length !== 1) {
      throw new Error(`Unexpected point mismatch return shape: expected 1 value, got ${values.length}`);
    }
    return values[0];
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
}

function sliceBatchPayload(pointData, expectedData, startPointIdx, endPointIdxExclusive) {
  const pointStart = startPointIdx * 3;
  const pointEnd = endPointIdxExclusive * 3;
  const expectedStart = startPointIdx * 8;
  const expectedEnd = endPointIdxExclusive * 8;
  return {
    pointSlice: pointData.slice(pointStart, pointEnd),
    expectedSlice: expectedData.slice(expectedStart, expectedEnd),
  };
}

function collectMismatchRowsForBatch({
  engineId,
  engine,
  profile,
  batchMeta,
  batchPointData,
  batchExpected,
  rootBreakdown,
  noBuild,
}) {
  const mismatchRows = [];
  const breakdownCache = new Map();
  breakdownCache.set(`0:${batchMeta.length}`, rootBreakdown);
  let pointMaskCalls = 0;
  let subsetBatchCalls = 0;

  const getBreakdown = (startPointIdx, endPointIdxExclusive) => {
    const key = `${startPointIdx}:${endPointIdxExclusive}`;
    const cached = breakdownCache.get(key);
    if (cached) return cached;
    const { pointSlice, expectedSlice } = sliceBatchPayload(
      batchPointData,
      batchExpected,
      startPointIdx,
      endPointIdxExclusive,
    );
    const result = runCairoBatch({
      engineId,
      packedPoints: pointSlice,
      expectedPacked: expectedSlice,
      noBuild,
    });
    subsetBatchCalls += 1;
    breakdownCache.set(key, result);
    return result;
  };

  const recurse = (startPointIdx, endPointIdxExclusive) => {
    const pointCount = endPointIdxExclusive - startPointIdx;
    if (pointCount <= 0) return;

    const breakdown = getBreakdown(startPointIdx, endPointIdxExclusive);
    if (breakdown.failCount === 0) return;

    if (pointCount === 1) {
      const idx = startPointIdx;
      const meta = batchMeta[idx];
      const expectedSigns = batchExpected.slice(idx * 8, idx * 8 + 8);
      const mask = runCairoPointMismatchMask({
        engineId,
        minutePg: meta.minutePg,
        latBin: meta.latBin,
        lonBin: meta.lonBin,
        expectedSigns,
        noBuild,
      });
      pointMaskCalls += 1;
      if (!Number.isInteger(mask) || mask < 0 || mask > 255) {
        throw new Error(`Unexpected point mismatch mask at index ${idx}: ${mask}`);
      }
      if (mask !== 0) {
        mismatchRows.push(JSON.stringify({
          tsUtc: new Date().toISOString(),
          engine,
          profile,
          year: meta.year,
          month: meta.month,
          location: meta.location,
          latBin: meta.latBin,
          lonBin: meta.lonBin,
          minutePg: meta.minutePg,
          mismatchMask: mask,
          planetMismatch: (mask & 0x7f) !== 0,
          ascMismatch: (mask & 0x80) !== 0,
        }));
      }
      return;
    }

    const mid = startPointIdx + Math.floor(pointCount / 2);
    recurse(startPointIdx, mid);
    recurse(mid, endPointIdxExclusive);
  };

  recurse(0, batchMeta.length);
  return { mismatchRows, pointMaskCalls, subsetBatchCalls };
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const engine = getStringArg(args, "engine", "v5").toLowerCase();
  const profile = getStringArg(args, "profile", "light").toLowerCase();
  const batchYears = getNumberArg(args, "batch-size", 20);
  const maxPointsPerBatch = getNumberArg(args, "max-batch", 2500);
  const logEveryChunks = getNumberArg(args, "log-every-chunks", 5);
  const quiet = Boolean(args.quiet);
  const failOnMismatch = Boolean(args["fail-on-mismatch"]);
  const mismatchLogPath = args["mismatch-log"] ? String(args["mismatch-log"]) : null;
  const log = (line) => {
    if (!quiet) process.stderr.write(`[eval-cairo-engine] ${line}\n`);
  };
  if (Object.hasOwn(args, "end-year-exclusive")) {
    throw new Error("Flag --end-year-exclusive has been removed. Use --end-year (inclusive) instead.");
  }

  if (!ENGINE_CONFIG[engine]) {
    throw new Error(`Unsupported --engine=${engine}; expected one of ${Object.keys(ENGINE_CONFIG).join(", ")}`);
  }
  if (profile !== "light" && profile !== "heavy") {
    throw new Error(`Unsupported --profile=${profile}; expected 'light' or 'heavy'`);
  }
  if (!Number.isInteger(batchYears) || batchYears <= 0) {
    throw new Error(`Invalid --batch-size=${batchYears}; expected a positive integer number of years per batch`);
  }
  if (!Number.isInteger(maxPointsPerBatch) || maxPointsPerBatch <= 0) {
    throw new Error(
      `Invalid --max-batch=${maxPointsPerBatch}; expected a positive integer`,
    );
  }

  const capability = ENGINE_CONFIG[engine];
  const startYear = getNumberArg(args, "start-year", capability.startYear);
  const endYear = getNumberArg(args, "end-year", capability.endYear);
  const locations = profile === "heavy" ? [NYC, ALEXANDRIA] : [NYC];
  const months = profile === "heavy" ? 12 : 1;
  const pointsPerYear = months * locations.length;
  const requestedPointsPerBatch = batchYears * pointsPerYear;
  if (requestedPointsPerBatch > maxPointsPerBatch) {
    const suggestedBatchYears = Math.max(1, Math.floor(maxPointsPerBatch / pointsPerYear));
    throw new Error(
      `Requested batch is too large: ${requestedPointsPerBatch} points per batch (batchYears=${batchYears}, months=${months}, locations=${locations.length}). ` +
      `Lower --batch-size to <= ${suggestedBatchYears} or increase --max-batch.`,
    );
  }
  const totalYears = endYear - startYear + 1;
  const totalPoints = totalYears * months * locations.length;
  if (
    !Number.isInteger(startYear) ||
    !Number.isInteger(endYear) ||
    startYear > endYear
  ) {
    throw new Error(`Invalid year range start=${startYear} end=${endYear}`);
  }
  if (startYear < capability.startYear || endYear > capability.endYear) {
    throw new Error(
      `Engine ${engine} supports years [${capability.startYear}, ${capability.endYear}] (inclusive); requested [${startYear}, ${endYear}]`,
    );
  }

  // Compile once; subsequent runs use --no-build to reduce process overhead.
  const buildStart = Date.now();
  log(`Building astronomy_engine_eval_runner before evaluation...`);
  runScarb(["build", "-p", "astronomy_engine_eval_runner"], CAIRO_DIR);
  log(`Build complete in ${formatDuration(Date.now() - buildStart)}.`);

  let failCount = 0;
  let planetFailCount = 0;
  let ascFailCount = 0;
  let sunFailCount = 0;
  let moonFailCount = 0;
  let mercuryFailCount = 0;
  let venusFailCount = 0;
  let marsFailCount = 0;
  let jupiterFailCount = 0;
  let saturnFailCount = 0;
  let processedYears = 0;
  let processedBatches = 0;
  const runStart = Date.now();
  log(
    `Starting eval: engine=${engine}, profile=${profile}, years=[${startYear}, ${endYear}] inclusive, totalPoints=${totalPoints}, batchYears=${batchYears}.`,
  );
  const emit = (record) => {
    console.log(JSON.stringify(record));
  };
  for (let batchStartYear = startYear; batchStartYear <= endYear; batchStartYear += batchYears) {
    const batchEndYear = Math.min(batchStartYear + batchYears - 1, endYear);
    let batchPointData = [];
    let batchExpected = [];
    let batchMeta = [];
    let batchPointCount = 0;

    for (let year = batchStartYear; year <= batchEndYear; year += 1) {
      for (let month = 1; month <= months; month += 1) {
        const dt = makeUtcDate(year, month, 1);
        const unixMs = dt.getTime();
        const minutePg = minuteSincePg(unixMs);
        const sampleUnixMs = EPOCH_PG_MS + minutePg * 60_000;

        for (const loc of locations) {
          batchPointData.push(minutePg, loc.latBin, loc.lonBin);
          const signs = computeExpectedSignsForPoint(sampleUnixMs, loc.latBin, loc.lonBin);
          batchExpected.push(
            signs[0],
            signs[1],
            signs[2],
            signs[3],
            signs[4],
            signs[5],
            signs[6],
            signs[7],
          );
          batchMeta.push({
            year,
            month,
            location: loc.name,
            latBin: loc.latBin,
            lonBin: loc.lonBin,
            minutePg,
          });
          batchPointCount += 1;
        }
      }
    }

    const batchResult = runCairoBatch({
      engineId: capability.id,
      packedPoints: batchPointData,
      expectedPacked: batchExpected,
      noBuild: true,
    });
    if (
      !Number.isInteger(batchResult.failCount) ||
      !Number.isInteger(batchResult.planetFailCount) ||
      !Number.isInteger(batchResult.ascFailCount) ||
      !Number.isInteger(batchResult.sunFailCount) ||
      !Number.isInteger(batchResult.moonFailCount) ||
      !Number.isInteger(batchResult.mercuryFailCount) ||
      !Number.isInteger(batchResult.venusFailCount) ||
      !Number.isInteger(batchResult.marsFailCount) ||
      !Number.isInteger(batchResult.jupiterFailCount) ||
      !Number.isInteger(batchResult.saturnFailCount) ||
      batchResult.failCount < 0 ||
      batchResult.failCount > batchPointCount ||
      batchResult.planetFailCount < 0 ||
      batchResult.planetFailCount > batchPointCount ||
      batchResult.ascFailCount < 0 ||
      batchResult.ascFailCount > batchPointCount ||
      batchResult.sunFailCount < 0 ||
      batchResult.sunFailCount > batchPointCount ||
      batchResult.moonFailCount < 0 ||
      batchResult.moonFailCount > batchPointCount ||
      batchResult.mercuryFailCount < 0 ||
      batchResult.mercuryFailCount > batchPointCount ||
      batchResult.venusFailCount < 0 ||
      batchResult.venusFailCount > batchPointCount ||
      batchResult.marsFailCount < 0 ||
      batchResult.marsFailCount > batchPointCount ||
      batchResult.jupiterFailCount < 0 ||
      batchResult.jupiterFailCount > batchPointCount ||
      batchResult.saturnFailCount < 0 ||
      batchResult.saturnFailCount > batchPointCount
    ) {
      throw new Error(`Unexpected batch breakdown from Cairo runner: ${JSON.stringify(batchResult)}`);
    }

    const batchFailCount = batchResult.failCount;
    const batchPlanetFailCount = batchResult.planetFailCount;
    const batchAscFailCount = batchResult.ascFailCount;
    const batchSunFailCount = batchResult.sunFailCount;
    const batchMoonFailCount = batchResult.moonFailCount;
    const batchMercuryFailCount = batchResult.mercuryFailCount;
    const batchVenusFailCount = batchResult.venusFailCount;
    const batchMarsFailCount = batchResult.marsFailCount;
    const batchJupiterFailCount = batchResult.jupiterFailCount;
    const batchSaturnFailCount = batchResult.saturnFailCount;

    if (mismatchLogPath && batchFailCount > 0) {
      log(
        `Generating mismatch details for years ${batchStartYear}-${batchEndYear} with recursive isolation...`,
      );
      const { mismatchRows, pointMaskCalls, subsetBatchCalls } = collectMismatchRowsForBatch({
        engineId: capability.id,
        engine,
        profile,
        batchMeta,
        batchPointData,
        batchExpected,
        rootBreakdown: batchResult,
        noBuild: true,
      });
      if (mismatchRows.length > 0) {
        fs.appendFileSync(mismatchLogPath, `${mismatchRows.join("\n")}\n`, "utf8");
      }
      log(
        `Mismatch details for ${batchStartYear}-${batchEndYear}: rows=${mismatchRows.length}, subsetChecks=${subsetBatchCalls}, pointMasks=${pointMaskCalls}.`,
      );
    }

    processedBatches += 1;
    processedYears += batchEndYear - batchStartYear + 1;
    failCount += batchFailCount;
    planetFailCount += batchPlanetFailCount;
    ascFailCount += batchAscFailCount;
    sunFailCount += batchSunFailCount;
    moonFailCount += batchMoonFailCount;
    mercuryFailCount += batchMercuryFailCount;
    venusFailCount += batchVenusFailCount;
    marsFailCount += batchMarsFailCount;
    jupiterFailCount += batchJupiterFailCount;
    saturnFailCount += batchSaturnFailCount;
    const elapsedMs = Date.now() - runStart;
    const batchPassCount = batchPointCount - batchFailCount;

    emit({
      tsUtc: new Date().toISOString(),
      engine,
      profile,
      yearStart: batchStartYear,
      yearEnd: batchEndYear,
      passCount: batchPassCount,
      failCount: batchFailCount,
      planetFailCount: batchPlanetFailCount,
      ascFailCount: batchAscFailCount,
      sunFailCount: batchSunFailCount,
      moonFailCount: batchMoonFailCount,
      mercuryFailCount: batchMercuryFailCount,
      venusFailCount: batchVenusFailCount,
      marsFailCount: batchMarsFailCount,
      jupiterFailCount: batchJupiterFailCount,
      saturnFailCount: batchSaturnFailCount,
      elapsedMs,
    });

    if (processedBatches % logEveryChunks === 0 || processedYears === totalYears) {
      const progress = totalYears > 0 ? processedYears / totalYears : 1;
      const estTotalMs = progress > 0 ? elapsedMs / progress : 0;
      const etaMs = Math.max(0, estTotalMs - elapsedMs);
      log(
        `Progress years ${processedYears}/${totalYears} (${(progress * 100).toFixed(2)}%), fail=${failCount} (planet=${planetFailCount}, asc=${ascFailCount}, s=${sunFailCount}, m=${moonFailCount}, me=${mercuryFailCount}, v=${venusFailCount}, ma=${marsFailCount}, j=${jupiterFailCount}, sa=${saturnFailCount}), elapsed=${formatDuration(elapsedMs)}, eta=${formatDuration(etaMs)}.`,
      );
    }
  }

  if (failOnMismatch && failCount > 0) {
    process.exit(1);
  }
}

main();
