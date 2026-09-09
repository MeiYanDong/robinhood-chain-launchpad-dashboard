import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_PAIR_TOKEN_SETTINGS } from "../src/pair/config.js";
import { PairTokenCollector } from "../src/pair/collector.js";
import { PairTokenDatabase } from "../src/pair/database.js";
import { PairTokenService } from "../src/pair/service.js";
import type { PairCollectionBatch, PairSourceStatus } from "../src/pair/types.js";

const settings = { ...DEFAULT_PAIR_TOKEN_SETTINGS };

function batch(
  observedAt: string,
  values: [number, number] = [200, 100],
  sourceStatus: PairSourceStatus = "ok",
): PairCollectionBatch {
  return {
    observedAt,
    universeCount: 20,
    eligibleCount: 2,
    warnings: sourceStatus === "ok" ? [] : ["private upstream warning"],
    sourceHealth: [
      {
        source: "pair.officialApi",
        status: "ok",
        fetchedAt: observedAt,
        latencyMs: 3,
        message: "private official detail",
      },
      {
        source: "gmgn.tokenInfo",
        status: sourceStatus,
        fetchedAt: observedAt,
        latencyMs: 4,
        message: "private holder detail",
      },
    ],
    tokens: values.map((marketCapUsd, index) => {
      const address = `0x${String(index + 1).padStart(40, "0")}`;
      return {
        address,
        name: index === 0 ? "Alpha" : "Beta",
        symbol: index === 0 ? "A" : "B",
        tokenUrl: `https://pair.fund/tokens/${address}`,
        launchedAt: "2026-08-31T00:00:00.000Z",
        graduated: true,
        observedAt,
        priceUsd: marketCapUsd / 1_000,
        marketCapUsd,
        liquidityDepthUsd: marketCapUsd / 2,
        volume24hUsd: marketCapUsd / 4,
        holderCount: marketCapUsd,
        holderObservedAt: observedAt,
        holderSource: "gmgn.tokenInfo",
        eligible: true,
        eligibilityReason: null,
        marketDataSource: "dexscreener",
        marketDataUpdatedAt: observedAt,
      };
    }),
  };
}

async function withService(
  run: (context: {
    database: PairTokenDatabase;
    service: PairTokenService;
    setNow(value: string): void;
    setCollector(collector: () => Promise<PairCollectionBatch>): void;
  }) => Promise<void>,
) {
  const directory = mkdtempSync(join(tmpdir(), "pair-service-"));
  const database = new PairTokenDatabase(join(directory, "test.sqlite"));
  let now = new Date("2026-09-01T00:00:00.000Z");
  let collector = async () => batch(now.toISOString());
  const unusedCollector = new PairTokenCollector(settings, {
    fetchPage: async () => {
      throw new Error("unused");
    },
  });
  const service = new PairTokenService(database, settings, unusedCollector, {
    now: () => now,
    collect: async () => collector(),
  });
  try {
    await run({
      database,
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

test("PAIR service coalesces concurrent refreshes and publishes sanitized partial data", async () => {
  await withService(async ({ service, setCollector }) => {
    let release: (value: PairCollectionBatch) => void = () => {
      throw new Error("release not initialized");
    };
    let calls = 0;
    const pending = new Promise<PairCollectionBatch>((resolve) => {
      release = resolve;
    });
    setCollector(async () => {
      calls += 1;
      return pending;
    });

    const first = service.refresh();
    const second = service.refresh();
    assert.equal(first, second);
    release(batch("2026-09-01T00:00:00.000Z", [200, 100], "degraded"));
    const result = await first;

    assert.equal(calls, 1);
    assert.equal(result.status, "partial");
    const response = service.rankings();
    assert.equal(response.snapshot?.status, "partial");
    assert.equal(response.rankings.market_cap_usd.entries[0]?.symbol, "A");
    assert.equal(
      response.sources.find((source) => source.source.includes("GMGN"))?.message,
      "部分数据暂不可用。",
    );
    assert.doesNotMatch(
      JSON.stringify(response),
      /private upstream|private holder|private official/,
    );
    assert.deepEqual(service.platformLive(), {
      runId: response.snapshot?.runId,
      observedAt: "2026-09-01T00:00:00.000Z",
      tokenCount: 2,
      volumeObservedCount: 2,
      volume24hUsd: 75,
      complete: true,
    });
  });
});

test("PAIR daily reports compare against the full previous-day ranking", async () => {
  await withService(async ({ service, setNow, setCollector }) => {
    setCollector(async () => batch("2026-09-01T00:00:00.000Z", [200, 100]));
    await service.refresh();
    setNow("2026-09-01T00:10:00.000Z");
    const first = service.generateDailyReport();
    assert.equal(first.reportDate, "2026-09-01");

    setNow("2026-09-02T00:00:00.000Z");
    setCollector(async () => batch("2026-09-02T00:00:00.000Z", [150, 300]));
    await service.refresh();
    setNow("2026-09-02T00:10:00.000Z");
    const second = service.generateDailyReport();

    assert.equal(second.reportDate, "2026-09-02");
    assert.equal(second.windowStart, "2026-09-01T00:00:00.000Z");
    assert.equal(second.rankings.market_cap_usd.entries[0]?.symbol, "B");
    assert.equal(second.rankings.market_cap_usd.entries[0]?.previousRank, 2);
    assert.equal(second.rankings.market_cap_usd.entries[0]?.rankChange, 1);
    assert.equal(service.latestDailyReport()?.reportDate, "2026-09-02");
  });
});

test("PAIR service serves the last usable snapshot after a later refresh failure", async () => {
  await withService(async ({ database, service, setNow, setCollector }) => {
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
    assert.equal(service.health().latestRunError, "TypeError_unclassified");
    assert.equal(database.latestRun()?.error, "TypeError_unclassified");
  });
});
