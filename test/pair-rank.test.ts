import assert from "node:assert/strict";
import test from "node:test";
import { buildPairRankings, emptyPairRankings } from "../src/pair/rank.js";
import type { PairTokenSnapshot } from "../src/pair/types.js";

function snapshot(
  symbol: string,
  addressSuffix: string,
  values: Partial<PairTokenSnapshot> = {},
): PairTokenSnapshot {
  const address = `0x${addressSuffix.padStart(40, "0")}`;
  return {
    address,
    name: symbol,
    symbol,
    tokenUrl: `https://pair.fund/tokens/${address}`,
    launchedAt: "2026-09-01T00:00:00.000Z",
    graduated: true,
    observedAt: "2026-09-02T00:00:00.000Z",
    priceUsd: 0.25,
    marketCapUsd: 100,
    liquidityDepthUsd: 50,
    volume24hUsd: 25,
    holderCount: 10,
    holderObservedAt: "2026-09-02T00:00:00.000Z",
    holderSource: "gmgn.tokenInfo",
    quoteAssets: [],
    eligible: true,
    eligibilityReason: null,
    marketDataSource: "dexscreener",
    marketDataUpdatedAt: "2026-09-02T00:00:00.000Z",
    ...values,
  };
}

test("PAIR metrics rank independently with deterministic rank and value changes", () => {
  const previous = [
    snapshot("A", "1", { marketCapUsd: 300, holderCount: 10 }),
    snapshot("B", "2", { marketCapUsd: 200, holderCount: 30 }),
    snapshot("C", "3", { marketCapUsd: 100, holderCount: 20 }),
  ];
  const current = [
    snapshot("A", "1", { marketCapUsd: 150, holderCount: 40 }),
    snapshot("B", "2", {
      marketCapUsd: 250,
      holderCount: 30,
      quoteAssets: [{ address: `0x${"a".repeat(40)}`, symbol: "SPY", decimals: 18 }],
    }),
    snapshot("C", "3", { marketCapUsd: 100, holderCount: null }),
  ];

  const rankings = buildPairRankings(current, previous);
  assert.deepEqual(
    rankings.market_cap_usd.entries.map((entry) => entry.symbol),
    ["B", "A", "C"],
  );
  assert.equal(rankings.market_cap_usd.entries[0]?.previousRank, 2);
  assert.equal(rankings.market_cap_usd.entries[0]?.rankChange, 1);
  assert.equal(rankings.market_cap_usd.entries[0]?.valueChangePercent, 25);
  assert.equal(rankings.market_cap_usd.entries[0]?.priceUsd, 0.25);
  assert.equal(rankings.market_cap_usd.entries[0]?.quoteAssets?.[0]?.symbol, "SPY");
  assert.deepEqual(
    rankings.holder_count.entries.map((entry) => entry.symbol),
    ["A", "B"],
  );
  assert.equal(rankings.holder_count.entries[0]?.previousRank, 3);
  assert.equal(rankings.holder_count.entries[0]?.observedAt, "2026-09-02T00:00:00.000Z");
});

test("PAIR rankings keep explicit zero, exclude missing and ineligible values, and cap Top 5", () => {
  const current = Array.from({ length: 8 }, (_, index) =>
    snapshot(`T${String(index)}`, String(index + 1), {
      volume24hUsd: index === 0 ? 0 : index * 10,
      holderCount: index === 1 ? null : index,
      eligible: index !== 2,
    }),
  );
  const rankings = buildPairRankings(current);

  assert.equal(rankings.volume_24h_usd.entries.length, 5);
  assert.equal(rankings.volume_24h_usd.observedCount, 7);
  assert.equal(rankings.holder_count.observedCount, 6);
  assert.ok(rankings.volume_24h_usd.entries.every((entry) => entry.previousRank === null));
});

test("empty PAIR ranking contract contains every metric", () => {
  const rankings = emptyPairRankings();
  assert.deepEqual(Object.keys(rankings), [
    "market_cap_usd",
    "liquidity_depth_usd",
    "volume_24h_usd",
    "holder_count",
  ]);
  assert.equal(rankings.holder_count.unit, "count");
  assert.deepEqual(rankings.market_cap_usd.entries, []);
});
