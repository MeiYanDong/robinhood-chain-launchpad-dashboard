import { assessDailyMetrics, SUSPECT_ZERO, usableDailyMetric } from "../domain/data-quality.js";
import type { DailyMetric, PlatformConfig, PlatformStat } from "../domain/types.js";
import { shiftUtcDate, utcDateRange, windowStart } from "../utils/time.js";
import {
  PLATFORM_ACTIVITY_IDS,
  PLATFORM_ACTIVITY_WINDOWS,
  type PlatformActivityBand,
  type PlatformActivityId,
  type PlatformActivityPlatformView,
  type PlatformActivityPoint,
  type PlatformActivityResponse,
  type PlatformActivitySeries,
  type PlatformActivityWindowDays,
  type PlatformDailyVolumePoint,
  type PlatformVolumeComparison,
  type PlatformVolumeSummary,
  type PlatformVolumeWindow,
} from "./types.js";

export const ACTIVITY_BASELINE_MAX_OBSERVATIONS = 90;
export const ACTIVITY_BASELINE_MIN_OBSERVATIONS = 30;

interface PlatformActivityInput {
  targetDate: string;
  generatedAt: string;
  stale: boolean;
  runStatus: string;
  platforms: PlatformConfig[];
  metrics: DailyMetric[];
  stats: PlatformStat[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const left = sorted[middle - 1];
  const right = sorted[middle];
  return left === undefined || right === undefined ? null : (left + right) / 2;
}

function percentileRank(values: number[], value: number): number | null {
  if (values.length === 0) return null;
  let below = 0;
  let equal = 0;
  for (const candidate of values) {
    if (candidate < value) below += 1;
    else if (candidate === value) equal += 1;
  }
  return ((below + equal / 2) / values.length) * 100;
}

function activityBand(percentile: number | null): PlatformActivityBand {
  if (percentile === null) return "unknown";
  if (percentile < 25) return "quiet";
  if (percentile <= 75) return "normal";
  if (percentile <= 90) return "active";
  return "unusually_active";
}

function newestMetricByDate(metrics: DailyMetric[]): Map<string, DailyMetric> {
  const byDate = new Map<string, DailyMetric>();
  for (const metric of metrics) {
    if (metric.metric !== "volume_usd") continue;
    const existing = byDate.get(metric.date);
    if (!existing || metric.collectedAt > existing.collectedAt) byDate.set(metric.date, metric);
  }
  return byDate;
}

function rollingAverage(
  endDate: string,
  windowDays: PlatformActivityWindowDays,
  usableByDate: ReadonlyMap<string, DailyMetric>,
): { average: number | null; observedDays: number; startDate: string } {
  const startDate = windowStart(endDate, windowDays);
  const values = utcDateRange(startDate, endDate)
    .map((date) => usableByDate.get(date)?.value)
    .filter((value): value is number => value !== undefined);
  return {
    average:
      values.length === windowDays
        ? values.reduce((sum, value) => sum + value, 0) / windowDays
        : null,
    observedDays: values.length,
    startDate,
  };
}

function buildActivitySeries(
  dates: string[],
  usableByDate: ReadonlyMap<string, DailyMetric>,
  windowDays: PlatformActivityWindowDays,
): PlatformActivitySeries {
  const firstObservedDate = dates[0] ?? null;
  const rolling = dates.map((date) => ({
    date,
    ...rollingAverage(date, windowDays, usableByDate),
  }));
  const complete = rolling.filter(
    (point): point is typeof point & { average: number } => point.average !== null,
  );
  const points: PlatformActivityPoint[] = rolling.map((point) => {
    const currentAverage = point.average;
    const baselineCeiling = shiftUtcDate(point.startDate, -1);
    const baselineValues = complete
      .filter((candidate) => candidate.date <= baselineCeiling)
      .slice(-ACTIVITY_BASELINE_MAX_OBSERVATIONS)
      .map((candidate) => candidate.average);
    const baseline = median(baselineValues);
    let status: PlatformActivityPoint["status"] = "available";
    if (currentAverage === null) {
      status =
        firstObservedDate !== null && point.startDate < firstObservedDate
          ? "building_window"
          : point.observedDays === 0
            ? "building_window"
            : "partial";
    } else if (baselineValues.length < ACTIVITY_BASELINE_MIN_OBSERVATIONS) {
      status = "building_baseline";
    } else if (baseline === null || baseline <= 0) {
      status = "unknown";
    }
    const multiple =
      status === "available" && baseline !== null && currentAverage !== null
        ? currentAverage / baseline
        : null;
    const percentile =
      status === "available" && currentAverage !== null
        ? percentileRank(baselineValues, currentAverage)
        : null;
    return {
      date: point.date,
      windowDays,
      windowStart: point.startDate,
      averageDailyVolumeUsd: currentAverage,
      baselineMedianDailyVolumeUsd: baseline,
      baselineObservationCount: baselineValues.length,
      baselineRequired: ACTIVITY_BASELINE_MIN_OBSERVATIONS,
      multiple,
      percentile,
      band: activityBand(percentile),
      status,
      observedDays: point.observedDays,
      expectedDays: windowDays,
    };
  });
  return {
    windowDays,
    current: points.at(-1) ?? null,
    latestAvailable: [...points].reverse().find((point) => point.status === "available") ?? null,
    points,
  };
}

function buildDailyPoints(
  dates: string[],
  metricByDate: ReadonlyMap<string, DailyMetric>,
): PlatformDailyVolumePoint[] {
  let cumulativeObservedUsd = 0;
  return dates.map((date) => {
    const metric = metricByDate.get(date);
    const usable = metric ? usableDailyMetric(metric) : false;
    if (usable && metric) cumulativeObservedUsd += metric.value;
    return {
      date,
      valueUsd: usable && metric ? metric.value : null,
      rawValueUsd: metric?.value ?? null,
      cumulativeObservedUsd,
      state: !metric
        ? "missing"
        : usable
          ? "observed"
          : metric.derivation === SUSPECT_ZERO
            ? "suspect"
            : "missing",
    };
  });
}

function boundedVolumeSummary(
  window: "7d" | "30d",
  targetDate: string,
  usableByDate: ReadonlyMap<string, DailyMetric>,
): PlatformVolumeSummary {
  const expectedDays = window === "7d" ? 7 : 30;
  const startDate = windowStart(targetDate, expectedDays);
  const values = utcDateRange(startDate, targetDate)
    .map((date) => usableByDate.get(date)?.value)
    .filter((value): value is number => value !== undefined);
  const observedValueUsd = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null;
  const complete = values.length === expectedDays;
  return {
    window,
    startDate,
    endDate: targetDate,
    valueUsd: complete ? observedValueUsd : null,
    observedValueUsd,
    reportedAllTimeUsd: null,
    averageDailyUsd: complete && observedValueUsd !== null ? observedValueUsd / expectedDays : null,
    observedDays: values.length,
    expectedDays,
    coverage: values.length / expectedDays,
    status: complete ? "available" : values.length > 0 ? "partial" : "unknown",
    valueKind: complete ? "daily_sum" : values.length > 0 ? "observed_lower_bound" : "unknown",
  };
}

function lifetimeVolumeSummary(
  targetDate: string,
  daily: PlatformDailyVolumePoint[],
  stats: PlatformStat[],
): PlatformVolumeSummary {
  const firstDate = daily[0]?.date ?? null;
  const expectedDays = daily.length;
  const observed = daily.filter((point) => point.state === "observed");
  const observedValueUsd =
    observed.length > 0 ? observed.reduce((sum, point) => sum + (point.valueUsd ?? 0), 0) : null;
  const reported = stats
    .filter(
      (stat) =>
        stat.key === "volume_all_time_usd" &&
        stat.period === "all_time" &&
        stat.unit === "USD" &&
        stat.quality !== "unknown" &&
        Number.isFinite(stat.value) &&
        stat.value >= 0,
    )
    .sort((left, right) => right.collectedAt.localeCompare(left.collectedAt))[0];
  const complete = expectedDays > 0 && observed.length === expectedDays;
  const valueUsd = reported?.value ?? (complete ? observedValueUsd : null);
  return {
    window: "lifetime",
    startDate: firstDate,
    endDate: targetDate,
    valueUsd,
    observedValueUsd,
    reportedAllTimeUsd: reported?.value ?? null,
    averageDailyUsd:
      complete && observedValueUsd !== null && expectedDays > 0
        ? observedValueUsd / expectedDays
        : null,
    observedDays: observed.length,
    expectedDays,
    coverage: expectedDays === 0 ? 0 : observed.length / expectedDays,
    status: valueUsd !== null ? (reported || complete ? "available" : "partial") : "unknown",
    valueKind: reported
      ? "reported_all_time"
      : complete
        ? "daily_sum"
        : observed.length > 0
          ? "observed_lower_bound"
          : "unknown",
  };
}

function emptyPlatform(platformId: PlatformActivityId): PlatformConfig {
  const displayNames: Record<PlatformActivityId, string> = {
    pons: "Pons",
    pair: "PAIR",
    long: "Long",
  };
  return {
    id: platformId,
    name: displayNames[platformId],
    aliases: [],
    status: "unknown",
    comparability: "unknown",
    excludeFromTotals: false,
    scope: "No registered platform configuration is available.",
    notes: [],
    sourceLinks: [],
    metricPolicies: {},
  };
}

function buildPlatformView(
  platformId: PlatformActivityId,
  targetDate: string,
  platform: PlatformConfig,
  metrics: DailyMetric[],
  stats: PlatformStat[],
): PlatformActivityPlatformView {
  const relevant = metrics
    .filter(
      (metric) =>
        metric.platformId === platformId &&
        metric.metric === "volume_usd" &&
        metric.date <= targetDate,
    )
    .sort((left, right) => left.date.localeCompare(right.date));
  const newestMetrics = [...newestMetricByDate(relevant).values()].sort((left, right) =>
    left.date.localeCompare(right.date),
  );
  const metricByDate = newestMetricByDate(assessDailyMetrics(newestMetrics));
  const firstObservedDate = [...metricByDate.keys()].sort()[0] ?? null;
  const dates = firstObservedDate ? utcDateRange(firstObservedDate, targetDate) : [];
  const usableByDate = new Map(
    [...metricByDate.entries()].filter((entry) => usableDailyMetric(entry[1])),
  );
  const daily = buildDailyPoints(dates, metricByDate);
  const qualities = [...new Set(relevant.map((metric) => metric.quality))];
  const sources = [...new Set(relevant.map((metric) => metric.source))].sort();
  const observedDays = usableByDate.size;
  const volumes: Record<PlatformVolumeWindow, PlatformVolumeSummary> = {
    "7d": boundedVolumeSummary("7d", targetDate, usableByDate),
    "30d": boundedVolumeSummary("30d", targetDate, usableByDate),
    lifetime: lifetimeVolumeSummary(
      targetDate,
      daily,
      stats.filter((stat) => stat.platformId === platformId),
    ),
  };
  return {
    platformId,
    platformName: platform.name,
    scope: platform.scope,
    firstObservedDate,
    lastObservedDate: [...metricByDate.keys()].sort().at(-1) ?? null,
    latestUsableDate: [...usableByDate.keys()].sort().at(-1) ?? null,
    observedDays,
    calendarDays: dates.length,
    historyCoverage: dates.length === 0 ? 0 : observedDays / dates.length,
    sources,
    qualities,
    daily,
    volumes,
    activity: {
      "7d": buildActivitySeries(dates, usableByDate, 7),
      "30d": buildActivitySeries(dates, usableByDate, 30),
    },
  };
}

function buildComparison(
  window: PlatformVolumeWindow,
  platforms: PlatformActivityPlatformView[],
): PlatformVolumeComparison {
  const emptyShares = Object.fromEntries(
    PLATFORM_ACTIVITY_IDS.map((platformId) => [platformId, null]),
  ) as Record<PlatformActivityId, number | null>;
  if (window === "lifetime") {
    return {
      window,
      state: "not_comparable",
      totalUsd: null,
      sharesPercent: emptyShares,
      note: "平台上线日期不同；累计成交仅展示规模，不计算三平台份额。",
    };
  }
  const summaries = platforms.map((platform) => platform.volumes[window]);
  const complete = summaries.every(
    (summary) => summary.status === "available" && summary.valueUsd !== null,
  );
  if (!complete) {
    return {
      window,
      state: "partial",
      totalUsd: null,
      sharesPercent: emptyShares,
      note: "三平台没有覆盖同一完整窗口，市场份额保持未知。",
    };
  }
  const totalUsd = summaries.reduce((sum, summary) => sum + (summary.valueUsd ?? 0), 0);
  if (totalUsd <= 0) {
    return {
      window,
      state: "partial",
      totalUsd: null,
      sharesPercent: emptyShares,
      note: "共同窗口总成交为零，市场份额不可计算。",
    };
  }
  return {
    window,
    state: "available",
    totalUsd,
    sharesPercent: Object.fromEntries(
      platforms.map((platform) => [
        platform.platformId,
        ((platform.volumes[window].valueUsd ?? 0) / totalUsd) * 100,
      ]),
    ) as Record<PlatformActivityId, number | null>,
    note: "仅使用三平台共同覆盖的完整 UTC 日窗口。",
  };
}

export function buildPlatformActivity(input: PlatformActivityInput): PlatformActivityResponse {
  const configs = new Map(input.platforms.map((platform) => [platform.id, platform]));
  const platforms = PLATFORM_ACTIVITY_IDS.map((platformId) =>
    buildPlatformView(
      platformId,
      input.targetDate,
      configs.get(platformId) ?? emptyPlatform(platformId),
      input.metrics,
      input.stats,
    ),
  );
  const warnings = platforms
    .filter((platform) => platform.firstObservedDate === null)
    .map((platform) => `${platform.platformName} 尚无可验证日度成交历史。`);
  return {
    service: "rhc-platform-activity",
    modelVersion: "platform-activity-v1",
    targetDate: input.targetDate,
    generatedAt: input.generatedAt,
    stale: input.stale,
    runStatus: input.runStatus,
    benchmark: {
      formula: "selected-window average daily volume / own prior same-window median",
      baselineMaximumObservations: ACTIVITY_BASELINE_MAX_OBSERVATIONS,
      baselineMinimumObservations: ACTIVITY_BASELINE_MIN_OBSERVATIONS,
      baselineMeaning:
        "1.0x means the selected window matches the platform's own historical median.",
      bands: {
        quiet: "below historical P25",
        normal: "historical P25-P75",
        active: "historical P75-P90",
        unusually_active: "above historical P90",
      },
    },
    platforms,
    comparisons: {
      "7d": buildComparison("7d", platforms),
      "30d": buildComparison("30d", platforms),
      lifetime: buildComparison("lifetime", platforms),
    },
    warnings,
  };
}

export function platformActivityWindows(): readonly PlatformActivityWindowDays[] {
  return PLATFORM_ACTIVITY_WINDOWS;
}
