import { PLATFORM_REGISTRY } from "../config/platforms.js";
import { collectAll } from "../collectors/index.js";
import { aggregateMetricWindow, buildOverview } from "../domain/aggregate.js";
import { CORE_METRICS } from "../domain/types.js";
import type {
  MetricName,
  PlatformDetailResponse,
  WindowDays,
} from "../domain/types.js";
import { DashboardDatabase } from "../storage/database.js";
import { lastClosedUtcDate, shiftUtcDate, windowStart } from "../utils/time.js";

export interface RefreshResult {
  targetDate: string;
  status: "success" | "partial";
  metricCount: number;
  statCount: number;
  platformCount: number;
  warnings: string[];
}

export class DashboardService {
  private refreshPromise: Promise<RefreshResult> | null = null;

  constructor(
    private readonly database: DashboardDatabase,
    private readonly cacheTtlMinutes: number,
  ) {
    this.database.seedPlatforms(PLATFORM_REGISTRY);
  }

  async ensureFresh(): Promise<void> {
    const latest = this.database.latestUsableRun();
    const completedAt = latest?.completedAt ? Date.parse(latest.completedAt) : Number.NaN;
    const fresh =
      Number.isFinite(completedAt) &&
      Date.now() - completedAt < this.cacheTtlMinutes * 60_000 &&
      latest?.targetDate === lastClosedUtcDate();
    if (fresh) return;

    try {
      await this.refresh();
    } catch (error) {
      if (!latest) throw error;
      console.warn("Refresh failed; serving the last usable cache:", error);
    }
  }

  refresh(): Promise<RefreshResult> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshNow().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  private async refreshNow(): Promise<RefreshResult> {
    const targetDate = lastClosedUtcDate();
    const runId = this.database.startRun(targetDate);

    try {
      const batch = await collectAll(targetDate);
      if (batch.metrics.length === 0) {
        throw new Error("All collectors returned zero canonical metric observations");
      }
      this.database.writeBatch(batch);
      const status = batch.sourceHealth.some((source) => source.status !== "ok")
        ? "partial"
        : "success";
      this.database.completeRun(runId, status, batch.warnings);
      return {
        targetDate,
        status,
        metricCount: batch.metrics.length,
        statCount: batch.stats.length,
        platformCount: batch.platforms.length,
        warnings: batch.warnings,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.database.completeRun(runId, "failed", [], message);
      throw error;
    }
  }

  overview(windowDays: WindowDays) {
    const usableRun = this.database.latestUsableRun();
    const latestRun = this.database.latestRun();
    const targetDate = usableRun?.targetDate ?? lastClosedUtcDate();
    const platforms = this.database.getPlatforms();
    const metrics = this.database.getMetrics(windowStart(targetDate, windowDays), targetDate);
    const completedAt = usableRun?.completedAt ? Date.parse(usableRun.completedAt) : Number.NaN;
    const stale =
      !Number.isFinite(completedAt) || Date.now() - completedAt >= this.cacheTtlMinutes * 60_000;
    const warnings = [...(usableRun?.warnings ?? [])];
    if (latestRun?.status === "failed" && latestRun.id !== usableRun?.id) {
      warnings.unshift(`Latest refresh failed: ${latestRun.error ?? "unknown error"}`);
    }

    return buildOverview({
      platforms,
      metrics,
      targetDate,
      windowDays,
      generatedAt: new Date().toISOString(),
      stale,
      runStatus: latestRun?.status ?? "empty",
      warnings,
    });
  }

  platformDetail(platformId: string): PlatformDetailResponse | null {
    const platform = this.database.getPlatform(platformId);
    if (!platform) return null;
    const run = this.database.latestUsableRun();
    const targetDate = run?.targetDate ?? lastClosedUtcDate();
    const startDate = shiftUtcDate(targetDate, -63);
    const metrics = this.database.getMetrics(startDate, targetDate, platformId);
    const series = Object.fromEntries(
      CORE_METRICS.map((metricName) => [
        metricName,
        metrics
          .filter((metric) => metric.metric === metricName)
          .map((metric) => ({ date: metric.date, value: metric.value })),
      ]),
    ) as PlatformDetailResponse["series"];
    const coverage = Object.fromEntries(
      CORE_METRICS.map((metricName) => [
        metricName,
        aggregateMetricWindow(
          metrics.filter((metric) => metric.metric === metricName),
          64,
        ),
      ]),
    ) as Record<MetricName, ReturnType<typeof aggregateMetricWindow>>;

    return {
      platform,
      targetDate,
      generatedAt: new Date().toISOString(),
      series,
      coverage,
      stats: this.database.getPlatformStats(platformId),
    };
  }

  coverage() {
    const overview = this.overview(30);
    return {
      targetDate: overview.targetDate,
      generatedAt: overview.generatedAt,
      definitions: {
        volume_usd: "Gross USD trading volume within the adapter's stated scope.",
        fees_usd: "All user-paid fees counted by the adapter.",
        protocol_revenue_usd: "Fees retained by the protocol/team/treasury where reported.",
        revenue_usd: "Broader retained revenue as defined by DefiLlama; not net profit.",
      },
      caveats: [
        "Missing observations remain null; absence is never silently converted to zero.",
        "The target day is the last closed UTC day; the current partial UTC day is excluded.",
        "Tracked totals exclude rows marked suite-wide, but other partial scopes remain explicitly labeled.",
        "Revenue and protocol revenue are accounting dimensions, not audited net profit.",
        "Platform-first sources win only for explicitly configured platform/metric/date keys; lower-priority sources remain fallbacks instead of being added together.",
        "LetsCash official daily ETH rows use a UTC-boundary ETH/USD reference for ranking, so those USD values are derived rather than transaction-time dollar accounting.",
      ],
      platforms: overview.platforms.map((platform) => ({
        id: platform.id,
        name: platform.name,
        comparability: platform.comparability,
        excludeFromTotals: platform.excludeFromTotals,
        scope: platform.scope,
        notes: platform.notes,
        metrics: platform.metrics,
      })),
    };
  }

  sources() {
    const usableRun = this.database.latestUsableRun();
    const latestRun = this.database.latestRun();
    return {
      generatedAt: new Date().toISOString(),
      usableRun,
      latestRun,
      sources: this.database.getSourceHealth(),
    };
  }

  health() {
    const usableRun = this.database.latestUsableRun();
    const latestRun = this.database.latestRun();
    return {
      ok: Boolean(usableRun),
      service: "rhc-launch-ledger",
      targetDate: usableRun?.targetDate ?? null,
      latestRunStatus: latestRun?.status ?? "empty",
      generatedAt: new Date().toISOString(),
    };
  }
}
