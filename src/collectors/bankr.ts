import { findRegisteredPlatform, metricPolicyFor } from "../config/platforms.js";
import type { CollectionBatch, DailyMetric } from "../domain/types.js";
import { fetchJson, finiteNumber, isRecord } from "../utils/http.js";
import { isDateOnOrBefore, parseLooseUtcDate } from "../utils/time.js";

export const BANKR_DASHBOARD_URL = "https://api.bankr.bot/public/dashboard";

function possibleRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value)) return Object.values(value);
  return [];
}

function rowDate(row: Record<string, unknown>): string | null {
  for (const key of ["date", "day", "timestamp", "time", "createdAt"]) {
    const parsed = parseLooseUtcDate(row[key]);
    if (parsed) return parsed;
  }
  return null;
}

function robinhoodValue(row: Record<string, unknown>): number | null {
  for (const key of ["robinhood", "robinhoodChain", "rhc"]) {
    const direct = finiteNumber(row[key]);
    if (direct !== null) return direct;
    const nested = row[key];
    if (isRecord(nested)) {
      for (const valueKey of ["usd", "volume", "value", "total"]) {
        const value = finiteNumber(nested[valueKey]);
        if (value !== null) return value;
      }
    }
  }
  return null;
}

export function extractBankrMetrics(
  payload: unknown,
  targetDate: string,
  collectedAt: string,
): { metrics: DailyMetric[]; latestDataDate: string | null } {
  if (!isRecord(payload)) throw new Error("Bankr payload is not an object");
  const platform = findRegisteredPlatform("Bankr");
  if (!platform) throw new Error("Bankr registry entry is missing");

  const rows = possibleRows(payload.dailyVolumeByChain);
  const policy = metricPolicyFor(platform, "volume_usd");
  const byDate = new Map<string, number>();

  for (const candidate of rows) {
    if (!isRecord(candidate)) continue;
    const date = rowDate(candidate);
    const value = robinhoodValue(candidate);
    if (!date || value === null || value < 0 || !isDateOnOrBefore(date, targetDate)) continue;
    byDate.set(date, value);
  }

  const metrics: DailyMetric[] = [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, value]) => ({
      platformId: platform.id,
      metric: "volume_usd",
      date,
      value,
      source: "bankr.officialDashboard",
      quality: policy.quality,
      scope: policy.scope,
      derivation: policy.note ?? null,
      collectedAt,
    }));

  return {
    metrics,
    latestDataDate: metrics.at(-1)?.date ?? null,
  };
}

export async function collectBankr(targetDate: string): Promise<CollectionBatch> {
  const platform = findRegisteredPlatform("Bankr");
  if (!platform) throw new Error("Bankr registry entry is missing");

  try {
    const fetched = await fetchJson(BANKR_DASHBOARD_URL, { timeoutMs: 20_000, retries: 1 });
    const parsed = extractBankrMetrics(fetched.payload, targetDate, fetched.fetchedAt);
    return {
      platforms: [platform],
      metrics: parsed.metrics,
      stats: [],
      sourceHealth: [
        {
          source: "bankr.officialDashboard",
          status: parsed.metrics.length > 0 ? "ok" : "degraded",
          fetchedAt: fetched.fetchedAt,
          latestDataDate: parsed.latestDataDate,
          latencyMs: fetched.latencyMs,
          message:
            parsed.metrics.length > 0
              ? `${parsed.metrics.length} Robinhood Chain daily volume observations`
              : "Dashboard responded, but no Robinhood Chain daily volume rows were parsed",
        },
      ],
      raw: [
        {
          source: "bankr.officialDashboard",
          fetchedAt: fetched.fetchedAt,
          sha256: fetched.sha256,
          payload: fetched.payload,
        },
      ],
      warnings:
        parsed.metrics.length > 0
          ? []
          : ["Bankr official dashboard contained no parseable Robinhood Chain volume rows."],
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
          source: "bankr.officialDashboard",
          status: "failed",
          fetchedAt,
          latestDataDate: null,
          latencyMs: 0,
          message,
        },
      ],
      raw: [],
      warnings: [`bankr.officialDashboard failed: ${message}`],
    };
  }
}
