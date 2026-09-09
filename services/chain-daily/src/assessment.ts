import type {
  AssessmentDimension,
  AssessmentTone,
  ChainAssessment,
  ConfidenceState,
  MetricAssessment,
  MetricSnapshot,
  MomentumState,
  OverallAssessmentState,
  PillarState,
  PositionState,
  QualityState,
  QualitySummary,
} from "./types.js";
import { dateDiffDays, round } from "./utils.js";

const CORE_METRICS = new Set([
  "transactions",
  "active_addresses",
  "throughput",
  "stablecoin_supply",
  "tvs",
  "defi_tvl",
  "chain_fees",
  "onchain_profit",
  "app_revenue",
  "dex_volume",
  "protocol_fees",
  "protocol_revenue",
]);

const CONTEXT_METRICS = new Set(["l1_costs"]);
const LOWER_IS_BETTER = new Set(["median_tx_cost"]);
const BALANCE_METRICS = new Set(["stablecoin_supply", "tvs"]);
const HIGH_VOLATILITY_METRICS = new Set(["dex_volume", "protocol_fees", "protocol_revenue"]);

type Direction = "up" | "flat" | "down" | "unknown";

function rankPercentile(rank: number | null, total: number | null): number | null {
  if (rank === null || total === null || total < 1 || rank < 1 || rank > total) return null;
  if (total === 1) return 100;
  return round(((total - rank) / (total - 1)) * 100, 1);
}

function positionBand(percentile: number | null): PositionState {
  if (percentile === null) return "unknown";
  if (percentile >= 70) return "leading";
  if (percentile <= 30) return "lagging";
  return "middle";
}

function combinePosition(peer: PositionState, tracked: PositionState): PositionState {
  const available = [peer, tracked].filter((state) => state !== "unknown");
  if (available.length === 0) return "unknown";
  if (available.includes("leading") && available.includes("lagging")) return "split";
  if (available.includes("leading")) return "leading";
  if (available.includes("lagging")) return "lagging";
  return "middle";
}

function thresholds(metricId: string): { seven: number; thirty: number } {
  if (BALANCE_METRICS.has(metricId)) return { seven: 0.03, thirty: 0.08 };
  if (HIGH_VOLATILITY_METRICS.has(metricId)) return { seven: 0.15, thirty: 0.25 };
  return { seven: 0.05, thirty: 0.1 };
}

function direction(value: number | null, threshold: number, invert: boolean): Direction {
  if (value === null) return "unknown";
  const effective = invert ? -value : value;
  if (effective >= threshold) return "up";
  if (effective <= -threshold) return "down";
  return "flat";
}

function momentum(metric: MetricSnapshot): MomentumState {
  if (metric.freshness === "unavailable" || metric.freshness === "stale") return "unknown";
  const scale = thresholds(metric.id);
  const invert = LOWER_IS_BETTER.has(metric.id);
  const seven = direction(metric.change7d, scale.seven, invert);
  const thirty = direction(metric.change30d, scale.thirty, invert);

  if (seven === "unknown" && thirty === "unknown") return "unknown";
  if (seven === "up") {
    if (thirty === "up") return "expanding";
    return "rebounding";
  }
  if (seven === "down") {
    if (thirty === "down") return "softening";
    return "pullback";
  }
  if (seven === "flat") {
    if (thirty === "up") return "expanding";
    if (thirty === "down") return "softening";
    return "stable";
  }
  if (thirty === "up") return "expanding";
  if (thirty === "down") return "softening";
  return "stable";
}

function formatChange(value: number | null): string {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

function positionEvidence(metric: MetricSnapshot, peerPercentile: number | null): string {
  const peer = metric.peerRank !== null && metric.peerTotal !== null
    ? `固定同行 ${metric.peerRank}/${metric.peerTotal}`
    : "固定同行 —";
  const tracked = metric.trackedRank !== null && metric.trackedTotal !== null
    ? `全部 L2 ${metric.trackedRank}/${metric.trackedTotal}（P${metric.percentile ?? "—"}）`
    : "全部 L2 —";
  return `${peer}${peerPercentile === null ? "" : `（P${peerPercentile}）`} · ${tracked}`;
}

function momentumEvidence(metric: MetricSnapshot): string {
  const suffix = LOWER_IS_BETTER.has(metric.id) ? "；该成本指标下降视为改善" : "";
  return `7D ${formatChange(metric.change7d)} · 30D ${formatChange(metric.change30d)}${suffix}`;
}

function classification(
  metric: MetricSnapshot,
  position: PositionState,
  trend: MomentumState,
): { label: string; tone: AssessmentTone } {
  if (CONTEXT_METRICS.has(metric.id)) return { label: "背景项", tone: "neutral" };
  if (metric.freshness === "unavailable" || metric.freshness === "stale") return { label: "UNKNOWN", tone: "unknown" };
  if (trend === "expanding") {
    if (position === "leading") return { label: "强", tone: "positive" };
    if (position === "lagging") return { label: "追赶改善", tone: "positive" };
    return { label: "改善", tone: "positive" };
  }
  if (trend === "softening") {
    if (position === "leading") return { label: "领先转弱", tone: "watch" };
    if (position === "lagging") return { label: "弱", tone: "negative" };
    return { label: "转弱", tone: "negative" };
  }
  if (trend === "rebounding") {
    if (position === "leading") return { label: "领先反弹", tone: "watch" };
    if (position === "lagging") return { label: "追赶反弹", tone: "watch" };
    return { label: "短期反弹", tone: "watch" };
  }
  if (trend === "pullback") {
    if (position === "leading") return { label: "领先转弱", tone: "watch" };
    if (position === "lagging") return { label: "弱势回落", tone: "negative" };
    return { label: "短期转弱", tone: "watch" };
  }
  if (trend === "unknown") {
    if (position === "leading") return { label: "规模领先", tone: "positive" };
    if (position === "lagging") return { label: "规模偏弱", tone: "negative" };
    if (position === "middle") return { label: "中位规模", tone: "neutral" };
    return { label: "UNKNOWN", tone: "unknown" };
  }
  if (position === "leading") return { label: "领先稳定", tone: "positive" };
  if (position === "lagging") return { label: "偏弱", tone: "negative" };
  if (position === "split") return { label: "基准分化", tone: "watch" };
  return { label: "稳定", tone: "neutral" };
}

export function assessMetric(metric: MetricSnapshot): MetricAssessment {
  const peerPercentile = rankPercentile(metric.peerRank, metric.peerTotal);
  const trackedPercentile = metric.percentile;
  const position = combinePosition(positionBand(peerPercentile), positionBand(trackedPercentile));
  const trend = CONTEXT_METRICS.has(metric.id) ? "unknown" : momentum(metric);
  const result = classification(metric, position, trend);
  return {
    metricId: metric.id,
    label: result.label,
    tone: result.tone,
    position,
    momentum: trend,
    peerPercentile,
    trackedPercentile,
    positionEvidence: positionEvidence(metric, peerPercentile),
    momentumEvidence: momentumEvidence(metric),
    summary: `${positionEvidence(metric, peerPercentile)}；${momentumEvidence(metric)}。`,
  };
}

function dimension<State extends string>(
  state: State,
  label: string,
  tone: AssessmentTone,
  evidence: string,
): AssessmentDimension<State> {
  return { state, label, tone, evidence };
}

function aggregatePosition(metrics: MetricSnapshot[], assessments: MetricAssessment[]): AssessmentDimension<PositionState> {
  const coreIds = new Set(metrics.filter((metric) => CORE_METRICS.has(metric.id)).map((metric) => metric.id));
  const core = assessments.filter((item) => coreIds.has(item.metricId) && item.position !== "unknown");
  if (core.length < 4) return dimension("unknown", "UNKNOWN", "unknown", "可比较的核心指标不足 4 项");
  const leading = core.filter((item) => item.position === "leading").length;
  const lagging = core.filter((item) => item.position === "lagging").length;
  const split = core.filter((item) => item.position === "split").length;
  const state: PositionState =
    leading / core.length >= 0.5 && lagging / core.length < 0.25
      ? "leading"
      : lagging / core.length >= 0.5 && leading / core.length < 0.25
        ? "lagging"
        : split > 0 || (leading > 0 && lagging > 0)
          ? "split"
          : "middle";
  const labels: Record<PositionState, string> = {
    leading: "领先",
    middle: "中位",
    lagging: "偏弱",
    split: "分化",
    unknown: "UNKNOWN",
  };
  const tones: Record<PositionState, AssessmentTone> = {
    leading: "positive",
    middle: "neutral",
    lagging: "negative",
    split: "watch",
    unknown: "unknown",
  };
  return dimension(state, labels[state], tones[state], `${leading}/${core.length} 项核心指标位于领先带，${lagging} 项位于偏弱带`);
}

function aggregateMomentum(assessments: MetricAssessment[]): AssessmentDimension<MomentumState | "mixed"> {
  const core = assessments.filter((item) => CORE_METRICS.has(item.metricId) && item.momentum !== "unknown");
  if (core.length < 4) return dimension("unknown", "UNKNOWN", "unknown", "可判断趋势的核心指标不足 4 项");
  const counts = {
    expanding: core.filter((item) => item.momentum === "expanding").length,
    rebounding: core.filter((item) => item.momentum === "rebounding").length,
    softening: core.filter((item) => item.momentum === "softening").length,
    pullback: core.filter((item) => item.momentum === "pullback").length,
    stable: core.filter((item) => item.momentum === "stable").length,
  };
  const positive = counts.expanding + counts.rebounding;
  const negative = counts.softening + counts.pullback;
  let state: MomentumState | "mixed" = "mixed";
  if (counts.expanding / core.length >= 0.5 && negative / core.length < 0.25) state = "expanding";
  else if (counts.softening / core.length >= 0.5 && positive / core.length < 0.25) state = "softening";
  else if (counts.rebounding / core.length >= 1 / 3 && positive > negative) state = "rebounding";
  else if (counts.pullback / core.length >= 1 / 3 && negative > positive) state = "pullback";
  else if (counts.stable / core.length >= 0.6) state = "stable";

  const labels: Record<MomentumState | "mixed", string> = {
    expanding: "持续扩张",
    stable: "稳定",
    softening: "持续放缓",
    rebounding: "短期反弹",
    pullback: "短期转弱",
    mixed: "分化",
    unknown: "UNKNOWN",
  };
  const tones: Record<MomentumState | "mixed", AssessmentTone> = {
    expanding: "positive",
    stable: "neutral",
    softening: "negative",
    rebounding: "watch",
    pullback: "watch",
    mixed: "watch",
    unknown: "unknown",
  };
  const evidence = `持续扩张 ${counts.expanding} · 短期反弹 ${counts.rebounding} · 持续放缓 ${counts.softening} · 短期转弱 ${counts.pullback}`;
  return dimension(state, labels[state], tones[state], evidence);
}

function aggregateQuality(metrics: MetricSnapshot[], pillars: PillarState[]): AssessmentDimension<QualityState> {
  const transactions = metrics.find((metric) => metric.id === "transactions");
  const active = metrics.find((metric) => metric.id === "active_addresses");
  const transactionDirection = transactions ? direction(transactions.change7d, thresholds("transactions").seven, false) : "unknown";
  const activeDirection = active ? direction(active.change7d, thresholds("active_addresses").seven, false) : "unknown";
  const breadthDivergence =
    (transactionDirection === "up" && activeDirection === "down") ||
    (transactionDirection === "down" && activeDirection === "up");
  const accelerating = pillars.filter((pillar) => pillar.state === "accelerating").length;
  const softening = pillars.filter((pillar) => pillar.state === "softening").length;
  const mixed = pillars.filter((pillar) => pillar.state === "mixed").length;

  if (breadthDivergence) {
    return dimension(
      "divergent",
      "增长分化",
      "watch",
      `交易 7D ${formatChange(transactions?.change7d ?? null)}，日活 7D ${formatChange(active?.change7d ?? null)}，规模与用户广度未互相确认`,
    );
  }
  if (accelerating >= 3 && softening === 0 && mixed === 0) {
    return dimension("broad", "广泛改善", "positive", `${accelerating}/4 个维度同步扩张`);
  }
  if (softening >= 3 && accelerating === 0) {
    return dimension("weak", "广泛转弱", "negative", `${softening}/4 个维度同步放缓`);
  }
  if (mixed > 0 || (accelerating > 0 && softening > 0)) {
    return dimension("divergent", "增长分化", "watch", `扩张 ${accelerating} 个维度 · 放缓 ${softening} 个维度 · 短中期分化 ${mixed} 个维度`);
  }
  return dimension("balanced", "相对均衡", "neutral", `扩张 ${accelerating} 个维度 · 放缓 ${softening} 个维度`);
}

function aggregateConfidence(
  metrics: MetricSnapshot[],
  quality: QualitySummary,
): AssessmentDimension<ConfidenceState> {
  const core = metrics.filter((metric) => CORE_METRICS.has(metric.id));
  const usable = core.filter((metric) => metric.value !== null && metric.freshness !== "unavailable" && metric.freshness !== "stale").length;
  const coverage = core.length === 0 ? 0 : usable / core.length;
  const state: ConfidenceState =
    quality.failedSources === 0 && quality.unavailableMetrics === 0 && quality.staleMetrics <= 1 && coverage >= 0.9
      ? "high"
      : quality.failedSources <= 2 && quality.unavailableMetrics <= 3 && quality.staleMetrics <= 3 && coverage >= 0.6
        ? "medium"
        : "low";
  const label = state === "high" ? "高" : state === "medium" ? "中" : "低";
  const tone: AssessmentTone = state === "high" ? "positive" : state === "medium" ? "watch" : "negative";
  return dimension(
    state,
    label,
    tone,
    `核心指标覆盖 ${(coverage * 100).toFixed(0)}% · ${quality.staleMetrics} 延迟 · ${quality.unavailableMetrics} UNKNOWN · ${quality.failedSources} 来源失败`,
  );
}

function headline(
  position: PositionState,
  momentum: MomentumState | "mixed",
  quality: QualityState,
  confidence: ConfidenceState,
): { state: OverallAssessmentState; text: string } {
  if (confidence === "low") return { state: "unknown", text: "数据可信度不足，今天不判断基本面好坏。" };
  if (position === "leading") {
    if (momentum === "expanding" && quality === "broad") {
      return { state: "strong", text: "规模与趋势同步占优，增长得到多个维度确认。" };
    }
    if (momentum === "softening" || momentum === "pullback") {
      return { state: "leading_softening", text: "规模仍处领先梯队，但短中期趋势正在转弱。" };
    }
    return {
      state: "leading_mixed",
      text: momentum === "rebounding"
        ? "规模处于领先梯队，短期反弹尚未确认成中期扩张，增长质量仍有分化。"
        : "规模处于领先梯队，但短中期趋势与增长质量尚未形成一致结论。",
    };
  }
  if (position === "lagging") {
    if (momentum === "expanding" || momentum === "rebounding") {
      return { state: "improving", text: "当前规模仍偏弱，但趋势正在改善，处于追赶阶段。" };
    }
    if (momentum === "softening" || momentum === "pullback") {
      return { state: "weak", text: "规模与趋势同时偏弱，需要等待基本面修复。" };
    }
    return { state: "weak", text: "当前规模偏弱，尚未出现持续改善证据。" };
  }
  if (momentum === "expanding") return { state: "improving", text: "规模位于中间区间，但多个基本面指标正在改善。" };
  if (momentum === "softening") return { state: "weak", text: "规模位于中间区间，近期基本面正在放缓。" };
  return { state: "middle", text: "规模位于中间区间，短中期信号仍以结构性分化为主。" };
}

export function buildAssessment(
  metrics: MetricSnapshot[],
  quality: QualitySummary,
  pillars: PillarState[],
  launchDate: string,
  targetDate: string,
): ChainAssessment {
  const metricAssessments = metrics.map(assessMetric);
  const position = aggregatePosition(metrics, metricAssessments);
  const momentumSummary = aggregateMomentum(metricAssessments);
  const qualitySummary = aggregateQuality(metrics, pillars);
  const confidence = aggregateConfidence(metrics, quality);
  const overall = headline(position.state, momentumSummary.state, qualitySummary.state, confidence.state);
  const caveats = ["该模型判断生态基本面，不是资产估值、买卖或投资信号。"];
  if (dateDiffDays(targetDate, launchDate) < 90) caveats.push("主网上线不足 90 天，90 日结构性基准暂为 UNKNOWN。");
  caveats.push("固定同行排名、全部 L2 分位和自身趋势口径分开展示，不合成单一总分。");
  return {
    modelVersion: "benchmark-v1",
    decisionQuestion: "ecosystem_fundamentals",
    overallState: overall.state,
    headline: overall.text,
    position,
    momentum: momentumSummary,
    quality: qualitySummary,
    confidence,
    metrics: metricAssessments,
    caveats,
  };
}
