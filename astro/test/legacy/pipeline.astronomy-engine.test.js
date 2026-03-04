import test from "node:test";
import assert from "node:assert/strict";
import { oraclePlanetLongitude } from "../../src/engine.js";
import { buildLongitudeArchive } from "../../src/legacy/pipeline/builder.js";
import { validateLongitudeArchive } from "../../src/legacy/pipeline/validate.js";

test("pipeline builds and validates with astronomy-engine provider", () => {
  const start = Date.UTC(2026, 0, 1, 0, 0, 0);
  const end = Date.UTC(2026, 0, 8, 0, 0, 0);

  const archive = buildLongitudeArchive({
    rangeStartUnixMs: start,
    rangeEndUnixMs: end,
    referenceLongitude: oraclePlanetLongitude,
    version: "ae-smoke",
  });

  const report = validateLongitudeArchive(archive, oraclePlanetLongitude, { stepMinutes: 60 });
  for (const [planet, metrics] of Object.entries(report.results)) {
    assert.equal(metrics.signMismatches, 0, `${planet} sign mismatches`);
    assert.ok(metrics.maxError < 0.25, `${planet} maxError=${metrics.maxError}`);
  }
});
