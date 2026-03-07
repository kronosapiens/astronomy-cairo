#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { parseArgs, getStringArg, getNumberArg } from "./args.js";
import { oraclePlanetLongitude } from "../engine.js";

const PLANET_BITS = [
  { bit: 1 << 0, key: "sun", label: "Sun" },
  { bit: 1 << 1, key: "moon", label: "Moon" },
  { bit: 1 << 2, key: "mercury", label: "Mercury" },
  { bit: 1 << 3, key: "venus", label: "Venus" },
  { bit: 1 << 4, key: "mars", label: "Mars" },
  { bit: 1 << 5, key: "jupiter", label: "Jupiter" },
  { bit: 1 << 6, key: "saturn", label: "Saturn" },
  { bit: 1 << 7, key: "asc", label: "Ascendant" },
];

function toSortedEntries(mapObj) {
  return Object.entries(mapObj).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function utcUnixMs(year, month) {
  return Date.UTC(year, month - 1, 1, 0, 0, 0);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = getStringArg(args, "in", "");
  const outPrefix = getStringArg(args, "out-prefix", "");
  const bucketYears = getNumberArg(args, "year-bucket", 100);
  const withCusp = Boolean(args["with-cusp"]);
  if (!inputPath) throw new Error("Missing --in <mismatch-log.ndjson>");
  if (!outPrefix) throw new Error("Missing --out-prefix <output-path-prefix>");
  if (!Number.isInteger(bucketYears) || bucketYears <= 0) {
    throw new Error(`Invalid --year-bucket=${bucketYears}; expected positive integer`);
  }

  const raw = fs.readFileSync(inputPath, "utf8").trim();
  if (!raw) throw new Error(`Empty mismatch log: ${inputPath}`);
  const rows = raw.split(/\r?\n/).map((line, idx) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`Invalid JSON at line ${idx + 1}`);
    }
  });

  let minYear = Number.POSITIVE_INFINITY;
  let maxYear = Number.NEGATIVE_INFINITY;
  const byMask = {};
  const byLocation = {};
  const byMonth = {};
  const byYearBucket = {};
  const byPlanet = Object.fromEntries(PLANET_BITS.map((p) => [p.key, 0]));
  const cuspByPlanet = Object.fromEntries(
    PLANET_BITS.map((p) => [p.key, { n: 0, lt001: 0, lt01: 0, lt05: 0, lt1: 0, ge1: 0 }]),
  );
  const cuspOverall = { n: 0, lt001: 0, lt01: 0, lt05: 0, lt1: 0, ge1: 0 };

  for (const row of rows) {
    const year = Number(row.year);
    const month = Number(row.month);
    const mask = Number(row.mismatchMask);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(mask)) continue;

    minYear = Math.min(minYear, year);
    maxYear = Math.max(maxYear, year);
    byMask[String(mask)] = (byMask[String(mask)] || 0) + 1;
    byLocation[row.location] = (byLocation[row.location] || 0) + 1;
    byMonth[String(month)] = (byMonth[String(month)] || 0) + 1;

    const bucketStart = Math.floor((year - 1) / bucketYears) * bucketYears + 1;
    const bucketEnd = bucketStart + bucketYears - 1;
    const bucketKey = `${String(bucketStart).padStart(4, "0")}-${String(bucketEnd).padStart(4, "0")}`;
    byYearBucket[bucketKey] = (byYearBucket[bucketKey] || 0) + 1;

    for (const p of PLANET_BITS) {
      if ((mask & p.bit) !== 0) {
        byPlanet[p.key] += 1;
        if (withCusp && p.key !== "asc") {
          const lon = oraclePlanetLongitude(p.label, utcUnixMs(year, month));
          const mod = ((lon % 30) + 30) % 30;
          const d = Math.min(mod, 30 - mod);
          const s = cuspByPlanet[p.key];
          s.n += 1;
          cuspOverall.n += 1;
          if (d < 0.01) { s.lt001 += 1; cuspOverall.lt001 += 1; }
          if (d < 0.1) { s.lt01 += 1; cuspOverall.lt01 += 1; }
          if (d < 0.5) { s.lt05 += 1; cuspOverall.lt05 += 1; }
          if (d < 1) { s.lt1 += 1; cuspOverall.lt1 += 1; } else { s.ge1 += 1; cuspOverall.ge1 += 1; }
        }
      }
    }
  }

  const summary = {
    source: path.resolve(inputPath),
    rowCount: rows.length,
    minYear,
    maxYear,
    yearBucketSize: bucketYears,
    byPlanet,
    byMask: toSortedEntries(byMask).map(([mask, count]) => ({ mask: Number(mask), count })),
    byLocation: toSortedEntries(byLocation).map(([location, count]) => ({ location, count })),
    byMonth: toSortedEntries(byMonth).map(([month, count]) => ({ month: Number(month), count })),
    byYearBucket: toSortedEntries(byYearBucket).map(([bucket, count]) => ({ bucket, count })),
    cuspDistance: withCusp
      ? {
          note: "Distance to nearest 30-degree sign boundary, oracle longitude.",
          overall: cuspOverall,
          byPlanet: cuspByPlanet,
        }
      : null,
  };

  const jsonPath = `${outPrefix}.json`;
  fs.writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  const md = [];
  md.push("# Mismatch Analysis");
  md.push("");
  md.push(`- Source: \`${summary.source}\``);
  md.push(`- Rows: ${summary.rowCount}`);
  md.push(`- Year range: ${summary.minYear}..${summary.maxYear}`);
  md.push(`- Year bucket size: ${summary.yearBucketSize}`);
  md.push("");
  md.push("## By Planet Bit");
  md.push("");
  md.push("| Component | Count |");
  md.push("|---|---:|");
  for (const p of PLANET_BITS) {
    md.push(`| ${p.label} | ${summary.byPlanet[p.key]} |`);
  }
  md.push("");
  md.push("## Top Masks");
  md.push("");
  md.push("| Mask | Count |");
  md.push("|---:|---:|");
  for (const item of summary.byMask.slice(0, 20)) {
    md.push(`| ${item.mask} | ${item.count} |`);
  }
  md.push("");
  if (summary.cuspDistance) {
    md.push("## Cusp Distance");
    md.push("");
    md.push("Distance to nearest sign boundary (degrees) for mismatched planet bits.");
    md.push("");
    md.push("| Scope | N | <0.01 | <0.1 | <0.5 | <1.0 | >=1.0 |");
    md.push("|---|---:|---:|---:|---:|---:|---:|");
    const o = summary.cuspDistance.overall;
    md.push(`| Overall | ${o.n} | ${o.lt001} | ${o.lt01} | ${o.lt05} | ${o.lt1} | ${o.ge1} |`);
    for (const p of PLANET_BITS) {
      if (p.key === "asc") continue;
      const s = summary.cuspDistance.byPlanet[p.key];
      if (s.n === 0) continue;
      md.push(`| ${p.label} | ${s.n} | ${s.lt001} | ${s.lt01} | ${s.lt05} | ${s.lt1} | ${s.ge1} |`);
    }
    md.push("");
  }

  md.push("## By Location");
  md.push("");
  md.push("| Location | Count |");
  md.push("|---|---:|");
  for (const item of summary.byLocation) {
    md.push(`| ${item.location} | ${item.count} |`);
  }
  md.push("");
  md.push("## By Year Bucket");
  md.push("");
  md.push("| Years | Count |");
  md.push("|---|---:|");
  for (const item of summary.byYearBucket) {
    md.push(`| ${item.bucket} | ${item.count} |`);
  }
  md.push("");
  const mdPath = `${outPrefix}.md`;
  fs.writeFileSync(mdPath, `${md.join("\n")}\n`, "utf8");

  console.error(`[analyze-mismatch-log] wrote ${jsonPath}`);
  console.error(`[analyze-mismatch-log] wrote ${mdPath}`);
}

main();
