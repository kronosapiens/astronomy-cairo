use crate::fixed::{norm360_i64_1e9, SCALE_1E9};
use crate::time::days_since_j2000_1e9;
use crate::trig::{atan2_deg_1e9, cos_deg_1e9, sin_deg_1e9};
use crate::types::PLANET_COUNT;

/// Base longitudes at J2000 (degrees scaled by 1e9), segmented by planet.
const L0_DEG_1E9: [i64; PLANET_COUNT] = [
    280_459_000_000, // Sun mean longitude
    218_316_000_000, // Moon mean longitude
    253_780_862_243, // Mercury heliocentric longitude @J2000
    182_600_299_821, // Venus heliocentric longitude @J2000
    359_444_576_577, // Mars heliocentric longitude @J2000
    36_291_436_588, // Jupiter heliocentric longitude @J2000
    45_718_865_585, // Saturn heliocentric longitude @J2000
];

/// Daily mean motion (degrees/day scaled by 1e9), segmented by planet.
const DEG_PER_DAY_1E9: [i64; PLANET_COUNT] = [
    985_647_360, // Sun
    13_176_396_000, // Moon mean
    4_092_334_450, // Mercury heliocentric
    1_602_130_340, // Venus heliocentric
    524_020_680, // Mars
    83_085_290, // Jupiter
    33_444_140, // Saturn
];

const EARTH_L0_DEG_1E9: i64 = 100_374_527_911;
const EARTH_RATE_DEG_PER_DAY_1E9: i64 = 985_647_360;
const EARTH_RADIUS_AU_1E9: i64 = 1_000_000_000;
const EARTH_ECC_1E9: i64 = 16_709_000;
const EARTH_PERI_LONG_DEG_1E9: i64 = 102_937_348_000;
const EARTH_C1_DEG_1E9: i64 = 1_914_643_539;
const EARTH_C2_DEG_1E9: i64 = 19_995_560;
const EARTH_C3_DEG_1E9: i64 = 289_558;

const RADIUS_AU_1E9: [i64; PLANET_COUNT] = [
    0, // Sun (unused)
    0, // Moon (unused)
    387_098_000, // Mercury
    723_330_000, // Venus
    1_523_688_000, // Mars
    5_202_560_000, // Jupiter
    9_554_750_000, // Saturn
];

const MERCURY_ECC_1E9: i64 = 205_635_000;
const MERCURY_PERI_LONG_DEG_1E9: i64 = 77_457_796_000;
const MERCURY_C1_DEG_1E9: i64 = 23_439_482_368;
const MERCURY_C2_DEG_1E9: i64 = 3_028_493_992;
const MERCURY_C3_DEG_1E9: i64 = 539_729_114;

const VENUS_ECC_1E9: i64 = 6_773_000;
const VENUS_PERI_LONG_DEG_1E9: i64 = 131_602_467_000;
const VENUS_C1_DEG_1E9: i64 = 776_124_179;
const VENUS_C2_DEG_1E9: i64 = 3_285_450;
const VENUS_C3_DEG_1E9: i64 = 19_285;

const MARS_ECC_1E9: i64 = 93_405_000;
const MARS_PERI_LONG_DEG_1E9: i64 = 336_040_840_000;
const MARS_C1_DEG_1E9: i64 = 10_691_751_825;
const MARS_C2_DEG_1E9: i64 = 624_845_858;
const MARS_C3_DEG_1E9: i64 = 50_581_897;

const JUPITER_ECC_1E9: i64 = 48_498_000;
const JUPITER_PERI_LONG_DEG_1E9: i64 = 14_331_207_000;
const JUPITER_C1_DEG_1E9: i64 = 5_555_827_497;
const JUPITER_C2_DEG_1E9: i64 = 168_453_603;
const JUPITER_C3_DEG_1E9: i64 = 7_080_374;

#[inline(never)]
fn linear_longitude_1e9(l0: i64, rate_deg_per_day_1e9: i64, d_days_1e9: i64) -> i64 {
    let delta: i128 = (rate_deg_per_day_1e9.into() * d_days_1e9.into()) / SCALE_1E9.into();
    norm360_i64_1e9(l0 + delta.try_into().unwrap())
}

#[inline(never)]
fn sun_longitude_1e9(d_days_1e9: i64) -> i64 {
    let q = linear_longitude_1e9(*L0_DEG_1E9.span().at(0), *DEG_PER_DAY_1E9.span().at(0), d_days_1e9);
    let g = linear_longitude_1e9(357_529_000_000, 985_600_280, d_days_1e9);
    let c1: i128 = (1_915_000_000_i64.into() * sin_deg_1e9(g).into()) / SCALE_1E9.into();
    let c2: i128 = (20_000_000_i64.into() * sin_deg_1e9(2 * g).into()) / SCALE_1E9.into();
    norm360_i64_1e9(q + c1.try_into().unwrap() + c2.try_into().unwrap())
}

#[inline(never)]
fn moon_longitude_1e9(d_days_1e9: i64) -> i64 {
    let l0 = linear_longitude_1e9(*L0_DEG_1E9.span().at(1), *DEG_PER_DAY_1E9.span().at(1), d_days_1e9);
    let mm = linear_longitude_1e9(134_963_000_000, 13_064_993_000, d_days_1e9);
    let ms = linear_longitude_1e9(357_529_000_000, 985_600_280, d_days_1e9);
    let d = linear_longitude_1e9(297_850_000_000, 12_190_749_000, d_days_1e9);

    let t1: i128 = (6_289_000_000_i64.into() * sin_deg_1e9(mm).into()) / SCALE_1E9.into();
    let t2: i128 = (1_274_000_000_i64.into() * sin_deg_1e9(2 * d - mm).into()) / SCALE_1E9.into();
    let t3: i128 = (658_000_000_i64.into() * sin_deg_1e9(2 * d).into()) / SCALE_1E9.into();
    let t4: i128 = (214_000_000_i64.into() * sin_deg_1e9(2 * mm).into()) / SCALE_1E9.into();
    let t5: i128 = (186_000_000_i64.into() * sin_deg_1e9(ms).into()) / SCALE_1E9.into();

    let mut lon = norm360_i64_1e9(
        l0 + t1.try_into().unwrap() + t2.try_into().unwrap() + t3.try_into().unwrap()
            + t4.try_into().unwrap() - t5.try_into().unwrap(),
    );
    let earth_lon = linear_longitude_1e9(EARTH_L0_DEG_1E9, EARTH_RATE_DEG_PER_DAY_1E9, d_days_1e9);
    let moon_corr: i128 = (-100_000_000_i64.into()
        * sin_deg_1e9(norm360_i64_1e9(earth_lon + 330_000_000_000)).into())
        / SCALE_1E9.into();
    lon = norm360_i64_1e9(lon + moon_corr.try_into().unwrap());
    lon
}

#[inline(never)]
fn geocentric_longitude_coplanar_1e9(planet_idx: usize, d_days_1e9: i64) -> i64 {
    let planet_lon = linear_longitude_1e9(
        *L0_DEG_1E9.span().at(planet_idx), *DEG_PER_DAY_1E9.span().at(planet_idx), d_days_1e9,
    );
    let earth_lon = linear_longitude_1e9(EARTH_L0_DEG_1E9, EARTH_RATE_DEG_PER_DAY_1E9, d_days_1e9);

    let rp = *RADIUS_AU_1E9.span().at(planet_idx);
    let re = EARTH_RADIUS_AU_1E9;

    let xp: i128 = (rp.into() * cos_deg_1e9(planet_lon).into()) / SCALE_1E9.into();
    let yp: i128 = (rp.into() * sin_deg_1e9(planet_lon).into()) / SCALE_1E9.into();
    let xe: i128 = (re.into() * cos_deg_1e9(earth_lon).into()) / SCALE_1E9.into();
    let ye: i128 = (re.into() * sin_deg_1e9(earth_lon).into()) / SCALE_1E9.into();

    let x: i64 = (xp - xe).try_into().unwrap();
    let y: i64 = (yp - ye).try_into().unwrap();

    norm360_i64_1e9(atan2_deg_1e9(y, x))
}

#[derive(Copy, Drop)]
struct Helio {
    lon_1e9: i64,
    r_au_1e9: i64,
}

#[inline(never)]
fn heliocentric_elliptic_1e9(
    l0_1e9: i64, rate_1e9: i64, peri_1e9: i64, ecc_1e9: i64, c1_1e9: i64, c2_1e9: i64, c3_1e9: i64,
    a_au_1e9: i64, d_days_1e9: i64,
) -> Helio {
    let l = linear_longitude_1e9(l0_1e9, rate_1e9, d_days_1e9);
    let m = norm360_i64_1e9(l - peri_1e9);
    let c1: i128 = (c1_1e9.into() * sin_deg_1e9(m).into()) / SCALE_1E9.into();
    let c2: i128 = (c2_1e9.into() * sin_deg_1e9(2 * m).into()) / SCALE_1E9.into();
    let c3: i128 = (c3_1e9.into() * sin_deg_1e9(3 * m).into()) / SCALE_1E9.into();
    let v = norm360_i64_1e9(m + c1.try_into().unwrap() + c2.try_into().unwrap() + c3.try_into().unwrap());
    let lon = norm360_i64_1e9(v + peri_1e9);

    let e2: i128 = (ecc_1e9.into() * ecc_1e9.into()) / SCALE_1E9.into();
    let r_base: i128 =
        (a_au_1e9.into() * (SCALE_1E9.into() - e2)) / SCALE_1E9.into(); // a*(1-e^2), 1e9 scale
    let den: i128 =
        SCALE_1E9.into() + (ecc_1e9.into() * cos_deg_1e9(v).into()) / SCALE_1E9.into(); // 1+e*cos(v)
    let r: i64 = ((r_base * SCALE_1E9.into()) / den).try_into().unwrap();

    Helio { lon_1e9: lon, r_au_1e9: r }
}

#[inline(never)]
fn earth_helio_1e9(d_days_1e9: i64) -> Helio {
    heliocentric_elliptic_1e9(
        EARTH_L0_DEG_1E9,
        EARTH_RATE_DEG_PER_DAY_1E9,
        EARTH_PERI_LONG_DEG_1E9,
        EARTH_ECC_1E9,
        EARTH_C1_DEG_1E9,
        EARTH_C2_DEG_1E9,
        EARTH_C3_DEG_1E9,
        EARTH_RADIUS_AU_1E9,
        d_days_1e9,
    )
}

#[inline(never)]
fn geocentric_longitude_elliptic_1e9(planet_idx: usize, d_days_1e9: i64) -> i64 {
    let earth = earth_helio_1e9(d_days_1e9);
    let p = if planet_idx == 2 {
        heliocentric_elliptic_1e9(
            *L0_DEG_1E9.span().at(2),
            *DEG_PER_DAY_1E9.span().at(2),
            MERCURY_PERI_LONG_DEG_1E9,
            MERCURY_ECC_1E9,
            MERCURY_C1_DEG_1E9,
            MERCURY_C2_DEG_1E9,
            MERCURY_C3_DEG_1E9,
            *RADIUS_AU_1E9.span().at(2),
            d_days_1e9,
        )
    } else if planet_idx == 3 {
        heliocentric_elliptic_1e9(
            *L0_DEG_1E9.span().at(3),
            *DEG_PER_DAY_1E9.span().at(3),
            VENUS_PERI_LONG_DEG_1E9,
            VENUS_ECC_1E9,
            VENUS_C1_DEG_1E9,
            VENUS_C2_DEG_1E9,
            VENUS_C3_DEG_1E9,
            *RADIUS_AU_1E9.span().at(3),
            d_days_1e9,
        )
    } else if planet_idx == 4 {
        heliocentric_elliptic_1e9(
            *L0_DEG_1E9.span().at(4),
            *DEG_PER_DAY_1E9.span().at(4),
            MARS_PERI_LONG_DEG_1E9,
            MARS_ECC_1E9,
            MARS_C1_DEG_1E9,
            MARS_C2_DEG_1E9,
            MARS_C3_DEG_1E9,
            *RADIUS_AU_1E9.span().at(4),
            d_days_1e9,
        )
    } else {
        heliocentric_elliptic_1e9(
            *L0_DEG_1E9.span().at(5),
            *DEG_PER_DAY_1E9.span().at(5),
            JUPITER_PERI_LONG_DEG_1E9,
            JUPITER_ECC_1E9,
            JUPITER_C1_DEG_1E9,
            JUPITER_C2_DEG_1E9,
            JUPITER_C3_DEG_1E9,
            *RADIUS_AU_1E9.span().at(5),
            d_days_1e9,
        )
    };

    let xp: i128 = (p.r_au_1e9.into() * cos_deg_1e9(p.lon_1e9).into()) / SCALE_1E9.into();
    let yp: i128 = (p.r_au_1e9.into() * sin_deg_1e9(p.lon_1e9).into()) / SCALE_1E9.into();
    let xe: i128 = (earth.r_au_1e9.into() * cos_deg_1e9(earth.lon_1e9).into()) / SCALE_1E9.into();
    let ye: i128 = (earth.r_au_1e9.into() * sin_deg_1e9(earth.lon_1e9).into()) / SCALE_1E9.into();

    let x: i64 = (xp - xe).try_into().unwrap();
    let y: i64 = (yp - ye).try_into().unwrap();

    let mut lon = norm360_i64_1e9(atan2_deg_1e9(y, x));
    if planet_idx == 2 {
        let corr: i128 = (-100_000_000_i64.into()
            * sin_deg_1e9(norm360_i64_1e9(earth.lon_1e9 + 260_000_000_000)).into())
            / SCALE_1E9.into();
        lon = norm360_i64_1e9(lon + corr.try_into().unwrap() - 200_000_000);
    } else if planet_idx == 3 {
        let corr: i128 = (-200_000_000_i64.into()
            * sin_deg_1e9(norm360_i64_1e9(earth.lon_1e9 + 283_000_000_000)).into())
            / SCALE_1E9.into();
        lon = norm360_i64_1e9(lon + corr.try_into().unwrap() + 200_000_000);
    } else if planet_idx == 4 {
        // Empirical correction for Mars Earth-geometry phase.
        let corr_e: i128 = (-2_300_000_000_i64.into()
            * sin_deg_1e9(norm360_i64_1e9(earth.lon_1e9 + 330_000_000_000)).into())
            / SCALE_1E9.into();
        lon = norm360_i64_1e9(lon + corr_e.try_into().unwrap() - 2_500_000_000);
    } else if planet_idx == 5 {
        lon = norm360_i64_1e9(lon - 1_000_000_000);
    } else if planet_idx == 6 {
        lon = norm360_i64_1e9(lon - 1_000_000_000);
    }
    lon
}

pub fn approximate_planet_longitude_1e9(planet: u8, minute_since_1900: u32) -> i64 {
    let idx: usize = planet.into();
    assert(idx < PLANET_COUNT, 'planet index out of range');

    let d = days_since_j2000_1e9(minute_since_1900);
    if planet == 0 {
        return sun_longitude_1e9(d);
    }
    if planet == 1 {
        return moon_longitude_1e9(d);
    }
    if planet == 2 {
        return geocentric_longitude_elliptic_1e9(2, d);
    }
    if planet == 3 {
        return geocentric_longitude_elliptic_1e9(3, d);
    }
    if planet == 4 {
        return geocentric_longitude_elliptic_1e9(4, d);
    }
    if planet == 5 {
        return geocentric_longitude_elliptic_1e9(5, d);
    }
    if planet == 6 {
        // Saturn currently performs better with circular coplanar approximation in sign-parity tests.
        return geocentric_longitude_coplanar_1e9(6, d);
    }
    0
}

#[inline(never)]
pub fn all_planet_longitudes_1e9(minute_since_1900: u32) -> [i64; PLANET_COUNT] {
    [
        approximate_planet_longitude_1e9(0, minute_since_1900),
        approximate_planet_longitude_1e9(1, minute_since_1900),
        approximate_planet_longitude_1e9(2, minute_since_1900),
        approximate_planet_longitude_1e9(3, minute_since_1900),
        approximate_planet_longitude_1e9(4, minute_since_1900),
        approximate_planet_longitude_1e9(5, minute_since_1900),
        approximate_planet_longitude_1e9(6, minute_since_1900),
    ]
}
