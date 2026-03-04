/**
 * Evaluate a Chebyshev series \sum c_k T_k(u) on u in [-1, 1].
 * Stable backward recurrence (Clenshaw).
 */
export function evalChebyshev(coeffs, u) {
  let bNext = 0;
  let bNext2 = 0;
  for (let k = coeffs.length - 1; k >= 1; k -= 1) {
    const b = 2 * u * bNext - bNext2 + coeffs[k];
    bNext2 = bNext;
    bNext = b;
  }
  return coeffs[0] + u * bNext - bNext2;
}

export function normalizeTimeToChebyshevDomain(unixMs, startUnixMs, endUnixMs) {
  if (endUnixMs <= startUnixMs) {
    throw new Error("Invalid block range: endUnixMs must be greater than startUnixMs");
  }
  const ratio = (unixMs - startUnixMs) / (endUnixMs - startUnixMs);
  return ratio * 2 - 1;
}
