import { DEFAULT_DEV_MONITOR_SETTINGS, type DevMonitorSettings } from "./config.js";
import type { DevMonitorAlertOutboxRow, DevMonitorDatabase } from "./database.js";
import {
  isDevMonitorAlertEligible,
  type DevMonitorNotificationEligibility,
} from "./notification-policy.js";
import type {
  DevMonitorActivity,
  DevMonitorAlert,
  DevMonitorProfile,
  DevMonitorProject,
} from "./types.js";

const EXPLORER_BASE_URL = "https://robinhoodchain.blockscout.com";

export interface DevMonitorNotifierDependencies {
  fetcher?: typeof fetch;
  now?: () => Date;
}

function shortAddress(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function platformLabel(value: DevMonitorProject["platform"]): string {
  return {
    pair_v2: "PAIR V2",
    pons_v1: "pons v1",
    pons_v2: "pons v2",
    long: "Long",
  }[value];
}

function amount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "数量未知";
  return new Intl.NumberFormat("en-US", { maximumSignificantDigits: 8 }).format(value);
}

function attentionWorthy(profile: DevMonitorProfile | undefined): profile is DevMonitorProfile {
  if (profile?.tier !== "proven") return false;
  const successRate = profile.successfulLaunchCount / Math.max(1, profile.launchCount);
  return (
    profile.launchCount <= 5 ||
    profile.qualifiedLaunchCount >= 2 ||
    (profile.successfulLaunchCount >= 2 && successRate >= 0.15)
  );
}

export function planDevMonitorAlerts(input: {
  baselineComplete: boolean;
  previousProfiles: DevMonitorProfile[];
  currentProfiles: DevMonitorProfile[];
  insertedProjects: DevMonitorProject[];
  insertedActivities: DevMonitorActivity[];
  notificationEligibility: DevMonitorNotificationEligibility;
  createdAt: string;
}): DevMonitorAlert[] {
  if (!input.baselineComplete) return [];
  const previous = new Map(input.previousProfiles.map((profile) => [profile.address, profile]));
  const current = new Map(input.currentProfiles.map((profile) => [profile.address, profile]));
  const alerts: DevMonitorAlert[] = [];

  for (const project of input.insertedProjects) {
    const oldProfile = previous.get(project.creator);
    const newProfile = current.get(project.creator);
    if (!attentionWorthy(oldProfile) || !attentionWorthy(newProfile)) continue;
    const symbol = project.symbol ?? shortAddress(project.address);
    const alert: DevMonitorAlert = {
      dedupeKey: `developer_launch:${project.launchId}`,
      severity: "warning",
      type: "developer_launch",
      title: `${newProfile.label} 新发币`,
      message: [
        `PAIR 项目方主发行钱包：${project.creator}`,
        `平台：${platformLabel(project.platform)}`,
        `代币：${symbol} · ${project.address}`,
        "身份依据：PAIR 官方代币 API + PAIR 发行交易",
        `交易：${EXPLORER_BASE_URL}/tx/${project.transactionHash}`,
      ].join("\n"),
      developer: project.creator,
      project: project.address,
      transactionHash: project.transactionHash,
      createdAt: project.launchedAt ?? input.createdAt,
    };
    if (isDevMonitorAlertEligible(alert, input.notificationEligibility)) alerts.push(alert);
  }

  for (const activity of input.insertedActivities) {
    const developer = current.get(activity.developer);
    if (
      activity.type !== "buy" ||
      activity.confidence !== "high" ||
      activity.targetPlatform === null ||
      !attentionWorthy(developer) ||
      !input.notificationEligibility.allowedWallets.has(activity.developer.toLowerCase())
    ) {
      continue;
    }
    alerts.push({
      dedupeKey: `developer_buy:${activity.id}`,
      severity: "warning",
      type: "developer_buy",
      title: "PAIR 项目方钱包出现真实买入",
      message: [
        `PAIR 项目方主发行钱包：${activity.developer}`,
        `买入：${amount(activity.targetAmount)} ${activity.target.symbol} · ${activity.target.address}`,
        `${activity.quote.address === "native" ? "交易发送上限" : "净支付"}：${amount(activity.quoteAmount)} ${activity.quote.symbol}`,
        `平台归属：${activity.targetPlatform ? platformLabel(activity.targetPlatform) : "未归属到已核验发射台"}`,
        `证据：${activity.evidence.join(" + ")}`,
        `交易：${EXPLORER_BASE_URL}/tx/${activity.transactionHash}`,
      ].join("\n"),
      developer: activity.developer,
      project: activity.target.address,
      transactionHash: activity.transactionHash,
      createdAt: activity.timestamp,
    });
  }

  return alerts;
}

export class DevMonitorFeishuNotifier {
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;

  constructor(
    private readonly settings: Pick<DevMonitorSettings, "feishuWebhookUrl" | "requestTimeoutMs"> &
      Partial<
        Pick<
          DevMonitorSettings,
          | "alertMaxAgeMinutes"
          | "alertHourlyLimit"
          | "alertBatchSize"
          | "alertDeliveryCooldownMinutes"
        >
      >,
    dependencies: DevMonitorNotifierDependencies = {},
  ) {
    this.fetcher = dependencies.fetcher ?? fetch;
    this.now = dependencies.now ?? (() => new Date());
  }

  get configured(): boolean {
    return this.settings.feishuWebhookUrl !== null;
  }

  async flush(database: DevMonitorDatabase): Promise<void> {
    const now = this.now();
    const maxAgeMinutes =
      this.settings.alertMaxAgeMinutes ?? DEFAULT_DEV_MONITOR_SETTINGS.alertMaxAgeMinutes;
    database.suppressExpiredAlerts(
      new Date(now.valueOf() - maxAgeMinutes * 60_000).toISOString(),
      now.toISOString(),
    );
    if (!this.settings.feishuWebhookUrl) return;
    const hourlyLimit =
      this.settings.alertHourlyLimit ?? DEFAULT_DEV_MONITOR_SETTINGS.alertHourlyLimit;
    const sentInLastHour = database.sentAlertCountSince(
      new Date(now.valueOf() - 60 * 60_000).toISOString(),
    );
    const remaining = Math.max(0, hourlyLimit - sentInLastHour);
    if (remaining === 0) return;
    const batchSize = this.settings.alertBatchSize ?? DEFAULT_DEV_MONITOR_SETTINGS.alertBatchSize;
    const alerts = database.pendingAlerts(now.toISOString(), Math.min(batchSize, remaining));
    if (alerts.length === 0) return;
    const urgent = alerts.some((alert) => alert.type === "developer_buy");
    const deliveryCooldownMinutes =
      this.settings.alertDeliveryCooldownMinutes ??
      DEFAULT_DEV_MONITOR_SETTINGS.alertDeliveryCooldownMinutes;
    const lastSentAt = database.lastSentAt();
    if (
      !urgent &&
      lastSentAt !== null &&
      Date.parse(lastSentAt) > now.valueOf() - deliveryCooldownMinutes * 60_000
    ) {
      return;
    }
    try {
      await this.send(alerts);
      const sentAt = this.now().toISOString();
      for (const alert of alerts) database.markAlertSent(alert.id, sentAt);
    } catch (error) {
      for (const alert of alerts) {
        database.markAlertFailed(
          alert.id,
          error instanceof Error ? `${error.name}: ${error.message}` : "UnknownNotificationError",
          this.now(),
          alert.attempts,
        );
      }
    }
  }

  private async send(alerts: DevMonitorAlertOutboxRow[]): Promise<void> {
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
          content: {
            text: [
              `[RHC Alpha｜${String(alerts.length)} 条精选信号]`,
              ...alerts.map(
                (alert, index) => `${String(index + 1)}. ${alert.title}\n${alert.message}`,
              ),
            ].join("\n\n"),
          },
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
