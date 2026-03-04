import { evalChebyshev } from "./clenshaw.js";

/**
 * Fit Chebyshev coefficients c_0..c_n from an evaluator f(u), u in [-1,1].
 * Uses interpolation at first-kind roots with DCT-like coefficient recovery.
 */
export function fitChebyshev(order, evaluateAtU) {
  if (order < 0) throw new Error("order must be >= 0");
  const m = order + 1;
  const values = [];

  for (let j = 0; j < m; j += 1) {
    const u = Math.cos((Math.PI * (j + 0.5)) / m);
    values.push(evaluateAtU(u));
  }

  const coeffs = new Array(m).fill(0);
  for (let k = 0; k < m; k += 1) {
    let sum = 0;
    for (let j = 0; j < m; j += 1) {
      sum += values[j] * Math.cos((Math.PI * k * (j + 0.5)) / m);
    }
    coeffs[k] = (2 / m) * sum;
  }
  coeffs[0] *= 0.5;
  return coeffs;
}

export function maxSeriesError(coeffs, evaluateAtU, samples = 256) {
  let maxError = 0;
  for (let i = 0; i <= samples; i += 1) {
    const u = -1 + (2 * i) / samples;
    const truth = evaluateAtU(u);
    const estimate = evalChebyshev(coeffs, u);
    const err = Math.abs(estimate - truth);
    if (err > maxError) maxError = err;
  }
  return maxError;
}
