import assert from "node:assert/strict";
import test from "node:test";
import { assessMetric, buildAssessment } from "../src/assessment.js";
import type { MetricSnapshot, PillarState, QualitySummary } from "../src/types.js";

function metric(overrides: Partial<MetricSnapshot> = {}): MetricSnapshot {
  return {
    id: "transactions",
    label: "日交易数",
    shortLabel: "交易",
    unit: "number",
    temporalScope: "closed_day",
    value: 100,
    dataDate: "2026-08-22",
    targetDate: "2026-08-23",
    freshness: "ok",
    lagDays: 1,
    avg7d: 90,
    change7d: 0.2,
    change30d: 0.3,
    series: [],
    peers: [],
    peerRank: 2,
    peerTotal: 6,
    trackedRank: 3,
    trackedTotal: 27,
    percentile: 92.3,
    sourceId: "fixture",
    definition: "fixture",
    caveat: null,
    ...overrides,
  };
}

const pillars = (state: PillarState["state"]): PillarState[] => [
  { id: "usage", label: "使用", state, evidence: "fixture" },
  { id: "capital", label: "资本", state, evidence: "fixture" },
  { id: "economics", label: "经济", state, evidence: "fixture" },
  { id: "market", label: "市场", state, evidence: "fixture" },
];

const quality: QualitySummary = {
  okMetrics: 12,
  staleMetrics: 0,
  unavailableMetrics: 0,
  failedSources: 0,
  alerts: [],
};

test("maps position and persistent momentum to explainable metric labels", () => {
  assert.equal(assessMetric(metric()).label, "强");
  assert.equal(assessMetric(metric({ change7d: -0.2, change30d: -0.3 })).label, "领先转弱");
  assert.equal(
    assessMetric(metric({ peerRank: 6, percentile: 10, trackedRank: 25, change7d: 0.2, change30d: 0.3 })).label,
    "追赶改善",
  );
});

test("keeps short-term reversals separate from persistent trends", () => {
  const rebound = assessMetric(metric({ id: "dex_volume", change7d: 0.6, change30d: -0.4 }));
  assert.equal(rebound.momentum, "rebounding");
  assert.equal(rebound.label, "领先反弹");

  const pullback = assessMetric(metric({ id: "active_addresses", change7d: -0.3, change30d: 0.4 }));
  assert.equal(pullback.momentum, "pullback");
  assert.equal(pullback.label, "领先转弱");
});

test("treats missing data as unknown and ambiguous L1 costs as context", () => {
  assert.equal(assessMetric(metric({ freshness: "unavailable", value: null })).label, "UNKNOWN");
  assert.equal(assessMetric(metric({ id: "l1_costs" })).label, "背景项");
});

test("inverts lower-is-better cost momentum without changing raw evidence", () => {
  const result = assessMetric(metric({
    id: "median_tx_cost",
    peerRank: 6,
    percentile: 8.7,
    trackedRank: 22,
    trackedTotal: 24,
    change7d: -0.2,
    change30d: -0.7,
  }));
  assert.equal(result.momentum, "expanding");
  assert.equal(result.label, "追赶改善");
  assert.match(result.momentumEvidence, /成本指标下降视为改善/);
});

test("uses inclusive boundary thresholds for label stability", () => {
  const result = assessMetric(metric({ change7d: 0.05, change30d: 0.1 }));
  assert.equal(result.momentum, "expanding");
});

test("returns a strong chain state only when position, trend and breadth agree", () => {
  const metrics = [
    metric({ id: "transactions" }),
    metric({ id: "active_addresses" }),
    metric({ id: "stablecoin_supply" }),
    metric({ id: "chain_fees" }),
  ];
  const result = buildAssessment(metrics, quality, pillars("accelerating"), "2026-07-01", "2026-08-23");
  assert.equal(result.position.state, "leading");
  assert.equal(result.momentum.state, "expanding");
  assert.equal(result.quality.state, "broad");
  assert.equal(result.overallState, "strong");
  assert.match(result.caveats.join(" "), /90 日结构性基准暂为 UNKNOWN/);
});

test("flags transaction and active-address conflict instead of averaging it away", () => {
  const metrics = [
    metric({ id: "transactions", change7d: 0.2, change30d: -0.05 }),
    metric({ id: "active_addresses", change7d: -0.4, change30d: 0.2 }),
    metric({ id: "stablecoin_supply", change7d: 0.1, change30d: 0.3 }),
    metric({ id: "chain_fees", change7d: -0.2, change30d: -0.3 }),
    metric({ id: "dex_volume", change7d: 0.6, change30d: -0.4 }),
  ];
  const mixedPillars: PillarState[] = [
    { id: "usage", label: "使用", state: "mixed", evidence: "fixture" },
    { id: "capital", label: "资本", state: "accelerating", evidence: "fixture" },
    { id: "economics", label: "经济", state: "softening", evidence: "fixture" },
    { id: "market", label: "市场", state: "mixed", evidence: "fixture" },
  ];
  const result = buildAssessment(metrics, quality, mixedPillars, "2026-07-01", "2026-08-23");
  assert.equal(result.quality.state, "divergent");
  assert.equal(result.overallState, "leading_mixed");
  assert.match(result.quality.evidence, /日活/);
});

test("low confidence blocks the overall fundamentals conclusion", () => {
  const metrics = [
    metric({ id: "transactions" }),
    metric({ id: "active_addresses" }),
    metric({ id: "stablecoin_supply" }),
    metric({ id: "chain_fees" }),
  ];
  const result = buildAssessment(
    metrics,
    { ...quality, unavailableMetrics: 5, failedSources: 5 },
    pillars("accelerating"),
    "2026-07-01",
    "2026-08-23",
  );
  assert.equal(result.confidence.state, "low");
  assert.equal(result.overallState, "unknown");
  assert.match(result.headline, /不判断/);
});
