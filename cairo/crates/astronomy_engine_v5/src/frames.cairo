use crate::fixed::{div_round_half_away_from_zero, norm360_i64_1e9, SCALE_1E9};
use crate::trig::{atan2_deg_1e9, cos_deg_1e9, sin_deg_1e9};

const DAYS_PER_CENTURY_1E9: i64 = 36_525_000_000_000;

// VSOP ecliptic-to-EQJ rotation constants (scaled by 1e9).
const VSOP_R11_1E9: i64 = 1_000_000_000;
const VSOP_R12_1E9: i64 = 440;
const VSOP_R13_1E9: i64 = -191;
const VSOP_R21_1E9: i64 = -480;
const VSOP_R22_1E9: i64 = 917_482_137;
const VSOP_R23_1E9: i64 = -397_776_983;
const VSOP_R31_1E9: i64 = 0;
const VSOP_R32_1E9: i64 = 397_776_983;
const VSOP_R33_1E9: i64 = 917_482_137;

#[derive(Copy, Drop)]
struct ETilt {
    dpsi_deg_1e9: i64,
    deps_deg_1e9: i64,
    mobl_deg_1e9: i64,
    tobl_deg_1e9: i64,
}

#[inline(never)]
fn t_centuries_1e9(days_since_j2000_1e9: i64) -> i64 {
    let t: i128 = (days_since_j2000_1e9.into() * SCALE_1E9.into()) / DAYS_PER_CENTURY_1E9.into();
    t.try_into().unwrap()
}

#[inline(never)]
fn eval_poly_t_1e9(
    a4_1e9: i64, a3_1e9: i64, a2_1e9: i64, a1_1e9: i64, a0_1e9: i64, t_1e9: i64,
) -> i64 {
    let mut acc: i128 = a4_1e9.into();
    acc = (acc * t_1e9.into()) / SCALE_1E9.into() + a3_1e9.into();
    acc = (acc * t_1e9.into()) / SCALE_1E9.into() + a2_1e9.into();
    acc = (acc * t_1e9.into()) / SCALE_1E9.into() + a1_1e9.into();
    acc = (acc * t_1e9.into()) / SCALE_1E9.into() + a0_1e9.into();
    acc.try_into().unwrap()
}

#[inline(never)]
fn eval_poly_t5_1e9(
    a5_1e9: i64, a4_1e9: i64, a3_1e9: i64, a2_1e9: i64, a1_1e9: i64, a0_1e9: i64,
    t_1e9: i64,
) -> i64 {
    let mut acc: i128 = a5_1e9.into();
    acc = (acc * t_1e9.into()) / SCALE_1E9.into() + a4_1e9.into();
    acc = (acc * t_1e9.into()) / SCALE_1E9.into() + a3_1e9.into();
    acc = (acc * t_1e9.into()) / SCALE_1E9.into() + a2_1e9.into();
    acc = (acc * t_1e9.into()) / SCALE_1E9.into() + a1_1e9.into();
    acc = (acc * t_1e9.into()) / SCALE_1E9.into() + a0_1e9.into();
    acc.try_into().unwrap()
}

#[inline(never)]
fn iau2000b_e_tilt(days_since_j2000_1e9: i64) -> ETilt {
    let t = t_centuries_1e9(days_since_j2000_1e9);

    // Fundamental arguments in degrees.
    let elp = norm360_i64_1e9(357_529_109_181 + (((35_999_050_291_139_i128 * t.into()) / SCALE_1E9.into()).try_into().unwrap()));
    let f = norm360_i64_1e9(93_272_090_620 + (((483_202_017_457_722_i128 * t.into()) / SCALE_1E9.into()).try_into().unwrap()));
    let d = norm360_i64_1e9(297_850_195_469 + (((445_267_111_446_944_i128 * t.into()) / SCALE_1E9.into()).try_into().unwrap()));
    let om = norm360_i64_1e9(125_044_555_010 + (((-1_934_136_261_972_i128 * t.into()) / SCALE_1E9.into()).try_into().unwrap()));

    // dp, de are in 0.1 micro-arcsecond units.
    let mut dp: i128 = ((-172_064_161_i128 - (174_666_i128 * t.into()) / SCALE_1E9.into())
        * sin_deg_1e9(om).into())
        / SCALE_1E9.into()
        + (33_386_i128 * cos_deg_1e9(om).into()) / SCALE_1E9.into();
    let mut de: i128 = ((92_052_331_i128 + (9_086_i128 * t.into()) / SCALE_1E9.into())
        * cos_deg_1e9(om).into())
        / SCALE_1E9.into()
        + (15_377_i128 * sin_deg_1e9(om).into()) / SCALE_1E9.into();

    let arg1 = norm360_i64_1e9(2 * (f - d + om));
    dp += ((-13_170_906_i128 - (1_675_i128 * t.into()) / SCALE_1E9.into())
        * sin_deg_1e9(arg1).into())
        / SCALE_1E9.into()
        - (13_696_i128 * cos_deg_1e9(arg1).into()) / SCALE_1E9.into();
    de += ((5_730_336_i128 - (3_015_i128 * t.into()) / SCALE_1E9.into())
        * cos_deg_1e9(arg1).into())
        / SCALE_1E9.into()
        - (4_587_i128 * sin_deg_1e9(arg1).into()) / SCALE_1E9.into();

    let arg2 = norm360_i64_1e9(2 * (f + om));
    dp += ((-2_276_413_i128 - (234_i128 * t.into()) / SCALE_1E9.into()) * sin_deg_1e9(arg2).into())
        / SCALE_1E9.into()
        + (2_796_i128 * cos_deg_1e9(arg2).into()) / SCALE_1E9.into();
    de += ((978_459_i128 - (485_i128 * t.into()) / SCALE_1E9.into()) * cos_deg_1e9(arg2).into())
        / SCALE_1E9.into()
        + (1_374_i128 * sin_deg_1e9(arg2).into()) / SCALE_1E9.into();

    let arg3 = norm360_i64_1e9(2 * om);
    dp += ((2_074_554_i128 + (207_i128 * t.into()) / SCALE_1E9.into()) * sin_deg_1e9(arg3).into())
        / SCALE_1E9.into()
        - (698_i128 * cos_deg_1e9(arg3).into()) / SCALE_1E9.into();
    de += ((-897_492_i128 + (470_i128 * t.into()) / SCALE_1E9.into())
        * cos_deg_1e9(arg3).into())
        / SCALE_1E9.into()
        - (291_i128 * sin_deg_1e9(arg3).into()) / SCALE_1E9.into();

    dp += ((1_475_877_i128 - (3_633_i128 * t.into()) / SCALE_1E9.into()) * sin_deg_1e9(elp).into())
        / SCALE_1E9.into()
        + (11_817_i128 * cos_deg_1e9(elp).into()) / SCALE_1E9.into();
    de += ((73_871_i128 - (184_i128 * t.into()) / SCALE_1E9.into()) * cos_deg_1e9(elp).into())
        / SCALE_1E9.into()
        - (1_924_i128 * sin_deg_1e9(elp).into()) / SCALE_1E9.into();

    // Arcseconds scaled by 1e9.
    let dpsi_asec_1e9: i128 = -135_000 + dp * 100;
    let deps_asec_1e9: i128 = 388_000 + de * 100;
    let dpsi_deg_1e9: i64 = (dpsi_asec_1e9 / 3600_i128).try_into().unwrap();
    let deps_deg_1e9: i64 = (deps_asec_1e9 / 3600_i128).try_into().unwrap();

    // Mean obliquity in arcseconds, converted to degrees scaled by 1e9.
    let mobl_deg_1e9 = eval_poly_t5_1e9(
        0, // -4.34e-8 / 3600 deg
        0, // -5.76e-7 / 3600 deg
        557, // +0.00200340 / 3600 deg
        -51, // -0.0001831 / 3600 deg
        -13_010_214, // -46.836769 / 3600 deg
        23_439_279_444, // 84381.406 / 3600 deg
        t,
    );

    ETilt { dpsi_deg_1e9, deps_deg_1e9, mobl_deg_1e9, tobl_deg_1e9: mobl_deg_1e9 + deps_deg_1e9 }
}

#[inline(never)]
pub fn mean_true_obliquity_deg_1e9(days_since_j2000_1e9: i64) -> i64 {
    let tilt = iau2000b_e_tilt(days_since_j2000_1e9);
    tilt.tobl_deg_1e9
}

#[inline(never)]
pub fn equation_of_equinoxes_deg_1e9(days_since_j2000_1e9: i64) -> i64 {
    // eqeq_deg = dpsi_deg * cos(mean_obliquity)
    let tilt = iau2000b_e_tilt(days_since_j2000_1e9);
    let eqeq: i128 = (tilt.dpsi_deg_1e9.into() * cos_deg_1e9(tilt.mobl_deg_1e9).into())
        / SCALE_1E9.into();
    eqeq.try_into().unwrap()
}

#[inline(never)]
pub fn nutation_longitude_deg_1e9(days_since_j2000_1e9: i64) -> i64 {
    let tilt = iau2000b_e_tilt(days_since_j2000_1e9);
    tilt.dpsi_deg_1e9
}

#[inline(never)]
fn era_deg_1e9(days_since_j2000_1e9: i64) -> i64 {
    // Earth Rotation Angle in degrees.
    // theta = 360 * frac(0.7790572732640 + 0.00273781191135448*ut + frac(ut))
    const TURN_1E15: i128 = 1_000_000_000_000_000;
    const A_1E15: i128 = 779_057_273_264_000;
    const B_1E15: i128 = 2_737_811_911_354;

    let ut_days_1e9: i128 = days_since_j2000_1e9.into();
    let thet1_1e15: i128 = A_1E15 + (B_1E15 * ut_days_1e9) / SCALE_1E9.into();
    let thet3_1e15: i128 = (ut_days_1e9 % SCALE_1E9.into()) * 1_000_000;
    let mut turn_1e15: i128 = (thet1_1e15 + thet3_1e15) % TURN_1E15;
    if turn_1e15 < 0 {
        turn_1e15 += TURN_1E15;
    }
    ((turn_1e15 * 360_i128 * SCALE_1E9.into()) / TURN_1E15).try_into().unwrap()
}

#[inline(never)]
pub fn sidereal_time_deg_1e9(days_since_j2000_1e9: i64) -> i64 {
    // GAST angle in degrees (normalized to [0,360)).
    // Formula mirrors upstream sidereal_time + e_tilt.
    let t = t_centuries_1e9(days_since_j2000_1e9);
    // Arcseconds:
    // st = eqeq + 0.014506 + ((((-0.0000000368*t - 0.000029956)*t - 0.00000044)*t + 1.3915817)*t + 4612.156534)*t
    let eqeq_arcsec_1e9: i128 = equation_of_equinoxes_deg_1e9(days_since_j2000_1e9).into() * 3600_i128;
    let mut poly_arcsec_1e9: i128 = -37; // -3.68e-8 arcsec
    poly_arcsec_1e9 = (poly_arcsec_1e9 * t.into()) / SCALE_1E9.into() - 29_956;
    poly_arcsec_1e9 = (poly_arcsec_1e9 * t.into()) / SCALE_1E9.into() - 440;
    poly_arcsec_1e9 = (poly_arcsec_1e9 * t.into()) / SCALE_1E9.into() + 1_391_581_700;
    poly_arcsec_1e9 = (poly_arcsec_1e9 * t.into()) / SCALE_1E9.into() + 4_612_156_534_000;
    poly_arcsec_1e9 = (poly_arcsec_1e9 * t.into()) / SCALE_1E9.into();

    let st_arcsec_1e9: i128 = eqeq_arcsec_1e9 + 14_506_000 + poly_arcsec_1e9;
    let st_deg_1e9: i64 = (st_arcsec_1e9 / 3600_i128).try_into().unwrap();
    norm360_i64_1e9(era_deg_1e9(days_since_j2000_1e9) + st_deg_1e9)
}

#[inline(never)]
fn precession_from2000_1e9(x: i64, y: i64, z: i64, days_since_j2000_1e9: i64) -> (i64, i64, i64) {
    let t = t_centuries_1e9(days_since_j2000_1e9);
    let eps0_deg_1e9: i64 = 23_439_279_444;
    let psia_deg_1e9 = eval_poly_t5_1e9(
        0, // -9.51e-8 / 3600 deg
        37, // +0.000132851 / 3600 deg
        -317, // -0.00114045 / 3600 deg
        -299_724, // -1.0790069 / 3600 deg
        1_399_578_196, // +5038.481507 / 3600 deg
        0,
        t,
    );
    let omegaa_deg_1e9 = eval_poly_t5_1e9(
        0, // +3.337e-7 / 3600 deg
        0, // -4.67e-7 / 3600 deg
        -2_146, // -0.00772503 / 3600 deg
        14_240, // +0.0512623 / 3600 deg
        -7_154, // -0.025754 / 3600 deg
        eps0_deg_1e9,
        t,
    );
    let chia_deg_1e9 = eval_poly_t5_1e9(
        0, // -5.6e-8 / 3600 deg
        47, // +0.000170663 / 3600 deg
        -337, // -0.00121197 / 3600 deg
        -661_508, // -2.3814292 / 3600 deg
        2_932_334, // +10.556403 / 3600 deg
        0,
        t,
    );

    let sa = sin_deg_1e9(eps0_deg_1e9);
    let ca = cos_deg_1e9(eps0_deg_1e9);
    let sb = sin_deg_1e9(-psia_deg_1e9);
    let cb = cos_deg_1e9(-psia_deg_1e9);
    let sc = sin_deg_1e9(-omegaa_deg_1e9);
    let cc = cos_deg_1e9(-omegaa_deg_1e9);
    let sd = sin_deg_1e9(chia_deg_1e9);
    let cd = cos_deg_1e9(chia_deg_1e9);

    let xx: i128 = (cd.into() * cb.into()) / SCALE_1E9.into()
        - (((sb.into() * sd.into()) / SCALE_1E9.into()) * cc.into()) / SCALE_1E9.into();
    let yx: i128 = (((cd.into() * sb.into()) / SCALE_1E9.into()) * ca.into()) / SCALE_1E9.into()
        + (((((sd.into() * cc.into()) / SCALE_1E9.into()) * cb.into()) / SCALE_1E9.into())
            * ca.into())
            / SCALE_1E9.into()
        - (((sa.into() * sd.into()) / SCALE_1E9.into()) * sc.into()) / SCALE_1E9.into();
    let zx: i128 = (((cd.into() * sb.into()) / SCALE_1E9.into()) * sa.into()) / SCALE_1E9.into()
        + (((((sd.into() * cc.into()) / SCALE_1E9.into()) * cb.into()) / SCALE_1E9.into())
            * sa.into())
            / SCALE_1E9.into()
        + (((ca.into() * sd.into()) / SCALE_1E9.into()) * sc.into()) / SCALE_1E9.into();
    let xy: i128 = -((sd.into() * cb.into()) / SCALE_1E9.into())
        - (((sb.into() * cd.into()) / SCALE_1E9.into()) * cc.into()) / SCALE_1E9.into();
    let yy: i128 = -((((sd.into() * sb.into()) / SCALE_1E9.into()) * ca.into()) / SCALE_1E9.into())
        + (((((cd.into() * cc.into()) / SCALE_1E9.into()) * cb.into()) / SCALE_1E9.into())
            * ca.into())
            / SCALE_1E9.into()
        - (((sa.into() * cd.into()) / SCALE_1E9.into()) * sc.into()) / SCALE_1E9.into();
    let zy: i128 = -((((sd.into() * sb.into()) / SCALE_1E9.into()) * sa.into()) / SCALE_1E9.into())
        + (((((cd.into() * cc.into()) / SCALE_1E9.into()) * cb.into()) / SCALE_1E9.into())
            * sa.into())
            / SCALE_1E9.into()
        + (((ca.into() * cd.into()) / SCALE_1E9.into()) * sc.into()) / SCALE_1E9.into();
    let xz: i128 = (sb.into() * sc.into()) / SCALE_1E9.into();
    let yz: i128 = -((((sc.into() * cb.into()) / SCALE_1E9.into()) * ca.into()) / SCALE_1E9.into())
        - (sa.into() * cc.into()) / SCALE_1E9.into();
    let zz: i128 = -((((sc.into() * cb.into()) / SCALE_1E9.into()) * sa.into()) / SCALE_1E9.into())
        + (cc.into() * ca.into()) / SCALE_1E9.into();

    let rx: i128 =
        (xx * x.into()) / SCALE_1E9.into() + (xy * y.into()) / SCALE_1E9.into()
            + (xz * z.into()) / SCALE_1E9.into();
    let ry: i128 =
        (yx * x.into()) / SCALE_1E9.into() + (yy * y.into()) / SCALE_1E9.into()
            + (yz * z.into()) / SCALE_1E9.into();
    let rz: i128 =
        (zx * x.into()) / SCALE_1E9.into() + (zy * y.into()) / SCALE_1E9.into()
            + (zz * z.into()) / SCALE_1E9.into();
    (rx.try_into().unwrap(), ry.try_into().unwrap(), rz.try_into().unwrap())
}

#[inline(never)]
fn nutation_from2000_1e9(
    x: i64, y: i64, z: i64, tilt: ETilt,
) -> (i64, i64, i64) {
    let cobm = cos_deg_1e9(tilt.mobl_deg_1e9);
    let sobm = sin_deg_1e9(tilt.mobl_deg_1e9);
    let cobt = cos_deg_1e9(tilt.tobl_deg_1e9);
    let sobt = sin_deg_1e9(tilt.tobl_deg_1e9);
    let cpsi = cos_deg_1e9(tilt.dpsi_deg_1e9);
    let spsi = sin_deg_1e9(tilt.dpsi_deg_1e9);

    let xx: i128 = cpsi.into();
    let yx: i128 = -((spsi.into() * cobm.into()) / SCALE_1E9.into());
    let zx: i128 = -((spsi.into() * sobm.into()) / SCALE_1E9.into());
    let xy: i128 = (spsi.into() * cobt.into()) / SCALE_1E9.into();
    let yy: i128 = ((cpsi.into() * cobm.into()) / SCALE_1E9.into() * cobt.into())
        / SCALE_1E9.into()
        + (sobm.into() * sobt.into()) / SCALE_1E9.into();
    let zy: i128 = ((cpsi.into() * sobm.into()) / SCALE_1E9.into() * cobt.into())
        / SCALE_1E9.into()
        - (cobm.into() * sobt.into()) / SCALE_1E9.into();
    let xz: i128 = (spsi.into() * sobt.into()) / SCALE_1E9.into();
    let yz: i128 = ((cpsi.into() * cobm.into()) / SCALE_1E9.into() * sobt.into())
        / SCALE_1E9.into()
        - (sobm.into() * cobt.into()) / SCALE_1E9.into();
    let zz: i128 = ((cpsi.into() * sobm.into()) / SCALE_1E9.into() * sobt.into())
        / SCALE_1E9.into()
        + (cobm.into() * cobt.into()) / SCALE_1E9.into();

    let rx: i128 =
        (xx * x.into()) / SCALE_1E9.into() + (xy * y.into()) / SCALE_1E9.into()
            + (xz * z.into()) / SCALE_1E9.into();
    let ry: i128 =
        (yx * x.into()) / SCALE_1E9.into() + (yy * y.into()) / SCALE_1E9.into()
            + (yz * z.into()) / SCALE_1E9.into();
    let rz: i128 =
        (zx * x.into()) / SCALE_1E9.into() + (zy * y.into()) / SCALE_1E9.into()
            + (zz * z.into()) / SCALE_1E9.into();
    (rx.try_into().unwrap(), ry.try_into().unwrap(), rz.try_into().unwrap())
}

#[inline(never)]
fn mul_1e9_round(a: i128, b: i128) -> i128 {
    div_round_half_away_from_zero(a * b, SCALE_1E9.into())
}

#[inline(never)]
fn precession_from2000_1e9_round(
    x: i64, y: i64, z: i64, days_since_j2000_1e9: i64,
) -> (i64, i64, i64) {
    let t = t_centuries_1e9(days_since_j2000_1e9);
    let eps0_deg_1e9: i64 = 23_439_279_444;
    let psia_deg_1e9 = eval_poly_t5_1e9(0, 37, -317, -299_724, 1_399_578_196, 0, t);
    let omegaa_deg_1e9 = eval_poly_t5_1e9(0, 0, -2_146, 14_240, -7_154, eps0_deg_1e9, t);
    let chia_deg_1e9 = eval_poly_t5_1e9(0, 47, -337, -661_508, 2_932_334, 0, t);

    let sa: i128 = sin_deg_1e9(eps0_deg_1e9).into();
    let ca: i128 = cos_deg_1e9(eps0_deg_1e9).into();
    let sb: i128 = sin_deg_1e9(-psia_deg_1e9).into();
    let cb: i128 = cos_deg_1e9(-psia_deg_1e9).into();
    let sc: i128 = sin_deg_1e9(-omegaa_deg_1e9).into();
    let cc: i128 = cos_deg_1e9(-omegaa_deg_1e9).into();
    let sd: i128 = sin_deg_1e9(chia_deg_1e9).into();
    let cd: i128 = cos_deg_1e9(chia_deg_1e9).into();

    let xx = mul_1e9_round(cd, cb) - mul_1e9_round(mul_1e9_round(sb, sd), cc);
    let yx = mul_1e9_round(mul_1e9_round(cd, sb), ca)
        + mul_1e9_round(mul_1e9_round(mul_1e9_round(sd, cc), cb), ca)
        - mul_1e9_round(mul_1e9_round(sa, sd), sc);
    let zx = mul_1e9_round(mul_1e9_round(cd, sb), sa)
        + mul_1e9_round(mul_1e9_round(mul_1e9_round(sd, cc), cb), sa)
        + mul_1e9_round(mul_1e9_round(ca, sd), sc);
    let xy = -mul_1e9_round(sd, cb) - mul_1e9_round(mul_1e9_round(sb, cd), cc);
    let yy = -mul_1e9_round(mul_1e9_round(sd, sb), ca)
        + mul_1e9_round(mul_1e9_round(mul_1e9_round(cd, cc), cb), ca)
        - mul_1e9_round(mul_1e9_round(sa, cd), sc);
    let zy = -mul_1e9_round(mul_1e9_round(sd, sb), sa)
        + mul_1e9_round(mul_1e9_round(mul_1e9_round(cd, cc), cb), sa)
        + mul_1e9_round(mul_1e9_round(ca, cd), sc);
    let xz = mul_1e9_round(sb, sc);
    let yz = -mul_1e9_round(mul_1e9_round(sc, cb), ca) - mul_1e9_round(sa, cc);
    let zz = -mul_1e9_round(mul_1e9_round(sc, cb), sa) + mul_1e9_round(cc, ca);

    let rx = mul_1e9_round(xx, x.into()) + mul_1e9_round(xy, y.into()) + mul_1e9_round(xz, z.into());
    let ry = mul_1e9_round(yx, x.into()) + mul_1e9_round(yy, y.into()) + mul_1e9_round(yz, z.into());
    let rz = mul_1e9_round(zx, x.into()) + mul_1e9_round(zy, y.into()) + mul_1e9_round(zz, z.into());
    (rx.try_into().unwrap(), ry.try_into().unwrap(), rz.try_into().unwrap())
}

#[inline(never)]
fn nutation_from2000_1e9_round(x: i64, y: i64, z: i64, tilt: ETilt) -> (i64, i64, i64) {
    let cobm: i128 = cos_deg_1e9(tilt.mobl_deg_1e9).into();
    let sobm: i128 = sin_deg_1e9(tilt.mobl_deg_1e9).into();
    let cobt: i128 = cos_deg_1e9(tilt.tobl_deg_1e9).into();
    let sobt: i128 = sin_deg_1e9(tilt.tobl_deg_1e9).into();
    let cpsi: i128 = cos_deg_1e9(tilt.dpsi_deg_1e9).into();
    let spsi: i128 = sin_deg_1e9(tilt.dpsi_deg_1e9).into();

    let xx = cpsi;
    let yx = -mul_1e9_round(spsi, cobm);
    let zx = -mul_1e9_round(spsi, sobm);
    let xy = mul_1e9_round(spsi, cobt);
    let yy = mul_1e9_round(mul_1e9_round(cpsi, cobm), cobt) + mul_1e9_round(sobm, sobt);
    let zy = mul_1e9_round(mul_1e9_round(cpsi, sobm), cobt) - mul_1e9_round(cobm, sobt);
    let xz = mul_1e9_round(spsi, sobt);
    let yz = mul_1e9_round(mul_1e9_round(cpsi, cobm), sobt) - mul_1e9_round(sobm, cobt);
    let zz = mul_1e9_round(mul_1e9_round(cpsi, sobm), sobt) + mul_1e9_round(cobm, cobt);

    let rx = mul_1e9_round(xx, x.into()) + mul_1e9_round(xy, y.into()) + mul_1e9_round(xz, z.into());
    let ry = mul_1e9_round(yx, x.into()) + mul_1e9_round(yy, y.into()) + mul_1e9_round(yz, z.into());
    let rz = mul_1e9_round(zx, x.into()) + mul_1e9_round(zy, y.into()) + mul_1e9_round(zz, z.into());
    (rx.try_into().unwrap(), ry.try_into().unwrap(), rz.try_into().unwrap())
}

#[inline(never)]
pub fn vsop_ecliptic_to_eqj_1e9(x: i64, y: i64, z: i64) -> (i64, i64, i64) {
    let rx: i128 = (VSOP_R11_1E9.into() * x.into()) / SCALE_1E9.into()
        + (VSOP_R12_1E9.into() * y.into()) / SCALE_1E9.into()
        + (VSOP_R13_1E9.into() * z.into()) / SCALE_1E9.into();
    let ry: i128 = (VSOP_R21_1E9.into() * x.into()) / SCALE_1E9.into()
        + (VSOP_R22_1E9.into() * y.into()) / SCALE_1E9.into()
        + (VSOP_R23_1E9.into() * z.into()) / SCALE_1E9.into();
    let rz: i128 = (VSOP_R31_1E9.into() * x.into()) / SCALE_1E9.into()
        + (VSOP_R32_1E9.into() * y.into()) / SCALE_1E9.into()
        + (VSOP_R33_1E9.into() * z.into()) / SCALE_1E9.into();
    (rx.try_into().unwrap(), ry.try_into().unwrap(), rz.try_into().unwrap())
}

#[inline(never)]
pub fn eqj_to_ecliptic_of_date_longitude_1e9(x: i64, y: i64, z: i64, days_since_j2000_1e9: i64) -> i64 {
    let (lon, _) = eqj_to_ecliptic_of_date_lon_lat_1e9(x, y, z, days_since_j2000_1e9);
    lon
}

#[inline(never)]
pub fn eqj_to_ecliptic_of_date_lon_lat_1e9(
    x: i64, y: i64, z: i64, days_since_j2000_1e9: i64,
) -> (i64, i64) {
    let (mx, my, mz) = precession_from2000_1e9(x, y, z, days_since_j2000_1e9);
    let tilt = iau2000b_e_tilt(days_since_j2000_1e9);
    let (eqdx, eqdy, eqdz) = nutation_from2000_1e9(mx, my, mz, tilt);

    // EQD -> ecliptic of date rotation.
    let ey: i128 = (eqdy.into() * cos_deg_1e9(tilt.tobl_deg_1e9).into()) / SCALE_1E9.into()
        + (eqdz.into() * sin_deg_1e9(tilt.tobl_deg_1e9).into()) / SCALE_1E9.into();
    let ez: i128 = -(eqdy.into() * sin_deg_1e9(tilt.tobl_deg_1e9).into()) / SCALE_1E9.into()
        + (eqdz.into() * cos_deg_1e9(tilt.tobl_deg_1e9).into()) / SCALE_1E9.into();
    let ex_i128: i128 = eqdx.into();
    let ey_i128: i128 = ey;
    let rho: i128 = isqrt_i128(ex_i128 * ex_i128 + ey_i128 * ey_i128);
    let lon = norm360_i64_1e9(atan2_deg_1e9(ey.try_into().unwrap(), eqdx));
    let lat = atan2_deg_1e9(ez.try_into().unwrap(), rho.try_into().unwrap());
    (lon, lat)
}

#[inline(never)]
pub fn eqj_to_ecliptic_of_date_longitude_1e9_round(
    x: i64, y: i64, z: i64, days_since_j2000_1e9: i64,
) -> i64 {
    let (mx, my, mz) = precession_from2000_1e9_round(x, y, z, days_since_j2000_1e9);
    let tilt = iau2000b_e_tilt(days_since_j2000_1e9);
    let (eqdx, eqdy, eqdz) = nutation_from2000_1e9_round(mx, my, mz, tilt);

    let ey = mul_1e9_round(eqdy.into(), cos_deg_1e9(tilt.tobl_deg_1e9).into())
        + mul_1e9_round(eqdz.into(), sin_deg_1e9(tilt.tobl_deg_1e9).into());
    norm360_i64_1e9(atan2_deg_1e9(ey.try_into().unwrap(), eqdx))
}

#[inline(never)]
fn isqrt_i128(n: i128) -> i128 {
    if n <= 0 {
        return 0;
    }
    let mut x = n;
    let mut y = (x + 1) / 2;
    loop {
        if y >= x {
            break;
        }
        x = y;
        y = (x + n / x) / 2;
    };
    x
}

#[cfg(test)]
mod tests {
    use crate::fixed::SCALE_1E9;
    use crate::frames::{eqj_to_ecliptic_of_date_longitude_1e9, vsop_ecliptic_to_eqj_1e9};

    #[test]
    fn eqj_ecliptic_conversion_smoke() {
        let lon = eqj_to_ecliptic_of_date_longitude_1e9(1_000_000_000, 0, 0, 0);
        assert(lon >= 0 && lon < 360 * SCALE_1E9, 'lon range');
    }

    #[test]
    fn vsop_rotation_smoke() {
        let (x, _, _) = vsop_ecliptic_to_eqj_1e9(1_000_000_000, 0, 0);
        assert(x > 999_999_000, 'x');
    }
}
