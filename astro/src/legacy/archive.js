import { evalChebyshev, normalizeTimeToChebyshevDomain } from "./math/clenshaw.js";
import { normalizeDegrees } from "./math/angles.js";

export function findBlock(series, unixMs) {
  return series.blocks.find((b) => unixMs >= b.startUnixMs && unixMs <= b.endUnixMs) ?? null;
}

export function evaluatePlanetLongitude(archive, planet, unixMs) {
  const series = archive.series[planet];
  if (!series) throw new Error(`Missing planet series: ${planet}`);
  const block = findBlock(series, unixMs);
  if (!block) throw new Error(`No coefficient block for ${planet} at ${unixMs}`);
  const u = normalizeTimeToChebyshevDomain(unixMs, block.startUnixMs, block.endUnixMs);
  const unwrapped = evalChebyshev(block.coeffs, u);
  return normalizeDegrees(unwrapped);
}

export function signFromLongitude(longitudeDegrees) {
  return Math.floor(normalizeDegrees(longitudeDegrees) / 30);
}
