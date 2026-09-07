import type { PairV2Settings } from "./config.js";
import type { PairV2AlertOutboxRow, PairV2Database } from "./database.js";
import type { PairV2Alert, PairV2DashboardResponse } from "./types.js";

export interface PairV2AlertDependencies {
  fetcher?: typeof fetch;
  now?: () => Date;
}

function shortAddress(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function alphaSignalState(token: PairV2DashboardResponse["tokens"][number]): string {
  return token.alpha.signal?.state ?? token.alpha.stage;
}

function alphaHeatState(token: PairV2DashboardResponse["tokens"][number]): string {
  if (token.alpha.heat?.state) return token.alpha.heat.state;
  return token.alpha.heatScore >= 80
    ? "overheated"
    : token.alpha.heatScore >= 60
      ? "hot"
      : "normal";
}

function alphaTokenRisk(token: PairV2DashboardResponse["tokens"][number]): string {
  return token.alpha.riskProfile?.token ?? token.alpha.risk;
}

export function planPairV2Alerts(
  previous: PairV2DashboardResponse | null,
  current: PairV2DashboardResponse,
): PairV2Alert[] {
  if (!previous) return [];
  const alerts: PairV2Alert[] = [];
  const createdAt = current.observedAt;
  if (previous.release.releaseId !== current.release.releaseId) {
    alerts.push({
      dedupeKey: `release:${current.release.releaseId}`,
      severity: "critical",
      type: "release",
      title: "PAIR V2 release 已变化",
      message: `releaseId 从 ${previous.release.releaseId} 变为 ${current.release.releaseId}，需重新核验合约图。`,
      project: null,
      createdAt,
    });
  }

  const previousEvents = new Set(previous.events.map((event) => event.id));
  for (const event of current.events.filter((item) => !previousEvents.has(item.id))) {
    if (event.type === "launch" && event.project) {
      alerts.push({
        dedupeKey: `launch:${event.id}`,
        severity: "info",
        type: "launch",
        title: "PAIR V2 新发行",
        message: `${shortAddress(event.project)} · 模式 ${String(event.modeId ?? "未知")} · 区块 ${String(event.blockNumber)}`,
        project: event.project,
        createdAt,
      });
    }
    if (event.type === "buyback_executed" && event.project) {
      alerts.push({
        dedupeKey: `buyback:${event.id}`,
        severity: "warning",
        type: "buyback",
        title: "PAIR V2 已执行回购销毁",
        message: `${shortAddress(event.project)} 已销毁 ${String(event.secondaryAmount ?? "未知")} 枚项目币，交易 ${shortAddress(event.transactionHash)}。`,
        project: event.project,
        createdAt,
      });
    }
    if (event.type === "upgrade") {
      alerts.push({
        dedupeKey: `upgrade:${event.id}`,
        severity: "critical",
        type: "upgrade",
        title: "PAIR Launchpad implementation 已升级",
        message: `新区块 ${String(event.blockNumber)} implementation ${event.implementation ?? "未知"}，暂停把旧审计结论外推到新版本。`,
        project: null,
        createdAt,
      });
    }
  }

  const previousTokens = new Map(previous.tokens.map((token) => [token.address, token]));
  for (const token of current.tokens) {
    const old = previousTokens.get(token.address);
    if (!old) continue;
    const signalState = alphaSignalState(token);
    const oldSignalState = alphaSignalState(old);
    if (
      signalState !== oldSignalState &&
      token.alpha.signal?.researchEligible === true &&
      ["forming", "confirmed"].includes(signalState)
    ) {
      alerts.push({
        dedupeKey: `alpha:${token.address}:${signalState}:${createdAt.slice(0, 13)}`,
        severity: signalState === "confirmed" ? "warning" : "info",
        type: "alpha",
        title: `${token.symbol} 进入 ${signalState === "confirmed" ? "信号确认" : "信号形成"}阶段`,
        message: `质量 ${token.alpha.quality?.score?.toFixed(1) ?? "未知"} · 时机 ${token.alpha.signal?.score?.toFixed(1) ?? "未知"} · 关注 ${token.alpha.discoveryScore.toFixed(1)} · 代币风险 ${alphaTokenRisk(token)}。Shadow 信号，不是买入指令。`,
        project: token.address,
        createdAt,
      });
    }
    const heatState = alphaHeatState(token);
    if (alphaHeatState(old) !== "overheated" && heatState === "overheated") {
      alerts.push({
        dedupeKey: `heat:${token.address}:overheated:${createdAt.slice(0, 13)}`,
        severity: "warning",
        type: "heat",
        title: `${token.symbol} 进入过热区`,
        message: `热度 ${token.alpha.heatScore.toFixed(1)}，不要把成交拥挤直接理解为继续上涨。`,
        project: token.address,
        createdAt,
      });
    }
    const tokenRisk = alphaTokenRisk(token);
    const oldTokenRisk = alphaTokenRisk(old);
    if (!["high", "critical"].includes(oldTokenRisk) && ["high", "critical"].includes(tokenRisk)) {
      alerts.push({
        dedupeKey: `risk:${token.address}:${tokenRisk}:${createdAt.slice(0, 13)}`,
        severity: tokenRisk === "critical" ? "critical" : "warning",
        type: "risk",
        title: `${token.symbol} 代币风险升至${tokenRisk === "critical" ? "严重" : "高"}`,
        message:
          (token.alpha.riskProfile?.tokenReasons ?? token.alpha.risks).join("；") ||
          "风险门槛已触发。",
        project: token.address,
        createdAt,
      });
    }
  }

  const previousAlphaTokens = previous.alphaRadar
    ? new Map(previous.alphaRadar.tokens.map((token) => [token.address, token]))
    : null;
  if (previousAlphaTokens && current.alphaRadar) {
    for (const token of current.alphaRadar.tokens) {
      const old = previousAlphaTokens.get(token.address);
      if (!old) continue;
      const actionState = token.alpha.action?.state;
      const oldActionState = old.alpha.action?.state;
      if (!actionState || actionState === oldActionState) continue;
      if (["ignition_watch", "retest_watch", "probe_eligible", "confirmed"].includes(actionState)) {
        alerts.push({
          dedupeKey: `pair-alpha:${token.address}:${actionState}:${createdAt.slice(0, 13)}`,
          severity: ["probe_eligible", "confirmed"].includes(actionState) ? "warning" : "info",
          type: "alpha",
          title: `${token.symbol} · ${token.alpha.action?.label ?? actionState}`,
          message: `${token.identity.generation.toUpperCase()} · 5m 成交 $${(token.shortWindow?.volume5mUsd ?? 0).toFixed(0)} · 1H 涨幅 ${(token.shortWindow?.priceChange1hPct ?? 0).toFixed(1)}% · 质量 ${token.alpha.quality.score?.toFixed(1) ?? "未知"}。Shadow 观察，不是买入指令。`,
          project: token.address,
          createdAt,
        });
      } else if (actionState === "no_chase") {
        alerts.push({
          dedupeKey: `pair-alpha:${token.address}:no-chase:${createdAt.slice(0, 13)}`,
          severity: "warning",
          type: "heat",
          title: `${token.symbol} · 过热勿追`,
          message: `1H 涨幅 ${(token.shortWindow?.priceChange1hPct ?? 0).toFixed(1)}%，热度 ${token.alpha.heat.score.toFixed(1)}。等待回踩与新承接，不把暴涨当早期 Alpha。`,
          project: token.address,
          createdAt,
        });
      } else if (actionState === "risk_halt") {
        alerts.push({
          dedupeKey: `pair-alpha:${token.address}:risk-halt:${createdAt.slice(0, 13)}`,
          severity: "critical",
          type: "risk",
          title: `${token.symbol} · 风险停止`,
          message: token.alpha.riskProfile.tokenReasons.join("；") || "身份或风险闸门未通过。",
          project: token.address,
          createdAt,
        });
      }
    }
  }
  return alerts;
}

export class PairV2FeishuNotifier {
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;

  constructor(
    private readonly settings: Pick<PairV2Settings, "feishuWebhookUrl" | "requestTimeoutMs">,
    dependencies: PairV2AlertDependencies = {},
  ) {
    this.fetcher = dependencies.fetcher ?? fetch;
    this.now = dependencies.now ?? (() => new Date());
  }

  get configured(): boolean {
    return this.settings.feishuWebhookUrl !== null;
  }

  async flush(database: PairV2Database): Promise<void> {
    if (!this.settings.feishuWebhookUrl) return;
    for (const alert of database.pendingAlerts(10)) {
      try {
        await this.send(alert);
        database.markAlertSent(alert.id, this.now().toISOString());
      } catch (error) {
        database.markAlertFailed(
          alert.id,
          error instanceof Error ? error.name : "UnknownNotificationError",
        );
      }
    }
  }

  private async send(alert: PairV2AlertOutboxRow): Promise<void> {
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
            text: `[PAIR Radar｜${alert.severity.toUpperCase()}] ${alert.title}\n${alert.message}`,
          },
        }),
      });
      if (!response.ok) throw new Error(`Feishu webhook HTTP ${String(response.status)}`);
      const payload = (await response.json()) as { code?: number; StatusCode?: number };
      const code = payload.code ?? payload.StatusCode ?? 0;
      if (code !== 0) throw new Error("Feishu webhook returned a business error");
    } finally {
      clearTimeout(timeout);
    }
  }
}
