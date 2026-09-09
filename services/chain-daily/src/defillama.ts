import { ENDPOINTS, PEERS } from "./config.js";
import type { ChainValue, MetricSnapshot, RawBundle, SeriesPoint, SourceReceipt, Unit } from "./types.js";
import { asNumber, asString, dateDiffDays, fetchSource, isRecord, round, shiftDate } from "./utils.js";

interface LlamaMetricDefinition {
  id: string;
  label: string;
  shortLabel: string;
  unit: Unit;
  route: "dexs" | "fees";
  dataType: "dailyVolume" | "dailyFees" | "dailyRevenue";
  definition: string;
  caveat: string;
}

const DEFINITIONS: LlamaMetricDefinition[] = [
  {
    id: "dex_volume",
    label: "DEX 成交量",
    shortLabel: "DEX 量",
    unit: "usd",
    route: "dexs",
    dataType: "dailyVolume",
    definition: "DefiLlama 适配器汇总的链上 DEX 日成交名义额。",
    caveat: "适配器覆盖和回填会变化；不是 Robinhood 经纪业务成交量。",
  },
  {
    id: "protocol_fees",
    label: "协议用户费用",
    shortLabel: "协议费用",
    unit: "usd",
    route: "fees",
    dataType: "dailyFees",
    definition: "DefiLlama 适配器汇总的用户向链上协议支付的费用。",
    caveat: "不同协议费用口径不同，适合观察生态趋势，不是财务审计。",
  },
  {
    id: "protocol_revenue",
    label: "协议收入",
    shortLabel: "协议收入",
    unit: "usd",
    route: "fees",
    dataType: "dailyRevenue",
    definition: "DefiLlama Revenue 口径下由协议保留或分配的收入。",
    caveat: "不等于 Robinhood 公司收入，且只覆盖已有适配器的协议。",
  },
];

interface HistoryFetch {
  peer: (typeof PEERS)[number];
  series: SeriesPoint[];
  receipt: SourceReceipt;
  raw: unknown;
}

export function parseDefillamaChart(data: unknown): SeriesPoint[] {
  if (!isRecord(data) || !Array.isArray(data.totalDataChart)) return [];
  const byDate = new Map<string, number>();
  for (const row of data.totalDataChart) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const timestamp = asNumber(row[0]);
    const value = asNumber(row[1]);
    if (timestamp === null || value === null) continue;
    const millis = timestamp > 10_000_000_000 ? timestamp : timestamp * 1000;
    byDate.set(new Date(millis).toISOString().slice(0, 10), value);
  }
  return [...byDate.entries()].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
}

function average(points: SeriesPoint[]): number | null {
  if (points.length === 0) return null;
  return round(points.reduce((sum, point) => sum + point.value, 0) / points.length);
}

function change(points: SeriesPoint[], dataDate: string, days: number): number | null {
  const latest = points.find((point) => point.date === dataDate);
  if (!latest) return null;
  const cutoff = shiftDate(dataDate, -days);
  const previous = [...points].reverse().find((point) => point.date <= cutoff && dateDiffDays(cutoff, point.date) <= 3);
  if (!previous || previous.value === 0) return null;
  return round((latest.value - previous.value) / Math.abs(previous.value), 6);
}

function rank(peers: ChainValue[]): { rank: number | null; total: number | null } {
  const present = peers.filter((item): item is ChainValue & { value: number } => item.value !== null);
  present.sort((a, b) => b.value - a.value);
  const index = present.findIndex((item) => item.id === "robinhood");
  return { rank: index >= 0 ? index + 1 : null, total: present.length || null };
}

async function fetchHistory(
  definition: LlamaMetricDefinition,
  peer: (typeof PEERS)[number],
  targetDate: string,
): Promise<HistoryFetch> {
  const url = `https://api.llama.fi/overview/${definition.route}/${encodeURIComponent(peer.defillama)}?excludeTotalDataChart=false&excludeTotalDataChartBreakdown=true&dataType=${definition.dataType}`;
  const id = `defillama_${definition.id}_${peer.id}`;
  const result = await fetchSource(id, `DefiLlama · ${definition.label} · ${peer.name}`, url);
  const series = parseDefillamaChart(result.data);
  result.receipt.dataDate = series.filter((point) => point.date <= targetDate).at(-1)?.date ?? null;
  return { peer, series, receipt: result.receipt, raw: result.data };
}

function buildHistoryMetric(
  definition: LlamaMetricDefinition,
  histories: HistoryFetch[],
  targetDate: string,
): MetricSnapshot {
  const robinhood = histories.find((item) => item.peer.id === "robinhood");
  const eligible = robinhood?.series.filter((point) => point.date <= targetDate) ?? [];
  const latest = eligible.at(-1);
  const dataDate = latest?.date ?? null;
  const peerValues: ChainValue[] = histories.map(({ peer, series }) => {
    const point = dataDate ? series.find((item) => item.date === dataDate) : undefined;
    return { id: peer.id, name: peer.name, value: round(point?.value ?? null), dataDate: point ? dataDate : null };
  });
  const ranking = rank(peerValues);
  const lagDays = dataDate ? Math.max(0, dateDiffDays(targetDate, dataDate)) : null;
  const recent = dataDate ? eligible.filter((point) => point.date >= shiftDate(dataDate, -6)) : [];

  return {
    id: definition.id,
    label: definition.label,
    shortLabel: definition.shortLabel,
    unit: definition.unit,
    temporalScope: "closed_day",
    value: round(latest?.value ?? null),
    dataDate,
    targetDate,
    freshness: dataDate === null ? "unavailable" : (lagDays ?? 99) <= 1 ? "ok" : "stale",
    lagDays,
    avg7d: average(recent),
    change7d: dataDate ? change(eligible, dataDate, 7) : null,
    change30d: dataDate ? change(eligible, dataDate, 30) : null,
    series: eligible.slice(-90).map((point) => ({ ...point, value: round(point.value) ?? point.value })),
    peers: peerValues,
    peerRank: ranking.rank,
    peerTotal: ranking.total,
    trackedRank: null,
    trackedTotal: null,
    percentile: null,
    sourceId: `defillama_${definition.id}`,
    definition: definition.definition,
    caveat: definition.caveat,
  };
}

function buildTvlMetric(data: unknown, targetDate: string): MetricSnapshot {
  const records = Array.isArray(data) ? data.filter(isRecord) : [];
  const peerValues: ChainValue[] = PEERS.map((peer) => {
    const record = records.find((item) => asString(item.name)?.toLowerCase() === peer.defillama.toLowerCase());
    return { id: peer.id, name: peer.name, value: round(asNumber(record?.tvl)), dataDate: record ? targetDate : null };
  });
  const robinhood = peerValues.find((peer) => peer.id === "robinhood")?.value ?? null;
  const ranking = rank(peerValues);
  return {
    id: "defi_tvl",
    label: "DeFi TVL",
    shortLabel: "DeFi TVL",
    unit: "usd",
    temporalScope: "latest_snapshot",
    value: robinhood,
    dataDate: robinhood === null ? null : new Date().toISOString(),
    targetDate,
    freshness: robinhood === null ? "unavailable" : "live",
    lagDays: null,
    avg7d: null,
    change7d: null,
    change30d: null,
    series: [],
    peers: peerValues,
    peerRank: ranking.rank,
    peerTotal: ranking.total,
    trackedRank: null,
    trackedTotal: null,
    percentile: null,
    sourceId: "defillama_chains",
    definition: "DefiLlama 当前链级 DeFi 协议 TVL 快照。",
    caveat: "这是抓取时快照，不是闭合的 T-1 数值；Optimism 等链的适配器覆盖可能显示 0。",
  };
}

export async function collectDefillama(targetDate: string): Promise<{
  metrics: MetricSnapshot[];
  receipts: SourceReceipt[];
  raw: RawBundle;
}> {
  const receipts: SourceReceipt[] = [];
  const raw: RawBundle = {};
  const metrics: MetricSnapshot[] = [];

  for (const definition of DEFINITIONS) {
    const histories = await Promise.all(PEERS.map((peer) => fetchHistory(definition, peer, targetDate)));
    for (const item of histories) {
      receipts.push(item.receipt);
      raw[item.receipt.id] = item.raw;
    }
    metrics.push(buildHistoryMetric(definition, histories, targetDate));
  }

  const chains = await fetchSource("defillama_chains", "DefiLlama · 链级 DeFi TVL", ENDPOINTS.defillamaChains);
  receipts.push(chains.receipt);
  raw[chains.receipt.id] = chains.data;
  metrics.push(buildTvlMetric(chains.data, targetDate));

  return { metrics, receipts, raw };
}
