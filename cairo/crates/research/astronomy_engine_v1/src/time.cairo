use crate::fixed::{div_round_half_away_from_zero, SCALE_1E9};

pub const EPOCH_1900_MINUTE: i64 = 0;
pub const J2000_MINUTE_SINCE_1900: i64 = 52_595_280; // 2000-01-01T12:00:00Z

/// Convert minutes since 1900-01-01 to days since J2000 (scaled by 1e9).
pub fn days_since_j2000_1e9(minute_since_1900: u32) -> i64 {
    let minute_i64: i64 = minute_since_1900.into();
    let delta_min = minute_i64 - J2000_MINUTE_SINCE_1900;
    let num: i128 = delta_min.into() * SCALE_1E9.into();
    div_round_half_away_from_zero(num, 1_440).try_into().unwrap()
}

#[cfg(test)]
mod tests {
    use super::{days_since_j2000_1e9, J2000_MINUTE_SINCE_1900};

    #[test]
    fn j2000_is_zero_days() {
        let m: u32 = J2000_MINUTE_SINCE_1900.try_into().unwrap();
        assert(days_since_j2000_1e9(m) == 0, 'J2000 must map to 0 days');
    }

    #[test]
    fn one_day_offset_is_scaled_correctly() {
        let m: u32 = (J2000_MINUTE_SINCE_1900 + 1_440).try_into().unwrap();
        assert(days_since_j2000_1e9(m) == 1_000_000_000, '+1 day should be 1e9');
    }
}
