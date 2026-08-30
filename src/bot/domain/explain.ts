import type { MetricName, SourceHealth } from "../../domain/types.js";
import type { QueryPlan } from "../intent/query-plan.js";
import type { LedgerCoverageResponse } from "../ledger/contract.js";

const METRIC_NAMES: Record<MetricName, string> = {
  volume_usd: "成交量",
  fees_usd: "用户手续费",
  protocol_revenue_usd: "平台收入",
  revenue_usd: "Revenue",
};

export interface ExplanationResult {
  title: string;
  lines: string[];
  degraded: boolean;
}

export function explainEvidence(
  plan: QueryPlan,
  coverage: LedgerCoverageResponse,
  sources: SourceHealth[],
): ExplanationResult {
  if (plan.explainTopic === "sources") {
    const counts = { ok: 0, degraded: 0, failed: 0 };
    for (const source of sources) counts[source.status] += 1;
    return {
      title: "数据来源状态",
      lines: [
        "正常 " +
          String(counts.ok) +
          " / 降级 " +
          String(counts.degraded) +
          " / 失败 " +
          String(counts.failed),
        "来源状态说明能否取得数据，不等于指标经过审计。",
      ],
      degraded: counts.failed + counts.degraded > 0,
    };
  }
  if (plan.explainTopic === "coverage") {
    return {
      title: "覆盖率是什么意思？",
      lines: [
        "coverage 表示请求窗口里有明确观测的天数，例如 5/7；没有观测不会自动补成 0。",
        "平台详情的 64 日 coverage 只用于历史序列，不能冒充本次 1/7/30 日窗口。",
      ],
      degraded: false,
    };
  }
  if (plan.explainTopic === "quality") {
    return {
      title: "数据质量标签",
      lines: [
        "reported 是来源直接报告；derived 是按公开规则推导；partial 是部分覆盖。",
        "scope_mismatch 表示指标范围不同；suite_wide 混合多产品；unknown 不等于 0。",
      ],
      degraded: false,
    };
  }

  const platform = plan.platformId
    ? coverage.platforms.find((candidate) => candidate.id === plan.platformId)
    : null;
  if (platform) {
    const policy = plan.metric ? platform.metricPolicies[plan.metric] : null;
    const metricName = plan.metric ? METRIC_NAMES[plan.metric] : "数据";
    const lines = [`范围：${platform.scope}`, ...platform.notes];
    if (policy) {
      lines.unshift(`${metricName}：${policy.scope}（${policy.quality}）`);
      if (policy.note) lines.push(policy.note);
    } else if (plan.metric) {
      lines.unshift(`${metricName}：当前来源未提供可复核的该指标，未知不等于 $0。`);
    }
    if (platform.excludeFromTotals) lines.push("该口径不进入 Launchpad 可比榜。 ");
    return {
      title: `为什么 ${platform.name} 的数据这样显示？`,
      lines,
      degraded: !policy || platform.comparability !== "comparable",
    };
  }

  if (plan.metric) {
    return {
      title: `${METRIC_NAMES[plan.metric]}口径`,
      lines: [coverage.definitions[plan.metric]],
      degraded: false,
    };
  }
  return {
    title: "暂时没有可解释的证据主题",
    lines: ["请指定指标、平台、quality、coverage 或 sources。"],
    degraded: true,
  };
}
