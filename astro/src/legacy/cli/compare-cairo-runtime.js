#!/usr/bin/env node
import fs from 'node:fs';
import {
  approximateAscendantLongitude1e9,
  signFrom1e9,
  oracleAscSign,
  oraclePlanetSign,
} from '../oracle/cairo-model.js';
import { parseArgs, getNumberArg, requireStringArg } from './args.js';

const PLANETS = [
  ['SUN', 'Sun'],
  ['MOON', 'Moon'],
  ['MERCURY', 'Mercury'],
  ['VENUS', 'Venus'],
  ['MARS', 'Mars'],
  ['JUPITER', 'Jupiter'],
  ['SATURN', 'Saturn'],
];

const EPOCH_1900_UNIX_MS = Date.UTC(1900, 0, 1, 0, 0, 0);

function parseDate(value, key) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`Invalid --${key}: ${value}`);
  return ms;
}

function loadIngressTables(path) {
  const src = fs.readFileSync(path, 'utf8');
  const out = {};

  function parseConstBody(name) {
    const start = src.indexOf(`pub const ${name}`);
    if (start < 0) return null;
    const open = src.indexOf('[', src.indexOf('= [', start));
    const close = src.indexOf('\n];', open);
    const body = src.slice(open + 1, close);
    return [...body.matchAll(/\((\d+),\s*(\d+)\)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  }

  for (const [key] of PLANETS) {
    const segmented = [];
    for (let i = 0; ; i++) {
      const entries = parseConstBody(`${key}_INGRESS_${i}`);
      if (!entries) break;
      segmented.push(...entries);
    }
    if (segmented.length > 0) {
      out[key] = segmented;
      continue;
    }

    const single = parseConstBody(`${key}_INGRESS`);
    if (!single) throw new Error(`Missing table for ${key}`);
    out[key] = single;
  }
  return out;
}

function lookupSign(entries, minute) {
  let lo = 0;
  let hi = entries.length - 1;
  if (minute < entries[0][0]) return entries[0][1];
  while (lo < hi) {
    const mid = lo + ((hi - lo + 1) >> 1);
    if (entries[mid][0] <= minute) lo = mid;
    else hi = mid - 1;
  }
  return entries[lo][1];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const start = parseDate(requireStringArg(args, 'start'), 'start');
  const end = parseDate(requireStringArg(args, 'end'), 'end');
  const stepMinutes = getNumberArg(args, 'step-minutes', 120);
  const quantizeMinutes = getNumberArg(args, 'quantize-minutes', 15);
  const latBin = getNumberArg(args, 'lat-bin', 377);
  const lonBin = getNumberArg(args, 'lon-bin', -1224);
  const tablePath = args['table-path'] || '../cairo/crates/astronomy_engine/src/oracle_signs.cairo';

  const tables = loadIngressTables(tablePath);
  const planetMismatch = Object.fromEntries(PLANETS.map(([, name]) => [name, 0]));
  let ascMismatch = 0;
  let samples = 0;

  for (let t = start; t <= end; t += stepMinutes * 60000) {
    const minute = Math.floor((t - EPOCH_1900_UNIX_MS) / 60000);
    const qMinute = Math.floor(minute / quantizeMinutes) * quantizeMinutes;
    const qMs = EPOCH_1900_UNIX_MS + qMinute * 60000;

    for (const [key, name] of PLANETS) {
      const runtimeSign = lookupSign(tables[key], qMinute);
      const oracleSign = oraclePlanetSign(name, qMs);
      if (runtimeSign !== oracleSign) planetMismatch[name] += 1;
    }

    const runtimeAsc = signFrom1e9(approximateAscendantLongitude1e9(qMinute, latBin, lonBin));
    const oracleAsc = oracleAscSign(qMs, latBin, lonBin);
    if (runtimeAsc !== oracleAsc) ascMismatch += 1;

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
