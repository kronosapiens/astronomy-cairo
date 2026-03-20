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

/**
 * Normalizes an angle in degrees into the canonical [0, 360) interval.
 *
 * @param {number} lon
 * @returns {number}
 */
function normalizeDegrees(lon) {
  let out = lon % 360;
  if (out < 0) out += 360;
  return out;
}

/**
 * Converts an ecliptic longitude in degrees into a zodiac sign index (0-11).
 *
 * @param {number} lon
 * @returns {number}
 */
export function longitudeToSign(lon) {
  return Math.floor(normalizeDegrees(lon) / 30);
}

/**
 * Computes geocentric true-ecliptic longitude (degrees) for a supported planet.
 * This always uses apparent positions for planets via `GeoVector(..., true)`.
 *
 * @param {"Sun"|"Moon"|"Mercury"|"Venus"|"Mars"|"Jupiter"|"Saturn"} planet
 * @param {number} unixMs
 * @returns {number}
 */
export function oraclePlanetLongitude(planet, unixMs) {
  const date = new Date(unixMs);
  if (planet === "Moon") return Astronomy.EclipticGeoMoon(date).lon;
  if (planet === "Sun") return Astronomy.SunPosition(date).elon;
  const body = BODY_MAP[planet];
  if (!body) throw new Error(`Unsupported planet: ${planet}`);
  return Astronomy.Ecliptic(Astronomy.GeoVector(body, date, true)).elon;
}

/**
 * Computes zodiac sign index (0-11) for a supported planet at a given UTC timestamp.
 * Uses apparent geocentric positions.
 *
 * @param {"Sun"|"Moon"|"Mercury"|"Venus"|"Mars"|"Jupiter"|"Saturn"} planet
 * @param {number} unixMs
 * @returns {number}
 */
export function oraclePlanetSign(planet, unixMs) {
  return longitudeToSign(oraclePlanetLongitude(planet, unixMs));
}

/**
 * Computes the ascendant sign index (0-11) for a location and UTC timestamp.
 * `latBin` and `lonBin` are in tenths of a degree.
 *
 * @param {number} unixMs
 * @param {number} latBin
 * @param {number} lonBin
 * @returns {number}
 */
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

  /**
   * Projects an ecliptic longitude to local horizon coordinates and returns
   * its signed west/east axis component (`y` in HOR frame).
   *
   * @param {number} lonDeg
   * @returns {number}
   */
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
 * Computes the ascendant ecliptic longitude (degrees) for a location and UTC timestamp.
 * `latBin` and `lonBin` are in tenths of a degree.
 *
 * @param {number} unixMs
 * @param {number} latBin
 * @param {number} lonBin
 * @returns {number}
 */
export function oracleAscLongitude(unixMs, latBin, lonBin) {
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

  return normalizeDegrees(lon1);
}
