use crate::fixed::{div_round_half_away_from_zero, norm360_i64_1e9, SCALE_1E9};
use crate::frames::{
    eqj_to_ecliptic_of_date_lon_lat_1e9, eqj_to_ecliptic_of_date_longitude_1e9,
    nutation_longitude_deg_1e9, vsop_ecliptic_to_eqj_1e9,
};
use crate::moon_terms::MOON_SOLAR_TERMS;
use crate::time::{days_since_j2000_1e9_from_pg, minute_since_1900_to_pg, J2000_MINUTE_SINCE_PG};
use crate::trig::{cos_deg_1e9, sin_deg_1e9};
use crate::types::PLANET_COUNT;
use crate::vsop_gen::{
    earth_helio, jupiter_helio, mars_helio, mercury_helio, saturn_helio, venus_helio, HelioState,
};

// Global Moon longitude bias model (non-pointwise).
// Unit: degrees scaled by 1e9. offset = A + B * t_centuries + C * t_centuries^2.
const MOON_LON_PARITY_OFFSET_A_DEG_1E9: i64 = 0;
const MOON_LON_PARITY_OFFSET_B_DEG_1E9_PER_CENTURY: i64 = 0;
const MOON_LON_PARITY_OFFSET_C_DEG_1E9_PER_CENTURY2: i64 = 0;
const ABERRATION_KAPPA_DEG_1E9: i64 = 5_693_200; // 20.49552 arcsec
const ENABLE_EXPLICIT_ECLIPTIC_ABERRATION_TERM: bool = false;
const ECLIPTIC_FRAME_TIME_SIGN: i64 = 1;

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
    loop {
        if i >= exp_abs {
            break;
        }
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
    loop {
        if i >= 104 {
            break;
        }
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
    let t2_1e12_parity: i128 = div_round_half_away_from_zero(
        t_1e12.into() * t_1e12.into(), t_scale.into(),
    );
    let moon_parity_linear: i128 =
        div_round_half_away_from_zero(
            MOON_LON_PARITY_OFFSET_B_DEG_1E9_PER_CENTURY.into() * t_1e12.into(),
            t_scale.into(),
        );
    let moon_parity_quadratic: i128 =
        div_round_half_away_from_zero(
            MOON_LON_PARITY_OFFSET_C_DEG_1E9_PER_CENTURY2.into() * t2_1e12_parity,
            t_scale.into(),
        );
    let moon_parity_offset: i64 = MOON_LON_PARITY_OFFSET_A_DEG_1E9
        + moon_parity_linear.try_into().unwrap()
        + moon_parity_quadratic.try_into().unwrap();
    norm360_i64_1e9(l0_deg_1e9 + div_round_i64(dlam_arcsec_1e9.into(), 3600) + dpsi + moon_parity_offset)
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
    let frame_days_1e9 = ECLIPTIC_FRAME_TIME_SIGN * obs_tt_1e9;
    let (lon, lat) = eqj_to_ecliptic_of_date_lon_lat_1e9(dx_eqj, dy_eqj, dz_eqj, frame_days_1e9);
    if !ENABLE_EXPLICIT_ECLIPTIC_ABERRATION_TERM {
        return lon;
    }
    let sun_lon = geocentric_sun_longitude_vsop_pg_1e9(minute_since_pg);
    // Optional ecliptic-space apparent correction (kept as an A/B parity toggle).
    let cos_beta = cos_deg_1e9(lat);
    if cos_beta == 0 {
        return lon;
    }
    let dlam_num: i128 = -ABERRATION_KAPPA_DEG_1E9.into() * cos_deg_1e9(lon - sun_lon).into();
    let dlam: i64 = div_round_i64(dlam_num, cos_beta);
    norm360_i64_1e9(lon + dlam)
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

/// Debug probe for ecliptic frame projection before optional explicit aberration term.
/// Supported planets: Mercury..Saturn (2..6).
#[inline(never)]
pub fn debug_planet_frame_lon_lat_pg_1e9(planet: u8, minute_since_pg: i64) -> (i64, i64) {
    assert(planet >= 2 && planet <= 6, 'debug planet must be 2..6');
    let (dx_eqj, dy_eqj, dz_eqj, obs_tt_1e9) = debug_planet_geocentric_eqj_pg_1e9(
        planet, minute_since_pg,
    );
    eqj_to_ecliptic_of_date_lon_lat_1e9(dx_eqj, dy_eqj, dz_eqj, ECLIPTIC_FRAME_TIME_SIGN * obs_tt_1e9)
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
    // Keep frame-time sign configurable for parity A/B checks.
    eqj_to_ecliptic_of_date_longitude_1e9(-xe, -ye, -ze, ECLIPTIC_FRAME_TIME_SIGN * obs_tt_1e9)
}

#[inline(never)]
fn geocentric_sun_longitude_loworder_pg_1e9(minute_since_pg: i64) -> i64 {
    let d_1e9 = days_since_j2000_1e9_from_pg(minute_since_pg);
    // Higher-order analytic solar longitude model (Meeus-style terms).
    // T is Julian centuries from J2000 in 1e9 fixed-point.
    let t_1e9 = div_round_i64(d_1e9.into(), 36_525);
    let t2_1e9 = div_round_i64(t_1e9.into() * t_1e9.into(), SCALE_1E9);
    let t3_1e9 = div_round_i64(t2_1e9.into() * t_1e9.into(), SCALE_1E9);

    // Mean geometric longitude of the Sun (deg):
    // L0 = 280.46646 + 36000.76983*T + 0.0003032*T^2
    let l0 = norm360_i64_1e9(
        280_466_460_000
            + div_round_i64(36_000_769_830_000_i64.into() * t_1e9.into(), SCALE_1E9)
            + div_round_i64(303_200_i64.into() * t2_1e9.into(), SCALE_1E9),
    );

    // Mean anomaly (deg):
    // M = 357.52911 + 35999.05029*T - 0.0001537*T^2 + T^3/24490000
    let m = norm360_i64_1e9(
        357_529_110_000
            + div_round_i64(35_999_050_290_000_i64.into() * t_1e9.into(), SCALE_1E9)
            - div_round_i64(153_700_i64.into() * t2_1e9.into(), SCALE_1E9)
            + div_round_i64(t3_1e9.into(), 24_490_000),
    );

    // Equation of center coefficients (deg), varying with T.
    // C = (1.914602 - 0.004817*T - 0.000014*T^2) sin(M)
    //   + (0.019993 - 0.000101*T) sin(2M)
    //   + 0.000289 sin(3M)
    let c1_amp = 1_914_602_000
        - div_round_i64(4_817_000_i64.into() * t_1e9.into(), SCALE_1E9)
        - div_round_i64(14_000_i64.into() * t2_1e9.into(), SCALE_1E9);
    let c2_amp = 19_993_000 - div_round_i64(101_000_i64.into() * t_1e9.into(), SCALE_1E9);
    let c3_amp = 289_000_i64;

    let c1 = div_round_i64(c1_amp.into() * sin_deg_1e9(m).into(), SCALE_1E9);
    let c2 = div_round_i64(c2_amp.into() * sin_deg_1e9(2 * m).into(), SCALE_1E9);
    let c3 = div_round_i64(c3_amp.into() * sin_deg_1e9(3 * m).into(), SCALE_1E9);

    norm360_i64_1e9(l0 + c1 + c2 + c3)
}

pub fn approximate_planet_longitude_1e9(planet: u8, minute_since_1900: u32) -> i64 {
    approximate_planet_longitude_pg_1e9(planet, minute_since_1900_to_pg(minute_since_1900))
}

pub fn approximate_planet_longitude_pg_1e9(planet: u8, minute_since_pg: i64) -> i64 {
    let idx: usize = planet.into();
    assert(idx < PLANET_COUNT, 'planet index out of range');

    let d = days_since_j2000_1e9_from_pg(minute_since_pg);
    if planet == 0 {
        return geocentric_sun_longitude_vsop_pg_1e9(minute_since_pg);
    }
    if planet == 1 {
        return moon_longitude_1e9(d);
    }
    if planet == 2 {
        return geocentric_longitude_vsop_pg_1e9(2, minute_since_pg);
    }
    if planet == 3 {
        return geocentric_longitude_vsop_pg_1e9(3, minute_since_pg);
    }
    if planet == 4 {
        return geocentric_longitude_vsop_pg_1e9(4, minute_since_pg);
    }
    if planet == 5 {
        return geocentric_longitude_vsop_pg_1e9(5, minute_since_pg);
    }
    if planet == 6 {
        return geocentric_longitude_vsop_pg_1e9(6, minute_since_pg);
    }
    0
}

#[inline(never)]
pub fn all_planet_longitudes_1e9(minute_since_1900: u32) -> [i64; PLANET_COUNT] {
    all_planet_longitudes_pg_1e9(minute_since_1900_to_pg(minute_since_1900))
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
    use crate::planets::{approximate_planet_longitude_1e9, all_planet_longitudes_1e9};
    use crate::planets::approximate_planet_longitude_pg_1e9;

    fn sign_from_lon_1e9(lon_1e9: i64) -> u8 {
        (norm360_i64_1e9(lon_1e9) / (30 * SCALE_1E9)).try_into().unwrap()
    }

    #[test]
    fn smoke_parametric_all_planets() {
        let minute: u32 = 66_348_000;
        assert(approximate_planet_longitude_1e9(0, minute) >= 0, 'p0');
        assert(approximate_planet_longitude_1e9(1, minute) >= 0, 'p1');
        assert(approximate_planet_longitude_1e9(2, minute) >= 0, 'p2');
        assert(approximate_planet_longitude_1e9(3, minute) >= 0, 'p3');
        assert(approximate_planet_longitude_1e9(4, minute) >= 0, 'p4');
        assert(approximate_planet_longitude_1e9(5, minute) >= 0, 'p5');
        assert(approximate_planet_longitude_1e9(6, minute) >= 0, 'p6');
    }

    #[test]
    fn benchmark_parametric_all_planets_cheby() {
        let minute: u32 = 66_348_000;
        let vals = all_planet_longitudes_1e9(minute);
        assert(*vals.span().at(0) >= 0, 'v0');
        assert(*vals.span().at(1) >= 0, 'v1');
        assert(*vals.span().at(2) >= 0, 'v2');
        assert(*vals.span().at(3) >= 0, 'v3');
        assert(*vals.span().at(4) >= 0, 'v5');
        assert(*vals.span().at(5) >= 0, 'v5');
        assert(*vals.span().at(6) >= 0, 'v6');
    }

    #[test]
    fn chart_snapshot_2000_sf() {
        // 2000-01-01T12:00:00Z, lat/lon = 37.7/-122.4
        let minute_pg: i64 = 1_051_372_080;
        let lat_bin: i16 = 377;
        let lon_bin: i16 = -1224;
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
        let lat_bin: i16 = 407;
        let lon_bin: i16 = -740;
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
        let lat_bin: i16 = -338;
        let lon_bin: i16 = 1512;
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
