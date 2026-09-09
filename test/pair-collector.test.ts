import assert from "node:assert/strict";
import test from "node:test";
import type { FetchedJson } from "../src/utils/http.js";
import { DEFAULT_PAIR_TOKEN_SETTINGS } from "../src/pair/config.js";
import { PairTokenCollector } from "../src/pair/collector.js";
import type { PairHolderCacheEntry } from "../src/pair/types.js";

const now = new Date("2026-09-01T08:30:00.000Z");
const settings = {
  ...DEFAULT_PAIR_TOKEN_SETTINGS,
  pageLimit: 2,
  maxPages: 5,
  pageConcurrency: 2,
};

test("PAIR official pagination defaults stay within the documented API contract", () => {
  assert.equal(DEFAULT_PAIR_TOKEN_SETTINGS.pageLimit, 50);
  assert.equal(DEFAULT_PAIR_TOKEN_SETTINGS.pageConcurrency, 4);
  assert.equal(DEFAULT_PAIR_TOKEN_SETTINGS.apiTimeoutMs, 10_000);
  assert.equal(DEFAULT_PAIR_TOKEN_SETTINGS.snapshotAttempts, 3);
});

function token(addressSuffix: string, symbol: string, marketCapUsd: string, totalDepthUsd: string) {
  return {
    address: `0x${addressSuffix.padStart(40, "0")}`,
    name: `${symbol} token`,
    symbol,
    priceUsd: "0.01234567",
    marketCapUsd,
    totalDepthUsd,
    combinedVolume24hUsd: "1234.5",
    volume24hUsd: "999",
    marketDataSource: "dexscreener",
    marketDataUpdatedAt: "2026-09-01T08:25:00.000Z",
    launchedAt: 1_788_000_000,
    graduated: true,
    flagged: false,
    hidden: false,
    pairs: [
      {
        quoteToken: {
          address: `0x${"a".repeat(40)}`,
          symbol: "SPY",
          decimals: 18,
        },
      },
      {
        quoteToken: {
          address: `0x${"a".repeat(40)}`,
          symbol: "SPY duplicate",
          decimals: 18,
        },
      },
    ],
  };
}

function fetched(payload: unknown, latencyMs = 3): FetchedJson {
  return {
    payload,
    fetchedAt: "2026-09-01T08:30:01.000Z",
    latencyMs,
    sha256: "fixture",
  };
}

function pageFetcher(items: unknown[]) {
  return async (url: string): Promise<FetchedJson> => {
    const page = Number(new URL(url).searchParams.get("page"));
    const start = (page - 1) * settings.pageLimit;
    return fetched({
      items: items.slice(start, start + settings.pageLimit),
      total: items.length,
      page,
      limit: settings.pageLimit,
    });
  };
}

test("PAIR collector discovers every page, applies the active gate, and reuses fresh holders", async () => {
  const noVolume = {
    ...token("5", "NOVOL", "18000", "3000"),
    combinedVolume24hUsd: null,
    volume24hUsd: null,
  };
  const items = [
    token("1", "ONE", "25000", "5000"),
    token("2", "TWO", "15000", "2000"),
    token("3", "DUST", "9000", "5000"),
    noVolume,
    { address: "not-an-address", symbol: "BAD" },
  ];
  const holderCalls: string[] = [];
  const collector = new PairTokenCollector(settings, {
    now: () => now,
    fetchPage: pageFetcher(items),
    fetchHolder: async (address) => {
      holderCalls.push(address);
      return {
        holderCount: 222,
        observedAt: now.toISOString(),
        latencyMs: 7,
        source: "gmgn.tokenInfo",
      };
    },
  });
  const cache = new Map<string, PairHolderCacheEntry>([
    [
      `0x${"1".padStart(40, "0")}`,
      { holderCount: 111, observedAt: "2026-09-01T08:00:00.000Z", source: "gmgn.tokenInfo" },
    ],
  ]);

  const batch = await collector.collect(cache);
  assert.equal(batch.tokens.length, 4);
  assert.equal(batch.universeCount, 4);
  assert.equal(batch.eligibleCount, 3);
  assert.deepEqual(holderCalls, [`0x${"2".padStart(40, "0")}`, `0x${"5".padStart(40, "0")}`]);
  const one = batch.tokens.find((item) => item.symbol === "ONE");
  const two = batch.tokens.find((item) => item.symbol === "TWO");
  const dust = batch.tokens.find((item) => item.symbol === "DUST");
  const missingVolume = batch.tokens.find((item) => item.symbol === "NOVOL");
  assert.equal(one?.holderCount, 111);
  assert.equal(one?.priceUsd, 0.01234567);
  assert.deepEqual(one?.quoteAssets, [
    { address: `0x${"a".repeat(40)}`, symbol: "SPY", decimals: 18 },
  ]);
  assert.equal(two?.holderCount, 222);
  assert.equal(two?.volume24hUsd, 1234.5);
  assert.equal(dust?.eligible, false);
  assert.equal(dust?.eligibilityReason, "market_cap_below_floor");
  assert.equal(missingVolume?.eligible, true);
  assert.equal(missingVolume?.volume24hUsd, null);
  assert.deepEqual(batch.warnings, ["pair_invalid_tokens_skipped"]);
  assert.ok(batch.sourceHealth.every((source) => source.status === "ok"));
});

test("PAIR collector degrades holder ranking and uses bounded stale cache after a lookup failure", async () => {
  const address = `0x${"4".padStart(40, "0")}`;
  const collector = new PairTokenCollector(settings, {
    now: () => now,
    fetchPage: pageFetcher([token("4", "FOUR", "25000", "5000")]),
    fetchHolder: async () => {
      throw new Error("private upstream failure");
    },
  });
  const batch = await collector.collect(
    new Map([
      [
        address,
        {
          holderCount: 44,
          observedAt: "2026-09-01T06:45:00.000Z",
          source: "gmgn.tokenInfo",
        },
      ],
    ]),
  );

  assert.equal(batch.tokens[0]?.holderCount, 44);
  assert.equal(
    batch.sourceHealth.find((source) => source.source === "gmgn.tokenInfo")?.status,
    "degraded",
  );
  assert.deepEqual(batch.warnings, ["pair_holder_data_partial"]);
  assert.doesNotMatch(JSON.stringify(batch), /private upstream/);
});

test("PAIR collector fails closed on malformed official pagination", async () => {
  const collector = new PairTokenCollector(settings, {
    now: () => now,
    fetchPage: async () => fetched({ items: [], total: "invalid", page: 1, limit: 2 }),
    fetchHolder: async () => {
      throw new Error("should not run");
    },
  });
  await assert.rejects(collector.collect(new Map()), /pagination metadata/);
});

test("PAIR collector rejects pagination drift instead of publishing a partial universe", async () => {
  const collector = new PairTokenCollector(settings, {
    now: () => now,
    fetchPage: async (url) => {
      const page = Number(new URL(url).searchParams.get("page"));
      if (page === 1) {
        return fetched({
          items: [token("1", "ONE", "25000", "5000"), token("2", "TWO", "25000", "5000")],
          total: 3,
          page: 1,
          limit: 2,
        });
      }
      return fetched({
        items: [token("3", "THREE", "25000", "5000")],
        total: 4,
        page: 2,
        limit: 2,
      });
    },
    fetchHolder: async () => {
      throw new Error("should not run");
    },
  });

  await assert.rejects(collector.collect(new Map()), /pagination changed/);
});

test("PAIR collector retries the whole snapshot after a launch shifts newest pagination", async () => {
  let firstPageCalls = 0;
  const collector = new PairTokenCollector(
    { ...settings, snapshotAttempts: 2 },
    {
      now: () => now,
      fetchPage: async (url) => {
        const page = Number(new URL(url).searchParams.get("page"));
        if (page === 1) {
          firstPageCalls += 1;
          if (firstPageCalls === 1) {
            return fetched({
              items: [token("1", "ONE", "25000", "5000"), token("2", "TWO", "25000", "5000")],
              total: 3,
              page: 1,
              limit: 2,
            });
          }
          return fetched({
            items: [token("1", "ONE", "25000", "5000"), token("2", "TWO", "25000", "5000")],
            total: 4,
            page: 1,
            limit: 2,
          });
        }
        if (firstPageCalls === 1) {
          return fetched({
            items: [token("3", "THREE", "25000", "5000")],
            total: 4,
            page: 2,
            limit: 2,
          });
        }
        return fetched({
          items: [token("3", "THREE", "25000", "5000"), token("4", "FOUR", "25000", "5000")],
          total: 4,
          page: 2,
          limit: 2,
        });
      },
      fetchHolder: async () => ({
        holderCount: 10,
        observedAt: now.toISOString(),
        latencyMs: 1,
        source: "gmgn.tokenInfo",
      }),
    },
  );

  const batch = await collector.collect(new Map());
  assert.equal(batch.tokens.length, 4);
  assert.equal(firstPageCalls, 3);
});
