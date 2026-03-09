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

const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));
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
const BATCH_POINTS = 500;

function runScarb(args, cwd) {
  const scarbBin = process.env.SCARB_BIN || "scarb";
  return execFileSync(scarbBin, args.map(String), {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function makeUtcDate(year, month, day, hour = 0, minute = 0) {
  const dt = new Date(Date.UTC(0, month - 1, day, hour, minute, 0));
  dt.setUTCFullYear(year);
  return dt;
}

const EPOCH_PG_MS = makeUtcDate(1, 1, 1).getTime();

function minuteSincePg(unixMs) {
  return Math.floor((unixMs - EPOCH_PG_MS) / 60_000);
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

function runCairoPointMismatchDetail({
  engineId,
  minutePg,
  latBin,
  lonBin,
  expectedSigns,
  noBuild,
}) {
  const argsPayload = [engineId, minutePg, latBin, lonBin, expectedSigns];
  const tmpPath = path.join(
    os.tmpdir(),
    `eval_random_point_detail_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}.json`,
  );
  fs.writeFileSync(tmpPath, `${JSON.stringify(argsPayload)}\n`, "utf8");

  try {
    const cmdArgs = [
      "cairo-run",
      "-p",
      "astronomy_engine_eval_runner",
      "--function",
      "eval_point_mismatch_detail",
      "--arguments-file",
      tmpPath,
    ];
    if (noBuild) cmdArgs.push("--no-build");
    const out = runScarb(cmdArgs, CAIRO_DIR);
    const values = parseReturnArray(out).map((x) => Number(x));
    if (values.length !== 16) {
      throw new Error(`Unexpected point detail return shape: expected 16 values, got ${values.length}`);
    }
    return {
      mask: values[0],
      actualSigns: values.slice(1, 9),
      actualLongitudes1e9: values.slice(9, 16),
    };
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
}

function runCairoBatch({ engineId, packedPoints, expectedPacked, noBuild }) {
  const argsPayload = [engineId, packedPoints, expectedPacked];
  const tmpPath = path.join(
    os.tmpdir(),
    `eval_random_batch_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}.json`,
  );
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

function encodePointArrays(points) {
  const packedPoints = [];
  const expectedPacked = [];
  for (const p of points) {
    packedPoints.push(p.minutePg, p.latBin, p.lonBin);
    expectedPacked.push(...p.expectedSigns);
  }
  return { packedPoints, expectedPacked };
}

function sliceEncodedPayload(packedPoints, expectedPacked, startIdx, endIdxExclusive) {
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

function randIntInclusive(rng, lo, hi) {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function daysInMonth(year, month) {
  return makeUtcDate(year, month + 1, 0).getUTCDate();
}

function samplePoint({
  rng,
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
  const year = randIntInclusive(rng, bucketStart, bucketEnd);

  const month = randIntInclusive(rng, 1, 12);
  const day = randIntInclusive(rng, 1, daysInMonth(year, month));
  const minuteOfDay = randIntInclusive(rng, 0, 1439);
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;

  const latStratum = LAT_STRATA[sampleIndex % LAT_STRATA.length];
  const latBin = randIntInclusive(rng, latStratum[0], latStratum[1]);
  const lonBin = randIntInclusive(rng, -1800, 1800);

  const unixMs = makeUtcDate(year, month, day, hour, minute).getTime();
  const minutePg = minuteSincePg(unixMs);
  const sampleUnixMs = EPOCH_PG_MS + minutePg * 60_000;

  return {
    year,
    month,
    day,
    hour,
    minute,
    minutePg,
    sampleUnixMs,
    latBin,
    lonBin,
    yearBucketStart: bucketStart,
    yearBucketEnd: bucketEnd,
  };
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

function getBooleanArg(args, key, fallback) {
  const value = args[key];
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error(`Invalid boolean argument --${key}=${value}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const engine = getStringArg(args, "engine", "v5").toLowerCase();
  const points = getNumberArg(args, "points", 1000);
  const seed = getNumberArg(args, "seed", 1);
  const includePassingRows = getBooleanArg(args, "include-passes", true);

  if (!ENGINE_CONFIG[engine]) {
    throw new Error(`Unsupported --engine=${engine}; expected one of ${Object.keys(ENGINE_CONFIG).join(", ")}`);
  }
  if (!Number.isInteger(points) || points <= 0) {
    throw new Error(`Invalid --points=${points}; expected positive integer`);
  }
  if (!Number.isInteger(seed)) {
    throw new Error(`Invalid --seed=${seed}; expected integer`);
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

  runScarb(["build", "-p", "astronomy_engine_eval_runner"], CAIRO_DIR);

  const rng = mulberry32(seed);
  const sampledPoints = [];
  for (let i = 0; i < points; i += 1) {
    const sampled = samplePoint({ rng, startYear, endYear, sampleIndex: i });
    sampledPoints.push({
      ...sampled,
      sampleIndex: i,
      latStratum: i % LAT_STRATA.length,
      yearBucket: `${String(sampled.yearBucketStart).padStart(4, "0")}-${String(sampled.yearBucketEnd).padStart(4, "0")}`,
      expectedSigns: expectedSignsForPoint(sampled.sampleUnixMs, sampled.latBin, sampled.lonBin),
    });
  }

  const emitPointRow = (p, detail) => {
    const mask = detail.mask;
    const row = {
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
      mismatchMask: mask,
      planetMismatch: (mask & 0x7f) !== 0,
      ascMismatch: (mask & 0x80) !== 0,
      actualLongitudes1e9: detail.actualLongitudes1e9,
    };
    process.stdout.write(`${JSON.stringify(row)}\n`);
  };

  const processChunkMismatchOnly = (chunkPoints, packedPoints, expectedPacked, rootBreakdown) => {
    const cache = new Map();
    cache.set(`0:${chunkPoints.length}`, rootBreakdown);

    const getBreakdown = (startIdx, endIdxExclusive) => {
      const key = `${startIdx}:${endIdxExclusive}`;
      const cached = cache.get(key);
      if (cached) return cached;
      const sliced = sliceEncodedPayload(packedPoints, expectedPacked, startIdx, endIdxExclusive);
      const breakdown = runCairoBatch({
        engineId: capability.id,
        packedPoints: sliced.packedPoints,
        expectedPacked: sliced.expectedPacked,
        noBuild: true,
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
        const detail = runCairoPointMismatchDetail({
          engineId: capability.id,
          minutePg: p.minutePg,
          latBin: p.latBin,
          lonBin: p.lonBin,
          expectedSigns: p.expectedSigns,
          noBuild: true,
        });
        if (detail.mask !== 0) {
          emitPointRow(p, detail);
        }
        return;
      }
      const mid = startIdx + Math.floor(count / 2);
      recurse(startIdx, mid);
      recurse(mid, endIdxExclusive);
    };

    recurse(0, chunkPoints.length);
  };

  for (let chunkStart = 0; chunkStart < sampledPoints.length; chunkStart += BATCH_POINTS) {
    const chunkEnd = Math.min(chunkStart + BATCH_POINTS, sampledPoints.length);
    const chunkPoints = sampledPoints.slice(chunkStart, chunkEnd);
    const { packedPoints, expectedPacked } = encodePointArrays(chunkPoints);
    const chunkBreakdown = runCairoBatch({
      engineId: capability.id,
      packedPoints,
      expectedPacked,
      noBuild: true,
    });

    if (includePassingRows) {
      for (const p of chunkPoints) {
        const detail = runCairoPointMismatchDetail({
          engineId: capability.id,
          minutePg: p.minutePg,
          latBin: p.latBin,
          lonBin: p.lonBin,
          expectedSigns: p.expectedSigns,
          noBuild: true,
        });
        emitPointRow(p, detail);
      }
      continue;
    }

    if (chunkBreakdown.failCount === 0) {
      continue;
    }
    processChunkMismatchOnly(chunkPoints, packedPoints, expectedPacked, chunkBreakdown);
  }
}

main();
