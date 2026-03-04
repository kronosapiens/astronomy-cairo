import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDegrees, unwrapDegreesTrack } from "../../src/legacy/math/angles.js";

test("normalizeDegrees keeps values in [0,360)", () => {
  assert.equal(normalizeDegrees(370), 10);
  assert.equal(normalizeDegrees(-10), 350);
});

test("unwrapDegreesTrack avoids discontinuities", () => {
  const unwrapped = unwrapDegreesTrack([350, 355, 2, 8]);
  assert.deepEqual(unwrapped, [350, 355, 362, 368]);
});
