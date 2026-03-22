use crate::cheby_data::{
    jupiter_coeff_at, mars_coeff_at, mercury_coeff_at, moon_coeff_at, saturn_coeff_at, sun_coeff_at,
    venus_coeff_at, CHEBY_DEG_SCALE, JUPITER_BLOCK_COUNT, JUPITER_BLOCK_MINUTES, JUPITER_COEFF_TOTAL,
    JUPITER_ORDER, MARS_BLOCK_COUNT, MARS_BLOCK_MINUTES, MARS_COEFF_TOTAL, MARS_ORDER,
    MERCURY_BLOCK_COUNT, MERCURY_BLOCK_MINUTES, MERCURY_COEFF_TOTAL, MERCURY_ORDER, MOON_BLOCK_COUNT,
    MOON_BLOCK_MINUTES, MOON_COEFF_TOTAL, MOON_ORDER, SATURN_BLOCK_COUNT, SATURN_BLOCK_MINUTES,
    SATURN_COEFF_TOTAL, SATURN_ORDER, SUN_BLOCK_COUNT, SUN_BLOCK_MINUTES, SUN_COEFF_TOTAL, SUN_ORDER,
    VENUS_BLOCK_COUNT, VENUS_BLOCK_MINUTES, VENUS_COEFF_TOTAL, VENUS_ORDER,
};
use crate::fixed::norm360_i64_1e9;
use crate::types::{JUPITER, MARS, MERCURY, MOON, PLANET_COUNT, SATURN, SUN, VENUS};

const U_SCALE: i64 = 1_000_000;
const DEG_SCALE_TO_DEG1E9: i64 = 1_000_000_000;
const MOON_LONGITUDE_BIAS_1E9: i64 = 3_000;

const SERIES_SUN: u8 = 0;
const SERIES_MOON: u8 = 1;
const SERIES_MERCURY: u8 = 2;
const SERIES_VENUS: u8 = 3;
const SERIES_MARS: u8 = 4;
const SERIES_JUPITER: u8 = 5;
const SERIES_SATURN: u8 = 6;

#[inline(never)]
fn coeff_at(series: u8, idx: usize) -> i64 {
    if series == SERIES_SUN {
        return sun_coeff_at(idx);
    }
    if series == SERIES_MOON {
        return moon_coeff_at(idx);
    }
    if series == SERIES_MERCURY {
        return mercury_coeff_at(idx);
    }
    if series == SERIES_VENUS {
        return venus_coeff_at(idx);
    }
    if series == SERIES_MARS {
        return mars_coeff_at(idx);
    }
    if series == SERIES_JUPITER {
        return jupiter_coeff_at(idx);
    }
    saturn_coeff_at(idx)
}

#[inline(never)]
fn clenshaw_cheby_deg_scaled(series: u8, start: usize, order: usize, u_scaled: i64) -> i64 {
    if order == 0 {
        return coeff_at(series, start);
    }

    let mut b1: i128 = 0;
    let mut b2: i128 = 0;
    let mut j = order;
    loop {
        if j == 0 {
            break;
        }
        let a_j = coeff_at(series, start + j);
        let b0: i128 = a_j.into() + (2_i64.into() * u_scaled.into() * b1) / U_SCALE.into() - b2;
        b2 = b1;
        b1 = b0;
        j -= 1;
    };

    let a0 = coeff_at(series, start);
    let y: i128 = a0.into() + (u_scaled.into() * b1) / U_SCALE.into() - b2;

    let period: i128 = 360_i64.into() * CHEBY_DEG_SCALE.into();
    let mut w = y % period;
    if w < 0 {
        w += period;
    }
    w.try_into().unwrap()
}

#[inline(never)]
fn eval_series_deg_scaled(
    series: u8,
    minute_since_1900: u32,
    block_minutes: u32,
    block_count: usize,
    order: usize,
    coeff_total: usize,
) -> i64 {
    assert(block_minutes > 0, 'block minutes');

    let mut idx_u32: u32 = minute_since_1900 / block_minutes;
    let max_idx_u32: u32 = (block_count - 1).try_into().unwrap();
    if idx_u32 > max_idx_u32 {
        idx_u32 = max_idx_u32;
    }

    let block_start_minute: u32 = idx_u32 * block_minutes;
    let minute_i64: i64 = minute_since_1900.into();
    let block_start_i64: i64 = block_start_minute.into();
    let mut local_minute_i64: i64 = minute_i64 - block_start_i64;
    if local_minute_i64 < 0 {
        local_minute_i64 = 0;
    }

    let u_num: i128 = 2_i64.into() * local_minute_i64.into() * U_SCALE.into();
    let u_scaled: i64 = ((u_num / block_minutes.into()) - U_SCALE.into()).try_into().unwrap();

    let stride_u32: u32 = (order + 1).try_into().unwrap();
    let start_u32: u32 = idx_u32 * stride_u32;
    let flat_len_u32: u32 = coeff_total.try_into().unwrap();
    assert(start_u32 + stride_u32 <= flat_len_u32, 'coeff bounds');

    let start: usize = start_u32.into();
    clenshaw_cheby_deg_scaled(series, start, order, u_scaled)
}

#[inline(never)]
fn cheby_longitude_deg1e9(planet: u8, minute_since_1900: u32) -> i64 {
    let deg_scaled = if planet == SUN {
        eval_series_deg_scaled(
            SERIES_SUN,
            minute_since_1900,
            SUN_BLOCK_MINUTES,
            SUN_BLOCK_COUNT,
            SUN_ORDER,
            SUN_COEFF_TOTAL,
        )
    } else if planet == MOON {
        eval_series_deg_scaled(
            SERIES_MOON,
            minute_since_1900,
            MOON_BLOCK_MINUTES,
            MOON_BLOCK_COUNT,
            MOON_ORDER,
            MOON_COEFF_TOTAL,
        )
    } else if planet == MERCURY {
        eval_series_deg_scaled(
            SERIES_MERCURY,
            minute_since_1900,
            MERCURY_BLOCK_MINUTES,
            MERCURY_BLOCK_COUNT,
            MERCURY_ORDER,
            MERCURY_COEFF_TOTAL,
        )
    } else if planet == VENUS {
        eval_series_deg_scaled(
            SERIES_VENUS,
            minute_since_1900,
            VENUS_BLOCK_MINUTES,
            VENUS_BLOCK_COUNT,
            VENUS_ORDER,
            VENUS_COEFF_TOTAL,
        )
    } else if planet == MARS {
        eval_series_deg_scaled(
            SERIES_MARS,
            minute_since_1900,
            MARS_BLOCK_MINUTES,
            MARS_BLOCK_COUNT,
            MARS_ORDER,
            MARS_COEFF_TOTAL,
        )
    } else if planet == JUPITER {
        eval_series_deg_scaled(
            SERIES_JUPITER,
            minute_since_1900,
            JUPITER_BLOCK_MINUTES,
            JUPITER_BLOCK_COUNT,
            JUPITER_ORDER,
            JUPITER_COEFF_TOTAL,
        )
    } else {
        eval_series_deg_scaled(
            SERIES_SATURN,
            minute_since_1900,
            SATURN_BLOCK_MINUTES,
            SATURN_BLOCK_COUNT,
            SATURN_ORDER,
            SATURN_COEFF_TOTAL,
        )
    };

    let lon_1e9: i128 = deg_scaled.into() * DEG_SCALE_TO_DEG1E9.into() / CHEBY_DEG_SCALE.into();
    let mut lon_norm = norm360_i64_1e9(lon_1e9.try_into().unwrap());
    if planet == MOON {
        lon_norm = norm360_i64_1e9(lon_norm + MOON_LONGITUDE_BIAS_1E9);
    }
    lon_norm
}

pub fn approximate_planet_longitude_1e9(planet: u8, minute_since_1900: u32) -> i64 {
    assert(planet < PLANET_COUNT.try_into().unwrap(), 'planet index out of range');
    cheby_longitude_deg1e9(planet, minute_since_1900)
}

#[inline(never)]
pub fn all_planet_longitudes_1e9(minute_since_1900: u32) -> [i64; PLANET_COUNT] {
    [
        approximate_planet_longitude_1e9(SUN, minute_since_1900),
        approximate_planet_longitude_1e9(MOON, minute_since_1900),
        approximate_planet_longitude_1e9(MERCURY, minute_since_1900),
        approximate_planet_longitude_1e9(VENUS, minute_since_1900),
        approximate_planet_longitude_1e9(MARS, minute_since_1900),
        approximate_planet_longitude_1e9(JUPITER, minute_since_1900),
        approximate_planet_longitude_1e9(SATURN, minute_since_1900),
    ]
}

pub fn cheby_planet_sign_from_minute(planet: u8, minute_since_1900: u32) -> u8 {
    (approximate_planet_longitude_1e9(planet, minute_since_1900) / 30_000_000_000).try_into().unwrap()
}

#[cfg(test)]
mod tests {
    use crate::planets::{approximate_planet_longitude_1e9, all_planet_longitudes_1e9};

    #[test]
    fn smoke_cheby_all_planets() {
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
