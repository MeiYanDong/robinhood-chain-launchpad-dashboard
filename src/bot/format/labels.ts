import type { MetricName, MetricQuality, SourceHealth } from "../../domain/types.js";

export const METRIC_LABELS: Record<MetricName, string> = {
  volume_usd: "成交量",
  fees_usd: "用户手续费",
  protocol_revenue_usd: "平台收入",
  revenue_usd: "Revenue",
};

export const QUALITY_LABELS: Record<MetricQuality, string> = {
  reported: "来源直接报告",
  derived: "推导值",
  partial: "部分覆盖",
  scope_mismatch: "口径范围不同",
  suite_wide: "混合多产品，不可比",
  unknown: "未知",
};

export function qualitySummary(qualities: MetricQuality[]): string | null {
  const labels = [...new Set(qualities.map((quality) => QUALITY_LABELS[quality]))];
  return labels.length > 0 ? labels.join("、") : null;
}

export function coverageLabel(observedDays: number, windowDays: number): string {
  return `${String(observedDays)}/${String(windowDays)} 天`;
}

export function sourceHealthLabel(source: SourceHealth): string {
  if (source.status === "ok") return "正常";
  if (source.status === "degraded") return "降级";
  return "失败";
}
