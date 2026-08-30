import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PLATFORM_REGISTRY } from "../src/config/platforms.js";
import type { CollectionBatch, DailyMetric } from "../src/domain/types.js";
import { DashboardDatabase } from "../src/storage/database.js";

const collectedAt = "2026-08-30T01:00:00.000Z";

function ponsPlatform() {
  const platform = PLATFORM_REGISTRY.find((candidate) => candidate.id === "pons");
  assert.ok(platform);
  return platform;
}

function metric(platformId = "pons"): DailyMetric {
  return {
    platformId,
    metric: "volume_usd",
    date: "2026-08-29",
    value: 125,
    source: "fixture.source",
    quality: "reported",
    scope: "fixture scope",
    derivation: null,
    collectedAt,
  };
}

function completeBatch(overrides: Partial<CollectionBatch> = {}): CollectionBatch {
  return {
    platforms: [ponsPlatform()],
    metrics: [metric()],
    stats: [
      {
        platformId: "pons",
        key: "trades",
        label: "Trades",
        value: 9,
        unit: "count",
        period: "rolling_24h",
        source: "fixture.source",
        quality: "reported",
        scope: "fixture scope",
        derivation: null,
        collectedAt,
      },
    ],
    sourceHealth: [
      {
        source: "fixture.source",
        status: "ok",
        fetchedAt: collectedAt,
        latestDataDate: "2026-08-29",
        latencyMs: 12,
        message: "fixture ok",
      },
    ],
    raw: [
      {
        source: "fixture.source",
        fetchedAt: collectedAt,
        sha256: "fixture-sha",
        payload: { value: 125 },
      },
    ],
    warnings: [],
    ...overrides,
  };
}

async function withDatabase(run: (database: DashboardDatabase) => void | Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), "rhc-db-"));
  const database = new DashboardDatabase(join(directory, "test.sqlite"));
  try {
    await run(database);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("SQLite batch writes round-trip canonical records and completed run state", async () => {
  await withDatabase((database) => {
    const runId = database.startRun("2026-08-29");
    database.writeBatch(completeBatch());
    database.completeRun(runId, "success", []);

    assert.equal(database.latestRun()?.status, "success");
    assert.equal(database.latestUsableRun()?.targetDate, "2026-08-29");
    assert.equal(database.getPlatform("pons")?.name, "Pons");
    assert.deepEqual(database.getMetrics("2026-08-29", "2026-08-29"), [metric()]);
    assert.equal(database.getPlatformStats("pons")[0]?.value, 9);
    assert.equal(database.getSourceHealth()[0]?.latestDataDate, "2026-08-29");
    assert.deepEqual(database.getRawObservation("fixture.source")?.payload, { value: 125 });
  });
});

test("SQLite batch transaction rolls back all rows after a foreign-key failure", async () => {
  await withDatabase((database) => {
    const invalidBatch = completeBatch({ metrics: [metric("missing-platform")] });

    assert.throws(() => database.writeBatch(invalidBatch), /constraint|foreign key/i);
    assert.equal(database.getPlatform("pons"), null);
    assert.deepEqual(database.getMetrics("2026-08-29", "2026-08-29"), []);
    assert.deepEqual(database.getSourceHealth(), []);
  });
});

test("failed collection runs never replace the last usable cache", async () => {
  await withDatabase((database) => {
    const firstFailure = database.startRun("2026-08-28");
    database.completeRun(firstFailure, "failed", [], "Error");
    assert.equal(database.latestUsableRun(), null);

    const success = database.startRun("2026-08-29");
    database.completeRun(success, "success", ["fixture warning"]);
    const laterFailure = database.startRun("2026-08-30");
    database.completeRun(laterFailure, "failed", [], "TypeError");

    assert.equal(database.latestRun()?.id, laterFailure);
    assert.equal(database.latestRun()?.error, "TypeError");
    assert.equal(database.latestUsableRun()?.id, success);
    assert.deepEqual(database.latestUsableRun()?.warnings, ["fixture warning"]);
  });
});
