import type { DailyMetric } from "../domain/types.js";
import type {
  BuybackPolicy,
  EvidenceQuality,
  EvidenceValue,
  PairRelativeValuation,
  PairRelativeValuationConfidence,
  PairRelativeValuationHistoryPoint,
  PairRelativeValuationReason,
  PairRelativeValuationReasonCode,
  TokenEconomicsRow,
} from "./types.js";

export const PAIR_RELATIVE_VALUATION_MODEL_VERSION = "pons-latest-day-volume-parity-v2" as const;
export const PAIR_RELATIVE_VALUATION_MAX_DAYS = 7;
export const PAIR_RELATIVE_VALUATION_MIN_DAYS = 1 as const;
export const PAIR_RELATIVE_VALUATION_PRICE_FRESHNESS_MINUTES = 30;

const FORMULA =
  "PONS price × (PONS effective supply ÷ PAIR effective supply) × (PAIR latest closed-day volume ÷ PONS latest closed-day volume)";

interface BuildPairRelativeValuationInput {
  now: Date;
  observedAt: string;
  metrics: DailyMetric[];
  ponsToken: TokenEconomicsRow | null;
  pairToken: TokenEconomicsRow | null;
  ponsPolicy: BuybackPolicy;
  pairPolicy: BuybackPolicy;
  priceFreshnessMinutes?: number;
}

function unknownValue(note: string): EvidenceValue {
  return {
    value: null,
    state: "unknown",
    quality: "unknown",
    source: null,
    asOf: null,
    note,
  };
}

function derivedValue(input: {
  value: number;
  quality: EvidenceQuality;
  source: string;
  asOf: string;
  note: string;
}): EvidenceValue {
  return { ...input, state: "derived" };
}

function copyEvidence(value: EvidenceValue | undefined, note: string): EvidenceValue {
  return value ? { ...value } : unknownValue(note);
}

function finiteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function earlierAsOf(left: string | null, right: string | null): string | null {
  if (!left || !right) return left ?? right;
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (!Number.isFinite(leftTime)) return right;
  if (!Number.isFinite(rightTime)) return left;
  return leftTime <= rightTime ? left : right;
}

function latestAsOf(metrics: DailyMetric[]): string {
  return metrics.reduce(
    (latest, metric) => (metric.collectedAt > latest ? metric.collectedAt : latest),
    metrics[0]?.collectedAt ?? "",
  );
}

function effectiveSupply(token: TokenEconomicsRow | null, symbol: string): EvidenceValue {
  const total = token?.totalSupply;
  const burned = token?.burnedSupply;
  if (
    !total ||
    !burned ||
    !finiteNumber(total.value) ||
    !finiteNumber(burned.value) ||
    total.value <= 0 ||
    burned.value < 0 ||
    burned.value > total.value
  ) {
    return unknownValue(`${symbol} 缺少有效的链上总供应量或累计销毁量。`);
  }
  const result = total.value - burned.value;
  if (!(result > 0)) return unknownValue(`${symbol} 有效供应量必须大于 0。`);
  const sources = [total.source, burned.source].filter((source): source is string =>
    Boolean(source),
  );
  return derivedValue({
    value: result,
    quality:
      total.quality === "onchain" && burned.quality === "onchain" ? "onchain" : "third_party",
    source: [...new Set(sources)].join("+") || "unknown",
    asOf: earlierAsOf(total.asOf, burned.asOf) ?? "",
    note: `${symbol} totalSupply − 销毁地址累计余额。`,
  });
}

function isComparableVolume(metric: DailyMetric): boolean {
  return (
    metric.metric === "volume_usd" &&
    Number.isFinite(metric.value) &&
    metric.value >= 0 &&
    !["unknown", "scope_mismatch", "suite_wide"].includes(metric.quality)
  );
}

function newestMetricByDate(metrics: DailyMetric[], platformId: "pons" | "pair") {
  const byDate = new Map<string, DailyMetric>();
  for (const metric of metrics) {
    if (metric.platformId !== platformId || !isComparableVolume(metric)) continue;
    const current = byDate.get(metric.date);
    if (!current || metric.collectedAt > current.collectedAt) byDate.set(metric.date, metric);
  }
  return byDate;
}

function metricEvidenceQuality(metrics: DailyMetric[]): EvidenceQuality {
  const official = metrics.every((metric) =>
    ["pons.officialAnalytics", "pair.officialStats"].some((prefix) =>
      metric.source.startsWith(prefix),
    ),
  );
  return official ? "official" : "third_party";
}

function volumeInput(metrics: DailyMetric[], label: string, note: string): EvidenceValue {
  if (metrics.length === 0) return unknownValue(`${label} 没有共同闭合 UTC 日成交量。`);
  const sources = [...new Set(metrics.map((metric) => metric.source))];
  return derivedValue({
    value: metrics.reduce((sum, metric) => sum + metric.value, 0),
    quality: metricEvidenceQuality(metrics),
    source: sources.join("+"),
    asOf: latestAsOf(metrics),
    note,
  });
}

function isFresh(value: EvidenceValue, now: Date, freshnessMinutes: number): boolean {
  if (!finiteNumber(value.value) || value.value <= 0 || !value.asOf) return false;
  const observedAt = Date.parse(value.asOf);
  if (!Number.isFinite(observedAt)) return false;
  const ageMs = now.valueOf() - observedAt;
  return ageMs >= -5 * 60_000 && ageMs <= freshnessMinutes * 60_000;
}

function quantile(values: number[], probability: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const lower = sorted[lowerIndex] ?? sorted[0] ?? Number.NaN;
  const upper = sorted[upperIndex] ?? sorted.at(-1) ?? Number.NaN;
  return lower + (upper - lower) * (index - lowerIndex);
}

function reason(
  code: PairRelativeValuationReasonCode,
  severity: PairRelativeValuationReason["severity"],
  message: string,
): PairRelativeValuationReason {
  return { code, severity, message };
}

function confidence(input: {
  selectedMetrics: DailyMetric[];
  comparisonDayCount: number;
  totalCommonDayCount: number;
  ponsPriceQuality: EvidenceQuality;
}): PairRelativeValuationConfidence {
  if (
    input.comparisonDayCount < PAIR_RELATIVE_VALUATION_MAX_DAYS ||
    input.totalCommonDayCount < 14 ||
    input.selectedMetrics.some((metric) => metric.quality === "partial")
  ) {
    return "low";
  }
  if (
    ["official", "onchain"].includes(input.ponsPriceQuality) &&
    metricEvidenceQuality(input.selectedMetrics) === "official"
  ) {
    return "medium";
  }
  return "low";
}

export function buildPairRelativeValuation(
  input: BuildPairRelativeValuationInput,
): PairRelativeValuation {
  const freshnessMinutes =
    input.priceFreshnessMinutes ?? PAIR_RELATIVE_VALUATION_PRICE_FRESHNESS_MINUTES;
  const ponsPrice = copyEvidence(input.ponsToken?.priceUsd, "PONS 当前价格不可用。");
  const pairPrice = copyEvidence(input.pairToken?.priceUsd, "PAIR 当前价格不可用。");
  const ponsSupply = effectiveSupply(input.ponsToken, "PONS");
  const pairSupply = effectiveSupply(input.pairToken, "PAIR");
  const ponsByDate = newestMetricByDate(input.metrics, "pons");
  const pairByDate = newestMetricByDate(input.metrics, "pair");
  const allCommonDates = [...ponsByDate.keys()]
    .filter((date) => {
      const pons = ponsByDate.get(date);
      return pons !== undefined && pons.value > 0 && pairByDate.has(date);
    })
    .sort();
  const comparisonDates = allCommonDates.slice(-PAIR_RELATIVE_VALUATION_MAX_DAYS);
  const latestCommonDate = comparisonDates.at(-1) ?? null;
  const commonDates = latestCommonDate ? [latestCommonDate] : [];
  const ponsMetrics = comparisonDates
    .map((date) => ponsByDate.get(date))
    .filter((metric): metric is DailyMetric => metric !== undefined);
  const pairMetrics = comparisonDates
    .map((date) => pairByDate.get(date))
    .filter((metric): metric is DailyMetric => metric !== undefined);
  const latestPonsMetric = latestCommonDate ? ponsByDate.get(latestCommonDate) : undefined;
  const latestPairMetric = latestCommonDate ? pairByDate.get(latestCommonDate) : undefined;
  const ponsVolume = volumeInput(
    latestPonsMetric ? [latestPonsMetric] : [],
    "Pons",
    latestCommonDate
      ? `${latestCommonDate} 完整 UTC 日成交量；缺失日未补 0。`
      : "最新共同完整 UTC 日成交量不可用。",
  );
  const pairVolume = volumeInput(
    latestPairMetric ? [latestPairMetric] : [],
    "PAIR",
    latestCommonDate
      ? `${latestCommonDate} 完整 UTC 日成交量；缺失日未补 0。`
      : "最新共同完整 UTC 日成交量不可用。",
  );
  const ponsSevenDayVolume = volumeInput(
    ponsMetrics,
    "Pons",
    `最近 ${ponsMetrics.length} 个共同完整 UTC 日求和；仅用于 7 日平滑对照。`,
  );
  const pairSevenDayVolume = volumeInput(
    pairMetrics,
    "PAIR",
    `最近 ${pairMetrics.length} 个共同完整 UTC 日求和；仅用于 7 日平滑对照。`,
  );
  const reasons: PairRelativeValuationReason[] = [];

  if (commonDates.length < PAIR_RELATIVE_VALUATION_MIN_DAYS) {
    reasons.push(
      reason(
        "INSUFFICIENT_COMMON_DAYS",
        "blocking",
        `最新共同完整 UTC 日不可用，至少需要 ${PAIR_RELATIVE_VALUATION_MIN_DAYS} 天。`,
      ),
    );
  }
  if (!finiteNumber(ponsPrice.value) || ponsPrice.value <= 0) {
    reasons.push(reason("PONS_PRICE_MISSING", "blocking", "PONS 当前价格不可用。"));
  } else if (!isFresh(ponsPrice, input.now, freshnessMinutes)) {
    reasons.push(
      reason("PONS_PRICE_STALE", "blocking", `PONS 价格已超过 ${freshnessMinutes} 分钟。`),
    );
  }
  if (!finiteNumber(ponsSupply.value) || ponsSupply.value <= 0) {
    reasons.push(reason("PONS_EFFECTIVE_SUPPLY_MISSING", "blocking", "PONS 有效供应量不可用。"));
  }
  if (!finiteNumber(pairSupply.value) || pairSupply.value <= 0) {
    reasons.push(reason("PAIR_EFFECTIVE_SUPPLY_MISSING", "blocking", "PAIR 有效供应量不可用。"));
  }
  if (finiteNumber(ponsVolume.value) && ponsVolume.value <= 0) {
    reasons.push(reason("PONS_VOLUME_ZERO", "blocking", "Pons 窗口成交量必须大于 0。"));
  }

  const pairPriceIsFresh = isFresh(pairPrice, input.now, freshnessMinutes);
  if (!finiteNumber(pairPrice.value) || pairPrice.value <= 0) {
    reasons.push(reason("PAIR_PRICE_MISSING", "note", "PAIR 实际价格不可用，偏离值不计算。"));
  } else if (!pairPriceIsFresh) {
    reasons.push(reason("PAIR_PRICE_STALE", "note", "PAIR 实际价格已过期，偏离值不计算。"));
  }
  if (allCommonDates.length < 14) {
    reasons.push(reason("SHORT_SHARED_HISTORY", "note", "Pons 与 PAIR 的共同历史不足 14 天。"));
  }
  const selectedMetrics = [...ponsMetrics, ...pairMetrics];
  if (selectedMetrics.some((metric) => metric.quality === "partial")) {
    reasons.push(reason("PARTIAL_VOLUME_INPUT", "note", "成交量窗口包含部分覆盖数据。"));
  }
  if (ponsPrice.quality === "third_party") {
    reasons.push(reason("THIRD_PARTY_BENCHMARK_PRICE", "note", "PONS 基准价格来自第三方市场源。"));
  }
  reasons.push(
    reason(
      "LATEST_DAY_VOLUME_REACTIVE",
      "note",
      "主参考价使用最新完整 UTC 日成交量，能更快反映降温，也会比 7 日平滑值波动更大。",
    ),
  );

  const blocking = reasons.some((candidate) => candidate.severity === "blocking");
  let estimateUsd: number | null = null;
  let sevenDayEstimateUsd: number | null = null;
  let latestVsSevenDayPercent: number | null = null;
  let rangeLowUsd: number | null = null;
  let rangeHighUsd: number | null = null;
  if (
    !blocking &&
    finiteNumber(ponsPrice.value) &&
    finiteNumber(ponsSupply.value) &&
    finiteNumber(pairSupply.value) &&
    finiteNumber(ponsVolume.value) &&
    finiteNumber(pairVolume.value) &&
    ponsVolume.value > 0 &&
    pairSupply.value > 0
  ) {
    const ponsPriceValue = ponsPrice.value;
    const supplyRatio = ponsSupply.value / pairSupply.value;
    const calculated = ponsPriceValue * supplyRatio * (pairVolume.value / ponsVolume.value);
    const dailyEstimates = comparisonDates.map((date) => {
      const pons = ponsByDate.get(date);
      const pair = pairByDate.get(date);
      return pons && pair ? ponsPriceValue * supplyRatio * (pair.value / pons.value) : Number.NaN;
    });
    if (Number.isFinite(calculated) && dailyEstimates.every(Number.isFinite)) {
      estimateUsd = calculated;
      rangeLowUsd = quantile(dailyEstimates, 0.25);
      rangeHighUsd = quantile(dailyEstimates, 0.75);
      if (
        finiteNumber(ponsSevenDayVolume.value) &&
        ponsSevenDayVolume.value > 0 &&
        finiteNumber(pairSevenDayVolume.value)
      ) {
        const smoothed =
          ponsPriceValue * supplyRatio * (pairSevenDayVolume.value / ponsSevenDayVolume.value);
        if (Number.isFinite(smoothed)) {
          sevenDayEstimateUsd = smoothed;
          latestVsSevenDayPercent = smoothed > 0 ? (calculated / smoothed - 1) * 100 : null;
        }
      }
    } else {
      reasons.push(reason("CALCULATION_INVALID", "blocking", "相对估值计算结果无效。"));
    }
  }

  if (estimateUsd === 0) {
    reasons.push(
      reason("PAIR_ESTIMATE_ZERO", "note", "窗口内 PAIR 成交量为 0，相对估值结果为 0。"),
    );
  }

  const state = estimateUsd === null ? "unavailable" : "available";
  const actualPriceUsd = pairPriceIsFresh && finiteNumber(pairPrice.value) ? pairPrice.value : null;
  const actualDeviationPercent =
    actualPriceUsd !== null && estimateUsd !== null && estimateUsd > 0
      ? (actualPriceUsd / estimateUsd - 1) * 100
      : null;
  const ponsAllocation = input.ponsPolicy.applies ? input.ponsPolicy.percentage : null;
  const pairAllocation = input.pairPolicy.applies ? input.pairPolicy.percentage : null;
  const policyEstimate =
    estimateUsd !== null &&
    finiteNumber(ponsAllocation) &&
    ponsAllocation > 0 &&
    finiteNumber(pairAllocation) &&
    pairAllocation > 0
      ? estimateUsd * (pairAllocation / ponsAllocation)
      : null;

  return {
    modelVersion: PAIR_RELATIVE_VALUATION_MODEL_VERSION,
    state,
    observedAt: input.observedAt,
    priceFreshnessMinutes: freshnessMinutes,
    windowDefinition: "latest_common_closed_utc_day",
    minimumCommonDays: PAIR_RELATIVE_VALUATION_MIN_DAYS,
    commonDayCount: commonDates.length,
    totalCommonDayCount: allCommonDates.length,
    commonDates,
    platformWindowStart: commonDates[0] ?? null,
    platformWindowEnd: commonDates.at(-1) ?? null,
    comparisonWindowDefinition: "latest_7_common_closed_utc_days",
    comparisonDayCount: comparisonDates.length,
    comparisonDates,
    formula: FORMULA,
    estimateUsd,
    sevenDayEstimateUsd,
    latestVsSevenDayPercent,
    rangeLowUsd,
    rangeHighUsd,
    actualPriceUsd,
    actualDeviationPercent,
    policyScenario: {
      state: policyEstimate === null ? "unavailable" : "available",
      estimateUsd: policyEstimate,
      ponsFeeAllocationPercent: ponsAllocation,
      pairFeeAllocationPercent: pairAllocation,
      assumption: "all_other_factors_equal",
    },
    confidence:
      state === "available"
        ? confidence({
            selectedMetrics,
            comparisonDayCount: comparisonDates.length,
            totalCommonDayCount: allCommonDates.length,
            ponsPriceQuality: ponsPrice.quality,
          })
        : "unavailable",
    inputs: {
      ponsPriceUsd: ponsPrice,
      pairActualPriceUsd: pairPrice,
      ponsEffectiveSupply: ponsSupply,
      pairEffectiveSupply: pairSupply,
      ponsPlatformVolumeUsd: ponsVolume,
      pairPlatformVolumeUsd: pairVolume,
      ponsSevenDayVolumeUsd: ponsSevenDayVolume,
      pairSevenDayVolumeUsd: pairSevenDayVolume,
    },
    reasons,
  };
}

export function invalidateStalePairRelativeValuation(
  valuation: PairRelativeValuation,
): PairRelativeValuation {
  return invalidatePairRelativeValuation(
    valuation,
    reason("ECONOMICS_SNAPSHOT_STALE", "blocking", "经济数据快照已过期。"),
  );
}

function withReason(
  valuation: PairRelativeValuation,
  nextReason: PairRelativeValuationReason,
): PairRelativeValuationReason[] {
  return valuation.reasons.some((item) => item.code === nextReason.code)
    ? valuation.reasons
    : [...valuation.reasons, nextReason];
}

function invalidatePairRelativeValuation(
  valuation: PairRelativeValuation,
  nextReason: PairRelativeValuationReason,
): PairRelativeValuation {
  return {
    ...valuation,
    state: "unavailable",
    estimateUsd: null,
    sevenDayEstimateUsd: null,
    latestVsSevenDayPercent: null,
    rangeLowUsd: null,
    rangeHighUsd: null,
    actualPriceUsd: null,
    actualDeviationPercent: null,
    policyScenario: { ...valuation.policyScenario, state: "unavailable", estimateUsd: null },
    confidence: "unavailable",
    reasons: withReason(valuation, nextReason),
  };
}

export function refreshPairRelativeValuationFreshness(
  valuation: PairRelativeValuation,
  now: Date,
): PairRelativeValuation {
  if (valuation.state === "unavailable") return valuation;
  if (!isFresh(valuation.inputs.ponsPriceUsd, now, valuation.priceFreshnessMinutes)) {
    return invalidatePairRelativeValuation(
      valuation,
      reason(
        "PONS_PRICE_STALE",
        "blocking",
        `PONS 价格已超过 ${valuation.priceFreshnessMinutes} 分钟。`,
      ),
    );
  }
  if (
    valuation.actualPriceUsd !== null &&
    !isFresh(valuation.inputs.pairActualPriceUsd, now, valuation.priceFreshnessMinutes)
  ) {
    return {
      ...valuation,
      actualPriceUsd: null,
      actualDeviationPercent: null,
      reasons: withReason(
        valuation,
        reason("PAIR_PRICE_STALE", "note", "PAIR 实际价格已过期，偏离值不计算。"),
      ),
    };
  }
  return valuation;
}

export function toPairRelativeValuationHistoryPoint(
  valuation: PairRelativeValuation,
): PairRelativeValuationHistoryPoint {
  return {
    modelVersion: valuation.modelVersion,
    observedAt: valuation.observedAt,
    state: valuation.state,
    platformWindowEnd: valuation.platformWindowEnd,
    estimateUsd: valuation.estimateUsd,
    sevenDayEstimateUsd: valuation.sevenDayEstimateUsd,
    rangeLowUsd: valuation.rangeLowUsd,
    rangeHighUsd: valuation.rangeHighUsd,
    actualPriceUsd: valuation.actualPriceUsd,
    actualDeviationPercent: valuation.actualDeviationPercent,
    confidence: valuation.confidence,
  };
}
