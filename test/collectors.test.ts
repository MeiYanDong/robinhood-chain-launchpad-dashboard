import assert from "node:assert/strict";
import test from "node:test";
import { extractBankrMetrics } from "../src/collectors/bankr.js";
import {
  extractLongAssetAddresses,
  extractLongHourRows,
  summarizeLongDaily,
} from "../src/collectors/long.js";
import {
  LETSCASH_DAILY_SOURCE,
  extractLetsCashMetrics,
  extractLetsCashStats,
} from "../src/collectors/letscash.js";
import {
  DEFILLAMA_SOURCES,
  extractDefiLlamaMetric,
  extractDefiLlamaSummaryMetric,
  selectSummaryFallbacks,
} from "../src/collectors/defillama.js";
import { PLATFORM_REGISTRY } from "../src/config/platforms.js";

function timestamp(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`) / 1_000;
}

test("Pons V1 and V2 are grouped into one canonical daily metric", () => {
  const payload = {
    protocols: [
      { name: "Pons V1", category: "Launchpad" },
      { name: "Pons V2", category: "Launchpad" },
    ],
    totalDataChartBreakdown: [
      [timestamp("2026-08-22"), { "Pons V1": 12, "Pons V2": 30 }],
    ],
  };

  const parsed = extractDefiLlamaMetric(
    payload,
    "fees_usd",
    "fixture.dailyFees",
    "2026-08-22",
    "2026-08-23T01:00:00.000Z",
  );

  assert.equal(parsed.metrics.length, 1);
  assert.equal(parsed.metrics[0]?.platformId, "pons");
  assert.equal(parsed.metrics[0]?.value, 42);
  assert.match(parsed.metrics[0]?.derivation ?? "", /Pons V1.*Pons V2/);
});

test("current and future UTC buckets are excluded", () => {
  const payload = {
    protocols: [{ name: "Pons", category: "Launchpad" }],
    totalDataChartBreakdown: [
      [timestamp("2026-08-22"), { Pons: 10 }],
      [timestamp("2026-08-23"), { Pons: 20 }],
      [timestamp("2026-08-24"), { Pons: 30 }],
    ],
  };

  const parsed = extractDefiLlamaMetric(
    payload,
    "volume_usd",
    "fixture.dailyVolume",
    "2026-08-22",
    "2026-08-23T01:00:00.000Z",
  );

  assert.deepEqual(
    parsed.metrics.map((metric) => [metric.date, metric.value]),
    [["2026-08-22", 10]],
  );
});

test("protocol summary fallback keeps explicit zero, selects Robinhood Chain, and excludes future days", () => {
  const letscash = PLATFORM_REGISTRY.find((platform) => platform.id === "letscash");
  assert.ok(letscash);

  const parsed = extractDefiLlamaSummaryMetric(
    {
      totalDataChartBreakdown: [
        [
          timestamp("2026-08-22"),
          {
            Base: { LetsCash: 999 },
            "Robinhood Chain": { LetsCash: 0 },
          },
        ],
        [timestamp("2026-08-23"), { "Robinhood Chain": { LetsCash: 12.5 } }],
        [timestamp("2026-08-24"), { "Robinhood Chain": { LetsCash: 100 } }],
      ],
    },
    letscash,
    "LetsCash",
    "fees_usd",
    "fixture.summary.dailyFees",
    "2026-08-23",
    "2026-08-24T01:00:00.000Z",
  );

  assert.deepEqual(
    parsed.metrics.map((metric) => [metric.date, metric.value]),
    [
      ["2026-08-22", 0],
      ["2026-08-23", 12.5],
    ],
  );
  assert.equal(parsed.latestDataDate, "2026-08-23");
  assert.match(parsed.metrics[0]?.derivation ?? "", /protocol-level.*summary/i);
});

test("protocol summaries cover every discovered launchpad except first-party Bankr", () => {
  const parsed = extractDefiLlamaMetric(
    {
      protocols: [
        { name: "Pons V2", slug: "pons-v2", category: "Launchpad" },
        { name: "LetsCash", slug: "letscash", category: "Launchpad" },
        { name: "Bankr", slug: "bankr", category: "Launchpad" },
      ],
      totalDataChartBreakdown: [
        [timestamp("2026-08-22"), { "Pons V2": 30 }],
      ],
    },
    "fees_usd",
    "fixture.dailyFees",
    "2026-08-22",
    "2026-08-23T01:00:00.000Z",
  );

  const definition = DEFILLAMA_SOURCES.find((source) => source.metric === "fees_usd");
  assert.ok(definition);
  const candidates = selectSummaryFallbacks([{ definition, parsed }]);

  assert.deepEqual(
    candidates.map((candidate) => candidate.protocol.name),
    ["Pons V2", "LetsCash"],
  );
});

test("Bankr exposes official Robinhood Chain volume only and excludes partial current day", () => {
  const parsed = extractBankrMetrics(
    {
      dailyVolumeByChain: [
        { date: "2026-08-22", base: 99, robinhood: 12.5 },
        { date: "2026-08-23", base: 88, robinhood: 22.5 },
      ],
      dailyProtocolFees: { bankrFees: 999 },
    },
    "2026-08-22",
    "2026-08-23T01:00:00.000Z",
  );

  assert.equal(parsed.metrics.length, 1);
  assert.deepEqual(parsed.metrics[0], {
    platformId: "bankr",
    metric: "volume_usd",
    date: "2026-08-22",
    value: 12.5,
    source: "bankr.officialDashboard",
    quality: "reported",
    scope: "Bankr Robinhood Chain daily volume",
    derivation: null,
    collectedAt: "2026-08-23T01:00:00.000Z",
  });
});

test("Long closed-day volume only includes assets attributed to the Long integrator", () => {
  const startHour = timestamp("2026-08-29") / 3_600;
  const longOne = "0x1111111111111111111111111111111111111e18";
  const longTwo = "0x2222222222222222222222222222222222221e18";
  const other = "0x3333333333333333333333333333333333331e18";
  const rows = extractLongHourRows(
    {
      data: {
        PoolVolumeHour: [
          {
            pool_id: `4663-${longOne}`,
            hour_timestamp: startHour,
            volume_usd: "1500000000000000000",
            swap_count: 2,
          },
          {
            pool_id: `4663-${longTwo}`,
            hour_timestamp: startHour + 23,
            volume_usd: "2000000000000000000",
            swap_count: 3,
          },
          {
            pool_id: `4663-${other}`,
            hour_timestamp: startHour + 1,
            volume_usd: "99000000000000000000",
            swap_count: 50,
          },
          {
            pool_id: `4663-${longOne}`,
            hour_timestamp: startHour + 24,
            volume_usd: "7000000000000000000",
            swap_count: 7,
          },
        ],
      },
    },
    startHour,
    startHour + 24,
  );
  const assets = extractLongAssetAddresses({
    data: {
      Asset: [{ asset_address: longOne }, { asset_address: longTwo }],
    },
  });
  const summary = summarizeLongDaily(rows, assets);

  assert.equal(rows.length, 3);
  assert.equal(summary.volumeUsd, 3.5);
  assert.equal(summary.swapCount, 5);
  assert.equal(summary.activeTokenCount, 2);
  assert.equal(summary.hourlyRowCount, 2);
});

test("LetsCash official daily ETH rows become closed-day USD metrics and exclude the current day", () => {
  const tokenomics = {
    daily: [
      { t: timestamp("2026-08-23") * 1_000, volEth: 10, feesEth: 1 },
      { t: timestamp("2026-08-24") * 1_000, volEth: 20, feesEth: 2 },
      { t: timestamp("2026-08-25") * 1_000, volEth: 99, feesEth: 9 },
    ],
  };
  const prices = {
    coins: {
      "coingecko:ethereum": {
        prices: [
          { timestamp: timestamp("2026-08-23"), price: 2_000 },
          { timestamp: timestamp("2026-08-24") - 1, price: 2_500 },
          { timestamp: timestamp("2026-08-25"), price: 3_000 },
        ],
      },
    },
  };

  const parsed = extractLetsCashMetrics(
    tokenomics,
    prices,
    "2026-08-24",
    "2026-08-25T01:00:00.000Z",
  );

  assert.deepEqual(parsed.pricedDates, ["2026-08-23", "2026-08-24"]);
  assert.deepEqual(parsed.missingPriceDates, []);
  assert.equal(parsed.metrics.length, 6);
  assert.deepEqual(
    parsed.metrics
      .filter((metric) => metric.date === "2026-08-24")
      .map((metric) => [metric.metric, metric.value, metric.source]),
    [
      ["volume_usd", 50_000, LETSCASH_DAILY_SOURCE],
      ["fees_usd", 5_000, LETSCASH_DAILY_SOURCE],
      ["protocol_revenue_usd", 150, LETSCASH_DAILY_SOURCE],
    ],
  );
});

test("LetsCash live snapshot distinguishes direct totals from derived rolling platform income", () => {
  const stats = extractLetsCashStats(
    {
      volumeEth: { day: 100, allTime: 1_000 },
      feesEth: { day: 5, allTime: 50 },
      platformEth: 7,
      creatorsEth: 30,
      trades: 400,
      traders: 120,
      tokensLaunched: 10,
    },
    "2026-08-25T01:00:00.000Z",
  );

  const rollingPlatform = stats.find(
    (stat) => stat.key === "platform_revenue_rolling_24h_eth",
  );
  const allTimePlatform = stats.find(
    (stat) => stat.key === "platform_revenue_all_time_eth",
  );
  assert.equal(rollingPlatform?.value, 0.3);
  assert.equal(rollingPlatform?.quality, "derived");
  assert.equal(allTimePlatform?.value, 7);
  assert.equal(allTimePlatform?.quality, "reported");
});
