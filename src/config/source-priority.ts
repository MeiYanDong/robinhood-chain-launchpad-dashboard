import type { DailyMetric } from "../domain/types.js";

interface SourcePriorityRule {
  id: string;
  priority: number;
  sourcePrefix: string;
  platformId?: string;
  metrics?: DailyMetric["metric"][];
}

/**
 * Canonical-source arbitration is deliberately centralised here. A new
 * collector must not gain precedence merely because it was appended later to
 * collectAll(). Higher numbers win for the same platform/metric/UTC date.
 */
export const SOURCE_PRIORITY_RULES: SourcePriorityRule[] = [
  {
    id: "letscash-first-party-daily",
    priority: 400,
    sourcePrefix: "letscash.officialTokenomics",
    platformId: "letscash",
    metrics: ["volume_usd", "fees_usd", "protocol_revenue_usd"],
  },
  {
    id: "bankr-first-party-volume",
    priority: 400,
    sourcePrefix: "bankr.officialDashboard",
    platformId: "bankr",
    metrics: ["volume_usd"],
  },
  {
    id: "long-first-party-volume",
    priority: 400,
    sourcePrefix: "long.officialGraphql.",
    platformId: "long",
    metrics: ["volume_usd"],
  },
  {
    id: "defillama-protocol-summary",
    priority: 200,
    sourcePrefix: "defillama.summary.",
  },
  {
    id: "defillama-chain-overview",
    priority: 100,
    sourcePrefix: "defillama.",
  },
];

export function metricSourcePriority(metric: DailyMetric): number {
  let priority = 0;
  for (const rule of SOURCE_PRIORITY_RULES) {
    if (!metric.source.startsWith(rule.sourcePrefix)) continue;
    if (rule.platformId && rule.platformId !== metric.platformId) continue;
    if (rule.metrics && !rule.metrics.includes(metric.metric)) continue;
    priority = Math.max(priority, rule.priority);
  }
  return priority;
}

export function preferredMetric(left: DailyMetric, right: DailyMetric): DailyMetric {
  const leftPriority = metricSourcePriority(left);
  const rightPriority = metricSourcePriority(right);
  if (leftPriority !== rightPriority) return leftPriority > rightPriority ? left : right;

  if (left.collectedAt !== right.collectedAt) {
    return left.collectedAt > right.collectedAt ? left : right;
  }

  // Stable tie-breaker makes the result independent of collector array order.
  return left.source.localeCompare(right.source) <= 0 ? left : right;
}
