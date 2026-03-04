import test from "node:test";
import assert from "node:assert/strict";
import { evalChebyshev, normalizeTimeToChebyshevDomain } from "../../src/legacy/math/clenshaw.js";

// f(u) = 5 + 2u  => c0=5, c1=2
test("evalChebyshev evaluates linear series", () => {
  assert.equal(evalChebyshev([5, 2], -1), 3);
  assert.equal(evalChebyshev([5, 2], 0), 5);
  assert.equal(evalChebyshev([5, 2], 1), 7);
});

test("normalizeTimeToChebyshevDomain maps endpoints", () => {
  const start = 1000;
  const end = 5000;
  assert.equal(normalizeTimeToChebyshevDomain(start, start, end), -1);
  assert.equal(normalizeTimeToChebyshevDomain((start + end) / 2, start, end), 0);
  assert.equal(normalizeTimeToChebyshevDomain(end, start, end), 1);
});
