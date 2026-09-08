import assert from "node:assert/strict";
import test from "node:test";
import type { EconomicsResponse, TokenDailyCandle } from "../src/economics/types.js";
import { buildPonsPriceForecast } from "../src/intelligence/pons-forecast.js";
import type { ChainHeatModel } from "../src/intelligence/types.js";
import type { PairLeaderboardResponse } from "../src/pair/types.js";
import type { PlatformActivityResponse } from "../src/platform-activity/types.js";

const PONS = "0x39dbed3a2bd333467115de45665cc57f813c4571";
const PAIR = "0x6b1d42927b1a84ec28fa88d4fc6fa7af404966be";

function date(index: number): string {
  return new Date(Date.UTC(2026, 6, 1 + index)).toISOString().slice(0, 10);
}

function candles(count: number): TokenDailyCandle[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 1.01 ** index;
    return {
      tokenAddress: PONS,
      date: date(index),
      openedAt: `${date(index)}T00:00:00.000Z`,
      openUsd: close / 1.005,
      highUsd: close * 1.02,
      lowUsd: close * 0.98,
      closeUsd: close,
      volumeUsd: 1_000_000 + index * 25_000,
      amountTokens: 1_000_000,
      state: "closed",
      observedAt: "2026-09-01T00:00:00.000Z",
      source: "gmgn.tokenKline",
      quality: "third_party",
    };
  });
}

function chainPayload(count: number): unknown {
  const metric = (id: string, growth: number) => ({
    id,
    series: Array.from({ length: count }, (_, index) => ({
      date: date(index),
      value: 1_000 * (1 + growth) ** index,
    })),
  });
  return {
    metrics: [
      metric("transactions", 0.01),
      metric("active_addresses", 0.009),
      metric("stablecoin_supply", 0.004),
      metric("tvs", 0.005),
      metric("dex_volume", 0.012),
      metric("protocol_fees", 0.011),
      metric("protocol_revenue", 0.01),
    ],
  };
}

function economics(): EconomicsResponse {
  return {
    tokens: [
      {
        platformId: "pons",
        address: PONS,
        priceUsd: { value: 2, asOf: "2026-09-01T00:00:00.000Z" },
      },
    ],
    pairRelativeValuation: {
      state: "available",
      estimateUsd: 0.02,
      actualPriceUsd: 0.018,
      inputs: {
        ponsPriceUsd: { value: 2 },
        ponsEffectiveSupply: { value: 1_000 },
        pairEffectiveSupply: { value: 1_000 },
        ponsPlatformVolumeUsd: { value: 100 },
        pairPlatformVolumeUsd: { value: 1 },
      },
    },
  } as unknown as EconomicsResponse;
}

function pair(): PairLeaderboardResponse {
  return {
    rankings: {
      holder_count: {
        entries: [
          {
            address: PAIR,
            value: 10_100,
            previousValue: 10_000,
            valueChangePercent: 1,
            observedAt: "2026-09-01T00:00:00.000Z",
          },
        ],
      },
    },
  } as unknown as PairLeaderboardResponse;
}

function platformActivity(count: number): PlatformActivityResponse {
  return {
    stale: false,
    platforms: [
      {
        platformId: "pons",
        daily: Array.from({ length: count }, (_, index) => ({
          date: date(index),
          state: "observed",
          valueUsd: 1_000_000 * 1.015 ** index,
        })),
        activity: {
          "7d": { latestAvailable: { multiple: 2.4 } },
        },
      },
    ],
  } as unknown as PlatformActivityResponse;
}

const chainHeat = {
  state: "warming",
  label: "升温",
} as ChainHeatModel;

test("PONS forecast uses independent matched regimes and produces a separate PAIR adjusted anchor", () => {
  const historyDays = 140;
  const result = buildPonsPriceForecast({
    now: new Date("2026-12-01T00:00:00.000Z"),
    chainPayload: chainPayload(historyDays),
    chainUsable: true,
    chainHeat,
    economics: economics(),
    pair: pair(),
    platformActivity: platformActivity(historyDays),
    ponsCandles: candles(historyDays),
  });

  assert.equal(result.state, "available");
  assert.equal(result.method, "matched_regime_neighbors");
  assert.ok(result.matchedSampleCount >= 8);
  assert.ok((result.midpointUsd ?? 0) > 2);
  assert.equal(result.positiveOutcomePercent, 100);
  assert.ok(
    Math.abs(
      (result.pairAdjustedAnchor.adjustedPonsAnchorUsd ?? 0) - (result.midpointUsd ?? 0) * 0.01,
    ) < 1e-12,
  );
  assert.equal(result.pairHolderObservation.holderCount, 10_100);
  assert.equal(result.pairHolderObservation.includedInPriceModel, false);
});

test("PONS forecast fails closed when live price or complete outcomes are missing", () => {
  const noPrice = economics();
  const token = noPrice.tokens[0];
  if (token) token.priceUsd.value = null;
  const result = buildPonsPriceForecast({
    now: new Date("2026-09-01T00:00:00.000Z"),
    chainPayload: null,
    chainUsable: false,
    chainHeat: { ...chainHeat, state: "unknown", label: "未知" },
    economics: noPrice,
    pair: pair(),
    platformActivity: null,
    ponsCandles: candles(6),
  });

  assert.equal(result.state, "unavailable");
  assert.equal(result.midpointUsd, null);
  assert.equal(result.pairAdjustedAnchor.state, "unavailable");
});

test("an unvalidated fallback keeps the current price inside its historical range", () => {
  const result = buildPonsPriceForecast({
    now: new Date("2026-09-01T00:00:00.000Z"),
    chainPayload: chainPayload(60),
    chainUsable: true,
    chainHeat,
    economics: economics(),
    pair: pair(),
    platformActivity: platformActivity(60),
    ponsCandles: candles(60),
  });

  assert.equal(result.method, "empirical_price_history");
  assert.equal(result.midpointUsd, 2);
  assert.ok((result.rangeLowUsd ?? Number.POSITIVE_INFINITY) <= (result.midpointUsd ?? 0));
  assert.ok((result.rangeHighUsd ?? 0) >= (result.midpointUsd ?? Number.POSITIVE_INFINITY));
});
