// Core fixed-point arithmetic primitives and time conversion shared across the engine. All
// angular and positional values use i64 scaled by 1e9, with i128 intermediates to prevent
// overflow during multiplication. Provides the global rounding policy (half-away-from-zero,
// ensuring symmetric behavior for positive and negative values), angle normalization into
// the [0°, 360°) range, an integer square root via Newton's method (used for geocentric
// distance computation in the light-time iteration and for ecliptic latitude projection),
// and the proleptic Gregorian to J2000 day-count conversion that bridges the contract's
// time representation to the astronomical reference epoch. These primitives enforce
// deterministic arithmetic throughout the pipeline — no IEEE 754 rounding variability
// can occur.

pub const SCALE_1E9: i64 = 1_000_000_000;

/// Round signed integer division with a global half-away-from-zero policy.
pub fn div_round_half_away_from_zero(num: i128, den: i128) -> i128 {
    assert(den != 0, 'division by zero');

    let q = num / den;
    let r = num % den;
    if r == 0 {
        return q;
    }

    let abs_r = if r < 0 { -r } else { r };
    let abs_den = if den < 0 { -den } else { den };
    if abs_r * 2 < abs_den {
        return q;
    }

    if (num > 0 && den > 0) || (num < 0 && den < 0) {
        q + 1
    } else {
        q - 1
    }
}

/// Integer square root via Newton's method.
pub fn isqrt_i128(n: i128) -> i128 {
    if n <= 0 {
        return 0;
    }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    };
    x
}

// 2000-01-01T12:00:00Z in proleptic Gregorian minutes from 0001-01-01T00:00:00Z.
pub const J2000_MINUTE_SINCE_PG: i64 = 1_051_372_080;

/// Convert minutes since 0001-01-01T00:00:00Z (proleptic Gregorian) to
/// days since J2000 (scaled by 1e9).
pub fn days_since_j2000_1e9_from_pg(minute_since_pg: i64) -> i64 {
    let delta_min = minute_since_pg - J2000_MINUTE_SINCE_PG;
    let num: i128 = delta_min.into() * SCALE_1E9.into();
    div_round_half_away_from_zero(num, 1_440).try_into().unwrap()
}

/// Normalize a 1e9-scaled angle (degrees) into [0, 360e9).
pub fn norm360_i64_1e9(angle_scaled: i64) -> i64 {
    let turn = 360 * SCALE_1E9;
    let mut rem = angle_scaled % turn;
    if rem < 0 {
        rem += turn;
    }
    rem
}

#[cfg(test)]
mod tests {
    use super::{div_round_half_away_from_zero, norm360_i64_1e9};

    const SCALE_1E9_I64: i64 = 1_000_000_000;
    const DEG_360_SCALED: i64 = 360 * SCALE_1E9_I64;

    #[test]
    fn rounds_half_away_from_zero_positive() {
        assert(div_round_half_away_from_zero(5, 2) == 3, '5/2 should round to 3');
        assert(div_round_half_away_from_zero(3, 2) == 2, '3/2 should round to 2');
    }

    #[test]
    fn rounds_half_away_from_zero_negative() {
        assert(div_round_half_away_from_zero(-5, 2) == -3, '-5/2 should round to -3');
        assert(div_round_half_away_from_zero(-3, 2) == -2, '-3/2 should round to -2');
    }

    #[test]
    fn j2000_pg_is_zero_days() {
        assert(super::days_since_j2000_1e9_from_pg(super::J2000_MINUTE_SINCE_PG) == 0, 'J2000 pg = 0');
    }

    #[test]
    fn one_day_offset_pg() {
        assert(super::days_since_j2000_1e9_from_pg(super::J2000_MINUTE_SINCE_PG + 1_440) == SCALE_1E9_I64, '+1 day = 1e9');
    }

    #[test]
    fn normalizes_angles_into_range() {
        assert(norm360_i64_1e9(0) == 0, '0 should stay 0');
        assert(norm360_i64_1e9(-1) == DEG_360_SCALED - 1, '-1 should wrap');
        assert(norm360_i64_1e9(DEG_360_SCALED) == 0, '360 should wrap to 0');
        assert(norm360_i64_1e9(361 * SCALE_1E9_I64) == SCALE_1E9_I64, '361 should wrap to 1');
    }
}
