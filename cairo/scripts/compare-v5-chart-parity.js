#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getNumberArg, getStringArg, parseArgs, requireStringArg } from "../../astro/src/cli/args.js";
import { oracleAscSign, oraclePlanetSign } from "../../astro/src/engine.js";

const PLANETS = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"];
const EPOCH_PG_MS = Date.parse("0001-01-01T00:00:00Z");

function parseDate(value, key) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`Invalid --${key}: ${value}`);
  return ms;
}

function parseLocations(raw) {
  const parts = raw
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) throw new Error("No locations parsed from --locations");
  return parts.map((part) => {
    const [latRaw, lonRaw] = part.split(",").map((s) => s.trim());
    const latBin = Number(latRaw);
    const lonBin = Number(lonRaw);
    if (!Number.isFinite(latBin) || !Number.isFinite(lonBin)) {
      throw new Error(`Invalid location entry: ${part}`);
    }
    return { latBin, lonBin };
  });
}

function minuteSincePg(unixMs) {
  return Math.floor((unixMs - EPOCH_PG_MS) / 60_000);
}

function sanitizeName(s) {
  return s.replace(/[^a-zA-Z0-9_]/g, "_");
}

function buildCairoTestSource(cases, testPrefix) {
  const lines = [];
  lines.push("use astronomy_engine_v5::ascendant::approximate_ascendant_longitude_pg_1e9;");
  lines.push("use astronomy_engine_v5::fixed::{norm360_i64_1e9, SCALE_1E9};");
  lines.push("use astronomy_engine_v5::planets::approximate_planet_longitude_pg_1e9;");
  lines.push("");
  lines.push("fn sign_from_lon_1e9(lon_1e9: i64) -> i64 {");
  lines.push("    norm360_i64_1e9(lon_1e9) / (30 * SCALE_1E9)");
  lines.push("}");
  lines.push("");

  for (const c of cases) {
    lines.push("#[test]");
    lines.push(`fn ${testPrefix}_${c.id}() {`);
    lines.push(`    let minute_pg: i64 = ${c.minutePg};`);
    lines.push(`    let lat_bin: i16 = ${c.latBin};`);
    lines.push(`    let lon_bin: i16 = ${c.lonBin};`);
    lines.push(`    let expected: [i64; 7] = [${c.planetSigns.join(", ")}];`);
    lines.push(`    let expected_asc: i64 = ${c.ascSign};`);
    lines.push("    assert(sign_from_lon_1e9(approximate_planet_longitude_pg_1e9(0, minute_pg)) == *expected.span().at(0), 'p0');");
    lines.push("    assert(sign_from_lon_1e9(approximate_planet_longitude_pg_1e9(1, minute_pg)) == *expected.span().at(1), 'p1');");
    lines.push("    assert(sign_from_lon_1e9(approximate_planet_longitude_pg_1e9(2, minute_pg)) == *expected.span().at(2), 'p2');");
    lines.push("    assert(sign_from_lon_1e9(approximate_planet_longitude_pg_1e9(3, minute_pg)) == *expected.span().at(3), 'p3');");
    lines.push("    assert(sign_from_lon_1e9(approximate_planet_longitude_pg_1e9(4, minute_pg)) == *expected.span().at(4), 'p4');");
    lines.push("    assert(sign_from_lon_1e9(approximate_planet_longitude_pg_1e9(5, minute_pg)) == *expected.span().at(5), 'p5');");
    lines.push("    assert(sign_from_lon_1e9(approximate_planet_longitude_pg_1e9(6, minute_pg)) == *expected.span().at(6), 'p6');");
    lines.push("    assert(sign_from_lon_1e9(approximate_ascendant_longitude_pg_1e9(minute_pg, lat_bin, lon_bin)) == expected_asc, 'asc');");
    lines.push("}");
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const start = parseDate(requireStringArg(args, "start"), "start");
  const end = parseDate(requireStringArg(args, "end"), "end");
  if (start > end) throw new Error("--start must be <= --end");

  const stepMinutes = getNumberArg(args, "step-minutes", 60);
  const maxCases = getNumberArg(args, "max-cases", 128);
  const locations = parseLocations(getStringArg(args, "locations", "377,-1224"));
  const keepGenerated = Boolean(args["keep-generated"]);

  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, "../..");
  const cairoDir = path.join(repoRoot, "cairo");
  const testsDir = path.join(cairoDir, "crates", "astronomy_engine_v5", "tests");
  const runTag = `generated_chart_parity_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  const testFile = path.join(testsDir, `${runTag}.cairo`);

  fs.mkdirSync(testsDir, { recursive: true });

  const cases = [];
  let idx = 0;
  for (let t = start; t <= end; t += stepMinutes * 60_000) {
    const minutePg = minuteSincePg(t);
    const sampleMs = EPOCH_PG_MS + minutePg * 60_000;

    for (const { latBin, lonBin } of locations) {
      const planetSigns = PLANETS.map((p) => oraclePlanetSign(p, sampleMs));
      const ascSign = oracleAscSign(sampleMs, latBin, lonBin);
      cases.push({
        id: sanitizeName(`${idx}_${minutePg}_${latBin}_${lonBin}`),
        minutePg,
        latBin,
        lonBin,
        planetSigns,
        ascSign,
      });
      idx += 1;
      if (cases.length >= maxCases) break;
    }
    if (cases.length >= maxCases) break;
  }

  if (cases.length === 0) {
    throw new Error("No test cases generated");
  }

  fs.writeFileSync(testFile, buildCairoTestSource(cases, runTag), "utf8");

  const cmd = `scarb test -p astronomy_engine_v5 --test-kind integration -f ${runTag}_`;
  let ok = true;
  let output = "";
  const scratchTargetDir = path.join(
    cairoDir,
    "target",
    `parity_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`,
  );

  try {
    try {
      output = execSync(cmd, {
        cwd: cairoDir,
        stdio: "pipe",
        encoding: "utf8",
        env: { ...process.env, SCARB_TARGET_DIR: scratchTargetDir },
      });
    } catch (err) {
      ok = false;
      output = `${err.stdout || ""}${err.stderr || ""}`.trim();
    }

    const result = {
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      stepMinutes,
      maxCases,
      generatedCases: cases.length,
      locations,
      command: cmd,
      runTag,
      targetDir: scratchTargetDir,
      passed: ok,
      testFile,
      output,
    };

    console.log(JSON.stringify(result, null, 2));
    if (!ok) process.exit(1);
  } finally {
    if (!keepGenerated) {
      try {
        fs.rmSync(testFile, { force: true });
      } catch {}
    }
    try {
      fs.rmSync(scratchTargetDir, { recursive: true, force: true });
    } catch {}
  }
}

main();
