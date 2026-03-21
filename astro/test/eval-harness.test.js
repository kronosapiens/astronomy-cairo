import test from "node:test";
import assert from "node:assert/strict";
import {
  EPOCH_PG_MS,
  buildBatchPayload,
  collectMismatchRowsForBatch,
  makeUtcDate,
  minuteSincePg,
  parseReturnArray,
  sliceBatchPayload,
} from "../src/cli/eval-cairo-engine.js";

test("minuteSincePg maps proleptic Gregorian epoch start to zero", () => {
  const epoch = makeUtcDate(1, 1, 1).getTime();
  assert.equal(epoch, EPOCH_PG_MS);
  assert.equal(minuteSincePg(epoch), 0);
  assert.equal(minuteSincePg(epoch + 60_000), 1);
});

test("parseReturnArray extracts trailing cairo-run return array", () => {
  const raw = "some logs\nreturning [1,2,3]\n";
  assert.deepEqual(parseReturnArray(raw), [1, 2, 3]);
});

test("buildBatchPayload packs points/expectations in deterministic year-month-location order", () => {
  const locations = [
    { name: "A", latBin: 100, lonBin: 200 },
    { name: "B", latBin: -300, lonBin: 400 },
  ];
  const payload = buildBatchPayload({
    batchStartYear: 2026,
    batchEndYear: 2026,
    months: 2,
    locations,
    computeExpectedSignsForPointFn: (unixMs, latBin, lonBin) => {
      const base = ((Math.floor(unixMs / 60_000) + latBin + lonBin) % 12 + 12) % 12;
      return [base, base, base, base, base, base, base, base];
    },
  });

  assert.equal(payload.batchPointCount, 4);
  assert.equal(payload.batchPointData.length, 12);
  assert.equal(payload.batchExpected.length, 32);
  assert.equal(payload.batchMeta.length, 4);

  const ordering = payload.batchMeta.map((r) => `${r.year}-${r.month}-${r.location}`);
  assert.deepEqual(ordering, ["2026-1-A", "2026-1-B", "2026-2-A", "2026-2-B"]);
});

test("sliceBatchPayload slices point and expected arrays using aligned point indices", () => {
  const pointData = [100, 1, 2, 200, 3, 4, 300, 5, 6];
  const expectedData = [
    0, 0, 0, 0, 0, 0, 0, 0,
    1, 1, 1, 1, 1, 1, 1, 1,
    2, 2, 2, 2, 2, 2, 2, 2,
  ];
  const { pointSlice, expectedSlice } = sliceBatchPayload(pointData, expectedData, 1, 3);
  assert.deepEqual(pointSlice, [200, 3, 4, 300, 5, 6]);
  assert.deepEqual(expectedSlice, [
    1, 1, 1, 1, 1, 1, 1, 1,
    2, 2, 2, 2, 2, 2, 2, 2,
  ]);
});

test("collectMismatchRowsForBatch recursively isolates failing points", () => {
  const failingMinutes = new Set([1, 4, 7]);
  const batchMeta = Array.from({ length: 8 }, (_, i) => ({
    year: 2026,
    month: 1,
    location: "X",
    latBin: 0,
    lonBin: 0,
    minutePg: i,
  }));
  const batchPointData = batchMeta.flatMap((m) => [m.minutePg, m.latBin, m.lonBin]);
  const batchExpected = Array.from({ length: batchMeta.length * 8 }, () => 0);

  const result = collectMismatchRowsForBatch({
    engineId: 5,
    engine: "v5",
    batchMeta,
    batchPointData,
    batchExpected,
    rootBreakdown: { failCount: failingMinutes.size },
    noBuild: true,
    runCairoBatchFn: ({ packedPoints }) => {
      let failCount = 0;
      for (let i = 0; i < packedPoints.length; i += 3) {
        if (failingMinutes.has(packedPoints[i])) failCount += 1;
      }
      return { failCount };
    },
    runCairoPointMismatchDetailFn: ({ minutePg }) => ({
      mask: failingMinutes.has(minutePg) ? 1 : 0,
      actualSigns: [0, 0, 0, 0, 0, 0, 0, 0],
      actualLongitudes1e9: [0, 0, 0, 0, 0, 0, 0],
    }),
    oraclePlanetLongitudeFn: () => 0,
  });

  assert.equal(result.mismatchRows.length, failingMinutes.size);
  assert.equal(result.pointMaskCalls, failingMinutes.size);
  assert.ok(result.subsetBatchCalls > 0);

  const extractedMinutes = result.mismatchRows
    .map((row) => row.minutePg)
    .sort((a, b) => a - b);
  assert.deepEqual(extractedMinutes, [1, 4, 7]);
});
