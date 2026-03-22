use astronomy_engine_v6::planets as engine_planets;
use astronomy_engine_v6::ascendant as engine_asc;
use astronomy_engine_v6::fixed::SCALE_1E9;

const MINUTE_0001_SINCE_PG: i64 = 0;
const MINUTE_4001_SINCE_PG: i64 = 2_103_796_800;

#[starknet::interface]
pub trait IAstronomyEngine<TContractState> {
    /// Zodiac sign indices (0=Aries..11=Pisces) for all 7 planets + ascendant.
    /// Returns [Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn, Ascendant].
    fn compute_signs(
        self: @TContractState, minute_pg: i64, lat_bin: i16, lon_bin: i16,
    ) -> [i64; 8];

    /// Ecliptic longitudes (degrees * 1e9) for all 7 planets + ascendant.
    /// Returns [Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn, Ascendant].
    fn compute_longitudes(
        self: @TContractState, minute_pg: i64, lat_bin: i16, lon_bin: i16,
    ) -> [i64; 8];

    /// Ecliptic longitudes (degrees * 1e9) for all 7 planets without ascendant.
    /// Returns [Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn].
    fn compute_planet_longitudes(
        self: @TContractState, minute_pg: i64,
    ) -> [i64; 7];

    /// Ecliptic longitude (degrees * 1e9) for a single planet.
    /// Planet indices: 0=Sun, 1=Moon, 2=Mercury, 3=Venus, 4=Mars, 5=Jupiter, 6=Saturn.
    fn compute_planet_longitude(
        self: @TContractState, planet: u8, minute_pg: i64,
    ) -> i64;

    /// Ascendant ecliptic longitude (degrees * 1e9).
    /// lat_bin/lon_bin are observer coordinates in 0.01-degree bins (e.g. 4070 = 40.70 N).
    fn compute_ascendant_longitude(
        self: @TContractState, minute_pg: i64, lat_bin: i16, lon_bin: i16,
    ) -> i64;

    /// Supported input range as (min_minute_pg, max_minute_pg).
    /// Minutes are counted from 0001-01-01T00:00:00Z (proleptic Gregorian).
    fn supported_minute_range(self: @TContractState) -> (i64, i64);
}

#[starknet::contract]
mod AstronomyEngine {
    use super::{engine_planets, engine_asc, SCALE_1E9};
    use super::{MINUTE_0001_SINCE_PG, MINUTE_4001_SINCE_PG};

    #[storage]
    struct Storage {}

    fn sign_from_lon_1e9(lon_1e9: i64) -> i64 {
        let period: i64 = 360 * SCALE_1E9;
        let mut normalized = lon_1e9 % period;
        if normalized < 0 {
            normalized += period;
        }
        normalized / (30 * SCALE_1E9)
    }

    fn assert_in_range(minute_pg: i64) {
        assert(
            minute_pg >= MINUTE_0001_SINCE_PG && minute_pg < MINUTE_4001_SINCE_PG,
            'minute out of range',
        );
    }

    #[abi(embed_v0)]
    impl AstronomyEngineImpl of super::IAstronomyEngine<ContractState> {
        fn compute_signs(
            self: @ContractState, minute_pg: i64, lat_bin: i16, lon_bin: i16,
        ) -> [i64; 8] {
            assert_in_range(minute_pg);
            let lons = engine_planets::all_planet_longitudes_pg_1e9(minute_pg);
            let asc = engine_asc::approximate_ascendant_longitude_pg_1e9(minute_pg, lat_bin, lon_bin);
            [
                sign_from_lon_1e9(*lons.span().at(0)),
                sign_from_lon_1e9(*lons.span().at(1)),
                sign_from_lon_1e9(*lons.span().at(2)),
                sign_from_lon_1e9(*lons.span().at(3)),
                sign_from_lon_1e9(*lons.span().at(4)),
                sign_from_lon_1e9(*lons.span().at(5)),
                sign_from_lon_1e9(*lons.span().at(6)),
                sign_from_lon_1e9(asc),
            ]
        }

        fn compute_longitudes(
            self: @ContractState, minute_pg: i64, lat_bin: i16, lon_bin: i16,
        ) -> [i64; 8] {
            assert_in_range(minute_pg);
            let lons = engine_planets::all_planet_longitudes_pg_1e9(minute_pg);
            let asc = engine_asc::approximate_ascendant_longitude_pg_1e9(minute_pg, lat_bin, lon_bin);
            [
                *lons.span().at(0),
                *lons.span().at(1),
                *lons.span().at(2),
                *lons.span().at(3),
                *lons.span().at(4),
                *lons.span().at(5),
                *lons.span().at(6),
                asc,
            ]
        }

        fn compute_planet_longitudes(
            self: @ContractState, minute_pg: i64,
        ) -> [i64; 7] {
            assert_in_range(minute_pg);
            engine_planets::all_planet_longitudes_pg_1e9(minute_pg)
        }

        fn compute_planet_longitude(
            self: @ContractState, planet: u8, minute_pg: i64,
        ) -> i64 {
            assert_in_range(minute_pg);
            engine_planets::approximate_planet_longitude_pg_1e9(planet, minute_pg)
        }

        fn compute_ascendant_longitude(
            self: @ContractState, minute_pg: i64, lat_bin: i16, lon_bin: i16,
        ) -> i64 {
            assert_in_range(minute_pg);
            engine_asc::approximate_ascendant_longitude_pg_1e9(minute_pg, lat_bin, lon_bin)
        }

        fn supported_minute_range(self: @ContractState) -> (i64, i64) {
            (MINUTE_0001_SINCE_PG, MINUTE_4001_SINCE_PG)
        }
    }
}
