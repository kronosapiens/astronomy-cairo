#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseArgs, getNumberArg, getStringArg, requireStringArg } from "./args.js";
import { generateSignCorpus } from "../oracle/corpus.js";

function parseDateArg(value, key) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new Error(`Invalid date for --${key}: ${value}`);
  }
  return ms;
}

function parseIntegerList(input, key) {
  if (!input || typeof input !== "string") {
    throw new Error(`Missing required argument --${key}`);
  }
  const items = input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number.parseInt(s, 10));
  if (items.length === 0 || items.some((n) => !Number.isInteger(n))) {
    throw new Error(`Invalid integer list for --${key}: ${input}`);
  }
  return items;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outPath = requireStringArg(args, "out");
  const start = parseDateArg(requireStringArg(args, "start"), "start");
  const end = parseDateArg(requireStringArg(args, "end"), "end");

  const stepMinutes = getNumberArg(args, "step-minutes", 60);
  const latBins = parseIntegerList(getStringArg(args, "lat-bins", ""), "lat-bins");
  const lonBins = parseIntegerList(getStringArg(args, "lon-bins", ""), "lon-bins");

  const corpus = generateSignCorpus({
    startUnixMs: start,
    endUnixMs: end,
    stepMinutes,
    latBins,
    lonBins,
  });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(corpus, null, 2));

  console.log(
    JSON.stringify(
      {
        out: outPath,
        rows: corpus.entries.length,
        stepMinutes,
        latCount: latBins.length,
        lonCount: lonBins.length,
      },
      null,
      2,
    ),
  );
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
