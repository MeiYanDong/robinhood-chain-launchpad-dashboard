import { CORE_METRICS } from "./types.js";
import type {
  DailyMetric,
  MetricName,
  MetricWindowValue,
  OverviewResponse,
  PlatformConfig,
  PlatformOverviewRow,
  WindowDays,
} from "./types.js";
import { windowStart } from "../utils/time.js";

export function emptyMetricWindow(windowDays: number): MetricWindowValue {
  return {
    value: null,
    observedDays: 0,
    windowDays,
    coverage: 0,
    latestDate: null,
    sources: [],
    qualities: [],
  };
}

export function aggregateMetricWindow(
  metrics: DailyMetric[],
  windowDays: number,
): MetricWindowValue {
  if (metrics.length === 0) return emptyMetricWindow(windowDays);

  const dates = new Set(metrics.map((metric) => metric.date));
  const sources = [...new Set(metrics.map((metric) => metric.source))].sort();
  const qualities = [...new Set(metrics.map((metric) => metric.quality))];
  const value = metrics.reduce((sum, metric) => sum + metric.value, 0);
  const latestDate = metrics.reduce(
    (latest, metric) => (latest === null || metric.date > latest ? metric.date : latest),
    null as string | null,
  );

  return {
    value,
    observedDays: dates.size,
    windowDays,
    coverage: Math.min(1, dates.size / windowDays),
    latestDate,
    sources,
    qualities,
  };
}

function metricRecord(windowDays: number): Record<MetricName, MetricWindowValue> {
  return Object.fromEntries(
    CORE_METRICS.map((metric) => [metric, emptyMetricWindow(windowDays)]),
  ) as Record<MetricName, MetricWindowValue>;
}

export function buildOverview(input: {
  platforms: PlatformConfig[];
  metrics: DailyMetric[];
  targetDate: string;
  windowDays: WindowDays;
  generatedAt: string;
  stale: boolean;
  runStatus: string;
  warnings?: string[];
}): OverviewResponse {
  const start = windowStart(input.targetDate, input.windowDays);
  const boundedMetrics = input.metrics.filter(
    (metric) => metric.date >= start && metric.date <= input.targetDate,
  );

  const platformRows: PlatformOverviewRow[] = input.platforms.map((platform) => {
    const metrics = metricRecord(input.windowDays);
    for (const metricName of CORE_METRICS) {
      metrics[metricName] = aggregateMetricWindow(
        boundedMetrics.filter(
          (metric) => metric.platformId === platform.id && metric.metric === metricName,
        ),
        input.windowDays,
      );
    }

    return {
      id: platform.id,
      name: platform.name,
      status: platform.status,
      comparability: platform.comparability,
      excludeFromTotals: platform.excludeFromTotals,
      scope: platform.scope,
      notes: platform.notes,
      metrics,
    };
  });

  platformRows.sort((left, right) => {
    const leftVolume = left.metrics.volume_usd.value ?? -1;
    const rightVolume = right.metrics.volume_usd.value ?? -1;
    if (leftVolume !== rightVolume) return rightVolume - leftVolume;
    const leftFees = left.metrics.fees_usd.value ?? -1;
    const rightFees = right.metrics.fees_usd.value ?? -1;
    if (leftFees !== rightFees) return rightFees - leftFees;
    return left.name.localeCompare(right.name);
  });

  const eligible = platformRows.filter((platform) => !platform.excludeFromTotals);
  const summary = metricRecord(eligible.length);
  for (const metricName of CORE_METRICS) {
    const contributors = eligible.filter((platform) => platform.metrics[metricName].value !== null);
    summary[metricName] = {
      value:
        contributors.length === 0
          ? null
          : contributors.reduce(
              (sum, platform) => sum + (platform.metrics[metricName].value ?? 0),
              0,
            ),
      observedDays: contributors.length,
      windowDays: eligible.length,
      coverage: eligible.length === 0 ? 0 : contributors.length / eligible.length,
      latestDate: contributors.reduce((latest, platform) => {
        const candidate = platform.metrics[metricName].latestDate;
        return candidate && (!latest || candidate > latest) ? candidate : latest;
      }, null as string | null),
      sources: [
        ...new Set(contributors.flatMap((platform) => platform.metrics[metricName].sources)),
      ].sort(),
      qualities: [
        ...new Set(contributors.flatMap((platform) => platform.metrics[metricName].qualities)),
      ],
    };
  }

  const activePlatforms = platformRows.filter((platform) =>
    CORE_METRICS.some((metric) => platform.metrics[metric].value !== null),
  ).length;

  return {
    targetDate: input.targetDate,
    windowDays: input.windowDays,
    generatedAt: input.generatedAt,
    stale: input.stale,
    runStatus: input.runStatus,
    summary: {
      ...summary,
      activePlatforms,
      eligiblePlatforms: eligible.length,
    },
    platforms: platformRows,
    warnings: input.warnings ?? [],
  };
}
