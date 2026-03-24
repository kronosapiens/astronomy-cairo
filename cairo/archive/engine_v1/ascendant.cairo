use crate::fixed::{norm360_i64_1e9, SCALE_1E9};
use crate::time::days_since_j2000_1e9;
use crate::trig::{atan2_deg_1e9, cos_deg_1e9, sin_deg_1e9};

const GMST_BASE_DEG_1E9: i64 = 280_460_618_370;
const GMST_RATE_DEG_PER_DAY_1E9: i64 = 360_985_647_366;
const JULIAN_CENTURY_DAYS: i64 = 36_525;

/// Approximate ascendant longitude using local sidereal angle and a small latitude term.
/// Inputs:
/// - minute_since_1900: minute count from 1900-01-01T00:00:00Z
/// - lat_bin: latitude in 0.1-degree bins (-900..900)
/// - lon_bin: longitude in 0.1-degree bins (-1800..1800)
pub fn approximate_ascendant_longitude_1e9(
    minute_since_1900: u32, lat_bin: i16, lon_bin: i16,
) -> i64 {
    let d = days_since_j2000_1e9(minute_since_1900);
    let gmst_delta: i128 = (GMST_RATE_DEG_PER_DAY_1E9.into() * d.into()) / SCALE_1E9.into();

    // T = centuries since J2000, scaled by 1e9.
    let t: i128 = d.into() / JULIAN_CENTURY_DAYS.into();
    let t2: i128 = (t * t) / SCALE_1E9.into();
    let t3: i128 = (t2 * t) / SCALE_1E9.into();
    // Meeus GMST correction terms in degrees:
    // +0.000387933*T^2 - T^3/38710000
    let gmst_t2: i128 = (387_933_i64.into() * t2) / SCALE_1E9.into();
    let gmst_t3: i128 = (26_i64.into() * t3) / SCALE_1E9.into();

    // Mean obliquity (deg) polynomial in T (centuries), scaled by 1e9:
    // eps = 23.439291111 - 0.013004167*T - 0.000000164*T^2 + 0.000000504*T^3
    let eps_t1: i128 = (-13_004_167_i64.into() * t) / SCALE_1E9.into();
    let eps_t2: i128 = (-164_i64.into() * t2) / SCALE_1E9.into();
    let eps_t3: i128 = (504_i64.into() * t3) / SCALE_1E9.into();
    let epsilon = 23_439_291_111_i64 + eps_t1.try_into().unwrap() + eps_t2.try_into().unwrap()
        + eps_t3.try_into().unwrap();

    // Short nutation series (degrees scaled by 1e9).
    // This approximates apparent sidereal time via equation of equinoxes.
    let omega = norm360_i64_1e9(
        125_044_520_000_i64 - ((1_934_136_261_000_i128 * t) / SCALE_1E9.into()).try_into().unwrap(),
    );
    let l_sun = norm360_i64_1e9(
        280_466_500_000_i64 + ((36_000_769_800_000_i128 * t) / SCALE_1E9.into()).try_into().unwrap(),
    );
    let l_moon = norm360_i64_1e9(
        218_316_500_000_i64 + ((481_267_881_300_000_i128 * t) / SCALE_1E9.into()).try_into().unwrap(),
    );

    let delta_psi: i64 = (
        (-4_777_778_i128 * sin_deg_1e9(omega).into()) / SCALE_1E9.into()
            + (-366_667_i128 * sin_deg_1e9(2 * l_sun).into()) / SCALE_1E9.into()
            + (-63_889_i128 * sin_deg_1e9(2 * l_moon).into()) / SCALE_1E9.into()
            + (58_333_i128 * sin_deg_1e9(2 * omega).into()) / SCALE_1E9.into()
    ).try_into().unwrap();

    let delta_eps: i64 = (
        (2_555_556_i128 * cos_deg_1e9(omega).into()) / SCALE_1E9.into()
            + (158_333_i128 * cos_deg_1e9(2 * l_sun).into()) / SCALE_1E9.into()
            + (27_778_i128 * cos_deg_1e9(2 * l_moon).into()) / SCALE_1E9.into()
            + (-25_000_i128 * cos_deg_1e9(2 * omega).into()) / SCALE_1E9.into()
    ).try_into().unwrap();
    let epsilon_true = epsilon + delta_eps;
    let eqeq_num: i128 = delta_psi.into() * cos_deg_1e9(epsilon_true).into();
    let eqeq: i64 = (eqeq_num / SCALE_1E9.into()).try_into().unwrap();

    let lon_deg_1e9: i64 = lon_bin.into() * 100_000_000; // 0.1 deg bin -> 1e9 scale
    let lst = norm360_i64_1e9(
        GMST_BASE_DEG_1E9 + gmst_delta.try_into().unwrap() + gmst_t2.try_into().unwrap()
            - gmst_t3.try_into().unwrap() + eqeq + lon_deg_1e9,
    );

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
