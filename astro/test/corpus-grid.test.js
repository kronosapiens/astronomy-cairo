import test from "node:test";
import assert from "node:assert/strict";
import {
  EPOCH_1900_UNIX_MS,
  generateSignCorpus,
  minuteSince1900,
  minuteToUnixMs,
} from "../src/oracle/corpus.js";

test("minuteSince1900 and minuteToUnixMs preserve minute-quantized timestamps", () => {
  const raw = EPOCH_1900_UNIX_MS + 12_345 * 60_000 + 17_000;
  const minute = minuteSince1900(raw);
  const roundTrip = minuteToUnixMs(minute);
  assert.equal(minute, 12_345);
  assert.equal(roundTrip, EPOCH_1900_UNIX_MS + 12_345 * 60_000);
});

test("generateSignCorpus is deterministic and ordered for mixed location grids", () => {
  const input = {
    startUnixMs: Date.UTC(2026, 1, 24, 0, 0, 0),
    endUnixMs: Date.UTC(2026, 1, 24, 1, 0, 0),
    stepMinutes: 60,
    latBins: [407, 312],
    lonBins: [-740, 299],
  };

  const a = generateSignCorpus(input);
  const b = generateSignCorpus(input);
  assert.deepEqual(a, b);
  assert.equal(a.entries.length, 8);

  const minutes = [
    minuteSince1900(Date.UTC(2026, 1, 24, 0, 0, 0)),
    minuteSince1900(Date.UTC(2026, 1, 24, 1, 0, 0)),
  ];
  const expectedOrder = [
    [minutes[0], 407, -740],
    [minutes[0], 407, 299],
    [minutes[0], 312, -740],
    [minutes[0], 312, 299],
    [minutes[1], 407, -740],
    [minutes[1], 407, 299],
    [minutes[1], 312, -740],
    [minutes[1], 312, 299],
  ];
  const actualOrder = a.entries.map((row) => [row.time_minute, row.lat_bin, row.lon_bin]);
  assert.deepEqual(actualOrder, expectedOrder);
});
