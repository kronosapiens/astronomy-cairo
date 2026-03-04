#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs, getNumberArg, getStringArg } from "./args.js";
import { oracleAscSign, oraclePlanetSign } from "../core/astronomy-engine.js";

const ENGINE_CONFIG = {
  v5: { id: 5, startYear: 1, endYear: 4000 },
};

const NYC = { name: "NYC", latBin: 407, lonBin: -740 };
const ALEXANDRIA = { name: "Alexandria", latBin: 312, lonBin: 299 };
const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));
const ASTRO_ROOT = path.resolve(CLI_DIR, "..", "..");

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function runScarb(args, cwd) {
  const cmd = `scarb ${args.map(shellQuote).join(" ")}`;
  return execSync(cmd, {
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
      "eval_batch_fail_count",
      "--arguments-file",
      tmpPath,
    ];
    if (noBuild) cmdArgs.push("--no-build");

    const out = runScarb(cmdArgs, path.resolve("cairo"));
    const values = parseReturnArray(out);
    if (values.length !== 1) {
      throw new Error(`Unexpected cairo-run return shape: expected 1 value, got ${values.length}`);
    }
    return Number(values[0]);
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
}

function initBuckets() {
  return Array.from({ length: 8 }, (_, i) => {
    const startYear = i * 500 + 1;
    const endYear = startYear + 499;
    return {
      index: i,
      startYear,
      endYear,
      total: 0,
      pass: 0,
      fail: 0,
      failRate: 0,
    };
  });
}

function countYearsInBucket({ bucketStartYear, bucketEndYear, startYear, endYear }) {
  const lo = Math.max(bucketStartYear, startYear);
  const hi = Math.min(bucketEndYear, endYear);
  return hi >= lo ? hi - lo + 1 : 0;
}

function renderAsciiHistogram(buckets) {
  const maxFail = Math.max(...buckets.map((b) => b.fail));
  const scale = maxFail > 0 ? 40 / maxFail : 0;
  return buckets
    .map((b) => {
      const barLen = maxFail > 0 ? Math.max(0, Math.round(b.fail * scale)) : 0;
      const bar = "#".repeat(barLen);
      const label = `${String(b.startYear).padStart(4, "0")}-${String(b.endYear).padStart(4, "0")}`;
      return `${label} | ${bar} (${b.fail}/${b.total})`;
    })
    .join("\n");
}

function runTagTimestamp() {
  return new Date().toISOString().replaceAll(":", "").replaceAll("-", "").replaceAll(".", "");
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
  const quantizeMinutes = getNumberArg(args, "quantize-minutes", 15);
  const batchSize = getNumberArg(args, "batch-size", 512);
  const logEveryChunks = getNumberArg(args, "log-every-chunks", 5);
  const quiet = Boolean(args.quiet);
  const outPath = typeof args.out === "string" ? args.out : null;
  const artifactsDir = getStringArg(args, "artifacts-dir", path.join(ASTRO_ROOT, "results", "evals"));
  const log = (line) => {
    if (!quiet) process.stderr.write(`[eval-cairo-engine] ${line}\n`);
  };

  if (!ENGINE_CONFIG[engine]) {
    throw new Error(`Unsupported --engine=${engine}; expected one of ${Object.keys(ENGINE_CONFIG).join(", ")}`);
  }
  if (profile !== "light" && profile !== "heavy") {
    throw new Error(`Unsupported --profile=${profile}; expected 'light' or 'heavy'`);
  }
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error(`Invalid --batch-size=${batchSize}`);
  }

  const capability = ENGINE_CONFIG[engine];
  const startYear = getNumberArg(args, "start-year", capability.startYear);
  const endYear = getNumberArg(args, "end-year", capability.endYear);
  const locations = profile === "heavy" ? [NYC, ALEXANDRIA] : [NYC];
  const months = profile === "heavy" ? 12 : 1;
  const totalPoints = (endYear - startYear + 1) * months * locations.length;
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || startYear > endYear) {
    throw new Error(`Invalid year range start=${startYear} end=${endYear}`);
  }
  if (startYear < capability.startYear || endYear > capability.endYear) {
    throw new Error(
      `Engine ${engine} supports years ${capability.startYear}-${capability.endYear}; requested ${startYear}-${endYear}`,
    );
  }

  // Compile once; subsequent runs use --no-build to reduce process overhead.
  const buildStart = Date.now();
  log(`Building astronomy_engine_eval_runner before evaluation...`);
  runScarb(["build", "-p", "astronomy_engine_eval_runner"], path.resolve("cairo"));
  log(`Build complete in ${formatDuration(Date.now() - buildStart)}.`);

  const buckets = initBuckets();
  let passCount = 0;
  let failCount = 0;
  let processedPoints = 0;
  let processedChunks = 0;
  const runStart = Date.now();
  log(
    `Starting eval: engine=${engine}, profile=${profile}, years=${startYear}-${endYear}, totalPoints=${totalPoints}, batchSize=${batchSize}.`,
  );

  for (let bIdx = 0; bIdx < buckets.length; bIdx += 1) {
    const bucket = buckets[bIdx];
    const yearsInBucket = countYearsInBucket({
      bucketStartYear: bucket.startYear,
      bucketEndYear: bucket.endYear,
      startYear,
      endYear,
    });
    bucket.total = yearsInBucket * months * locations.length;
    if (bucket.total === 0) continue;

    const bucketLabel = `${String(buckets[bIdx].startYear).padStart(4, "0")}-${String(buckets[bIdx].endYear).padStart(4, "0")}`;
    log(`Bucket ${bucketLabel}: ${bucket.total} points.`);

    const yearStart = Math.max(bucket.startYear, startYear);
    const yearEnd = Math.min(bucket.endYear, endYear);
    let chunkPointData = [];
    let chunkExpected = [];
    let chunkPointCount = 0;

    const flushChunk = () => {
      if (chunkPointCount === 0) return;

      const chunkFailCount = runCairoBatch({
        engineId: capability.id,
        packedPoints: chunkPointData,
        expectedPacked: chunkExpected,
        noBuild: true,
      });
      if (!Number.isInteger(chunkFailCount) || chunkFailCount < 0 || chunkFailCount > chunkPointCount) {
        throw new Error(`Unexpected fail count from Cairo runner: ${chunkFailCount}`);
      }

      bucket.fail += chunkFailCount;
      bucket.pass += chunkPointCount - chunkFailCount;
      failCount += chunkFailCount;
      passCount += chunkPointCount - chunkFailCount;
      processedPoints += chunkPointCount;
      processedChunks += 1;

      if (processedChunks % logEveryChunks === 0 || processedPoints === totalPoints) {
        const elapsedMs = Date.now() - runStart;
        const progress = totalPoints > 0 ? processedPoints / totalPoints : 1;
        const estTotalMs = progress > 0 ? elapsedMs / progress : 0;
        const etaMs = Math.max(0, estTotalMs - elapsedMs);
        log(
          `Progress ${processedPoints}/${totalPoints} (${(progress * 100).toFixed(2)}%), fail=${failCount}, elapsed=${formatDuration(elapsedMs)}, eta=${formatDuration(etaMs)}.`,
        );
      }

      chunkPointData = [];
      chunkExpected = [];
      chunkPointCount = 0;
    };

    for (let year = yearStart; year <= yearEnd; year += 1) {
      for (let month = 1; month <= months; month += 1) {
        const dt = makeUtcDate(year, month, 1);
        const unixMs = dt.getTime();
        const rawMinutePg = minuteSincePg(unixMs);
        const minutePg = Math.floor(rawMinutePg / quantizeMinutes) * quantizeMinutes;
        const qUnixMs = EPOCH_PG_MS + minutePg * 60_000;

        for (const loc of locations) {
          chunkPointData.push(minutePg, loc.latBin, loc.lonBin);
          const signs = computeExpectedSignsForPoint(qUnixMs, loc.latBin, loc.lonBin);
          chunkExpected.push(
            signs[0],
            signs[1],
            signs[2],
            signs[3],
            signs[4],
            signs[5],
            signs[6],
            signs[7],
          );
          chunkPointCount += 1;

          if (chunkPointCount >= batchSize) {
            flushChunk();
          }
        }
      }
    }

    flushChunk();
  }

  for (const bucket of buckets) {
    bucket.failRate = bucket.total > 0 ? bucket.fail / bucket.total : 0;
  }

  const result = {
    engine,
    engineId: capability.id,
    profile,
    quantizeMinutes,
    batchSize,
    startYear,
    endYear,
    rangePolicy: {
      supportedStartYear: capability.startYear,
      supportedEndYear: capability.endYear,
      appliedStartYear: startYear,
      appliedEndYear: endYear,
    },
    totalPoints,
    passCount,
    failCount,
    passRate: totalPoints > 0 ? passCount / totalPoints : 0,
    failRate: totalPoints > 0 ? failCount / totalPoints : 0,
    buckets,
    histogramAscii: renderAsciiHistogram(buckets),
  };

  const defaultArtifactPath = path.join(
    artifactsDir,
    engine,
    profile,
    `${runTagTimestamp()}_${startYear}_${endYear}.json`,
  );
  const artifactPath = outPath || defaultArtifactPath;
  result.artifactPath = artifactPath;
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(artifactPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  log(`Wrote artifact: ${artifactPath}`);

  console.log(JSON.stringify(result, null, 2));

  if (failCount > 0) {
    process.exit(1);
  }
}

main();
