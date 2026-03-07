#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs, getStringArg } from "./args.js";

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

function parseReturnArray(rawOutput) {
  const marker = "returning";
  const idx = rawOutput.lastIndexOf(marker);
  if (idx < 0) throw new Error(`Could not parse cairo-run output: missing '${marker}' marker`);
  const start = rawOutput.indexOf("[", idx);
  const end = rawOutput.lastIndexOf("]");
  if (start < 0 || end < 0 || end < start) throw new Error("Could not parse cairo-run output array");
  return JSON.parse(rawOutput.slice(start, end + 1));
}

function runBatchBreakdown(engineId, pointData, expectedData) {
  const payload = [engineId, pointData, expectedData];
  const tmpPath = path.join(os.tmpdir(), `corpus_batch_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}.json`);
  fs.writeFileSync(tmpPath, `${JSON.stringify(payload)}\n`, "utf8");
  try {
    const out = runScarb(
      [
        "cairo-run",
        "-p",
        "astronomy_engine_eval_runner",
        "--function",
        "eval_batch_fail_breakdown",
        "--arguments-file",
        tmpPath,
        "--no-build",
      ],
      CAIRO_DIR,
    );
    const v = parseReturnArray(out).map(Number);
    if (v.length !== 10) throw new Error(`Unexpected breakdown return length ${v.length}`);
    return {
      failCount: v[0],
      planetFailCount: v[1],
      ascFailCount: v[2],
      sunFailCount: v[3],
      moonFailCount: v[4],
      mercuryFailCount: v[5],
      venusFailCount: v[6],
      marsFailCount: v[7],
      jupiterFailCount: v[8],
      saturnFailCount: v[9],
    };
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
}

function runPointMask(engineId, minutePg, latBin, lonBin, expectedSigns) {
  const payload = [engineId, minutePg, latBin, lonBin, expectedSigns];
  const tmpPath = path.join(os.tmpdir(), `corpus_point_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}.json`);
  fs.writeFileSync(tmpPath, `${JSON.stringify(payload)}\n`, "utf8");
  try {
    const out = runScarb(
      [
        "cairo-run",
        "-p",
        "astronomy_engine_eval_runner",
        "--function",
        "eval_point_mismatch_mask",
        "--arguments-file",
        tmpPath,
        "--no-build",
      ],
      CAIRO_DIR,
    );
    const v = parseReturnArray(out).map(Number);
    if (v.length !== 1) throw new Error(`Unexpected point return length ${v.length}`);
    return v[0];
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const corpusPath = getStringArg(args, "corpus", "");
  const outPath = getStringArg(args, "out", "");
  const engineId = Number(getStringArg(args, "engine-id", "5"));
  if (!corpusPath) throw new Error("Missing --corpus <path>");
  if (!outPath) throw new Error("Missing --out <path>");

  const rows = fs
    .readFileSync(corpusPath, "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  if (rows.length === 0) throw new Error("Empty corpus");

  const pointData = [];
  const expectedData = [];
  for (const row of rows) {
    pointData.push(row.minutePg, row.latBin, row.lonBin);
    expectedData.push(...row.expectedSigns);
  }

  runScarb(["build", "-p", "astronomy_engine_eval_runner"], CAIRO_DIR);
  const breakdown = runBatchBreakdown(engineId, pointData, expectedData);

  const failedPoints = [];
  for (const row of rows) {
    const mask = runPointMask(engineId, row.minutePg, row.latBin, row.lonBin, row.expectedSigns);
    if (mask !== 0) failedPoints.push({ ...row, mismatchMask: mask });
  }

  const summary = {
    tsUtc: new Date().toISOString(),
    corpus: path.resolve(corpusPath),
    pointCount: rows.length,
    passCount: rows.length - breakdown.failCount,
    ...breakdown,
    failedPoints,
  };
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary));
}

main();
