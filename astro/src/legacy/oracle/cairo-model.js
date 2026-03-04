import * as Astronomy from "astronomy-engine";

export const SCALE = 1e9;
const DEG360 = 360 * SCALE;
const J2000_MINUTE_SINCE_1900 = 52595280;
const JULIAN_CENTURY_DAYS = 36525;
const ATAN_RATIO_1E4_DEG_1E9 = Array.from({ length: 10001 }, (_, i) =>
  Math.round((Math.atan(i / 10000) * 180 * SCALE) / Math.PI),
);

function norm360(x) {
  let y = x % DEG360;
  if (y < 0) y += DEG360;
  return y;
}

function sinDeg1e9(a1e9) {
  const a = norm360(a1e9);
  const step = 50_000_000; // 0.05 degree
  const idx = Math.floor(a / step);
  const frac = a % step;
  const v0 = Math.round(Math.sin((idx / 20) * (Math.PI / 180)) * SCALE);
  const nextIdx = idx === 7200 ? 0 : idx + 1;
  const v1 = Math.round(Math.sin((nextIdx / 20) * (Math.PI / 180)) * SCALE);
  return Math.trunc(v0 + ((v1 - v0) * frac) / step);
}

function cosDeg1e9(a1e9) {
  return sinDeg1e9(a1e9 + 90 * SCALE);
}

function atan2Deg1e9(y1e9, x1e9) {
  if (x1e9 === 0) {
    if (y1e9 > 0) return 90 * SCALE;
    if (y1e9 < 0) return -90 * SCALE;
    return 0;
  }

  function atanUnitDeg1e9(z1e9) {
    const zAbs = Math.abs(z1e9);
    const step = 100_000; // 1e9 / 10000
    const idx = Math.floor(zAbs / step);
    const frac = zAbs % step;
    const v0 = ATAN_RATIO_1E4_DEG_1E9[idx];
    const v1 = ATAN_RATIO_1E4_DEG_1E9[Math.min(idx + 1, 10000)];
    const out = Math.trunc(v0 + ((v1 - v0) * frac) / step);
    return z1e9 < 0 ? -out : out;
  }

  const zAbs = Math.abs(y1e9);
  const xAbs = Math.abs(x1e9);
  const base =
    zAbs <= xAbs
      ? atanUnitDeg1e9(Math.trunc((zAbs * SCALE) / xAbs))
      : 90 * SCALE - atanUnitDeg1e9(Math.trunc((xAbs * SCALE) / zAbs));

  const q1 = y1e9 < 0 ? -base : base;
  const q1Abs = Math.abs(q1);
  if (x1e9 > 0) return q1;
  if (y1e9 >= 0) return 180 * SCALE - q1Abs;
  return -180 * SCALE + q1Abs;
}

function daysSinceJ2000_1e9(minuteSince1900) {
  return Math.round(((minuteSince1900 - J2000_MINUTE_SINCE_1900) * SCALE) / 1440);
}

function linearLongitude1e9(l0, rate, d) {
  const delta = Math.trunc((rate * d) / SCALE);
  return norm360(l0 + delta);
}

function geocentricCoplanarLongitude1e9(l0Planet, ratePlanet, radiusPlanet, d) {
  const lp = linearLongitude1e9(l0Planet, ratePlanet, d);
  const le = linearLongitude1e9(100_374_527_911, 985_647_360, d);
  const rp = radiusPlanet;
  const re = 1_000_000_000;

  const xp = Math.trunc((rp * cosDeg1e9(lp)) / SCALE);
  const yp = Math.trunc((rp * sinDeg1e9(lp)) / SCALE);
  const xe = Math.trunc((re * cosDeg1e9(le)) / SCALE);
  const ye = Math.trunc((re * sinDeg1e9(le)) / SCALE);

  return norm360(atan2Deg1e9(yp - ye, xp - xe));
}

function heliocentricElliptic1e9({
  l0,
  rate,
  peri,
  ecc,
  c1,
  c2,
  c3,
  radiusAu,
  d,
}) {
  const L = linearLongitude1e9(l0, rate, d);
  const M = norm360(L - peri);
  const C =
    Math.trunc((c1 * sinDeg1e9(M)) / SCALE) +
    Math.trunc((c2 * sinDeg1e9(2 * M)) / SCALE) +
    Math.trunc((c3 * sinDeg1e9(3 * M)) / SCALE);
  const v = norm360(M + C);
  const lon = norm360(v + peri);

  const e2 = Math.trunc((ecc * ecc) / SCALE);
  const rBase = Math.trunc((radiusAu * (SCALE - e2)) / SCALE);
  const den = SCALE + Math.trunc((ecc * cosDeg1e9(v)) / SCALE);
  const r = Math.trunc((rBase * SCALE) / den);

  return { lon, r };
}

function geocentricEllipticLongitude1e9(spec, d) {
  const earth = heliocentricElliptic1e9({
    l0: 100_374_527_911,
    rate: 985_647_360,
    peri: 102_937_348_000,
    ecc: 16_709_000,
    c1: 1_914_643_539,
    c2: 19_995_560,
    c3: 289_558,
    radiusAu: 1_000_000_000,
    d,
  });
  const p = heliocentricElliptic1e9({ ...spec, d });
  const xp = Math.trunc((p.r * cosDeg1e9(p.lon)) / SCALE);
  const yp = Math.trunc((p.r * sinDeg1e9(p.lon)) / SCALE);
  const xe = Math.trunc((earth.r * cosDeg1e9(earth.lon)) / SCALE);
  const ye = Math.trunc((earth.r * sinDeg1e9(earth.lon)) / SCALE);
  let lon = norm360(atan2Deg1e9(yp - ye, xp - xe));
  if (spec.name === "Mercury") {
    const corr = Math.trunc(
      (-100_000_000 * sinDeg1e9(norm360(earth.lon + 260_000_000_000))) / SCALE,
    );
    lon = norm360(lon + corr - 200_000_000);
  } else if (spec.name === "Venus") {
    const corr = Math.trunc(
      (-200_000_000 * sinDeg1e9(norm360(earth.lon + 283_000_000_000))) / SCALE,
    );
    lon = norm360(lon + corr + 200_000_000);
  } else if (spec.name === "Mars") {
    const corrE = Math.trunc(
      (-2_300_000_000 * sinDeg1e9(norm360(earth.lon + 330_000_000_000))) / SCALE,
    );
    lon = norm360(lon + corrE - 2_500_000_000);
  } else if (spec.name === "Jupiter") {
    lon = norm360(lon - 1_000_000_000);
  }
  return lon;
}

function sunLongitude1e9(d) {
  const q = linearLongitude1e9(280_459_000_000, 985_647_360, d);
  const g = linearLongitude1e9(357_529_000_000, 985_600_280, d);
  const c1 = Math.trunc((1_915_000_000 * sinDeg1e9(g)) / SCALE);
  const c2 = Math.trunc((20_000_000 * sinDeg1e9(2 * g)) / SCALE);
  return norm360(q + c1 + c2);
}

function moonLongitude1e9(d) {
  const l0 = linearLongitude1e9(218_316_000_000, 13_176_396_000, d);
  const mm = linearLongitude1e9(134_963_000_000, 13_064_993_000, d);
  const ms = linearLongitude1e9(357_529_000_000, 985_600_280, d);
  const D = linearLongitude1e9(297_850_000_000, 12_190_749_000, d);
  const t1 = Math.trunc((6_289_000_000 * sinDeg1e9(mm)) / SCALE);
  const t2 = Math.trunc((1_274_000_000 * sinDeg1e9(2 * D - mm)) / SCALE);
  const t3 = Math.trunc((658_000_000 * sinDeg1e9(2 * D)) / SCALE);
  const t4 = Math.trunc((214_000_000 * sinDeg1e9(2 * mm)) / SCALE);
  const t5 = Math.trunc((186_000_000 * sinDeg1e9(ms)) / SCALE);
  let lon = norm360(l0 + t1 + t2 + t3 + t4 - t5);
  const earthLon = linearLongitude1e9(100_374_527_911, 985_647_360, d);
  const moonCorr = Math.trunc(
    (-100_000_000 * sinDeg1e9(norm360(earthLon + 330_000_000_000))) / SCALE,
  );
  lon = norm360(lon + moonCorr);
  return lon;
}

function mercuryLongitude1e9(d) {
  return geocentricEllipticLongitude1e9(
    {
      name: "Mercury",
      l0: 253_780_862_243,
      rate: 4_092_334_450,
      peri: 77_457_796_000,
      ecc: 205_635_000,
      c1: 23_439_482_368,
      c2: 3_028_493_992,
      c3: 539_729_114,
      radiusAu: 387_098_000,
    },
    d,
  );
}

function venusLongitude1e9(d) {
  return geocentricEllipticLongitude1e9(
    {
      name: "Venus",
      l0: 182_600_299_821,
      rate: 1_602_130_340,
      peri: 131_602_467_000,
      ecc: 6_773_000,
      c1: 776_124_179,
      c2: 3_285_450,
      c3: 19_285,
      radiusAu: 723_330_000,
    },
    d,
  );
}

function marsLongitude1e9(d) {
  return geocentricEllipticLongitude1e9(
    {
      name: "Mars",
      l0: 359_444_576_577,
      rate: 524_020_680,
      peri: 336_040_840_000,
      ecc: 93_405_000,
      c1: 10_691_751_825,
      c2: 624_845_858,
      c3: 50_581_897,
      radiusAu: 1_523_688_000,
    },
    d,
  );
}

function jupiterLongitude1e9(d) {
  return geocentricEllipticLongitude1e9(
    {
      name: "Jupiter",
      l0: 36_291_436_588,
      rate: 83_085_290,
      peri: 14_331_207_000,
      ecc: 48_498_000,
      c1: 5_555_827_497,
      c2: 168_453_603,
      c3: 7_080_374,
      radiusAu: 5_202_560_000,
    },
    d,
  );
}

function saturnLongitude1e9(d) {
  return norm360(
    geocentricCoplanarLongitude1e9(45_718_865_585, 33_444_140, 9_554_750_000, d) - 1_000_000_000,
  );
}

export function approximatePlanetLongitude1e9(planet, minuteSince1900) {
  const d = daysSinceJ2000_1e9(minuteSince1900);
  switch (planet) {
    case "Sun":
      return sunLongitude1e9(d);
    case "Moon":
      return moonLongitude1e9(d);
    case "Mercury":
      return mercuryLongitude1e9(d);
    case "Venus":
      return venusLongitude1e9(d);
    case "Mars":
      return marsLongitude1e9(d);
    case "Jupiter":
      return jupiterLongitude1e9(d);
    case "Saturn":
      return saturnLongitude1e9(d);
    default:
      throw new Error(`Unsupported planet ${planet}`);
  }
}

export function approximateAscendantLongitude1e9(minuteSince1900, latBin, lonBin) {
  const d = daysSinceJ2000_1e9(minuteSince1900);
  const gmstDelta = Math.trunc((360_985_647_366 * d) / SCALE);
  const t = Math.trunc(d / JULIAN_CENTURY_DAYS);
  const t2 = Math.trunc((t * t) / SCALE);
  const t3 = Math.trunc((t2 * t) / SCALE);
  const gmstT2 = Math.trunc((387_933 * t2) / SCALE);
  const gmstT3 = Math.trunc((26 * t3) / SCALE);
  const epsT1 = Math.trunc((-13_004_167 * t) / SCALE);
  const epsT2 = Math.trunc((-164 * t2) / SCALE);
  const epsT3 = Math.trunc((504 * t3) / SCALE);
  const epsilon = 23_439_291_111 + epsT1 + epsT2 + epsT3;

  const omega = norm360(125_044_520_000 - Math.trunc((1_934_136_261_000 * t) / SCALE));
  const lSun = norm360(280_466_500_000 + Math.trunc((36_000_769_800_000 * t) / SCALE));
  const lMoon = norm360(218_316_500_000 + Math.trunc((481_267_881_300_000 * t) / SCALE));
  const deltaPsi =
    Math.trunc((-4_777_778 * sinDeg1e9(omega)) / SCALE) +
    Math.trunc((-366_667 * sinDeg1e9(2 * lSun)) / SCALE) +
    Math.trunc((-63_889 * sinDeg1e9(2 * lMoon)) / SCALE) +
    Math.trunc((58_333 * sinDeg1e9(2 * omega)) / SCALE);
  const deltaEps =
    Math.trunc((2_555_556 * cosDeg1e9(omega)) / SCALE) +
    Math.trunc((158_333 * cosDeg1e9(2 * lSun)) / SCALE) +
    Math.trunc((27_778 * cosDeg1e9(2 * lMoon)) / SCALE) +
    Math.trunc((-25_000 * cosDeg1e9(2 * omega)) / SCALE);
  const epsilonTrue = epsilon + deltaEps;
  const eqeq = Math.trunc((deltaPsi * cosDeg1e9(epsilonTrue)) / SCALE);

  const lonDeg = lonBin * 100_000_000;
  const lst = norm360(280_460_618_370 + gmstDelta + gmstT2 - gmstT3 + eqeq + lonDeg);
  const lat = latBin * 100_000_000;

  const sinTheta = sinDeg1e9(lst);
  const cosTheta = cosDeg1e9(lst);
  const sinEps = sinDeg1e9(epsilonTrue);
  const cosEps = cosDeg1e9(epsilonTrue);
  const sinLat = sinDeg1e9(lat);
  const cosLat = cosDeg1e9(lat);

  const tanLat = Math.trunc((sinLat * SCALE) / cosLat);
  const term = Math.trunc((sinTheta * cosEps) / SCALE) + Math.trunc((tanLat * sinEps) / SCALE);
  const y = -cosTheta;
  const x = term;
  let lam = norm360(atan2Deg1e9(y, x) + 180 * SCALE);

  // Pick eastern intersection branch (HOR y axis points west).
  const sinLam = sinDeg1e9(lam);
  const cosLam = cosDeg1e9(lam);
  const yEq = Math.trunc((sinLam * cosEps) / SCALE);
  const yWest = Math.trunc((sinTheta * cosLam) / SCALE) - Math.trunc((cosTheta * yEq) / SCALE);
  if (yWest > 0) {
    lam = norm360(lam + 180 * SCALE);
  }
  return lam;
}

export function signFrom1e9(lon1e9) {
  return Math.floor(norm360(lon1e9) / (30 * SCALE));
}

export function oraclePlanetSign(planet, unixMs) {
  const date = new Date(unixMs);
  if (planet === "Moon") return Math.floor(Astronomy.EclipticGeoMoon(date).lon / 30);
  if (planet === "Sun") return Math.floor(Astronomy.SunPosition(date).elon / 30);
  const body = Astronomy.Body[planet];
  return Math.floor(Astronomy.Ecliptic(Astronomy.GeoVector(body, date, true)).elon / 30);
}

export function oracleAscSign(unixMs, latBin, lonBin) {
  const date = new Date(unixMs);
  const observer = new Astronomy.Observer(latBin / 10, lonBin / 10, 0);
  const time = Astronomy.MakeTime(date);
  const ectToEqd = Astronomy.Rotation_ECT_EQD(date);
  const eqdToHor = Astronomy.Rotation_EQD_HOR(date, observer);

  const exEqd = Astronomy.RotateVector(ectToEqd, new Astronomy.Vector(1, 0, 0, time));
  const eyEqd = Astronomy.RotateVector(ectToEqd, new Astronomy.Vector(0, 1, 0, time));
  const exHor = Astronomy.RotateVector(eqdToHor, exEqd);
  const eyHor = Astronomy.RotateVector(eqdToHor, eyEqd);

  let lon1 = ((Math.atan2(-exHor.z, eyHor.z) * 180) / Math.PI) % 360;
  if (lon1 < 0) lon1 += 360;
  let lon2 = (lon1 + 180) % 360;

  function horizonYForEclipticLon(lonDeg) {
    const r = (lonDeg * Math.PI) / 180;
    const vecEct = new Astronomy.Vector(Math.cos(r), Math.sin(r), 0, time);
    const vecEqd = Astronomy.RotateVector(ectToEqd, vecEct);
    const vecHor = Astronomy.RotateVector(eqdToHor, vecEqd);
    return vecHor.y;
  }

  const y1 = horizonYForEclipticLon(lon1);
  const y2 = horizonYForEclipticLon(lon2);
  if (y2 < y1) lon1 = lon2;

  return Math.floor(lon1 / 30);
}
