#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildLongitudeArchive } from "../pipeline/builder.js";
import { validateLongitudeArchive } from "../pipeline/validate.js";
import { oraclePlanetLongitude } from "../../engine.js";
import { getNumberArg, getStringArg, parseArgs } from "../../cli/args.js";

function usage() {
  // eslint-disable-next-line no-console
  console.log(
    [
      "Usage: node src/legacy/cli/build-archive.js [options]",
      "",
      "Options:",
      "  --start YYYY-MM-DD         Start date (UTC), default 1900-01-01",
      "  --end YYYY-MM-DD           End date (UTC), default 2100-12-31",
      "  --out path                 Output archive JSON, default results/legacy/archive.json",
      "  --report path              Optional validation report JSON path",
      "  --step-minutes N           Validation cadence if --report is set, default 15",
      "  --version string           Archive version, default chart-ephem-v0",
      "",
      "Example:",
      "  npm run build:archive -- --start 2026-01-01 --end 2026-12-31 --out results/legacy/2026.json --report results/legacy/2026.report.json",
    ].join("\n")
  );
}

function parseUtcDateStart(dateText) {
  const iso = `${dateText}T00:00:00.000Z`;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new Error(`Invalid date: ${dateText}`);
  return ms;
}

function parseUtcDateEndInclusive(dateText) {
  const iso = `${dateText}T23:59:59.999Z`;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new Error(`Invalid date: ${dateText}`);
  return ms;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const startText = getStringArg(args, "start", "1900-01-01");
  const endText = getStringArg(args, "end", "2100-12-31");
  const outPath = getStringArg(args, "out", "results/legacy/archive.json");
  const reportPath = typeof args.report === "string" ? args.report : null;
  const version = getStringArg(args, "version", "chart-ephem-v0");
  const stepMinutes = getNumberArg(args, "step-minutes", 15);

  const rangeStartUnixMs = parseUtcDateStart(startText);
  const rangeEndUnixMs = parseUtcDateEndInclusive(endText);
  if (rangeEndUnixMs <= rangeStartUnixMs) {
    throw new Error(`End date must be after start date: ${startText}..${endText}`);
  }

  const archive = buildLongitudeArchive({
    rangeStartUnixMs,
    rangeEndUnixMs,
    referenceLongitude: oraclePlanetLongitude,
    version,
  });

  const outDir = path.dirname(outPath);
  await mkdir(outDir, { recursive: true });
  await writeFile(outPath, JSON.stringify(archive));

  // eslint-disable-next-line no-console
  console.log(`Archive written: ${outPath}`);
  // eslint-disable-next-line no-console
  console.log(`Range: ${startText} -> ${endText}`);

  if (reportPath) {
    const report = validateLongitudeArchive(archive, oraclePlanetLongitude, { stepMinutes });
    const reportDir = path.dirname(reportPath);
    await mkdir(reportDir, { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    // eslint-disable-next-line no-console
    console.log(`Validation report written: ${reportPath}`);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
