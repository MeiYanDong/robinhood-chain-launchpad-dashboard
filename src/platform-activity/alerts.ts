import type { DailyMetric, SourceHealth } from "../domain/types.js";
import type { DashboardDatabase, PlatformVolumeAlertOutboxRow } from "../storage/database.js";
import { shiftUtcDate } from "../utils/time.js";
import { PAIR_PROTOCOL_DAILY_SOURCE } from "../collectors/pair-protocol.js";
import {
  DEFAULT_PAIR_WARMING_ALERT_SETTINGS,
  initialPairWarmingState,
  planPairVolumeWarming,
  type PairWarmingAlert,
  type PairWarmingAlertSettings,
  type PairWarmingPlan,
} from "./warming.js";
import {
  DEFAULT_PAIR_TOKEN_MOMENTUM_SETTINGS,
  initialPairTokenMomentumState,
  PAIR_PROTOCOL_TOKEN_ADDRESS,
  planPairTokenMomentum,
  type PairTokenMomentumAlert,
  type PairTokenMomentumPlan,
  type PairTokenMomentumSettings,
} from "./token-momentum.js";

const PAIR_PLATFORM_ID = "pair";
const PAIR_SOURCE_HEALTH_ID = "pair.officialStats";

export interface PairDailyVolumeAlertSettings {
  thresholdPct: number;
  requestTimeoutMs: number;
  retrySeconds: number;
  feishuWebhookUrl: string | null;
  detailUrl: string;
  warming: PairWarmingAlertSettings;
  tokenMomentum: PairTokenMomentumSettings;
}

export const DEFAULT_PAIR_DAILY_VOLUME_ALERT_SETTINGS: PairDailyVolumeAlertSettings = {
  thresholdPct: 10,
  requestTimeoutMs: 20_000,
  retrySeconds: 300,
  feishuWebhookUrl: null,
  detailUrl: "https://47.251.99.37/launchpads/?view=platforms",
  warming: DEFAULT_PAIR_WARMING_ALERT_SETTINGS,
  tokenMomentum: DEFAULT_PAIR_TOKEN_MOMENTUM_SETTINGS,
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
  warming: {
    configured: boolean;
    evaluationCadenceMinutes: 15;
    comparison: "rolling_24h_recovery";
    oneHourThresholdPct: number;
    sixHourLowThresholdPct: number;
    consecutiveSamples: number;
    rearmSamples: number;
    upgradeThresholdPct: number;
    state: ReturnType<DashboardDatabase["getPairWarmingState"]>;
    pending: number;
    failed: number;
    lastSentAt: string | null;
  };
  tokenMomentum: {
    configured: boolean;
    evaluationCadenceMinutes: 15;
    tokenAddress: string;
    comparison: "price_and_rolling_24h_volume_vs_one_hour";
    priceOneHourThresholdPct: number;
    volumeOneHourThresholdPct: number;
    minimumVolumeDeltaUsd: number;
    consecutiveSamples: number;
    rearmSamples: number;
    state: ReturnType<DashboardDatabase["getPairTokenMomentumState"]>;
    pending: number;
    failed: number;
    lastSentAt: string | null;
  };
}

export interface PairWarmingAlertEvaluation {
  status: PairWarmingPlan["status"] | "disabled";
  inserted: boolean;
  state: ReturnType<DashboardDatabase["getPairWarmingState"]>;
}

export interface PairTokenMomentumAlertEvaluation {
  status: PairTokenMomentumPlan["status"] | "disabled";
  inserted: boolean;
  state: ReturnType<DashboardDatabase["getPairTokenMomentumState"]>;
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

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = positiveNumber(value, fallback, name);
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer`);
  return parsed;
}

function booleanValue(value: string | undefined, fallback: boolean, name: string): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
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
    warming: {
      enabled: booleanValue(
        env.PAIR_VOLUME_WARMING_ALERT_ENABLED,
        DEFAULT_PAIR_WARMING_ALERT_SETTINGS.enabled,
        "PAIR_VOLUME_WARMING_ALERT_ENABLED",
      ),
      oneHourThresholdPct: positiveNumber(
        env.PAIR_VOLUME_WARMING_ONE_HOUR_PCT,
        DEFAULT_PAIR_WARMING_ALERT_SETTINGS.oneHourThresholdPct,
        "PAIR_VOLUME_WARMING_ONE_HOUR_PCT",
      ),
      sixHourLowThresholdPct: positiveNumber(
        env.PAIR_VOLUME_WARMING_SIX_HOUR_PCT,
        DEFAULT_PAIR_WARMING_ALERT_SETTINGS.sixHourLowThresholdPct,
        "PAIR_VOLUME_WARMING_SIX_HOUR_PCT",
      ),
      consecutiveSamples: positiveInteger(
        env.PAIR_VOLUME_WARMING_CONSECUTIVE_SAMPLES,
        DEFAULT_PAIR_WARMING_ALERT_SETTINGS.consecutiveSamples,
        "PAIR_VOLUME_WARMING_CONSECUTIVE_SAMPLES",
      ),
      rearmSamples: positiveInteger(
        env.PAIR_VOLUME_WARMING_REARM_SAMPLES,
        DEFAULT_PAIR_WARMING_ALERT_SETTINGS.rearmSamples,
        "PAIR_VOLUME_WARMING_REARM_SAMPLES",
      ),
      upgradeThresholdPct: positiveNumber(
        env.PAIR_VOLUME_WARMING_UPGRADE_PCT,
        DEFAULT_PAIR_WARMING_ALERT_SETTINGS.upgradeThresholdPct,
        "PAIR_VOLUME_WARMING_UPGRADE_PCT",
      ),
      freshnessMinutes: positiveNumber(
        env.PAIR_VOLUME_WARMING_FRESHNESS_MINUTES,
        DEFAULT_PAIR_WARMING_ALERT_SETTINGS.freshnessMinutes,
        "PAIR_VOLUME_WARMING_FRESHNESS_MINUTES",
      ),
      tokenCountDriftPct: positiveNumber(
        env.PAIR_VOLUME_WARMING_TOKEN_DRIFT_PCT,
        DEFAULT_PAIR_WARMING_ALERT_SETTINGS.tokenCountDriftPct,
        "PAIR_VOLUME_WARMING_TOKEN_DRIFT_PCT",
      ),
      observedCountDriftPct: positiveNumber(
        env.PAIR_VOLUME_WARMING_OBSERVED_DRIFT_PCT,
        DEFAULT_PAIR_WARMING_ALERT_SETTINGS.observedCountDriftPct,
        "PAIR_VOLUME_WARMING_OBSERVED_DRIFT_PCT",
      ),
      materialMedianPct: positiveNumber(
        env.PAIR_VOLUME_WARMING_MATERIAL_MEDIAN_PCT,
        DEFAULT_PAIR_WARMING_ALERT_SETTINGS.materialMedianPct,
        "PAIR_VOLUME_WARMING_MATERIAL_MEDIAN_PCT",
      ),
    },
    tokenMomentum: {
      enabled: booleanValue(
        env.PAIR_TOKEN_MOMENTUM_ALERT_ENABLED,
        DEFAULT_PAIR_TOKEN_MOMENTUM_SETTINGS.enabled,
        "PAIR_TOKEN_MOMENTUM_ALERT_ENABLED",
      ),
      priceOneHourThresholdPct: positiveNumber(
        env.PAIR_TOKEN_MOMENTUM_PRICE_ONE_HOUR_PCT,
        DEFAULT_PAIR_TOKEN_MOMENTUM_SETTINGS.priceOneHourThresholdPct,
        "PAIR_TOKEN_MOMENTUM_PRICE_ONE_HOUR_PCT",
      ),
      volumeOneHourThresholdPct: positiveNumber(
        env.PAIR_TOKEN_MOMENTUM_VOLUME_ONE_HOUR_PCT,
        DEFAULT_PAIR_TOKEN_MOMENTUM_SETTINGS.volumeOneHourThresholdPct,
        "PAIR_TOKEN_MOMENTUM_VOLUME_ONE_HOUR_PCT",
      ),
      minimumVolumeDeltaUsd: positiveNumber(
        env.PAIR_TOKEN_MOMENTUM_MIN_VOLUME_DELTA_USD,
        DEFAULT_PAIR_TOKEN_MOMENTUM_SETTINGS.minimumVolumeDeltaUsd,
        "PAIR_TOKEN_MOMENTUM_MIN_VOLUME_DELTA_USD",
      ),
      consecutiveSamples: positiveInteger(
        env.PAIR_TOKEN_MOMENTUM_CONSECUTIVE_SAMPLES,
        DEFAULT_PAIR_TOKEN_MOMENTUM_SETTINGS.consecutiveSamples,
        "PAIR_TOKEN_MOMENTUM_CONSECUTIVE_SAMPLES",
      ),
      rearmSamples: positiveInteger(
        env.PAIR_TOKEN_MOMENTUM_REARM_SAMPLES,
        DEFAULT_PAIR_TOKEN_MOMENTUM_SETTINGS.rearmSamples,
        "PAIR_TOKEN_MOMENTUM_REARM_SAMPLES",
      ),
      freshnessMinutes: positiveNumber(
        env.PAIR_TOKEN_MOMENTUM_FRESHNESS_MINUTES,
        DEFAULT_PAIR_TOKEN_MOMENTUM_SETTINGS.freshnessMinutes,
        "PAIR_TOKEN_MOMENTUM_FRESHNESS_MINUTES",
      ),
    },
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

function optionalChange(value: number | null): string {
  return value === null ? "不可计算" : formatChange(value);
}

function warmingNotificationText(alert: PairWarmingAlert, detailUrl: string): string {
  const title = alert.level === "strong" ? "PAIR 平台交易量强回温" : "PAIR 平台交易量回温";
  const medianLevel =
    alert.currentVsSevenDayMedianPct === null
      ? "不可计算"
      : `${alert.currentVsSevenDayMedianPct.toFixed(1)}%`;
  return [
    `[RHC Radar｜${title}]`,
    `滚动 24H 已观测下限：${formatUsd(alert.currentValueUsd)}`,
    `约 1H 变化：${optionalChange(alert.oneHourChangePct)}`,
    `较近 6H 低点：${optionalChange(alert.sixHourLowChangePct)}`,
    alert.latestCompleteDate && alert.latestCompleteValueUsd !== null
      ? `最新完整日 ${alert.latestCompleteDate}：${formatUsd(alert.latestCompleteValueUsd)}`
      : "最新完整日：不可用",
    alert.sevenDayMedianValueUsd !== null
      ? `近 7 个完整日中位数：${formatUsd(alert.sevenDayMedianValueUsd)}（当前为 ${medianLevel}）`
      : "近 7 个完整日中位数：不可用",
    `覆盖：${String(alert.volumeObservedCount)}/${String(alert.tokenCount)} 枚可见代币有成交额`,
    "判断：连续两个 15 分钟快照达到回温门槛；同一轮状态只通知一次。",
    "口径：PAIR 官方代币 API 聚合下限，不是精确全平台总量，也不是价格预测。",
    `看板：${detailUrl}`,
  ].join("\n");
}

function formatTokenPrice(value: number): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: value >= 0.01 ? 4 : 8,
  })}`;
}

function tokenMomentumNotificationText(alert: PairTokenMomentumAlert, detailUrl: string): string {
  return [
    "[RHC Radar｜PAIR 代币放量上涨]",
    `当前价格：${formatTokenPrice(alert.currentPriceUsd)}（约 1H ${formatChange(alert.priceOneHourChangePct)}）`,
    `当前滚动 24H 交易量：${formatUsd(alert.currentVolume24hUsd)}`,
    `滚动窗口较约 1H 前：${formatChange(alert.volumeOneHourChangePct)}，净增加 ${formatUsd(alert.volumeDeltaUsd)}`,
    alert.currentMarketCapUsd === null
      ? "当前市值：不可用"
      : `当前市值：${formatUsd(alert.currentMarketCapUsd)}`,
    alert.currentLiquidityDepthUsd === null
      ? "当前流动性：不可用"
      : `当前流动性：${formatUsd(alert.currentLiquidityDepthUsd)}`,
    "判断：价格和交易量连续两个 15 分钟快照同步达标；同一轮只通知一次。",
    "口径：交易量是滚动 24H 窗口，不是过去 1H 的实际成交额；净增加是两个滚动窗口之差。",
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

  async evaluateWarming(): Promise<PairWarmingAlertEvaluation> {
    const now = this.now();
    const previousState =
      this.database.getPairWarmingState() ?? initialPairWarmingState(now.toISOString());
    if (!this.settings.feishuWebhookUrl || !this.settings.warming.enabled) {
      return { status: "disabled", inserted: false, state: previousState };
    }
    const since = new Date(now.valueOf() - 13 * 60 * 60_000).toISOString();
    const daily = this.database
      .getMetricHistory(PAIR_PLATFORM_ID, "volume_usd")
      .filter((metric) => metric.source === PAIR_PROTOCOL_DAILY_SOURCE)
      .map((metric) => ({ date: metric.date, valueUsd: metric.value }));
    const plan = planPairVolumeWarming({
      snapshots: this.database.getPairRollingVolumeSnapshots(since),
      daily,
      previousState,
      settings: this.settings.warming,
      now,
    });
    if (plan.status !== "duplicate") this.database.savePairWarmingState(plan.nextState);
    const inserted = plan.alert ? this.database.enqueuePairWarmingAlert(plan.alert) : false;
    await this.flush();
    return { status: plan.status, inserted, state: plan.nextState };
  }

  async evaluateTokenMomentum(): Promise<PairTokenMomentumAlertEvaluation> {
    const now = this.now();
    const previousState =
      this.database.getPairTokenMomentumState() ?? initialPairTokenMomentumState(now.toISOString());
    if (!this.settings.feishuWebhookUrl || !this.settings.tokenMomentum.enabled) {
      return { status: "disabled", inserted: false, state: previousState };
    }
    const since = new Date(now.valueOf() - 3 * 60 * 60_000).toISOString();
    const plan = planPairTokenMomentum({
      snapshots: this.database.getPairTokenMomentumSnapshots(since, PAIR_PROTOCOL_TOKEN_ADDRESS),
      previousState,
      settings: this.settings.tokenMomentum,
      now,
    });
    if (plan.status !== "duplicate") this.database.savePairTokenMomentumState(plan.nextState);
    const inserted = plan.alert ? this.database.enqueuePairTokenMomentumAlert(plan.alert) : false;
    await this.flush();
    return { status: plan.status, inserted, state: plan.nextState };
  }

  health(): PairDailyVolumeAlertHealth {
    const summary = this.database.platformVolumeAlertSummary();
    const warmingSummary = this.database.pairWarmingAlertSummary();
    const tokenMomentumSummary = this.database.pairTokenMomentumAlertSummary();
    return {
      ok: this.settings.feishuWebhookUrl !== null,
      service: "rhc-pair-daily-volume-alert",
      configured: this.settings.feishuWebhookUrl !== null,
      platformId: PAIR_PLATFORM_ID,
      metric: "volume_usd",
      comparison: "last_two_complete_utc_days",
      thresholdPct: this.settings.thresholdPct,
      ...summary,
      warming: {
        configured: this.settings.feishuWebhookUrl !== null && this.settings.warming.enabled,
        evaluationCadenceMinutes: 15,
        comparison: "rolling_24h_recovery",
        oneHourThresholdPct: this.settings.warming.oneHourThresholdPct,
        sixHourLowThresholdPct: this.settings.warming.sixHourLowThresholdPct,
        consecutiveSamples: this.settings.warming.consecutiveSamples,
        rearmSamples: this.settings.warming.rearmSamples,
        upgradeThresholdPct: this.settings.warming.upgradeThresholdPct,
        state: this.database.getPairWarmingState(),
        ...warmingSummary,
      },
      tokenMomentum: {
        configured: this.settings.feishuWebhookUrl !== null && this.settings.tokenMomentum.enabled,
        evaluationCadenceMinutes: 15,
        tokenAddress: PAIR_PROTOCOL_TOKEN_ADDRESS,
        comparison: "price_and_rolling_24h_volume_vs_one_hour",
        priceOneHourThresholdPct: this.settings.tokenMomentum.priceOneHourThresholdPct,
        volumeOneHourThresholdPct: this.settings.tokenMomentum.volumeOneHourThresholdPct,
        minimumVolumeDeltaUsd: this.settings.tokenMomentum.minimumVolumeDeltaUsd,
        consecutiveSamples: this.settings.tokenMomentum.consecutiveSamples,
        rearmSamples: this.settings.tokenMomentum.rearmSamples,
        state: this.database.getPairTokenMomentumState(),
        ...tokenMomentumSummary,
      },
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
    for (const alert of this.database.pendingPairWarmingAlerts(now.toISOString(), 5)) {
      try {
        await this.sendText(warmingNotificationText(alert, this.settings.detailUrl));
        this.database.markPairWarmingAlertSent(alert.id, this.now().toISOString());
      } catch (error) {
        this.database.markPairWarmingAlertFailed(
          alert.id,
          error instanceof Error ? `${error.name}: ${error.message}` : "UnknownNotificationError",
          this.now(),
          alert.attempts,
        );
        this.warn("pair_volume_warming_alert_delivery_failed", {
          errorName: error instanceof Error ? error.name : "UnknownNotificationError",
          observedAt: alert.observedAt,
          level: alert.level,
        });
      }
    }
    for (const alert of this.database.pendingPairTokenMomentumAlerts(now.toISOString(), 5)) {
      try {
        await this.sendText(tokenMomentumNotificationText(alert, this.settings.detailUrl));
        this.database.markPairTokenMomentumAlertSent(alert.id, this.now().toISOString());
      } catch (error) {
        this.database.markPairTokenMomentumAlertFailed(
          alert.id,
          error instanceof Error ? `${error.name}: ${error.message}` : "UnknownNotificationError",
          this.now(),
          alert.attempts,
        );
        this.warn("pair_token_momentum_alert_delivery_failed", {
          errorName: error instanceof Error ? error.name : "UnknownNotificationError",
          observedAt: alert.observedAt,
        });
      }
    }
  }

  private async send(alert: PlatformVolumeAlertOutboxRow): Promise<void> {
    await this.sendText(notificationText(alert, this.settings.detailUrl));
  }

  private async sendText(text: string): Promise<void> {
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
          content: { text },
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
