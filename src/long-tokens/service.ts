import { buildPairRankings, emptyPairRankings } from "../pair/rank.js";
import { latestChinaEightCutoff, shiftIsoDate } from "../pair/time.js";
import type { PairCollectionRun, PairPublicSourceHealth, PairSourceHealth } from "../pair/types.js";
import type { LongTokenSettings } from "./config.js";
import type { LongTokenCollector } from "./collector.js";
import type { LongTokenDatabase } from "./database.js";
import type { LongCollectionBatch, LongLeaderboardResponse } from "./types.js";

export interface LongTokenServiceDependencies {
  collect?: LongTokenCollector["collect"];
  now?: () => Date;
  warn?: (event: string, context: Record<string, unknown>) => void;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

function publicSource(source: PairSourceHealth): PairPublicSourceHealth {
  const sourceLabel =
    source.source === "long.officialGraphql.assetMembership"
      ? "Long 官方代币归属"
      : "GMGN Long 活跃代币";
  const statusMessage = {
    ok: "数据可用。",
    degraded: "部分数据暂不可用。",
    failed: "当前来源不可用。",
  }[source.status];
  return {
    source: sourceLabel,
    status: source.status,
    fetchedAt: source.fetchedAt,
    latencyMs: source.latencyMs,
    message: statusMessage,
  };
}

function publicRunStatus(run: PairCollectionRun): "success" | "partial" | "failed" {
  return run.status === "success" || run.status === "partial" ? run.status : "failed";
}

function addMinutes(value: string, minutes: number): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("Invalid cutoff timestamp");
  return new Date(parsed + minutes * 60_000).toISOString();
}

export class LongTokenService {
  private refreshPromise: Promise<{
    observedAt: string;
    status: "success" | "partial";
    universeCount: number;
    eligibleCount: number;
    warnings: string[];
  }> | null = null;
  private readonly collect: LongTokenCollector["collect"];
  private readonly now: () => Date;
  private readonly warn: (event: string, context: Record<string, unknown>) => void;

  constructor(
    private readonly database: LongTokenDatabase,
    private readonly settings: LongTokenSettings,
    collector: LongTokenCollector,
    dependencies: LongTokenServiceDependencies = {},
  ) {
    this.collect = dependencies.collect ?? collector.collect.bind(collector);
    this.now = dependencies.now ?? (() => new Date());
    this.warn = dependencies.warn ?? ((event, context) => console.warn(event, context));
  }

  async ensureFresh(): Promise<void> {
    const latest = this.database.latestUsableRun();
    const observedAt = latest?.observedAt ? Date.parse(latest.observedAt) : Number.NaN;
    if (
      Number.isFinite(observedAt) &&
      this.now().valueOf() - observedAt < this.settings.refreshTtlMinutes * 60_000
    ) {
      return;
    }
    try {
      await this.refresh();
    } catch (error) {
      if (!latest) throw error;
      this.warn("long_refresh_failed_using_cache", { errorName: errorName(error) });
    }
  }

  refresh(): Promise<{
    observedAt: string;
    status: "success" | "partial";
    universeCount: number;
    eligibleCount: number;
    warnings: string[];
  }> {
    if (this.refreshPromise) return this.refreshPromise;
    const refresh = this.refreshNow().finally(() => {
      this.refreshPromise = null;
    });
    this.refreshPromise = refresh;
    return refresh;
  }

  private async refreshNow() {
    const runId = this.database.startRun(this.now().toISOString());
    try {
      const batch: LongCollectionBatch = await this.collect(new Set());
      if (batch.tokens.length === 0) throw new Error("Long collector returned no token records");
      this.database.writeBatch(runId, batch);
      const status: "success" | "partial" = batch.sourceHealth.some(
        (source) => source.status !== "ok",
      )
        ? "partial"
        : "success";
      this.database.completeRun(runId, status, batch);
      return {
        observedAt: batch.observedAt,
        status,
        universeCount: batch.universeCount,
        eligibleCount: batch.eligibleCount,
        warnings: status === "partial" ? ["部分 Long 代币数据暂不可用。"] : [],
      };
    } catch (error) {
      this.database.completeRun(runId, "failed", null, errorName(error));
      throw error;
    }
  }

  private buildResponse(
    run: PairCollectionRun | null,
    comparisonRun: PairCollectionRun | null,
    mode: "live" | "daily",
    report: { reportDate: string; windowStart: string; cutoffAt: string } | null,
  ): LongLeaderboardResponse {
    const generatedAt = this.now().toISOString();
    if (!run?.observedAt) {
      return {
        service: "rhc-long-token-radar",
        mode,
        generatedAt,
        reportDate: report?.reportDate ?? null,
        windowStart: report?.windowStart ?? null,
        cutoffAt: report?.cutoffAt ?? null,
        snapshot: null,
        eligibility: this.eligibility(),
        rankings: emptyPairRankings(),
        sources: [],
        warnings: ["Long 代币榜暂无可用数据。"],
      };
    }

    const snapshots = this.database.getSnapshots(run.id);
    const previousSnapshots = comparisonRun ? this.database.getSnapshots(comparisonRun.id) : [];
    const observedAt = Date.parse(run.observedAt);
    const stale =
      !Number.isFinite(observedAt) ||
      this.now().valueOf() - observedAt >= this.settings.staleAfterMinutes * 60_000;
    const warnings: string[] = [];
    const latestRun = this.database.latestRun();
    if (mode === "live" && latestRun?.status === "failed" && latestRun.id !== run.id) {
      warnings.push("最近一次刷新失败，正在显示上次成功数据。");
    }
    if (stale) warnings.push("Long 代币榜数据已超过预期更新时间。");
    if (run.eligibleCount < 5) {
      warnings.push(`当前只有 ${String(run.eligibleCount)} 枚代币符合经济活跃条件。`);
    }
    if (run.warnings.includes("long_active_sample_capped")) {
      warnings.push("Long 活跃样本已达到单次抓取上限。 ");
    }

    return {
      service: "rhc-long-token-radar",
      mode,
      generatedAt,
      reportDate: report?.reportDate ?? null,
      windowStart: report?.windowStart ?? null,
      cutoffAt: report?.cutoffAt ?? null,
      snapshot: {
        runId: run.id,
        observedAt: run.observedAt,
        status: publicRunStatus(run),
        stale,
        universeCount: run.universeCount,
        eligibleCount: run.eligibleCount,
      },
      eligibility: this.eligibility(),
      rankings: buildPairRankings(snapshots, previousSnapshots),
      sources: this.database.getSourceHealth(run.id).map(publicSource),
      warnings,
    };
  }

  rankings(): LongLeaderboardResponse {
    const run = this.database.latestUsableRun();
    const baselineReport = this.database.latestDailyReport();
    const comparisonRun = baselineReport ? this.database.getRun(baselineReport.runId) : null;
    return this.buildResponse(run, comparisonRun, "live", null);
  }

  latestDailyReport(): LongLeaderboardResponse | null {
    return this.database.latestDailyReport()?.payload ?? null;
  }

  generateDailyReport(): LongLeaderboardResponse {
    const cutoff = latestChinaEightCutoff(this.now());
    const run = this.database.usableRunAtOrBefore(addMinutes(cutoff.cutoffAt, 5));
    if (!run?.observedAt) throw new Error("No Long snapshot is available for the daily cutoff");
    const previousReport = this.database.previousDailyReport(cutoff.reportDate);
    const comparisonRun = previousReport ? this.database.getRun(previousReport.runId) : null;
    const payload = this.buildResponse(run, comparisonRun, "daily", {
      reportDate: cutoff.reportDate,
      windowStart: `${shiftIsoDate(cutoff.reportDate, -1)}T00:00:00.000Z`,
      cutoffAt: cutoff.cutoffAt,
    });
    const distanceFromCutoff = Math.abs(Date.parse(run.observedAt) - Date.parse(cutoff.cutoffAt));
    if (distanceFromCutoff > 30 * 60_000) {
      payload.snapshot = payload.snapshot ? { ...payload.snapshot, stale: true } : null;
      payload.warnings = [...payload.warnings, "日报使用的快照距离 08:00 超过 30 分钟。"];
    }
    this.database.saveDailyReport({
      reportDate: cutoff.reportDate,
      cutoffAt: cutoff.cutoffAt,
      generatedAt: payload.generatedAt,
      runId: run.id,
      payload,
    });
    return payload;
  }

  sources() {
    const run = this.database.latestUsableRun();
    return {
      generatedAt: this.now().toISOString(),
      definitions: {
        market_cap_usd: "GMGN Long 活跃代币榜返回的当前美元市值。",
        liquidity_depth_usd: "GMGN Long 活跃代币榜返回的美元流动性。",
        volume_24h_usd: "截至观测时点的滚动 24 小时美元成交量。",
        holder_count: "GMGN 返回的持币地址数，不代表去重后的真实人数。",
      },
      caveats: [
        "四个指标分别排名，不计算综合分。",
        "活跃样本来自 GMGN 的 longxyz 标签，不代表 Long 历史发射全量。",
        "每个展示代币均须命中 Long 官方 integrator 资产索引。",
        "缺失值保持未知，不会转换成 0 或用其它指标猜填。",
      ],
      sources: run ? this.database.getSourceHealth(run.id).map(publicSource) : [],
    };
  }

  health() {
    const usableRun = this.database.latestUsableRun();
    const latestRun = this.database.latestRun();
    const observedAt = usableRun?.observedAt ? Date.parse(usableRun.observedAt) : Number.NaN;
    const stale =
      !Number.isFinite(observedAt) ||
      this.now().valueOf() - observedAt >= this.settings.staleAfterMinutes * 60_000;
    return {
      ok: Boolean(usableRun),
      service: "rhc-long-token-radar",
      observedAt: usableRun?.observedAt ?? null,
      latestRunStatus: latestRun?.status ?? "empty",
      stale,
      generatedAt: this.now().toISOString(),
    };
  }

  private eligibility() {
    return {
      marketCapFloorUsd: this.settings.marketCapFloorUsd,
      liquidityDepthFloorUsd: this.settings.liquidityDepthFloorUsd,
      marketFreshnessMinutes: this.settings.marketFreshnessMinutes,
    };
  }
}
