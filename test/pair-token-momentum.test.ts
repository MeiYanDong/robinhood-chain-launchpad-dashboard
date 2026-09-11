import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PLATFORM_REGISTRY } from "../src/config/platforms.js";
import { PairTokenDatabase } from "../src/pair/database.js";
import type { PairCollectionBatch } from "../src/pair/types.js";
import {
  DEFAULT_PAIR_DAILY_VOLUME_ALERT_SETTINGS,
  PairDailyVolumeAlertService,
} from "../src/platform-activity/alerts.js";
import {
  initialPairTokenMomentumState,
  PAIR_PROTOCOL_TOKEN_ADDRESS,
  planPairTokenMomentum,
  type PairTokenMomentumSnapshot,
} from "../src/platform-activity/token-momentum.js";
import { DashboardDatabase } from "../src/storage/database.js";

const startAt = Date.parse("2026-09-11T00:00:00.000Z");

function snapshot(
  index: number,
  priceUsd: number,
  volume24hUsd: number,
): PairTokenMomentumSnapshot {
  const observedAt = new Date(startAt + index * 15 * 60_000).toISOString();
  return {
    runId: index + 1,
    observedAt,
    tokenAddress: PAIR_PROTOCOL_TOKEN_ADDRESS,
    priceUsd,
    volume24hUsd,
    marketCapUsd: priceUsd * 888_888_888,
    liquidityDepthUsd: 150_000,
    marketDataUpdatedAt: observedAt,
    sourceStatus: "ok",
  };
}

function candidateSnapshots(): PairTokenMomentumSnapshot[] {
  return [
    snapshot(0, 1, 100_000),
    snapshot(1, 1, 100_000),
    snapshot(2, 1, 100_000),
    snapshot(3, 1.09, 125_000),
    snapshot(4, 1.1, 130_000),
  ];
}

test("PAIR token momentum establishes a live baseline before sending a confirmed alert", () => {
  const firstNow = new Date(startAt + 4 * 15 * 60_000 + 5 * 60_000);
  const first = planPairTokenMomentum({
    snapshots: candidateSnapshots(),
    previousState: initialPairTokenMomentumState(firstNow.toISOString()),
    settings: DEFAULT_PAIR_DAILY_VOLUME_ALERT_SETTINGS.tokenMomentum,
    now: firstNow,
  });
  assert.equal(first.status, "baseline");
  assert.equal(first.alert, null);
  assert.equal(first.nextState.state, "watch");
  assert.equal(first.nextState.candidateStreak, 1);

  const secondNow = new Date(startAt + 5 * 15 * 60_000 + 5 * 60_000);
  const second = planPairTokenMomentum({
    snapshots: [...candidateSnapshots(), snapshot(5, 1.12, 135_000)],
    previousState: first.nextState,
    settings: DEFAULT_PAIR_DAILY_VOLUME_ALERT_SETTINGS.tokenMomentum,
    now: secondNow,
  });
  assert.equal(second.status, "sent_or_queued");
  assert.equal(second.nextState.state, "active");
  assert.ok(Math.abs((second.alert?.priceOneHourChangePct ?? 0) - 12) < 1e-9);
  assert.equal(second.alert?.volumeOneHourChangePct, 35);
  assert.equal(second.alert?.volumeDeltaUsd, 35_000);
  assert.match(second.alert?.dedupeKey ?? "", /^pair-token-momentum:/);

  const duplicate = planPairTokenMomentum({
    snapshots: [...candidateSnapshots(), snapshot(5, 1.12, 135_000)],
    previousState: second.nextState,
    settings: DEFAULT_PAIR_DAILY_VOLUME_ALERT_SETTINGS.tokenMomentum,
    now: secondNow,
  });
  assert.equal(duplicate.status, "duplicate");
  assert.equal(duplicate.alert, null);
});

test("PAIR token momentum requires price, volume percentage, and dollar materiality together", () => {
  const now = new Date(startAt + 4 * 15 * 60_000 + 5 * 60_000);
  const initial = initialPairTokenMomentumState(now.toISOString());
  const priceOnly = candidateSnapshots();
  priceOnly[4] = snapshot(4, 1.1, 110_000);
  const priceOnlyPlan = planPairTokenMomentum({
    snapshots: priceOnly,
    previousState: initial,
    settings: DEFAULT_PAIR_DAILY_VOLUME_ALERT_SETTINGS.tokenMomentum,
    now,
  });
  assert.equal(priceOnlyPlan.nextState.state, "cold");

  const volumeOnly = candidateSnapshots();
  volumeOnly[4] = snapshot(4, 1.02, 130_000);
  const volumeOnlyPlan = planPairTokenMomentum({
    snapshots: volumeOnly,
    previousState: initial,
    settings: DEFAULT_PAIR_DAILY_VOLUME_ALERT_SETTINGS.tokenMomentum,
    now,
  });
  assert.equal(volumeOnlyPlan.nextState.state, "cold");

  const stale = candidateSnapshots();
  const latest = stale.at(-1);
  if (latest) latest.marketDataUpdatedAt = new Date(startAt).toISOString();
  const stalePlan = planPairTokenMomentum({
    snapshots: stale,
    previousState: initial,
    settings: DEFAULT_PAIR_DAILY_VOLUME_ALERT_SETTINGS.tokenMomentum,
    now,
  });
  assert.equal(stalePlan.status, "data_unreliable");
  assert.equal(stalePlan.nextState.qualityStatus, "stale");
});

function batch(item: PairTokenMomentumSnapshot): PairCollectionBatch {
  return {
    observedAt: item.observedAt,
    universeCount: 1,
    eligibleCount: 1,
    warnings: [],
    sourceHealth: [
      {
        source: "pair.officialApi",
        status: item.sourceStatus,
        fetchedAt: item.observedAt,
        latencyMs: 1,
        message: "ok",
      },
    ],
    tokens: [
      {
        address: PAIR_PROTOCOL_TOKEN_ADDRESS,
        name: "PAIR",
        symbol: "PAIR",
        tokenUrl: `https://pair.fund/tokens/${PAIR_PROTOCOL_TOKEN_ADDRESS}`,
        launchedAt: null,
        graduated: true,
        observedAt: item.observedAt,
        priceUsd: item.priceUsd,
        marketCapUsd: item.marketCapUsd,
        liquidityDepthUsd: item.liquidityDepthUsd,
        volume24hUsd: item.volume24hUsd,
        holderCount: null,
        holderObservedAt: null,
        holderSource: null,
        eligible: true,
        eligibilityReason: null,
        marketDataSource: "pair.officialApi",
        marketDataUpdatedAt: item.marketDataUpdatedAt,
      },
    ],
  };
}

function writeSnapshot(database: PairTokenDatabase, item: PairTokenMomentumSnapshot): void {
  const runId = database.startRun(item.observedAt);
  const payload = batch(item);
  database.writeBatch(runId, payload);
  database.completeRun(runId, "success", payload);
}

test("PAIR token momentum service persists one alert and records Feishu acceptance", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pair-token-momentum-"));
  const databasePath = join(directory, "test.sqlite");
  const dashboard = new DashboardDatabase(databasePath);
  const pair = new PairTokenDatabase(databasePath);
  dashboard.seedPlatforms(PLATFORM_REGISTRY);
  for (const item of candidateSnapshots()) writeSnapshot(pair, item);

  let now = new Date(startAt + 4 * 15 * 60_000 + 5 * 60_000);
  const requests: string[] = [];
  const service = new PairDailyVolumeAlertService(
    dashboard,
    {
      ...DEFAULT_PAIR_DAILY_VOLUME_ALERT_SETTINGS,
      feishuWebhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/test",
    },
    {
      now: () => now,
      fetcher: async (_input, init) => {
        requests.push(typeof init?.body === "string" ? init.body : "");
        return new Response(JSON.stringify({ code: 0 }), { status: 200 });
      },
    },
  );

  try {
    const baseline = await service.evaluateTokenMomentum();
    assert.equal(baseline.status, "baseline");
    assert.equal(requests.length, 0);

    const next = snapshot(5, 1.12, 135_000);
    writeSnapshot(pair, next);
    now = new Date(Date.parse(next.observedAt) + 5 * 60_000);
    const confirmed = await service.evaluateTokenMomentum();
    const duplicate = await service.evaluateTokenMomentum();
    assert.equal(confirmed.status, "sent_or_queued");
    assert.equal(confirmed.inserted, true);
    assert.equal(duplicate.status, "duplicate");
    assert.equal(requests.length, 1);
    assert.match(requests[0] ?? "", /PAIR 代币放量上涨/);
    assert.match(requests[0] ?? "", /滚动 24H 窗口/);
    const health = service.health().tokenMomentum;
    assert.equal(health.state?.state, "active");
    assert.equal(health.pending, 0);
    assert.equal(health.failed, 0);
    assert.equal(health.lastSentAt, now.toISOString());
  } finally {
    service.stop();
    pair.close();
    dashboard.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
