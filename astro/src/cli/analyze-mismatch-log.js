#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { parseArgs, getStringArg, getNumberArg } from "./args.js";
import { oraclePlanetLongitude } from "../engine.js";

const PLANET_BITS = [
  { bit: 1 << 0, key: "sun", label: "Sun", signIndex: 0 },
  { bit: 1 << 1, key: "moon", label: "Moon", signIndex: 1 },
  { bit: 1 << 2, key: "mercury", label: "Mercury", signIndex: 2 },
  { bit: 1 << 3, key: "venus", label: "Venus", signIndex: 3 },
  { bit: 1 << 4, key: "mars", label: "Mars", signIndex: 4 },
  { bit: 1 << 5, key: "jupiter", label: "Jupiter", signIndex: 5 },
  { bit: 1 << 6, key: "saturn", label: "Saturn", signIndex: 6 },
  { bit: 1 << 7, key: "asc", label: "Ascendant", signIndex: 7 },
];

function toSortedEntries(mapObj) {
  return Object.entries(mapObj).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function utcUnixMs(year, month) {
  return Date.UTC(year, month - 1, 1, 0, 0, 0);
}

function signedSignDelta(actualSign, expectedSign) {
  const deltaRaw = actualSign - expectedSign;
  return ((((deltaRaw + 6) % 12) + 12) % 12) - 6;
}

function signedCuspOffsetDeg(lon) {
  const mod = ((lon % 30) + 30) % 30;
  return mod <= 15 ? mod : mod - 30;
}

function makeSignDeltaStats() {
  return { n: 0, lead: 0, lag: 0, exact: 0, deltas: {} };
}

function signedDegreeDelta(actualDeg, expectedDeg) {
  return ((((actualDeg - expectedDeg + 180) % 360) + 360) % 360) - 180;
}

function makeLonDeltaStats() {
  return { n: 0, lt001: 0, lt01: 0, lt05: 0, lt1: 0, ge1: 0, sum_1e6: 0, abs_sum_1e6: 0 };
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
  const cuspSignedByPlanet = Object.fromEntries(
    PLANET_BITS.map((p) => [p.key, { n: 0, neg: 0, pos: 0, zero: 0, sum_1e6: 0 }]),
  );
  const cuspSignedOverall = { n: 0, neg: 0, pos: 0, zero: 0, sum_1e6: 0 };
  const signDeltaByPlanet = Object.fromEntries(PLANET_BITS.map((p) => [p.key, makeSignDeltaStats()]));
  const signDeltaOverall = makeSignDeltaStats();
  const lonDeltaByPlanet = Object.fromEntries(PLANET_BITS.map((p) => [p.key, makeLonDeltaStats()]));
  const lonDeltaOverall = makeLonDeltaStats();

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
          const signed = signedCuspOffsetDeg(lon);
          const d = Math.abs(signed);
          const s = cuspByPlanet[p.key];
          s.n += 1;
          cuspOverall.n += 1;
          if (d < 0.01) { s.lt001 += 1; cuspOverall.lt001 += 1; }
          if (d < 0.1) { s.lt01 += 1; cuspOverall.lt01 += 1; }
          if (d < 0.5) { s.lt05 += 1; cuspOverall.lt05 += 1; }
          if (d < 1) { s.lt1 += 1; cuspOverall.lt1 += 1; } else { s.ge1 += 1; cuspOverall.ge1 += 1; }

          const signedStats = cuspSignedByPlanet[p.key];
          signedStats.n += 1;
          cuspSignedOverall.n += 1;
          const signed1e6 = Math.round(signed * 1_000_000);
          signedStats.sum_1e6 += signed1e6;
          cuspSignedOverall.sum_1e6 += signed1e6;
          if (signed < 0) {
            signedStats.neg += 1;
            cuspSignedOverall.neg += 1;
          } else if (signed > 0) {
            signedStats.pos += 1;
            cuspSignedOverall.pos += 1;
          } else {
            signedStats.zero += 1;
            cuspSignedOverall.zero += 1;
          }
        }

        if (Array.isArray(row.expectedSigns) && Array.isArray(row.actualSigns)) {
          const expected = Number(row.expectedSigns[p.signIndex]);
          const actual = Number(row.actualSigns[p.signIndex]);
          if (Number.isInteger(expected) && Number.isInteger(actual)) {
            const delta = signedSignDelta(actual, expected);
            const stats = signDeltaByPlanet[p.key];
            stats.n += 1;
            signDeltaOverall.n += 1;
            if (delta > 0) {
              stats.lead += 1;
              signDeltaOverall.lead += 1;
            } else if (delta < 0) {
              stats.lag += 1;
              signDeltaOverall.lag += 1;
            } else {
              stats.exact += 1;
              signDeltaOverall.exact += 1;
            }
            const key = String(delta);
            stats.deltas[key] = (stats.deltas[key] || 0) + 1;
            signDeltaOverall.deltas[key] = (signDeltaOverall.deltas[key] || 0) + 1;
          }
        }

        if (
          p.signIndex < 7
          && Array.isArray(row.actualLongitudes1e9)
          && Array.isArray(row.oracleLongitudesDeg)
        ) {
          const actualLon1e9 = Number(row.actualLongitudes1e9[p.signIndex]);
          const oracleLonDeg = Number(row.oracleLongitudesDeg[p.signIndex]);
          if (Number.isFinite(actualLon1e9) && Number.isFinite(oracleLonDeg)) {
            const actualLonDeg = actualLon1e9 / 1e9;
            const deltaDeg = signedDegreeDelta(actualLonDeg, oracleLonDeg);
            const absDeg = Math.abs(deltaDeg);
            const stats = lonDeltaByPlanet[p.key];
            stats.n += 1;
            lonDeltaOverall.n += 1;
            const delta1e6 = Math.round(deltaDeg * 1_000_000);
            const abs1e6 = Math.round(absDeg * 1_000_000);
            stats.sum_1e6 += delta1e6;
            stats.abs_sum_1e6 += abs1e6;
            lonDeltaOverall.sum_1e6 += delta1e6;
            lonDeltaOverall.abs_sum_1e6 += abs1e6;
            if (absDeg < 0.01) { stats.lt001 += 1; lonDeltaOverall.lt001 += 1; }
            if (absDeg < 0.1) { stats.lt01 += 1; lonDeltaOverall.lt01 += 1; }
            if (absDeg < 0.5) { stats.lt05 += 1; lonDeltaOverall.lt05 += 1; }
            if (absDeg < 1) { stats.lt1 += 1; lonDeltaOverall.lt1 += 1; } else { stats.ge1 += 1; lonDeltaOverall.ge1 += 1; }
          }
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
          signedOffsetDeg: {
            note: "Signed offset in degrees from nearest sign boundary; negative/positive indicate opposite cusp sides.",
            overall: cuspSignedOverall,
            byPlanet: cuspSignedByPlanet,
          },
        }
      : null,
    signDelta: {
      note: "Signed sign-step delta (actual - expected), wrapped to [-6, +5].",
      overall: signDeltaOverall,
      byPlanet: signDeltaByPlanet,
    },
    longitudeDeltaDeg: {
      note: "Signed longitude delta in degrees (actual Cairo - oracle), wrapped to [-180, +180).",
      overall: lonDeltaOverall,
      byPlanet: lonDeltaByPlanet,
    },
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
    md.push("### Signed Cusp Side");
    md.push("");
    md.push("| Scope | N | Neg | Pos | Zero | Mean Signed Offset (deg) |");
    md.push("|---|---:|---:|---:|---:|---:|");
    const so = summary.cuspDistance.signedOffsetDeg.overall;
    const soMean = so.n > 0 ? (so.sum_1e6 / so.n / 1_000_000).toFixed(6) : "0.000000";
    md.push(`| Overall | ${so.n} | ${so.neg} | ${so.pos} | ${so.zero} | ${soMean} |`);
    for (const p of PLANET_BITS) {
      if (p.key === "asc") continue;
      const s = summary.cuspDistance.signedOffsetDeg.byPlanet[p.key];
      if (s.n === 0) continue;
      const mean = (s.sum_1e6 / s.n / 1_000_000).toFixed(6);
      md.push(`| ${p.label} | ${s.n} | ${s.neg} | ${s.pos} | ${s.zero} | ${mean} |`);
    }
    md.push("");
  }

  md.push("## Signed Sign Delta");
  md.push("");
  md.push("| Scope | N | Lead (+) | Lag (-) | Exact (0) |");
  md.push("|---|---:|---:|---:|---:|");
  md.push(
    `| Overall | ${summary.signDelta.overall.n} | ${summary.signDelta.overall.lead} | ${summary.signDelta.overall.lag} | ${summary.signDelta.overall.exact} |`,
  );
  for (const p of PLANET_BITS) {
    const s = summary.signDelta.byPlanet[p.key];
    if (s.n === 0) continue;
    md.push(`| ${p.label} | ${s.n} | ${s.lead} | ${s.lag} | ${s.exact} |`);
  }
  md.push("");
  md.push("### Delta Histogram (Overall)");
  md.push("");
  md.push("| Delta | Count |");
  md.push("|---:|---:|");
  const deltaEntries = Object.entries(summary.signDelta.overall.deltas).sort(
    (a, b) => Number(a[0]) - Number(b[0]),
  );
  for (const [delta, count] of deltaEntries) {
    md.push(`| ${delta} | ${count} |`);
  }
  md.push("");
  md.push("## Longitude Delta (Deg)");
  md.push("");
  md.push("| Scope | N | Mean Signed | Mean Abs | <0.01 | <0.1 | <0.5 | <1.0 | >=1.0 |");
  md.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  const lo = summary.longitudeDeltaDeg.overall;
  const loMeanSigned = lo.n > 0 ? (lo.sum_1e6 / lo.n / 1_000_000).toFixed(6) : "0.000000";
  const loMeanAbs = lo.n > 0 ? (lo.abs_sum_1e6 / lo.n / 1_000_000).toFixed(6) : "0.000000";
  md.push(`| Overall | ${lo.n} | ${loMeanSigned} | ${loMeanAbs} | ${lo.lt001} | ${lo.lt01} | ${lo.lt05} | ${lo.lt1} | ${lo.ge1} |`);
  for (const p of PLANET_BITS) {
    if (p.key === "asc") continue;
    const s = summary.longitudeDeltaDeg.byPlanet[p.key];
    if (s.n === 0) continue;
    const meanSigned = (s.sum_1e6 / s.n / 1_000_000).toFixed(6);
    const meanAbs = (s.abs_sum_1e6 / s.n / 1_000_000).toFixed(6);
    md.push(`| ${p.label} | ${s.n} | ${meanSigned} | ${meanAbs} | ${s.lt001} | ${s.lt01} | ${s.lt05} | ${s.lt1} | ${s.ge1} |`);
  }
  md.push("");

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
