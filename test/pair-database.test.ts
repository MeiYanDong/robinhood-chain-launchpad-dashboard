import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { PairTokenDatabase } from "../src/pair/database.js";
import { emptyPairRankings } from "../src/pair/rank.js";
import type { PairCollectionBatch, PairLeaderboardResponse } from "../src/pair/types.js";

function batch(observedAt = "2026-09-01T00:00:00.000Z"): PairCollectionBatch {
  const address = `0x${"1".padStart(40, "0")}`;
  return {
    observedAt,
    universeCount: 10,
    eligibleCount: 1,
    warnings: [],
    sourceHealth: [
      {
        source: "pair.officialApi",
        status: "ok",
        fetchedAt: observedAt,
        latencyMs: 3,
        message: "fixture source detail",
      },
    ],
    tokens: [
      {
        address,
        name: "PAIR",
        symbol: "PAIR",
        tokenUrl: `https://pair.fund/tokens/${address}`,
        launchedAt: "2026-08-31T00:00:00.000Z",
        graduated: true,
        observedAt,
        priceUsd: 0.25,
        marketCapUsd: 100,
        liquidityDepthUsd: 50,
        volume24hUsd: 25,
        holderCount: 9,
        holderObservedAt: observedAt,
        holderSource: "gmgn.tokenInfo",
        quoteAssets: [{ address: `0x${"a".repeat(40)}`, symbol: "SPY", decimals: 18 }],
        eligible: true,
        eligibilityReason: null,
        marketDataSource: "dexscreener",
        marketDataUpdatedAt: observedAt,
      },
    ],
  };
}

function report(runId: number): PairLeaderboardResponse {
  return {
    service: "rhc-pair-token-radar",
    mode: "daily",
    generatedAt: "2026-09-01T00:10:00.000Z",
    reportDate: "2026-09-01",
    windowStart: "2026-08-31T00:00:00.000Z",
    cutoffAt: "2026-09-01T00:00:00.000Z",
    snapshot: {
      runId,
      observedAt: "2026-09-01T00:00:00.000Z",
      status: "success",
      stale: false,
      universeCount: 10,
      eligibleCount: 1,
    },
    eligibility: {
      marketCapFloorUsd: 10_000,
      liquidityDepthFloorUsd: 1_000,
      marketFreshnessMinutes: 60,
    },
    rankings: emptyPairRankings(),
    sources: [],
    warnings: [],
  };
}

async function withDatabase(run: (database: PairTokenDatabase) => void | Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), "pair-db-"));
  const database = new PairTokenDatabase(join(directory, "test.sqlite"));
  try {
    await run(database);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("PAIR SQLite stores isolated runs, eligible snapshots, holder cache, and source health", async () => {
  await withDatabase((database) => {
    const runId = database.startRun("2026-09-01T00:00:00.000Z");
    const fixture = batch();
    database.writeBatch(runId, fixture);
    database.saveUniverseAggregate(runId, fixture);
    database.completeRun(runId, "success", fixture);

    assert.equal(database.latestRun()?.status, "success");
    assert.equal(database.latestUsableRun()?.eligibleCount, 1);
    assert.equal(database.usableRunAtOrBefore("2026-09-01T00:05:00.000Z")?.id, runId);
    assert.equal(database.getSnapshots(runId)[0]?.priceUsd, 0.25);
    assert.equal(database.getSnapshots(runId)[0]?.marketCapUsd, 100);
    assert.equal(database.getSnapshots(runId)[0]?.quoteAssets?.[0]?.symbol, "SPY");
    assert.equal(database.getHolderCache().values().next().value?.holderCount, 9);
    assert.equal(database.getSourceHealth(runId)[0]?.message, "fixture source detail");
    assert.deepEqual(database.getUniverseAggregate(runId), {
      runId,
      observedAt: fixture.observedAt,
      tokenCount: 1,
      volumeObservedCount: 1,
      volume24hUsd: 25,
      complete: true,
    });
  });
});

test("PAIR SQLite adds price and quote assets to an existing snapshot table without losing rows", () => {
  const directory = mkdtempSync(join(tmpdir(), "pair-db-migration-"));
  const databasePath = join(directory, "test.sqlite");
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE pair_token_snapshots (
      run_id INTEGER NOT NULL,
      token_address TEXT NOT NULL,
      name TEXT NOT NULL,
      symbol TEXT NOT NULL,
      token_url TEXT NOT NULL,
      launched_at TEXT,
      graduated INTEGER NOT NULL,
      observed_at TEXT NOT NULL,
      market_cap_usd REAL,
      liquidity_depth_usd REAL,
      volume_24h_usd REAL,
      holder_count INTEGER,
      holder_observed_at TEXT,
      holder_source TEXT,
      eligible INTEGER NOT NULL,
      eligibility_reason TEXT,
      market_data_source TEXT,
      market_data_updated_at TEXT,
      PRIMARY KEY (run_id, token_address)
    );
    INSERT INTO pair_token_snapshots VALUES (
      1, '0x0000000000000000000000000000000000000001', 'PAIR', 'PAIR',
      'https://pair.fund', NULL, 1, '2026-09-01T00:00:00.000Z', 100, 50, 25, 9,
      '2026-09-01T00:00:00.000Z', 'fixture', 1, NULL, 'fixture',
      '2026-09-01T00:00:00.000Z'
    );
  `);
  legacy.close();

  const database = new PairTokenDatabase(databasePath);
  try {
    const snapshot = database.getSnapshots(1)[0];
    assert.equal(snapshot?.priceUsd, null);
    assert.equal(snapshot?.marketCapUsd, 100);
    assert.deepEqual(snapshot?.quoteAssets, []);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("PAIR daily reports update by report date and retain the previous-day baseline", async () => {
  await withDatabase((database) => {
    const firstRun = database.startRun("2026-09-01T00:00:00.000Z");
    const firstBatch = batch();
    database.writeBatch(firstRun, firstBatch);
    database.completeRun(firstRun, "success", firstBatch);
    database.saveDailyReport({
      reportDate: "2026-09-01",
      cutoffAt: "2026-09-01T00:00:00.000Z",
      generatedAt: "2026-09-01T00:10:00.000Z",
      runId: firstRun,
      payload: report(firstRun),
    });

    const secondRun = database.startRun("2026-09-02T00:00:00.000Z");
    const secondBatch = batch("2026-09-02T00:00:00.000Z");
    database.writeBatch(secondRun, secondBatch);
    database.completeRun(secondRun, "partial", secondBatch);
    const secondReport = { ...report(secondRun), reportDate: "2026-09-02" };
    database.saveDailyReport({
      reportDate: "2026-09-02",
      cutoffAt: "2026-09-02T00:00:00.000Z",
      generatedAt: "2026-09-02T00:10:00.000Z",
      runId: secondRun,
      payload: secondReport,
    });

    assert.equal(database.latestDailyReport()?.runId, secondRun);
    assert.equal(database.previousDailyReport("2026-09-02")?.runId, firstRun);
    assert.equal(database.getRun(secondRun)?.status, "partial");
  });
});

test("PAIR snapshot transaction fails closed when the run does not exist", async () => {
  await withDatabase((database) => {
    assert.throws(() => database.writeBatch(999, batch()), /constraint|foreign key/i);
    assert.equal(database.latestUsableRun(), null);
  });
});
