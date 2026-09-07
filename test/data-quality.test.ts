import assert from "node:assert/strict";
import test from "node:test";
import { assessDailyMetrics } from "../src/domain/data-quality.js";
import { aggregateMetricWindow } from "../src/domain/aggregate.js";
import type { DailyMetric } from "../src/domain/types.js";

function metric(date: string, value: number): DailyMetric {
  return {
    platformId: "pons",
    metric: "volume_usd",
    date,
    value,
    source: "pons.officialAnalytics.dailyVolume",
    quality: "reported",
    scope: "platform",
    derivation: null,
    collectedAt: "2026-09-07T00:00:00Z",
  };
}
test("abrupt material zero is preserved as evidence but excluded from aggregate", () => {
  const raw = [metric("2026-09-05", 919_650_702), metric("2026-09-06", 0)];
  const assessed = assessDailyMetrics(raw);
  assert.equal(assessed[1]?.value, 0);
  assert.equal(assessed[1]?.quality, "unknown");
  assert.equal(raw[1]?.quality, "reported");
  assert.equal(aggregateMetricWindow(assessed.slice(1), 1).value, null);
});
test("ordinary explicit zero and recovery to positive data remain usable", () => {
  assert.equal(assessDailyMetrics([metric("2026-09-06", 0)])[0]?.quality, "reported");
  assert.equal(
    assessDailyMetrics([metric("2026-09-05", 2_000_000), metric("2026-09-06", 12)])[1]?.quality,
    "reported",
  );
});
