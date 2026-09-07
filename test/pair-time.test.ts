import assert from "node:assert/strict";
import test from "node:test";
import { latestChinaEightCutoff, shiftIsoDate } from "../src/pair/time.js";

test("PAIR daily cutoff is the latest 08:00 Asia/Shanghai boundary", () => {
  assert.deepEqual(latestChinaEightCutoff(new Date("2026-09-02T00:10:00.000Z")), {
    reportDate: "2026-09-02",
    cutoffAt: "2026-09-02T00:00:00.000Z",
  });
  assert.deepEqual(latestChinaEightCutoff(new Date("2026-09-01T22:00:00.000Z")), {
    reportDate: "2026-09-01",
    cutoffAt: "2026-09-01T00:00:00.000Z",
  });
  assert.equal(shiftIsoDate("2026-09-01", -1), "2026-08-31");
  assert.throws(() => shiftIsoDate("not-a-date", 1), /Invalid ISO date/);
});
