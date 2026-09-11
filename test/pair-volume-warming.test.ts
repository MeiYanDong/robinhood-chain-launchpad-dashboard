import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PAIR_PROTOCOL_DAILY_SOURCE } from "../src/collectors/pair-protocol.js";
import { PLATFORM_REGISTRY } from "../src/config/platforms.js";
import type { DailyMetric } from "../src/domain/types.js";
import { PairTokenDatabase } from "../src/pair/database.js";
import type { PairCollectionBatch } from "../src/pair/types.js";
import {
  DEFAULT_PAIR_DAILY_VOLUME_ALERT_SETTINGS,
  PairDailyVolumeAlertService,
} from "../src/platform-activity/alerts.js";
import {
  initialPairWarmingState,
  planPairVolumeWarming,
  type PairCompletedDailyVolume,
  type PairRollingVolumeSnapshot,
} from "../src/platform-activity/warming.js";
import { DashboardDatabase } from "../src/storage/database.js";

const startAt = Date.parse("2026-09-11T00:00:00.000Z");
const daily: PairCompletedDailyVolume[] = Array.from({ length: 7 }, (_, index) => ({
  date: `2026-09-${String(index + 4).padStart(2, "0")}`,
  valueUsd: 5_000,
}));

function snapshots(values: number[]): PairRollingVolumeSnapshot[] {
  return values.map((volume24hUsd, index) => ({
    runId: index + 1,
    observedAt: new Date(startAt + index * 15 * 60_000).toISOString(),
    tokenCount: 100,
    volumeObservedCount: 20,
    volume24hUsd,
    sourceStatus: "ok",
  }));
}

function warmingSeries(last = 1_320, previous = 1_300): PairRollingVolumeSnapshot[] {
  return snapshots([...Array.from({ length: 23 }, () => 1_000), previous, last]);
}

test("PAIR warming planner requires two material snapshots and emits one explainable alert", () => {
  const now = new Date("2026-09-11T06:05:00.000Z");
  const plan = planPairVolumeWarming({
    snapshots: warmingSeries(),
    daily,
    previousState: initialPairWarmingState(now.toISOString()),
    settings: DEFAULT_PAIR_DAILY_VOLUME_ALERT_SETTINGS.warming,
    now,
  });

  assert.equal(plan.status, "sent_or_queued");
  assert.equal(plan.nextState.state, "warming");
  assert.equal(plan.nextState.candidateStreak, 2);
  assert.equal(plan.alert?.level, "warming");
  assert.ok((plan.alert?.oneHourChangePct ?? 0) >= 30);
  assert.ok((plan.alert?.sixHourLowChangePct ?? 0) >= 30);
  assert.equal(plan.alert?.volumeObservedCount, 20);
  assert.equal(plan.alert?.tokenCount, 100);
});

test("PAIR warming planner keeps a single spike in watch and rejects unstable coverage", () => {
  const now = new Date("2026-09-11T06:05:00.000Z");
  const oneSpike = planPairVolumeWarming({
    snapshots: warmingSeries(1_320, 1_000),
    daily,
    previousState: initialPairWarmingState(now.toISOString()),
    settings: DEFAULT_PAIR_DAILY_VOLUME_ALERT_SETTINGS.warming,
    now,
  });
  assert.equal(oneSpike.status, "watch");
  assert.equal(oneSpike.nextState.state, "watch");
  assert.equal(oneSpike.alert, null);

  const unstable = warmingSeries();
  const latest = unstable.at(-1);
  if (latest) latest.volumeObservedCount = 10;
  const rejected = planPairVolumeWarming({
    snapshots: unstable,
    daily,
    previousState: initialPairWarmingState(now.toISOString()),
    settings: DEFAULT_PAIR_DAILY_VOLUME_ALERT_SETTINGS.warming,
    now,
  });
  assert.equal(rejected.status, "data_unreliable");
  assert.equal(rejected.nextState.qualityStatus, "unstable_coverage");
});

test("PAIR warming planner upgrades once and rearms only after four clear samples", () => {
  const now = new Date("2026-09-11T06:05:00.000Z");
  const active = {
    ...initialPairWarmingState("2026-09-11T05:30:00.000Z"),
    state: "warming" as const,
    episodeStartedAt: "2026-09-11T05:15:00.000Z",
    episodePeakValueUsd: 1_300,
    notifiedValueUsd: 1_300,
    lastEvaluatedAt: "2026-09-11T05:30:00.000Z",
  };
  const upgraded = planPairVolumeWarming({
    snapshots: warmingSeries(1_750, 1_700),
    daily,
    previousState: active,
    settings: DEFAULT_PAIR_DAILY_VOLUME_ALERT_SETTINGS.warming,
    now,
  });
  assert.equal(upgraded.status, "sent_or_queued");
  assert.equal(upgraded.nextState.state, "strong");
  assert.equal(upgraded.alert?.level, "strong");

  const cooling = {
    ...active,
    clearStreak: 3,
  };
  const rearmed = planPairVolumeWarming({
    snapshots: snapshots(Array.from({ length: 25 }, () => 1_000)),
    daily,
    previousState: cooling,
    settings: DEFAULT_PAIR_DAILY_VOLUME_ALERT_SETTINGS.warming,
    now,
  });
  assert.equal(rearmed.status, "cold");
  assert.equal(rearmed.nextState.state, "cold");
  assert.equal(rearmed.nextState.clearStreak, 0);
  assert.equal(rearmed.nextState.episodeStartedAt, null);
});

function dailyMetric(date: string, value: number): DailyMetric {
  return {
    platformId: "pair",
    metric: "volume_usd",
    date,
    value,
    source: PAIR_PROTOCOL_DAILY_SOURCE,
    quality: "reported",
    scope: "PAIR official completed UTC day",
    derivation: null,
    collectedAt: "2026-09-11T06:00:00.000Z",
  };
}

function pairBatch(observedAt: string, volume24hUsd: number): PairCollectionBatch {
  const address = `0x${"1".repeat(40)}`;
  return {
    observedAt,
    universeCount: 1,
    eligibleCount: 1,
    warnings: [],
    sourceHealth: [
      {
        source: "pair.officialApi",
        status: "ok",
        fetchedAt: observedAt,
        latencyMs: 1,
        message: "ok",
      },
    ],
    tokens: [
      {
        address,
        name: "Fixture",
        symbol: "FIX",
        tokenUrl: `https://pair.fund/tokens/${address}`,
        launchedAt: observedAt,
        graduated: true,
        observedAt,
        priceUsd: 1,
        marketCapUsd: 10_000,
        liquidityDepthUsd: 5_000,
        volume24hUsd,
        holderCount: 10,
        holderObservedAt: observedAt,
        holderSource: "fixture",
        eligible: true,
        eligibilityReason: null,
        marketDataSource: "pair.officialApi",
        marketDataUpdatedAt: observedAt,
      },
    ],
  };
}

test("PAIR warming service persists state, sends once, and exposes delivery health", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pair-warming-service-"));
  const databasePath = join(directory, "test.sqlite");
  const dashboard = new DashboardDatabase(databasePath);
  const pair = new PairTokenDatabase(databasePath);
  dashboard.seedPlatforms(PLATFORM_REGISTRY);
  dashboard.writeBatch({
    platforms: [],
    metrics: daily.map((item) => dailyMetric(item.date, item.valueUsd)),
    stats: [],
    sourceHealth: [],
    raw: [],
    warnings: [],
  });
  for (const snapshot of warmingSeries()) {
    const runId = pair.startRun(snapshot.observedAt);
    const batch = pairBatch(snapshot.observedAt, snapshot.volume24hUsd);
    pair.writeBatch(runId, batch);
    pair.saveUniverseAggregate(runId, batch);
    pair.completeRun(runId, "success", batch);
  }

  const requests: string[] = [];
  const now = new Date("2026-09-11T06:05:00.000Z");
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
    const first = await service.evaluateWarming();
    const duplicate = await service.evaluateWarming();
    assert.equal(first.status, "sent_or_queued");
    assert.equal(first.inserted, true);
    assert.equal(duplicate.status, "duplicate");
    assert.equal(requests.length, 1);
    assert.match(requests[0] ?? "", /PAIR 平台交易量回温/);
    assert.match(requests[0] ?? "", /滚动 24H 已观测下限/);
    const health = service.health();
    assert.equal(health.warming.state?.state, "warming");
    assert.equal(health.warming.pending, 0);
    assert.equal(health.warming.failed, 0);
    assert.equal(health.warming.lastSentAt, now.toISOString());
  } finally {
    service.stop();
    pair.close();
    dashboard.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
