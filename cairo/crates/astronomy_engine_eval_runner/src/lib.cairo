use astronomy_engine_api::compute_engine_signs_pg;

/// Compare a batch of Cairo-computed chart signs against expected signs.
///
/// `point_data` is a flat list of triples:
/// `[minute_pg_0, lat_bin_0, lon_bin_0, minute_pg_1, lat_bin_1, lon_bin_1, ...]`
///
/// `expected_signs` is a flat list of 8-sign tuples:
/// `[sun, moon, mercury, venus, mars, jupiter, saturn, asc, ...]`
pub fn eval_batch_fail_count(engine_id: u8, point_data: Array<i64>, expected_signs: Array<i64>) -> u32 {
    let point_len = point_data.len();
    assert(point_len != 0, 'empty points');
    assert(point_len % 3 == 0, 'points % 3 != 0');
    assert(expected_signs.len() == (point_len / 3) * 8, 'expected len mismatch');

    let point_span = point_data.span();
    let expected_span = expected_signs.span();
    let mut fail_count: u32 = 0;
    let mut expected_base: usize = 0;

    let mut i: usize = 0;
    while i < point_len {
        let minute_pg = *point_span.at(i);
        let lat_bin_raw = *point_span.at(i + 1);
        let lon_bin_raw = *point_span.at(i + 2);
        let lat_bin: i16 = lat_bin_raw.try_into().unwrap();
        let lon_bin: i16 = lon_bin_raw.try_into().unwrap();

        let signs = compute_engine_signs_pg(engine_id, minute_pg, lat_bin, lon_bin);
        let sign_span = signs.span();

        let mut all_match = true;
        let mut j: usize = 0;
        while j < 8 {
            if *sign_span.at(j) != *expected_span.at(expected_base + j) {
                all_match = false;
            }
            j += 1;
        };
        if !all_match {
            fail_count += 1;
        }

        i += 3;
        expected_base += 8;
    };

    fail_count
}

/// Compare a batch and return split fail counters.
///
/// Returns:
/// - chart_fail_count: points with any mismatch
/// - planet_fail_count: points with any planet mismatch (bits 0..6)
/// - asc_fail_count: points with ascendant mismatch (bit 7)
/// - sun_fail_count .. saturn_fail_count: per-planet fail-point counters
pub fn eval_batch_fail_breakdown(
    engine_id: u8, point_data: Array<i64>, expected_signs: Array<i64>
) -> (u32, u32, u32, u32, u32, u32, u32, u32, u32, u32) {
    let point_len = point_data.len();
    assert(point_len != 0, 'empty points');
    assert(point_len % 3 == 0, 'points % 3 != 0');
    assert(expected_signs.len() == (point_len / 3) * 8, 'expected len mismatch');

    let point_span = point_data.span();
    let expected_span = expected_signs.span();
    let mut chart_fail_count: u32 = 0;
    let mut planet_fail_count: u32 = 0;
    let mut asc_fail_count: u32 = 0;
    let mut sun_fail_count: u32 = 0;
    let mut moon_fail_count: u32 = 0;
    let mut mercury_fail_count: u32 = 0;
    let mut venus_fail_count: u32 = 0;
    let mut mars_fail_count: u32 = 0;
    let mut jupiter_fail_count: u32 = 0;
    let mut saturn_fail_count: u32 = 0;
    let mut expected_base: usize = 0;

    let mut i: usize = 0;
    while i < point_len {
        let minute_pg = *point_span.at(i);
        let lat_bin_raw = *point_span.at(i + 1);
        let lon_bin_raw = *point_span.at(i + 2);
        let lat_bin: i16 = lat_bin_raw.try_into().unwrap();
        let lon_bin: i16 = lon_bin_raw.try_into().unwrap();

        let signs = compute_engine_signs_pg(engine_id, minute_pg, lat_bin, lon_bin);
        let sign_span = signs.span();

        let mut any_mismatch = false;
        let mut planet_mismatch = false;
        let mut asc_mismatch = false;
        let mut j: usize = 0;
        while j < 8 {
            if *sign_span.at(j) != *expected_span.at(expected_base + j) {
                any_mismatch = true;
                if j == 7 {
                    asc_mismatch = true;
                } else {
                    planet_mismatch = true;
                    if j == 0 {
                        sun_fail_count += 1;
                    } else if j == 1 {
                        moon_fail_count += 1;
                    } else if j == 2 {
                        mercury_fail_count += 1;
                    } else if j == 3 {
                        venus_fail_count += 1;
                    } else if j == 4 {
                        mars_fail_count += 1;
                    } else if j == 5 {
                        jupiter_fail_count += 1;
                    } else {
                        saturn_fail_count += 1;
                    }
                }
            }
            j += 1;
        };

        if any_mismatch {
            chart_fail_count += 1;
        }
        if planet_mismatch {
            planet_fail_count += 1;
        }
        if asc_mismatch {
            asc_fail_count += 1;
        }

        i += 3;
        expected_base += 8;
    };

    (
        chart_fail_count,
        planet_fail_count,
        asc_fail_count,
        sun_fail_count,
        moon_fail_count,
        mercury_fail_count,
        venus_fail_count,
        mars_fail_count,
        jupiter_fail_count,
        saturn_fail_count,
    )
}

/// Compare one point and return an 8-bit mismatch mask:
/// 0 Sun, 1 Moon, 2 Mercury, 3 Venus, 4 Mars, 5 Jupiter, 6 Saturn, 7 Ascendant
pub fn eval_point_mismatch_mask(
    engine_id: u8, minute_pg: i64, lat_bin: i16, lon_bin: i16, expected_signs: Array<i64>
) -> i64 {
    assert(expected_signs.len() == 8, 'expected len mismatch');
    let expected_span = expected_signs.span();
    let signs = compute_engine_signs_pg(engine_id, minute_pg, lat_bin, lon_bin);
    let sign_span = signs.span();

    let mut mask: i64 = 0;
    let mut bit: i64 = 1;
    let mut j: usize = 0;
    while j < 8 {
        if *sign_span.at(j) != *expected_span.at(j) {
            mask += bit;
        }
        bit *= 2;
        j += 1;
    };
    mask
}
