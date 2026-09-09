import type { DashboardSnapshot, MetricSnapshot } from "./types.js";
import { atomicWriteText, readJson } from "./utils.js";

function value(metric: MetricSnapshot | undefined): string {
  if (!metric || metric.value === null) return "UNKNOWN";
  if (metric.unit === "percent") return `${(metric.value * 100).toFixed(1)}%`;
  const prefix = metric.unit === "usd" ? "$" : "";
  const absolute = Math.abs(metric.value);
  if (absolute >= 1e9) return `${prefix}${(metric.value / 1e9).toFixed(2)}B`;
  if (absolute >= 1e6) return `${prefix}${(metric.value / 1e6).toFixed(2)}M`;
  if (absolute >= 1e3) return `${prefix}${(metric.value / 1e3).toFixed(2)}K`;
  return `${prefix}${metric.value.toLocaleString("en-US", { maximumFractionDigits: absolute < 1 ? 4 : 1 })}`;
}

function change(metric: MetricSnapshot, field: "change7d" | "change30d"): string {
  const value = metric[field];
  return value === null ? "—" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

function freshness(metric: MetricSnapshot): string {
  if (metric.freshness === "live") return "实时快照";
  if (metric.freshness === "unavailable") return "不可用";
  return `${metric.dataDate ?? "—"}${metric.freshness === "stale" ? `（延迟 ${metric.lagDays} 天）` : ""}`;
}

export function renderReport(snapshot: DashboardSnapshot): string {
  const byId = new Map(snapshot.metrics.map((metric) => [metric.id, metric]));
  const assessmentById = new Map((snapshot.assessment?.metrics ?? []).map((item) => [item.metricId, item]));
  const headlineIds = [
    "transactions",
    "active_addresses",
    "stablecoin_supply",
    "tvs",
    "chain_fees",
    "onchain_profit",
    "app_revenue",
    "dex_volume",
    "defi_tvl",
  ];
  const rows = headlineIds.map((id) => byId.get(id)).filter((metric): metric is MetricSnapshot => metric !== undefined);
  const peerMetrics = ["transactions", "active_addresses", "chain_fees", "onchain_profit", "dex_volume"]
    .map((id) => byId.get(id))
    .filter((metric): metric is MetricSnapshot => metric !== undefined);

  const lines = [
    `# Robinhood Chain 日度雷达｜${snapshot.targetDate} UTC`,
    "",
    `> ${snapshot.verdict}`,
    "",
    `生成时间：${snapshot.generatedAt}  `,
    `数据质量：${snapshot.quality.okMetrics} 正常 / ${snapshot.quality.staleMetrics} 延迟 / ${snapshot.quality.unavailableMetrics} UNKNOWN / ${snapshot.quality.failedSources} 来源失败`,
    "",
    "## 基准判读",
    "",
    ...(snapshot.assessment
      ? [
          `- **市场位置 · ${snapshot.assessment.position.label}**：${snapshot.assessment.position.evidence}`,
          `- **自身趋势 · ${snapshot.assessment.momentum.label}**：${snapshot.assessment.momentum.evidence}`,
          `- **增长质量 · ${snapshot.assessment.quality.label}**：${snapshot.assessment.quality.evidence}`,
          `- **数据可信度 · ${snapshot.assessment.confidence.label}**：${snapshot.assessment.confidence.evidence}`,
          "",
          ...snapshot.assessment.caveats.map((caveat) => `> ${caveat}`),
        ]
      : ["- 该历史快照生成于 benchmark-v1 上线前，暂无结构化基准判读。"]),
    "",
    "## 四个维度",
    "",
    ...snapshot.pillars.map((pillar) => `- **${pillar.label} · ${pillar.state}**：${pillar.evidence}`),
    "",
    "## 核心指标",
    "",
    "| 指标 | 基准判断 | 数值 | 7 日变化 | 30 日变化 | 数据日 / 新鲜度 | 固定同屏排名 | 全部 L2 分位 |",
    "|---|---|---:|---:|---:|---|---:|---:|",
    ...rows.map(
      (metric) => {
        const assessment = assessmentById.get(metric.id);
        return `| ${metric.label} | ${assessment?.label ?? "—"} | ${value(metric)} | ${change(metric, "change7d")} | ${change(metric, "change30d")} | ${freshness(metric)} | ${metric.peerRank && metric.peerTotal ? `${metric.peerRank}/${metric.peerTotal}` : "—"} | ${metric.percentile === null ? "—" : `P${metric.percentile}`} |`;
      },
    ),
    "",
    "## 股票代币快照",
    "",
    `- 活跃资产：${snapshot.stockTokens.activeAssets ?? "UNKNOWN"}`,
    `- 估算代币化价值：${snapshot.stockTokens.estimatedValueUsd === null ? "UNKNOWN" : `$${snapshot.stockTokens.estimatedValueUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}`,
    `- 估值覆盖：${snapshot.stockTokens.coveragePercent === null ? "UNKNOWN" : `${snapshot.stockTokens.coveragePercent.toFixed(1)}%`}（${snapshot.stockTokens.valuedAssets ?? "?"}/${snapshot.stockTokens.activeAssets ?? "?"}）`,
    `- 口径：${snapshot.stockTokens.method}`,
    "",
    "## 今日观察",
    "",
    ...(snapshot.insights.length > 0
      ? snapshot.insights.map((insight) => `- **${insight.title}**：${insight.detail}`)
      : ["- 暂无足够的可比趋势信号。"]),
    "",
    "## 固定同屏对比",
    "",
    "排名只使用 Robinhood 实际数据日的同日数值；空值不参与排名。",
    "",
    ...peerMetrics.flatMap((metric) => [
      `### ${metric.label}｜${metric.dataDate ?? "UNKNOWN"}`,
      "",
      "| 链 | 数值 |",
      "|---|---:|",
      ...metric.peers.map((peer) => `| ${peer.name} | ${peer.value === null ? "UNKNOWN" : value({ ...metric, value: peer.value })} |`),
      "",
    ]),
    "## 数据质量与证据",
    "",
    ...(snapshot.quality.alerts.length > 0 ? snapshot.quality.alerts.map((alert) => `- ${alert}`) : ["- 未发现阻塞性质量告警。"]),
    "",
    "| 来源 | 状态 | 数据日 | 抓取时间 | 链接 |",
    "|---|---|---|---|---|",
    ...snapshot.sources.map(
      (source) =>
        `| ${source.label} | ${source.ok ? "OK" : `FAILED: ${source.error ?? "unknown"}`} | ${source.dataDate ?? "—"} | ${source.fetchedAt} | [原始来源](${source.url}) |`,
    ),
    "",
    "---",
    "",
    "说明：TVS 与 DeFi TVL 是不同口径；所有 UNKNOWN 都表示无法验证，不等于 0。股票代币估值是最新报价快照，不是 T-1 审计净值。",
    "",
  ];
  return lines.join("\n");
}

export async function writeReport(snapshot: DashboardSnapshot): Promise<string> {
  const content = renderReport(snapshot);
  await atomicWriteText(`reports/${snapshot.targetDate}.md`, content);
  await atomicWriteText("reports/latest.md", content);
  return content;
}

export async function generateReport(date?: string): Promise<{ snapshot: DashboardSnapshot; content: string }> {
  const path = date ? `data/snapshots/${date}.json` : "data/latest.json";
  const snapshot = await readJson<DashboardSnapshot>(path);
  return { snapshot, content: await writeReport(snapshot) };
}
