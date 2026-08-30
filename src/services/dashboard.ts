import { collectAll } from "../collectors/index.js";
import { PLATFORM_REGISTRY } from "../config/platforms.js";
import { aggregateMetricWindow, buildOverview } from "../domain/aggregate.js";
import { CORE_METRICS } from "../domain/types.js";
import type {
  CollectionBatch,
  MetricName,
  PlatformDetailResponse,
  SourceHealth,
  WindowDays,
} from "../domain/types.js";
import type { CollectionRun, DashboardDatabase } from "../storage/database.js";
import { lastClosedUtcDate, shiftUtcDate, windowStart } from "../utils/time.js";

export interface RefreshResult {
  targetDate: string;
  status: "success" | "partial";
  metricCount: number;
  statCount: number;
  platformCount: number;
  warnings: string[];
}

export interface DashboardServiceDependencies {
  collect?: (targetDate: string) => Promise<CollectionBatch>;
  now?: () => Date;
  warn?: (event: string, context: Record<string, unknown>) => void;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

function publicBatchWarnings(batch: CollectionBatch): string[] {
  const hasFailedSource = batch.sourceHealth.some((source) => source.status === "failed");
  if (hasFailedSource) return ["One or more sources are currently unavailable."];

  const hasDegradedSource = batch.sourceHealth.some((source) => source.status === "degraded");
  if (hasDegradedSource) return ["One or more sources returned degraded data."];

  return batch.warnings.length > 0 ? ["One or more source results require attention."] : [];
}

function publicStoredWarnings(warnings: string[]): string[] {
  return warnings.length > 0 ? ["One or more source results require attention."] : [];
}

function publicRun(run: CollectionRun | null): CollectionRun | null {
  if (!run) return null;
  return {
    ...run,
    warnings: publicStoredWarnings(run.warnings),
    error: null,
  };
}

function publicSourceHealth(source: SourceHealth): SourceHealth {
  const messages: Record<SourceHealth["status"], string> = {
    ok: "Source responded successfully.",
    degraded: "Source returned partial or degraded data.",
    failed: "Source is currently unavailable.",
  };
  return {
    ...source,
    message: messages[source.status],
  };
}

export class DashboardService {
  private refreshPromise: Promise<RefreshResult> | null = null;
  private readonly collect: (targetDate: string) => Promise<CollectionBatch>;
  private readonly now: () => Date;
  private readonly warn: (event: string, context: Record<string, unknown>) => void;

  constructor(
    private readonly database: DashboardDatabase,
    private readonly cacheTtlMinutes: number,
    dependencies: DashboardServiceDependencies = {},
  ) {
    this.collect = dependencies.collect ?? collectAll;
    this.now = dependencies.now ?? (() => new Date());
    this.warn = dependencies.warn ?? ((event, context) => console.warn(event, context));
    this.database.seedPlatforms(PLATFORM_REGISTRY);
  }

  async ensureFresh(): Promise<void> {
    const latest = this.database.latestUsableRun();
    const completedAt = latest?.completedAt ? Date.parse(latest.completedAt) : Number.NaN;
    const now = this.now();
    const fresh =
      Number.isFinite(completedAt) &&
      now.valueOf() - completedAt < this.cacheTtlMinutes * 60_000 &&
      latest?.targetDate === lastClosedUtcDate(now);
    if (fresh) return;

    try {
      await this.refresh();
    } catch (error) {
      if (!latest) throw error;
      this.warn("refresh_failed_using_cache", { errorName: errorName(error) });
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
    const targetDate = lastClosedUtcDate(this.now());
    const runId = this.database.startRun(targetDate);

    try {
      const batch = await this.collect(targetDate);
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
        warnings: publicBatchWarnings(batch),
      };
    } catch (error) {
      this.database.completeRun(runId, "failed", [], errorName(error));
      throw error;
    }
  }

  overview(windowDays: WindowDays) {
    const usableRun = this.database.latestUsableRun();
    const latestRun = this.database.latestRun();
    const now = this.now();
    const targetDate = usableRun?.targetDate ?? lastClosedUtcDate(now);
    const platforms = this.database.getPlatforms();
    const metrics = this.database.getMetrics(windowStart(targetDate, windowDays), targetDate);
    const completedAt = usableRun?.completedAt ? Date.parse(usableRun.completedAt) : Number.NaN;
    const stale =
      !Number.isFinite(completedAt) || now.valueOf() - completedAt >= this.cacheTtlMinutes * 60_000;
    const warnings = publicStoredWarnings(usableRun?.warnings ?? []);
    if (latestRun?.status === "failed" && latestRun.id !== usableRun?.id) {
      warnings.unshift("Latest refresh failed; serving the last usable cache.");
    }

    return buildOverview({
      platforms,
      metrics,
      targetDate,
      windowDays,
      generatedAt: now.toISOString(),
      stale,
      runStatus: latestRun?.status ?? "empty",
      warnings,
    });
  }

  platformDetail(platformId: string): PlatformDetailResponse | null {
    const platform = this.database.getPlatform(platformId);
    if (!platform) return null;
    const run = this.database.latestUsableRun();
    const now = this.now();
    const targetDate = run?.targetDate ?? lastClosedUtcDate(now);
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
      generatedAt: now.toISOString(),
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
      generatedAt: this.now().toISOString(),
      usableRun: publicRun(usableRun),
      latestRun: publicRun(latestRun),
      sources: this.database.getSourceHealth().map(publicSourceHealth),
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
      generatedAt: this.now().toISOString(),
    };
  }
}
