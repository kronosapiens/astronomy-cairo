import { PLANETS } from "../types.js";
import { PLANET_FIT_CONFIG, ARCHIVE_VERSION } from "../config.js";
import { fitChebyshev } from "../math/fit.js";
import { angularDifferenceDegrees, normalizeDegrees } from "../math/angles.js";

const DAY_MS = 86400000;

/**
 * @param {Object} opts
 * @param {number} opts.rangeStartUnixMs
 * @param {number} opts.rangeEndUnixMs
 * @param {(planet: import('../types.js').PlanetId, unixMs: number) => number} opts.referenceLongitude
 * @param {number} [opts.epochUnixMs]
 * @param {Record<import('../types.js').PlanetId, import('../types.js').PlanetFitConfig>} [opts.planetConfig]
 * @param {string} [opts.version]
 * @returns {import('../types.js').LongitudeArchive}
 */
export function buildLongitudeArchive({
  rangeStartUnixMs,
  rangeEndUnixMs,
  referenceLongitude,
  epochUnixMs = rangeStartUnixMs,
  planetConfig = PLANET_FIT_CONFIG,
  version = ARCHIVE_VERSION,
}) {
  if (rangeEndUnixMs <= rangeStartUnixMs) {
    throw new Error("rangeEndUnixMs must be greater than rangeStartUnixMs");
  }
  if (typeof referenceLongitude !== "function") {
    throw new Error("referenceLongitude is required");
  }

  /** @type {import('../types.js').LongitudeArchive['series']} */
  const series = /** @type {any} */ ({});

  for (const planet of PLANETS) {
    const cfg = planetConfig[planet];
    const blockMs = cfg.blockDays * DAY_MS;
    const blocks = [];
    let blockStart = rangeStartUnixMs;

    while (blockStart < rangeEndUnixMs) {
      const blockEnd = Math.min(blockStart + blockMs, rangeEndUnixMs);
      const mid = blockStart + (blockEnd - blockStart) / 2;
      const midLongitude = referenceLongitude(planet, mid);

      const coeffs = fitChebyshev(cfg.order, (u) => {
        const unixMs = blockStart + ((u + 1) / 2) * (blockEnd - blockStart);
        const rawLongitude = referenceLongitude(planet, unixMs);
        const delta = angularDifferenceDegrees(midLongitude, rawLongitude);
        return midLongitude + delta;
      });

      blocks.push({
        startUnixMs: blockStart,
        endUnixMs: blockEnd,
        coeffs,
      });
      blockStart = blockEnd;
    }

    series[planet] = {
      planet,
      config: cfg,
      blocks,
    };
  }

  return {
    version,
    epochUnixMs,
    rangeStartUnixMs,
    rangeEndUnixMs,
    series: /** @type {any} */ (series),
  };
}

export function createMockLongitude(planet, unixMs) {
  const d = unixMs / DAY_MS;
  switch (planet) {
    case "Sun":
      return normalizeDegrees(280 + 0.9856 * d);
    case "Moon":
      return normalizeDegrees(218 + 13.1764 * d + 6 * Math.sin((2 * Math.PI * d) / 27.321661));
    case "Mercury":
      return normalizeDegrees(252 + 4.0923 * d + 3 * Math.sin((2 * Math.PI * d) / 88));
    case "Venus":
      return normalizeDegrees(181 + 1.6021 * d + 2 * Math.sin((2 * Math.PI * d) / 225));
    case "Mars":
      return normalizeDegrees(355 + 0.5240 * d + 1.5 * Math.sin((2 * Math.PI * d) / 687));
    case "Jupiter":
      return normalizeDegrees(34 + 0.0831 * d + 0.4 * Math.sin((2 * Math.PI * d) / 4333));
    case "Saturn":
      return normalizeDegrees(50 + 0.0335 * d + 0.3 * Math.sin((2 * Math.PI * d) / 10759));
    default:
      throw new Error(`Unsupported planet: ${planet}`);
  }
}
