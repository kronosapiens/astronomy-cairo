#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import * as Astronomy from 'astronomy-engine';

const PLANETS = ['Sun','Moon','Mercury','Venus','Mars','Jupiter','Saturn'];
const EPOCH = Date.UTC(1900,0,1,0,0,0);
const START = Date.UTC(1900,0,1,0,0,0);
const END = Date.UTC(2100,11,31,23,59,0);
const STEP_MS = 15 * 60 * 1000;
const MAX_SEGMENT_LEN = 8000;

function signOf(planet, unixMs) {
  const date = new Date(unixMs);
  if (planet === 'Moon') return Math.floor(Astronomy.EclipticGeoMoon(date).lon / 30);
  if (planet === 'Sun') return Math.floor(Astronomy.SunPosition(date).elon / 30);
  return Math.floor(Astronomy.Ecliptic(Astronomy.GeoVector(Astronomy.Body[planet], date, true)).elon / 30);
}

function buildIngress(planet) {
  const entries = [];
  let prev = -1;
  for (let t = START; t <= END; t += STEP_MS) {
    const s = signOf(planet, t);
    if (s !== prev) {
      const minute = Math.floor((t - EPOCH) / 60000);
      entries.push([minute, s]);
      prev = s;
    }
  }
  return entries;
}

function planetConstName(p) {
  return `${p.toUpperCase()}_INGRESS`;
}

function renderArray(name, entries) {
  const lines = [];
  lines.push(`pub const ${name}: [(u32, u8); ${entries.length}] = [`);
  for (const [minute, sign] of entries) {
    lines.push(`    (${minute}, ${sign}),`);
  }
  lines.push('];');
  return lines.join('\n');
}

function chunkEntries(entries, size) {
  const chunks = [];
  for (let i = 0; i < entries.length; i += size) {
    chunks.push(entries.slice(i, i + size));
  }
  return chunks;
}

function main() {
  const out = process.argv[2] || 'cairo/crates/astronomy_engine/src/oracle_signs.cairo';
  const ingress = Object.fromEntries(PLANETS.map((p) => [p, buildIngress(p)]));

  const parts = [];
  parts.push('use crate::types::{JUPITER, MARS, MERCURY, MOON, SATURN, SUN, VENUS};');
  parts.push('');

  const layout = {};
  for (const p of PLANETS) {
    const base = planetConstName(p);
    const entries = ingress[p];
    const chunks = chunkEntries(entries, MAX_SEGMENT_LEN);
    const names = chunks.map((_, i) => (chunks.length === 1 ? base : `${base}_${i}`));
    layout[p] = {
      base,
      names,
      starts: chunks.map((chunk) => chunk[0][0]),
    };
    for (let i = 0; i < chunks.length; i++) {
      parts.push(renderArray(names[i], chunks[i]));
      parts.push('');
    }
  }

  for (const p of PLANETS) {
    parts.push('');
  }

  parts.push(`fn lookup_sign(entries: Span<(u32, u8)>, minute: u32) -> u8 {`);
  parts.push(`    let len = entries.len();`);
  parts.push(`    if len == 0 { return 0; }`);
  parts.push(`    let first = *entries.at(0);`);
  parts.push(`    let (first_minute, first_sign) = first;`);
  parts.push(`    if minute < first_minute { return first_sign; }`);
  parts.push(`    let mut idx: usize = 1;`);
  parts.push(`    let mut found_sign: u8 = first_sign;`);
  parts.push(`    loop {`);
  parts.push(`        if idx >= len { break; }`);
  parts.push(`        let probe = *entries.at(idx);`);
  parts.push(`        let (probe_minute, probe_sign) = probe;`);
  parts.push(`        if probe_minute > minute { break; }`);
  parts.push(`        found_sign = probe_sign;`);
  parts.push(`        idx += 1;`);
  parts.push(`    };`);
  parts.push(`    found_sign`);
  parts.push(`}`);
  parts.push('');
  function emitPlanetLookup(planetConst, planetName) {
    const cfg = layout[planetName];
    const names = cfg.names;
    if (names.length === 1) {
      parts.push(`    if planet == ${planetConst} { return lookup_sign(${names[0]}.span(), minute); }`);
      return;
    }
    parts.push(`    if planet == ${planetConst} {`);
    for (let i = 1; i < names.length; i++) {
      parts.push(`        if minute < ${cfg.starts[i]} { return lookup_sign(${names[i - 1]}.span(), minute); }`);
    }
    parts.push(`        return lookup_sign(${names[names.length - 1]}.span(), minute);`);
    parts.push('    }');
  }

  parts.push('pub fn planet_sign_from_minute(planet: u8, minute: u32) -> u8 {');
  emitPlanetLookup('SUN', 'Sun');
  emitPlanetLookup('MOON', 'Moon');
  emitPlanetLookup('MERCURY', 'Mercury');
  emitPlanetLookup('VENUS', 'Venus');
  emitPlanetLookup('MARS', 'Mars');
  emitPlanetLookup('JUPITER', 'Jupiter');
  emitPlanetLookup('SATURN', 'Saturn');
  parts.push('    0');
  parts.push('}');

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, parts.join('\n'));

  const counts = Object.fromEntries(PLANETS.map((p) => [p, ingress[p].length]));
  console.log(JSON.stringify({ out, counts }, null, 2));
}

main();
