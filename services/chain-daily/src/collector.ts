import { randomBytes } from "node:crypto";
import { buildAssessment } from "./assessment.js";
import { CHAIN, ENDPOINTS, GROWTHEPIE_METRICS } from "./config.js";
import { collectDefillama } from "./defillama.js";
import { buildGrowthepieMetrics, latestRobinhoodDataDate } from "./growthepie.js";
import { collectRobinhoodOfficial } from "./robinhood-official.js";
import type { DashboardSnapshot, Insight, MetricSnapshot, PillarState, QualitySummary, RawBundle, SourceReceipt } from "./types.js";
import { atomicWriteGzipJson, atomicWriteJson, fetchSource, isIsoDate, round } from "./utils.js";

function runId(now: Date): string {
  return `${now.toISOString().replace(/[-:.]/g, "").replace("T", "T").slice(0, 15)}Z-${randomBytes(3).toString("hex")}`;
}

function formatCompact(value: number | null, unit: MetricSnapshot["unit"]): string {
  if (value === null) return "UNKNOWN";
  if (unit === "percent") return `${(value * 100).toFixed(1)}%`;
  const absolute = Math.abs(value);
  const prefix = unit === "usd" ? "$" : "";
  if (absolute >= 1_000_000_000) return `${prefix}${(value / 1_000_000_000).toFixed(2)}B`;
  if (absolute >= 1_000_000) return `${prefix}${(value / 1_000_000).toFixed(2)}M`;
  if (absolute >= 1_000) return `${prefix}${(value / 1_000).toFixed(2)}K`;
  return `${prefix}${value.toLocaleString("en-US", { maximumFractionDigits: absolute < 1 ? 4 : 1 })}`;
}

function pillarState(
  id: PillarState["id"],
  label: string,
  metrics: MetricSnapshot[],
  metricIds: string[],
): PillarState {
  const eligible = metrics.filter((metric) => metricIds.includes(metric.id) && metric.freshness !== "unavailable");
  const median = (field: "change7d" | "change30d"): number | null => {
    const changes = eligible
      .map((metric) => metric[field])
      .filter((value): value is number => value !== null)
      .sort((a, b) => a - b);
    if (changes.length === 0) return null;
    const middle = Math.floor(changes.length / 2);
    return changes.length % 2 === 0
      ? ((changes[middle - 1] ?? 0) + (changes[middle] ?? 0)) / 2
      : (changes[middle] ?? 0);
  };
  const seven = median("change7d");
  const thirty = median("change30d");
  if (seven === null && thirty === null) return { id, label, state: "unknown", evidence: "可比的 7 日与 30 日变化不足" };
  const signal = (value: number | null): "up" | "flat" | "down" | "unknown" => {
    if (value === null) return "unknown";
    if (value > 0.05) return "up";
    if (value < -0.05) return "down";
    return "flat";
  };
  const sevenSignal = signal(seven);
  const thirtySignal = signal(thirty);
  let state: PillarState["state"] = "stable";
  if (sevenSignal === "unknown") state = thirtySignal === "up" ? "accelerating" : thirtySignal === "down" ? "softening" : "stable";
  else if (thirtySignal === "unknown") state = sevenSignal === "up" ? "accelerating" : sevenSignal === "down" ? "softening" : "stable";
  else if (sevenSignal === thirtySignal) state = sevenSignal === "up" ? "accelerating" : sevenSignal === "down" ? "softening" : "stable";
  else if (sevenSignal === "flat" && thirtySignal === "up") state = "accelerating";
  else if (sevenSignal === "flat" && thirtySignal === "down") state = "softening";
  else state = "mixed";
  const format = (value: number | null): string => value === null ? "—" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
  return { id, label, state, evidence: `核心指标中位数：7D ${format(seven)} · 30D ${format(thirty)}` };
}

function buildPillars(metrics: MetricSnapshot[]): PillarState[] {
  return [
    pillarState("usage", "使用", metrics, ["transactions", "active_addresses", "throughput"]),
    pillarState("capital", "资本", metrics, ["stablecoin_supply", "tvs"]),
    pillarState("economics", "经济", metrics, ["chain_fees", "onchain_profit", "app_revenue"]),
    pillarState("market", "市场", metrics, ["dex_volume", "protocol_fees", "protocol_revenue"]),
  ];
}

function buildInsights(metrics: MetricSnapshot[], failedSources: number, stockCoverage: number | null): Insight[] {
  const insights: Insight[] = [];
  const directional = metrics.filter(
    (metric) => metric.change7d !== null && !["median_tx_cost", "l1_costs"].includes(metric.id),
  );
  const best = [...directional].sort((a, b) => (b.change7d ?? -Infinity) - (a.change7d ?? -Infinity))[0];
  const weakest = [...directional].sort((a, b) => (a.change7d ?? Infinity) - (b.change7d ?? Infinity))[0];
  if (best && (best.change7d ?? 0) > 0.05) {
    insights.push({
      severity: "positive",
      title: `${best.shortLabel}是本期最强增长项`,
      detail: `较 7 日前变化 ${((best.change7d ?? 0) * 100).toFixed(1)}%，当前 ${formatCompact(best.value, best.unit)}。`,
      metricId: best.id,
    });
  }
  if (weakest && (weakest.change7d ?? 0) < -0.05) {
    insights.push({
      severity: "watch",
      title: `${weakest.shortLabel}出现回落`,
      detail: `较 7 日前变化 ${((weakest.change7d ?? 0) * 100).toFixed(1)}%，需要结合后续完整日确认。`,
      metricId: weakest.id,
    });
  }

  const fees = metrics.find((metric) => metric.id === "chain_fees");
  const profit = metrics.find((metric) => metric.id === "onchain_profit");
  if (fees?.value && profit && profit.value !== null && fees.dataDate === profit.dataDate) {
    const margin = profit.value / fees.value;
    insights.push({
      severity: margin >= 0.8 ? "positive" : "watch",
      title: `链上利润率约 ${(margin * 100).toFixed(1)}%`,
      detail: `按同日链手续费 ${formatCompact(fees.value, fees.unit)} 与链上利润 ${formatCompact(profit.value, profit.unit)} 计算。`,
      metricId: "onchain_profit",
    });
  }
  if (stockCoverage !== null && stockCoverage < 95) {
    insights.push({
      severity: "quality",
      title: "股票代币估值覆盖不足",
      detail: `当前只有 ${stockCoverage.toFixed(1)}% 的活跃资产同时取得报价和 totalSupply。`,
      metricId: null,
    });
  }
  if (failedSources > 0) {
    insights.push({
      severity: "quality",
      title: `${failedSources} 个来源抓取或解析失败`,
      detail: "失败来源对应指标保持 UNKNOWN；请在证据回执区查看具体原因。",
      metricId: null,
    });
  }
  return insights.slice(0, 5);
}

async function persistRaw(bundle: RawBundle, id: string): Promise<void> {
  await Promise.all(
    Object.entries(bundle).map(([sourceId, data]) => atomicWriteGzipJson(`data/raw/${id}/${sourceId}.json.gz`, data)),
  );
}

export async function collect(targetDate: string, now = new Date()): Promise<DashboardSnapshot> {
  if (!isIsoDate(targetDate)) throw new Error(`Invalid --date: ${targetDate}`);
  const id = runId(now);

  const [master, fundamentals, llama, official] = await Promise.all([
    fetchSource("growthepie_master", "Growthepie · 链与指标元数据", ENDPOINTS.growthepieMaster),
    fetchSource("growthepie_fundamentals", "Growthepie · 全链基本面日表", ENDPOINTS.growthepieFundamentals),
    collectDefillama(targetDate),
    collectRobinhoodOfficial(),
  ]);

  const growthepieMetrics = buildGrowthepieMetrics(fundamentals.data, master.data, targetDate);
  fundamentals.receipt.dataDate = latestRobinhoodDataDate(fundamentals.data, targetDate);
  if (growthepieMetrics.every((metric) => metric.value === null) && fundamentals.receipt.ok) {
    fundamentals.receipt.ok = false;
    fundamentals.receipt.error = "No parseable Robinhood fundamentals for target date";
  }

  const metrics = [...growthepieMetrics, ...llama.metrics];
  const receipts: SourceReceipt[] = [master.receipt, fundamentals.receipt, ...llama.receipts, ...official.receipts];
  const raw: RawBundle = {
    growthepie_master: master.data,
    growthepie_fundamentals: fundamentals.data,
    ...llama.raw,
    ...official.raw,
  };

  const okMetrics = metrics.filter((metric) => metric.freshness === "ok" || metric.freshness === "live").length;
  const staleMetrics = metrics.filter((metric) => metric.freshness === "stale").length;
  const unavailableMetrics = metrics.filter((metric) => metric.freshness === "unavailable").length;
  const failedSources = receipts.filter((receipt) => !receipt.ok).length;
  const alerts: string[] = [];
  if (staleMetrics > 0) alerts.push(`${staleMetrics} 个指标比目标日延迟至少 2 天`);
  if (unavailableMetrics > 0) alerts.push(`${unavailableMetrics} 个指标为 UNKNOWN`);
  if (failedSources > 0) alerts.push(`${failedSources} 个数据来源失败`);

  const pillars = buildPillars(metrics);
  const quality: QualitySummary = { okMetrics, staleMetrics, unavailableMetrics, failedSources, alerts };
  const assessment = buildAssessment(metrics, quality, pillars, CHAIN.launchDate, targetDate);
  const snapshot: DashboardSnapshot = {
    schemaVersion: 2,
    runId: id,
    generatedAt: now.toISOString(),
    targetDate,
    timezone: "UTC",
    chain: { ...CHAIN },
    verdict: assessment.headline,
    metrics,
    stockTokens: official.stockTokens,
    networkHealth: official.health,
    pillars,
    insights: buildInsights(metrics, failedSources, official.stockTokens.coveragePercent),
    assessment,
    quality,
    sources: receipts,
  };

  await persistRaw(raw, id);
  await atomicWriteJson(`data/snapshots/${targetDate}.json`, snapshot);
  await atomicWriteJson("data/latest.json", snapshot);
  return snapshot;
}

export function metricDefinitionIds(): string[] {
  return GROWTHEPIE_METRICS.map((metric) => metric.id);
}
