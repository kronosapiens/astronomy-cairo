import test from "node:test";
import assert from "node:assert/strict";
import { oraclePlanetLongitude } from "../src/engine.js";

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
