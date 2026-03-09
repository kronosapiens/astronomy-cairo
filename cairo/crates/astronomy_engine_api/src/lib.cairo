use astronomy_engine_v5::ascendant as v5_asc;
use astronomy_engine_v5::frames as v5_frames;
use astronomy_engine_v5::planets as v5_planets;

pub const ENGINE_V5: u8 = 5;

const SCALE_1E9: i64 = 1_000_000_000;
const MINUTE_0001_SINCE_PG: i64 = 0;
const MINUTE_4001_SINCE_PG: i64 = 2_103_796_800;

fn sign_from_lon_1e9(lon_1e9: i64) -> i64 {
    let period: i64 = 360 * SCALE_1E9;
    let mut normalized = lon_1e9 % period;
    if normalized < 0 {
        normalized += period;
    }
    normalized / (30 * SCALE_1E9)
}

pub fn engine_supported_minute_range(engine_id: u8) -> (i64, i64) {
    assert(engine_id == ENGINE_V5, 'invalid engine');
    (MINUTE_0001_SINCE_PG, MINUTE_4001_SINCE_PG)
}

pub fn engine_supports_pg_minute(engine_id: u8, minute_pg: i64) -> bool {
    if engine_id != ENGINE_V5 {
        return false;
    }
    minute_pg >= MINUTE_0001_SINCE_PG && minute_pg < MINUTE_4001_SINCE_PG
}

pub fn compute_engine_signs_pg(engine_id: u8, minute_pg: i64, lat_bin: i16, lon_bin: i16) -> [i64; 8] {
    assert(engine_id == ENGINE_V5, 'invalid engine');
    assert(engine_supports_pg_minute(engine_id, minute_pg), 'minute out of supported range');

    [
        sign_from_lon_1e9(v5_planets::approximate_planet_longitude_pg_1e9(0, minute_pg)),
        sign_from_lon_1e9(v5_planets::approximate_planet_longitude_pg_1e9(1, minute_pg)),
        sign_from_lon_1e9(v5_planets::approximate_planet_longitude_pg_1e9(2, minute_pg)),
        sign_from_lon_1e9(v5_planets::approximate_planet_longitude_pg_1e9(3, minute_pg)),
        sign_from_lon_1e9(v5_planets::approximate_planet_longitude_pg_1e9(4, minute_pg)),
        sign_from_lon_1e9(v5_planets::approximate_planet_longitude_pg_1e9(5, minute_pg)),
        sign_from_lon_1e9(v5_planets::approximate_planet_longitude_pg_1e9(6, minute_pg)),
        sign_from_lon_1e9(v5_asc::approximate_ascendant_longitude_pg_1e9(minute_pg, lat_bin, lon_bin)),
    ]
}

pub fn compute_engine_planet_longitudes_pg_1e9(engine_id: u8, minute_pg: i64) -> [i64; 7] {
    assert(engine_id == ENGINE_V5, 'invalid engine');
    assert(engine_supports_pg_minute(engine_id, minute_pg), 'minute out of supported range');

    [
        v5_planets::approximate_planet_longitude_pg_1e9(0, minute_pg),
        v5_planets::approximate_planet_longitude_pg_1e9(1, minute_pg),
        v5_planets::approximate_planet_longitude_pg_1e9(2, minute_pg),
        v5_planets::approximate_planet_longitude_pg_1e9(3, minute_pg),
        v5_planets::approximate_planet_longitude_pg_1e9(4, minute_pg),
        v5_planets::approximate_planet_longitude_pg_1e9(5, minute_pg),
        v5_planets::approximate_planet_longitude_pg_1e9(6, minute_pg),
    ]
}

pub fn compute_engine_planet_debug_frame_pg_1e9(
    engine_id: u8, planet: u8, minute_pg: i64,
) -> (i64, i64, i64, i64, i64, i64) {
    assert(engine_id == ENGINE_V5, 'invalid engine');
    assert(engine_supports_pg_minute(engine_id, minute_pg), 'minute out of supported range');
    let (dx_eqj, dy_eqj, dz_eqj, obs_tt_1e9) = v5_planets::debug_planet_geocentric_eqj_pg_1e9(
        planet, minute_pg,
    );
    let (frame_lon_1e9, frame_lat_1e9) = v5_planets::debug_planet_frame_lon_lat_pg_1e9(
        planet, minute_pg,
    );
    (dx_eqj, dy_eqj, dz_eqj, obs_tt_1e9, frame_lon_1e9, frame_lat_1e9)
}

pub fn compute_engine_frame_from_eqj_1e9(
    engine_id: u8, x_eqj_1e9: i64, y_eqj_1e9: i64, z_eqj_1e9: i64, days_since_j2000_1e9: i64,
) -> (i64, i64) {
    assert(engine_id == ENGINE_V5, 'invalid engine');
    v5_frames::eqj_to_ecliptic_of_date_lon_lat_1e9(
        x_eqj_1e9, y_eqj_1e9, z_eqj_1e9, days_since_j2000_1e9,
    )
}
