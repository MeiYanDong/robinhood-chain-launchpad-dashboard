import assert from "node:assert/strict";
import test from "node:test";
import { PLATFORM_REGISTRY } from "../src/config/platforms.js";
import { buildOverview } from "../src/domain/aggregate.js";
import type { DailyMetric, PlatformConfig } from "../src/domain/types.js";

function metric(overrides: Partial<DailyMetric> & Pick<DailyMetric, "platformId" | "metric" | "value">): DailyMetric {
  return {
    date: "2026-08-22",
    source: "fixture",
    quality: "reported",
    scope: "fixture scope",
    derivation: null,
    collectedAt: "2026-08-23T01:00:00.000Z",
    ...overrides,
  };
}

function platform(id: string): PlatformConfig {
  const match = PLATFORM_REGISTRY.find((candidate) => candidate.id === id);
  assert.ok(match, `missing registry platform ${id}`);
  return match;
}

test("missing observations remain null instead of becoming zero", () => {
  const overview = buildOverview({
    platforms: [platform("pons")],
    metrics: [],
    targetDate: "2026-08-22",
    windowDays: 1,
    generatedAt: "2026-08-23T01:00:00.000Z",
    stale: false,
    runStatus: "success",
  });

  assert.equal(overview.platforms[0]?.metrics.volume_usd.value, null);
  assert.equal(overview.summary.volume_usd.value, null);
  assert.equal(overview.summary.volume_usd.observedDays, 0);
});

test("explicit zero is preserved as an observation", () => {
  const overview = buildOverview({
    platforms: [platform("pons")],
    metrics: [metric({ platformId: "pons", metric: "fees_usd", value: 0 })],
    targetDate: "2026-08-22",
    windowDays: 1,
    generatedAt: "2026-08-23T01:00:00.000Z",
    stale: false,
    runStatus: "success",
  });

  assert.equal(overview.platforms[0]?.metrics.fees_usd.value, 0);
  assert.equal(overview.platforms[0]?.metrics.fees_usd.observedDays, 1);
  assert.equal(overview.summary.fees_usd.value, 0);
});

test("suite-wide StonkBrokers observations are excluded from tracked totals", () => {
  const overview = buildOverview({
    platforms: [platform("pons"), platform("stonkbrokers")],
    metrics: [
      metric({ platformId: "pons", metric: "fees_usd", value: 100 }),
      metric({ platformId: "stonkbrokers", metric: "fees_usd", value: 900 }),
    ],
    targetDate: "2026-08-22",
    windowDays: 1,
    generatedAt: "2026-08-23T01:00:00.000Z",
    stale: false,
    runStatus: "success",
  });

  assert.equal(overview.summary.fees_usd.value, 100);
  assert.equal(overview.summary.eligiblePlatforms, 1);
  assert.equal(overview.platforms.find((row) => row.id === "stonkbrokers")?.excludeFromTotals, true);
});
