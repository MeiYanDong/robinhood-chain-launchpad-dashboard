import type { PairTokenSettings } from "./config.js";
import type { PairTokenCollector } from "./collector.js";
import type { PairTokenDatabase } from "./database.js";
import { buildPairRankings, emptyPairRankings } from "./rank.js";
import { latestChinaEightCutoff, shiftIsoDate } from "./time.js";
import type {
  PairCollectionRun,
  PairLeaderboardResponse,
  PairPlatformLiveAggregate,
  PairPublicSourceHealth,
  PairSourceHealth,
  PairTokenSnapshot,
} from "./types.js";

export interface PairTokenServiceDependencies {
  collect?: PairTokenCollector["collect"];
  now?: () => Date;
  warn?: (event: string, context: Record<string, unknown>) => void;
  afterRefresh?: () => Promise<void>;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

function errorDiagnostic(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/Failed to fetch/i.test(message)) return "pair_upstream_fetch_failed";
  if (/pagination changed/i.test(message)) return "pair_pagination_changed";
  if (/duplicate address/i.test(message)) return "pair_duplicate_address";
  if (/incomplete universe/i.test(message)) return "pair_incomplete_universe";
  if (/no token records/i.test(message)) return "pair_empty_universe";
  if (/SQLITE_BUSY|database is locked/i.test(message)) return "pair_database_busy";
  if (/SQLITE_FULL|database or disk is full/i.test(message)) return "pair_database_full";
  return `${errorName(error)}_unclassified`;
}

function publicSource(source: PairSourceHealth): PairPublicSourceHealth {
  const sourceLabel = source.source === "gmgn.tokenInfo" ? "GMGN 持币地址" : "PAIR 官方 API";
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

export class PairTokenService {
  private refreshPromise: Promise<{
    observedAt: string;
    status: "success" | "partial";
    universeCount: number;
    eligibleCount: number;
    warnings: string[];
  }> | null = null;
  private readonly collect: PairTokenCollector["collect"];
  private readonly now: () => Date;
  private readonly warn: (event: string, context: Record<string, unknown>) => void;
  private readonly afterRefresh: () => Promise<void>;

  constructor(
    private readonly database: PairTokenDatabase,
    private readonly settings: PairTokenSettings,
    collector: PairTokenCollector,
    dependencies: PairTokenServiceDependencies = {},
  ) {
    this.collect = dependencies.collect ?? collector.collect.bind(collector);
    this.now = dependencies.now ?? (() => new Date());
    this.warn = dependencies.warn ?? ((event, context) => console.warn(event, context));
    this.afterRefresh = dependencies.afterRefresh ?? (async () => undefined);
  }

  async ensureFresh(): Promise<void> {
    const latest = this.database.latestUsableRun();
    const observedAt = latest?.observedAt ? Date.parse(latest.observedAt) : Number.NaN;
    if (
      Number.isFinite(observedAt) &&
      latest !== null &&
      this.database.getUniverseAggregate(latest.id) !== null &&
      this.now().valueOf() - observedAt < this.settings.refreshTtlMinutes * 60_000
    ) {
      return;
    }
    try {
      await this.refresh();
    } catch (error) {
      if (!latest) throw error;
      this.warn("pair_refresh_failed_using_cache", { reason: errorDiagnostic(error) });
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
    const startedAt = this.now().toISOString();
    const runId = this.database.startRun(startedAt);
    try {
      const batch = await this.collect(this.database.getHolderCache());
      if (batch.tokens.length === 0) throw new Error("PAIR collector returned no token records");
      this.database.writeBatch(runId, batch);
      this.database.saveUniverseAggregate(runId, batch);
      const status: "success" | "partial" = batch.sourceHealth.some(
        (source) => source.status !== "ok",
      )
        ? "partial"
        : "success";
      this.database.completeRun(runId, status, batch);
      try {
        await this.afterRefresh();
      } catch (error) {
        this.warn("pair_volume_alert_evaluation_failed", { reason: errorDiagnostic(error) });
      }
      return {
        observedAt: batch.observedAt,
        status,
        universeCount: batch.universeCount,
        eligibleCount: batch.eligibleCount,
        warnings: status === "partial" ? ["部分 PAIR 代币数据暂不可用。"] : ([] as string[]),
      };
    } catch (error) {
      this.database.completeRun(runId, "failed", null, errorDiagnostic(error));
      throw error;
    }
  }

  private buildResponse(
    run: PairCollectionRun | null,
    comparisonRun: PairCollectionRun | null,
    mode: "live" | "daily",
    report: { reportDate: string; windowStart: string; cutoffAt: string } | null,
  ): PairLeaderboardResponse {
    const generatedAt = this.now().toISOString();
    if (!run?.observedAt) {
      return {
        service: "rhc-pair-token-radar",
        mode,
        generatedAt,
        reportDate: report?.reportDate ?? null,
        windowStart: report?.windowStart ?? null,
        cutoffAt: report?.cutoffAt ?? null,
        snapshot: null,
        eligibility: this.eligibility(),
        rankings: emptyPairRankings(),
        sources: [],
        warnings: ["PAIR 代币榜暂无可用数据。"],
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
    if (stale) warnings.push("PAIR 代币榜数据已超过预期更新时间。");
    if (run.eligibleCount < 5) {
      warnings.push(`当前只有 ${String(run.eligibleCount)} 枚代币符合经济活跃条件。`);
    }
    if (run.status === "partial") warnings.push("部分持币地址数据暂不可用。");

    return {
      service: "rhc-pair-token-radar",
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

  rankings(): PairLeaderboardResponse {
    const run = this.database.latestUsableRun();
    const baselineReport = this.database.latestDailyReport();
    const comparisonRun = baselineReport ? this.database.getRun(baselineReport.runId) : null;
    return this.buildResponse(run, comparisonRun, "live", null);
  }

  platformLive(): PairPlatformLiveAggregate | null {
    const run = this.database.latestUsableRun();
    return run ? this.database.getUniverseAggregate(run.id) : null;
  }

  token(address: string): PairTokenSnapshot | null {
    const normalized = address.toLowerCase();
    const run = this.database.latestUsableRun();
    if (!run) return null;
    return this.database.getSnapshots(run.id).find((token) => token.address === normalized) ?? null;
  }

  latestDailyReport(): PairLeaderboardResponse | null {
    return this.database.latestDailyReport()?.payload ?? null;
  }

  generateDailyReport(): PairLeaderboardResponse {
    const now = this.now();
    const cutoff = latestChinaEightCutoff(now);
    const run = this.database.usableRunAtOrBefore(addMinutes(cutoff.cutoffAt, 5));
    if (!run?.observedAt) throw new Error("No PAIR snapshot is available for the daily cutoff");
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
        market_cap_usd: "PAIR 官方 API 返回的当前美元市值。",
        liquidity_depth_usd: "PAIR 全部官方池的美元深度合计，不是最大单池。",
        volume_24h_usd: "截至观测时点的滚动 24 小时美元成交量。",
        holder_count: "GMGN 返回的持币地址数，不代表去重后的真实人数。",
      },
      caveats: [
        "四个指标分别排名，不计算综合分。",
        "只有达到经济活跃门槛且市场数据新鲜的代币进入排名。",
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
      service: "rhc-pair-token-radar",
      observedAt: usableRun?.observedAt ?? null,
      latestRunStatus: latestRun?.status ?? "empty",
      latestRunError: latestRun?.status === "failed" ? latestRun.error : null,
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
