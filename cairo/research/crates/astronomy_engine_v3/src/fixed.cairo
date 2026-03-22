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
    fn normalizes_angles_into_range() {
        assert(norm360_i64_1e9(0) == 0, '0 should stay 0');
        assert(norm360_i64_1e9(-1) == DEG_360_SCALED - 1, '-1 should wrap');
        assert(norm360_i64_1e9(DEG_360_SCALED) == 0, '360 should wrap to 0');
        assert(norm360_i64_1e9(361 * SCALE_1E9_I64) == SCALE_1E9_I64, '361 should wrap to 1');
    }
}
