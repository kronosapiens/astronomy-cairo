#!/usr/bin/env node
import fs from "node:fs";
import { parseArgs, getStringArg } from "./args.js";
import { oracleAscSign, oraclePlanetSign } from "../engine.js";

function makeUtcDate(year, month, day) {
  const dt = new Date(Date.UTC(0, month - 1, day, 0, 0, 0));
  dt.setUTCFullYear(year);
  return dt;
}

const EPOCH_PG_MS = makeUtcDate(1, 1, 1).getTime();

function unixMsFromMinutePg(minutePg) {
  return EPOCH_PG_MS + minutePg * 60_000;
}

function expectedSigns(unixMs, latBin, lonBin) {
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inPathsRaw = getStringArg(args, "in", "");
  const outPath = getStringArg(args, "out", "");
  if (!inPathsRaw) throw new Error("Missing --in <file1.ndjson,file2.ndjson,...>");
  if (!outPath) throw new Error("Missing --out <corpus.ndjson>");

  const inPaths = inPathsRaw.split(",").map((s) => s.trim()).filter(Boolean);
  const map = new Map();

  for (const p of inPaths) {
    const raw = fs.readFileSync(p, "utf8").trim();
    if (!raw) continue;
    for (const line of raw.split(/\r?\n/)) {
      const row = JSON.parse(line);
      const minutePg = Number(row.minutePg);
      const latBin = Number(row.latBin);
      const lonBin = Number(row.lonBin);
      if (!Number.isInteger(minutePg) || !Number.isInteger(latBin) || !Number.isInteger(lonBin)) continue;
      const key = `${minutePg}:${latBin}:${lonBin}`;
      map.set(key, {
        minutePg,
        latBin,
        lonBin,
        year: Number(row.year),
        month: Number(row.month),
        location: String(row.location || ""),
      });
    }
  }

  const rows = [...map.values()].sort((a, b) =>
    a.minutePg - b.minutePg || a.latBin - b.latBin || a.lonBin - b.lonBin
  );
  const out = [];
  for (const row of rows) {
    const unixMs = unixMsFromMinutePg(row.minutePg);
    out.push(JSON.stringify({
      ...row,
      expectedSigns: expectedSigns(unixMs, row.latBin, row.lonBin),
    }));
  }
  fs.writeFileSync(outPath, `${out.join("\n")}\n`, "utf8");
  console.error(`[build-mismatch-corpus] wrote ${outPath} (${rows.length} points)`);
}

main();
