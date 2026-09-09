import assert from "node:assert/strict";
import test from "node:test";
import type { IntelligenceResponse } from "../src/intelligence/types.js";
import { buildProductWorkbench } from "../src/product/model.js";

function intelligenceFixture(): IntelligenceResponse {
  return {
    service: "rhc-market-intelligence",
    generatedAt: "2026-09-09T01:58:00.000Z",
    status: "success",
    leader: {
      decisionQuestion: "who_leads_robinhood_chain",
      modelVersion: "structural-leader-v1",
      structuralLeader: {
        state: "confirmed",
        address: "0x1111111111111111111111111111111111111111",
        symbol: "PONS",
        name: "Pons",
        reason: "四项指标中三项领先。",
      },
      cliffLeader: { state: "none", address: null, symbol: null, name: null, reason: "暂无" },
      categories: [],
      observedAt: "2026-09-09T01:58:00.000Z",
      eligibleUniverseCount: 12,
      rules: [],
    },
    chainHeat: {
      decisionQuestion: "is_robinhood_chain_overheated",
      modelVersion: "chain-heat-v1",
      state: "normal",
      label: "正常",
      confidence: "medium",
      divergence: false,
      intensityToBreadthRatio: 1,
      dimensions: [],
      observedAt: "2026-09-09T01:58:00.000Z",
      warning: "",
    },
    tokenHeat: {
      decisionQuestion: "which_leaders_are_overheated",
      modelVersion: "token-pressure-v1",
      rows: [],
      rules: [],
    },
    relativeValuation: {
      decisionQuestion: "which_tracked_tokens_are_expensive_or_cheap_relative_to_peers",
      modelVersion: "role-cohort-relative-v1",
      platformToken: {
        modelVersion: "fixture",
        state: "unavailable",
        pairActualPriceUsd: null,
        pairImpliedPriceUsd: null,
        rangeLowUsd: null,
        rangeHighUsd: null,
        actualDeviationPercent: null,
        confidence: "unavailable",
        observedAt: null,
        reason: "fixture",
      },
      cohorts: [],
      rules: [],
    },
    ponsForecast: {
      decisionQuestion: "where_might_pons_trade_in_7_days",
      modelVersion: "pons-regime-neighbors-v1",
      modelStatus: "shadow",
      state: "unavailable",
      horizonDays: 7,
      observedAt: null,
      currentPriceUsd: null,
      currentPriceSource: "none",
      midpointUsd: null,
      rangeLowUsd: null,
      rangeHighUsd: null,
      medianReturnPercent: null,
      positiveOutcomePercent: null,
      confidence: "unavailable",
      method: "none",
      priceObservationDays: 0,
      outcomeSampleCount: 0,
      matchedSampleCount: 0,
      backtestMedianAbsoluteErrorPercent: null,
      chainState: "normal",
      chainLabel: "正常",
      ponsActivityMultiple: null,
      drivers: [],
      pairAdjustedAnchor: {
        state: "unavailable",
        spotPonsAnchorUsd: null,
        adjustedPonsAnchorUsd: null,
        rangeLowUsd: null,
        rangeHighUsd: null,
        actualPriceUsd: null,
        actualDeviationPercent: null,
        currentConversionFactor: null,
        formula: "",
      },
      pairHolderObservation: {
        state: "unavailable",
        holderCount: null,
        previousHolderCount: null,
        changePercent: null,
        observedAt: null,
        includedInPriceModel: false,
        reason: "fixture",
      },
      rules: [],
      warning: "",
    },
    sources: [],
    warnings: [],
  };
}

const chainPayload = {
  targetDate: "2026-09-08",
  generatedAt: "2026-09-09T01:55:00.000Z",
  assessment: {
    overallState: "normal",
    headline: "活跃地址扩张，交易量仍需确认。",
    position: { label: "领先", evidence: "同行前列" },
    momentum: { label: "扩张", evidence: "7 日向上" },
    quality: { label: "分化", evidence: "用户与成交没有同步" },
    confidence: { label: "中", evidence: "核心来源可用" },
  },
  quality: { failedSources: 0 },
  stockTokens: { activeAssets: 194, estimatedValueUsd: null, coveragePercent: 0 },
  metrics: [
    {
      id: "transactions",
      label: "日交易数",
      shortLabel: "交易",
      unit: "number",
      value: 9_000_000,
      change7d: 0.12,
      change30d: null,
      dataDate: "2026-09-08",
      freshness: "ok",
      definition: "UTC 自然日交易数。",
    },
  ],
};

const cashcatPayload = {
  health: {
    status: "DEGRADED",
    daily_report: { live_evidence_status: "PARTIAL" },
    data_sources: {
      gmgn: { name: "GMGN", status: "OK", observed_at: "2026-09-09T01:59:00.000Z" },
    },
  },
  latest: {
    observed_at: "2026-09-09T01:59:00.000Z",
    collection: {
      target: {
        address: "0x020bfc650a365f8bb26819deaabf3e21291018b4",
        symbol: "CASHCAT",
        name: "Cash Cat",
        price: 0.18,
        market_cap: 180_000_000,
        liquidity: 3_000_000,
        holder_count: 100_000,
        volumes: { "5m": 10_000, "1h": 100_000, "6h": 500_000, "24h": 2_000_000 },
        liquidity_scope: { pair: "CASHCAT/SPY", venue: "Uniswap V4" },
        liquidity_crosscheck: { all_pools_liquidity_usd: 3_200_000, pool_count: 3 },
      },
      price_history_24h: {
        change_percent: 3.2,
        high: 0.19,
        low: 0.17,
        total_volume_usd: 2_000_000,
        candles: [
          { observed_at: "2026-09-09T01:00:00.000Z", close: 0.17, volume_usd: 10_000 },
          { observed_at: "2026-09-09T02:00:00.000Z", close: 0.18, volume_usd: 20_000 },
        ],
      },
    },
    analysis: {
      action: "WATCH",
      reasons: ["attention_state_weakening"],
      leader: {
        state: "CHALLENGED",
        eligible_peer_count: 10,
        dimensions: {
          market_cap: {
            state: "LOST",
            ratio: 0.5,
            rank: 2,
            target_value: 180_000_000,
            peer: { symbol: "PONS", value: 360_000_000 },
          },
          liquidity: {
            state: "LEAD",
            ratio: 1.2,
            rank: 1,
            target_value: 3_000_000,
            peer: { symbol: "PONS", value: 2_500_000 },
          },
          multi_window_volume: {
            state: "LOST",
            geometric_ratio: 0.4,
            windows: {
              "24h": {
                rank: 3,
                target_value: 2_000_000,
                peer: { symbol: "PONS", value: 5_000_000 },
              },
            },
          },
          holder_count: {
            state: "LEAD",
            ratio: 1.1,
            rank: 1,
            target_value: 100_000,
            peer: { symbol: "PONS", value: 90_000 },
          },
        },
      },
      attention: {
        state: "WEAKENING",
        chain_shares: { robinhood: { attention: 0.35, activity: 0.2 } },
        robinhood_attention_vs_baseline: 0.7,
        robinhood_activity_vs_baseline: 0.4,
        target_hot_rank: null,
      },
      narrative: {
        state: "WATCH",
        evidence: {
          founder_support: { state: "unknown" },
          mainstream_attention: { state: "unknown" },
          external_hotspot: { state: "unknown" },
        },
      },
    },
  },
};

test("product workbench keeps closed-day and live scopes distinct and translates decisions", () => {
  const result = buildProductWorkbench({
    now: new Date("2026-09-09T02:00:00.000Z"),
    chain: { payload: chainPayload, status: "ok" },
    cashcat: { payload: cashcatPayload, status: "ok" },
    intelligence: intelligenceFixture(),
  });

  assert.equal(result.status, "partial");
  assert.equal(result.chain.temporalScope, "closed_utc_day");
  assert.equal(result.chain.targetDate, "2026-09-08");
  assert.equal(result.cashcat.temporalScope, "live_snapshot");
  assert.equal(result.cashcat.decision.state, "watch");
  assert.equal(result.cashcat.decision.label, "需要观察");
  assert.deepEqual(result.cashcat.decision.reasons, [
    "Robinhood Chain 的实时注意力低于自身历史基准",
  ]);
  assert.equal(result.cashcat.leader.dimensions[0]?.leaderSymbol, "PONS");
  assert.equal(result.sources.find((source) => source.id === "cashcat_live")?.status, "degraded");
  assert.equal(result.sources.find((source) => source.id === "chain_daily")?.stale, false);
  assert.doesNotMatch(JSON.stringify(result), /attention_state_weakening|EXIT_CANDIDATE/);
});

test("product workbench detects a missing closed UTC day even when generation is recent", () => {
  const oldChain = structuredClone(chainPayload);
  oldChain.targetDate = "2026-09-07";
  const result = buildProductWorkbench({
    now: new Date("2026-09-09T02:00:00.000Z"),
    chain: { payload: oldChain, status: "ok" },
    cashcat: { payload: cashcatPayload, status: "ok" },
    intelligence: intelligenceFixture(),
  });

  const source = result.sources.find((item) => item.id === "chain_daily");
  assert.equal(source?.stale, true);
  assert.equal(source?.status, "degraded");
  assert.match(source?.note ?? "", /止于 2026-09-07.*应为 2026-09-08/);
});

test("product workbench leaves unavailable values unknown instead of filling zero", () => {
  const result = buildProductWorkbench({
    now: new Date("2026-09-09T02:00:00.000Z"),
    chain: { payload: null, status: "failed" },
    cashcat: { payload: null, status: "failed" },
    intelligence: null,
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.chain.metrics.length, 0);
  assert.equal(result.cashcat.token.priceUsd, null);
  assert.equal(result.cashcat.token.marketCapUsd, null);
  assert.equal(result.cashcat.decision.state, "unknown");
  assert.equal(
    result.sources.every((source) => source.status === "failed"),
    true,
  );
});
