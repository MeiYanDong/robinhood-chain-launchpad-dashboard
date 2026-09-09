import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PAIR_PROTOCOL_DAILY_SOURCE } from "../src/collectors/pair-protocol.js";
import { PLATFORM_REGISTRY } from "../src/config/platforms.js";
import type { DailyMetric, SourceHealth } from "../src/domain/types.js";
import {
  DEFAULT_PAIR_DAILY_VOLUME_ALERT_SETTINGS,
  PairDailyVolumeAlertService,
  pairDailyVolumeAlertSettingsFromEnv,
  planPairDailyVolumeAlert,
} from "../src/platform-activity/alerts.js";
import { DashboardDatabase } from "../src/storage/database.js";

const previousDate = "2026-09-07";
const targetDate = "2026-09-08";
const collectedAt = "2026-09-09T00:05:00.000Z";

function metric(date: string, value: number, source = PAIR_PROTOCOL_DAILY_SOURCE): DailyMetric {
  return {
    platformId: "pair",
    metric: "volume_usd",
    date,
    value,
    source,
    quality: "reported",
    scope: "PAIR official completed UTC day",
    derivation: null,
    collectedAt,
  };
}

function healthySource(overrides: Partial<SourceHealth> = {}): SourceHealth {
  return {
    source: "pair.officialStats",
    status: "ok",
    fetchedAt: collectedAt,
    latestDataDate: targetDate,
    latencyMs: 20,
    message: "ok",
    ...overrides,
  };
}

async function withDatabase(run: (database: DashboardDatabase) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), "pair-volume-alert-"));
  const database = new DashboardDatabase(join(directory, "test.sqlite"));
  database.seedPlatforms(PLATFORM_REGISTRY);
  try {
    await run(database);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function seedDailyVolumes(database: DashboardDatabase, previous = 100, current = 110): void {
  database.writeBatch({
    platforms: [],
    metrics: [metric(previousDate, previous), metric(targetDate, current)],
    stats: [],
    sourceHealth: [healthySource()],
    raw: [],
    warnings: [],
  });
}

test("PAIR daily volume alert settings default to 10 percent and reuse the PAIR webhook", () => {
  assert.deepEqual(pairDailyVolumeAlertSettingsFromEnv({}), {
    ...DEFAULT_PAIR_DAILY_VOLUME_ALERT_SETTINGS,
  });
  const configured = pairDailyVolumeAlertSettingsFromEnv({
    PAIR_V2_FEISHU_WEBHOOK_URL: "https://open.feishu.cn/open-apis/bot/v2/hook/test",
    PAIR_DAILY_VOLUME_ALERT_THRESHOLD_PCT: "12.5",
    PAIR_DAILY_VOLUME_ALERT_RETRY_SECONDS: "60",
    PAIR_DAILY_VOLUME_ALERT_REQUEST_TIMEOUT_MS: "5000",
    PAIR_DAILY_VOLUME_ALERT_DETAIL_URL: "https://radar.example/market/",
  });
  assert.equal(configured.thresholdPct, 12.5);
  assert.equal(configured.retrySeconds, 60);
  assert.equal(configured.requestTimeoutMs, 5_000);
  assert.equal(configured.feishuWebhookUrl, "https://open.feishu.cn/open-apis/bot/v2/hook/test");
  assert.equal(configured.detailUrl, "https://radar.example/market/");
  assert.equal(
    pairDailyVolumeAlertSettingsFromEnv({
      DEV_MONITOR_FEISHU_WEBHOOK_URL:
        "https://open.feishu.cn/open-apis/bot/v2/hook/dev-monitor-test",
    }).feishuWebhookUrl,
    "https://open.feishu.cn/open-apis/bot/v2/hook/dev-monitor-test",
  );

  assert.throws(
    () =>
      pairDailyVolumeAlertSettingsFromEnv({
        PAIR_DAILY_VOLUME_FEISHU_WEBHOOK_URL: "https://example.com/hook",
      }),
    /official HTTPS Feishu\/Lark webhook/,
  );
  assert.throws(
    () => pairDailyVolumeAlertSettingsFromEnv({ PAIR_DAILY_VOLUME_ALERT_THRESHOLD_PCT: "0" }),
    /must be positive/,
  );
  assert.throws(
    () =>
      pairDailyVolumeAlertSettingsFromEnv({
        PAIR_DAILY_VOLUME_ALERT_DETAIL_URL: "http://radar.example/market/",
      }),
    /public HTTPS URL/,
  );
});

test("PAIR daily volume alert requires canonical consecutive complete days", () => {
  const base = {
    targetDate,
    metrics: [metric(previousDate, 100), metric(targetDate, 110)],
    sourceHealth: [healthySource()],
    thresholdPct: 10,
    createdAt: collectedAt,
  };

  const planned = planPairDailyVolumeAlert(base);
  assert.equal(planned.status, "sent_or_queued");
  assert.equal(planned.alert?.changePct, 10);
  assert.equal(planned.alert?.dedupeKey, "pair-daily-volume:2026-09-07:2026-09-08");

  assert.equal(
    planPairDailyVolumeAlert({ ...base, metrics: [metric(previousDate, 100)] }).status,
    "missing_consecutive_days",
  );
  assert.equal(
    planPairDailyVolumeAlert({
      ...base,
      metrics: [metric(previousDate, 0), metric(targetDate, 100)],
    }).status,
    "invalid_baseline",
  );
  assert.equal(
    planPairDailyVolumeAlert({
      ...base,
      metrics: [metric(previousDate, 100), metric(targetDate, 109.99)],
    }).status,
    "below_threshold",
  );
  assert.equal(
    planPairDailyVolumeAlert({
      ...base,
      sourceHealth: [healthySource({ status: "degraded" })],
    }).status,
    "source_unavailable",
  );
  assert.equal(
    planPairDailyVolumeAlert({
      ...base,
      metrics: [
        metric(previousDate, 100, "fallback.source"),
        metric(targetDate, 200, "fallback.source"),
      ],
    }).status,
    "missing_consecutive_days",
  );
});

test("PAIR daily volume notifier sends once and persists its dedupe state", async () => {
  await withDatabase(async (database) => {
    seedDailyVolumes(database, 5_381_262.43895861, 1_993_384.68866284);
    const requests: Array<{ url: string; body: string }> = [];
    const service = new PairDailyVolumeAlertService(
      database,
      {
        ...DEFAULT_PAIR_DAILY_VOLUME_ALERT_SETTINGS,
        feishuWebhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/test",
      },
      {
        now: () => new Date(collectedAt),
        fetcher: async (input, init) => {
          requests.push({
            url: String(input),
            body: typeof init?.body === "string" ? init.body : "",
          });
          return new Response(JSON.stringify({ code: 0 }), { status: 200 });
        },
      },
    );

    const first = await service.evaluate(targetDate);
    const second = await service.evaluate(targetDate);
    assert.equal(first.status, "sent_or_queued");
    assert.equal(first.inserted, true);
    assert.ok((first.changePct ?? 0) < -60);
    assert.equal(second.inserted, false);
    assert.equal(requests.length, 1);
    assert.doesNotMatch(requests[0]?.url ?? "", /secret/);
    const payload = JSON.parse(requests[0]?.body ?? "{}") as {
      content?: { text?: string };
    };
    assert.match(payload.content?.text ?? "", /PAIR 日交易量下降 63\.0%/);
    assert.match(payload.content?.text ?? "", /最近两个完整 UTC 日/);
    assert.match(payload.content?.text ?? "", /2026-09-08/);
    assert.deepEqual(service.health(), {
      ok: true,
      service: "rhc-pair-daily-volume-alert",
      configured: true,
      platformId: "pair",
      metric: "volume_usd",
      comparison: "last_two_complete_utc_days",
      thresholdPct: 10,
      pending: 0,
      failed: 0,
      lastSentAt: collectedAt,
    });
  });
});

test("PAIR daily volume notifier retries a failed Feishu business response", async () => {
  await withDatabase(async (database) => {
    seedDailyVolumes(database, 100, 120);
    let now = new Date(collectedAt);
    let calls = 0;
    const warnings: Array<{ event: string; context: Record<string, unknown> }> = [];
    const service = new PairDailyVolumeAlertService(
      database,
      {
        ...DEFAULT_PAIR_DAILY_VOLUME_ALERT_SETTINGS,
        feishuWebhookUrl: "https://open.larksuite.com/open-apis/bot/v2/hook/test",
      },
      {
        now: () => now,
        warn: (event, context) => warnings.push({ event, context }),
        fetcher: async () => {
          calls += 1;
          return new Response(JSON.stringify({ code: calls === 1 ? 19001 : 0 }), { status: 200 });
        },
      },
    );

    await service.evaluate(targetDate);
    assert.equal(service.health().failed, 1);
    assert.equal(warnings[0]?.event, "pair_daily_volume_alert_delivery_failed");
    await service.flush();
    assert.equal(calls, 1);

    now = new Date(now.valueOf() + 5 * 60_000);
    await service.flush();
    assert.equal(calls, 2);
    assert.equal(service.health().failed, 0);
    assert.equal(service.health().lastSentAt, now.toISOString());
  });
});

test("disabled PAIR daily volume alerts do not create a historical queue", async () => {
  await withDatabase(async (database) => {
    seedDailyVolumes(database, 100, 200);
    const service = new PairDailyVolumeAlertService(
      database,
      DEFAULT_PAIR_DAILY_VOLUME_ALERT_SETTINGS,
    );
    service.start();
    const evaluation = await service.evaluate(targetDate);
    service.stop();
    assert.equal(evaluation.status, "disabled");
    assert.equal(evaluation.inserted, false);
    assert.equal(service.health().configured, false);
    assert.equal(service.health().pending, 0);
  });
});
