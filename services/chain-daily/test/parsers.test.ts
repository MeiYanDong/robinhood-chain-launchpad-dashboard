import assert from "node:assert/strict";
import test from "node:test";
import { parseDefillamaChart } from "../src/defillama.js";
import { estimateTokenValue } from "../src/robinhood-official.js";
import { previousUtcDate, sanitize } from "../src/utils.js";

test("normalizes DefiLlama charts by UTC date and keeps the last value", () => {
  const points = parseDefillamaChart({
    totalDataChart: [
      [Date.parse("2026-08-22T00:00:00Z") / 1000, 10],
      [Date.parse("2026-08-22T12:00:00Z") / 1000, 12],
      [Date.parse("2026-08-23T00:00:00Z") / 1000, "20"],
      ["bad", 30],
    ],
  });
  assert.deepEqual(points, [
    { date: "2026-08-22", value: 12 },
    { date: "2026-08-23", value: 20 },
  ]);
});

test("estimates multiplier-adjusted tokenized value", () => {
  const supply = 2_000_000_000_000_000_000n;
  assert.equal(estimateTokenValue(supply, 18, 100, 0.5), 100);
});

test("defaults to the previous closed UTC date", () => {
  assert.equal(previousUtcDate(new Date("2026-08-24T00:01:00Z")), "2026-08-23");
});

test("sanitizes credentials from persisted source errors", () => {
  const value = sanitize("https://alice:secret@example.com/x?api_key=abc&token=def bk_usr_live123");
  assert.equal(value.includes("secret"), false);
  assert.equal(value.includes("abc"), false);
  assert.equal(value.includes("def"), false);
  assert.equal(value.includes("bk_usr"), false);
});
