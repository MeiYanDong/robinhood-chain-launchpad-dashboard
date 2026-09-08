import assert from "node:assert/strict";
import test from "node:test";
import { missingDateRanges } from "../src/platform-activity/backfill.js";

test("activity backfill groups only missing contiguous dates into bounded ranges", () => {
  const ranges = missingDateRanges(
    "2026-07-13",
    "2026-07-23",
    new Set(["2026-07-15", "2026-07-21"]),
    3,
  );

  assert.deepEqual(ranges, [
    { startDate: "2026-07-13", endDate: "2026-07-14" },
    { startDate: "2026-07-16", endDate: "2026-07-18" },
    { startDate: "2026-07-19", endDate: "2026-07-20" },
    { startDate: "2026-07-22", endDate: "2026-07-23" },
  ]);
});

test("activity backfill validates its maximum range size", () => {
  assert.throws(
    () => missingDateRanges("2026-07-13", "2026-07-14", new Set(), 0),
    /positive integer/,
  );
});
