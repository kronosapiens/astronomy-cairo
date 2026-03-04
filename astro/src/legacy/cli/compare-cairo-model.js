#!/usr/bin/env node
import { parseArgs, getNumberArg, getStringArg, requireStringArg } from "./args.js";
import {
  approximateAscendantLongitude1e9,
  approximatePlanetLongitude1e9,
  oracleAscSign,
  oraclePlanetSign,
  signFrom1e9,
} from "../oracle/cairo-model.js";

const PLANETS = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"];
const EPOCH_1900_UNIX_MS = Date.UTC(1900, 0, 1, 0, 0, 0);

function parseDate(value, key) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`Invalid --${key}: ${value}`);
  return ms;
}

function toMinuteSince1900(unixMs) {
  return Math.floor((unixMs - EPOCH_1900_UNIX_MS) / 60000);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const start = parseDate(requireStringArg(args, "start"), "start");
  const end = parseDate(requireStringArg(args, "end"), "end");
  const stepMinutes = getNumberArg(args, "step-minutes", 60);
  const latBin = getNumberArg(args, "lat-bin", 377);
  const lonBin = getNumberArg(args, "lon-bin", -1224);
  const quantizeMinutes = getNumberArg(args, "quantize-minutes", 15);

  const planetMismatch = Object.fromEntries(PLANETS.map((p) => [p, 0]));
  let ascMismatch = 0;
  let samples = 0;

  for (let t = start; t <= end; t += stepMinutes * 60000) {
    const minute = toMinuteSince1900(t);
    const qMinute = Math.floor(minute / quantizeMinutes) * quantizeMinutes;
    const qMs = EPOCH_1900_UNIX_MS + qMinute * 60000;

    for (const planet of PLANETS) {
      const approxSign = signFrom1e9(approximatePlanetLongitude1e9(planet, qMinute));
      const oracleSign = oraclePlanetSign(planet, qMs);
      if (approxSign !== oracleSign) planetMismatch[planet] += 1;
    }

    const approxAsc = signFrom1e9(approximateAscendantLongitude1e9(qMinute, latBin, lonBin));
    const oracleAsc = oracleAscSign(qMs, latBin, lonBin);
    if (approxAsc !== oracleAsc) ascMismatch += 1;

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
      },
      null,
      2,
    ),
  );
}

main();
