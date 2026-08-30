import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PLATFORM_REGISTRY } from "../src/config/platforms.js";
import type { CollectionBatch } from "../src/domain/types.js";
import { DashboardService } from "../src/services/dashboard.js";
import { DashboardDatabase } from "../src/storage/database.js";

const collectedAt = "2026-08-30T01:00:00.000Z";

function ponsPlatform() {
  const platform = PLATFORM_REGISTRY.find((candidate) => candidate.id === "pons");
  assert.ok(platform);
  return platform;
}

function batch(
  sourceStatus: "ok" | "degraded" | "failed" = "ok",
  warnings: string[] = [],
): CollectionBatch {
  return {
    platforms: [ponsPlatform()],
    metrics: [
      {
        platformId: "pons",
        metric: "volume_usd",
        date: "2026-08-29",
        value: 250,
        source: "fixture.source",
        quality: sourceStatus === "ok" ? "reported" : "partial",
        scope: "fixture scope",
        derivation: null,
        collectedAt,
      },
    ],
    stats: [],
    sourceHealth: [
      {
        source: "fixture.source",
        status: sourceStatus,
        fetchedAt: collectedAt,
        latestDataDate: "2026-08-29",
        latencyMs: 10,
        message: "private upstream detail should not be public",
      },
    ],
    raw: [],
    warnings,
  };
}

async function withDatabase(run: (database: DashboardDatabase) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), "rhc-service-"));
  const database = new DashboardDatabase(join(directory, "test.sqlite"));
  try {
    await run(database);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("concurrent refresh calls share one collector promise and one run", async () => {
  await withDatabase(async (database) => {
    let calls = 0;
    let release: (value: CollectionBatch) => void = () => {
      throw new Error("collector release was not initialized");
    };
    const pending = new Promise<CollectionBatch>((resolve) => {
      release = resolve;
    });
    const service = new DashboardService(database, 15, {
      collect: async () => {
        calls += 1;
        return pending;
      },
      now: () => new Date("2026-08-30T12:00:00.000Z"),
    });

    const first = service.refresh();
    const second = service.refresh();
    assert.equal(first, second);
    assert.equal(calls, 1);

    release(batch());
    const result = await first;
    assert.equal(result.status, "success");
    assert.equal(result.targetDate, "2026-08-29");
    assert.equal(database.latestRun()?.status, "success");
  });
});

test("degraded source data remains usable while public messages are sanitized", async () => {
  await withDatabase(async (database) => {
    const service = new DashboardService(database, 15, {
      collect: async () => batch("degraded", ["secret upstream response body"]),
      now: () => new Date("2026-08-30T12:00:00.000Z"),
    });

    const result = await service.refresh();
    assert.equal(result.status, "partial");
    assert.deepEqual(result.warnings, ["One or more sources returned degraded data."]);

    const overview = service.overview(1);
    assert.equal(overview.summary.volume_usd.value, 250);
    assert.equal(overview.runStatus, "partial");
    assert.deepEqual(overview.warnings, ["One or more source results require attention."]);

    const sources = service.sources();
    assert.equal(sources.sources[0]?.message, "Source returned partial or degraded data.");
    assert.doesNotMatch(JSON.stringify(sources), /secret upstream|private upstream/);
    assert.equal(service.platformDetail("pons")?.series.volume_usd[0]?.value, 250);
    assert.equal(service.platformDetail("missing"), null);
    const meta = service.meta();
    assert.equal(meta.apiContractVersion, 1);
    assert.deepEqual(meta.supportedWindows, [1, 7, 30]);
    assert.ok(meta.coreMetrics.includes("protocol_revenue_usd"));
    assert.equal(meta.platforms.find((platform) => platform.id === "pons")?.hasRollingStats, false);
  });
});

test("zero canonical metrics fail closed and do not create a usable cache", async () => {
  await withDatabase(async (database) => {
    const empty = batch();
    empty.metrics = [];
    const service = new DashboardService(database, 15, {
      collect: async () => empty,
      now: () => new Date("2026-08-30T12:00:00.000Z"),
    });

    await assert.rejects(service.refresh(), /zero canonical metric observations/);
    assert.equal(database.latestRun()?.status, "failed");
    assert.equal(database.latestRun()?.error, "Error");
    assert.equal(database.latestUsableRun(), null);
    assert.equal(service.health().ok, false);
  });
});

test("a later refresh failure serves the last usable cache without leaking its error", async () => {
  await withDatabase(async (database) => {
    const secretMarker = "https://internal.example/token/super-secret";
    let shouldFail = false;
    let now = new Date("2026-08-30T12:00:00.000Z");
    const warnings: Array<{ event: string; context: Record<string, unknown> }> = [];
    const service = new DashboardService(database, 15, {
      collect: async () => {
        if (shouldFail) throw new TypeError(secretMarker);
        return batch();
      },
      now: () => now,
      warn: (event, context) => warnings.push({ event, context }),
    });

    await service.refresh();
    shouldFail = true;
    now = new Date("2026-09-02T12:00:00.000Z");
    await service.ensureFresh();

    const overview = service.overview(1);
    assert.equal(overview.summary.volume_usd.value, 250);
    assert.equal(overview.runStatus, "failed");
    assert.equal(overview.stale, true);
    assert.deepEqual(overview.warnings, ["Latest refresh failed; serving the last usable cache."]);
    assert.deepEqual(warnings, [
      { event: "refresh_failed_using_cache", context: { errorName: "TypeError" } },
    ]);

    const publicState = JSON.stringify({ overview, sources: service.sources() });
    assert.doesNotMatch(publicState, /internal\.example|super-secret/);
    assert.equal(service.sources().latestRun?.error, null);
    assert.equal(service.health().ok, true);
    assert.equal(service.health().latestRunStatus, "failed");
  });
});
