import assert from "node:assert/strict";
import test from "node:test";
import {
  EconomicsCollector,
  fetchTokenSuppliesFromRpc,
  parsePairProtocolToken,
  parsePonsProtocolToken,
  parseTokenSupplies,
} from "../src/economics/collector.js";
import { DEFAULT_ECONOMICS_SETTINGS, economicsSettingsFromEnv } from "../src/economics/config.js";

const settings = { ...DEFAULT_ECONOMICS_SETTINGS };
const observedAt = "2026-09-03T01:00:00.000Z";

function rpcHex(value: bigint): string {
  return `0x${value.toString(16)}`;
}

function rpcSupplyPayload(): Array<{ id: number; result: string }> {
  const unit = 10n ** 18n;
  return [
    { id: 1, result: rpcHex(1_000n * unit) },
    { id: 2, result: rpcHex(250n * unit) },
    { id: 3, result: rpcHex(18n) },
    { id: 4, result: rpcHex(2_000n * unit) },
    { id: 5, result: rpcHex(100n * unit) },
    { id: 6, result: rpcHex(18n) },
    { id: 7, result: "0xabcdef" },
  ];
}

test("economics market parsers keep official PAIR values and derive PONS market cap", () => {
  const pair = parsePairProtocolToken(
    {
      address: settings.pairTokenAddress,
      name: "PAIR",
      symbol: "PAIR",
      priceUsd: 0.01,
      marketCapUsd: 10_000_000,
      totalDepthUsd: 400_000,
      combinedVolume24hUsd: 1_200_000,
    },
    observedAt,
    settings,
  );
  const pons = parsePonsProtocolToken(
    {
      data: {
        address: settings.ponsTokenAddress,
        name: "Pons",
        symbol: "PONS",
        circulating_supply: "900000000",
        holder_count: 1234,
        liquidity: "500000",
        price: { price: "0.2", volume_24h: "3000000" },
      },
    },
    observedAt,
    settings,
  );

  assert.equal(pair.marketCapUsd, 10_000_000);
  assert.equal(pair.liquidityUsd, 400_000);
  assert.equal(pair.quality, "official");
  assert.equal(pons.marketCapUsd, 180_000_000);
  assert.equal(pons.holderCount, 1234);
  assert.equal(pons.quality, "derived");
  assert.throws(
    () => parsePairProtocolToken({ address: settings.ponsTokenAddress }, observedAt, settings),
    /unexpected address/,
  );
});

test("economics RPC parser separates total supply from cumulative dead-address balance", () => {
  const supplies = parseTokenSupplies(rpcSupplyPayload(), observedAt, settings);

  assert.deepEqual(
    supplies.map((supply) => [supply.totalSupply, supply.burnedSupply, supply.blockNumber]),
    [
      [1_000, 250, "0xabcdef"],
      [2_000, 100, "0xabcdef"],
    ],
  );
  assert.throws(
    () => parseTokenSupplies([{ id: 1, result: "0x1" }], observedAt, settings),
    /incomplete/,
  );
});

test("economics RPC supply read retries one transient HTTP failure", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls += 1;
    return calls === 1
      ? new Response("unavailable", { status: 503 })
      : new Response(JSON.stringify(rpcSupplyPayload()), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
  };

  const result = await fetchTokenSuppliesFromRpc(settings, { fetcher, retryDelayMs: 0 });
  assert.equal(calls, 2);
  assert.equal(result.value[0]?.burnedSupply, 250);
  assert.equal(result.value[1]?.totalSupply, 2_000);
});

test("economics collector publishes partial observations without leaking upstream errors", async () => {
  const pairMarket = parsePairProtocolToken(
    {
      address: settings.pairTokenAddress,
      name: "PAIR",
      symbol: "PAIR",
      priceUsd: 0.01,
      marketCapUsd: 10,
      totalDepthUsd: 4,
      combinedVolume24hUsd: 2,
    },
    observedAt,
    settings,
  );
  const collector = new EconomicsCollector(settings, {
    now: () => new Date(observedAt),
    fetchPairToken: async () => ({ value: pairMarket, fetchedAt: observedAt, latencyMs: 2 }),
    fetchPonsToken: async () => {
      throw new Error("https://private.example/secret");
    },
    fetchTokenSupplies: async () => ({ value: [], fetchedAt: observedAt, latencyMs: 3 }),
  });

  const result = await collector.collect();
  assert.deepEqual(
    result.tokenMarkets.map((market) => market.platformId),
    ["pair"],
  );
  assert.deepEqual(result.warnings, ["gmgn.ponsTokenInfo_unavailable"]);
  assert.equal(
    result.sourceHealth.find((source) => source.source === "gmgn.ponsTokenInfo")?.message,
    "当前来源不可用。",
  );
  assert.doesNotMatch(JSON.stringify(result), /private\.example|secret/);
});

test("economics environment settings stay bounded and reject invalid refresh intervals", () => {
  const parsed = economicsSettingsFromEnv({
    ECONOMICS_RPC_URL: "https://rpc.example",
    ECONOMICS_REFRESH_TTL_MINUTES: "5",
    ECONOMICS_STALE_AFTER_MINUTES: "20",
  });
  assert.equal(parsed.rpcUrl, "https://rpc.example");
  assert.equal(parsed.refreshTtlMinutes, 5);
  assert.equal(parsed.staleAfterMinutes, 20);
  assert.throws(
    () => economicsSettingsFromEnv({ ECONOMICS_REFRESH_TTL_MINUTES: "0" }),
    /must be positive/,
  );
});
