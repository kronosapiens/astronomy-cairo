// Core planetary longitude computation and public API. Routes each of the seven bodies through
// its appropriate model: the Sun uses a single-step VSOP evaluation (Earth heliocentric
// position negated), the Moon uses a dedicated Meeus-style harmonic series with 104 solar
// disturbance terms and 11 periodic corrections, and Mercury through Saturn share a unified
// VSOP pipeline with iterative light-time correction (up to 10 Newton iterations). Also
// contains the Espenak piecewise delta-T polynomial for UT-to-TT conversion, which is
// needed by both the Moon path (via direct TT computation) and the outer planet paths (via
// the light-time solve). This is the only module that external callers interact with for
// longitude queries; all frame transforms and coordinate projections are handled internally.

use crate::fixed::{
    days_since_j2000_1e9_from_pg, div_round_half_away_from_zero, isqrt_i128, norm360_i64_1e9,
    J2000_MINUTE_SINCE_PG, SCALE_1E9,
};
use crate::frames::{
    eqj_to_ecliptic_of_date_lon_lat_1e9, eqj_to_ecliptic_of_date_longitude_1e9,
    nutation_longitude_deg_1e9, vsop_ecliptic_to_eqj_1e9,
};
use crate::gen::moon::MOON_SOLAR_TERMS;
use crate::trig::{cos_deg_1e9, sin_deg_1e9};
pub const PLANET_COUNT: usize = 7;

pub const SUN: u8 = 0;
pub const MOON: u8 = 1;
pub const MERCURY: u8 = 2;
pub const VENUS: u8 = 3;
pub const MARS: u8 = 4;
pub const JUPITER: u8 = 5;
pub const SATURN: u8 = 6;
use crate::gen::vsop::{
    earth_helio, jupiter_helio, mars_helio, mercury_helio, saturn_helio, venus_helio, HelioState,
};

fn div_round_i64(num: i128, den: i64) -> i64 {
    div_round_half_away_from_zero(num, den.into()).try_into().unwrap()
}

fn frac_1e9(x: i64) -> i64 {
    let mut y = x % SCALE_1E9;
    if y < 0 {
        y += SCALE_1E9;
    }
    y
}

fn turn_to_deg_1e9(turn_1e9: i64) -> i64 {
    let deg: i128 = turn_1e9.into() * 360_i64.into();
    deg.try_into().unwrap()
}

fn sine_turn_1e9(turn_1e9: i64) -> i64 {
    sin_deg_1e9(turn_to_deg_1e9(frac_1e9(turn_1e9)))
}

fn turn_linear_scaled_1e9(
    offset_turn_1e9: i64, rate_turn_per_century_1e9: i64, t_scaled: i64, t_scale: i64,
) -> i64 {
    let delta: i64 = div_round_i64(rate_turn_per_century_1e9.into() * t_scaled.into(), t_scale);
    frac_1e9(offset_turn_1e9 + delta.try_into().unwrap())
}

fn fac_pow_1e9(base_1e9: i64, exp_abs: i8) -> i64 {
    if exp_abs <= 0 {
        return SCALE_1E9;
    }
    let mut out: i128 = SCALE_1E9.into();
    let mut i: i8 = 0;
    while i != exp_abs {
        out = (out * base_1e9.into()) / SCALE_1E9.into();
        i += 1;
    };
    out.try_into().unwrap()
}

fn abs_i8(value: i8) -> i8 {
    if value < 0 { -value } else { value }
}

fn moon_term_y_1e9(
    p: i8,
    q: i8,
    r: i8,
    s: i8,
    l_deg_1e9: i64,
    ls_deg_1e9: i64,
    f_deg_1e9: i64,
    d_deg_1e9: i64,
    fac1_1e9: i64,
    fac2_1e9: i64,
    fac3_1e9: i64,
) -> i64 {
    let phase: i128 = p.into() * l_deg_1e9.into()
        + q.into() * ls_deg_1e9.into()
        + r.into() * f_deg_1e9.into()
        + s.into() * d_deg_1e9.into();
    let mut amp: i128 = fac_pow_1e9(fac1_1e9, abs_i8(p)).into();
    amp = (amp * fac_pow_1e9(fac2_1e9, abs_i8(q)).into()) / SCALE_1E9.into();
    amp = (amp * fac_pow_1e9(fac3_1e9, abs_i8(r)).into()) / SCALE_1E9.into();
    let y: i128 = (amp * sin_deg_1e9(phase.try_into().unwrap()).into()) / SCALE_1E9.into();
    y.try_into().unwrap()
}

fn periodic_arcsec_1e9(
    coeff_1e4: i64, offset_turn_1e9: i64, rate_turn_per_century_1e9: i64, t_scaled: i64, t_scale: i64,
) -> i64 {
    let y = sine_turn_1e9(
        turn_linear_scaled_1e9(offset_turn_1e9, rate_turn_per_century_1e9, t_scaled, t_scale),
    );
    let num: i128 = coeff_1e4.into() * y.into();
    (num / 10_000_i64.into()).try_into().unwrap()
}

fn delta_u_from_y_1e9(y_1e9: i64, base_year_1e9: i64, div: i64) -> i64 {
    // y_1e9 is already scaled by 1e9; divide by `div` to keep 1e9 scale.
    let out: i128 = (y_1e9 - base_year_1e9).into() / div.into();
    out.try_into().unwrap()
}

fn delta_u_powers_1e9(u_1e9: i64) -> (i128, i128, i128, i128, i128, i128) {
    let scale_i128: i128 = SCALE_1E9.into();
    let u2: i128 = (u_1e9.into() * u_1e9.into()) / scale_i128;
    let u3: i128 = (u2 * u_1e9.into()) / scale_i128;
    let u4: i128 = (u2 * u2) / scale_i128;
    let u5: i128 = (u3 * u2) / scale_i128;
    let u6: i128 = (u3 * u3) / scale_i128;
    let u7: i128 = (u6 * u_1e9.into()) / scale_i128;
    (u2, u3, u4, u5, u6, u7)
}

fn delta_poly_term_1e9(coeff_1e9: i64, p_1e9: i128) -> i128 {
    (coeff_1e9.into() * p_1e9) / SCALE_1E9.into()
}

fn delta_poly_term_1e12(coeff_1e12: i64, p_1e9: i128) -> i128 {
    (coeff_1e12.into() * p_1e9) / 1_000_000_000_000_i64.into()
}

// Piecewise Espenak delta-T polynomial (UT->TT correction).
// The piecewise structure and all coefficients come directly from the upstream formula.
// High-order terms with very small coefficients (e.g. 0.0000121272) use `delta_poly_term_1e12`
// instead of `delta_poly_term_1e9` to avoid losing all significant digits at 1e9 scale.
fn delta_t_espenak_seconds_1e9(ut_days_since_j2000_1e9: i64) -> i64 {
    let scale_i128: i128 = SCALE_1E9.into();
    let y_1e9: i64 = 2_000_000_000_000
        + (((ut_days_since_j2000_1e9 - 14 * SCALE_1E9).into() * scale_i128) / 365_242_170_000_i64.into())
            .try_into()
            .unwrap();

    if y_1e9 < -500_000_000_000 {
        let u = delta_u_from_y_1e9(y_1e9, 1_820_000_000_000, 100);
        let u2: i128 = (u.into() * u.into()) / scale_i128;
        return -20 * SCALE_1E9 + (32_i64.into() * u2 / scale_i128).try_into().unwrap();
    }
    if y_1e9 < 500_000_000_000 {
        let u = delta_u_from_y_1e9(y_1e9, 0, 100);
        let (u2, u3, u4, u5, u6, _) = delta_u_powers_1e9(u);
        let out: i128 = 10_583_600_000_000_i64.into()
            + delta_poly_term_1e9(-1_014_410_000_000, u.into())
            + delta_poly_term_1e9(33_783_110_000, u2)
            + delta_poly_term_1e9(-5_952_053_000, u3)
            + delta_poly_term_1e9(-179_845_200, u4)
            + delta_poly_term_1e9(22_174_192, u5)
            + delta_poly_term_1e9(9_031_652, u6);
        return out.try_into().unwrap();
    }
    if y_1e9 < 1_600_000_000_000 {
        let u = delta_u_from_y_1e9(y_1e9, 1_000_000_000_000, 100);
        let (u2, u3, u4, u5, u6, _) = delta_u_powers_1e9(u);
        let out: i128 = 1_574_200_000_000_i64.into()
            + delta_poly_term_1e9(-556_010_000_000, u.into())
            + delta_poly_term_1e9(71_234_720_000, u2)
            + delta_poly_term_1e9(319_781_000, u3)
            + delta_poly_term_1e9(-850_346_300, u4)
            + delta_poly_term_1e9(-5_050_998, u5)
            + delta_poly_term_1e9(8_357_207, u6);
        return out.try_into().unwrap();
    }
    if y_1e9 < 1_700_000_000_000 {
        let u = y_1e9 - 1_600_000_000_000;
        let (u2, u3, _, _, _, _) = delta_u_powers_1e9(u);
        let out: i128 = 120_000_000_000_i64.into()
            + delta_poly_term_1e9(-980_800_000, u.into())
            + delta_poly_term_1e9(-15_320_000, u2)
            + (u3.into() / 7_129_i64.into());
        return out.try_into().unwrap();
    }
    if y_1e9 < 1_800_000_000_000 {
        let u = y_1e9 - 1_700_000_000_000;
        let (u2, u3, u4, _, _, _) = delta_u_powers_1e9(u);
        let out: i128 = 8_830_000_000_i64.into()
            + delta_poly_term_1e9(160_300_000, u.into())
            + delta_poly_term_1e9(-5_928_500, u2)
            + delta_poly_term_1e9(133_360, u3)
            - (u4.into() / 1_174_000_i64.into());
        return out.try_into().unwrap();
    }
    if y_1e9 < 1_860_000_000_000 {
        let u = y_1e9 - 1_800_000_000_000;
        let (u2, u3, u4, u5, u6, u7) = delta_u_powers_1e9(u);
        let out: i128 = 13_720_000_000_i64.into()
            + delta_poly_term_1e9(-332_447_000, u.into())
            + delta_poly_term_1e9(6_861_200, u2)
            + delta_poly_term_1e9(4_111_600, u3)
            + delta_poly_term_1e9(-374_360, u4)
            + delta_poly_term_1e12(12_127_200, u5) // 0.0000121272
            + delta_poly_term_1e12(-169_900, u6) // -0.0000001699
            + delta_poly_term_1e12(875, u7); // 0.000000000875
        return out.try_into().unwrap();
    }
    if y_1e9 < 1_900_000_000_000 {
        let u = y_1e9 - 1_860_000_000_000;
        let (u2, u3, u4, u5, _, _) = delta_u_powers_1e9(u);
        let out: i128 = 7_620_000_000_i64.into()
            + delta_poly_term_1e9(573_700_000, u.into())
            + delta_poly_term_1e9(-251_754_000, u2)
            + delta_poly_term_1e9(16_806_680, u3)
            + delta_poly_term_1e9(-447_362, u4)
            + (u5.into() / 233_174_i64.into());
        return out.try_into().unwrap();
    }
    if y_1e9 < 1_920_000_000_000 {
        let u = y_1e9 - 1_900_000_000_000;
        let (u2, u3, u4, _, _, _) = delta_u_powers_1e9(u);
        let out: i128 = -2_790_000_000_i64.into()
            + delta_poly_term_1e9(1_494_119_000, u.into())
            + delta_poly_term_1e9(-59_893_900, u2)
            + delta_poly_term_1e9(6_196_600, u3)
            + delta_poly_term_1e9(-197_000, u4);
        return out.try_into().unwrap();
    }
    if y_1e9 < 1_941_000_000_000 {
        let u = y_1e9 - 1_920_000_000_000;
        let (u2, u3, _, _, _, _) = delta_u_powers_1e9(u);
        let out: i128 = 21_200_000_000_i64.into()
            + delta_poly_term_1e9(844_930_000, u.into())
            + delta_poly_term_1e9(-76_100_000, u2)
            + delta_poly_term_1e9(2_093_600, u3);
        return out.try_into().unwrap();
    }
    if y_1e9 < 1_961_000_000_000 {
        let u = y_1e9 - 1_950_000_000_000;
        let (u2, u3, _, _, _, _) = delta_u_powers_1e9(u);
        let out: i128 = 29_070_000_000_i64.into()
            + delta_poly_term_1e9(407_000_000, u.into())
            - (u2.into() / 233_i64.into())
            + (u3.into() / 2_547_i64.into());
        return out.try_into().unwrap();
    }
    if y_1e9 < 1_986_000_000_000 {
        let u = y_1e9 - 1_975_000_000_000;
        let (u2, u3, _, _, _, _) = delta_u_powers_1e9(u);
        let out: i128 = 45_450_000_000_i64.into()
            + delta_poly_term_1e9(1_067_000_000, u.into())
            - (u2.into() / 260_i64.into())
            - (u3.into() / 718_i64.into());
        return out.try_into().unwrap();
    }
    if y_1e9 < 2_005_000_000_000 {
        let u = y_1e9 - 2_000_000_000_000;
        let (u2, u3, u4, u5, _, _) = delta_u_powers_1e9(u);
        let out: i128 = 63_860_000_000_i64.into()
            + delta_poly_term_1e9(334_500_000, u.into())
            + delta_poly_term_1e9(-60_374_000, u2)
            + delta_poly_term_1e9(1_727_500, u3)
            + delta_poly_term_1e9(651_814, u4)
            + delta_poly_term_1e9(23_736, u5);
        return out.try_into().unwrap();
    }
    if y_1e9 < 2_050_000_000_000 {
        let u = y_1e9 - 2_000_000_000_000;
        let (u2, _, _, _, _, _) = delta_u_powers_1e9(u);
        let out: i128 = 62_920_000_000_i64.into()
            + delta_poly_term_1e9(322_170_000, u.into())
            + delta_poly_term_1e9(5_589_000, u2);
        return out.try_into().unwrap();
    }
    if y_1e9 < 2_150_000_000_000 {
        let u = delta_u_from_y_1e9(y_1e9, 1_820_000_000_000, 100);
        let u2: i128 = (u.into() * u.into()) / scale_i128;
        let out: i128 = -20_000_000_000_i64.into()
            + delta_poly_term_1e9(32_000_000_000, u2)
            + delta_poly_term_1e9(562_800_000, (y_1e9 - 2_150_000_000_000).into());
        return out.try_into().unwrap();
    }
    let u = delta_u_from_y_1e9(y_1e9, 1_820_000_000_000, 100);
    let u2: i128 = (u.into() * u.into()) / scale_i128;
    (-20_000_000_000_i64.into() + delta_poly_term_1e9(32_000_000_000, u2)).try_into().unwrap()
}

#[inline(never)]
fn moon_longitude_1e9(d_days_1e9: i64) -> i64 {
    // Upstream-style CalcMoon longitude chain (arcseconds terms + periodic corrections), with
    // fixed-point arithmetic and existing degree-space trig.
    let t_scale: i64 = 1_000_000_000_000; // centuries scaled by 1e12 internally
    let delta_t_sec_1e9 = delta_t_espenak_seconds_1e9(d_days_1e9);
    let d_tt_1e9 = d_days_1e9 + div_round_i64(delta_t_sec_1e9.into(), 86_400);
    let t_1e12: i64 = div_round_i64(d_tt_1e9.into() * 1000_i64.into(), 36_525);
    let t2_num: i128 = t_1e12.into() * t_1e12.into();
    let t2_1e12: i64 = div_round_i64(t2_num, t_scale);

    let s1 = sine_turn_1e9(turn_linear_scaled_1e9(198_330_000, 56_110_000, t_1e12, t_scale));
    let s2 = sine_turn_1e9(turn_linear_scaled_1e9(278_690_000, 45_080_000, t_1e12, t_scale));
    let s3 = sine_turn_1e9(turn_linear_scaled_1e9(168_270_000, -369_030_000, t_1e12, t_scale));
    let s4 = sine_turn_1e9(turn_linear_scaled_1e9(347_340_000, -5_372_610_000, t_1e12, t_scale));
    let s5 = sine_turn_1e9(turn_linear_scaled_1e9(104_980_000, -5_378_990_000, t_1e12, t_scale));
    let s6 = sine_turn_1e9(turn_linear_scaled_1e9(426_810_000, -418_550_000, t_1e12, t_scale));
    let s7 = sine_turn_1e9(turn_linear_scaled_1e9(149_430_000, -5_375_110_000, t_1e12, t_scale));

    let dl0_num: i128 = 840_000_000_i64.into() * s1.into()
        + 310_000_000_i64.into() * s2.into()
        + 14_270_000_000_i64.into() * s3.into()
        + 7_260_000_000_i64.into() * s4.into()
        + 280_000_000_i64.into() * s5.into()
        + 240_000_000_i64.into() * s6.into();
    let dl0_arcsec_1e9: i64 = div_round_i64(dl0_num, SCALE_1E9);
    let dl_num: i128 = 2_940_000_000_i64.into() * s1.into()
        + 310_000_000_i64.into() * s2.into()
        + 14_270_000_000_i64.into() * s3.into()
        + 9_340_000_000_i64.into() * s4.into()
        + 1_120_000_000_i64.into() * s5.into()
        + 830_000_000_i64.into() * s6.into();
    let dl_arcsec_1e9: i64 = div_round_i64(dl_num, SCALE_1E9);
    let dls_num: i128 = -6_400_000_000_i64.into() * s1.into() - 1_890_000_000_i64.into() * s6.into();
    let dls_arcsec_1e9: i64 = div_round_i64(dls_num, SCALE_1E9);
    let df_num: i128 = 210_000_000_i64.into() * s1.into()
        + 310_000_000_i64.into() * s2.into()
        + 14_270_000_000_i64.into() * s3.into()
        - 88_700_000_000_i64.into() * s4.into()
        - 15_300_000_000_i64.into() * s5.into()
        + 240_000_000_i64.into() * s6.into()
        - 1_860_000_000_i64.into() * s7.into();
    let df_arcsec_1e9: i64 = div_round_i64(df_num, SCALE_1E9);
    let dd_arcsec_1e9 = dl0_arcsec_1e9 - dls_arcsec_1e9;

    let dgam_num: i128 = -3_332_i64.into()
        * sine_turn_1e9(turn_linear_scaled_1e9(597_340_000, -5_372_610_000, t_1e12, t_scale))
            .into()
        - 539_i64.into()
            * sine_turn_1e9(turn_linear_scaled_1e9(354_980_000, -5_378_990_000, t_1e12, t_scale))
                .into()
        - 64_i64.into()
            * sine_turn_1e9(turn_linear_scaled_1e9(399_430_000, -5_375_110_000, t_1e12, t_scale))
                .into();
    let dgam_1e9: i64 = div_round_i64(dgam_num, SCALE_1E9);

    let l0_rate: i64 = div_round_i64(1_336_855_224_670_i64.into() * t_1e12.into(), t_scale);
    let l0_quad: i64 = div_round_i64(-3_130_i64.into() * t2_1e12.into(), t_scale);
    let l0_turn_1e9: i64 = frac_1e9(606_433_820 + l0_rate + l0_quad);
    let l_rate: i64 = div_round_i64(1_325_552_409_820_i64.into() * t_1e12.into(), t_scale);
    let l_quad: i64 = div_round_i64(25_650_i64.into() * t2_1e12.into(), t_scale);
    let l_turn_1e9: i64 = frac_1e9(374_897_010 + l_rate + l_quad);
    let ls_rate: i64 = div_round_i64(99_997_359_560_i64.into() * t_1e12.into(), t_scale);
    let ls_quad: i64 = div_round_i64(-440_i64.into() * t2_1e12.into(), t_scale);
    let ls_turn_1e9: i64 = frac_1e9(993_126_190 + ls_rate + ls_quad);
    let f_rate: i64 = div_round_i64(1_342_227_829_800_i64.into() * t_1e12.into(), t_scale);
    let f_quad: i64 = div_round_i64(-8_920_i64.into() * t2_1e12.into(), t_scale);
    let f_turn_1e9: i64 = frac_1e9(259_091_180 + f_rate + f_quad);
    let d_rate: i64 = div_round_i64(1_236_853_087_080_i64.into() * t_1e12.into(), t_scale);
    let d_quad: i64 = div_round_i64(-3_970_i64.into() * t2_1e12.into(), t_scale);
    let d_turn_1e9: i64 = frac_1e9(827_361_860 + d_rate + d_quad);

    let l0_deg_1e9 = turn_to_deg_1e9(l0_turn_1e9) + div_round_i64(dl0_arcsec_1e9.into(), 3600);
    let l_deg_1e9 = turn_to_deg_1e9(l_turn_1e9) + div_round_i64(dl_arcsec_1e9.into(), 3600);
    let ls_deg_1e9 = turn_to_deg_1e9(ls_turn_1e9) + div_round_i64(dls_arcsec_1e9.into(), 3600);
    let f_deg_1e9 = turn_to_deg_1e9(f_turn_1e9) + div_round_i64(df_arcsec_1e9.into(), 3600);
    let d_deg_1e9 = turn_to_deg_1e9(d_turn_1e9) + div_round_i64(dd_arcsec_1e9.into(), 3600);

    let fac1_1e9: i64 = 1_000_002_208;
    let fac2_1e9: i64 = 997_504_612 - div_round_i64(2_495_388_i64.into() * t_1e12.into(), t_scale);
    let fac3_1e9: i64 = 1_000_002_708
        + div_round_i64(139_978_000_000_i64.into() * dgam_1e9.into(), SCALE_1E9);

    let mut dlam_arcsec_1e9: i64 = 0;
    let mut i: usize = 0;
    while i != 104 {
        let term = *MOON_SOLAR_TERMS.span().at(i);
        let (coeff_l_1e4, _, _, p, q, r, s) = term;
        let y = moon_term_y_1e9(
            p, q, r, s, l_deg_1e9, ls_deg_1e9, f_deg_1e9, d_deg_1e9, fac1_1e9, fac2_1e9, fac3_1e9,
        );
        let dlam_num: i128 = coeff_l_1e4.into() * y.into();
        dlam_arcsec_1e9 += div_round_i64(dlam_num, 10_000);
        i += 1;
    };

    dlam_arcsec_1e9 += periodic_arcsec_1e9(8_200, 773_600_000, -62_551_200_000, t_1e12, t_scale);
    dlam_arcsec_1e9 += periodic_arcsec_1e9(3_100, 46_600_000, -125_102_500_000, t_1e12, t_scale);
    dlam_arcsec_1e9 += periodic_arcsec_1e9(3_500, 578_500_000, -25_104_200_000, t_1e12, t_scale);
    dlam_arcsec_1e9 += periodic_arcsec_1e9(6_600, 459_100_000, 1_335_807_500_000, t_1e12, t_scale);
    dlam_arcsec_1e9 += periodic_arcsec_1e9(6_400, 313_000_000, -91_568_000_000, t_1e12, t_scale);
    dlam_arcsec_1e9 += periodic_arcsec_1e9(11_400, 148_000_000, 1_331_289_800_000, t_1e12, t_scale);
    dlam_arcsec_1e9 += periodic_arcsec_1e9(2_100, 591_800_000, 1_056_585_900_000, t_1e12, t_scale);
    dlam_arcsec_1e9 += periodic_arcsec_1e9(4_400, 578_400_000, 1_322_859_500_000, t_1e12, t_scale);
    dlam_arcsec_1e9 += periodic_arcsec_1e9(2_400, 227_500_000, -5_737_400_000, t_1e12, t_scale);
    dlam_arcsec_1e9 += periodic_arcsec_1e9(2_800, 296_500_000, 2_692_900_000, t_1e12, t_scale);
    dlam_arcsec_1e9 += periodic_arcsec_1e9(3_300, 313_200_000, 6_336_800_000, t_1e12, t_scale);

    // Ecliptic mean->true correction: add nutation in longitude (dpsi).
    let dpsi = nutation_longitude_deg_1e9(d_tt_1e9);
    norm360_i64_1e9(l0_deg_1e9 + div_round_i64(dlam_arcsec_1e9.into(), 3600) + dpsi)
}

#[inline(never)]
fn t_millennia_1e9_from_pg_minute(minute_since_pg: i64) -> i64 {
    let d_tt_1e9 = tt_days_since_j2000_1e9_from_pg_minute(minute_since_pg);
    div_round_i64(d_tt_1e9.into(), 365250)
}

#[inline(never)]
fn tt_days_since_j2000_1e9_from_pg_minute(minute_since_pg: i64) -> i64 {
    let d_ut_1e9 = days_since_j2000_1e9_from_pg(minute_since_pg);
    let delta_t_sec_1e9 = delta_t_espenak_seconds_1e9(d_ut_1e9);
    d_ut_1e9 + div_round_i64(delta_t_sec_1e9.into(), 86_400)
}

#[inline(never)]
fn days_since_j2000_1e9_from_pg_minute_1e9(minute_since_pg_1e9: i64) -> i64 {
    let delta_min_1e9: i128 =
        minute_since_pg_1e9.into() - J2000_MINUTE_SINCE_PG.into() * SCALE_1E9.into();
    div_round_i64(delta_min_1e9, 1_440)
}

#[inline(never)]
fn tt_days_since_j2000_1e9_from_pg_minute_1e9(minute_since_pg_1e9: i64) -> i64 {
    let d_ut_1e9 = days_since_j2000_1e9_from_pg_minute_1e9(minute_since_pg_1e9);
    let delta_t_sec_1e9 = delta_t_espenak_seconds_1e9(d_ut_1e9);
    d_ut_1e9 + div_round_i64(delta_t_sec_1e9.into(), 86_400)
}

#[inline(never)]
fn t_millennia_1e9_from_pg_minute_1e9(minute_since_pg_1e9: i64) -> i64 {
    let d_tt_1e9 = tt_days_since_j2000_1e9_from_pg_minute_1e9(minute_since_pg_1e9);
    div_round_i64(d_tt_1e9.into(), 365250)
}

#[inline(never)]
fn t_millennia_1e9_from_tt_days_1e9(d_tt_1e9: i64) -> i64 {
    div_round_i64(d_tt_1e9.into(), 365250)
}

#[inline(never)]
fn helio_state_for_planet(planet_idx: usize, t_millennia_1e9: i64) -> HelioState {
    if planet_idx == 2 {
        mercury_helio(t_millennia_1e9)
    } else if planet_idx == 3 {
        venus_helio(t_millennia_1e9)
    } else if planet_idx == 4 {
        mars_helio(t_millennia_1e9)
    } else if planet_idx == 5 {
        jupiter_helio(t_millennia_1e9)
    } else {
        saturn_helio(t_millennia_1e9)
    }
}

#[inline(never)]
fn helio_xyz_1e9(h: HelioState) -> (i64, i64, i64) {
    let cb: i128 = cos_deg_1e9(h.b_deg_1e9).into();
    let x: i128 = (h.r_au_1e9.into() * cb * cos_deg_1e9(h.l_deg_1e9).into())
        / SCALE_1E9.into()
        / SCALE_1E9.into();
    let y: i128 = (h.r_au_1e9.into() * cb * sin_deg_1e9(h.l_deg_1e9).into())
        / SCALE_1E9.into()
        / SCALE_1E9.into();
    let z: i128 = (h.r_au_1e9.into() * sin_deg_1e9(h.b_deg_1e9).into()) / SCALE_1E9.into();
    (x.try_into().unwrap(), y.try_into().unwrap(), z.try_into().unwrap())
}

#[inline(never)]
fn geocentric_eqj_vector_obs_tt_vsop_pg_1e9(
    planet_idx: usize, minute_since_pg: i64,
) -> (i64, i64, i64, i64) {
    let minute_pg_1e9_i128: i128 = minute_since_pg.into() * SCALE_1E9.into();
    let minute_pg_1e9: i64 = minute_pg_1e9_i128.try_into().unwrap();
    let obs_tt_1e9 = tt_days_since_j2000_1e9_from_pg_minute_1e9(minute_pg_1e9);
    let c_au_per_day_1e9: i64 = 173_144_632_685;
    let mut tt_shift_1e9: i64 = obs_tt_1e9;
    let mut iter: u8 = 0;
    let mut xe: i64 = 0;
    let mut ye: i64 = 0;
    let mut ze: i64 = 0;
    let mut xp: i64 = 0;
    let mut yp: i64 = 0;
    let mut zp: i64 = 0;
    loop {
        if iter >= 10 {
            break;
        }
        let tshift = t_millennia_1e9_from_tt_days_1e9(tt_shift_1e9);
        let p = helio_state_for_planet(planet_idx, tshift);
        let e = earth_helio(tshift);
        let (xp_raw, yp_raw, zp_raw) = helio_xyz_1e9(p);
        let (xe_raw, ye_raw, ze_raw) = helio_xyz_1e9(e);
        let (xp_i, yp_i, zp_i) = vsop_ecliptic_to_eqj_1e9(xp_raw, yp_raw, zp_raw);
        let (xe_i, ye_i, ze_i) = vsop_ecliptic_to_eqj_1e9(xe_raw, ye_raw, ze_raw);
        xp = xp_i;
        yp = yp_i;
        zp = zp_i;
        xe = xe_i;
        ye = ye_i;
        ze = ze_i;
        let dx: i128 = (xp - xe).into();
        let dy: i128 = (yp - ye).into();
        let dz: i128 = (zp - ze).into();
        let dist2: i128 = dx * dx + dy * dy + dz * dz;
        let dist_au_1e9: i128 = isqrt_i128(dist2);
        let dt_days_1e9: i128 = (dist_au_1e9 * SCALE_1E9.into()) / c_au_per_day_1e9.into();
        let tt_shift_next_1e9: i64 = (obs_tt_1e9.into() - dt_days_1e9).try_into().unwrap();
        // Match upstream convergence rule: |tt_next - tt_prev| < 1e-9 day.
        let dt_iter = if tt_shift_next_1e9 >= tt_shift_1e9 {
            tt_shift_next_1e9 - tt_shift_1e9
        } else {
            tt_shift_1e9 - tt_shift_next_1e9
        };
        if dt_iter < 1 {
            break;
        }
        tt_shift_1e9 = tt_shift_next_1e9;
        iter += 1;
    };
    (xp - xe, yp - ye, zp - ze, obs_tt_1e9)
}

#[inline(never)]
fn geocentric_longitude_vsop_pg_1e9(planet_idx: usize, minute_since_pg: i64) -> i64 {
    let (dx_eqj, dy_eqj, dz_eqj, obs_tt_1e9) =
        geocentric_eqj_vector_obs_tt_vsop_pg_1e9(planet_idx, minute_since_pg);
    let (lon, _) = eqj_to_ecliptic_of_date_lon_lat_1e9(dx_eqj, dy_eqj, dz_eqj, obs_tt_1e9);
    lon
}

/// Debug probe for planetary geocentric EQJ vector and observation TT day count.
/// Supported planets: Mercury..Saturn (2..6).
#[inline(never)]
pub fn debug_planet_geocentric_eqj_pg_1e9(
    planet: u8, minute_since_pg: i64,
) -> (i64, i64, i64, i64) {
    assert(planet >= 2 && planet <= 6, 'debug planet must be 2..6');
    geocentric_eqj_vector_obs_tt_vsop_pg_1e9(planet.into(), minute_since_pg)
}

/// Debug probe for ecliptic frame projection.
/// Supported planets: Mercury..Saturn (2..6).
#[inline(never)]
pub fn debug_planet_frame_lon_lat_pg_1e9(planet: u8, minute_since_pg: i64) -> (i64, i64) {
    assert(planet >= 2 && planet <= 6, 'debug planet must be 2..6');
    let (dx_eqj, dy_eqj, dz_eqj, obs_tt_1e9) = debug_planet_geocentric_eqj_pg_1e9(
        planet, minute_since_pg,
    );
    eqj_to_ecliptic_of_date_lon_lat_1e9(dx_eqj, dy_eqj, dz_eqj, obs_tt_1e9)
}

#[inline(never)]
fn geocentric_sun_longitude_vsop_pg_1e9(minute_since_pg: i64) -> i64 {
    // Upstream SunPosition uses a fixed shift of exactly 1/C day.
    let c_au_per_day_1e9: i64 = 173_144_632_685;
    let dt_days_1e9: i128 = (SCALE_1E9.into() * SCALE_1E9.into()) / c_au_per_day_1e9.into();
    let minute_pg_1e9_i128: i128 = minute_since_pg.into() * SCALE_1E9.into();
    let minute_pg_1e9: i64 = minute_pg_1e9_i128.try_into().unwrap();
    let obs_tt_1e9 = tt_days_since_j2000_1e9_from_pg_minute_1e9(minute_pg_1e9);
    let tt_shift_1e9: i64 = (obs_tt_1e9.into() - dt_days_1e9).try_into().unwrap();
    let earth = earth_helio(t_millennia_1e9_from_tt_days_1e9(tt_shift_1e9));
    let (xe_raw, ye_raw, ze_raw) = helio_xyz_1e9(earth);
    let (xe, ye, ze) = vsop_ecliptic_to_eqj_1e9(xe_raw, ye_raw, ze_raw);
    // Sun geocentric vector is negative of Earth's heliocentric vector.
    eqj_to_ecliptic_of_date_longitude_1e9(-xe, -ye, -ze, obs_tt_1e9)
}

pub fn approximate_planet_longitude_pg_1e9(planet: u8, minute_since_pg: i64) -> i64 {
    let idx: usize = planet.into();
    assert(idx < PLANET_COUNT, 'planet index out of range');

    if planet == 0 {
        return geocentric_sun_longitude_vsop_pg_1e9(minute_since_pg);
    }
    if planet == 1 {
        let d = days_since_j2000_1e9_from_pg(minute_since_pg);
        return moon_longitude_1e9(d);
    }
    geocentric_longitude_vsop_pg_1e9(planet.into(), minute_since_pg)
}

#[inline(never)]
pub fn all_planet_longitudes_pg_1e9(minute_since_pg: i64) -> [i64; PLANET_COUNT] {
    [
        approximate_planet_longitude_pg_1e9(0, minute_since_pg),
        approximate_planet_longitude_pg_1e9(1, minute_since_pg),
        approximate_planet_longitude_pg_1e9(2, minute_since_pg),
        approximate_planet_longitude_pg_1e9(3, minute_since_pg),
        approximate_planet_longitude_pg_1e9(4, minute_since_pg),
        approximate_planet_longitude_pg_1e9(5, minute_since_pg),
        approximate_planet_longitude_pg_1e9(6, minute_since_pg),
    ]
}

#[cfg(test)]
mod tests {
    use crate::ascendant::approximate_ascendant_longitude_pg_1e9;
    use crate::fixed::{norm360_i64_1e9, SCALE_1E9};
    use crate::planets::{approximate_planet_longitude_pg_1e9, all_planet_longitudes_pg_1e9};
    use super::delta_t_espenak_seconds_1e9;

    fn abs_i64(v: i64) -> i64 {
        if v < 0 { -v } else { v }
    }

    fn sign_from_lon_1e9(lon_1e9: i64) -> u8 {
        (norm360_i64_1e9(lon_1e9) / (30 * SCALE_1E9)).try_into().unwrap()
    }

    #[test]
    fn delta_t_at_j2000() {
        // At J2000 (days=0), delta-T ≈ 63.83 seconds (published value).
        let dt = delta_t_espenak_seconds_1e9(0);
        // Allow ±0.5s tolerance for fixed-point rounding vs published tables.
        assert(abs_i64(dt - 63_830_000_000) < 500_000_000, 'dt j2000');
    }

    #[test]
    fn delta_t_at_1900() {
        // 1900-01-01 is ~-36524.5 days from J2000. delta-T ≈ -2.79 seconds.
        // (Espenak table: year 1900, dt ≈ -2.79s)
        let days_1e9: i64 = -36_524_500_000_000;
        let dt = delta_t_espenak_seconds_1e9(days_1e9);
        assert(abs_i64(dt + 2_790_000_000) < 500_000_000, 'dt 1900');
    }

    #[test]
    fn delta_t_at_1950() {
        // 1950-01-01 is ~-18262 days from J2000. delta-T ≈ 29.07 seconds.
        let days_1e9: i64 = -18_262_000_000_000;
        let dt = delta_t_espenak_seconds_1e9(days_1e9);
        assert(abs_i64(dt - 29_070_000_000) < 500_000_000, 'dt 1950');
    }

    #[test]
    fn smoke_parametric_all_planets() {
        // 998_776_800 (1900 pg offset) + 66_348_000 ≈ year 2026
        let minute_pg: i64 = 1_065_124_800;
        assert(approximate_planet_longitude_pg_1e9(0, minute_pg) >= 0, 'p0');
        assert(approximate_planet_longitude_pg_1e9(1, minute_pg) >= 0, 'p1');
        assert(approximate_planet_longitude_pg_1e9(2, minute_pg) >= 0, 'p2');
        assert(approximate_planet_longitude_pg_1e9(3, minute_pg) >= 0, 'p3');
        assert(approximate_planet_longitude_pg_1e9(4, minute_pg) >= 0, 'p4');
        assert(approximate_planet_longitude_pg_1e9(5, minute_pg) >= 0, 'p5');
        assert(approximate_planet_longitude_pg_1e9(6, minute_pg) >= 0, 'p6');
    }

    #[test]
    fn benchmark_all_planets() {
        let minute_pg: i64 = 1_065_124_800;
        let vals = all_planet_longitudes_pg_1e9(minute_pg);
        assert(*vals.span().at(0) >= 0, 'v0');
        assert(*vals.span().at(1) >= 0, 'v1');
        assert(*vals.span().at(2) >= 0, 'v2');
        assert(*vals.span().at(3) >= 0, 'v3');
        assert(*vals.span().at(4) >= 0, 'v4');
        assert(*vals.span().at(5) >= 0, 'v5');
        assert(*vals.span().at(6) >= 0, 'v6');
    }

    #[test]
    fn chart_snapshot_2000_sf() {
        // 2000-01-01T12:00:00Z, lat/lon = 37.7/-122.4
        let minute_pg: i64 = 1_051_372_080;
        let lat_bin: i16 = 3770;
        let lon_bin: i16 = -12240;
        let expected_planet: [u8; 7] = [9, 7, 9, 8, 10, 0, 1];
        let expected_asc: u8 = 7;

        assert(sign_from_lon_1e9(approximate_planet_longitude_pg_1e9(0, minute_pg)) == *expected_planet.span().at(0), 'c2000 p0');
        assert(sign_from_lon_1e9(approximate_planet_longitude_pg_1e9(1, minute_pg)) == *expected_planet.span().at(1), 'c2000 p1');
        assert(sign_from_lon_1e9(approximate_planet_longitude_pg_1e9(2, minute_pg)) == *expected_planet.span().at(2), 'c2000 p2');
        assert(sign_from_lon_1e9(approximate_planet_longitude_pg_1e9(3, minute_pg)) == *expected_planet.span().at(3), 'c2000 p3');
        assert(sign_from_lon_1e9(approximate_planet_longitude_pg_1e9(4, minute_pg)) == *expected_planet.span().at(4), 'c2000 p4');
        assert(sign_from_lon_1e9(approximate_planet_longitude_pg_1e9(5, minute_pg)) == *expected_planet.span().at(5), 'c2000 p5');
        assert(sign_from_lon_1e9(approximate_planet_longitude_pg_1e9(6, minute_pg)) == *expected_planet.span().at(6), 'c2000 p6');
        assert(sign_from_lon_1e9(approximate_ascendant_longitude_pg_1e9(minute_pg, lat_bin, lon_bin)) == expected_asc, 'c2000 asc');
    }

    #[test]
    fn chart_snapshot_2024_nyc() {
        // 2024-04-08T18:00:00Z, lat/lon = 40.7/-74.0
        let minute_pg: i64 = 1_064_136_600;
        let lat_bin: i16 = 4070;
        let lon_bin: i16 = -7400;
        let expected_planet: [u8; 7] = [0, 0, 0, 0, 11, 1, 11];
        let expected_asc: u8 = 4;

        assert(sign_from_lon_1e9(approximate_planet_longitude_pg_1e9(0, minute_pg)) == *expected_planet.span().at(0), 'c2024 p0');
        assert(sign_from_lon_1e9(approximate_planet_longitude_pg_1e9(1, minute_pg)) == *expected_planet.span().at(1), 'c2024 p1');
        assert(sign_from_lon_1e9(approximate_planet_longitude_pg_1e9(2, minute_pg)) == *expected_planet.span().at(2), 'c2024 p2');
        assert(sign_from_lon_1e9(approximate_planet_longitude_pg_1e9(3, minute_pg)) == *expected_planet.span().at(3), 'c2024 p3');
        assert(sign_from_lon_1e9(approximate_planet_longitude_pg_1e9(4, minute_pg)) == *expected_planet.span().at(4), 'c2024 p4');
        assert(sign_from_lon_1e9(approximate_planet_longitude_pg_1e9(5, minute_pg)) == *expected_planet.span().at(5), 'c2024 p5');
        assert(sign_from_lon_1e9(approximate_planet_longitude_pg_1e9(6, minute_pg)) == *expected_planet.span().at(6), 'c2024 p6');
        assert(sign_from_lon_1e9(approximate_ascendant_longitude_pg_1e9(minute_pg, lat_bin, lon_bin)) == expected_asc, 'c2024 asc');
    }

    #[test]
    fn chart_snapshot_2500_sydney() {
        // 2500-06-15T03:00:00Z, lat/lon = -33.8/151.2
        let minute_pg: i64 = 1_314_584_820;
        let lat_bin: i16 = -3380;
        let lon_bin: i16 = 15120;
        let expected_planet: [u8; 7] = [2, 9, 3, 1, 1, 3, 1];
        let expected_asc: u8 = 6;

        assert(sign_from_lon_1e9(approximate_planet_longitude_pg_1e9(0, minute_pg)) == *expected_planet.span().at(0), 'c2500 p0');
        assert(sign_from_lon_1e9(approximate_planet_longitude_pg_1e9(1, minute_pg)) == *expected_planet.span().at(1), 'c2500 p1');
        assert(sign_from_lon_1e9(approximate_planet_longitude_pg_1e9(2, minute_pg)) == *expected_planet.span().at(2), 'c2500 p2');
        assert(sign_from_lon_1e9(approximate_planet_longitude_pg_1e9(3, minute_pg)) == *expected_planet.span().at(3), 'c2500 p3');
        assert(sign_from_lon_1e9(approximate_planet_longitude_pg_1e9(4, minute_pg)) == *expected_planet.span().at(4), 'c2500 p4');
        assert(sign_from_lon_1e9(approximate_planet_longitude_pg_1e9(5, minute_pg)) == *expected_planet.span().at(5), 'c2500 p5');
        assert(sign_from_lon_1e9(approximate_planet_longitude_pg_1e9(6, minute_pg)) == *expected_planet.span().at(6), 'c2500 p6');
        assert(sign_from_lon_1e9(approximate_ascendant_longitude_pg_1e9(minute_pg, lat_bin, lon_bin)) == expected_asc, 'c2500 asc');
    }

    #[test]
    fn regression_sun_pg_1900_smoke() {
        // 1900-01-01T00:00:00Z in proleptic-Gregorian minute domain.
        let minute_pg: i64 = 998_776_800;
        let lon = approximate_planet_longitude_pg_1e9(0, minute_pg);
        assert(lon >= 0, 'sun1900 lo');
        assert(lon < 360 * SCALE_1E9, 'sun1900 hi');
    }

    #[test]
    fn regression_moon_pg_1900_smoke() {
        let minute_pg: i64 = 998_776_800;
        let lon = approximate_planet_longitude_pg_1e9(1, minute_pg);
        assert(lon >= 0, 'moon1900 lo');
        assert(lon < 360 * SCALE_1E9, 'moon1900 hi');
    }

    #[test]
    fn regression_mercury_pg_1900_smoke() {
        let minute_pg: i64 = 998_776_800;
        let lon = approximate_planet_longitude_pg_1e9(2, minute_pg);
        assert(lon >= 0, 'mer1900 lo');
        assert(lon < 360 * SCALE_1E9, 'mer1900 hi');
    }

    #[test]
    fn regression_venus_pg_1900_smoke() {
        let minute_pg: i64 = 998_776_800;
        let lon = approximate_planet_longitude_pg_1e9(3, minute_pg);
        assert(lon >= 0, 'ven1900 lo');
        assert(lon < 360 * SCALE_1E9, 'ven1900 hi');
    }

    #[test]
    fn regression_mars_pg_1900_smoke() {
        let minute_pg: i64 = 998_776_800;
        let lon = approximate_planet_longitude_pg_1e9(4, minute_pg);
        assert(lon >= 0, 'mar1900 lo');
        assert(lon < 360 * SCALE_1E9, 'mar1900 hi');
    }

    #[test]
    fn regression_jupiter_pg_1900_smoke() {
        let minute_pg: i64 = 998_776_800;
        let lon = approximate_planet_longitude_pg_1e9(5, minute_pg);
        assert(lon >= 0, 'jup1900 lo');
        assert(lon < 360 * SCALE_1E9, 'jup1900 hi');
    }

    #[test]
    fn regression_saturn_pg_1900_smoke() {
        let minute_pg: i64 = 998_776_800;
        let lon = approximate_planet_longitude_pg_1e9(6, minute_pg);
        assert(lon >= 0, 'sat1900 lo');
        assert(lon < 360 * SCALE_1E9, 'sat1900 hi');
    }

}
