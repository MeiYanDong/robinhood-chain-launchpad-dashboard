import type { DailyMetric } from "./types.js";

export const SUSPECT_ZERO = "suspect_zero_after_material_activity";

/** Preserve the observation; quarantine only abrupt zeroes after material activity. */
export function assessDailyMetrics(metrics: DailyMetric[]): DailyMetric[] {
  return metrics.map((metric) => {
    if (metric.metric !== "volume_usd" || metric.value !== 0) return metric;
    const previousDate = new Date(`${metric.date}T00:00:00Z`);
    previousDate.setUTCDate(previousDate.getUTCDate() - 1);
    const previous = metrics.find(
      (candidate) =>
        candidate.platformId === metric.platformId &&
        candidate.metric === metric.metric &&
        candidate.date === previousDate.toISOString().slice(0, 10) &&
        candidate.source === metric.source,
    );
    if (!previous || previous.value < 1_000_000) return metric;
    return { ...metric, quality: "unknown", derivation: SUSPECT_ZERO };
  });
}

export function usableDailyMetric(metric: DailyMetric): boolean {
  return metric.quality !== "unknown" && Number.isFinite(metric.value) && metric.value >= 0;
}
