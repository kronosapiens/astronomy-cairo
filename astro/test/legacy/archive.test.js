import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePlanetLongitude, signFromLongitude } from "../../src/legacy/archive.js";

const start = Date.UTC(2000, 0, 1);
const end = Date.UTC(2000, 0, 2);

const mockArchive = {
  version: "test",
  epochUnixMs: start,
  rangeStartUnixMs: start,
  rangeEndUnixMs: end,
  series: {
    Sun: {
      planet: "Sun",
      config: { blockDays: 1, order: 1 },
      blocks: [
        {
          startUnixMs: start,
          endUnixMs: end,
          // L(u) = 350 + 20u
          coeffs: [350, 20],
        },
      ],
    },
  },
};

test("evaluatePlanetLongitude evaluates and wraps angles", () => {
  const atStart = evaluatePlanetLongitude(mockArchive, "Sun", start);
  const atEnd = evaluatePlanetLongitude(mockArchive, "Sun", end);
  assert.equal(atStart, 330);
  assert.equal(atEnd, 10);
});

test("signFromLongitude maps to zodiac sign indices", () => {
  assert.equal(signFromLongitude(0), 0);
  assert.equal(signFromLongitude(29.999), 0);
  assert.equal(signFromLongitude(30), 1);
  assert.equal(signFromLongitude(359.999), 11);
});
