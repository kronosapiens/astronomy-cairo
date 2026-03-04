#!/usr/bin/env node
import { getNumberArg, getStringArg, parseArgs, requireStringArg } from "./args.js";
import {
  approximateAscendantLongitude1e9,
  approximatePlanetLongitude1e9,
  oracleAscSign,
  oraclePlanetSign,
  signFrom1e9,
} from "../oracle/cairo-model.js";

const PLANETS = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"];
const EPOCH_1900_UNIX_MS = Date.UTC(1900, 0, 1, 0, 0, 0, 0);

function parseDate(value, key) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`Invalid --${key}: ${value}`);
  return ms;
}

function toMinuteSince1900(unixMs) {
  return Math.floor((unixMs - EPOCH_1900_UNIX_MS) / 60_000);
}

function parseLocations(raw) {
  // format: "lat,lon;lat,lon;..."
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

function main() {
  const args = parseArgs(process.argv.slice(2));

  const start = parseDate(requireStringArg(args, "start"), "start");
  const end = parseDate(requireStringArg(args, "end"), "end");
  if (start > end) throw new Error("--start must be <= --end");

  const stepMinutes = getNumberArg(args, "step-minutes", 60);
  const quantizeMinutes = getNumberArg(args, "quantize-minutes", 15);
  const locationsRaw = getStringArg(args, "locations", "377,-1224");
  const locations = parseLocations(locationsRaw);
  const exampleLimit = getNumberArg(args, "example-limit", 40);

  let samples = 0;
  let chartMismatch = 0;
  let chartExact = 0;
  let ascMismatch = 0;
  const planetMismatch = Object.fromEntries(PLANETS.map((p) => [p, 0]));
  const mismatchExamples = [];

  for (let t = start; t <= end; t += stepMinutes * 60_000) {
    const minute = toMinuteSince1900(t);
    const qMinute = Math.floor(minute / quantizeMinutes) * quantizeMinutes;
    const qMs = EPOCH_1900_UNIX_MS + qMinute * 60_000;

    for (const { latBin, lonBin } of locations) {
      let anyMismatch = false;

      const planetRows = PLANETS.map((planet) => {
        const approxSign = signFrom1e9(approximatePlanetLongitude1e9(planet, qMinute));
        const oracleSign = oraclePlanetSign(planet, qMs);
        const mismatch = approxSign !== oracleSign;
        if (mismatch) {
          anyMismatch = true;
          planetMismatch[planet] += 1;
        }
        return { planet, approxSign, oracleSign, mismatch };
      });

      const approxAsc = signFrom1e9(approximateAscendantLongitude1e9(qMinute, latBin, lonBin));
      const oracleAsc = oracleAscSign(qMs, latBin, lonBin);
      if (approxAsc !== oracleAsc) {
        anyMismatch = true;
        ascMismatch += 1;
      }

      if (anyMismatch) {
        chartMismatch += 1;
        if (mismatchExamples.length < exampleLimit) {
          mismatchExamples.push({
            timestampUtc: new Date(qMs).toISOString(),
            minuteSince1900: qMinute,
            latBin,
            lonBin,
            ascApprox: approxAsc,
            ascOracle: oracleAsc,
            planets: planetRows.filter((r) => r.mismatch),
          });
        }
      } else {
        chartExact += 1;
      }

      samples += 1;
    }
  }

  const out = {
    samples,
    stepMinutes,
    quantizeMinutes,
    locations,
    chartMismatch,
    chartExact,
    chartExactRate: samples === 0 ? 0 : chartExact / samples,
    ascMismatch,
    planetMismatch,
    mismatchExamples,
  };

  console.log(JSON.stringify(out, null, 2));
}

main();
