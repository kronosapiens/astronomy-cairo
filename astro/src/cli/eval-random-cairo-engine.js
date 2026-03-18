#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, getNumberArg, getStringArg } from "./args.js";
import { oracleAscSign, oraclePlanetSign } from "../engine.js";
import {
  EPOCH_PG_MS,
  emitJsonLine,
  makeUtcDate,
  minuteSincePg,
  runCairoBatch,
  runCairoPointMismatchDetail,
  runScarb,
} from "./lib/eval-core.js";
import {
  makeRandomPointResultRow,
} from "./lib/eval-rows.js";

const ENGINE_CONFIG = {
  v5: { id: 5, startYear: 1, endYear: 4000 },
};

const CLI_PATH = fileURLToPath(import.meta.url);
const CLI_DIR = path.dirname(CLI_PATH);
const REPO_ROOT = path.resolve(CLI_DIR, "..", "..", "..");
const CAIRO_DIR = path.join(REPO_ROOT, "cairo");

const LAT_STRATA = [
  [-900, -601],
  [-600, -301],
  [-300, 300],
  [301, 600],
  [601, 900],
];
const YEAR_BUCKET_COUNT = 20;
const BATCH_POINTS = 24;

export function encodePointArrays(points) {
  const packedPoints = [];
  const expectedPacked = [];
  for (const p of points) {
    packedPoints.push(p.minutePg, p.latBin, p.lonBin);
    expectedPacked.push(...p.expectedSigns);
  }
  return { packedPoints, expectedPacked };
}

export function sliceEncodedPayload(packedPoints, expectedPacked, startIdx, endIdxExclusive) {
  return {
    packedPoints: packedPoints.slice(startIdx * 3, endIdxExclusive * 3),
    expectedPacked: expectedPacked.slice(startIdx * 8, endIdxExclusive * 8),
  };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function derivePointSeed(seed, sampleIndex) {
  return (
    (seed >>> 0)
    ^ Math.imul((sampleIndex + 1) >>> 0, 0x9e3779b1)
    ^ Math.imul((sampleIndex ^ 0x85ebca6b) >>> 0, 0xc2b2ae35)
  ) >>> 0;
}

function randIntInclusive(rng, lo, hi) {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function daysInMonth(year, month) {
  return makeUtcDate(year, month + 1, 0).getUTCDate();
}

function expectedSignsForPoint(unixMs, latBin, lonBin) {
  return [
    oraclePlanetSign("Sun", unixMs),
    oraclePlanetSign("Moon", unixMs),
    oraclePlanetSign("Mercury", unixMs),
    oraclePlanetSign("Venus", unixMs),
    oraclePlanetSign("Mars", unixMs),
    oraclePlanetSign("Jupiter", unixMs),
    oraclePlanetSign("Saturn", unixMs),
    oracleAscSign(unixMs, latBin, lonBin),
  ];
}

export function samplePointForIndex({
  seed,
  startYear,
  endYear,
  sampleIndex,
}) {
  const totalYears = endYear - startYear + 1;
  const bucketCount = Math.min(YEAR_BUCKET_COUNT, Math.max(1, totalYears));
  const yearBucketSize = Math.ceil(totalYears / bucketCount);
  const bucketIdx = sampleIndex % bucketCount;
  const bucketStart = startYear + bucketIdx * yearBucketSize;
  const bucketEnd = Math.min(endYear, bucketStart + yearBucketSize - 1);

  const rng = mulberry32(derivePointSeed(seed, sampleIndex));
  const year = randIntInclusive(rng, bucketStart, bucketEnd);
  const month = randIntInclusive(rng, 1, 12);
  const day = randIntInclusive(rng, 1, daysInMonth(year, month));
  const minuteOfDay = randIntInclusive(rng, 0, 1439);
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;

  const latStratum = sampleIndex % LAT_STRATA.length;
  const latRange = LAT_STRATA[latStratum];
  const latBin = randIntInclusive(rng, latRange[0], latRange[1]);
  const lonBin = randIntInclusive(rng, -1800, 1800);

  const unixMs = makeUtcDate(year, month, day, hour, minute).getTime();
  const minutePg = minuteSincePg(unixMs);
  const sampleUnixMs = EPOCH_PG_MS + minutePg * 60_000;

  return {
    sampleIndex,
    latStratum,
    yearBucket: `${String(bucketStart).padStart(4, "0")}-${String(bucketEnd).padStart(4, "0")}`,
    year,
    month,
    day,
    hour,
    minute,
    minutePg,
    sampleUnixMs,
    latBin,
    lonBin,
    expectedSigns: expectedSignsForPoint(sampleUnixMs, latBin, lonBin),
  };
}

function pointRowFromDetail(engine, seed, p, detail) {
  return makeRandomPointResultRow({
    engine,
    seed,
    sampleIndex: p.sampleIndex,
    yearBucket: p.yearBucket,
    latStratum: p.latStratum,
    year: p.year,
    month: p.month,
    day: p.day,
    hour: p.hour,
    minute: p.minute,
    minutePg: p.minutePg,
    latBin: p.latBin,
    lonBin: p.lonBin,
    expectedSigns: p.expectedSigns,
    actualSigns: detail.actualSigns,
    mismatchMask: detail.mask,
    actualLongitudes1e9: detail.actualLongitudes1e9,
  });
}

export function collectMismatchRowsForChunk({
  engineId,
  engine,
  seed,
  chunkPoints,
  packedPoints,
  expectedPacked,
  rootBreakdown,
  noBuild,
  runCairoBatchFn = runCairoBatch,
  runCairoPointMismatchDetailFn = runCairoPointMismatchDetail,
}) {
  const rows = [];
  const cache = new Map();
  cache.set(`0:${chunkPoints.length}`, rootBreakdown);

  const getBreakdown = (startIdx, endIdxExclusive) => {
    const key = `${startIdx}:${endIdxExclusive}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const sliced = sliceEncodedPayload(packedPoints, expectedPacked, startIdx, endIdxExclusive);
    const breakdown = runCairoBatchFn({
      engineId,
      packedPoints: sliced.packedPoints,
      expectedPacked: sliced.expectedPacked,
      noBuild,
      cairoDir: CAIRO_DIR,
    });
    cache.set(key, breakdown);
    return breakdown;
  };

  const recurse = (startIdx, endIdxExclusive) => {
    const count = endIdxExclusive - startIdx;
    if (count <= 0) return;
    const breakdown = getBreakdown(startIdx, endIdxExclusive);
    if (breakdown.failCount === 0) return;
    if (count === 1) {
      const p = chunkPoints[startIdx];
      const detail = runCairoPointMismatchDetailFn({
        engineId,
        minutePg: p.minutePg,
        latBin: p.latBin,
        lonBin: p.lonBin,
        expectedSigns: p.expectedSigns,
        noBuild,
        cairoDir: CAIRO_DIR,
        tempPrefix: "eval_random_point_detail",
      });
      if (detail.mask !== 0) {
        rows.push(pointRowFromDetail(engine, seed, p, detail));
      }
      return;
    }
    const mid = startIdx + Math.floor(count / 2);
    recurse(startIdx, mid);
    recurse(mid, endIdxExclusive);
  };

  recurse(0, chunkPoints.length);
  return rows;
}

export function buildChunkPoints({ seed, startYear, endYear, chunkStart, chunkEnd }) {
  const points = [];
  for (let sampleIndex = chunkStart; sampleIndex < chunkEnd; sampleIndex += 1) {
    points.push(samplePointForIndex({ seed, startYear, endYear, sampleIndex }));
  }
  return points;
}

// All output goes to stdout as ndjson. One chunk_summary row per chunk, plus
// point_result rows for any failures. To resume an interrupted run, inspect the
// existing output for completed chunks and re-run with --start-index / --end-index.
export function runRandomEval({
  engine,
  seed,
  points,
  startYear,
  endYear,
  startIndex = 0,
  endIndex = null,
  batchPoints = BATCH_POINTS,
}) {
  const capability = ENGINE_CONFIG[engine];
  const effectiveEnd = endIndex !== null ? Math.min(endIndex, points) : points;
  const noBuild = true;

  runScarb(["build", "-p", "astronomy_engine_eval_runner"], CAIRO_DIR);

  for (let chunkStart = startIndex; chunkStart < effectiveEnd; chunkStart += batchPoints) {
    const chunkEnd = Math.min(chunkStart + batchPoints, effectiveEnd);
    const chunkPoints = buildChunkPoints({ seed, startYear, endYear, chunkStart, chunkEnd });
    const { packedPoints, expectedPacked } = encodePointArrays(chunkPoints);
    const chunkBreakdown = runCairoBatch({
      engineId: capability.id,
      packedPoints,
      expectedPacked,
      noBuild,
      cairoDir: CAIRO_DIR,
    });

    if (chunkBreakdown.failCount > 0) {
      const rows = collectMismatchRowsForChunk({
        engineId: capability.id,
        engine,
        seed,
        chunkPoints,
        packedPoints,
        expectedPacked,
        rootBreakdown: chunkBreakdown,
        noBuild,
      });
      for (const row of rows) {
        emitJsonLine(process.stdout, row);
      }
    }

    emitJsonLine(process.stdout, {
      type: "chunk_summary",
      engine,
      seed,
      chunkStart,
      chunkEnd,
      pointCount: chunkEnd - chunkStart,
      failCount: chunkBreakdown.failCount,
    });
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const engine = getStringArg(args, "engine", "v5").toLowerCase();
  const points = getNumberArg(args, "points", 1000);
  const seed = getNumberArg(args, "seed", 1);
  const startIndex = getNumberArg(args, "start-index", 0);
  const endIndexArg = getNumberArg(args, "end-index", -1);

  if (!ENGINE_CONFIG[engine]) {
    throw new Error(`Unsupported --engine=${engine}; expected one of ${Object.keys(ENGINE_CONFIG).join(", ")}`);
  }
  if (!Number.isInteger(points) || points <= 0) {
    throw new Error(`Invalid --points=${points}; expected positive integer`);
  }
  if (!Number.isInteger(seed)) {
    throw new Error(`Invalid --seed=${seed}; expected integer`);
  }
  if (!Number.isInteger(startIndex) || startIndex < 0) {
    throw new Error(`Invalid --start-index=${startIndex}; expected non-negative integer`);
  }

  const capability = ENGINE_CONFIG[engine];
  const startYear = getNumberArg(args, "start-year", capability.startYear);
  const endYear = getNumberArg(args, "end-year", capability.endYear);

  if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || startYear > endYear) {
    throw new Error(`Invalid year range start=${startYear} end=${endYear}`);
  }
  if (startYear < capability.startYear || endYear > capability.endYear) {
    throw new Error(
      `Engine ${engine} supports years [${capability.startYear}, ${capability.endYear}] (inclusive); requested [${startYear}, ${endYear}]`,
    );
  }

  runRandomEval({
    engine,
    seed,
    points,
    startYear,
    endYear,
    startIndex,
    endIndex: endIndexArg >= 0 ? endIndexArg : null,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === CLI_PATH) {
  main();
}
