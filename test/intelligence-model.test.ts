import assert from "node:assert/strict";
import test from "node:test";
import type { EconomicsResponse } from "../src/economics/types.js";
import { buildIntelligence } from "../src/intelligence/model.js";
import type { LongLeaderboardResponse } from "../src/long-tokens/types.js";
import type {
  PairLeaderboardResponse,
  PairRankingEntry,
  PairTokenMetricName,
} from "../src/pair/types.js";

const PONS = "0x39dbed3a2bd333467115de45665cc57f813c4571";
const CASHCAT = "0x020bfc650a365f8bb26819deaabf3e21291018b4";
const AI = "0x2e8c31162b855a2ffa90f6f8634643ad6f111e18";
const PAIR = "0x6b1d42927b1a84ec28fa88d4fc6fa7af404966be";

function row(rank: number, address: string, symbol: string, value: number) {
  return { rank, address, symbol, name: symbol, value, is_target: address === CASHCAT };
}

function cashcatPayload(cliff = false): unknown {
  const market = [
    row(1, PONS, "PONS", 600),
    row(2, CASHCAT, "CASHCAT", 250),
    row(3, AI, "AI", 200),
  ];
  const liquidity = cliff
    ? [row(1, PONS, "PONS", 12), row(2, CASHCAT, "CASHCAT", 5), row(3, AI, "AI", 3)]
    : [row(1, AI, "AI", 8), row(2, PONS, "PONS", 6), row(3, CASHCAT, "CASHCAT", 5)];
  const holders = cliff
    ? [row(1, PONS, "PONS", 200), row(2, CASHCAT, "CASHCAT", 100), row(3, AI, "AI", 50)]
    : [row(1, CASHCAT, "CASHCAT", 100), row(2, PONS, "PONS", 70), row(3, AI, "AI", 50)];
  const volume = {
    "5m": cliff
      ? [row(1, PONS, "PONS", 3), row(2, CASHCAT, "CASHCAT", 1), row(3, AI, "AI", 0.5)]
      : [row(1, CASHCAT, "CASHCAT", 1), row(2, PONS, "PONS", 0.3), row(3, AI, "AI", 0.2)],
    "1h": [row(1, PONS, "PONS", 30), row(2, CASHCAT, "CASHCAT", 10), row(3, AI, "AI", 5)],
    "6h": [row(1, PONS, "PONS", 50), row(2, CASHCAT, "CASHCAT", 20), row(3, AI, "AI", 10)],
    "24h": [row(1, PONS, "PONS", 80), row(2, CASHCAT, "CASHCAT", 50), row(3, AI, "AI", 30)],
  };
  return {
    health: {
      status: "DEGRADED",
      data_sources: { onchain: { status: "OK" }, twitter: { status: "ERROR" } },
    },
    latest: {
      observed_at: "2026-09-04T03:00:00.000Z",
      collection: {
        target: {
          address: CASHCAT,
          symbol: "CASHCAT",
          name: "Cash Cat",
          market_cap: 250,
          liquidity: 5,
          holder_count: 100,
          volumes: { "5m": 1, "1h": 10, "6h": 20, "24h": 50 },
        },
        price_history_24h: { change_percent: 8 },
      },
      analysis: {
        leader: {
          eligible_peer_count: 34,
          dimensions: {
            market_cap: { top3: market },
            liquidity: { top3: liquidity },
            holder_count: { top3: holders },
            multi_window_volume: {
              windows: Object.fromEntries(
                Object.entries(volume).map(([window, top3]) => [window, { top3 }]),
              ),
            },
          },
        },
        attention: {
          chain_shares: { robinhood: { attention: 0.62, activity: 0.49 } },
          robinhood_attention_vs_baseline: 1.5,
          robinhood_activity_vs_baseline: 1.1,
        },
      },
    },
  };
}

function chainPayload(): unknown {
  const metric = (id: string, label: string, value: number, change7d: number) => ({
    id,
    label,
    value,
    change7d,
    freshness: "ok",
    dataDate: "2026-09-02T00:00:00.000Z",
  });
  return {
    generatedAt: "2026-09-03T07:00:00.000Z",
    metrics: [
      metric("transactions", "日交易数", 11_000_000, 0.01),
      metric("active_addresses", "日活地址", 380_000, 0.06),
      metric("dex_volume", "DEX 成交量", 1_500_000_000, 0.9),
      metric("protocol_fees", "协议费用", 19_000_000, 3.2),
      metric("protocol_revenue", "协议收入", 4_300_000, 3.3),
      metric("median_tx_cost", "中位交易成本", 0.18, 22),
    ],
  };
}

function rankingEntry(
  rank: number,
  address: string,
  symbol: string,
  value: number,
): PairRankingEntry {
  return {
    rank,
    previousRank: null,
    rankChange: null,
    address,
    name: symbol,
    symbol,
    tokenUrl: `https://example.com/${address}`,
    graduated: true,
    priceUsd: value / 1_000,
    value,
    previousValue: null,
    valueChangePercent: null,
    observedAt: "2026-09-04T03:00:00.000Z",
  };
}

function radar(service: "pair" | "long"): PairLeaderboardResponse | LongLeaderboardResponse {
  const symbols =
    service === "pair" ? ["PAIR", "A", "B", "C", "D"] : ["AI", "BONER", "MOO", "L3", "L4"];
  const addresses =
    service === "pair" ? [PAIR, "0xa", "0xb", "0xc", "0xd"] : [AI, "0xe", "0xf", "0x10", "0x11"];
  const market = service === "pair" ? [500, 10, 100, 200, 300] : [300, 10, 100, 200, 400];
  const metricValues: Record<PairTokenMetricName, number[]> = {
    market_cap_usd: market,
    liquidity_depth_usd: service === "pair" ? [50, 10, 10, 20, 30] : [30, 10, 10, 20, 40],
    volume_24h_usd: service === "pair" ? [60, 10, 10, 20, 30] : [30, 10, 10, 20, 40],
    holder_count: service === "pair" ? [70, 10, 10, 20, 30] : [30, 10, 10, 20, 40],
  };
  const rankings = Object.fromEntries(
    Object.entries(metricValues).map(([metric, values]) => [
      metric,
      {
        metric,
        label: metric,
        unit: metric === "holder_count" ? "count" : "USD",
        observedCount: 5,
        entries: values.map((value, index) =>
          rankingEntry(index + 1, addresses[index] ?? "0x0", symbols[index] ?? "?", value),
        ),
      },
    ]),
  ) as PairLeaderboardResponse["rankings"];
  const common = {
    mode: "live" as const,
    generatedAt: "2026-09-04T03:00:00.000Z",
    reportDate: null,
    windowStart: null,
    cutoffAt: null,
    snapshot: {
      runId: 1,
      observedAt: "2026-09-04T03:00:00.000Z",
      status: "success" as const,
      stale: false,
      universeCount: 10,
      eligibleCount: 5,
    },
    eligibility: {
      marketCapFloorUsd: 1,
      liquidityDepthFloorUsd: 1,
      marketFreshnessMinutes: 60,
    },
    rankings,
    sources: [],
    warnings: [],
  };
  return service === "pair"
    ? ({ ...common, service: "rhc-pair-token-radar" } as PairLeaderboardResponse)
    : ({ ...common, service: "rhc-long-token-radar" } as LongLeaderboardResponse);
}

function emptyRadar(service: "pair" | "long"): PairLeaderboardResponse | LongLeaderboardResponse {
  const rankings = Object.fromEntries(
    ["market_cap_usd", "liquidity_depth_usd", "volume_24h_usd", "holder_count"].map((metric) => [
      metric,
      { metric, label: metric, unit: "USD", observedCount: 0, entries: [] },
    ]),
  );
  return {
    service: service === "pair" ? "rhc-pair-token-radar" : "rhc-long-token-radar",
    mode: "live",
    generatedAt: "2026-09-04T03:00:00.000Z",
    reportDate: null,
    windowStart: null,
    cutoffAt: null,
    snapshot: null,
    eligibility: { marketCapFloorUsd: 1, liquidityDepthFloorUsd: 1, marketFreshnessMinutes: 60 },
    rankings,
    sources: [],
    warnings: [],
  } as unknown as PairLeaderboardResponse | LongLeaderboardResponse;
}

function economics(): EconomicsResponse {
  return {
    service: "rhc-launchpad-economics",
    generatedAt: "2026-09-04T03:00:00.000Z",
    observedAt: "2026-09-04T03:00:00.000Z",
    targetDate: "2026-09-02",
    status: "success",
    stale: false,
    tokens: [{ platformId: "pair", role: "protocol_token", address: PAIR }],
    pairRelativeValuation: {
      modelVersion: "pons-volume-parity-v1",
      state: "available",
      actualPriceUsd: 0.005,
      estimateUsd: 0.01,
      rangeLowUsd: 0.009,
      rangeHighUsd: 0.011,
      actualDeviationPercent: -50,
      confidence: "low",
      observedAt: "2026-09-04T03:00:00.000Z",
      reasons: [],
    },
  } as unknown as EconomicsResponse;
}

test("intelligence keeps leader, heat, token pressure, and role valuation separate", () => {
  const result = buildIntelligence({
    now: new Date("2026-09-04T03:10:00.000Z"),
    chain: { status: "ok", payload: chainPayload() },
    cashcat: { status: "ok", payload: cashcatPayload() },
    economics: economics(),
    pair: radar("pair") as PairLeaderboardResponse,
    long: radar("long") as LongLeaderboardResponse,
  });

  assert.equal(result.status, "success");
  assert.equal(result.sources.find((source) => source.id === "cashcat")?.status, "ok");
  assert.equal(result.leader.structuralLeader.symbol, "PONS");
  assert.equal(result.leader.structuralLeader.state, "confirmed");
  assert.equal(result.leader.cliffLeader.state, "none");
  assert.equal(result.chainHeat.state, "overheated");
  assert.equal(result.chainHeat.divergence, true);
  assert.equal(result.tokenHeat.rows.find((row) => row.symbol === "PONS")?.state, "hot");
  assert.equal(result.relativeValuation.platformToken.pairImpliedPriceUsd, 0.01);
  assert.equal(
    result.relativeValuation.cohorts[0]?.rows.some((row) => row.symbol === "PAIR"),
    false,
  );
  assert.equal(
    result.relativeValuation.cohorts[0]?.rows.find((row) => row.symbol === "A")?.state,
    "relative_discount",
  );
  assert.match(result.chainHeat.warning, /不等于价格必然见顶/);
});

test("four cliff thresholds are explicit and missing sources fail closed", () => {
  const cliff = buildIntelligence({
    now: new Date("2026-09-04T03:10:00.000Z"),
    chain: { status: "ok", payload: chainPayload() },
    cashcat: { status: "ok", payload: cashcatPayload(true) },
    economics: economics(),
    pair: radar("pair") as PairLeaderboardResponse,
    long: radar("long") as LongLeaderboardResponse,
  });
  assert.equal(cliff.leader.cliffLeader.symbol, "PONS");
  assert.equal(cliff.leader.cliffLeader.state, "confirmed");

  const missing = buildIntelligence({
    now: new Date("2026-09-04T03:10:00.000Z"),
    chain: { status: "failed", payload: null },
    cashcat: { status: "failed", payload: null },
    economics: null,
    pair: emptyRadar("pair") as PairLeaderboardResponse,
    long: emptyRadar("long") as LongLeaderboardResponse,
  });
  assert.equal(missing.status, "unavailable");
  assert.equal(missing.leader.structuralLeader.state, "unknown");
  assert.equal(missing.chainHeat.state, "unknown");
  assert.equal(missing.relativeValuation.platformToken.state, "unavailable");
  assert.ok(missing.warnings.some((warning) => /当前不可用/.test(warning)));
});
