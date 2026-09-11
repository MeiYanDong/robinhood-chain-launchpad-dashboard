import assert from "node:assert/strict";
import test from "node:test";
import type { DailyMetric } from "../src/domain/types.js";
import type {
  BuybackPolicy,
  EvidenceQuality,
  EvidenceValue,
  TokenEconomicsRow,
} from "../src/economics/types.js";
import {
  buildPairRelativeValuation,
  refreshPairRelativeValuationFreshness,
} from "../src/economics/valuation.js";

const NOW = new Date("2026-09-10T12:00:00.000Z");

function evidence(
  value: number | null,
  quality: EvidenceQuality,
  asOf = NOW.toISOString(),
): EvidenceValue {
  return {
    value,
    state: value === null ? "unknown" : "observed",
    quality: value === null ? "unknown" : quality,
    source: value === null ? null : "fixture",
    asOf: value === null ? null : asOf,
    note: null,
  };
}

function token(input: {
  platformId: "pons" | "pair";
  price: number | null;
  totalSupply: number | null;
  burnedSupply: number | null;
  priceAsOf?: string;
}): TokenEconomicsRow {
  const quality = input.platformId === "pons" ? "third_party" : "official";
  const unavailable = evidence(null, "unknown");
  return {
    platformId: input.platformId,
    platformName: input.platformId === "pons" ? "Pons" : "PAIR",
    role: "protocol_token",
    address: input.platformId,
    name: input.platformId,
    symbol: input.platformId.toUpperCase(),
    tokenUrl: "https://example.com",
    observedAt: input.priceAsOf ?? NOW.toISOString(),
    priceUsd: evidence(input.price, quality, input.priceAsOf),
    marketCapUsd: unavailable,
    burnAdjustedMarketCapUsd: unavailable,
    liquidityUsd: unavailable,
    volume24hUsd: unavailable,
    holderCount: unavailable,
    totalSupply: evidence(input.totalSupply, "onchain"),
    burnedSupply: evidence(input.burnedSupply, "onchain"),
    burnedPercent: unavailable,
  };
}

function volume(
  platformId: "pons" | "pair",
  date: string,
  value: number,
  collectedAt = NOW.toISOString(),
): DailyMetric {
  return {
    platformId,
    metric: "volume_usd",
    date,
    value,
    source:
      platformId === "pons" ? "pons.officialAnalytics.volume_usd" : "pair.officialStats.volume_usd",
    quality: "reported",
    scope: `${platformId} closed UTC day`,
    derivation: null,
    collectedAt,
  };
}

function policies(): { ponsPolicy: BuybackPolicy; pairPolicy: BuybackPolicy } {
  return {
    ponsPolicy: {
      applies: true,
      percentage: 80,
      basis: "fixture",
      evidence: "documented",
      sourceUrl: "https://example.com/pons",
    },
    pairPolicy: {
      applies: true,
      percentage: 90,
      basis: "fixture",
      evidence: "announced",
      sourceUrl: "https://example.com/pair",
    },
  };
}

function build(input: {
  metrics: DailyMetric[];
  ponsPrice?: number | null;
  pairPrice?: number | null;
  ponsPriceAsOf?: string;
}) {
  return buildPairRelativeValuation({
    now: NOW,
    observedAt: NOW.toISOString(),
    metrics: input.metrics,
    ponsToken: token({
      platformId: "pons",
      price: input.ponsPrice === undefined ? 2 : input.ponsPrice,
      ...(input.ponsPriceAsOf ? { priceAsOf: input.ponsPriceAsOf } : {}),
      totalSupply: 1_000,
      burnedSupply: 100,
    }),
    pairToken: token({
      platformId: "pair",
      price: input.pairPrice === undefined ? 0.6 : input.pairPrice,
      totalSupply: 1_000,
      burnedSupply: 200,
    }),
    ...policies(),
  });
}

function sevenDays(pairValues = [10, 20, 30, 40, 50, 60, 70]): DailyMetric[] {
  return pairValues.flatMap((pairValue, index) => {
    const date = `2026-09-${String(index + 2).padStart(2, "0")}`;
    return [volume("pons", date, 100), volume("pair", date, pairValue)];
  });
}

test("PAIR relative valuation makes seven days primary and keeps the latest day separate", () => {
  const result = build({ metrics: sevenDays() });

  assert.equal(result.state, "available");
  assert.equal(result.sevenDayCount, 7);
  assert.deepEqual(result.sevenDayDates, [
    "2026-09-02",
    "2026-09-03",
    "2026-09-04",
    "2026-09-05",
    "2026-09-06",
    "2026-09-07",
    "2026-09-08",
  ]);
  assert.equal(result.latestDayDate, "2026-09-08");
  assert.equal(result.inputs.ponsLatestDayVolumeUsd.value, 100);
  assert.equal(result.inputs.pairLatestDayVolumeUsd.value, 70);
  assert.equal(result.inputs.ponsSevenDayVolumeUsd.value, 700);
  assert.equal(result.inputs.pairSevenDayVolumeUsd.value, 280);
  assert.equal(result.inputs.ponsEffectiveSupply.value, 900);
  assert.equal(result.inputs.pairEffectiveSupply.value, 800);
  assert.equal(result.sevenDayReferenceUsd, 0.9);
  assert.ok(Math.abs((result.latestDayReferenceUsd ?? 0) - 1.575) < 1e-12);
  assert.equal(result.dailyReferenceRangeLowUsd, 0.5625);
  assert.ok(Math.abs((result.dailyReferenceRangeHighUsd ?? 0) - 1.2375) < 1e-12);
  assert.ok(Math.abs((result.actualVsSevenDayPercent ?? 0) - -33.33333333333333) < 1e-10);
  assert.ok(Math.abs((result.actualVsLatestDayPercent ?? 0) - -61.904761904761905) < 1e-10);
  assert.ok(Math.abs((result.policyScenario.sevenDayReferenceUsd ?? 0) - 1.0125) < 1e-12);
  assert.ok(Math.abs((result.policyScenario.latestDayReferenceUsd ?? 0) - 1.771875) < 1e-12);
  assert.equal(result.confidence, "low");
});

test("benchmark price scales the estimate while PAIR actual price only changes deviation", () => {
  const metrics = sevenDays();
  const base = build({ metrics, ponsPrice: 2, pairPrice: 0.6 });
  const benchmarkDoubled = build({ metrics, ponsPrice: 4, pairPrice: 0.6 });
  const actualDoubled = build({ metrics, ponsPrice: 2, pairPrice: 1.2 });

  assert.equal(benchmarkDoubled.sevenDayReferenceUsd, (base.sevenDayReferenceUsd ?? 0) * 2);
  assert.equal(actualDoubled.sevenDayReferenceUsd, base.sevenDayReferenceUsd);
  assert.equal(actualDoubled.latestDayReferenceUsd, base.latestDayReferenceUsd);
  assert.notEqual(actualDoubled.actualVsSevenDayPercent, base.actualVsSevenDayPercent);
});

test("missing common dates and stale PONS prices fail closed instead of becoming zero", () => {
  const noCommonDay = build({
    metrics: [volume("pons", "2026-09-02", 100), volume("pair", "2026-09-03", 10)],
  });
  assert.equal(noCommonDay.sevenDayCount, 0);
  assert.equal(noCommonDay.state, "unavailable");
  assert.equal(noCommonDay.sevenDayReferenceUsd, null);
  assert.equal(noCommonDay.latestDayReferenceUsd, null);
  assert.ok(noCommonDay.reasons.some((item) => item.code === "INSUFFICIENT_COMMON_DAYS"));

  const stale = build({
    metrics: sevenDays(),
    ponsPriceAsOf: "2026-09-10T11:29:59.000Z",
  });
  assert.equal(stale.state, "unavailable");
  assert.equal(stale.sevenDayReferenceUsd, null);
  assert.equal(stale.latestDayReferenceUsd, null);
  assert.ok(stale.reasons.some((item) => item.code === "PONS_PRICE_STALE"));
});

test("fewer than seven common days can show a latest-day signal but cannot become the primary", () => {
  const result = build({
    metrics: [volume("pons", "2026-09-08", 100), volume("pair", "2026-09-08", 10)],
  });

  assert.equal(result.state, "unavailable");
  assert.equal(result.sevenDayCount, 1);
  assert.equal(result.sevenDayReferenceUsd, null);
  assert.equal(result.latestDayReferenceUsd, 0.225);
  assert.equal(result.actualVsSevenDayPercent, null);
  assert.ok(result.reasons.some((item) => item.code === "INSUFFICIENT_COMMON_DAYS"));
});

test("a recorded zero is retained and a one-day outlier does not define the quartile band", () => {
  const zero = build({ metrics: sevenDays([0, 0, 0, 0, 0, 0, 0]) });
  assert.equal(zero.state, "available");
  assert.equal(zero.sevenDayReferenceUsd, 0);
  assert.equal(zero.latestDayReferenceUsd, 0);
  assert.ok(zero.reasons.some((item) => item.code === "PAIR_ESTIMATE_ZERO"));

  const outlier = build({ metrics: sevenDays([10, 10, 10, 10, 10, 10, 10_000]) });
  assert.ok((outlier.sevenDayReferenceUsd ?? 0) > 10);
  assert.ok((outlier.latestDayReferenceUsd ?? 0) > 100);
  assert.ok((outlier.dailyReferenceRangeHighUsd ?? Number.POSITIVE_INFINITY) < 1);
});

test("a sharp platform-volume decline changes the latest-day signal without replacing the primary", () => {
  const decline = build({ metrics: sevenDays([100, 80, 60, 40, 20, 10, 1]) });

  assert.ok((decline.latestDayReferenceUsd ?? Number.POSITIVE_INFINITY) < 0.03);
  assert.ok((decline.sevenDayReferenceUsd ?? 0) > 0.9);
  assert.ok((decline.latestDayVsSevenDayPercent ?? 0) < -95);
});

test("duplicate daily observations resolve to the newest collected value", () => {
  const metrics = sevenDays();
  metrics.push(
    volume("pair", "2026-09-08", 7_000, "2026-09-10T12:01:00.000Z"),
    volume("pair", "2026-09-08", 7, "2026-09-10T12:02:00.000Z"),
  );
  const result = build({ metrics });

  assert.equal(result.inputs.pairLatestDayVolumeUsd.value, 7);
  assert.equal(result.inputs.pairSevenDayVolumeUsd.value, 217);
  assert.ok((result.latestDayReferenceUsd ?? Number.POSITIVE_INFINITY) < 1);
});

test("cached valuation expires at the declared PONS price freshness boundary", () => {
  const result = build({ metrics: sevenDays() });
  const atBoundary = refreshPairRelativeValuationFreshness(
    result,
    new Date("2026-09-10T12:30:00.000Z"),
  );
  const afterBoundary = refreshPairRelativeValuationFreshness(
    result,
    new Date("2026-09-10T12:30:00.001Z"),
  );

  assert.equal(atBoundary.state, "available");
  assert.equal(afterBoundary.state, "unavailable");
  assert.equal(afterBoundary.sevenDayReferenceUsd, null);
  assert.equal(afterBoundary.latestDayReferenceUsd, null);
  assert.ok(afterBoundary.reasons.some((item) => item.code === "PONS_PRICE_STALE"));
});
