// Deterministic trigonometric functions using lookup tables with linear interpolation.
// Sin and cos use a 7201-entry table at 0.05° resolution (trig_table_sin), giving sub-
// arcsecond accuracy across [0°, 360°). Cos is implemented as sin(θ + 90°). Atan2 uses
// a 10001-entry table for the unit interval (trig_table_atan), with identity atan(z) for
// |z| ≤ 1 and the complementary form 90° - atan(1/z) for |z| > 1, plus explicit quadrant
// handling. This approach avoids iterative CORDIC or polynomial evaluation, both of which
// are expensive in Cairo's gas model. All inputs and outputs are in degrees scaled by 1e9.
// The table resolutions were chosen to keep interpolation error well below the 30° sign
// boundary threshold while maintaining practical gas cost.

use crate::fixed::{norm360_i64_1e9, SCALE_1E9};
use crate::gen_atan::ATAN_RATIO_1E4_DEG_1E9;
use crate::gen_sin::SIN_TWENTIETH_DEG_1E9;

const DEG_180_1E9: i64 = 180 * SCALE_1E9;

/// Fast deterministic sine approximation in degree-space.
/// Uses 0.05-degree lookup table with linear interpolation.
/// Returns sin(angle) scaled by 1e9.
pub fn sin_deg_1e9(angle_deg_1e9: i64) -> i64 {
    let a = norm360_i64_1e9(angle_deg_1e9);
    let step = 50_000_000_i64; // 0.05 degree in 1e9 units
    let idx_u32: u32 = (a / step).try_into().unwrap();
    let idx: usize = idx_u32.into();
    let frac: i64 = a % step; // [0, step)

    let v0 = *SIN_TWENTIETH_DEG_1E9.span().at(idx);
    let next_idx: usize = if idx == 7200 { 0 } else { idx + 1 };
    let v1 = *SIN_TWENTIETH_DEG_1E9.span().at(next_idx);
    let dv = v1 - v0;

    let interp: i128 = v0.into() + (dv.into() * frac.into()) / step.into();
    interp.try_into().unwrap()
}

pub fn cos_deg_1e9(angle_deg_1e9: i64) -> i64 {
    sin_deg_1e9(angle_deg_1e9 + 90 * SCALE_1E9)
}

fn atan_unit_deg_1e9(z_1e9: i64) -> i64 {
    // atan(z) for z in [-1,1] via table sampled at z = i/10000 with linear interpolation.
    let z_abs = if z_1e9 < 0 { -z_1e9 } else { z_1e9 };
    let step: i64 = 100_000; // 1e9 / 10000
    let idx_u32: u32 = (z_abs / step).try_into().unwrap();
    let idx: usize = idx_u32.into();
    let frac: i64 = z_abs % step;

    let v0 = *ATAN_RATIO_1E4_DEG_1E9.span().at(idx);
    let v1 = if idx == 10000 {
        v0
    } else {
        *ATAN_RATIO_1E4_DEG_1E9.span().at(idx + 1)
    };
    let interp: i128 = v0.into() + ((v1 - v0).into() * frac.into()) / step.into();
    let out: i64 = interp.try_into().unwrap();
    if z_1e9 < 0 { -out } else { out }
}

/// atan2(y, x) in degrees scaled by 1e9, range (-180, 180].
pub fn atan2_deg_1e9(y_1e9: i64, x_1e9: i64) -> i64 {
    if x_1e9 == 0 {
        if y_1e9 > 0 {
            return 90 * SCALE_1E9;
        }
        if y_1e9 < 0 {
            return -90 * SCALE_1E9;
        }
        return 0;
    }

    let z_abs: i128 = if y_1e9 >= 0 {
        y_1e9.into()
    } else {
        (-y_1e9).into()
    };
    let x_abs: i128 = if x_1e9 >= 0 {
        x_1e9.into()
    } else {
        (-x_1e9).into()
    };

    let base = if z_abs <= x_abs {
        let z: i64 = ((z_abs * SCALE_1E9.into()) / x_abs).try_into().unwrap();
        atan_unit_deg_1e9(z)
    } else {
        let inv: i64 = ((x_abs * SCALE_1E9.into()) / z_abs).try_into().unwrap();
        90 * SCALE_1E9 - atan_unit_deg_1e9(inv)
    };

    let q1 = if y_1e9 < 0 { -base } else { base };
    let q1_abs = if q1 < 0 { -q1 } else { q1 };
    if x_1e9 > 0 {
        q1
    } else if y_1e9 >= 0 {
        180 * SCALE_1E9 - q1_abs
    } else {
        -180 * SCALE_1E9 + q1_abs
    }
}

#[cfg(test)]
mod tests {
    use crate::fixed::SCALE_1E9;

    use super::{atan2_deg_1e9, cos_deg_1e9, sin_deg_1e9};

    #[test]
    fn sine_hits_cardinal_points() {
        assert(sin_deg_1e9(0) == 0, 'sin0');
        assert(sin_deg_1e9(180 * SCALE_1E9) == 0, 'sin180');
        let s90 = sin_deg_1e9(90 * SCALE_1E9);
        assert(s90 > 995_000_000 && s90 < 1_005_000_000, 'sin90');
    }

    #[test]
    fn cosine_hits_cardinal_points() {
        let c0 = cos_deg_1e9(0);
        assert(c0 > 995_000_000 && c0 < 1_005_000_000, 'cos0');
        let c180 = cos_deg_1e9(180 * SCALE_1E9);
        assert(c180 < -995_000_000 && c180 > -1_005_000_000, 'cos180');
    }

    #[test]
    fn atan2_hits_cardinal_points() {
        assert(atan2_deg_1e9(0, 1_000_000_000) == 0, 'atan2(0,1)=0');
        assert(atan2_deg_1e9(1_000_000_000, 0) == 90_000_000_000, 'atan2(1,0)=90');
        assert(atan2_deg_1e9(0, -1_000_000_000) == 180_000_000_000, 'atan2(0,-1)=180');
    }

    fn abs_i64(v: i64) -> i64 {
        if v < 0 { -v } else { v }
    }

    #[test]
    fn sin_known_values() {
        // sin(30°) = 0.5
        let s30 = sin_deg_1e9(30 * SCALE_1E9);
        assert(abs_i64(s30 - 500_000_000) < 100_000, 'sin30');
        // sin(45°) = √2/2 ≈ 0.707106781
        let s45 = sin_deg_1e9(45 * SCALE_1E9);
        assert(abs_i64(s45 - 707_106_781) < 100_000, 'sin45');
        // sin(60°) = √3/2 ≈ 0.866025404
        let s60 = sin_deg_1e9(60 * SCALE_1E9);
        assert(abs_i64(s60 - 866_025_404) < 100_000, 'sin60');
        // sin(210°) = -0.5
        let s210 = sin_deg_1e9(210 * SCALE_1E9);
        assert(abs_i64(s210 + 500_000_000) < 100_000, 'sin210');
    }

    #[test]
    fn cos_known_values() {
        // cos(60°) = 0.5
        let c60 = cos_deg_1e9(60 * SCALE_1E9);
        assert(abs_i64(c60 - 500_000_000) < 100_000, 'cos60');
        // cos(45°) = √2/2 ≈ 0.707106781
        let c45 = cos_deg_1e9(45 * SCALE_1E9);
        assert(abs_i64(c45 - 707_106_781) < 100_000, 'cos45');
        // cos(120°) = -0.5
        let c120 = cos_deg_1e9(120 * SCALE_1E9);
        assert(abs_i64(c120 + 500_000_000) < 100_000, 'cos120');
    }

    #[test]
    fn atan2_known_values() {
        // atan2(1, 1) = 45°
        let a45 = atan2_deg_1e9(SCALE_1E9, SCALE_1E9);
        assert(abs_i64(a45 - 45_000_000_000) < 1_000_000, 'atan45');
        // atan2(√3, 1) = 60°  (√3 ≈ 1.732050808)
        let a60 = atan2_deg_1e9(1_732_050_808, SCALE_1E9);
        assert(abs_i64(a60 - 60_000_000_000) < 1_000_000, 'atan60');
        // atan2(1, -1) = 135°
        let a135 = atan2_deg_1e9(SCALE_1E9, -SCALE_1E9);
        assert(abs_i64(a135 - 135_000_000_000) < 1_000_000, 'atan135');
        // atan2(-1, -1) = -135°
        let an135 = atan2_deg_1e9(-SCALE_1E9, -SCALE_1E9);
        assert(abs_i64(an135 + 135_000_000_000) < 1_000_000, 'atan-135');
    }
}
