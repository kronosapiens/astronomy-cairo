import test from "node:test";
import assert from "node:assert/strict";

import {
  EPOCH_1900_UNIX_MS,
  minuteSince1900,
  generateSignCorpus,
} from "../src/oracle/corpus.js";

test("minuteSince1900 maps epoch start to zero", () => {
  assert.equal(minuteSince1900(EPOCH_1900_UNIX_MS), 0);
  assert.equal(minuteSince1900(EPOCH_1900_UNIX_MS + 60_000), 1);
});

test("generateSignCorpus emits deterministic sign payloads", () => {
  const input = {
    startUnixMs: Date.UTC(2026, 1, 24, 0, 0, 0),
    endUnixMs: Date.UTC(2026, 1, 24, 1, 0, 0),
    stepMinutes: 30,
    latBins: [377],
    lonBins: [-1224],
  };

  const a = generateSignCorpus(input);
  const b = generateSignCorpus(input);

  assert.deepEqual(a, b, "corpus generation should be deterministic");
  assert.equal(a.entries.length, 3, "expected 3 timestamps: 00:00, 00:30, 01:00");

  for (const row of a.entries) {
    assert.equal(typeof row.time_minute, "number");
    assert.equal(typeof row.lat_bin, "number");
    assert.equal(typeof row.lon_bin, "number");
    assert.equal(Array.isArray(row.planet_sign), true);
    assert.equal(row.planet_sign.length, 7);
    assert.ok(row.asc_sign >= 0 && row.asc_sign < 12, "asc_sign in [0,12)");
    for (const s of row.planet_sign) {
      assert.ok(s >= 0 && s < 12, "planet sign in [0,12)");
    }
  }
});
