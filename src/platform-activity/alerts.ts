import type { DailyMetric, SourceHealth } from "../domain/types.js";
import type { DashboardDatabase, PlatformVolumeAlertOutboxRow } from "../storage/database.js";
import { shiftUtcDate } from "../utils/time.js";
import { PAIR_PROTOCOL_DAILY_SOURCE } from "../collectors/pair-protocol.js";

const PAIR_PLATFORM_ID = "pair";
const PAIR_SOURCE_HEALTH_ID = "pair.officialStats";

export interface PairDailyVolumeAlertSettings {
  thresholdPct: number;
  requestTimeoutMs: number;
  retrySeconds: number;
  feishuWebhookUrl: string | null;
  detailUrl: string;
}

export const DEFAULT_PAIR_DAILY_VOLUME_ALERT_SETTINGS: PairDailyVolumeAlertSettings = {
  thresholdPct: 10,
  requestTimeoutMs: 20_000,
  retrySeconds: 300,
  feishuWebhookUrl: null,
  detailUrl: "https://47.251.99.37/launchpads/?view=platforms",
};

export interface PlatformVolumeAlert {
  dedupeKey: string;
  platformId: "pair";
  metric: "volume_usd";
  previousDate: string;
  currentDate: string;
  previousValue: number;
  currentValue: number;
  changePct: number;
  thresholdPct: number;
  source: string;
  createdAt: string;
}

export interface PairDailyVolumeAlertEvaluation {
  status:
    | "sent_or_queued"
    | "below_threshold"
    | "source_unavailable"
    | "missing_consecutive_days"
    | "invalid_baseline"
    | "disabled";
  targetDate: string | null;
  previousDate: string | null;
  changePct: number | null;
  inserted: boolean;
}

export interface PairDailyVolumeAlertHealth {
  ok: boolean;
  service: "rhc-pair-daily-volume-alert";
  configured: boolean;
  platformId: "pair";
  metric: "volume_usd";
  comparison: "last_two_complete_utc_days";
  thresholdPct: number;
  pending: number;
  failed: number;
  lastSentAt: string | null;
}

export interface PairDailyVolumeAlertDependencies {
  fetcher?: typeof fetch;
  now?: () => Date;
  warn?: (event: string, context: Record<string, unknown>) => void;
}

function positiveNumber(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be positive`);
  return parsed;
}

function optionalWebhook(value: string | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  const url = new URL(normalized);
  if (
    url.protocol !== "https:" ||
    !["open.feishu.cn", "open.larksuite.com"].includes(url.hostname)
  ) {
    throw new Error(
      "PAIR_DAILY_VOLUME_FEISHU_WEBHOOK_URL must be an official HTTPS Feishu/Lark webhook",
    );
  }
  return url.href;
}

function httpsDetailUrl(value: string | undefined): string {
  const normalized = value?.trim() || DEFAULT_PAIR_DAILY_VOLUME_ALERT_SETTINGS.detailUrl;
  const url = new URL(normalized);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("PAIR_DAILY_VOLUME_ALERT_DETAIL_URL must be a public HTTPS URL");
  }
  return url.href;
}

export function pairDailyVolumeAlertSettingsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): PairDailyVolumeAlertSettings {
  return {
    thresholdPct: positiveNumber(
      env.PAIR_DAILY_VOLUME_ALERT_THRESHOLD_PCT,
      DEFAULT_PAIR_DAILY_VOLUME_ALERT_SETTINGS.thresholdPct,
      "PAIR_DAILY_VOLUME_ALERT_THRESHOLD_PCT",
    ),
    requestTimeoutMs: positiveNumber(
      env.PAIR_DAILY_VOLUME_ALERT_REQUEST_TIMEOUT_MS,
      DEFAULT_PAIR_DAILY_VOLUME_ALERT_SETTINGS.requestTimeoutMs,
      "PAIR_DAILY_VOLUME_ALERT_REQUEST_TIMEOUT_MS",
    ),
    retrySeconds: positiveNumber(
      env.PAIR_DAILY_VOLUME_ALERT_RETRY_SECONDS,
      DEFAULT_PAIR_DAILY_VOLUME_ALERT_SETTINGS.retrySeconds,
      "PAIR_DAILY_VOLUME_ALERT_RETRY_SECONDS",
    ),
    feishuWebhookUrl: optionalWebhook(
      env.PAIR_DAILY_VOLUME_FEISHU_WEBHOOK_URL ??
        env.PAIR_V2_FEISHU_WEBHOOK_URL ??
        env.DEV_MONITOR_FEISHU_WEBHOOK_URL,
    ),
    detailUrl: httpsDetailUrl(env.PAIR_DAILY_VOLUME_ALERT_DETAIL_URL),
  };
}

function metricForDate(metrics: DailyMetric[], date: string): DailyMetric | null {
  return (
    metrics.find(
      (metric) =>
        metric.platformId === PAIR_PLATFORM_ID &&
        metric.metric === "volume_usd" &&
        metric.date === date &&
        metric.source === PAIR_PROTOCOL_DAILY_SOURCE,
    ) ?? null
  );
}

export function planPairDailyVolumeAlert(input: {
  targetDate: string;
  metrics: DailyMetric[];
  sourceHealth: SourceHealth[];
  thresholdPct: number;
  createdAt: string;
}): { alert: PlatformVolumeAlert | null; status: PairDailyVolumeAlertEvaluation["status"] } {
  const source = input.sourceHealth.find((item) => item.source === PAIR_SOURCE_HEALTH_ID);
  if (source?.status !== "ok" || source.latestDataDate !== input.targetDate) {
    return { alert: null, status: "source_unavailable" };
  }

  const previousDate = shiftUtcDate(input.targetDate, -1);
  const previous = metricForDate(input.metrics, previousDate);
  const current = metricForDate(input.metrics, input.targetDate);
  if (!previous || !current) return { alert: null, status: "missing_consecutive_days" };
  if (!Number.isFinite(previous.value) || previous.value <= 0 || !Number.isFinite(current.value)) {
    return { alert: null, status: "invalid_baseline" };
  }

  const changePct = ((current.value - previous.value) / previous.value) * 100;
  if (Math.abs(changePct) < input.thresholdPct) {
    return { alert: null, status: "below_threshold" };
  }

  return {
    status: "sent_or_queued",
    alert: {
      dedupeKey: `pair-daily-volume:${previousDate}:${input.targetDate}`,
      platformId: PAIR_PLATFORM_ID,
      metric: "volume_usd",
      previousDate,
      currentDate: input.targetDate,
      previousValue: previous.value,
      currentValue: current.value,
      changePct,
      thresholdPct: input.thresholdPct,
      source: current.source,
      createdAt: input.createdAt,
    },
  };
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatChange(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function notificationText(alert: PlatformVolumeAlertOutboxRow, detailUrl: string): string {
  const direction = alert.changePct >= 0 ? "上升" : "下降";
  return [
    `[RHC Radar｜PAIR 日交易量${direction} ${Math.abs(alert.changePct).toFixed(1)}%]`,
    `${alert.currentDate}：${formatUsd(alert.currentValue)}`,
    `${alert.previousDate}：${formatUsd(alert.previousValue)}`,
    `日变化：${formatChange(alert.changePct)}（触发线 ±${alert.thresholdPct.toFixed(1)}%）`,
    "口径：PAIR 官方统计，最近两个完整 UTC 日；不是滚动 24H。",
    `看板：${detailUrl}`,
  ].join("\n");
}

export class PairDailyVolumeAlertService {
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;
  private readonly warn: (event: string, context: Record<string, unknown>) => void;
  private timer: NodeJS.Timeout | null = null;
  private flushPromise: Promise<void> | null = null;

  constructor(
    private readonly database: DashboardDatabase,
    private readonly settings: PairDailyVolumeAlertSettings,
    dependencies: PairDailyVolumeAlertDependencies = {},
  ) {
    this.fetcher = dependencies.fetcher ?? fetch;
    this.now = dependencies.now ?? (() => new Date());
    this.warn = dependencies.warn ?? ((event, context) => console.warn(event, context));
  }

  start(): void {
    if (this.timer) return;
    void this.flush();
    this.timer = setInterval(() => void this.flush(), this.settings.retrySeconds * 1_000);
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async evaluate(targetDate: string | null): Promise<PairDailyVolumeAlertEvaluation> {
    if (!targetDate) {
      return {
        status: "missing_consecutive_days",
        targetDate: null,
        previousDate: null,
        changePct: null,
        inserted: false,
      };
    }
    if (!this.settings.feishuWebhookUrl) {
      return {
        status: "disabled",
        targetDate,
        previousDate: shiftUtcDate(targetDate, -1),
        changePct: null,
        inserted: false,
      };
    }

    const previousDate = shiftUtcDate(targetDate, -1);
    const plan = planPairDailyVolumeAlert({
      targetDate,
      metrics: this.database.getMetrics(previousDate, targetDate, PAIR_PLATFORM_ID),
      sourceHealth: this.database.getSourceHealth(),
      thresholdPct: this.settings.thresholdPct,
      createdAt: this.now().toISOString(),
    });
    const inserted = plan.alert ? this.database.enqueuePlatformVolumeAlert(plan.alert) : false;
    await this.flush();
    return {
      status: plan.status,
      targetDate,
      previousDate,
      changePct: plan.alert?.changePct ?? null,
      inserted,
    };
  }

  health(): PairDailyVolumeAlertHealth {
    const summary = this.database.platformVolumeAlertSummary();
    return {
      ok: this.settings.feishuWebhookUrl !== null,
      service: "rhc-pair-daily-volume-alert",
      configured: this.settings.feishuWebhookUrl !== null,
      platformId: PAIR_PLATFORM_ID,
      metric: "volume_usd",
      comparison: "last_two_complete_utc_days",
      thresholdPct: this.settings.thresholdPct,
      ...summary,
    };
  }

  flush(): Promise<void> {
    if (!this.flushPromise) {
      this.flushPromise = this.flushNow().finally(() => {
        this.flushPromise = null;
      });
    }
    return this.flushPromise;
  }

  private async flushNow(): Promise<void> {
    if (!this.settings.feishuWebhookUrl) return;
    const now = this.now();
    for (const alert of this.database.pendingPlatformVolumeAlerts(now.toISOString(), 5)) {
      try {
        await this.send(alert);
        this.database.markPlatformVolumeAlertSent(alert.id, this.now().toISOString());
      } catch (error) {
        this.database.markPlatformVolumeAlertFailed(
          alert.id,
          error instanceof Error ? `${error.name}: ${error.message}` : "UnknownNotificationError",
          this.now(),
          alert.attempts,
        );
        this.warn("pair_daily_volume_alert_delivery_failed", {
          errorName: error instanceof Error ? error.name : "UnknownNotificationError",
          currentDate: alert.currentDate,
        });
      }
    }
  }

  private async send(alert: PlatformVolumeAlertOutboxRow): Promise<void> {
    if (!this.settings.feishuWebhookUrl) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.settings.requestTimeoutMs);
    try {
      const response = await this.fetcher(this.settings.feishuWebhookUrl, {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          msg_type: "text",
          content: { text: notificationText(alert, this.settings.detailUrl) },
        }),
      });
      if (!response.ok) throw new Error(`Feishu webhook HTTP ${String(response.status)}`);
      const payload = (await response.json()) as { code?: number; StatusCode?: number };
      const code = payload.code ?? payload.StatusCode ?? 0;
      if (code !== 0) throw new Error(`Feishu webhook business code ${String(code)}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}
