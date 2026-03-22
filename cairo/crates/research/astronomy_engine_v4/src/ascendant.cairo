use crate::fixed::{norm360_i64_1e9, SCALE_1E9};
use crate::frames::{mean_true_obliquity_deg_1e9, sidereal_time_deg_1e9};
use crate::time::{days_since_j2000_1e9_from_pg, minute_since_1900_to_pg};
use crate::trig::{atan2_deg_1e9, cos_deg_1e9, sin_deg_1e9};

/// Approximate ascendant longitude using local sidereal angle and a small latitude term.
/// Inputs:
/// - minute_since_1900: minute count from 1900-01-01T00:00:00Z
/// - lat_bin: latitude in 0.1-degree bins (-900..900)
/// - lon_bin: longitude in 0.1-degree bins (-1800..1800)
pub fn approximate_ascendant_longitude_1e9(
    minute_since_1900: u32, lat_bin: i16, lon_bin: i16,
) -> i64 {
    approximate_ascendant_longitude_pg_1e9(minute_since_1900_to_pg(minute_since_1900), lat_bin, lon_bin)
}

/// Ascendant longitude from proleptic Gregorian minute epoch
/// (`0001-01-01T00:00:00Z` => minute 0).
pub fn approximate_ascendant_longitude_pg_1e9(
    minute_since_pg: i64, lat_bin: i16, lon_bin: i16,
) -> i64 {
    let d = days_since_j2000_1e9_from_pg(minute_since_pg);
    let epsilon_true = mean_true_obliquity_deg_1e9(d);
    let lon_deg_1e9: i64 = lon_bin.into() * 100_000_000; // 0.1 deg bin -> 1e9 scale
    let lst = norm360_i64_1e9(sidereal_time_deg_1e9(d) + lon_deg_1e9);

    let lat = lat_bin.into() * 100_000_000; // 0.1 deg bin -> 1e9 scale

    let sin_theta: i64 = sin_deg_1e9(lst);
    let cos_theta: i64 = cos_deg_1e9(lst);
    let sin_eps: i64 = sin_deg_1e9(epsilon_true);
    let cos_eps: i64 = cos_deg_1e9(epsilon_true);
    let sin_lat: i64 = sin_deg_1e9(lat);
    let cos_lat: i64 = cos_deg_1e9(lat);

    // tan(lat) = sin(lat) / cos(lat)
    let tan_lat: i128 = (sin_lat.into() * SCALE_1E9.into()) / cos_lat.into();
    let term: i128 = (sin_theta.into() * cos_eps.into()) / SCALE_1E9.into()
        + (tan_lat * sin_eps.into()) / SCALE_1E9.into();
    let y = -cos_theta;
    let x: i64 = term.try_into().unwrap();
    let mut lam = norm360_i64_1e9(atan2_deg_1e9(y, x) + 180 * SCALE_1E9);

    // Pick eastern intersection branch. In horizon frame, +y points west.
    // y_west = sin(theta)*x_eq - cos(theta)*y_eq where:
    // x_eq = cos(lambda), y_eq = sin(lambda)*cos(epsilon).
    let sin_lam = sin_deg_1e9(lam);
    let cos_lam = cos_deg_1e9(lam);
    let y_eq: i128 = (sin_lam.into() * cos_eps.into()) / SCALE_1E9.into();
    let y_west: i128 = (sin_theta.into() * cos_lam.into()) / SCALE_1E9.into()
        - (cos_theta.into() * y_eq) / SCALE_1E9.into();
    if y_west > 0 {
        lam = norm360_i64_1e9(lam + 180 * SCALE_1E9);
    }
    lam
}
