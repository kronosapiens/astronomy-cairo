#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createAstronomyEngineProvider } from "../../providers.astronomy-engine.js";
import { fitChebyshev } from "../../math/fit.js";
import { angularDifferenceDegrees } from "../../math/angles.js";
import { getNumberArg, parseArgs } from "./args.js";

const EPOCH_1900_UNIX_MS = Date.UTC(1900, 0, 1, 0, 0, 0);
const DEFAULT_START_UNIX_MS = Date.UTC(1900, 0, 1, 0, 0, 0);
const DEFAULT_END_UNIX_MS = Date.UTC(2100, 0, 1, 0, 0, 0);
const DEFAULT_CHEBY_DEG_SCALE = 1_000_000;
const DEFAULT_COEFF_QUANTUM = 4;
const CHUNK_SIZE = 20_000;

const PLANETS = [
  { key: "SUN", name: "Sun", defaultBlockDays: 32, defaultOrder: 8 },
  { key: "MOON", name: "Moon", defaultBlockDays: 8, defaultOrder: 10 },
  { key: "MERCURY", name: "Mercury", defaultBlockDays: 16, defaultOrder: 8 },
  { key: "VENUS", name: "Venus", defaultBlockDays: 24, defaultOrder: 6 },
  { key: "MARS", name: "Mars", defaultBlockDays: 32, defaultOrder: 8 },
  { key: "JUPITER", name: "Jupiter", defaultBlockDays: 64, defaultOrder: 6 },
  { key: "SATURN", name: "Saturn", defaultBlockDays: 64, defaultOrder: 8 },
];

function parseDateArg(value, fallback) {
  if (typeof value !== "string") return fallback;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`Invalid date: ${value}`);
  return ms;
}

function blockArg(args, key, fallback) {
  return getNumberArg(args, `${key.toLowerCase()}-block-days`, fallback);
}

function orderArg(args, key, fallback) {
  return getNumberArg(args, `${key.toLowerCase()}-order`, fallback);
}

function generatePlanetCoeffs(
  provider,
  planetName,
  rangeStartMs,
  rangeEndMs,
  blockDays,
  order,
  chebyDegScale,
  coeffQuantum,
) {
  const blockMinutes = Math.trunc(blockDays * 1440);
  const rangeMinutes = Math.trunc((rangeEndMs - rangeStartMs) / 60000);
  const blockCount = Math.ceil(rangeMinutes / blockMinutes);
  const coeffs = [];

  for (let idx = 0; idx < blockCount; idx += 1) {
    const blockStartMinute = idx * blockMinutes;
    const blockEndMinute = blockStartMinute + blockMinutes;
    const blockStartMs = rangeStartMs + blockStartMinute * 60000;
    const blockEndMs = rangeStartMs + blockEndMinute * 60000;
    const midMs = blockStartMs + (blockEndMs - blockStartMs) / 2;
    const midLon = provider.getLongitude(planetName, midMs);

    const fitted = fitChebyshev(order, (u) => {
      const unixMs = blockStartMs + ((u + 1) / 2) * (blockEndMs - blockStartMs);
      const lon = provider.getLongitude(planetName, unixMs);
      const delta = angularDifferenceDegrees(midLon, lon);
      return midLon + delta;
    });

    for (const c of fitted) {
      const raw = Math.round(c * chebyDegScale);
      const quantized = Math.round(raw / coeffQuantum);
      coeffs.push(quantized);
    }
  }

  return {
    blockMinutes,
    order,
    blockCount,
    coeffs,
  };
}

function renderChunkArray(constName, values) {
  const lines = [`pub const ${constName}: [i32; ${values.length}] = [`];
  for (const v of values) lines.push(`    ${v},`);
  lines.push("];");
  return lines.join("\n");
}

function renderPlanet(parts, key, spec, coeffQuantum) {
  const total = spec.coeffs.length;
  const chunkCount = Math.ceil(total / CHUNK_SIZE);

  parts.push(`pub const ${key}_BLOCK_MINUTES: u32 = ${spec.blockMinutes};`);
  parts.push(`pub const ${key}_ORDER: usize = ${spec.order};`);
  parts.push(`pub const ${key}_BLOCK_COUNT: usize = ${spec.blockCount};`);
  parts.push(`pub const ${key}_COEFF_TOTAL: usize = ${total};`);
  parts.push(`pub const ${key}_COEFF_CHUNKS: usize = ${chunkCount};`);

  for (let i = 0; i < chunkCount; i += 1) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, total);
    const vals = spec.coeffs.slice(start, end);
    parts.push(renderChunkArray(`${key}_COEFFS_${i}`, vals));
    parts.push(`pub const ${key}_COEFFS_${i}_OFFSET: usize = ${start};`);
  }

  parts.push(`pub fn ${key.toLowerCase()}_coeff_at(idx: usize) -> i64 {`);
  for (let i = 0; i < chunkCount; i += 1) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, total);
    const len = end - start;
    parts.push(
      `    if idx < ${key}_COEFFS_${i}_OFFSET + ${len} { return ((*${key}_COEFFS_${i}.span().at(idx - ${key}_COEFFS_${i}_OFFSET)).into()) * ${coeffQuantum}; }`,
    );
  }
  parts.push("    assert(false, 'coeff idx out of bounds');");
  parts.push("    0");
  parts.push("}");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outPath =
    typeof args.out === "string"
      ? args.out
      : "cairo/crates/astronomy_engine_v2/src/cheby_data.cairo";
  const startMs = parseDateArg(args.start, DEFAULT_START_UNIX_MS);
  const endMs = parseDateArg(args.end, DEFAULT_END_UNIX_MS);
  const chebyDegScale = getNumberArg(args, "deg-scale", DEFAULT_CHEBY_DEG_SCALE);
  const coeffQuantum = getNumberArg(args, "coeff-quantum", DEFAULT_COEFF_QUANTUM);
  if (endMs <= startMs) throw new Error("end must be greater than start");
  if (coeffQuantum <= 0) throw new Error("coeff-quantum must be > 0");

  const provider = createAstronomyEngineProvider();
  const planetSpecs = {};
  for (const p of PLANETS) {
    const blockDays = blockArg(args, p.key, p.defaultBlockDays);
    const order = orderArg(args, p.key, p.defaultOrder);
    planetSpecs[p.key] = generatePlanetCoeffs(
      provider,
      p.name,
      startMs,
      endMs,
      blockDays,
      order,
      chebyDegScale,
      coeffQuantum,
    );
  }

  const parts = [];
  parts.push("// Generated chunked Chebyshev longitude coefficients for astronomy_engine_v2");
  parts.push(`pub const CHEBY_DEG_SCALE: i64 = ${chebyDegScale};`);
  parts.push(`pub const CHEBY_COEFF_QUANTUM: i64 = ${coeffQuantum};`);
  parts.push("");

  for (const p of PLANETS) {
    renderPlanet(parts, p.key, planetSpecs[p.key], coeffQuantum);
    parts.push("");
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, parts.join("\n"));

  const summary = Object.fromEntries(
    PLANETS.map((p) => [
      p.name,
      {
        blockMinutes: planetSpecs[p.key].blockMinutes,
        order: planetSpecs[p.key].order,
        blockCount: planetSpecs[p.key].blockCount,
        coeffTotal: planetSpecs[p.key].coeffs.length,
      },
    ]),
  );
  console.log(JSON.stringify({ outPath, coeffQuantum, summary }, null, 2));
}

main();
