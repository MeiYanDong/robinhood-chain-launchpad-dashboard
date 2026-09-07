import assert from "node:assert/strict";
import test from "node:test";
import { percentileRanks, scorePairV2Candidate } from "../src/pair-v2/model.js";
import type {
  PairV2HistoricalSnapshot,
  PairV2Launch,
  PairV2MarketToken,
  PairV2ScoringCandidate,
} from "../src/pair-v2/types.js";

const NOW = new Date("2026-09-05T08:00:00.000Z");

function token(overrides: Partial<PairV2MarketToken> = {}): PairV2MarketToken {
  return {
    address: "0x1111111111111111111111111111111111115555",
    name: "Candidate",
    symbol: "ALPHA",
    creator: "0x2222222222222222222222222222222222222222",
    launchedAt: "2026-09-05T01:00:00.000Z",
    priceUsd: 0.00001,
    marketCapUsd: 100_000,
    liquidityUsd: 25_000,
    volume24hUsd: 80_000,
    holderCount: 250,
    holderObservedAt: "2026-09-05T07:59:00.000Z",
    marketDataUpdatedAt: "2026-09-05T07:59:00.000Z",
    hidden: false,
    flagged: false,
    pools: [
      {
        positionId: "7",
        poolId: `0x${"a".repeat(64)}`,
        quote: {
          address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          symbol: "SPY",
          decimals: 18,
        },
      },
    ],
    profile: {
      descriptionPresent: true,
      websiteUrl: "https://alpha.example",
      twitterUrl: "https://x.com/alpha",
      telegramUrl: null,
      metadataUri: null,
    },
    shortWindow: {
      observedAt: "2026-09-05T07:59:00.000Z",
      source: "dexscreener",
      pairCount: 1,
      volume5mUsd: 10_000,
      volume1hUsd: 40_000,
      volume6hUsd: 60_000,
      volume24hUsd: 80_000,
      buys5m: 20,
      sells5m: 4,
      buys1h: 80,
      sells1h: 25,
      priceChange1hPct: 12,
      priceChange6hPct: 24,
      priceChange24hPct: 30,
    },
    ...overrides,
  };
}

function launch(overrides: Partial<PairV2Launch> = {}): PairV2Launch {
  return {
    eventId: "4663:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:1",
    releaseId: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    project: "0x1111111111111111111111111111111111115555",
    creator: "0x2222222222222222222222222222222222222222",
    vault: "0x3333333333333333333333333333333333333333",
    handler: "0x4444444444444444444444444444444444444444",
    modeId: 2,
    modeVersion: 5,
    salt: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    blockNumber: 100,
    transactionHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    logIndex: 1,
    timestamp: "2026-09-05T01:00:00.000Z",
    ...overrides,
  };
}

function previous(overrides: Partial<PairV2HistoricalSnapshot> = {}): PairV2HistoricalSnapshot {
  return {
    observedAt: "2026-09-05T07:45:00.000Z",
    priceUsd: 0.000008,
    marketCapUsd: 70_000,
    liquidityUsd: 20_000,
    volume24hUsd: 50_000,
    holderCount: 180,
    ...overrides,
  };
}

function candidate(overrides: Partial<PairV2ScoringCandidate> = {}): PairV2ScoringCandidate {
  return {
    token: token(),
    launch: launch(),
    previous: previous(),
    previous5m: previous({
      observedAt: "2026-09-05T07:55:00.000Z",
      marketCapUsd: 90_000,
      liquidityUsd: 23_000,
      holderCount: 235,
    }),
    previous15m: previous(),
    volumePercentile: 95,
    turnoverPercentile: 92,
    volume5mPercentile: 97,
    volume1hPercentile: 95,
    holderPercentile: 90,
    buyActivityPercentile: 96,
    unverifiedProductionGraph: false,
    now: NOW,
    ...overrides,
  };
}

test("PAIR V2 model confirms a high-quality, persistent signal only with complete evidence", () => {
  const result = scorePairV2Candidate(candidate());
  assert.equal(result.quality.state, "qualified");
  assert.equal(result.signal.state, "confirmed");
  assert.equal(result.signal.researchEligible, true);
  assert.equal(result.riskProfile.token, "low");
  assert.equal(result.evidence.confidence, "high");
  assert.equal(result.riskProfile.tradeReady, false);
  assert.equal(result.action?.state, "confirmed");
  assert.ok(result.discoveryScore >= 70);
  assert.ok((result.confirmationScore ?? 0) >= 65);
});

test("PAIR V2 model keeps discovery, confirmation, heat, risk, and confidence separate", () => {
  const result = scorePairV2Candidate(
    candidate({
      previous: null,
      previous5m: null,
      previous15m: null,
      unverifiedProductionGraph: true,
      token: token({
        liquidityUsd: null,
        holderCount: null,
        holderObservedAt: null,
      }),
    }),
  );
  assert.ok(result.discoveryScore > 0);
  assert.equal(result.confirmationScore, null);
  assert.equal(result.riskProfile.platform, "high");
  assert.equal(result.riskProfile.token, "high");
  assert.equal(result.evidence.confidence, "medium");
  assert.notEqual(result.signal.state, "confirmed");
  assert.ok(result.signal.missing.includes("15m 市值基线"));
});

test("non-canonical, hidden, or flagged tokens are rejected by hard gates", () => {
  assert.equal(scorePairV2Candidate(candidate({ launch: null })).stage, "rejected");
  assert.equal(
    scorePairV2Candidate(candidate({ token: token({ hidden: true }) })).stage,
    "rejected",
  );
  assert.equal(
    scorePairV2Candidate(candidate({ token: token({ flagged: true }) })).risk,
    "critical",
  );
});

test("stale market data raises risk without fabricating missing values as zero", () => {
  const result = scorePairV2Candidate(
    candidate({ token: token({ marketDataUpdatedAt: "2026-09-05T05:00:00.000Z" }) }),
  );
  assert.equal(result.risk, "high");
  assert.ok(result.risks.some((risk) => risk.includes("市场数据")));
});

test("time-reversed history is not used as confirmation evidence", () => {
  const result = scorePairV2Candidate(
    candidate({
      previous: previous({ observedAt: "2026-09-05T09:00:00.000Z" }),
      previous5m: previous({ observedAt: "2026-09-05T09:00:00.000Z" }),
      previous15m: previous({ observedAt: "2026-09-05T09:00:00.000Z" }),
    }),
  );
  assert.equal(result.confirmationScore, null);
  assert.ok(result.signal.missing.includes("15m 市值基线"));
});

test("overheated candidates are blocked even when quality and momentum are high", () => {
  const result = scorePairV2Candidate(
    candidate({
      token: token({
        liquidityUsd: 1_500,
        shortWindow: {
          ...token().shortWindow,
          observedAt: "2026-09-05T07:59:00.000Z",
          source: "dexscreener",
          pairCount: 1,
          volume5mUsd: 35_000,
          volume1hUsd: 45_000,
          volume24hUsd: 90_000,
          buys5m: 60,
          sells5m: 5,
          buys1h: 120,
          sells1h: 20,
          priceChange1hPct: 65,
          volume6hUsd: 70_000,
          priceChange6hPct: 90,
          priceChange24hPct: 120,
        },
      }),
    }),
  );
  assert.equal(result.heat.state, "overheated");
  assert.equal(result.signal.researchEligible, false);
  assert.equal(result.action?.state, "no_chase");
});

test("official V1 identity is eligible for observation while an explosive move is no-chase", () => {
  const result = scorePairV2Candidate(
    candidate({
      launch: null,
      identityEvidence: "pair_official_api",
      requireCurrentRelease: false,
      token: token({
        launchVersion: "v1",
        marketVersion: "v4-multi",
        shortWindow: {
          ...token().shortWindow,
          observedAt: "2026-09-05T07:59:00.000Z",
          source: "dexscreener",
          pairCount: 3,
          volume5mUsd: 7_000,
          volume1hUsd: 170_000,
          volume6hUsd: 1_600_000,
          volume24hUsd: 3_200_000,
          buys5m: 16,
          sells5m: 25,
          buys1h: 394,
          sells1h: 352,
          priceChange1hPct: 5,
          priceChange6hPct: 101,
          priceChange24hPct: 32_000,
        },
      }),
    }),
  );
  assert.notEqual(result.signal.state, "rejected");
  assert.equal(result.riskProfile.token, "medium");
  assert.equal(result.action?.state, "no_chase");
  assert.equal(result.action?.informationalOnly, true);
});

test("outlier growth remains bounded and cannot push a score over 100", () => {
  const result = scorePairV2Candidate(
    candidate({
      token: token({ marketCapUsd: 100_000_000, holderCount: 10_000_000 }),
      previous: previous({ marketCapUsd: 1, holderCount: 1 }),
      volumePercentile: 100,
      turnoverPercentile: 100,
    }),
  );
  assert.ok(result.discoveryScore <= 100);
  assert.ok((result.confirmationScore ?? 0) <= 100);
  assert.ok(result.heatScore <= 100);
});

test("percentile ranks are deterministic for ties, missing values, and one-item cohorts", () => {
  assert.deepEqual(percentileRanks([10, 20, 20, null, 40]), [0, 50, 50, null, 100]);
  assert.deepEqual(percentileRanks([7]), [50]);
  assert.deepEqual(percentileRanks([null, null]), [null, null]);
});
