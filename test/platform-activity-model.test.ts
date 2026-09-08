import assert from "node:assert/strict";
import test from "node:test";
import { PLATFORM_REGISTRY } from "../src/config/platforms.js";
import type { DailyMetric, PlatformStat } from "../src/domain/types.js";
import { buildPlatformActivity } from "../src/platform-activity/model.js";
import type { PlatformActivityId } from "../src/platform-activity/types.js";
import { shiftUtcDate } from "../src/utils/time.js";

const startDate = "2026-07-01";
const targetDate = shiftUtcDate(startDate, 49);

function volumeMetric(
  platformId: PlatformActivityId,
  date: string,
  value: number,
  overrides: Partial<DailyMetric> = {},
): DailyMetric {
  return {
    platformId,
    metric: "volume_usd",
    date,
    value,
    source: `${platformId}.official.dailyVolume`,
    quality: "reported",
    scope: "fixture platform volume",
    derivation: null,
    collectedAt: "2026-08-20T01:00:00.000Z",
    ...overrides,
  };
}

function platformHistory(
  platformId: PlatformActivityId,
  baselineDaily: number,
  currentDaily: number,
): DailyMetric[] {
  return Array.from({ length: 50 }, (_, index) =>
    volumeMetric(
      platformId,
      shiftUtcDate(startDate, index),
      index >= 43 ? currentDaily : baselineDaily,
    ),
  );
}

function allTimeStat(platformId: PlatformActivityId, value: number): PlatformStat {
  return {
    platformId,
    key: "volume_all_time_usd",
    label: "累计成交量",
    value,
    unit: "USD",
    period: "all_time",
    source: `${platformId}.official`,
    quality: "reported",
    scope: "official all-time volume",
    derivation: null,
    collectedAt: "2026-08-20T01:00:00.000Z",
  };
}

function build(metrics: DailyMetric[], stats: PlatformStat[] = []) {
  return buildPlatformActivity({
    targetDate,
    generatedAt: "2026-08-20T02:00:00.000Z",
    stale: false,
    runStatus: "success",
    platforms: PLATFORM_REGISTRY,
    metrics,
    stats,
  });
}

test("activity multiple compares each platform with its own prior same-window median", () => {
  const response = build([
    ...platformHistory("pons", 100, 200),
    ...platformHistory("pair", 200, 200),
    ...platformHistory("long", 400, 200),
  ]);

  const pons = response.platforms.find((platform) => platform.platformId === "pons");
  const pair = response.platforms.find((platform) => platform.platformId === "pair");
  const long = response.platforms.find((platform) => platform.platformId === "long");
  assert.equal(response.modelVersion, "platform-activity-v1");
  assert.equal(pons?.activity["7d"].current?.multiple, 2);
  assert.equal(pons?.activity["7d"].current?.band, "unusually_active");
  assert.equal(pair?.activity["7d"].current?.multiple, 1);
  assert.equal(pair?.activity["7d"].current?.band, "normal");
  assert.equal(long?.activity["7d"].current?.multiple, 0.5);
  assert.equal(long?.activity["7d"].current?.band, "quiet");
  assert.equal(pons?.activity["30d"].current?.status, "building_baseline");
  assert.equal(response.comparisons["7d"].state, "available");
  assert.ok(Math.abs((response.comparisons["7d"].sharesPercent.pons ?? 0) - 100 / 3) < 1e-10);
  assert.equal(response.comparisons.lifetime.state, "not_comparable");
});

test("incomplete windows expose observed lower bounds but block multiples and shares", () => {
  const metrics = [
    ...platformHistory("pons", 100, 200),
    ...platformHistory("pair", 200, 200),
    ...platformHistory("long", 400, 200).filter((metric) => metric.date !== targetDate),
  ];
  const response = build(metrics);
  const long = response.platforms.find((platform) => platform.platformId === "long");

  assert.equal(long?.volumes["7d"].status, "partial");
  assert.equal(long?.volumes["7d"].valueUsd, null);
  assert.equal(long?.volumes["7d"].observedValueUsd, 1_200);
  assert.equal(long?.activity["7d"].current?.status, "partial");
  assert.equal(long?.activity["7d"].current?.multiple, null);
  assert.equal(response.comparisons["7d"].state, "partial");
  assert.equal(response.comparisons["7d"].sharesPercent.long, null);
});

test("a legacy abrupt zero is reclassified, stays visible, and cannot enter calculations", () => {
  const metrics = platformHistory("pons", 1_000_000, 2_000_000).map((metric) =>
    metric.date === targetDate
      ? volumeMetric("pons", targetDate, 0, {
          quality: "reported",
          derivation: null,
        })
      : metric,
  );
  const response = build(metrics);
  const pons = response.platforms.find((platform) => platform.platformId === "pons");
  const lastDay = pons?.daily.at(-1);

  assert.equal(lastDay?.rawValueUsd, 0);
  assert.equal(lastDay?.valueUsd, null);
  assert.equal(lastDay?.state, "suspect");
  assert.equal(pons?.activity["7d"].current?.status, "partial");
  assert.equal(pons?.volumes["7d"].status, "partial");
});

test("official all-time totals stay separate from the auditable daily sum", () => {
  const metrics = [
    ...platformHistory("pons", 100, 200),
    ...platformHistory("pair", 200, 200),
    ...platformHistory("long", 400, 200),
  ];
  const response = build(metrics, [allTimeStat("pons", 99_999)]);
  const pons = response.platforms.find((platform) => platform.platformId === "pons");

  assert.equal(pons?.volumes.lifetime.valueUsd, 99_999);
  assert.equal(pons?.volumes.lifetime.reportedAllTimeUsd, 99_999);
  assert.equal(pons?.volumes.lifetime.observedValueUsd, 5_700);
  assert.equal(pons?.volumes.lifetime.valueKind, "reported_all_time");
});

test("new platforms remain in baseline-building state instead of receiving a fake multiple", () => {
  const metrics = Array.from({ length: 11 }, (_, index) =>
    volumeMetric("pair", shiftUtcDate(startDate, index), 100),
  );
  const response = buildPlatformActivity({
    targetDate: shiftUtcDate(startDate, 10),
    generatedAt: "2026-07-12T01:00:00.000Z",
    stale: false,
    runStatus: "success",
    platforms: PLATFORM_REGISTRY,
    metrics,
    stats: [],
  });
  const pair = response.platforms.find((platform) => platform.platformId === "pair");

  assert.equal(pair?.activity["7d"].current?.averageDailyVolumeUsd, 100);
  assert.equal(pair?.activity["7d"].current?.status, "building_baseline");
  assert.equal(pair?.activity["7d"].current?.baselineObservationCount, 0);
  assert.equal(pair?.activity["7d"].current?.multiple, null);
});
