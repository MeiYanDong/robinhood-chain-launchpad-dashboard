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

export const PAIR_RELATIVE_VALUATION_MODEL_VERSION = "pons-dual-window-parity-v3" as const;
export const PAIR_RELATIVE_VALUATION_MAX_DAYS = 7;
export const PAIR_RELATIVE_VALUATION_MIN_DAYS = 7 as const;
export const PAIR_RELATIVE_VALUATION_PRICE_FRESHNESS_MINUTES = 30;

const SEVEN_DAY_FORMULA =
  "PONS price × (PONS effective supply ÷ PAIR effective supply) × (PAIR latest 7 common closed-day volume ÷ PONS latest 7 common closed-day volume)";
const LATEST_DAY_FORMULA =
  "PONS price × (PONS effective supply ÷ PAIR effective supply) × (PAIR latest common closed-day volume ÷ PONS latest common closed-day volume)";

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
  sevenDayCount: number;
  totalCommonDayCount: number;
  ponsPriceQuality: EvidenceQuality;
}): PairRelativeValuationConfidence {
  if (
    input.sevenDayCount < PAIR_RELATIVE_VALUATION_MAX_DAYS ||
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
  const sevenDayDates = allCommonDates.slice(-PAIR_RELATIVE_VALUATION_MAX_DAYS);
  const latestCommonDate = sevenDayDates.at(-1) ?? null;
  const ponsMetrics = sevenDayDates
    .map((date) => ponsByDate.get(date))
    .filter((metric): metric is DailyMetric => metric !== undefined);
  const pairMetrics = sevenDayDates
    .map((date) => pairByDate.get(date))
    .filter((metric): metric is DailyMetric => metric !== undefined);
  const latestPonsMetric = latestCommonDate ? ponsByDate.get(latestCommonDate) : undefined;
  const latestPairMetric = latestCommonDate ? pairByDate.get(latestCommonDate) : undefined;
  const ponsLatestDayVolume = volumeInput(
    latestPonsMetric ? [latestPonsMetric] : [],
    "Pons",
    latestCommonDate
      ? `${latestCommonDate} 完整 UTC 日成交量；缺失日未补 0。`
      : "最新共同完整 UTC 日成交量不可用。",
  );
  const pairLatestDayVolume = volumeInput(
    latestPairMetric ? [latestPairMetric] : [],
    "PAIR",
    latestCommonDate
      ? `${latestCommonDate} 完整 UTC 日成交量；缺失日未补 0。`
      : "最新共同完整 UTC 日成交量不可用。",
  );
  const ponsSevenDayVolume = volumeInput(
    ponsMetrics,
    "Pons",
    `最近 ${ponsMetrics.length} 个共同完整 UTC 日求和；缺失日未补 0。`,
  );
  const pairSevenDayVolume = volumeInput(
    pairMetrics,
    "PAIR",
    `最近 ${pairMetrics.length} 个共同完整 UTC 日求和；缺失日未补 0。`,
  );
  const reasons: PairRelativeValuationReason[] = [];

  if (sevenDayDates.length < PAIR_RELATIVE_VALUATION_MIN_DAYS) {
    reasons.push(
      reason(
        "INSUFFICIENT_COMMON_DAYS",
        "blocking",
        `七日主参考需要 ${PAIR_RELATIVE_VALUATION_MIN_DAYS} 个共同完整 UTC 日，当前只有 ${sevenDayDates.length} 天。`,
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
  if (finiteNumber(ponsSevenDayVolume.value) && ponsSevenDayVolume.value <= 0) {
    reasons.push(reason("PONS_VOLUME_ZERO", "blocking", "Pons 七日成交量必须大于 0。"));
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
      "DUAL_WINDOW_OUTPUT",
      "note",
      "七日结果用于判断常态，最新完整日结果只用于观察短期升温或降温；两者不加权合并。",
    ),
  );

  const baseInputsValid =
    isFresh(ponsPrice, input.now, freshnessMinutes) &&
    finiteNumber(ponsPrice.value) &&
    ponsPrice.value > 0 &&
    finiteNumber(ponsSupply.value) &&
    ponsSupply.value > 0 &&
    finiteNumber(pairSupply.value) &&
    pairSupply.value > 0;
  let sevenDayReferenceUsd: number | null = null;
  let latestDayReferenceUsd: number | null = null;
  let dailyReferenceRangeLowUsd: number | null = null;
  let dailyReferenceRangeHighUsd: number | null = null;
  const supplyRatio =
    baseInputsValid && finiteNumber(ponsSupply.value) && finiteNumber(pairSupply.value)
      ? ponsSupply.value / pairSupply.value
      : null;

  if (
    baseInputsValid &&
    sevenDayDates.length === PAIR_RELATIVE_VALUATION_MIN_DAYS &&
    finiteNumber(ponsPrice.value) &&
    supplyRatio !== null &&
    finiteNumber(ponsSevenDayVolume.value) &&
    finiteNumber(pairSevenDayVolume.value) &&
    ponsSevenDayVolume.value > 0
  ) {
    const ponsPriceValue = ponsPrice.value;
    const calculated =
      ponsPriceValue * supplyRatio * (pairSevenDayVolume.value / ponsSevenDayVolume.value);
    const dailyEstimates = sevenDayDates.map((date) => {
      const pons = ponsByDate.get(date);
      const pair = pairByDate.get(date);
      return pons && pair ? ponsPriceValue * supplyRatio * (pair.value / pons.value) : Number.NaN;
    });
    if (Number.isFinite(calculated) && dailyEstimates.every(Number.isFinite)) {
      sevenDayReferenceUsd = calculated;
      dailyReferenceRangeLowUsd = quantile(dailyEstimates, 0.25);
      dailyReferenceRangeHighUsd = quantile(dailyEstimates, 0.75);
    } else {
      reasons.push(reason("CALCULATION_INVALID", "blocking", "相对估值计算结果无效。"));
    }
  }

  if (
    baseInputsValid &&
    finiteNumber(ponsPrice.value) &&
    supplyRatio !== null &&
    finiteNumber(ponsLatestDayVolume.value) &&
    finiteNumber(pairLatestDayVolume.value) &&
    ponsLatestDayVolume.value > 0
  ) {
    const calculated =
      ponsPrice.value * supplyRatio * (pairLatestDayVolume.value / ponsLatestDayVolume.value);
    if (Number.isFinite(calculated)) latestDayReferenceUsd = calculated;
  }

  if (sevenDayReferenceUsd === 0 || latestDayReferenceUsd === 0) {
    reasons.push(
      reason("PAIR_ESTIMATE_ZERO", "note", "对应窗口内 PAIR 成交量为 0，参考结果为 0。"),
    );
  }

  const state = sevenDayReferenceUsd === null ? "unavailable" : "available";
  const actualPriceUsd = pairPriceIsFresh && finiteNumber(pairPrice.value) ? pairPrice.value : null;
  const actualVsSevenDayPercent =
    actualPriceUsd !== null && sevenDayReferenceUsd !== null && sevenDayReferenceUsd > 0
      ? (actualPriceUsd / sevenDayReferenceUsd - 1) * 100
      : null;
  const actualVsLatestDayPercent =
    actualPriceUsd !== null && latestDayReferenceUsd !== null && latestDayReferenceUsd > 0
      ? (actualPriceUsd / latestDayReferenceUsd - 1) * 100
      : null;
  const latestDayVsSevenDayPercent =
    latestDayReferenceUsd !== null && sevenDayReferenceUsd !== null && sevenDayReferenceUsd > 0
      ? (latestDayReferenceUsd / sevenDayReferenceUsd - 1) * 100
      : null;
  const ponsAllocation = input.ponsPolicy.applies ? input.ponsPolicy.percentage : null;
  const pairAllocation = input.pairPolicy.applies ? input.pairPolicy.percentage : null;
  const policyFactor =
    finiteNumber(ponsAllocation) &&
    ponsAllocation > 0 &&
    finiteNumber(pairAllocation) &&
    pairAllocation > 0
      ? pairAllocation / ponsAllocation
      : null;
  const policySevenDayReferenceUsd =
    sevenDayReferenceUsd !== null && policyFactor !== null
      ? sevenDayReferenceUsd * policyFactor
      : null;
  const policyLatestDayReferenceUsd =
    latestDayReferenceUsd !== null && policyFactor !== null
      ? latestDayReferenceUsd * policyFactor
      : null;

  return {
    modelVersion: PAIR_RELATIVE_VALUATION_MODEL_VERSION,
    state,
    observedAt: input.observedAt,
    priceFreshnessMinutes: freshnessMinutes,
    primaryWindowDefinition: "latest_7_common_closed_utc_days",
    primaryMinimumDays: PAIR_RELATIVE_VALUATION_MIN_DAYS,
    sevenDayCount: sevenDayDates.length,
    sevenDayDates,
    sevenDayWindowStart: sevenDayDates[0] ?? null,
    sevenDayWindowEnd: sevenDayDates.at(-1) ?? null,
    latestDayWindowDefinition: "latest_common_closed_utc_day",
    latestDayDate: latestCommonDate,
    totalCommonDayCount: allCommonDates.length,
    sevenDayFormula: SEVEN_DAY_FORMULA,
    latestDayFormula: LATEST_DAY_FORMULA,
    sevenDayReferenceUsd,
    latestDayReferenceUsd,
    latestDayVsSevenDayPercent,
    dailyReferenceRangeLowUsd,
    dailyReferenceRangeHighUsd,
    actualPriceUsd,
    actualVsSevenDayPercent,
    actualVsLatestDayPercent,
    policyScenario: {
      state:
        policySevenDayReferenceUsd === null && policyLatestDayReferenceUsd === null
          ? "unavailable"
          : "available",
      sevenDayReferenceUsd: policySevenDayReferenceUsd,
      latestDayReferenceUsd: policyLatestDayReferenceUsd,
      ponsFeeAllocationPercent: ponsAllocation,
      pairFeeAllocationPercent: pairAllocation,
      assumption: "all_other_factors_equal",
    },
    confidence:
      state === "available"
        ? confidence({
            selectedMetrics,
            sevenDayCount: sevenDayDates.length,
            totalCommonDayCount: allCommonDates.length,
            ponsPriceQuality: ponsPrice.quality,
          })
        : "unavailable",
    inputs: {
      ponsPriceUsd: ponsPrice,
      pairActualPriceUsd: pairPrice,
      ponsEffectiveSupply: ponsSupply,
      pairEffectiveSupply: pairSupply,
      ponsLatestDayVolumeUsd: ponsLatestDayVolume,
      pairLatestDayVolumeUsd: pairLatestDayVolume,
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
    sevenDayReferenceUsd: null,
    latestDayReferenceUsd: null,
    latestDayVsSevenDayPercent: null,
    dailyReferenceRangeLowUsd: null,
    dailyReferenceRangeHighUsd: null,
    actualPriceUsd: null,
    actualVsSevenDayPercent: null,
    actualVsLatestDayPercent: null,
    policyScenario: {
      ...valuation.policyScenario,
      state: "unavailable",
      sevenDayReferenceUsd: null,
      latestDayReferenceUsd: null,
    },
    confidence: "unavailable",
    reasons: withReason(valuation, nextReason),
  };
}

export function refreshPairRelativeValuationFreshness(
  valuation: PairRelativeValuation,
  now: Date,
): PairRelativeValuation {
  if (
    (valuation.sevenDayReferenceUsd !== null || valuation.latestDayReferenceUsd !== null) &&
    !isFresh(valuation.inputs.ponsPriceUsd, now, valuation.priceFreshnessMinutes)
  ) {
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
      actualVsSevenDayPercent: null,
      actualVsLatestDayPercent: null,
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
    platformWindowEnd: valuation.latestDayDate,
    sevenDayReferenceUsd: valuation.sevenDayReferenceUsd,
    latestDayReferenceUsd: valuation.latestDayReferenceUsd,
    actualVsSevenDayPercent: valuation.actualVsSevenDayPercent,
    actualVsLatestDayPercent: valuation.actualVsLatestDayPercent,
    dailyReferenceRangeLowUsd: valuation.dailyReferenceRangeLowUsd,
    dailyReferenceRangeHighUsd: valuation.dailyReferenceRangeHighUsd,
    actualPriceUsd: valuation.actualPriceUsd,
    confidence: valuation.confidence,
  };
}
