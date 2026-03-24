use crate::fixed::{div_round_half_away_from_zero, SCALE_1E9};

pub const EPOCH_1900_MINUTE: i64 = 0;
pub const J2000_MINUTE_SINCE_1900: i64 = 52_595_280; // 2000-01-01T12:00:00Z
pub const MINUTE_1900_SINCE_PG: i64 = 998_776_800; // 1900-01-01T00:00:00Z from 0001-01-01T00:00:00Z
pub const J2000_MINUTE_SINCE_PG: i64 = 1_051_372_080; // 2000-01-01T12:00:00Z from 0001-01-01T00:00:00Z

#[inline(never)]
pub fn minute_since_1900_to_pg(minute_since_1900: u32) -> i64 {
    MINUTE_1900_SINCE_PG + minute_since_1900.into()
}

#[inline(never)]
pub fn minute_since_pg_to_1900(minute_since_pg: i64) -> i64 {
    minute_since_pg - MINUTE_1900_SINCE_PG
}

/// Convert minutes since 0001-01-01T00:00:00Z (proleptic Gregorian) to
/// days since J2000 (scaled by 1e9).
pub fn days_since_j2000_1e9_from_pg(minute_since_pg: i64) -> i64 {
    let delta_min = minute_since_pg - J2000_MINUTE_SINCE_PG;
    let num: i128 = delta_min.into() * SCALE_1E9.into();
    div_round_half_away_from_zero(num, 1_440).try_into().unwrap()
}

/// Convert minutes since 1900-01-01 to days since J2000 (scaled by 1e9).
pub fn days_since_j2000_1e9(minute_since_1900: u32) -> i64 {
    days_since_j2000_1e9_from_pg(minute_since_1900_to_pg(minute_since_1900))
}

#[cfg(test)]
mod tests {
    use super::{
        days_since_j2000_1e9, days_since_j2000_1e9_from_pg, minute_since_1900_to_pg,
        J2000_MINUTE_SINCE_1900, J2000_MINUTE_SINCE_PG, MINUTE_1900_SINCE_PG,
    };

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

    #[test]
    fn j2000_pg_is_zero_days() {
        assert(days_since_j2000_1e9_from_pg(J2000_MINUTE_SINCE_PG) == 0, 'J2000 pg = 0');
    }

    #[test]
    fn minute_epoch_bridge_matches_known_offset() {
        let m1900: u32 = 0;
        assert(minute_since_1900_to_pg(m1900) == MINUTE_1900_SINCE_PG, '1900 bridge');
    }
}
