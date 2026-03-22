// astronomy_engine_v6: a Cairo-native astronomy runtime for deterministic onchain chart
// computation. Computes ecliptic longitudes for seven celestial bodies (Sun, Moon, Mercury,
// Venus, Mars, Jupiter, Saturn) plus the ascendant, using fixed-point arithmetic (i64/i128
// at 1e9 scale) with no floating-point or external data dependencies. The computational
// pipeline evaluates VSOP87 heliocentric series, applies light-time correction, transforms
// through precession and IAU2000B nutation into ecliptic-of-date coordinates, and resolves
// horizon geometry for the ascendant. Adapted from Donald Cross's astronomy-engine (MIT),
// with optimized trig lookup tables for Starknet deployment.

pub mod ascendant;
pub mod fixed;
pub mod frames;
pub mod gen;
pub mod planets;
pub mod trig;
