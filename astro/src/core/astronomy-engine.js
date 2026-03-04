import * as Astronomy from "astronomy-engine";

const BODY_MAP = {
  Sun: Astronomy.Body.Sun,
  Moon: Astronomy.Body.Moon,
  Mercury: Astronomy.Body.Mercury,
  Venus: Astronomy.Body.Venus,
  Mars: Astronomy.Body.Mars,
  Jupiter: Astronomy.Body.Jupiter,
  Saturn: Astronomy.Body.Saturn,
};

function normalizeDegrees(lon) {
  let out = lon % 360;
  if (out < 0) out += 360;
  return out;
}

export function longitudeToSign(lon) {
  return Math.floor(normalizeDegrees(lon) / 30);
}

export function oraclePlanetSign(planet, unixMs, { aberration = true } = {}) {
  const date = new Date(unixMs);
  if (planet === "Moon") return longitudeToSign(Astronomy.EclipticGeoMoon(date).lon);
  if (planet === "Sun") return longitudeToSign(Astronomy.SunPosition(date).elon);
  const body = BODY_MAP[planet];
  if (!body) throw new Error(`Unsupported planet: ${planet}`);
  return longitudeToSign(Astronomy.Ecliptic(Astronomy.GeoVector(body, date, aberration)).elon);
}

export function oracleAscSign(unixMs, latBin, lonBin) {
  const date = new Date(unixMs);
  const observer = new Astronomy.Observer(latBin / 10, lonBin / 10, 0);
  const time = Astronomy.MakeTime(date);
  const ectToEqd = Astronomy.Rotation_ECT_EQD(date);
  const eqdToHor = Astronomy.Rotation_EQD_HOR(date, observer);

  const exEqd = Astronomy.RotateVector(ectToEqd, new Astronomy.Vector(1, 0, 0, time));
  const eyEqd = Astronomy.RotateVector(ectToEqd, new Astronomy.Vector(0, 1, 0, time));
  const exHor = Astronomy.RotateVector(eqdToHor, exEqd);
  const eyHor = Astronomy.RotateVector(eqdToHor, eyEqd);

  let lon1 = normalizeDegrees((Math.atan2(-exHor.z, eyHor.z) * 180) / Math.PI);
  const lon2 = normalizeDegrees(lon1 + 180);

  function horizonYForEclipticLon(lonDeg) {
    const r = (lonDeg * Math.PI) / 180;
    const vecEct = new Astronomy.Vector(Math.cos(r), Math.sin(r), 0, time);
    const vecEqd = Astronomy.RotateVector(ectToEqd, vecEct);
    const vecHor = Astronomy.RotateVector(eqdToHor, vecEqd);
    return vecHor.y;
  }

  const y1 = horizonYForEclipticLon(lon1);
  const y2 = horizonYForEclipticLon(lon2);
  if (y2 < y1) lon1 = lon2;

  return longitudeToSign(lon1);
}

/**
 * Reference provider backed by astronomy-engine.
 * Returns geocentric true-ecliptic longitudes in [0, 360).
 */
export function createAstronomyEngineProvider({ aberration = true } = {}) {
  return {
    getLongitude(planet, unixMs) {
      const date = new Date(unixMs);
      if (planet === "Sun") return Astronomy.SunPosition(date).elon;
      if (planet === "Moon") return Astronomy.EclipticGeoMoon(date).lon;
      const body = BODY_MAP[planet];
      if (!body) throw new Error(`Unsupported planet: ${planet}`);
      return Astronomy.Ecliptic(Astronomy.GeoVector(body, date, aberration)).elon;
    },
  };
}
