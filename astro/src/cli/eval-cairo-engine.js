#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, getNumberArg, getStringArg } from "./args.js";
import { oracleAscSign, oraclePlanetLongitude, oraclePlanetSign } from "../engine.js";
import {
  EPOCH_PG_MS,
  makeUtcDate,
  minuteSincePg,
  parseReturnArray,
  runCairoBatch,
  runCairoPointMismatchDetail,
  runScarb,
} from "./lib/eval-core.js";
import {
  makeStructuredMismatchRow,
  makeWindowSummaryRow,
} from "./lib/eval-rows.js";

const ENGINE_CONFIG = {
  v5: { id: 5, startYear: 1, endYear: 4000 },
};

const NYC = { name: "NYC", latBin: 407, lonBin: -740 };
const ALEXANDRIA = { name: "Alexandria", latBin: 312, lonBin: 299 };
const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(CLI_DIR, "..", "..", "..");
const CAIRO_DIR = path.join(REPO_ROOT, "cairo");

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
  engineId,
  batchPointData,
  batchExpected,
  batchPointCount,
  pointsPerBatch,
  noBuild,
  runCairoBatchFn = runCairoBatch,
}) {
  if (pointsPerBatch >= batchPointCount) {
    return runCairoBatchFn({
      engineId,
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
      engineId,
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
  engineId,
  engine,
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
      engineId,
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
        engineId,
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
          engine,
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
  const engine = getStringArg(args, "engine", "v5").toLowerCase();
  const logEveryChunks = getNumberArg(args, "log-every-chunks", 5);
  const quiet = Boolean(args.quiet);
  const failOnMismatch = Boolean(args["fail-on-mismatch"]);
  const log = (line) => {
    if (!quiet) process.stderr.write(`[eval-cairo-engine] ${line}\n`);
  };

  if (!ENGINE_CONFIG[engine]) {
    throw new Error(`Unsupported --engine=${engine}; expected one of ${Object.keys(ENGINE_CONFIG).join(", ")}`);
  }

  const capability = ENGINE_CONFIG[engine];
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
    `Starting eval: engine=${engine}, years=[${startYear}, ${endYear}] inclusive, totalPoints=${totalPoints}, pointsPerBatch=${pointsPerBatch}.`,
  );
  const emit = (record) => {
    console.log(JSON.stringify(record));
  };
  for (let batchStartYear = startYear; batchStartYear <= endYear; batchStartYear += batchYears) {
    const batchEndYear = Math.min(batchStartYear + batchYears - 1, endYear);
    const { batchPointData, batchExpected, batchMeta, batchPointCount } = buildBatchPayload({
      batchStartYear,
      batchEndYear,
      months,
      locations,
    });

    const batchResult = runWindowBreakdown({
      engineId: capability.id,
      batchPointData,
      batchExpected,
      batchPointCount,
      pointsPerBatch,
      noBuild: true,
    });
    validateBreakdown(batchResult, batchPointCount);

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

    if (batchFailCount > 0) {
      log(
        `Generating mismatch details for years ${batchStartYear}-${batchEndYear} with recursive isolation...`,
      );
      const { mismatchRows, pointMaskCalls, subsetBatchCalls } = collectMismatchRowsForBatch({
        engineId: capability.id,
        engine,
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

    emit(makeWindowSummaryRow({
      engine,
      locationSet,
      monthsPerYear: months,
      yearStart: batchStartYear,
      yearEnd: batchEndYear,
      pointCount: batchPointCount,
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
    }));

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
