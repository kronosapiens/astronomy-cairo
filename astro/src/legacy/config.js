/** @type {import('./types.js').PlanetFitConfig} */
const moon = { blockDays: 1, order: 12 };
/** @type {import('./types.js').PlanetFitConfig} */
const inner = { blockDays: 4, order: 10 };
/** @type {import('./types.js').PlanetFitConfig} */
const sun = { blockDays: 16, order: 8 };
/** @type {import('./types.js').PlanetFitConfig} */
const mars = { blockDays: 12, order: 8 };
/** @type {import('./types.js').PlanetFitConfig} */
const outer = { blockDays: 24, order: 6 };
/** @type {import('./types.js').PlanetFitConfig} */
const saturn = { blockDays: 32, order: 6 };

/** @type {Record<import('./types.js').PlanetId, import('./types.js').PlanetFitConfig>} */
export const PLANET_FIT_CONFIG = {
  Sun: sun,
  Moon: moon,
  Mercury: inner,
  Venus: inner,
  Mars: mars,
  Jupiter: outer,
  Saturn: saturn,
};

export const ARCHIVE_VERSION = "chart-ephem-v0";
