import { findRegisteredPlatform, metricPolicyFor } from "../config/platforms.js";
import type { CollectionBatch, DailyMetric, PlatformStat } from "../domain/types.js";
import { fetchJson, finiteNumber, isRecord } from "../utils/http.js";
import { isDateOnOrBefore, parseLooseUtcDate } from "../utils/time.js";

export const PONS_ANALYTICS_URL = "https://www.ponsfamily.com/api/pons-analytics?v=dune-v2";
export const PONS_DAILY_SOURCE = "pons.officialAnalytics.dailyVolume";

interface PonsAnalyticsExtraction {
  metrics: DailyMetric[];
  stats: PlatformStat[];
  latestDataDate: string | null;
}

function addStat(
  stats: PlatformStat[],
  input: {
    key: string;
    label: string;
    value: number | null;
    unit: PlatformStat["unit"];
    period: PlatformStat["period"];
    scope: string;
    collectedAt: string;
  },
): void {
  if (input.value === null || input.value < 0) return;
  stats.push({
    platformId: "pons",
    key: input.key,
    label: input.label,
    value: input.value,
    unit: input.unit,
    period: input.period,
    source: "pons.officialAnalytics",
    quality: "reported",
    scope: input.scope,
    derivation: null,
    collectedAt: input.collectedAt,
  });
}

export function extractPonsAnalytics(
  payload: unknown,
  targetDate: string,
  collectedAt: string,
): PonsAnalyticsExtraction {
  if (!isRecord(payload) || !Array.isArray(payload.series)) {
    throw new Error("Pons analytics payload is missing daily series");
  }
  const platform = findRegisteredPlatform("Pons");
  if (!platform) throw new Error("Pons registry entry is missing");
  const policy = metricPolicyFor(platform, "volume_usd");
  const byDate = new Map<string, number>();

  for (const candidate of payload.series) {
    if (!isRecord(candidate)) continue;
    const date = parseLooseUtcDate(candidate.timestamp);
    const volume = finiteNumber(candidate.volumeUsd);
    if (!date || volume === null || volume < 0 || !isDateOnOrBefore(date, targetDate)) continue;
    byDate.set(date, volume);
  }

  const metrics: DailyMetric[] = [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, value]) => ({
      platformId: platform.id,
      metric: "volume_usd",
      date,
      value,
      source: PONS_DAILY_SOURCE,
      quality: policy.quality,
      scope: "Pons official Dune-backed daily launchpad volume",
      derivation: "Official analytics series; fee and revenue adapters remain separate scopes.",
      collectedAt,
    }));

  const totals = isRecord(payload.totals) ? payload.totals : {};
  const stats: PlatformStat[] = [];
  addStat(stats, {
    key: "volume_rolling_24h_usd",
    label: "最新闭合日成交量",
    value: finiteNumber(totals.volumeUsd24h),
    unit: "USD",
    period: "rolling_24h",
    scope: "Latest completed UTC day from Pons official analytics",
    collectedAt,
  });
  addStat(stats, {
    key: "tokens_launched_rolling_24h",
    label: "最新闭合日发射数",
    value: finiteNumber(totals.launches24h),
    unit: "count",
    period: "rolling_24h",
    scope: "Latest completed UTC day from Pons official analytics",
    collectedAt,
  });
  addStat(stats, {
    key: "volume_all_time_usd",
    label: "累计成交量",
    value: finiteNumber(totals.volumeUsdAllTime),
    unit: "USD",
    period: "all_time",
    scope: "Pons official Dune-backed all-time launchpad volume",
    collectedAt,
  });
  addStat(stats, {
    key: "platform_revenue_all_time_usd",
    label: "累计协议收入",
    value: finiteNumber(totals.protocolRevenueUsd),
    unit: "USD",
    period: "all_time",
    scope: "All-time protocol revenue reported by Pons analytics",
    collectedAt,
  });
  addStat(stats, {
    key: "creator_revenue_all_time_usd",
    label: "累计创作者收入",
    value: finiteNumber(totals.creatorEarningsUsd),
    unit: "USD",
    period: "all_time",
    scope: "All-time creator earnings reported by Pons analytics",
    collectedAt,
  });
  addStat(stats, {
    key: "tokens_launched_all_time",
    label: "累计发射代币",
    value: finiteNumber(totals.launchesAllTime),
    unit: "count",
    period: "all_time",
    scope: "All-time launches reported by Pons analytics",
    collectedAt,
  });

  return {
    metrics,
    stats,
    latestDataDate: parseLooseUtcDate(payload.latestDay) ?? metrics.at(-1)?.date ?? null,
  };
}

export async function collectPonsAnalytics(targetDate: string): Promise<CollectionBatch> {
  const platform = findRegisteredPlatform("Pons");
  if (!platform) throw new Error("Pons registry entry is missing");

  try {
    const fetched = await fetchJson(PONS_ANALYTICS_URL, { timeoutMs: 20_000, retries: 1 });
    const parsed = extractPonsAnalytics(fetched.payload, targetDate, fetched.fetchedAt);
    const degraded = parsed.metrics.length === 0 || parsed.latestDataDate !== targetDate;
    return {
      platforms: [platform],
      metrics: parsed.metrics,
      stats: parsed.stats,
      sourceHealth: [
        {
          source: "pons.officialAnalytics",
          status: degraded ? "degraded" : "ok",
          fetchedAt: fetched.fetchedAt,
          latestDataDate: parsed.latestDataDate,
          latencyMs: fetched.latencyMs,
          message: degraded
            ? "Pons analytics responded, but the latest closed day is lagging or missing."
            : `${parsed.metrics.length} official Pons daily volume observations parsed.`,
        },
      ],
      raw: [
        {
          source: "pons.officialAnalytics",
          fetchedAt: fetched.fetchedAt,
          sha256: fetched.sha256,
          payload: fetched.payload,
        },
      ],
      warnings: degraded ? ["pons_analytics_latest_day_lagging"] : [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fetchedAt = new Date().toISOString();
    return {
      platforms: [platform],
      metrics: [],
      stats: [],
      sourceHealth: [
        {
          source: "pons.officialAnalytics",
          status: "failed",
          fetchedAt,
          latestDataDate: null,
          latencyMs: 0,
          message,
        },
      ],
      raw: [],
      warnings: [`pons.officialAnalytics failed: ${message}`],
    };
  }
}
