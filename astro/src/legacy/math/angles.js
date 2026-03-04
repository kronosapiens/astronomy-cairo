export function normalizeDegrees(value) {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

export function angularDifferenceDegrees(a, b) {
  return ((b - a + 540) % 360) - 180;
}

export function unwrapDegreesTrack(values) {
  if (values.length === 0) return [];
  const out = [values[0]];
  for (let i = 1; i < values.length; i += 1) {
    const prev = out[i - 1];
    let candidate = values[i];
    while (candidate - prev > 180) candidate -= 360;
    while (candidate - prev < -180) candidate += 360;
    out.push(candidate);
  }
  return out;
}
