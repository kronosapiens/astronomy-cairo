#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, getNumberArg, getStringArg } from "./args.js";
import { oracleAscLongitude, oracleAscSign, oraclePlanetLongitude, oraclePlanetSign } from "../engine.js";
import {
  EPOCH_PG_MS,
  makeUtcDate,
  minuteSincePg,
  parseReturnArray,
  runCairoBatch,
  runCairoPointLongitudes,
  runCairoPointMismatchDetail,
  runScarb,
} from "./lib/eval-core.js";
import {
  makeStructuredMismatchRow,
  makeWindowSummaryRow,
} from "./lib/eval-rows.js";

const SUPPORTED_START_YEAR = 1;
const SUPPORTED_END_YEAR = 4000;

const NYC = { name: "NYC", latBin: 4070, lonBin: -7400 };
const ALEXANDRIA = { name: "Alexandria", latBin: 3120, lonBin: 2990 };
const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(CLI_DIR, "..", "..", "..");
const CAIRO_DIR = path.join(REPO_ROOT, "cairo", "crates", "research");

function buildBatchPayload({
  batchStartYear,
  batchEndYear,
  months,
  locations,
  computeExpectedSignsForPointFn = computeExpectedSignsForPoint,
}) {
  const batchPointData = [];
  const batchExpected = [];
  const batchMeta = [];
  let batchPointCount = 0;

  for (let year = batchStartYear; year <= batchEndYear; year += 1) {
    for (let month = 1; month <= months; month += 1) {
      const dt = makeUtcDate(year, month, 1);
      const unixMs = dt.getTime();
      const minutePg = minuteSincePg(unixMs);
      const sampleUnixMs = EPOCH_PG_MS + minutePg * 60_000;

      for (const loc of locations) {
        batchPointData.push(minutePg, loc.latBin, loc.lonBin);
        const signs = computeExpectedSignsForPointFn(sampleUnixMs, loc.latBin, loc.lonBin);
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

  return { batchPointData, batchExpected, batchMeta, batchPointCount };
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

function zeroBreakdown() {
  return {
    failCount: 0,
    planetFailCount: 0,
    ascFailCount: 0,
    sunFailCount: 0,
    moonFailCount: 0,
    mercuryFailCount: 0,
    venusFailCount: 0,
    marsFailCount: 0,
    jupiterFailCount: 0,
    saturnFailCount: 0,
  };
}

function addBreakdownTotals(target, source) {
  target.failCount += source.failCount;
  target.planetFailCount += source.planetFailCount;
  target.ascFailCount += source.ascFailCount;
  target.sunFailCount += source.sunFailCount;
  target.moonFailCount += source.moonFailCount;
  target.mercuryFailCount += source.mercuryFailCount;
  target.venusFailCount += source.venusFailCount;
  target.marsFailCount += source.marsFailCount;
  target.jupiterFailCount += source.jupiterFailCount;
  target.saturnFailCount += source.saturnFailCount;
  return target;
}

function validateBreakdown(breakdown, pointCount) {
  if (
    !Number.isInteger(breakdown.failCount) ||
    !Number.isInteger(breakdown.planetFailCount) ||
    !Number.isInteger(breakdown.ascFailCount) ||
    !Number.isInteger(breakdown.sunFailCount) ||
    !Number.isInteger(breakdown.moonFailCount) ||
    !Number.isInteger(breakdown.mercuryFailCount) ||
    !Number.isInteger(breakdown.venusFailCount) ||
    !Number.isInteger(breakdown.marsFailCount) ||
    !Number.isInteger(breakdown.jupiterFailCount) ||
    !Number.isInteger(breakdown.saturnFailCount) ||
    breakdown.failCount < 0 ||
    breakdown.failCount > pointCount ||
    breakdown.planetFailCount < 0 ||
    breakdown.planetFailCount > pointCount ||
    breakdown.ascFailCount < 0 ||
    breakdown.ascFailCount > pointCount ||
    breakdown.sunFailCount < 0 ||
    breakdown.sunFailCount > pointCount ||
    breakdown.moonFailCount < 0 ||
    breakdown.moonFailCount > pointCount ||
    breakdown.mercuryFailCount < 0 ||
    breakdown.mercuryFailCount > pointCount ||
    breakdown.venusFailCount < 0 ||
    breakdown.venusFailCount > pointCount ||
    breakdown.marsFailCount < 0 ||
    breakdown.marsFailCount > pointCount ||
    breakdown.jupiterFailCount < 0 ||
    breakdown.jupiterFailCount > pointCount ||
    breakdown.saturnFailCount < 0 ||
    breakdown.saturnFailCount > pointCount
  ) {
    throw new Error(`Unexpected batch breakdown from Cairo runner: ${JSON.stringify(breakdown)}`);
  }
}

function runWindowBreakdown({
  batchPointData,
  batchExpected,
  batchPointCount,
  pointsPerBatch,
  noBuild,
  runCairoBatchFn = runCairoBatch,
}) {
  if (pointsPerBatch >= batchPointCount) {
    return runCairoBatchFn({
      packedPoints: batchPointData,
      expectedPacked: batchExpected,
      noBuild,
      cairoDir: CAIRO_DIR,
    });
  }

  const totals = zeroBreakdown();
  for (let startPointIdx = 0; startPointIdx < batchPointCount; startPointIdx += pointsPerBatch) {
    const endPointIdxExclusive = Math.min(startPointIdx + pointsPerBatch, batchPointCount);
    const { pointSlice, expectedSlice } = sliceBatchPayload(
      batchPointData,
      batchExpected,
      startPointIdx,
      endPointIdxExclusive,
    );
    const chunk = runCairoBatchFn({
      packedPoints: pointSlice,
      expectedPacked: expectedSlice,
      noBuild,
      cairoDir: CAIRO_DIR,
    });
    validateBreakdown(chunk, endPointIdxExclusive - startPointIdx);
    addBreakdownTotals(totals, chunk);
  }

  return totals;
}

function collectMismatchRowsForBatch({
  locationSet,
  monthsPerYear,
  batchMeta,
  batchPointData,
  batchExpected,
  rootBreakdown,
  noBuild,
  runCairoBatchFn = runCairoBatch,
  runCairoPointMismatchDetailFn = runCairoPointMismatchDetail,
  oraclePlanetLongitudeFn = oraclePlanetLongitude,
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
    const result = runCairoBatchFn({
      packedPoints: pointSlice,
      expectedPacked: expectedSlice,
      noBuild,
      cairoDir: CAIRO_DIR,
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
      const detail = runCairoPointMismatchDetailFn({
          minutePg: meta.minutePg,
        latBin: meta.latBin,
        lonBin: meta.lonBin,
        expectedSigns,
        noBuild,
        cairoDir: CAIRO_DIR,
      });
      pointMaskCalls += 1;
      const mask = detail.mask;
      if (!Number.isInteger(mask) || mask < 0 || mask > 255) {
        throw new Error(`Unexpected point mismatch mask at index ${idx}: ${mask}`);
      }
      if (detail.actualSigns.length !== 8 || !detail.actualSigns.every((x) => Number.isInteger(x))) {
        throw new Error(`Unexpected point actual signs at index ${idx}: ${JSON.stringify(detail.actualSigns)}`);
      }
      if (
        detail.actualLongitudes1e9.length !== 7
        || !detail.actualLongitudes1e9.every((x) => Number.isInteger(x))
      ) {
        throw new Error(`Unexpected point actual longitudes at index ${idx}: ${JSON.stringify(detail.actualLongitudes1e9)}`);
      }
      if (mask !== 0) {
        const pointUnixMs = EPOCH_PG_MS + meta.minutePg * 60_000;
        const oracleLongitudesDeg = [
          oraclePlanetLongitudeFn("Sun", pointUnixMs),
          oraclePlanetLongitudeFn("Moon", pointUnixMs),
          oraclePlanetLongitudeFn("Mercury", pointUnixMs),
          oraclePlanetLongitudeFn("Venus", pointUnixMs),
          oraclePlanetLongitudeFn("Mars", pointUnixMs),
          oraclePlanetLongitudeFn("Jupiter", pointUnixMs),
          oraclePlanetLongitudeFn("Saturn", pointUnixMs),
        ];
        mismatchRows.push(makeStructuredMismatchRow({
          locationSet,
          monthsPerYear,
          year: meta.year,
          month: meta.month,
          location: meta.location,
          latBin: meta.latBin,
          lonBin: meta.lonBin,
          minutePg: meta.minutePg,
          expectedSigns,
          actualSigns: detail.actualSigns,
          actualLongitudes1e9: detail.actualLongitudes1e9,
          oracleLongitudesDeg,
          mismatchMask: mask,
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

const BODY_NAMES = ["sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn", "asc"];

function angularErrorDeg(cairoLon1e9, oracleLonDeg) {
  const cairoDeg = cairoLon1e9 / 1e9;
  let err = Math.abs(cairoDeg - oracleLonDeg) % 360;
  if (err > 180) err = 360 - err;
  return err;
}

function computeOracleLongitudes(unixMs, latBin, lonBin) {
  return [
    oraclePlanetLongitude("Sun", unixMs),
    oraclePlanetLongitude("Moon", unixMs),
    oraclePlanetLongitude("Mercury", unixMs),
    oraclePlanetLongitude("Venus", unixMs),
    oraclePlanetLongitude("Mars", unixMs),
    oraclePlanetLongitude("Jupiter", unixMs),
    oraclePlanetLongitude("Saturn", unixMs),
    oracleAscLongitude(unixMs, latBin, lonBin),
  ];
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

function locationSetId(locations) {
  return locations.map((loc) => loc.name).join("+");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const logEveryChunks = getNumberArg(args, "log-every-chunks", 5);
  const quiet = Boolean(args.quiet);
  const mode = getStringArg(args, "mode", "signs");
  if (mode !== "signs" && mode !== "precision") {
    throw new Error(`--mode must be "signs" or "precision"`);
  }
  const failOnMismatch = Boolean(args["fail-on-mismatch"]);
  const log = (line) => {
    if (!quiet) process.stderr.write(`[eval-cairo-engine] ${line}\n`);
  };

  const startYear = getNumberArg(args, "start-year", NaN);
  const endYear = getNumberArg(args, "end-year", NaN);
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear)) {
    throw new Error("--start-year and --end-year are required");
  }
  const locations = [NYC, ALEXANDRIA];
  const locationSet = locationSetId(locations);
  const months = 12;
  const pointsPerYear = months * locations.length;
  const batchYears = 1;
  const pointsPerBatch = pointsPerYear;
  const totalYears = endYear - startYear + 1;
  const totalPoints = totalYears * pointsPerYear;
  if (
    !Number.isInteger(startYear) ||
    !Number.isInteger(endYear) ||
    startYear > endYear
  ) {
    throw new Error(`Invalid year range start=${startYear} end=${endYear}`);
  }
  if (startYear < SUPPORTED_START_YEAR || endYear > SUPPORTED_END_YEAR) {
    throw new Error(
      `Supported years [${SUPPORTED_START_YEAR}, ${SUPPORTED_END_YEAR}] (inclusive); requested [${startYear}, ${endYear}]`,
    );
  }

  // Compile once; subsequent runs use --no-build to reduce process overhead.
  const buildStart = Date.now();
  log(`Building astronomy_engine_eval_runner before evaluation...`);
  runScarb(["build", "-p", "astronomy_engine_eval_runner"], CAIRO_DIR);
  log(`Build complete in ${formatDuration(Date.now() - buildStart)}.`);

  let processedYears = 0;
  let processedBatches = 0;
  const runStart = Date.now();
  log(
    `Starting eval: mode=${mode}, years=[${startYear}, ${endYear}] inclusive, totalPoints=${totalPoints}, pointsPerBatch=${pointsPerBatch}.`,
  );
  const emit = (record) => {
    console.log(JSON.stringify(record));
  };

  // Accumulators for signs mode
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

  for (let batchStartYear = startYear; batchStartYear <= endYear; batchStartYear += batchYears) {
    const batchEndYear = Math.min(batchStartYear + batchYears - 1, endYear);
    const { batchPointData, batchExpected, batchMeta, batchPointCount } = buildBatchPayload({
      batchStartYear,
      batchEndYear,
      months,
      locations,
    });

    if (mode === "precision") {
      let maxErrorDeg = 0;
      let maxErrorBody = null;
      let maxErrorMinutePg = null;
      for (let i = 0; i < batchPointCount; i += 1) {
        const meta = batchMeta[i];
        const cairoLons = runCairoPointLongitudes({
            minutePg: meta.minutePg,
          latBin: meta.latBin,
          lonBin: meta.lonBin,
          noBuild: true,
          cairoDir: CAIRO_DIR,
        });
        const pointUnixMs = EPOCH_PG_MS + meta.minutePg * 60_000;
        const oracleLons = computeOracleLongitudes(pointUnixMs, meta.latBin, meta.lonBin);
        for (let b = 0; b < 8; b += 1) {
          const err = angularErrorDeg(cairoLons[b], oracleLons[b]);
          if (err > maxErrorDeg) {
            maxErrorDeg = err;
            maxErrorBody = BODY_NAMES[b];
            maxErrorMinutePg = meta.minutePg;
          }
        }
      }

      emit({
        type: "precision_eval",
        locationSet,
        year: batchStartYear,
        pointCount: batchPointCount,
        maxErrorDeg: Math.round(maxErrorDeg * 1e9) / 1e9,
        maxErrorBody,
        maxErrorMinutePg,
      });
    } else {
      const batchResult = runWindowBreakdown({
        batchPointData,
        batchExpected,
        batchPointCount,
        pointsPerBatch,
        noBuild: true,
      });
      validateBreakdown(batchResult, batchPointCount);

      const batchFailCount = batchResult.failCount;
      if (batchFailCount > 0) {
        log(
          `Generating mismatch details for years ${batchStartYear}-${batchEndYear} with recursive isolation...`,
        );
        const { mismatchRows, pointMaskCalls, subsetBatchCalls } = collectMismatchRowsForBatch({
            locationSet,
          monthsPerYear: months,
          batchMeta,
          batchPointData,
          batchExpected,
          rootBreakdown: batchResult,
          noBuild: true,
        });
        for (const row of mismatchRows) {
          emit(row);
        }
        log(
          `Mismatch details for ${batchStartYear}-${batchEndYear}: rows=${mismatchRows.length}, subsetChecks=${subsetBatchCalls}, pointMasks=${pointMaskCalls}.`,
        );
      }

      failCount += batchResult.failCount;
      planetFailCount += batchResult.planetFailCount;
      ascFailCount += batchResult.ascFailCount;
      sunFailCount += batchResult.sunFailCount;
      moonFailCount += batchResult.moonFailCount;
      mercuryFailCount += batchResult.mercuryFailCount;
      venusFailCount += batchResult.venusFailCount;
      marsFailCount += batchResult.marsFailCount;
      jupiterFailCount += batchResult.jupiterFailCount;
      saturnFailCount += batchResult.saturnFailCount;

      emit(makeWindowSummaryRow({
        locationSet,
        year: batchStartYear,
        pointCount: batchPointCount,
        passCount: batchPointCount - batchResult.failCount,
        failCount: batchResult.failCount,
        planetFailCount: batchResult.planetFailCount,
        ascFailCount: batchResult.ascFailCount,
        sunFailCount: batchResult.sunFailCount,
        moonFailCount: batchResult.moonFailCount,
        mercuryFailCount: batchResult.mercuryFailCount,
        venusFailCount: batchResult.venusFailCount,
        marsFailCount: batchResult.marsFailCount,
        jupiterFailCount: batchResult.jupiterFailCount,
        saturnFailCount: batchResult.saturnFailCount,
      }));
    }

    processedBatches += 1;
    processedYears += batchEndYear - batchStartYear + 1;

    if (processedBatches % logEveryChunks === 0 || processedYears === totalYears) {
      const elapsedMs = Date.now() - runStart;
      const progress = totalYears > 0 ? processedYears / totalYears : 1;
      const estTotalMs = progress > 0 ? elapsedMs / progress : 0;
      const etaMs = Math.max(0, estTotalMs - elapsedMs);
      log(
        `Progress years ${processedYears}/${totalYears} (${(progress * 100).toFixed(2)}%), elapsed=${formatDuration(elapsedMs)}, eta=${formatDuration(etaMs)}.`,
      );
    }
  }

  if (failOnMismatch && failCount > 0) {
    process.exit(1);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}

export {
  ALEXANDRIA,
  EPOCH_PG_MS,
  NYC,
  buildBatchPayload,
  collectMismatchRowsForBatch,
  formatDuration,
  makeUtcDate,
  minuteSincePg,
  parseReturnArray,
  sliceBatchPayload,
};
