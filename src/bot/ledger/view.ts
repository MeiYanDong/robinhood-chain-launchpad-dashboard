import { CORE_METRICS } from "../../domain/types.js";
import type {
  MetricName,
  OverviewResponse,
  PlatformDetailResponse,
  PlatformOverviewRow,
  SourceHealth,
} from "../../domain/types.js";
import type { BotMetricView, BotPlatformView, UnknownReason } from "../domain/types.js";

function unknownReason(row: PlatformOverviewRow, sources: SourceHealth[]): UnknownReason {
  if (row.comparability === "scope_mismatch" || row.comparability === "suite_wide")
    return "SCOPE_NOT_COMPARABLE";
  if (sources.some((source) => source.status === "failed")) return "SOURCE_FAILED";
  return "SOURCE_NOT_REPORTING";
}

export function metricView(
  row: PlatformOverviewRow,
  metric: MetricName,
  sources: SourceHealth[] = [],
): BotMetricView {
  const value = row.metrics[metric];
  return {
    metric,
    value: value.value,
    observedDays: value.observedDays,
    windowDays: value.windowDays,
    coverage: value.coverage,
    latestDate: value.latestDate,
    sources: [...value.sources],
    qualities: [...value.qualities],
    scope: row.scope,
    comparability: row.comparability,
    excludeFromTotals: row.excludeFromTotals,
    unknownReason: value.value === null ? unknownReason(row, sources) : null,
  };
}

export function platformView(
  overview: OverviewResponse,
  platformId: string,
  detail: PlatformDetailResponse | null,
  sources: SourceHealth[] = [],
): BotPlatformView | null {
  const row = overview.platforms.find((platform) => platform.id === platformId);
  if (!row) return null;
  if (detail && detail.platform.id !== row.id) return null;
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    scope: row.scope,
    notes: [...row.notes],
    comparability: row.comparability,
    excludeFromTotals: row.excludeFromTotals,
    metrics: Object.fromEntries(
      CORE_METRICS.map((metric) => [metric, metricView(row, metric, sources)]),
    ) as Record<MetricName, BotMetricView>,
    stats: detail?.stats ?? [],
  };
}
