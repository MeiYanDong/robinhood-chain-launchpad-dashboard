import assert from "node:assert/strict";
import test from "node:test";
import { lastClosedUtcDate, shiftUtcDate, windowStart } from "../src/utils/time.js";

test("lastClosedUtcDate returns T-1 even shortly after UTC midnight", () => {
  assert.equal(lastClosedUtcDate(new Date("2026-08-24T00:00:01.000Z")), "2026-08-23");
});

test("UTC date arithmetic crosses month boundaries", () => {
  assert.equal(shiftUtcDate("2026-08-01", -1), "2026-07-31");
  assert.equal(windowStart("2026-08-23", 30), "2026-07-25");
});
