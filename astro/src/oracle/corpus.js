import { oracleAscSign, oraclePlanetSign } from "../engine.js";

const PLANETS = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"];

export const EPOCH_1900_UNIX_MS = Date.UTC(1900, 0, 1, 0, 0, 0);

export function minuteSince1900(unixMs) {
  return Math.floor((unixMs - EPOCH_1900_UNIX_MS) / 60_000);
}

export function minuteToUnixMs(minute) {
  return EPOCH_1900_UNIX_MS + minute * 60_000;
}

export function generateSignCorpus({
  startUnixMs,
  endUnixMs,
  stepMinutes,
  latBins,
  lonBins,
}) {
  if (!Number.isFinite(startUnixMs) || !Number.isFinite(endUnixMs) || startUnixMs > endUnixMs) {
    throw new Error("Invalid [startUnixMs, endUnixMs] range");
  }
  if (!Number.isInteger(stepMinutes) || stepMinutes <= 0) {
    throw new Error(`Invalid stepMinutes=${stepMinutes}`);
  }
  if (!Array.isArray(latBins) || latBins.length === 0) {
    throw new Error("latBins must be a non-empty array");
  }
  if (!Array.isArray(lonBins) || lonBins.length === 0) {
    throw new Error("lonBins must be a non-empty array");
  }

  const entries = [];
  const stepMs = stepMinutes * 60_000;

  for (let t = startUnixMs; t <= endUnixMs; t += stepMs) {
    const minute = minuteSince1900(t);
    const sampleUnixMs = minuteToUnixMs(minute);

    for (const latBin of latBins) {
      for (const lonBin of lonBins) {
        const planet_sign = PLANETS.map((planet) =>
          oraclePlanetSign(planet, sampleUnixMs),
        );
        const asc_sign = oracleAscSign(sampleUnixMs, latBin, lonBin);

        entries.push({
          time_minute: minute,
          lat_bin: latBin,
          lon_bin: lonBin,
          planet_sign,
          asc_sign,
        });
      }
    }
  }

  return {
    meta: {
      epoch: "1900-01-01T00:00:00Z",
      time_unit: "minute_since_1900",
      minute_resolution: 1,
      range: { startUnixMs, endUnixMs, stepMinutes },
      lat_bin_unit: "0.01_degree",
      lon_bin_unit: "0.01_degree",
      planets: PLANETS,
      apparent_positions: true,
    },
    entries,
  };
}
