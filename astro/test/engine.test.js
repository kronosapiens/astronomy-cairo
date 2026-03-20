import test from "node:test";
import assert from "node:assert/strict";
import { longitudeToSign, oracleAscLongitude, oracleAscSign, oraclePlanetLongitude } from "../src/engine.js";

const planets = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"];

function angularDifferenceDegrees(a, b) {
  let d = ((b - a + 540) % 360) - 180;
  if (d <= -180) d += 360;
  return d;
}

test("engine longitude function returns valid longitudes", () => {
  const t = Date.UTC(2026, 1, 24, 12, 0, 0);
  for (const planet of planets) {
    const lon = oraclePlanetLongitude(planet, t);
    assert.ok(Number.isFinite(lon), `${planet} finite`);
    assert.ok(lon >= 0 && lon < 360, `${planet} in [0,360)`);
  }
});

test("engine longitude function keeps Mercury/Venus near Sun", () => {
  const t = Date.UTC(2026, 1, 24, 12, 0, 0);
  const sun = oraclePlanetLongitude("Sun", t);
  const mercury = oraclePlanetLongitude("Mercury", t);
  const venus = oraclePlanetLongitude("Venus", t);
  assert.ok(Math.abs(angularDifferenceDegrees(sun, mercury)) <= 35);
  assert.ok(Math.abs(angularDifferenceDegrees(sun, venus)) <= 60);
});

test("oracleAscLongitude is consistent with oracleAscSign", () => {
  const locations = [
    { latBin: 407, lonBin: -740 },   // NYC
    { latBin: 312, lonBin: 299 },    // Alexandria
    { latBin: -338, lonBin: 1514 },  // Sydney
    { latBin: 0, lonBin: 0 },        // Equator/prime meridian
  ];
  const timestamps = [
    Date.UTC(2000, 0, 1, 0, 0),
    Date.UTC(2000, 0, 1, 12, 0),
    Date.UTC(2026, 5, 15, 6, 30),
    Date.UTC(1900, 0, 1, 18, 0),
  ];
  for (const t of timestamps) {
    for (const loc of locations) {
      const lon = oracleAscLongitude(t, loc.latBin, loc.lonBin);
      const sign = oracleAscSign(t, loc.latBin, loc.lonBin);
      assert.ok(Number.isFinite(lon), `lon finite at t=${t}`);
      assert.ok(lon >= 0 && lon < 360, `lon in [0,360) at t=${t}`);
      assert.equal(longitudeToSign(lon), sign, `sign matches at t=${t} lat=${loc.latBin} lon=${loc.lonBin}`);
    }
  }
});
