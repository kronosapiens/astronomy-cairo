#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as Astronomy from "astronomy-engine";
import { parseArgs, getNumberArg, getStringArg } from "./args.js";

const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(CLI_DIR, "..", "..", "..");
const CAIRO_DIR = path.join(REPO_ROOT, "cairo");
function makeUtcDate(year, month, day) {
  const dt = new Date(Date.UTC(0, month - 1, day, 0, 0, 0));
  dt.setUTCFullYear(year);
  return dt;
}

const EPOCH_PG_MS = makeUtcDate(1, 1, 1).getTime();
const SCALE_1E9 = 1e9;
const ENGINE_ID_V5 = 5;
const DEBUG_EQJ_BIAS_1E9 = 100_000_000_000;
const DEBUG_TT_BIAS_1E9 = 4_000_000_000_000_000;
const DEBUG_FRAME_BIAS_1E9 = 360_000_000_000;

const PLANETS = [
  { key: "mercury", bit: 1 << 2, body: Astronomy.Body.Mercury, planetId: 2 },
  { key: "venus", bit: 1 << 3, body: Astronomy.Body.Venus, planetId: 3 },
  { key: "mars", bit: 1 << 4, body: Astronomy.Body.Mars, planetId: 4 },
  { key: "jupiter", bit: 1 << 5, body: Astronomy.Body.Jupiter, planetId: 5 },
  { key: "saturn", bit: 1 << 6, body: Astronomy.Body.Saturn, planetId: 6 },
];

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

function signedDegDelta(actualDeg, expectedDeg) {
  return ((((actualDeg - expectedDeg + 180) % 360) + 360) % 360) - 180;
}

function runCairoPlanetDebugFrame(engineId, planetId, minutePg) {
  const argsPayload = [engineId, planetId, minutePg];
  const tmpPath = path.join(os.tmpdir(), `probe_frame_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}.json`);
  fs.writeFileSync(tmpPath, `${JSON.stringify(argsPayload)}\n`, "utf8");
  try {
    const out = runScarb(
      [
        "cairo-run",
        "-p",
        "astronomy_engine_eval_runner",
        "--function",
        "eval_point_planet_debug_frame",
        "--arguments-file",
        tmpPath,
        "--no-build",
      ],
      CAIRO_DIR,
    );
    const values = parseReturnArray(out).map((x) => Number(x));
    if (values.length !== 6) {
      throw new Error(`Unexpected debug frame return shape: expected 6 values, got ${values.length}`);
    }
    return {
      dxEqjAu: (values[0] - DEBUG_EQJ_BIAS_1E9) / SCALE_1E9,
      dyEqjAu: (values[1] - DEBUG_EQJ_BIAS_1E9) / SCALE_1E9,
      dzEqjAu: (values[2] - DEBUG_EQJ_BIAS_1E9) / SCALE_1E9,
      obsTtDays: (values[3] - DEBUG_TT_BIAS_1E9) / SCALE_1E9,
      frameLonDeg: (values[4] - DEBUG_FRAME_BIAS_1E9) / SCALE_1E9,
      frameLatDeg: (values[5] - DEBUG_FRAME_BIAS_1E9) / SCALE_1E9,
    };
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
}

function runCairoFrameFromEqj(engineId, xEqjAu, yEqjAu, zEqjAu, daysSinceJ2000) {
  const x1e9 = Math.round(xEqjAu * SCALE_1E9);
  const y1e9 = Math.round(yEqjAu * SCALE_1E9);
  const z1e9 = Math.round(zEqjAu * SCALE_1E9);
  const d1e9 = Math.round(daysSinceJ2000 * SCALE_1E9);
  const argsPayload = [engineId, x1e9, y1e9, z1e9, d1e9];
  const tmpPath = path.join(os.tmpdir(), `probe_eqj_frame_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}.json`);
  fs.writeFileSync(tmpPath, `${JSON.stringify(argsPayload)}\n`, "utf8");
  try {
    const out = runScarb(
      [
        "cairo-run",
        "-p",
        "astronomy_engine_eval_runner",
        "--function",
        "eval_frame_from_eqj_compare",
        "--arguments-file",
        tmpPath,
        "--no-build",
      ],
      CAIRO_DIR,
    );
    const values = parseReturnArray(out).map((x) => Number(x));
    if (values.length !== 3) {
      throw new Error(`Unexpected frame projection shape: expected 3 values, got ${values.length}`);
    }
    return {
      lonStdDeg: (values[0] - DEBUG_FRAME_BIAS_1E9) / SCALE_1E9,
      lonRoundDeg: (values[1] - DEBUG_FRAME_BIAS_1E9) / SCALE_1E9,
      latStdDeg: (values[2] - DEBUG_FRAME_BIAS_1E9) / SCALE_1E9,
    };
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
}

function loadMismatchRows(inputPath) {
  const raw = fs.readFileSync(inputPath, "utf8").trim();
  if (!raw) throw new Error(`Empty mismatch log: ${inputPath}`);
  return raw
    .split(/\r?\n/)
    .map((line, i) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`Invalid JSON at line ${i + 1}`);
      }
    })
    .filter((r) => Number.isInteger(Number(r.mismatchMask)));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = getStringArg(args, "in", "");
  const outPath = getStringArg(args, "out", "");
  const maxRows = getNumberArg(args, "max-rows", 12);
  if (!inputPath) throw new Error("Missing --in <mismatch-log.ndjson>");
  if (!outPath) throw new Error("Missing --out <output.json>");

  runScarb(["build", "-p", "astronomy_engine_eval_runner"], CAIRO_DIR);

  const rows = loadMismatchRows(inputPath).slice(0, maxRows);
  const probes = [];
  const cache = new Map();

  for (const row of rows) {
    const minutePg = Number(row.minutePg);
    const unixMs = EPOCH_PG_MS + minutePg * 60_000;
    const date = new Date(unixMs);
    const mask = Number(row.mismatchMask);

    for (const p of PLANETS) {
      if ((mask & p.bit) === 0) continue;
      const key = `${minutePg}:${p.key}`;
      let cached = cache.get(key);
      if (!cached) {
        const cairo = runCairoPlanetDebugFrame(ENGINE_ID_V5, p.planetId, minutePg);
        const eqj = Astronomy.GeoVector(p.body, date, true);
        const ecl = Astronomy.Ecliptic(eqj);
        const oracleEqjPos = runCairoFrameFromEqj(
          ENGINE_ID_V5, eqj.x, eqj.y, eqj.z, eqj.t.tt,
        );
        const oracleEqjNeg = runCairoFrameFromEqj(
          ENGINE_ID_V5, eqj.x, eqj.y, eqj.z, -eqj.t.tt,
        );
        cached = {
          cairo,
          oracle: {
            eqj: { x: eqj.x, y: eqj.y, z: eqj.z, tt: eqj.t.tt },
            time: eqj.t,
            frameLonDeg: ecl.elon,
            frameLatDeg: ecl.elat,
          },
          oracleEqjPos,
          oracleEqjNeg,
        };
        cache.set(key, cached);
      }

      const { cairo, oracle, oracleEqjPos, oracleEqjNeg } = cached;
      const mixedEcl = Astronomy.Ecliptic(
        new Astronomy.Vector(cairo.dxEqjAu, cairo.dyEqjAu, cairo.dzEqjAu, oracle.time),
      );

      probes.push({
        year: row.year,
        month: row.month,
        location: row.location,
        minutePg,
        planet: p.key,
        mismatchMask: mask,
        eqjDeltaAu: {
          x: cairo.dxEqjAu - oracle.eqj.x,
          y: cairo.dyEqjAu - oracle.eqj.y,
          z: cairo.dzEqjAu - oracle.eqj.z,
        },
        ttDeltaDays: cairo.obsTtDays - oracle.eqj.tt,
        frameLonDeltaDeg: signedDegDelta(cairo.frameLonDeg, oracle.frameLonDeg),
        frameLatDeltaDeg: cairo.frameLatDeg - oracle.frameLatDeg,
        eqjOnlyLonDeltaDeg: signedDegDelta(mixedEcl.elon, oracle.frameLonDeg),
        eqjOnlyLatDeltaDeg: mixedEcl.elat - oracle.frameLatDeg,
        frameProjectionLonDeltaDeg: signedDegDelta(cairo.frameLonDeg, mixedEcl.elon),
        frameProjectionLatDeltaDeg: cairo.frameLatDeg - mixedEcl.elat,
        oracleEqjProjectedByCairo: {
          posTimeLonStdDeltaDeg: signedDegDelta(oracleEqjPos.lonStdDeg, oracle.frameLonDeg),
          posTimeLonRoundDeltaDeg: signedDegDelta(oracleEqjPos.lonRoundDeg, oracle.frameLonDeg),
          posTimeLatStdDeltaDeg: oracleEqjPos.latStdDeg - oracle.frameLatDeg,
          negTimeLonStdDeltaDeg: signedDegDelta(oracleEqjNeg.lonStdDeg, oracle.frameLonDeg),
          negTimeLonRoundDeltaDeg: signedDegDelta(oracleEqjNeg.lonRoundDeg, oracle.frameLonDeg),
          negTimeLatStdDeltaDeg: oracleEqjNeg.latStdDeg - oracle.frameLatDeg,
        },
      });
    }
  }

  const out = {
    tsUtc: new Date().toISOString(),
    source: path.resolve(inputPath),
    rowCount: rows.length,
    probeCount: probes.length,
    probes,
  };
  fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  console.error(`[probe-v5-planet-frame] wrote ${outPath}`);
}

main();
