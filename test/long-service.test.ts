import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_LONG_TOKEN_SETTINGS } from "../src/long-tokens/config.js";
import { LongTokenCollector } from "../src/long-tokens/collector.js";
import { LongTokenDatabase } from "../src/long-tokens/database.js";
import { LongTokenService } from "../src/long-tokens/service.js";
import type { LongCollectionBatch } from "../src/long-tokens/types.js";
import type { PairSourceStatus } from "../src/pair/types.js";

const settings = { ...DEFAULT_LONG_TOKEN_SETTINGS };

function batch(
  observedAt: string,
  values: [number, number] = [200, 100],
  sourceStatus: PairSourceStatus = "ok",
): LongCollectionBatch {
  return {
    observedAt,
    universeCount: 20,
    eligibleCount: 2,
    verifiedMembership: [],
    warnings: [],
    sourceHealth: [
      {
        source: "gmgn.marketRank.longxyz",
        status: sourceStatus,
        fetchedAt: observedAt,
        latencyMs: 3,
        message: "private market detail",
      },
      {
        source: "long.officialGraphql.assetMembership",
        status: "ok",
        fetchedAt: observedAt,
        latencyMs: 4,
        message: "private launcher detail",
      },
    ],
    tokens: values.map((marketCapUsd, index) => {
      const address = `0x${String(index + 1).padStart(40, "0")}`;
      return {
        address,
        name: index === 0 ? "Artificial Inu" : "Second Long",
        symbol: index === 0 ? "AI" : "LONG2",
        tokenUrl: `https://app.long.xyz/tokens/${address}`,
        launchedAt: "2026-08-31T00:00:00.000Z",
        graduated: true,
        observedAt,
        priceUsd: marketCapUsd / 1_000,
        marketCapUsd,
        liquidityDepthUsd: marketCapUsd / 2,
        volume24hUsd: marketCapUsd / 4,
        holderCount: marketCapUsd,
        holderObservedAt: observedAt,
        holderSource: "gmgn.marketRank.longxyz",
        eligible: true,
        eligibilityReason: null,
        marketDataSource: "gmgn.marketRank.longxyz",
        marketDataUpdatedAt: observedAt,
      };
    }),
  };
}

async function withService(
  run: (context: {
    service: LongTokenService;
    setNow(value: string): void;
    setCollector(collector: () => Promise<LongCollectionBatch>): void;
  }) => Promise<void>,
) {
  const directory = mkdtempSync(join(tmpdir(), "long-service-"));
  const database = new LongTokenDatabase(join(directory, "test.sqlite"));
  let now = new Date("2026-09-01T00:00:00.000Z");
  let collector = async () => batch(now.toISOString());
  const unusedCollector = new LongTokenCollector(settings, {
    fetchRank: async () => {
      throw new Error("unused");
    },
  });
  const service = new LongTokenService(database, settings, unusedCollector, {
    now: () => now,
    collect: async () => collector(),
  });
  try {
    await run({
      service,
      setNow(value) {
        now = new Date(value);
      },
      setCollector(value) {
        collector = value;
      },
    });
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("Long service coalesces refreshes and publishes four independent rankings", async () => {
  await withService(async ({ service, setCollector }) => {
    let release: (value: LongCollectionBatch) => void = () => undefined;
    let calls = 0;
    const pending = new Promise<LongCollectionBatch>((resolve) => {
      release = resolve;
    });
    setCollector(async () => {
      calls += 1;
      return pending;
    });

    const first = service.refresh();
    const second = service.refresh();
    assert.equal(first, second);
    release(batch("2026-09-01T00:00:00.000Z"));
    await first;

    const response = service.rankings();
    assert.equal(calls, 1);
    assert.equal(response.service, "rhc-long-token-radar");
    assert.equal(response.rankings.market_cap_usd.entries[0]?.symbol, "AI");
    assert.deepEqual(Object.keys(response.rankings).sort(), [
      "holder_count",
      "liquidity_depth_usd",
      "market_cap_usd",
      "volume_24h_usd",
    ]);
    assert.doesNotMatch(JSON.stringify(response), /private market|private launcher/);
    assert.equal(service.sources().caveats.length, 4);
  });
});

test("Long daily reports retain the previous ranking baseline", async () => {
  await withService(async ({ service, setNow, setCollector }) => {
    setCollector(async () => batch("2026-09-01T00:00:00.000Z", [200, 100]));
    await service.refresh();
    setNow("2026-09-01T00:10:00.000Z");
    service.generateDailyReport();

    setNow("2026-09-02T00:00:00.000Z");
    setCollector(async () => batch("2026-09-02T00:00:00.000Z", [150, 300]));
    await service.refresh();
    setNow("2026-09-02T00:12:00.000Z");
    const report = service.generateDailyReport();

    assert.equal(report.reportDate, "2026-09-02");
    assert.equal(report.rankings.market_cap_usd.entries[0]?.symbol, "LONG2");
    assert.equal(report.rankings.market_cap_usd.entries[0]?.previousRank, 2);
    assert.equal(service.latestDailyReport()?.reportDate, "2026-09-02");
  });
});

test("Long service serves the last usable snapshot after a later refresh failure", async () => {
  await withService(async ({ service, setNow, setCollector }) => {
    await service.refresh();
    setNow("2026-09-01T02:00:00.000Z");
    setCollector(async () => {
      throw new TypeError("https://private.example/secret");
    });
    await assert.rejects(service.refresh());

    const response = service.rankings();
    assert.equal(response.snapshot?.stale, true);
    assert.ok(response.warnings.some((warning) => warning.includes("最近一次刷新失败")));
    assert.doesNotMatch(JSON.stringify(response), /private\.example|secret/);
    assert.equal(service.health().latestRunStatus, "failed");
  });
});
