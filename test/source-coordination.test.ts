import assert from "node:assert/strict";
import test from "node:test";
import { mergeBatches } from "../src/collectors/index.js";
import { PLATFORM_REGISTRY } from "../src/config/platforms.js";
import type { CollectionBatch, DailyMetric } from "../src/domain/types.js";

function metric(overrides: Partial<DailyMetric> = {}): DailyMetric {
  return {
    platformId: "letscash",
    metric: "volume_usd",
    date: "2026-08-24",
    value: 1,
    source: "defillama.summary.dailyVolume",
    quality: "derived",
    scope: "fixture",
    derivation: null,
    collectedAt: "2026-08-25T01:00:00.000Z",
    ...overrides,
  };
}

function batch(metrics: DailyMetric[]): CollectionBatch {
  return {
    platforms: PLATFORM_REGISTRY.filter((platform) =>
      new Set(metrics.map((candidate) => candidate.platformId)).has(platform.id),
    ),
    metrics,
    stats: [],
    sourceHealth: [],
    raw: [],
    warnings: [],
  };
}

test("LetsCash first-party daily data wins independent of collector order", () => {
  const aggregator = metric({ value: 100 });
  const official = metric({
    value: 200,
    source: "letscash.officialTokenomics+defillama.historicalEthUsd",
    collectedAt: "2026-08-25T00:00:00.000Z",
  });

  assert.equal(mergeBatches([batch([aggregator]), batch([official])]).metrics[0]?.value, 200);
  assert.equal(mergeBatches([batch([official]), batch([aggregator])]).metrics[0]?.value, 200);
});

test("lower-priority sources still fill dates absent from the first-party feed", () => {
  const older = metric({ date: "2026-07-01", value: 50 });
  const official = metric({
    value: 200,
    source: "letscash.officialTokenomics+defillama.historicalEthUsd",
  });
  const merged = mergeBatches([batch([older]), batch([official])]);

  assert.deepEqual(
    merged.metrics
      .sort((left, right) => left.date.localeCompare(right.date))
      .map((candidate) => [candidate.date, candidate.value, candidate.source]),
    [
      ["2026-07-01", 50, "defillama.summary.dailyVolume"],
      ["2026-08-24", 200, "letscash.officialTokenomics+defillama.historicalEthUsd"],
    ],
  );
});

test("Bankr official chain-split volume remains canonical", () => {
  const aggregator = metric({
    platformId: "bankr",
    value: 100,
    source: "defillama.summary.dailyVolume",
  });
  const official = metric({
    platformId: "bankr",
    value: 25,
    source: "bankr.officialDashboard",
  });

  const merged = mergeBatches([batch([official]), batch([aggregator])]);
  assert.equal(merged.metrics[0]?.value, 25);
  assert.equal(merged.metrics[0]?.source, "bankr.officialDashboard");
});
