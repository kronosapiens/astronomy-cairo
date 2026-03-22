use crate::fixed::{norm360_i64_1e9, SCALE_1E9};
use crate::frames::{eqj_to_ecliptic_of_date_longitude_1e9, vsop_ecliptic_to_eqj_1e9};
use crate::time::days_since_j2000_1e9;
use crate::trig::{cos_deg_1e9, sin_deg_1e9};
use crate::types::PLANET_COUNT;
use crate::vsop_gen::{
    earth_helio, jupiter_helio, mars_helio, mercury_helio, saturn_helio, venus_helio, HelioState,
};

const SUN_L0_DEG_1E9: i64 = 280_459_000_000;
const SUN_RATE_DEG_PER_DAY_1E9: i64 = 985_647_360;
const MOON_L0_DEG_1E9: i64 = 218_316_000_000;
const MOON_RATE_DEG_PER_DAY_1E9: i64 = 13_176_396_000;
const EARTH_L0_DEG_1E9: i64 = 100_374_527_911;
const EARTH_RATE_DEG_PER_DAY_1E9: i64 = 985_647_360;
#[inline(never)]
fn linear_longitude_1e9(l0: i64, rate_deg_per_day_1e9: i64, d_days_1e9: i64) -> i64 {
    let delta: i128 = (rate_deg_per_day_1e9.into() * d_days_1e9.into()) / SCALE_1E9.into();
    norm360_i64_1e9(l0 + delta.try_into().unwrap())
}

#[inline(never)]
fn sun_longitude_1e9(d_days_1e9: i64) -> i64 {
    let q = linear_longitude_1e9(SUN_L0_DEG_1E9, SUN_RATE_DEG_PER_DAY_1E9, d_days_1e9);
    let g = linear_longitude_1e9(357_529_000_000, 985_600_280, d_days_1e9);
    let c1: i128 = (1_915_000_000_i64.into() * sin_deg_1e9(g).into()) / SCALE_1E9.into();
    let c2: i128 = (20_000_000_i64.into() * sin_deg_1e9(2 * g).into()) / SCALE_1E9.into();
    norm360_i64_1e9(q + c1.try_into().unwrap() + c2.try_into().unwrap())
}

#[inline(never)]
fn moon_longitude_1e9(d_days_1e9: i64) -> i64 {
    let l0 = linear_longitude_1e9(MOON_L0_DEG_1E9, MOON_RATE_DEG_PER_DAY_1E9, d_days_1e9);
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
fn t_millennia_1e9_from_minute(minute_since_1900: u32) -> i64 {
    let d = days_since_j2000_1e9(minute_since_1900);
    let t: i128 = d.into() / 365250_i64.into();
    t.try_into().unwrap()
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
fn geocentric_longitude_vsop_1e9(planet_idx: usize, minute_since_1900: u32) -> i64 {
    let t0 = t_millennia_1e9_from_minute(minute_since_1900);
    let earth = earth_helio(t0);
    let (xe_raw, ye_raw, ze_raw) = helio_xyz_1e9(earth);
    let (xe0, ye0, ze0) = vsop_ecliptic_to_eqj_1e9(xe_raw, ye_raw, ze_raw);

    let c_au_per_day_1e9: i64 = 173_144_632_685;
    let mut dt_minute_1e9: i64 = 0;
    let mut xe = xe0;
    let mut ye = ye0;
    let mut ze = ze0;
    let mut p = helio_state_for_planet(planet_idx, t0);
    let mut iter: u8 = 0;
    loop {
        if iter >= 2 {
            break;
        }
        let (xp_raw, yp_raw, zp_raw) = helio_xyz_1e9(p);
        let (xp, yp, zp) = vsop_ecliptic_to_eqj_1e9(xp_raw, yp_raw, zp_raw);
        let dx: i128 = (xp - xe).into();
        let dy: i128 = (yp - ye).into();
        let dz: i128 = (zp - ze).into();
        let dist2: i128 = dx * dx + dy * dy + dz * dz;
        let dist_au_1e9: i128 = isqrt_i128(dist2);
        let dt_days_1e9: i128 = (dist_au_1e9 * SCALE_1E9.into()) / c_au_per_day_1e9.into();
        dt_minute_1e9 = ((dt_days_1e9 * 1440_i64.into()) / SCALE_1E9.into()).try_into().unwrap();

        let m_shift: i128 = minute_since_1900.into() * SCALE_1E9.into() - dt_minute_1e9.into();
        let m_shift_u32: u32 = if m_shift <= 0 {
            0
        } else {
            (m_shift / SCALE_1E9.into()).try_into().unwrap()
        };
        let tshift = t_millennia_1e9_from_minute(m_shift_u32);
        p = helio_state_for_planet(planet_idx, tshift);
        let e_shift = earth_helio(tshift);
        let (xe_s_raw, ye_s_raw, ze_s_raw) = helio_xyz_1e9(e_shift);
        let (xe_s, ye_s, ze_s) = vsop_ecliptic_to_eqj_1e9(xe_s_raw, ye_s_raw, ze_s_raw);
        xe = xe_s;
        ye = ye_s;
        ze = ze_s;
        iter += 1;
    };

    let (xp_raw, yp_raw, zp_raw) = helio_xyz_1e9(p);
    let (xp, yp, zp) = vsop_ecliptic_to_eqj_1e9(xp_raw, yp_raw, zp_raw);
    let d = days_since_j2000_1e9(minute_since_1900);
    eqj_to_ecliptic_of_date_longitude_1e9(xp - xe, yp - ye, zp - ze, d)
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
        return geocentric_longitude_vsop_1e9(2, minute_since_1900);
    }
    if planet == 3 {
        return geocentric_longitude_vsop_1e9(3, minute_since_1900);
    }
    if planet == 4 {
        return geocentric_longitude_vsop_1e9(4, minute_since_1900);
    }
    if planet == 5 {
        return geocentric_longitude_vsop_1e9(5, minute_since_1900);
    }
    if planet == 6 {
        return geocentric_longitude_vsop_1e9(6, minute_since_1900);
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

#[cfg(test)]
mod tests {
    use crate::planets::{approximate_planet_longitude_1e9, all_planet_longitudes_1e9};

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
        assert(*vals.span().at(4) >= 0, 'v4');
        assert(*vals.span().at(5) >= 0, 'v5');
        assert(*vals.span().at(6) >= 0, 'v6');
    }
}
