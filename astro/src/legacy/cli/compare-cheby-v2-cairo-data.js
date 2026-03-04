#!/usr/bin/env node
import fs from "node:fs";
import {
  approximateAscendantLongitude1e9,
  oracleAscSign,
  oraclePlanetSign,
  signFrom1e9,
} from "../oracle/cairo-model.js";
import { getNumberArg, parseArgs, requireStringArg } from "./args.js";

const PLANETS = [
  ["SUN", "Sun"],
  ["MOON", "Moon"],
  ["MERCURY", "Mercury"],
  ["VENUS", "Venus"],
  ["MARS", "Mars"],
  ["JUPITER", "Jupiter"],
  ["SATURN", "Saturn"],
];

const EPOCH_1900_UNIX_MS = Date.UTC(1900, 0, 1, 0, 0, 0);
const U_SCALE = 1_000_000;
const DEG_SCALE_TO_DEG1E9 = 1_000_000_000;

function parseDate(value, key) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`Invalid --${key}: ${value}`);
  return ms;
}

function parseConstU32(src, name) {
  const m = src.match(new RegExp(`pub const ${name}: u32 = (\\d+);`));
  if (!m) throw new Error(`Missing ${name}`);
  return Number(m[1]);
}

function parseConstUsize(src, name) {
  const m = src.match(new RegExp(`pub const ${name}: usize = (\\d+);`));
  if (!m) throw new Error(`Missing ${name}`);
  return Number(m[1]);
}

function parseConstI64(src, name) {
  const m = src.match(new RegExp(`pub const ${name}: i64 = (-?\\d+);`));
  if (!m) throw new Error(`Missing ${name}`);
  return Number(m[1]);
}

function parseCoeffChunk(src, name, index) {
  const re = new RegExp(`pub const ${name}_COEFFS_${index}: \\[i(?:32|64); \\d+\\] = \\[(.*?)\\n\\];`, "s");
  const m = src.match(re);
  if (!m) return null;
  const nums = m[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s));
  return nums;
}

function loadData(path) {
  const src = fs.readFileSync(path, "utf8");
  const chebyDegScale = parseConstI64(src, "CHEBY_DEG_SCALE");
  const chebyCoeffQuantum = (() => {
    const m = src.match(/pub const CHEBY_COEFF_QUANTUM: i64 = (-?\d+);/);
    return m ? Number(m[1]) : 1;
  })();
  const out = {
    chebyDegScale,
    chebyCoeffQuantum,
    planets: {},
  };

  for (const [prefix, name] of PLANETS) {
    const blockMinutes = parseConstU32(src, `${prefix}_BLOCK_MINUTES`);
    const order = parseConstUsize(src, `${prefix}_ORDER`);
    const blockCount = parseConstUsize(src, `${prefix}_BLOCK_COUNT`);
    const coeffTotal = parseConstUsize(src, `${prefix}_COEFF_TOTAL`);

    const coeffs = [];
    for (let i = 0; ; i += 1) {
      const chunk = parseCoeffChunk(src, prefix, i);
      if (!chunk) break;
      coeffs.push(...chunk);
    }
    if (coeffs.length !== coeffTotal) {
      throw new Error(`${name}: coeff length mismatch (${coeffs.length} != ${coeffTotal})`);
    }
    if (chebyCoeffQuantum !== 1) {
      for (let i = 0; i < coeffs.length; i += 1) coeffs[i] *= chebyCoeffQuantum;
    }

    out.planets[name] = { blockMinutes, order, blockCount, coeffs };
  }

  return out;
}

function norm360DegScaled(x, chebyDegScale) {
  const period = 360 * chebyDegScale;
  let y = x % period;
  if (y < 0) y += period;
  return y;
}

function norm360_1e9(x) {
  const period = 360 * DEG_SCALE_TO_DEG1E9;
  let y = x % period;
  if (y < 0) y += period;
  return y;
}

function clenshawDegScaled(coeffs, start, order, uScaled, chebyDegScale) {
  if (order === 0) return coeffs[start];
  let b1 = 0;
  let b2 = 0;
  for (let j = order; j >= 1; j -= 1) {
    const a = coeffs[start + j];
    const b0 = a + Math.trunc((2 * uScaled * b1) / U_SCALE) - b2;
    b2 = b1;
    b1 = b0;
  }
  const y = coeffs[start] + Math.trunc((uScaled * b1) / U_SCALE) - b2;
  return norm360DegScaled(y, chebyDegScale);
}

function chebyLongitude1e9(data, planet, minuteSince1900) {
  const spec = data.planets[planet];
  const idx = Math.min(Math.floor(minuteSince1900 / spec.blockMinutes), spec.blockCount - 1);
  const blockStartMinute = idx * spec.blockMinutes;
  const local = Math.max(0, minuteSince1900 - blockStartMinute);
  const uScaled = Math.trunc((2 * local * U_SCALE) / spec.blockMinutes) - U_SCALE;
  const stride = spec.order + 1;
  const start = idx * stride;
  const degScaled = clenshawDegScaled(spec.coeffs, start, spec.order, uScaled, data.chebyDegScale);
  const lon1e9 = Math.trunc((degScaled * DEG_SCALE_TO_DEG1E9) / data.chebyDegScale);
  return norm360_1e9(lon1e9);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const start = parseDate(requireStringArg(args, "start"), "start");
  const end = parseDate(requireStringArg(args, "end"), "end");
  const stepMinutes = getNumberArg(args, "step-minutes", 60);
  const quantizeMinutes = getNumberArg(args, "quantize-minutes", 15);
  const latBin = getNumberArg(args, "lat-bin", 377);
  const lonBin = getNumberArg(args, "lon-bin", -1224);
  const dataPath =
    typeof args["data-path"] === "string"
      ? args["data-path"]
      : "../cairo/crates/astronomy_engine_v2/src/cheby_data.cairo";
  const dumpLimit = getNumberArg(args, "dump-limit", 0);
  const moonOffset1e9 = getNumberArg(args, "moon-offset-1e9", 3_000);

  const data = loadData(dataPath);

  const planetMismatch = Object.fromEntries(PLANETS.map(([, name]) => [name, 0]));
  const mismatchRows = [];
  let ascMismatch = 0;
  let samples = 0;

  for (let t = start; t <= end; t += stepMinutes * 60000) {
    const minute = Math.floor((t - EPOCH_1900_UNIX_MS) / 60000);
    const qMinute = Math.floor(minute / quantizeMinutes) * quantizeMinutes;
    const qMs = EPOCH_1900_UNIX_MS + qMinute * 60000;

    for (const [, name] of PLANETS) {
      let approxLon = chebyLongitude1e9(data, name, qMinute);
      if (name === "Moon" && moonOffset1e9 !== 0) {
        approxLon = norm360_1e9(approxLon + moonOffset1e9);
      }
      const approxSign = signFrom1e9(approxLon);
      const oracleSign = oraclePlanetSign(name, qMs);
      if (approxSign !== oracleSign) {
        planetMismatch[name] += 1;
        if (dumpLimit > 0 && mismatchRows.length < dumpLimit) {
          mismatchRows.push({
            kind: "planet",
            planet: name,
            iso: new Date(qMs).toISOString(),
            qMinute,
            approxSign,
            oracleSign,
            approxLon1e9: approxLon,
          });
        }
      }
    }

    const approxAscLon = approximateAscendantLongitude1e9(qMinute, latBin, lonBin);
    const approxAsc = signFrom1e9(approxAscLon);
    const oracleAsc = oracleAscSign(qMs, latBin, lonBin);
    if (approxAsc !== oracleAsc) {
      ascMismatch += 1;
      if (dumpLimit > 0 && mismatchRows.length < dumpLimit) {
        mismatchRows.push({
          kind: "asc",
          iso: new Date(qMs).toISOString(),
          qMinute,
          approxSign: approxAsc,
          oracleSign: oracleAsc,
          approxLon1e9: approxAscLon,
        });
      }
    }
    samples += 1;
  }

  console.log(
    JSON.stringify(
      {
        samples,
        stepMinutes,
        quantizeMinutes,
        latBin,
        lonBin,
        planetMismatch,
        ascMismatch,
        mismatchRows,
      },
      null,
      2,
    ),
  );
}

main();
