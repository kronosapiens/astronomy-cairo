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
    latBins: [4070, 3120],
    lonBins: [-7400, 2990],
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
    [minutes[0], 4070, -7400],
    [minutes[0], 4070, 2990],
    [minutes[0], 3120, -7400],
    [minutes[0], 3120, 2990],
    [minutes[1], 4070, -7400],
    [minutes[1], 4070, 2990],
    [minutes[1], 3120, -7400],
    [minutes[1], 3120, 2990],
  ];
  const actualOrder = a.entries.map((row) => [row.time_minute, row.lat_bin, row.lon_bin]);
  assert.deepEqual(actualOrder, expectedOrder);
});
