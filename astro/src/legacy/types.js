export const PLANETS = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"];

/** @typedef {"Sun"|"Moon"|"Mercury"|"Venus"|"Mars"|"Jupiter"|"Saturn"} PlanetId */

/**
 * @typedef {Object} PlanetFitConfig
 * @property {number} blockDays
 * @property {number} order
 */

/**
 * @typedef {Object} CoefficientBlock
 * @property {number} startUnixMs
 * @property {number} endUnixMs
 * @property {number[]} coeffs
 */

/**
 * @typedef {Object} PlanetSeries
 * @property {PlanetId} planet
 * @property {PlanetFitConfig} config
 * @property {CoefficientBlock[]} blocks
 */

/**
 * @typedef {Object} LongitudeArchive
 * @property {string} version
 * @property {number} epochUnixMs
 * @property {number} rangeStartUnixMs
 * @property {number} rangeEndUnixMs
 * @property {Record<PlanetId, PlanetSeries>} series
 */
