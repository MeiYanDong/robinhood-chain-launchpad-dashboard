import { GROWTHEPIE_METRICS, PEERS, type MetricDefinition } from "./config.js";
import type { ChainValue, Freshness, MetricSnapshot, SeriesPoint } from "./types.js";
import { asNumber, asString, dateDiffDays, isRecord, round, shiftDate } from "./utils.js";

interface FundamentalRow {
  metricKey: string;
  originKey: string;
  date: string;
  value: number;
}

function normalizeDate(value: unknown): string | null {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 10_000_000_000 ? value : value * 1000;
    return new Date(millis).toISOString().slice(0, 10);
  }
  return null;
}

export function parseFundamentals(data: unknown): FundamentalRow[] {
  if (!Array.isArray(data)) return [];
  const rows: FundamentalRow[] = [];
  for (const item of data) {
    if (!isRecord(item)) continue;
    const metricKey = asString(item.metric_key);
    const originKey = asString(item.origin_key);
    const date = normalizeDate(item.date);
    const value = asNumber(item.value);
    if (metricKey && originKey && date && value !== null) rows.push({ metricKey, originKey, date, value });
  }
  return rows;
}

function masterChains(master: unknown): Record<string, Record<string, unknown>> {
  if (!isRecord(master) || !isRecord(master.chains)) return {};
  return Object.fromEntries(
    Object.entries(master.chains).filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1])),
  );
}

function history(rows: FundamentalRow[], metricKey: string, originKey: string, targetDate: string): SeriesPoint[] {
  return rows
    .filter((row) => row.metricKey === metricKey && row.originKey === originKey && row.date <= targetDate)
    .map((row) => ({ date: row.date, value: row.value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function average(points: SeriesPoint[]): number | null {
  if (points.length === 0) return null;
  return round(points.reduce((sum, point) => sum + point.value, 0) / points.length);
}

function changeFrom(points: SeriesPoint[], dataDate: string, days: number): number | null {
  const current = points.at(-1);
  if (!current || current.value === 0) return null;
  const cutoff = shiftDate(dataDate, -days);
  const previous = [...points].reverse().find((point) => point.date <= cutoff && dateDiffDays(cutoff, point.date) <= 3);
  if (!previous || previous.value === 0) return null;
  return round((current.value - previous.value) / Math.abs(previous.value), 6);
}

function rankValues(
  values: ChainValue[],
  direction: "asc" | "desc",
  targetId = "robinhood",
): { rank: number | null; total: number | null } {
  const present = values.filter((value): value is ChainValue & { value: number } => value.value !== null);
  present.sort((a, b) => (direction === "asc" ? a.value - b.value : b.value - a.value));
  const index = present.findIndex((value) => value.id === targetId);
  return { rank: index >= 0 ? index + 1 : null, total: present.length || null };
}

function emptyMetric(definition: MetricDefinition, targetDate: string): MetricSnapshot {
  return {
    id: definition.id,
    label: definition.label,
    shortLabel: definition.shortLabel,
    unit: definition.unit,
    temporalScope: "closed_day",
    value: null,
    dataDate: null,
    targetDate,
    freshness: "unavailable",
    lagDays: null,
    avg7d: null,
    change7d: null,
    change30d: null,
    series: [],
    peers: PEERS.map((peer) => ({ id: peer.id, name: peer.name, value: null, dataDate: null })),
    peerRank: null,
    peerTotal: null,
    trackedRank: null,
    trackedTotal: null,
    percentile: null,
    sourceId: "growthepie_fundamentals",
    definition: definition.definition,
    caveat: definition.caveat,
  };
}

export function buildGrowthepieMetrics(data: unknown, master: unknown, targetDate: string): MetricSnapshot[] {
  const rows = parseFundamentals(data);
  const chains = masterChains(master);
  const excluded = new Set(["ethereum", "all_l2s", "multiple"]);

  return GROWTHEPIE_METRICS.map((definition) => {
    const robinhoodHistory = history(rows, definition.sourceKey, "robinhood", targetDate);
    const latest = robinhoodHistory.at(-1);
    if (!latest) return emptyMetric(definition, targetDate);

    const dataDate = latest.date;
    const peerValues: ChainValue[] = PEERS.map((peer) => {
      const point = rows.find(
        (row) => row.metricKey === definition.sourceKey && row.originKey === peer.growthepie && row.date === dataDate,
      );
      return { id: peer.id, name: peer.name, value: point?.value ?? null, dataDate: point ? dataDate : null };
    });

    const trackedValues: ChainValue[] = [];
    for (const [id, metadata] of Object.entries(chains)) {
      if (excluded.has(id)) continue;
      const launchDate = asString(metadata.launch_date);
      if (launchDate && launchDate > dataDate) continue;
      const point = rows.find(
        (row) => row.metricKey === definition.sourceKey && row.originKey === id && row.date === dataDate,
      );
      if (!point) continue;
      trackedValues.push({ id, name: asString(metadata.name) ?? id, value: point.value, dataDate });
    }

    const peerRank = rankValues(peerValues, definition.rankDirection);
    const trackedRank = rankValues(trackedValues, definition.rankDirection);
    const lagDays = Math.max(0, dateDiffDays(targetDate, dataDate));
    const freshness: Freshness = lagDays <= 1 ? "ok" : "stale";
    const recent7 = robinhoodHistory.filter((point) => point.date >= shiftDate(dataDate, -6));
    const percentile =
      trackedRank.rank !== null && trackedRank.total !== null
        ? trackedRank.total === 1
          ? 100
          : round(((trackedRank.total - trackedRank.rank) / (trackedRank.total - 1)) * 100, 1)
        : null;

    return {
      id: definition.id,
      label: definition.label,
      shortLabel: definition.shortLabel,
      unit: definition.unit,
      temporalScope: "closed_day",
      value: round(latest.value),
      dataDate,
      targetDate,
      freshness,
      lagDays,
      avg7d: average(recent7),
      change7d: changeFrom(robinhoodHistory, dataDate, 7),
      change30d: changeFrom(robinhoodHistory, dataDate, 30),
      series: robinhoodHistory.slice(-90).map((point) => ({ ...point, value: round(point.value) ?? point.value })),
      peers: peerValues.map((point) => ({ ...point, value: round(point.value) })),
      peerRank: peerRank.rank,
      peerTotal: peerRank.total,
      trackedRank: trackedRank.rank,
      trackedTotal: trackedRank.total,
      percentile,
      sourceId: "growthepie_fundamentals",
      definition: definition.definition,
      caveat: definition.caveat,
    };
  });
}

export function latestRobinhoodDataDate(data: unknown, targetDate: string): string | null {
  const rows = parseFundamentals(data).filter((row) => row.originKey === "robinhood" && row.date <= targetDate);
  return rows.sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.date ?? null;
}
