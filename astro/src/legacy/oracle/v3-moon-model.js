import fs from "node:fs";

const SCALE = 1_000_000_000n;
const DEG360 = 360n * SCALE;
const J2000_MINUTE_SINCE_1900 = 52_595_280n;
const ENV_BIAS_A = process.env.MOON_BIAS_A_DEG_1E9;
const ENV_BIAS_B = process.env.MOON_BIAS_B_DEG_1E9_PER_CENTURY;
const ENV_BIAS_C = process.env.MOON_BIAS_C_DEG_1E9_PER_CENTURY2;
const MOON_LON_PARITY_OFFSET_A_DEG_1E9 = ENV_BIAS_A ? BigInt(ENV_BIAS_A) : 0n;
const MOON_LON_PARITY_OFFSET_B_DEG_1E9_PER_CENTURY = ENV_BIAS_B ? BigInt(ENV_BIAS_B) : 0n;
const MOON_LON_PARITY_OFFSET_C_DEG_1E9_PER_CENTURY2 = ENV_BIAS_C ? BigInt(ENV_BIAS_C) : 0n;

const MOON_TERMS_PATH = new URL("../../../../cairo/crates/astronomy_engine_v4/src/moon_terms.cairo", import.meta.url);

function parseConstArrayRows(source, constName) {
  const start = source.indexOf(`pub const ${constName}`);
  if (start < 0) {
    throw new Error(`Missing ${constName} in ${MOON_TERMS_PATH.pathname}`);
  }
  const assign = source.indexOf("= [", start);
  const open = source.indexOf("[", assign);
  const close = source.indexOf("\n];", open);
  if (assign < 0 || open < 0 || close < 0) {
    throw new Error(`Malformed ${constName} declaration`);
  }
  const body = source.slice(open + 1, close);
  return [...body.matchAll(/\(([^)]*)\)/g)].map((m) =>
    m[1].split(",").map((tok) => Number(tok.trim())),
  );
}

const moonTermsSource = fs.readFileSync(MOON_TERMS_PATH, "utf8");
const MOON_SOLAR_TERMS = parseConstArrayRows(moonTermsSource, "MOON_SOLAR_TERMS");
if (MOON_SOLAR_TERMS.length !== 104) {
  throw new Error(`Expected 104 moon solar terms, found ${MOON_SOLAR_TERMS.length}`);
}

function idiv(a, b) {
  return a / b;
}

function norm360_1e9(a) {
  let r = a % DEG360;
  if (r < 0n) r += DEG360;
  return r;
}

function frac_1e9(a) {
  let r = a % SCALE;
  if (r < 0n) r += SCALE;
  return r;
}

const SIN_TWENTIETH_DEG_1E9 = Array.from({ length: 7201 }, (_, i) =>
  Math.round(Math.sin((i / 20) * (Math.PI / 180)) * 1e9),
);

function sinDeg_1e9(angleDeg_1e9) {
  const a = Number(norm360_1e9(BigInt(angleDeg_1e9)));
  const step = 50_000_000;
  const idx = Math.floor(a / step);
  const frac = a % step;
  const v0 = SIN_TWENTIETH_DEG_1E9[idx];
  const v1 = SIN_TWENTIETH_DEG_1E9[idx === 7200 ? 0 : idx + 1];
  return BigInt(Math.trunc(v0 + ((v1 - v0) * frac) / step));
}

function cosDeg_1e9(angleDeg_1e9) {
  return sinDeg_1e9(BigInt(angleDeg_1e9) + 90n * SCALE);
}

function turnToDeg_1e9(turn_1e9) {
  return turn_1e9 * 360n;
}

function sineTurn_1e9(turn_1e9) {
  return sinDeg_1e9(turnToDeg_1e9(frac_1e9(turn_1e9)));
}

function turnLinearScaled_1e9(offsetTurn_1e9, rateTurnPerCentury_1e9, tScaled, tScale) {
  return frac_1e9(BigInt(offsetTurn_1e9) + idiv(BigInt(rateTurnPerCentury_1e9) * tScaled, tScale));
}

function absI8(value) {
  return value < 0 ? -value : value;
}

function facPow_1e9(base_1e9, expAbs) {
  if (expAbs <= 0) return SCALE;
  let out = SCALE;
  for (let i = 0; i < expAbs; i += 1) {
    out = idiv(out * BigInt(base_1e9), SCALE);
  }
  return out;
}

function daysSinceJ2000_1e9(minuteSince1900) {
  return idiv((BigInt(minuteSince1900) - J2000_MINUTE_SINCE_1900) * SCALE, 1440n);
}

function deltaUFromY_1e9(y_1e9, baseYear_1e9, div) {
  // y_1e9 is already scaled by 1e9; divide by `div` to preserve 1e9 scaling.
  return idiv(y_1e9 - BigInt(baseYear_1e9), BigInt(div));
}

function deltaUPowers_1e9(u_1e9) {
  const u2 = idiv(u_1e9 * u_1e9, SCALE);
  const u3 = idiv(u2 * u_1e9, SCALE);
  const u4 = idiv(u2 * u2, SCALE);
  const u5 = idiv(u3 * u2, SCALE);
  const u6 = idiv(u3 * u3, SCALE);
  const u7 = idiv(u6 * u_1e9, SCALE);
  return { u2, u3, u4, u5, u6, u7 };
}

function deltaPolyTerm_1e9(coeff_1e9, p_1e9) {
  return idiv(BigInt(coeff_1e9) * p_1e9, SCALE);
}

function deltaPolyTerm_1e12(coeff_1e12, p_1e9) {
  return idiv(BigInt(coeff_1e12) * p_1e9, 1_000_000_000_000n);
}

export function deltaTEspenakSeconds_1e9(utDaysSinceJ2000_1e9) {
  const y_1e9 =
    2_000_000_000_000n +
    idiv((utDaysSinceJ2000_1e9 - 14n * SCALE) * SCALE, 365_242_170_000n);

  if (y_1e9 < -500_000_000_000n) {
    const u = deltaUFromY_1e9(y_1e9, 1_820_000_000_000, 100);
    const u2 = idiv(u * u, SCALE);
    return -20n * SCALE + idiv(32n * u2, SCALE);
  }
  if (y_1e9 < 500_000_000_000n) {
    const u = deltaUFromY_1e9(y_1e9, 0, 100);
    const { u2, u3, u4, u5, u6 } = deltaUPowers_1e9(u);
    return (
      10_583_600_000_000n +
      deltaPolyTerm_1e9(-1_014_410_000_000, u) +
      deltaPolyTerm_1e9(33_783_110_000, u2) +
      deltaPolyTerm_1e9(-5_952_053_000, u3) +
      deltaPolyTerm_1e9(-179_845_200, u4) +
      deltaPolyTerm_1e9(22_174_192, u5) +
      deltaPolyTerm_1e9(9_031_652, u6)
    );
  }
  if (y_1e9 < 1_600_000_000_000n) {
    const u = deltaUFromY_1e9(y_1e9, 1_000_000_000_000, 100);
    const { u2, u3, u4, u5, u6 } = deltaUPowers_1e9(u);
    return (
      1_574_200_000_000n +
      deltaPolyTerm_1e9(-556_010_000_000, u) +
      deltaPolyTerm_1e9(71_234_720_000, u2) +
      deltaPolyTerm_1e9(319_781_000, u3) +
      deltaPolyTerm_1e9(-850_346_300, u4) +
      deltaPolyTerm_1e9(-5_050_998, u5) +
      deltaPolyTerm_1e9(8_357_207, u6)
    );
  }
  if (y_1e9 < 1_700_000_000_000n) {
    const u = y_1e9 - 1_600_000_000_000n;
    const { u2, u3 } = deltaUPowers_1e9(u);
    return (
      120_000_000_000n +
      deltaPolyTerm_1e9(-980_800_000, u) +
      deltaPolyTerm_1e9(-15_320_000, u2) +
      idiv(u3, 7_129n)
    );
  }
  if (y_1e9 < 1_800_000_000_000n) {
    const u = y_1e9 - 1_700_000_000_000n;
    const { u2, u3, u4 } = deltaUPowers_1e9(u);
    return (
      8_830_000_000n +
      deltaPolyTerm_1e9(160_300_000, u) +
      deltaPolyTerm_1e9(-5_928_500, u2) +
      deltaPolyTerm_1e9(133_360, u3) -
      idiv(u4, 1_174_000n)
    );
  }
  if (y_1e9 < 1_860_000_000_000n) {
    const u = y_1e9 - 1_800_000_000_000n;
    const { u2, u3, u4, u5, u6, u7 } = deltaUPowers_1e9(u);
    return (
      13_720_000_000n +
      deltaPolyTerm_1e9(-332_447_000, u) +
      deltaPolyTerm_1e9(6_861_200, u2) +
      deltaPolyTerm_1e9(4_111_600, u3) +
      deltaPolyTerm_1e9(-374_360, u4) +
      deltaPolyTerm_1e12(12_127_200, u5) +
      deltaPolyTerm_1e12(-169_900, u6) +
      deltaPolyTerm_1e12(875, u7)
    );
  }
  if (y_1e9 < 1_900_000_000_000n) {
    const u = y_1e9 - 1_860_000_000_000n;
    const { u2, u3, u4, u5 } = deltaUPowers_1e9(u);
    return (
      7_620_000_000n +
      deltaPolyTerm_1e9(573_700_000, u) +
      deltaPolyTerm_1e9(-251_754_000, u2) +
      deltaPolyTerm_1e9(16_806_680, u3) +
      deltaPolyTerm_1e9(-447_362, u4) +
      idiv(u5, 233_174n)
    );
  }
  if (y_1e9 < 1_920_000_000_000n) {
    const u = y_1e9 - 1_900_000_000_000n;
    const { u2, u3, u4 } = deltaUPowers_1e9(u);
    return (
      -2_790_000_000n +
      deltaPolyTerm_1e9(1_494_119_000, u) +
      deltaPolyTerm_1e9(-59_893_900, u2) +
      deltaPolyTerm_1e9(6_196_600, u3) +
      deltaPolyTerm_1e9(-197_000, u4)
    );
  }
  if (y_1e9 < 1_941_000_000_000n) {
    const u = y_1e9 - 1_920_000_000_000n;
    const { u2, u3 } = deltaUPowers_1e9(u);
    return (
      21_200_000_000n +
      deltaPolyTerm_1e9(844_930_000, u) +
      deltaPolyTerm_1e9(-76_100_000, u2) +
      deltaPolyTerm_1e9(2_093_600, u3)
    );
  }
  if (y_1e9 < 1_961_000_000_000n) {
    const u = y_1e9 - 1_950_000_000_000n;
    const { u2, u3 } = deltaUPowers_1e9(u);
    return 29_070_000_000n + deltaPolyTerm_1e9(407_000_000, u) - idiv(u2, 233n) + idiv(u3, 2_547n);
  }
  if (y_1e9 < 1_986_000_000_000n) {
    const u = y_1e9 - 1_975_000_000_000n;
    const { u2, u3 } = deltaUPowers_1e9(u);
    return 45_450_000_000n + deltaPolyTerm_1e9(1_067_000_000, u) - idiv(u2, 260n) - idiv(u3, 718n);
  }
  if (y_1e9 < 2_005_000_000_000n) {
    const u = y_1e9 - 2_000_000_000_000n;
    const { u2, u3, u4, u5 } = deltaUPowers_1e9(u);
    return (
      63_860_000_000n +
      deltaPolyTerm_1e9(334_500_000, u) +
      deltaPolyTerm_1e9(-60_374_000, u2) +
      deltaPolyTerm_1e9(1_727_500, u3) +
      deltaPolyTerm_1e9(651_814, u4) +
      deltaPolyTerm_1e9(23_736, u5)
    );
  }
  if (y_1e9 < 2_050_000_000_000n) {
    const u = y_1e9 - 2_000_000_000_000n;
    const { u2 } = deltaUPowers_1e9(u);
    return 62_920_000_000n + deltaPolyTerm_1e9(322_170_000, u) + deltaPolyTerm_1e9(5_589_000, u2);
  }
  if (y_1e9 < 2_150_000_000_000n) {
    const u = deltaUFromY_1e9(y_1e9, 1_820_000_000_000, 100);
    const u2 = idiv(u * u, SCALE);
    return (
      -20_000_000_000n +
      deltaPolyTerm_1e9(32_000_000_000, u2) +
      deltaPolyTerm_1e9(562_800_000, y_1e9 - 2_150_000_000_000n)
    );
  }
  const u = deltaUFromY_1e9(y_1e9, 1_820_000_000_000, 100);
  const u2 = idiv(u * u, SCALE);
  return -20_000_000_000n + deltaPolyTerm_1e9(32_000_000_000, u2);
}

function tCenturies_1e9(daysSinceJ2000_1e9) {
  return idiv(daysSinceJ2000_1e9 * SCALE, 36_525_000_000_000n);
}

function nutationLongitudeDeg_1e9(daysSinceJ2000_1e9) {
  const t = tCenturies_1e9(daysSinceJ2000_1e9);

  const elp = norm360_1e9(357_529_109_181n + idiv(35_999_050_291_139n * t, SCALE));
  const f = norm360_1e9(93_272_090_620n + idiv(483_202_017_457_722n * t, SCALE));
  const d = norm360_1e9(297_850_195_469n + idiv(445_267_111_446_944n * t, SCALE));
  const om = norm360_1e9(125_044_555_010n + idiv(-1_934_136_261_972n * t, SCALE));

  let dp =
    idiv((-172_064_161n - idiv(174_666n * t, SCALE)) * sinDeg_1e9(om), SCALE) +
    idiv(33_386n * cosDeg_1e9(om), SCALE);

  const arg1 = norm360_1e9(2n * (f - d + om));
  dp +=
    idiv((-13_170_906n - idiv(1_675n * t, SCALE)) * sinDeg_1e9(arg1), SCALE) -
    idiv(13_696n * cosDeg_1e9(arg1), SCALE);

  const arg2 = norm360_1e9(2n * (f + om));
  dp +=
    idiv((-2_276_413n - idiv(234n * t, SCALE)) * sinDeg_1e9(arg2), SCALE) +
    idiv(2_796n * cosDeg_1e9(arg2), SCALE);

  const arg3 = norm360_1e9(2n * om);
  dp +=
    idiv((2_074_554n + idiv(207n * t, SCALE)) * sinDeg_1e9(arg3), SCALE) -
    idiv(698n * cosDeg_1e9(arg3), SCALE);

  dp +=
    idiv((1_475_877n - idiv(3_633n * t, SCALE)) * sinDeg_1e9(elp), SCALE) +
    idiv(11_817n * cosDeg_1e9(elp), SCALE);

  const dpsiAsec_1e9 = -135_000n + dp * 100n;
  return idiv(dpsiAsec_1e9, 3600n);
}

function moonTermY_1e9(
  p,
  q,
  r,
  s,
  lDeg_1e9,
  lsDeg_1e9,
  fDeg_1e9,
  dDeg_1e9,
  fac1_1e9,
  fac2_1e9,
  fac3_1e9,
) {
  const phase =
    BigInt(p) * lDeg_1e9 +
    BigInt(q) * lsDeg_1e9 +
    BigInt(r) * fDeg_1e9 +
    BigInt(s) * dDeg_1e9;

  let amp = facPow_1e9(fac1_1e9, absI8(p));
  amp = idiv(amp * facPow_1e9(fac2_1e9, absI8(q)), SCALE);
  amp = idiv(amp * facPow_1e9(fac3_1e9, absI8(r)), SCALE);
  return idiv(amp * sinDeg_1e9(phase), SCALE);
}

function periodicArcsec_1e9(coeff_1e4, offsetTurn_1e9, rateTurnPerCentury_1e9, tScaled, tScale) {
  const y = sineTurn_1e9(turnLinearScaled_1e9(offsetTurn_1e9, rateTurnPerCentury_1e9, tScaled, tScale));
  return idiv(BigInt(coeff_1e4) * y, 10_000n);
}

function toNumber1e9(v) {
  return Number(v) / 1e9;
}

function toSign(lonDeg_1e9) {
  return Number(norm360_1e9(lonDeg_1e9) / (30n * SCALE));
}

function wrapDeltaDeg_1e9(aMinusB) {
  const turn = 360n * SCALE;
  let x = aMinusB % turn;
  if (x <= -180n * SCALE) x += turn;
  if (x > 180n * SCALE) x -= turn;
  return x;
}

function distanceToNearestCuspDeg_1e9(lonDeg_1e9) {
  const r30 = norm360_1e9(lonDeg_1e9) % (30n * SCALE);
  const edge = 30n * SCALE - r30;
  return r30 < edge ? r30 : edge;
}

function norm360FloatDeg(v) {
  let x = v % 360;
  if (x < 0) x += 360;
  return x;
}

function wrapDeltaFloatDeg(v) {
  let x = v % 360;
  if (x <= -180) x += 360;
  if (x > 180) x -= 360;
  return x;
}

function fracFloat(v) {
  return v - Math.floor(v);
}

function sineTurnFloat(turn) {
  return Math.sin(2 * Math.PI * fracFloat(turn));
}

function toNearestCuspFloatDeg(v) {
  const r = norm360FloatDeg(v) % 30;
  return Math.min(r, 30 - r);
}

function toSignFloatDeg(v) {
  return Math.floor(norm360FloatDeg(v) / 30);
}

export function approximateMoonLongitudeSemanticWithDiagnostics(minuteSince1900) {
  const dDays_1e9 = daysSinceJ2000_1e9(minuteSince1900);
  const dDays = Number(dDays_1e9) / 1e9;
  const deltaTSec = Number(deltaTEspenakSeconds_1e9(dDays_1e9)) / 1e9;
  const dTtDays = dDays + deltaTSec / 86_400;
  const tCenturies = dTtDays / 36_525;
  const t2 = tCenturies * tCenturies;

  const s1 = sineTurnFloat(0.19833 + 0.05611 * tCenturies);
  const s2 = sineTurnFloat(0.27869 + 0.04508 * tCenturies);
  const s3 = sineTurnFloat(0.16827 - 0.36903 * tCenturies);
  const s4 = sineTurnFloat(0.34734 - 5.37261 * tCenturies);
  const s5 = sineTurnFloat(0.10498 - 5.37899 * tCenturies);
  const s6 = sineTurnFloat(0.42681 - 0.41855 * tCenturies);
  const s7 = sineTurnFloat(0.14943 - 5.37511 * tCenturies);

  const dl0Arcsec = 0.84 * s1 + 0.31 * s2 + 14.27 * s3 + 7.26 * s4 + 0.28 * s5 + 0.24 * s6;
  const dlArcsec = 2.94 * s1 + 0.31 * s2 + 14.27 * s3 + 9.34 * s4 + 1.12 * s5 + 0.83 * s6;
  const dlsArcsec = -6.4 * s1 - 1.89 * s6;
  const dfArcsec =
    0.21 * s1 + 0.31 * s2 + 14.27 * s3 - 88.7 * s4 - 15.3 * s5 + 0.24 * s6 - 1.86 * s7;
  const ddArcsec = dl0Arcsec - dlsArcsec;
  const dgam =
    -3332e-9 * sineTurnFloat(0.59734 - 5.37261 * tCenturies) -
    539e-9 * sineTurnFloat(0.35498 - 5.37899 * tCenturies) -
    64e-9 * sineTurnFloat(0.39943 - 5.37511 * tCenturies);

  const PI2 = 2 * Math.PI;
  const ARC = 206264.80624709636;
  const l0 = PI2 * fracFloat(0.60643382 + 1336.85522467 * tCenturies - 0.00000313 * t2) + dl0Arcsec / ARC;
  const l = PI2 * fracFloat(0.37489701 + 1325.55240982 * tCenturies + 0.00002565 * t2) + dlArcsec / ARC;
  const ls = PI2 * fracFloat(0.99312619 + 99.99735956 * tCenturies - 0.00000044 * t2) + dlsArcsec / ARC;
  const f = PI2 * fracFloat(0.25909118 + 1342.2278298 * tCenturies - 0.00000892 * t2) + dfArcsec / ARC;
  const d = PI2 * fracFloat(0.82736186 + 1236.85308708 * tCenturies - 0.00000397 * t2) + ddArcsec / ARC;

  const args = [0, l, ls, f, d];
  const co = Array.from({ length: 5 }, () => new Array(13).fill(0));
  const si = Array.from({ length: 5 }, () => new Array(13).fill(0));
  const idx = (v) => v + 6;
  const addThe = (c1, s1v, c2, s2v) => ({ x: c1 * c2 - s1v * s2v, y: s1v * c2 + c1 * s2v });

  for (let i = 1; i <= 4; i += 1) {
    let max = 0;
    let fac = 1;
    if (i === 1) {
      max = 4;
      fac = 1.000002208;
    } else if (i === 2) {
      max = 3;
      fac = 0.997504612 - 0.002495388 * tCenturies;
    } else if (i === 3) {
      max = 4;
      fac = 1.000002708 + 139.978 * dgam;
    } else {
      max = 6;
      fac = 1;
    }
    co[i][idx(0)] = 1;
    si[i][idx(0)] = 0;
    co[i][idx(1)] = Math.cos(args[i]) * fac;
    si[i][idx(1)] = Math.sin(args[i]) * fac;
    for (let j = 2; j <= max; j += 1) {
      const z = addThe(co[i][idx(j - 1)], si[i][idx(j - 1)], co[i][idx(1)], si[i][idx(1)]);
      co[i][idx(j)] = z.x;
      si[i][idx(j)] = z.y;
    }
    for (let j = 1; j <= max; j += 1) {
      co[i][idx(-j)] = co[i][idx(j)];
      si[i][idx(-j)] = -si[i][idx(j)];
    }
  }

  const term = (p, q, r, s) => {
    const expo = [0, p, q, r, s];
    let x = 1;
    let y = 0;
    for (let k = 1; k <= 4; k += 1) {
      const n = expo[k];
      if (n === 0) continue;
      const z = addThe(x, y, co[k][idx(n)], si[k][idx(n)]);
      x = z.x;
      y = z.y;
    }
    return { x, y };
  };

  let dlamArcsec = 0;
  for (const [coeffL_1e4, _coeffS_1e4, _coeffG_1e4, p, q, r, s] of MOON_SOLAR_TERMS) {
    dlamArcsec += (coeffL_1e4 / 10_000) * term(p, q, r, s).y;
  }

  dlamArcsec +=
    0.82 * sineTurnFloat(0.7736 - 62.5512 * tCenturies) +
    0.31 * sineTurnFloat(0.0466 - 125.1025 * tCenturies) +
    0.35 * sineTurnFloat(0.5785 - 25.1042 * tCenturies) +
    0.66 * sineTurnFloat(0.4591 + 1335.8075 * tCenturies) +
    0.64 * sineTurnFloat(0.313 - 91.568 * tCenturies) +
    1.14 * sineTurnFloat(0.148 + 1331.2898 * tCenturies) +
    0.21 * sineTurnFloat(0.5918 + 1056.5859 * tCenturies) +
    0.44 * sineTurnFloat(0.5784 + 1322.8595 * tCenturies) +
    0.24 * sineTurnFloat(0.2275 - 5.7374 * tCenturies) +
    0.28 * sineTurnFloat(0.2965 + 2.6929 * tCenturies) +
    0.33 * sineTurnFloat(0.3132 + 6.3368 * tCenturies);

  const lonMeanRad = PI2 * fracFloat((l0 + dlamArcsec / ARC) / PI2);
  const lonMeanDeg = (lonMeanRad * 180) / Math.PI;
  const dpsiDeg = toNumber1e9(nutationLongitudeDeg_1e9(dDays_1e9 + BigInt(Math.trunc((deltaTSec * 1e9) / 86_400))));
  const lonTrueDeg = norm360FloatDeg(lonMeanDeg + dpsiDeg);

  return {
    lonDeg: lonTrueDeg,
    sign: toSignFloatDeg(lonTrueDeg),
    stages: {
      dDays,
      deltaTSec,
      dTtDays,
      tCenturies,
      l0Deg: norm360FloatDeg((l0 * 180) / Math.PI),
      lDeg: norm360FloatDeg((l * 180) / Math.PI),
      lsDeg: norm360FloatDeg((ls * 180) / Math.PI),
      fDeg: norm360FloatDeg((f * 180) / Math.PI),
      dDeg: norm360FloatDeg((d * 180) / Math.PI),
      dlamArcsec,
      dpsiDeg,
    },
  };
}

export function approximateMoonLongitudeV3_1e9(minuteSince1900) {
  return approximateMoonLongitudeV3WithDiagnostics_1e9(minuteSince1900).lonDeg_1e9;
}

export function approximateMoonLongitudeV3WithDiagnostics_1e9(minuteSince1900) {
  const T_SCALE = 1_000_000_000_000n;
  const dDays_1e9 = daysSinceJ2000_1e9(minuteSince1900);
  const deltaTSec_1e9 = deltaTEspenakSeconds_1e9(dDays_1e9);
  const dTt_1e9 = dDays_1e9 + idiv(deltaTSec_1e9, 86_400n);

  const t_1e12 = idiv(dTt_1e9 * 1_000n, 36_525n);
  const t_1e9 = idiv(t_1e12, 1_000n);
  const t2_1e12 = idiv(t_1e12 * t_1e12, T_SCALE);

  const s1 = sineTurn_1e9(turnLinearScaled_1e9(198_330_000, 56_110_000, t_1e12, T_SCALE));
  const s2 = sineTurn_1e9(turnLinearScaled_1e9(278_690_000, 45_080_000, t_1e12, T_SCALE));
  const s3 = sineTurn_1e9(turnLinearScaled_1e9(168_270_000, -369_030_000, t_1e12, T_SCALE));
  const s4 = sineTurn_1e9(turnLinearScaled_1e9(347_340_000, -5_372_610_000, t_1e12, T_SCALE));
  const s5 = sineTurn_1e9(turnLinearScaled_1e9(104_980_000, -5_378_990_000, t_1e12, T_SCALE));
  const s6 = sineTurn_1e9(turnLinearScaled_1e9(426_810_000, -418_550_000, t_1e12, T_SCALE));
  const s7 = sineTurn_1e9(turnLinearScaled_1e9(149_430_000, -5_375_110_000, t_1e12, T_SCALE));

  const dl0Arcsec_1e9 = idiv(
    840_000_000n * s1 +
      310_000_000n * s2 +
      14_270_000_000n * s3 +
      7_260_000_000n * s4 +
      280_000_000n * s5 +
      240_000_000n * s6,
    SCALE,
  );

  const dlArcsec_1e9 = idiv(
    2_940_000_000n * s1 +
      310_000_000n * s2 +
      14_270_000_000n * s3 +
      9_340_000_000n * s4 +
      1_120_000_000n * s5 +
      830_000_000n * s6,
    SCALE,
  );

  const dlsArcsec_1e9 = idiv(-6_400_000_000n * s1 - 1_890_000_000n * s6, SCALE);

  const dfArcsec_1e9 = idiv(
    210_000_000n * s1 +
      310_000_000n * s2 +
      14_270_000_000n * s3 -
      88_700_000_000n * s4 -
      15_300_000_000n * s5 +
      240_000_000n * s6 -
      1_860_000_000n * s7,
    SCALE,
  );

  const ddArcsec_1e9 = dl0Arcsec_1e9 - dlsArcsec_1e9;

  const dgam_1e9 = idiv(
    -3_332n * sineTurn_1e9(turnLinearScaled_1e9(597_340_000, -5_372_610_000, t_1e12, T_SCALE)) -
      539n * sineTurn_1e9(turnLinearScaled_1e9(354_980_000, -5_378_990_000, t_1e12, T_SCALE)) -
      64n * sineTurn_1e9(turnLinearScaled_1e9(399_430_000, -5_375_110_000, t_1e12, T_SCALE)),
    SCALE,
  );

  const l0Turn_1e9 = frac_1e9(
    606_433_820n + idiv(1_336_855_224_670n * t_1e12, T_SCALE) + idiv(-3_130n * t2_1e12, T_SCALE),
  );
  const lTurn_1e9 = frac_1e9(
    374_897_010n + idiv(1_325_552_409_820n * t_1e12, T_SCALE) + idiv(25_650n * t2_1e12, T_SCALE),
  );
  const lsTurn_1e9 = frac_1e9(
    993_126_190n + idiv(99_997_359_560n * t_1e12, T_SCALE) + idiv(-440n * t2_1e12, T_SCALE),
  );
  const fTurn_1e9 = frac_1e9(
    259_091_180n + idiv(1_342_227_829_800n * t_1e12, T_SCALE) + idiv(-8_920n * t2_1e12, T_SCALE),
  );
  const dTurn_1e9 = frac_1e9(
    827_361_860n + idiv(1_236_853_087_080n * t_1e12, T_SCALE) + idiv(-3_970n * t2_1e12, T_SCALE),
  );

  const l0Deg_1e9 = turnToDeg_1e9(l0Turn_1e9) + idiv(dl0Arcsec_1e9, 3600n);
  const lDeg_1e9 = turnToDeg_1e9(lTurn_1e9) + idiv(dlArcsec_1e9, 3600n);
  const lsDeg_1e9 = turnToDeg_1e9(lsTurn_1e9) + idiv(dlsArcsec_1e9, 3600n);
  const fDeg_1e9 = turnToDeg_1e9(fTurn_1e9) + idiv(dfArcsec_1e9, 3600n);
  const dDeg_1e9 = turnToDeg_1e9(dTurn_1e9) + idiv(ddArcsec_1e9, 3600n);

  const fac1_1e9 = 1_000_002_208;
  const fac2_1e9 = Number(997_504_612n - idiv(2_495_388n * t_1e12, T_SCALE));
  const fac3_1e9 = Number(1_000_002_708n + idiv(139_978_000_000n * dgam_1e9, SCALE));

  let dlamArcsec_1e9 = 0n;
  for (const [coeffL_1e4, _coeffS_1e4, _coeffG_1e4, p, q, r, s] of MOON_SOLAR_TERMS) {
    const y = moonTermY_1e9(
      p,
      q,
      r,
      s,
      lDeg_1e9,
      lsDeg_1e9,
      fDeg_1e9,
      dDeg_1e9,
      fac1_1e9,
      fac2_1e9,
      fac3_1e9,
    );
    dlamArcsec_1e9 += idiv(BigInt(coeffL_1e4) * y, 10_000n);
  }

  dlamArcsec_1e9 += periodicArcsec_1e9(8_200, 773_600_000, -62_551_200_000, t_1e12, T_SCALE);
  dlamArcsec_1e9 += periodicArcsec_1e9(3_100, 46_600_000, -125_102_500_000, t_1e12, T_SCALE);
  dlamArcsec_1e9 += periodicArcsec_1e9(3_500, 578_500_000, -25_104_200_000, t_1e12, T_SCALE);
  dlamArcsec_1e9 += periodicArcsec_1e9(6_600, 459_100_000, 1_335_807_500_000, t_1e12, T_SCALE);
  dlamArcsec_1e9 += periodicArcsec_1e9(6_400, 313_000_000, -91_568_000_000, t_1e12, T_SCALE);
  dlamArcsec_1e9 += periodicArcsec_1e9(11_400, 148_000_000, 1_331_289_800_000, t_1e12, T_SCALE);
  dlamArcsec_1e9 += periodicArcsec_1e9(2_100, 591_800_000, 1_056_585_900_000, t_1e12, T_SCALE);
  dlamArcsec_1e9 += periodicArcsec_1e9(4_400, 578_400_000, 1_322_859_500_000, t_1e12, T_SCALE);
  dlamArcsec_1e9 += periodicArcsec_1e9(2_400, 227_500_000, -5_737_400_000, t_1e12, T_SCALE);
  dlamArcsec_1e9 += periodicArcsec_1e9(2_800, 296_500_000, 2_692_900_000, t_1e12, T_SCALE);
  dlamArcsec_1e9 += periodicArcsec_1e9(3_300, 313_200_000, 6_336_800_000, t_1e12, T_SCALE);

  const dpsiDeg_1e9 = nutationLongitudeDeg_1e9(dTt_1e9);
  const moonParityOffset_1e9 =
    MOON_LON_PARITY_OFFSET_A_DEG_1E9 +
    idiv(MOON_LON_PARITY_OFFSET_B_DEG_1E9_PER_CENTURY * t_1e12, T_SCALE) +
    idiv(MOON_LON_PARITY_OFFSET_C_DEG_1E9_PER_CENTURY2 * t2_1e12, T_SCALE);
  const lonDeg_1e9 = norm360_1e9(
    l0Deg_1e9 + idiv(dlamArcsec_1e9, 3600n) + dpsiDeg_1e9 + moonParityOffset_1e9,
  );

  return {
    lonDeg_1e9,
    sign: toSign(lonDeg_1e9),
    stages: {
      dDays_1e9,
      deltaTSec_1e9,
      dTt_1e9,
      t_1e9,
      t2_1e9: idiv(t2_1e12, 1_000n),
      l0Deg_1e9,
      lDeg_1e9,
      lsDeg_1e9,
      fDeg_1e9,
      dDeg_1e9,
      dlamArcsec_1e9,
      dpsiDeg_1e9,
      moonParityOffset_1e9,
      fac2_1e9,
      fac3_1e9,
    },
  };
}

export function moonParityRow({ minuteSince1900, quantizeMinutes, oracleLonDeg }) {
  const qMinute = Math.floor(minuteSince1900 / quantizeMinutes) * quantizeMinutes;
  const model = approximateMoonLongitudeV3WithDiagnostics_1e9(qMinute);
  const modelLon = model.lonDeg_1e9;
  const oracleLon_1e9 = BigInt(Math.trunc(oracleLonDeg * 1e9));
  const modelSign = toSign(modelLon);
  const oracleSign = toSign(oracleLon_1e9);
  const deltaLon_1e9 = wrapDeltaDeg_1e9(modelLon - oracleLon_1e9);

  return {
    minuteSince1900: qMinute,
    modelSign,
    oracleSign,
    mismatch: modelSign !== oracleSign,
    modelLonDeg: toNumber1e9(modelLon),
    oracleLonDeg: toNumber1e9(oracleLon_1e9),
    deltaLonDeg: toNumber1e9(deltaLon_1e9),
    modelCuspDistanceDeg: toNumber1e9(distanceToNearestCuspDeg_1e9(modelLon)),
    oracleCuspDistanceDeg: toNumber1e9(distanceToNearestCuspDeg_1e9(oracleLon_1e9)),
    diagnostics: {
      dDays: toNumber1e9(model.stages.dDays_1e9),
      deltaTSec: toNumber1e9(model.stages.deltaTSec_1e9),
      dTtDays: toNumber1e9(model.stages.dTt_1e9),
      tCenturies: toNumber1e9(model.stages.t_1e9),
      l0Deg: toNumber1e9(model.stages.l0Deg_1e9),
      lDeg: toNumber1e9(model.stages.lDeg_1e9),
      lsDeg: toNumber1e9(model.stages.lsDeg_1e9),
      fDeg: toNumber1e9(model.stages.fDeg_1e9),
      dDeg: toNumber1e9(model.stages.dDeg_1e9),
      dlamArcsec: toNumber1e9(model.stages.dlamArcsec_1e9),
      dpsiDeg: toNumber1e9(model.stages.dpsiDeg_1e9),
      moonParityOffsetDeg: toNumber1e9(model.stages.moonParityOffset_1e9),
      fac2: toNumber1e9(BigInt(model.stages.fac2_1e9)),
      fac3: toNumber1e9(BigInt(model.stages.fac3_1e9)),
    },
  };
}

export function moonParityRowDetailed({ minuteSince1900, quantizeMinutes, oracleLonDeg }) {
  const base = moonParityRow({ minuteSince1900, quantizeMinutes, oracleLonDeg });
  const semantic = approximateMoonLongitudeSemanticWithDiagnostics(base.minuteSince1900);
  const fixed = approximateMoonLongitudeV3WithDiagnostics_1e9(base.minuteSince1900);

  const fixedLonDeg = toNumber1e9(fixed.lonDeg_1e9);
  const semanticLonDeg = semantic.lonDeg;
  const oracleDeg = base.oracleLonDeg;

  const fixedMinusSemanticDeg = wrapDeltaFloatDeg(fixedLonDeg - semanticLonDeg);
  const semanticMinusOracleDeg = wrapDeltaFloatDeg(semanticLonDeg - oracleDeg);
  const fixedMinusOracleDeg = wrapDeltaFloatDeg(fixedLonDeg - oracleDeg);

  return {
    ...base,
    semanticSign: semantic.sign,
    semanticLonDeg,
    fixedMinusSemanticDeg,
    semanticMinusOracleDeg,
    fixedMinusOracleDeg,
    semanticCuspDistanceDeg: toNearestCuspFloatDeg(semanticLonDeg),
    stageDeltas: {
      dDays: base.diagnostics.dDays - semantic.stages.dDays,
      deltaTSec: base.diagnostics.deltaTSec - semantic.stages.deltaTSec,
      dTtDays: base.diagnostics.dTtDays - semantic.stages.dTtDays,
      tCenturies: base.diagnostics.tCenturies - semantic.stages.tCenturies,
      l0Deg: base.diagnostics.l0Deg - semantic.stages.l0Deg,
      lDeg: base.diagnostics.lDeg - semantic.stages.lDeg,
      lsDeg: base.diagnostics.lsDeg - semantic.stages.lsDeg,
      fDeg: base.diagnostics.fDeg - semantic.stages.fDeg,
      dDeg: base.diagnostics.dDeg - semantic.stages.dDeg,
      dlamArcsec: base.diagnostics.dlamArcsec - semantic.stages.dlamArcsec,
      dpsiDeg: base.diagnostics.dpsiDeg - semantic.stages.dpsiDeg,
    },
  };
}
