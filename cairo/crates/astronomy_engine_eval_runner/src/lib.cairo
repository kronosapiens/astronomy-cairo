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
