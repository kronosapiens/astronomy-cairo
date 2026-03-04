#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { oraclePlanetLongitude } from "../../engine.js";
import { validateLongitudeArchive } from "../pipeline/validate.js";
import { getNumberArg, getStringArg, parseArgs, requireStringArg } from "../../cli/args.js";

function usage() {
  // eslint-disable-next-line no-console
  console.log(
    [
      "Usage: node src/legacy/cli/validate-archive.js --archive path [options]",
      "",
      "Options:",
      "  --archive path             Required archive JSON path",
      "  --out path                 Output report path, default results/legacy/validate.report.json",
      "  --step-minutes N           Validation cadence, default 15",
      "",
      "Example:",
      "  npm run validate:archive -- --archive results/legacy/archive.json --out results/legacy/archive.report.json --step-minutes 30",
    ].join("\n")
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const archivePath = requireStringArg(args, "archive");
  const outPath = getStringArg(args, "out", "results/legacy/validate.report.json");
  const stepMinutes = getNumberArg(args, "step-minutes", 15);

  const raw = await readFile(archivePath, "utf8");
  const archive = JSON.parse(raw);
  const report = validateLongitudeArchive(archive, oraclePlanetLongitude, { stepMinutes });

  const outDir = path.dirname(outPath);
  await mkdir(outDir, { recursive: true });
  await writeFile(outPath, JSON.stringify(report, null, 2));

  // eslint-disable-next-line no-console
  console.log(`Validation report written: ${outPath}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
