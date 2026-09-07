import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { DailyMetric, MetricName } from "../src/domain/types.js";
import { EconomicsCollector } from "../src/economics/collector.js";
import { DEFAULT_ECONOMICS_SETTINGS } from "../src/economics/config.js";
import { EconomicsDatabase } from "../src/economics/database.js";
import { EconomicsService } from "../src/economics/service.js";
import type { EconomicsCollectionBatch } from "../src/economics/types.js";
import type { LongLeaderboardResponse } from "../src/long-tokens/types.js";
import { buildPairRankings } from "../src/pair/rank.js";
import type { PairLeaderboardResponse, PairTokenSnapshot } from "../src/pair/types.js";

const settings = { ...DEFAULT_ECONOMICS_SETTINGS };
const pairAddress = settings.pairTokenAddress;
const longAddress = "0x2e8c31162b855a2ffa90f6f8634643ad6f111e18";

function metric(
  platformId: "pons" | "long" | "pair",
  name: MetricName,
  date: string,
  value: number,
): DailyMetric {
  const source =
    platformId === "pons"
      ? `pons.officialAnalytics.${name}`
      : platformId === "long"
        ? `long.officialGraphql.${name}`
        : `pair.officialStats.${name}`;
  return {
    platformId,
    metric: name,
    date,
    value,
    source,
    quality: "reported",
    scope: `${platformId} closed UTC day`,
    derivation: null,
    collectedAt: `${date}T01:00:00.000Z`,
  };
}

function allMetrics(date: string): DailyMetric[] {
  return [
    metric("pons", "volume_usd", date, 60),
    metric("long", "volume_usd", date, 30),
    metric("pair", "volume_usd", date, 10),
    metric("pons", "fees_usd", date, 8),
    metric("long", "fees_usd", date, 3),
    metric("pair", "fees_usd", date, 2),
    metric("pons", "protocol_revenue_usd", date, 4),
    metric("long", "protocol_revenue_usd", date, 1),
    metric("pair", "protocol_revenue_usd", date, 1),
  ];
}

function tokenSnapshot(input: {
  address: string;
  name: string;
  symbol: string;
  priceUsd: number;
  marketCapUsd: number;
  liquidityDepthUsd: number;
  volume24hUsd: number;
  holderCount: number;
  observedAt: string;
  tokenUrl: string;
}): PairTokenSnapshot {
  return {
    ...input,
    launchedAt: "2026-09-01T00:00:00.000Z",
    graduated: true,
    holderObservedAt: input.observedAt,
    holderSource: "gmgn.tokenInfo",
    eligible: true,
    eligibilityReason: null,
    marketDataSource: "gmgn.marketRank",
    marketDataUpdatedAt: input.observedAt,
  };
}

function pairLeaderboard(observedAt: string): PairLeaderboardResponse {
  const rankings = buildPairRankings([
    tokenSnapshot({
      address: pairAddress,
      name: "PAIR",
      symbol: "PAIR",
      priceUsd: 0.1,
      marketCapUsd: 100,
      liquidityDepthUsd: 50,
      volume24hUsd: 25,
      holderCount: 55,
      observedAt,
      tokenUrl: settings.pairTokenUrl,
    }),
  ]);
  return {
    service: "rhc-pair-token-radar",
    mode: "live",
    generatedAt: observedAt,
    reportDate: null,
    windowStart: null,
    cutoffAt: null,
    snapshot: null,
    eligibility: {
      marketCapFloorUsd: 0,
      liquidityDepthFloorUsd: 0,
      marketFreshnessMinutes: 60,
    },
    rankings,
    sources: [],
    warnings: [],
  };
}

function longLeaderboard(observedAt: string): LongLeaderboardResponse {
  const rankings = buildPairRankings([
    tokenSnapshot({
      address: longAddress,
      name: "Artificial Inu",
      symbol: "AI",
      priceUsd: 0.3,
      marketCapUsd: 300,
      liquidityDepthUsd: 120,
      volume24hUsd: 90,
      holderCount: 33,
      observedAt,
      tokenUrl: `https://app.long.xyz/tokens/${longAddress}`,
    }),
  ]);
  return {
    service: "rhc-long-token-radar",
    mode: "live",
    generatedAt: observedAt,
    reportDate: null,
    windowStart: null,
    cutoffAt: null,
    snapshot: null,
    eligibility: {
      marketCapFloorUsd: 0,
      liquidityDepthFloorUsd: 0,
      marketFreshnessMinutes: 60,
    },
    rankings,
    sources: [],
    warnings: [],
  };
}

function economicsBatch(observedAt: string): EconomicsCollectionBatch {
  return {
    observedAt,
    tokenMarkets: [
      {
        platformId: "pons",
        address: settings.ponsTokenAddress,
        name: "Pons",
        symbol: "PONS",
        tokenUrl: settings.ponsTokenUrl,
        observedAt,
        priceUsd: 0.2,
        marketCapUsd: 180,
        liquidityUsd: 50,
        volume24hUsd: 40,
        holderCount: 44,
        source: "gmgn.ponsTokenInfo",
        quality: "derived",
      },
      {
        platformId: "pair",
        address: settings.pairTokenAddress,
        name: "PAIR",
        symbol: "PAIR",
        tokenUrl: settings.pairTokenUrl,
        observedAt,
        priceUsd: 0.1,
        marketCapUsd: 100,
        liquidityUsd: 50,
        volume24hUsd: 25,
        holderCount: null,
        source: "pair.officialTokenApi",
        quality: "official",
      },
    ],
    tokenSupplies: [
      {
        address: settings.ponsTokenAddress,
        decimals: 18,
        totalSupply: 1_000,
        burnedSupply: 100,
        observedAt,
        blockNumber: "0x1",
      },
      {
        address: settings.pairTokenAddress,
        decimals: 18,
        totalSupply: 1_000,
        burnedSupply: 200,
        observedAt,
        blockNumber: "0x1",
      },
    ],
    sourceHealth: [
      {
        source: "pair.officialTokenApi",
        label: "PAIR 官方代币 API",
        status: "ok",
        fetchedAt: observedAt,
        message: "数据可用。",
        url: settings.pairTokenApiUrl,
      },
      {
        source: "gmgn.ponsTokenInfo",
        label: "GMGN PONS 市场数据",
        status: "ok",
        fetchedAt: observedAt,
        message: "数据可用。",
        url: settings.ponsTokenUrl,
      },
      {
        source: "robinhood.rpc.tokenSupply",
        label: "Robinhood Chain 链上供应量",
        status: "ok",
        fetchedAt: observedAt,
        message: "数据可用。",
        url: settings.rpcUrl,
      },
    ],
    warnings: [],
  };
}

async function withService(
  initialMetrics: DailyMetric[],
  run: (context: {
    service: EconomicsService;
    database: EconomicsDatabase;
    setNow(value: string): void;
    setMetrics(value: DailyMetric[]): void;
    refreshCounts: { dashboard: number; pair: number; long: number };
  }) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "economics-service-"));
  const database = new EconomicsDatabase(join(directory, "test.sqlite"));
  let now = new Date("2026-09-03T01:00:00.000Z");
  let metrics = initialMetrics;
  const refreshCounts = { dashboard: 0, pair: 0, long: 0 };
  const dashboard = {
    metricsForPlatforms: () => metrics,
    refresh: async () => {
      refreshCounts.dashboard += 1;
    },
  };
  const pair = {
    rankings: () => pairLeaderboard(now.toISOString()),
    refresh: async () => {
      refreshCounts.pair += 1;
    },
  };
  const long = {
    rankings: () => longLeaderboard(now.toISOString()),
    refresh: async () => {
      refreshCounts.long += 1;
    },
  };
  const unusedCollector = new EconomicsCollector(settings, {
    fetchPairToken: async () => {
      throw new Error("unused");
    },
    fetchPonsToken: async () => {
      throw new Error("unused");
    },
    fetchTokenSupplies: async () => {
      throw new Error("unused");
    },
  });
  const service = new EconomicsService(
    database,
    settings,
    { dashboard, pair, long },
    unusedCollector,
    {
      now: () => now,
      collect: async () => economicsBatch(now.toISOString()),
      warn: () => undefined,
    },
  );

  try {
    await run({
      service,
      database,
      setNow(value) {
        now = new Date(value);
      },
      setMetrics(value) {
        metrics = value;
      },
      refreshCounts,
    });
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("economics service separates value, platform flow, policy, execution, and profit", async () => {
  await withService(allMetrics("2026-09-02"), async ({ service, database, refreshCounts }) => {
    assert.equal(database.latest(), null);
    const response = await service.refreshAll();

    assert.equal(response.status, "success");
    assert.equal(response.targetDate, "2026-09-02");
    assert.equal(response.shareReady, true);
    assert.equal(response.shareDenominatorUsd, 100);
    assert.deepEqual(
      response.platforms.map((platform) => platform.threePlatformSharePercent.value),
      [60, 30, 10],
    );
    assert.deepEqual(refreshCounts, { dashboard: 1, pair: 1, long: 1 });

    const pons = response.platforms.find((platform) => platform.platformId === "pons");
    const long = response.platforms.find((platform) => platform.platformId === "long");
    const pair = response.platforms.find((platform) => platform.platformId === "pair");
    assert.ok(pons && long && pair);
    assert.equal(pons.policyBuybackBudgetUsd.value, 3.2);
    assert.equal(pons.executedBuybackUsd.state, "unknown");
    assert.equal(pair.policyBuybackBudgetUsd.value, 0.9);
    assert.equal(pair.protocolRevenueReceivedUsd.state, "unknown");
    assert.equal(long.executedBuybackUsd.state, "not_applicable");
    assert.equal(long.buybackPolicy.applies, false);
    assert.equal(pair.netProfitUsd.state, "unknown");

    const ponsToken = response.tokens.find((token) => token.platformId === "pons");
    const longToken = response.tokens.find((token) => token.platformId === "long");
    const pairToken = response.tokens.find((token) => token.platformId === "pair");
    assert.ok(ponsToken && longToken && pairToken);
    assert.equal(ponsToken.priceUsd.value, 0.2);
    assert.equal(ponsToken.marketCapUsd.value, 180);
    assert.equal(ponsToken.burnAdjustedMarketCapUsd.value, 180);
    assert.equal(ponsToken.burnedPercent.value, 10);
    assert.equal(longToken.symbol, "AI");
    assert.equal(longToken.priceUsd.value, 0.3);
    assert.equal(longToken.role, "dynamic_market_cap_leader");
    assert.equal(pairToken.priceUsd.value, 0.1);
    assert.equal(pairToken.holderCount.value, 55);
    assert.equal(pairToken.burnAdjustedMarketCapUsd.value, 80);

    assert.equal(
      response.buybacks.find((row) => row.platformId === "pons")?.proofStatus,
      "policy_and_cumulative_burn_only",
    );
    assert.equal(
      response.buybacks.find((row) => row.platformId === "long")?.proofStatus,
      "not_applicable",
    );
    assert.equal(database.latest()?.payload.service, "rhc-launchpad-economics");
    assert.equal(response.pairRelativeValuation.state, "unavailable");
    assert.equal(response.pairRelativeValuation.commonDayCount, 1);
    assert.equal(database.valuationHistory().length, 1);
    assert.equal(service.valuation()?.modelVersion, "pons-volume-parity-v1");
    assert.equal(service.health().ok, true);
    assert.match(service.sources().definitions.executed_buyback, /逐笔证据/);
  });
});

test("economics service calculates and persists the seven-common-day PAIR anchor", async () => {
  const metrics = [
    "2026-08-26",
    "2026-08-27",
    "2026-08-28",
    "2026-08-29",
    "2026-08-30",
    "2026-08-31",
    "2026-09-01",
  ].flatMap(allMetrics);
  await withService(metrics, async ({ service, database, setNow }) => {
    const response = await service.refresh();
    const valuation = response.pairRelativeValuation;

    assert.equal(valuation.state, "available");
    assert.equal(valuation.commonDayCount, 7);
    assert.ok(Math.abs((valuation.estimateUsd ?? 0) - 0.0375) < 1e-12);
    assert.equal(database.valuationHistory()[0]?.estimateUsd, valuation.estimateUsd);
    assert.equal(service.valuationHistory().points.length, 1);

    setNow("2026-09-03T01:31:00.000Z");
    const expiredPrice = service.snapshot();
    assert.equal(expiredPrice?.stale, false);
    assert.equal(expiredPrice?.pairRelativeValuation.state, "unavailable");
    assert.ok(
      expiredPrice?.pairRelativeValuation.reasons.some((item) => item.code === "PONS_PRICE_STALE"),
    );

    setNow("2026-09-03T02:00:00.000Z");
    const stale = service.snapshot();
    assert.equal(stale?.pairRelativeValuation.state, "unavailable");
    assert.equal(stale?.pairRelativeValuation.estimateUsd, null);
    assert.ok(
      stale?.pairRelativeValuation.reasons.some((item) => item.code === "ECONOMICS_SNAPSHOT_STALE"),
    );
  });
});

test("economics service selects the newest day shared by all three platforms", async () => {
  const metrics = [
    ...allMetrics("2026-09-01"),
    metric("pons", "volume_usd", "2026-09-02", 600),
    metric("pair", "volume_usd", "2026-09-02", 100),
  ];
  await withService(metrics, async ({ service, setNow }) => {
    const response = await service.refresh();
    assert.equal(response.targetDate, "2026-09-01");
    assert.equal(response.shareReady, true);
    assert.equal(response.status, "partial");
    assert.match(response.warnings[0] ?? "", /2026-09-01/);

    setNow("2026-09-03T02:00:00.000Z");
    const stale = service.snapshot();
    assert.equal(stale?.stale, true);
    assert.equal(stale?.status, "partial");
    assert.ok(stale?.warnings.some((warning) => warning.includes("超过预期更新时间")));
  });
});

test("economics service does not calculate share when no same-day denominator exists", async () => {
  const metrics = [
    metric("pons", "volume_usd", "2026-09-02", 60),
    metric("pair", "volume_usd", "2026-09-02", 10),
    metric("long", "volume_usd", "2026-09-01", 30),
  ];
  await withService(metrics, async ({ service }) => {
    const response = await service.refresh();
    assert.equal(response.targetDate, "2026-09-02");
    assert.equal(response.shareReady, false);
    assert.equal(response.shareDenominatorUsd, null);
    assert.ok(
      response.platforms.every(
        (platform) => platform.threePlatformSharePercent.state === "unknown",
      ),
    );
  });
});

test("suspect official zero cannot create a market share while the raw value remains inspectable", async () => {
  const metrics = allMetrics("2026-09-02");
  metrics[0] = metric("pons", "volume_usd", "2026-09-02", 0);
  metrics.push(metric("pons", "volume_usd", "2026-09-01", 919_650_702));
  await withService(metrics, async ({ service }) => {
    const snapshot = await service.refresh();
    const pons = snapshot.platforms.find((row) => row.platformId === "pons");
    assert.equal(pons?.volumeUsd.value, null);
    assert.equal(pons?.volumeUsd.rawValue, 0);
    assert.equal(pons?.volumeUsd.validation, "suspect");
    assert.equal(snapshot.shareReady, false);
    assert.equal(snapshot.dataQuality?.platformDataComplete, false);
  });
});
