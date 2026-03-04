import test from "node:test";
import assert from "node:assert/strict";
import { buildLongitudeArchive, createMockLongitude } from "../../src/legacy/pipeline/builder.js";
import { validateLongitudeArchive } from "../../src/legacy/pipeline/validate.js";

const start = Date.UTC(2025, 0, 1, 0, 0, 0);
const end = Date.UTC(2025, 0, 15, 0, 0, 0);

test("buildLongitudeArchive creates per-planet block series", () => {
  const archive = buildLongitudeArchive({
    rangeStartUnixMs: start,
    rangeEndUnixMs: end,
    referenceLongitude: createMockLongitude,
    version: "test-v0",
  });

  assert.equal(archive.version, "test-v0");
  assert.equal(archive.rangeStartUnixMs, start);
  assert.equal(archive.rangeEndUnixMs, end);
  for (const planet of ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"]) {
    assert.ok(archive.series[planet]);
    assert.ok(archive.series[planet].blocks.length > 0);
  }
});

test("validateLongitudeArchive reports low error for archive built from same provider", () => {
  const getLongitude = createMockLongitude;
  const archive = buildLongitudeArchive({
    rangeStartUnixMs: start,
    rangeEndUnixMs: end,
    referenceLongitude: getLongitude,
  });
  const report = validateLongitudeArchive(archive, getLongitude, { stepMinutes: 30 });

  for (const planet of Object.keys(report.results)) {
    const r = report.results[planet];
    assert.equal(r.signMismatches, 0, `${planet} sign mismatches`);
    assert.ok(r.maxError < 0.2, `${planet} maxError=${r.maxError}`);
  }
});
