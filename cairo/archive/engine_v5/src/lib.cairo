// engine_v5: a Cairo-native astronomy runtime for deterministic onchain chart
// computation. Computes ecliptic longitudes for seven celestial bodies (Sun, Moon, Mercury,
// Venus, Mars, Jupiter, Saturn) plus the ascendant, using fixed-point arithmetic (i64/i128
// at 1e9 scale) with no floating-point or external data dependencies. The computational
// pipeline evaluates VSOP87 heliocentric series, applies light-time correction, transforms
// through precession and IAU2000B nutation into ecliptic-of-date coordinates, and resolves
// horizon geometry for the ascendant. Adapted from Don Cross's astronomy library (MIT),
// validated at 100% sign-level parity across a 96,000-point grid spanning years 0001-4000.

pub mod fixed;
pub mod planets;
pub mod ascendant;
pub mod trig;
pub mod gen_atan;
pub mod gen_moon;
pub mod gen_sin;
pub mod gen_vsop;
pub mod frames;
