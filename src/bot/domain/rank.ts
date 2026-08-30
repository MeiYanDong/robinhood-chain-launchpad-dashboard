import type { MetricName, OverviewResponse, SourceHealth } from "../../domain/types.js";
import type { BotMetricView } from "./types.js";
import { metricView } from "../ledger/view.js";

export interface RankEntry {
  platformId: string;
  name: string;
  status: string;
  metric: BotMetricView;
}

export interface RankResult {
  metric: MetricName;
  scope: "live" | "all";
  entries: RankEntry[];
  incomparable: RankEntry[];
  missingCount: number;
  candidateCount: number;
  sources: SourceHealth[];
}

export function rankPlatforms(
  overview: OverviewResponse,
  metric: MetricName,
  scope: "live" | "all",
  sources: SourceHealth[] = [],
): RankResult {
  const visible = overview.platforms.filter(
    (platform) => scope === "all" || platform.status === "live",
  );
  const incomparable = visible
    .filter(
      (platform) =>
        platform.excludeFromTotals ||
        platform.comparability === "suite_wide" ||
        platform.comparability === "unknown",
    )
    .filter((platform) => platform.metrics[metric].value !== null)
    .map((platform) => ({
      platformId: platform.id,
      name: platform.name,
      status: platform.status,
      metric: metricView(platform, metric, sources),
    }));

  const rankable = visible.filter(
    (platform) =>
      !platform.excludeFromTotals &&
      platform.comparability !== "suite_wide" &&
      platform.comparability !== "unknown",
  );
  const missingCount = rankable.filter(
    (platform) => platform.metrics[metric].value === null,
  ).length;
  const entries = rankable
    .filter((platform) => platform.metrics[metric].value !== null)
    .map((platform) => ({
      platformId: platform.id,
      name: platform.name,
      status: platform.status,
      metric: metricView(platform, metric, sources),
    }))
    .sort((left, right) => {
      const difference = (right.metric.value as number) - (left.metric.value as number);
      return difference === 0 ? left.name.localeCompare(right.name) : difference;
    })
    .slice(0, 5);

  incomparable.sort((left, right) => left.name.localeCompare(right.name));
  return {
    metric,
    scope,
    entries,
    incomparable,
    missingCount,
    candidateCount: rankable.length,
    sources: sources.map((source) => ({ ...source })),
  };
}
