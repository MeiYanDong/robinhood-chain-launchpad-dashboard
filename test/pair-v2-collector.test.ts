import assert from "node:assert/strict";
import test from "node:test";
import {
  PairV2Collector,
  PAIR_V2_TOPICS,
  parseMarketToken,
  selectAlphaMarketCandidates,
  selectHotMarketAddresses,
} from "../src/pair-v2/collector.js";
import { DEFAULT_PAIR_V2_SETTINGS } from "../src/pair-v2/config.js";
import { encodeAddressWord, encodeUintWord, type PairV2Rpc } from "../src/pair-v2/rpc.js";

const PROJECT = "0x1111111111111111111111111111111111115555";
const CREATOR = "0x2222222222222222222222222222222222222222";
const VAULT = "0x3333333333333333333333333333333333333333";
const HANDLER = "0x4444444444444444444444444444444444444444";
const QUOTE = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const POOL = `0x${"c".repeat(64)}`;
const POOL_TWO = `0x${"e".repeat(64)}`;
const POOL_DUST = `0x${"f".repeat(64)}`;
const TX = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function topicAddress(value: string): string {
  return `0x${encodeAddressWord(value)}`;
}

function fetched(payload: unknown) {
  return {
    payload,
    fetchedAt: "2026-09-05T08:00:00.000Z",
    latencyMs: 1,
    sha256: "a".repeat(64),
  };
}

test("PAIR market parser accepts V1 and keeps pool identity for fee attribution", () => {
  assert.equal(parseMarketToken({ address: PROJECT, launchVersion: "v1" })?.launchVersion, "v1");
  const parsed = parseMarketToken({
    address: PROJECT,
    launchVersion: "v2",
    name: "Alpha",
    symbol: "A",
    volume24hUsd: "42.5",
    marketCapUsd: "1000",
    holders: 0,
    description: "A test project with enough public detail to review.",
    website: "https://alpha.example",
    twitter: "https://x.com/alpha",
    pairs: [
      {
        positionId: "7",
        poolId: POOL,
        canonical: true,
        weightBps: 6_000,
        quoteToken: { address: QUOTE, symbol: "AAPL", decimals: 18 },
      },
    ],
  });
  assert.equal(parsed?.address, PROJECT);
  assert.equal(parsed?.volume24hUsd, 42.5);
  assert.equal(parsed?.pools[0]?.positionId, "7");
  assert.equal(parsed?.pools[0]?.quote.symbol, "AAPL");
  assert.equal(parsed?.pools[0]?.canonical, true);
  assert.equal(parsed?.pools[0]?.weightBps, 6_000);
  assert.equal(parsed?.holderCount, 0);
  assert.equal(parsed?.profile?.descriptionPresent, true);
  assert.equal(parsed?.profile?.websiteUrl, "https://alpha.example/");
  assert.ok(parsed?.holderObservedAt);
});

test("PAIR Alpha candidate selection retains an active V1 leader in the hot lane", () => {
  const legacy = parseMarketToken({
    address: PROJECT,
    launchVersion: "v1",
    marketVersion: "v4-multi",
    symbol: "Titties",
    combinedVolume24hUsd: "1586170.73",
    marketCapUsd: "1163798",
  });
  assert.ok(legacy);
  const selected = selectAlphaMarketCandidates(
    [legacy],
    { ...DEFAULT_PAIR_V2_SETTINGS, alphaLegacyCandidateLimit: 10 },
    new Date("2026-09-06T15:26:37.076Z"),
  );
  assert.equal(selected[0]?.alphaMarketCandidate, true);
  assert.ok(selected[0]?.alphaCandidateReasons?.includes("official_volume_floor"));
  assert.deepEqual([...selectHotMarketAddresses(selected, 10)], [PROJECT]);
});

test("PAIR V2 collector joins canonical launch and fee logs without treating estimates as execution", async () => {
  const settings = {
    ...DEFAULT_PAIR_V2_SETTINGS,
    deploymentBlock: 100,
    logConfirmations: 0,
    pageLimit: 50,
    maxPages: 1,
    maxBucketEpoch: 1,
  };
  const launchData = `0x${encodeUintWord(2n)}${encodeUintWord(5n)}${encodeAddressWord(HANDLER)}${encodeUintWord(9n)}`;
  const feeData = `0x${encodeUintWord(1000n * 10n ** 18n)}${encodeUintWord(7n * 10n ** 18n)}`;
  let logs = [
    {
      address: settings.expectedReleaseId ? "0xf98b202fd8717b79f9c5e5dd67c2f9e640bbd25d" : "",
      topics: [
        PAIR_V2_TOPICS.launch,
        topicAddress(PROJECT),
        topicAddress(CREATOR),
        topicAddress(VAULT),
      ],
      data: launchData,
      blockNumber: "0x64",
      transactionHash: TX,
      logIndex: "0x1",
      removed: false,
    },
    {
      address: VAULT,
      topics: [PAIR_V2_TOPICS.nativeFeesCollected, `0x${encodeUintWord(7n)}`],
      data: feeData,
      blockNumber: "0x65",
      transactionHash: `0x${"d".repeat(64)}`,
      logIndex: "0x2",
      removed: false,
    },
  ];
  const rpc: PairV2Rpc = {
    async call<T>(method: string): Promise<T> {
      if (method === "eth_blockNumber") return "0x6e" as T;
      if (method === "eth_getLogs") return logs as T;
      if (method === "eth_getBlockByNumber") {
        return { number: "0x64", timestamp: "0x68bbf840" } as T;
      }
      if (method === "eth_call") return `0x${encodeUintWord(0n)}` as T;
      throw new Error(`unexpected method ${method}`);
    },
    async batch<T>(calls: Array<{ method: string; params: unknown[] }>): Promise<T[]> {
      if (calls.length === 0) return [];
      if (calls[0]?.method === "eth_getBlockByNumber") {
        return calls.map((_call, index) => ({
          number: index === 0 ? "0x64" : "0x65",
          timestamp: index === 0 ? "0x68bbf840" : "0x68bbf846",
        })) as T[];
      }
      if (calls[0]?.method === "eth_call") {
        return calls.map(() => `0x${encodeUintWord(0n)}`) as T[];
      }
      throw new Error("unexpected batch");
    },
  };
  const collector = new PairV2Collector(settings, {
    rpc,
    now: () => new Date("2026-09-05T08:00:00.000Z"),
    fetchHolder: async () => ({ count: 12, observedAt: "2026-09-05T08:00:00.000Z" }),
    fetchPage: async (url) => {
      if (url.includes("consumer-live")) {
        return fetched({
          schema: "fixture",
          state: "ready",
          ready: true,
          configured: true,
          capability: "fixture",
          releaseId: settings.expectedReleaseId,
          manifestSha256: settings.expectedManifestSha256,
          blockNumber: "110",
          addresses: {
            launchpad: "0x8660a7f019c7943b0b0a91b8e39aff3b6db6ae62",
            modeRegistry: "0xda5c65431e2adc1c64af51e3ce7de2485abeab69",
            coordinator: "0xf98b202fd8717b79f9c5e5dd67c2f9e640bbd25d",
            tokenFactory: "0xece4ce499e1f75ceb75581a16b48c86eba0a3e3a",
            hook: "0xd2f759a1cf13c30127c551c3aee04629aea200c0",
            buybackExecutor: "0x8fea00440300bb2d3e9377b995e6f62fe99c1a0c",
            aggregator: "0xe6c5a027da3f4506cde435b5e5bb6680c870f771",
          },
        });
      }
      if (url.includes("api.dexscreener.com")) {
        return fetched({
          pairs: [
            {
              chainId: "robinhood",
              pairAddress: POOL,
              url: `https://dexscreener.com/robinhood/${POOL}`,
              baseToken: { address: PROJECT, symbol: "A" },
              quoteToken: { address: QUOTE, symbol: "AAPL" },
              priceUsd: "0.001",
              marketCap: 1_000,
              liquidity: { usd: 250 },
              volume: { m5: 12, h1: 40, h6: 70, h24: 100 },
              txns: { m5: { buys: 4, sells: 1 }, h1: { buys: 10, sells: 3 } },
              priceChange: { h1: 8, h6: 12, h24: 20 },
            },
            {
              chainId: "robinhood",
              pairAddress: POOL_TWO,
              url: `https://dexscreener.com/robinhood/${POOL_TWO}`,
              baseToken: { address: PROJECT, symbol: "A" },
              quoteToken: { address: QUOTE, symbol: "AAPL" },
              priceUsd: "0.0011",
              marketCap: 1_100,
              liquidity: { usd: 100 },
              volume: { m5: 3, h1: 8, h6: 15, h24: 20 },
              txns: { m5: { buys: 1, sells: 2 }, h1: { buys: 2, sells: 4 } },
              priceChange: { m5: -1, h1: 2, h6: 4, h24: 9 },
            },
            {
              chainId: "robinhood",
              pairAddress: POOL_DUST,
              url: `https://dexscreener.com/robinhood/${POOL_DUST}`,
              baseToken: { address: PROJECT, symbol: "A" },
              quoteToken: { address: QUOTE, symbol: "AAPL" },
              priceUsd: "0.000000000000000000000001",
              marketCap: 0,
              liquidity: {},
              volume: { m5: 0, h1: 0, h6: 0, h24: 0 },
              txns: { m5: { buys: 0, sells: 0 }, h1: { buys: 0, sells: 0 } },
              priceChange: { m5: 0, h1: 0, h6: 0, h24: 0 },
            },
          ],
        });
      }
      return fetched({
        total: 1,
        page: 1,
        limit: 50,
        items: [
          {
            address: PROJECT,
            launchVersion: "v2",
            name: "Alpha",
            symbol: "A",
            volume24hUsd: "100",
            marketCapUsd: "1000",
            marketDataUpdatedAt: "2026-09-05T07:59:00.000Z",
            pairs: [
              {
                positionId: "7",
                poolId: POOL,
                canonical: true,
                weightBps: 6_000,
                quoteToken: { address: QUOTE, symbol: "AAPL", decimals: 18 },
              },
              {
                positionId: "8",
                poolId: POOL_TWO,
                canonical: true,
                weightBps: 4_000,
                quoteToken: { address: QUOTE, symbol: "AAPL", decimals: 18 },
              },
              {
                positionId: "9",
                poolId: POOL_DUST,
                canonical: true,
                weightBps: 0,
                quoteToken: { address: QUOTE, symbol: "AAPL", decimals: 18 },
              },
            ],
          },
        ],
      });
    },
  });

  const batch = await collector.collect({
    kind: "full",
    fromBlock: 100,
    cachedRelease: null,
    cachedTokens: [],
    cachedLaunches: [],
  });
  assert.equal(batch.launches.length, 1);
  assert.deepEqual(
    batch.events.map((event) => event.type),
    ["launch", "fee_collected"],
  );
  const fee = batch.events[1];
  assert.equal(fee?.amount, 7);
  assert.equal(fee?.secondaryAmount, 1000);
  assert.equal(
    batch.events.some((event) => event.type === "buyback_executed"),
    false,
  );
  assert.deepEqual(batch.buckets, []);
  assert.equal(batch.tokens[0]?.shortWindow?.pairCount, 3);
  assert.equal(batch.tokens[0]?.shortWindow?.volume5mUsd, 15);
  assert.equal(batch.tokens[0]?.shortWindow?.volume24hUsd, 120);
  assert.equal(batch.tokens[0]?.shortWindow?.primaryVolume24hUsd, 100);
  assert.equal(batch.tokens[0]?.shortWindow?.primaryPoolId, POOL);
  assert.equal(batch.tokens[0]?.shortWindow?.buys1h, 12);
  assert.equal(batch.tokens[0]?.shortWindow?.consensusPriceUsd, 0.001);
  assert.ok(Math.abs((batch.tokens[0]?.shortWindow?.crossPoolSpreadPct ?? 0) - 10) < 1e-9);
  assert.equal(batch.tokens[0]?.liquidityUsd, 350);
  assert.equal(
    batch.sourceHealth.find((source) => source.id === "dexscreener_pairs")?.status,
    "ok",
  );

  logs = [];
  const afterReorg = await collector.collect({
    kind: "chain",
    fromBlock: 100,
    cachedRelease: batch.release,
    cachedTokens: batch.tokens,
    cachedLaunches: batch.launches,
  });
  assert.deepEqual(afterReorg.launches, []);
  assert.deepEqual(afterReorg.events, []);
});

test("PAIR V2 collector fails closed when official pagination drifts", async () => {
  const settings = {
    ...DEFAULT_PAIR_V2_SETTINGS,
    deploymentBlock: 100,
    pageLimit: 1,
    maxPages: 2,
  };
  const collector = new PairV2Collector(settings, {
    fetchPage: async (url) => {
      if (url.includes("consumer-live")) {
        return fetched({
          schema: "fixture",
          state: "ready",
          ready: true,
          configured: true,
          capability: "fixture",
          releaseId: settings.expectedReleaseId,
          manifestSha256: settings.expectedManifestSha256,
          blockNumber: "110",
          addresses: {
            launchpad: "0x8660a7f019c7943b0b0a91b8e39aff3b6db6ae62",
            modeRegistry: "0xda5c65431e2adc1c64af51e3ce7de2485abeab69",
            coordinator: "0xf98b202fd8717b79f9c5e5dd67c2f9e640bbd25d",
            tokenFactory: "0xece4ce499e1f75ceb75581a16b48c86eba0a3e3a",
            hook: "0xd2f759a1cf13c30127c551c3aee04629aea200c0",
            buybackExecutor: "0x8fea00440300bb2d3e9377b995e6f62fe99c1a0c",
            aggregator: "0xe6c5a027da3f4506cde435b5e5bb6680c870f771",
          },
        });
      }
      const page = new URL(url).searchParams.get("page");
      return fetched({
        total: page === "1" ? 2 : 3,
        page: Number(page),
        limit: 1,
        items: [{ address: PROJECT, launchVersion: "v2" }],
      });
    },
  });

  await assert.rejects(
    collector.collect({
      kind: "full",
      fromBlock: 100,
      cachedRelease: null,
      cachedTokens: [],
      cachedLaunches: [],
    }),
    /pagination drifted/,
  );
});
