import { findRegisteredPlatform, metricPolicyFor } from "../config/platforms.js";
import type { CollectionBatch, DailyMetric, PlatformStat } from "../domain/types.js";
import { fetchJson, finiteNumber, isRecord } from "../utils/http.js";
import { isDateOnOrBefore, parseLooseUtcDate } from "../utils/time.js";

export const PAIR_PROTOCOL_STATS_URL = "https://pair.fund/api/stats/protocol";
export const PAIR_PROTOCOL_DAILY_SOURCE = "pair.officialStats.dailyVolume";

interface PairProtocolExtraction {
  metrics: DailyMetric[];
  stats: PlatformStat[];
  latestDataDate: string | null;
  stale: boolean;
  incompleteValuationDays: number;
}

function dailyRows(payload: Record<string, unknown>): unknown[] {
  return Array.isArray(payload.last7Days) ? payload.last7Days : [];
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
    platformId: "pair",
    key: input.key,
    label: input.label,
    value: input.value,
    unit: input.unit,
    period: input.period,
    source: "pair.officialStats",
    quality: "reported",
    scope: input.scope,
    derivation: null,
    collectedAt: input.collectedAt,
  });
}

export function extractPairProtocolStats(
  payload: unknown,
  targetDate: string,
  collectedAt: string,
): PairProtocolExtraction {
  if (!isRecord(payload)) throw new Error("PAIR protocol stats payload is not an object");
  const platform = findRegisteredPlatform("PAIR");
  if (!platform) throw new Error("PAIR registry entry is missing");
  if (payload.source !== "dune") throw new Error("PAIR protocol stats source is not Dune");

  const policy = metricPolicyFor(platform, "volume_usd");
  const byDate = new Map<string, number>();
  let incompleteValuationDays = 0;
  for (const candidate of dailyRows(payload)) {
    if (!isRecord(candidate) || candidate.available === false) continue;
    const date = parseLooseUtcDate(candidate.day);
    const volume = finiteNumber(candidate.volumeUsd);
    if (!date || volume === null || volume < 0 || !isDateOnOrBefore(date, targetDate)) continue;
    byDate.set(date, volume);
    const coverage = finiteNumber(candidate.valuationCoverage);
    if (coverage !== null && coverage < 0.999) incompleteValuationDays += 1;
  }

  const metrics: DailyMetric[] = [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, value]) => ({
      platformId: platform.id,
      metric: "volume_usd",
      date,
      value,
      source: PAIR_PROTOCOL_DAILY_SOURCE,
      quality: policy.quality,
      scope: policy.scope,
      derivation: policy.note ?? null,
      collectedAt,
    }));

  const stats: PlatformStat[] = [];
  const daily = isRecord(payload.daily) ? payload.daily : {};
  const allTime = isRecord(payload.allTime) ? payload.allTime : {};
  addStat(stats, {
    key: "volume_rolling_24h_usd",
    label: "最新闭合日成交量",
    value: finiteNumber(daily.volumeUsd),
    unit: "USD",
    period: "rolling_24h",
    scope: "Latest completed UTC day from PAIR protocol analytics",
    collectedAt,
  });
  addStat(stats, {
    key: "trades_rolling_24h",
    label: "最新闭合日交易数",
    value: finiteNumber(daily.trades),
    unit: "count",
    period: "rolling_24h",
    scope: "Latest completed UTC day from PAIR protocol analytics",
    collectedAt,
  });
  addStat(stats, {
    key: "tokens_launched_rolling_24h",
    label: "最新闭合日发射数",
    value: finiteNumber(daily.tokenLaunches),
    unit: "count",
    period: "rolling_24h",
    scope: "Latest completed UTC day from PAIR protocol analytics",
    collectedAt,
  });
  addStat(stats, {
    key: "volume_all_time_usd",
    label: "累计成交量",
    value: finiteNumber(allTime.volumeUsd),
    unit: "USD",
    period: "all_time",
    scope: "PAIR Dune-backed all-time protocol volume",
    collectedAt,
  });
  addStat(stats, {
    key: "trades_all_time",
    label: "累计交易数",
    value: finiteNumber(allTime.trades),
    unit: "count",
    period: "all_time",
    scope: "PAIR Dune-backed all-time trades",
    collectedAt,
  });
  addStat(stats, {
    key: "tokens_launched_all_time",
    label: "累计发射代币",
    value: finiteNumber(allTime.tokenLaunches),
    unit: "count",
    period: "all_time",
    scope: "PAIR Dune-backed all-time launches",
    collectedAt,
  });

  return {
    metrics,
    stats,
    latestDataDate: parseLooseUtcDate(payload.latestCompletedDay) ?? metrics.at(-1)?.date ?? null,
    stale: payload.stale === true,
    incompleteValuationDays,
  };
}

export async function collectPairProtocol(targetDate: string): Promise<CollectionBatch> {
  const platform = findRegisteredPlatform("PAIR");
  if (!platform) throw new Error("PAIR registry entry is missing");

  try {
    const fetched = await fetchJson(PAIR_PROTOCOL_STATS_URL, { timeoutMs: 20_000, retries: 1 });
    const parsed = extractPairProtocolStats(fetched.payload, targetDate, fetched.fetchedAt);
    const degraded =
      parsed.metrics.length === 0 || parsed.stale || parsed.incompleteValuationDays > 0;
    return {
      platforms: [platform],
      metrics: parsed.metrics,
      stats: parsed.stats,
      sourceHealth: [
        {
          source: "pair.officialStats",
          status: degraded ? "degraded" : "ok",
          fetchedAt: fetched.fetchedAt,
          latestDataDate: parsed.latestDataDate,
          latencyMs: fetched.latencyMs,
          message: degraded
            ? "PAIR protocol stats responded with lagging or partially valued daily data."
            : `${parsed.metrics.length} official PAIR daily volume observations parsed.`,
        },
      ],
      raw: [
        {
          source: "pair.officialStats",
          fetchedAt: fetched.fetchedAt,
          sha256: fetched.sha256,
          payload: fetched.payload,
        },
      ],
      warnings: [
        ...(parsed.stale ? ["pair_protocol_stats_stale"] : []),
        ...(parsed.incompleteValuationDays > 0 ? ["pair_protocol_valuation_partial"] : []),
        ...(parsed.metrics.length === 0 ? ["pair_protocol_daily_volume_missing"] : []),
      ],
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
          source: "pair.officialStats",
          status: "failed",
          fetchedAt,
          latestDataDate: null,
          latencyMs: 0,
          message,
        },
      ],
      raw: [],
      warnings: [`pair.officialStats failed: ${message}`],
    };
  }
}
