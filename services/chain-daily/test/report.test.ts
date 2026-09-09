import assert from "node:assert/strict";
import test from "node:test";
import { buildAssessment } from "../src/assessment.js";
import { renderReport } from "../src/report.js";
import type { DashboardSnapshot, MetricSnapshot } from "../src/types.js";

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
    change7d: 0.1,
    change30d: null,
    series: [],
    peers: [{ id: "robinhood", name: "Robinhood", value: 100, dataDate: "2026-08-22" }],
    peerRank: 1,
    peerTotal: 1,
    trackedRank: 1,
    trackedTotal: 1,
    percentile: 100,
    sourceId: "fixture",
    definition: "fixture",
    caveat: null,
    ...overrides,
  };
}

const snapshot: DashboardSnapshot = {
  schemaVersion: 1,
  runId: "fixture",
  generatedAt: "2026-08-24T07:00:00Z",
  targetDate: "2026-08-23",
  timezone: "UTC",
  chain: { id: "robinhood", name: "Robinhood Chain", chainId: 4663, launchDate: "2026-07-01" },
  verdict: "测试结论",
  metrics: [metric(), metric({ id: "tvs", label: "Total Value Secured", value: null, freshness: "unavailable" })],
  stockTokens: { activeAssets: null, pricedAssets: null, valuedAssets: null, estimatedValueUsd: null, coveragePercent: null, quoteGeneratedAt: null, chainId: 4663, method: "fixture" },
  networkHealth: { chainId: 4663, rpcOk: true, officialStatus: "UP", blockscout: { totalTransactions: null, totalAddresses: null, averageBlockTimeMs: null } },
  pillars: [{ id: "usage", label: "使用", state: "stable", evidence: "fixture" }],
  insights: [],
  quality: { okMetrics: 1, staleMetrics: 0, unavailableMetrics: 1, failedSources: 0, alerts: [] },
  sources: [],
};

test("report preserves UNKNOWN and the TVS/DeFi boundary", () => {
  const report = renderReport(snapshot);
  assert.match(report, /测试结论/);
  assert.match(report, /UNKNOWN/);
  assert.match(report, /TVS 与 DeFi TVL 是不同口径/);
});

test("report exposes the benchmark dimensions and both trend windows", () => {
  const assessed: DashboardSnapshot = {
    ...snapshot,
    schemaVersion: 2,
    assessment: buildAssessment(
      snapshot.metrics,
      snapshot.quality,
      snapshot.pillars,
      snapshot.chain.launchDate,
      snapshot.targetDate,
    ),
  };
  const report = renderReport(assessed);
  assert.match(report, /## 基准判读/);
  assert.match(report, /市场位置/);
  assert.match(report, /30 日变化/);
  assert.match(report, /不是资产估值、买卖或投资信号/);
});
