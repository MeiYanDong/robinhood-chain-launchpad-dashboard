import type { EconomicsResponse, TokenDailyCandle } from "../economics/types.js";
import type { PairLeaderboardResponse } from "../pair/types.js";
import type { PlatformActivityResponse } from "../platform-activity/types.js";
import { shiftUtcDate } from "../utils/time.js";
import type {
  ChainHeatModel,
  PairAdjustedAnchor,
  PairAdjustedProjection,
  PairHolderObservation,
  PonsForecastDriver,
  PonsPriceForecast,
} from "./types.js";

const PONS_ADDRESS = "0x39dbed3a2bd333467115de45665cc57f813c4571";
const PAIR_ADDRESS = "0x6b1d42927b1a84ec28fa88d4fc6fa7af404966be";
const FEATURE_IDS = ["chain_breadth", "chain_capital", "chain_market", "pons_platform"] as const;
type FeatureId = (typeof FEATURE_IDS)[number];
type FeatureVector = Record<FeatureId, number | null>;

interface ForecastInput {
  now: Date;
  chainPayload: unknown;
  chainUsable: boolean;
  chainHeat: ChainHeatModel;
  economics: EconomicsResponse | null;
  pair: PairLeaderboardResponse;
  platformActivity: PlatformActivityResponse | null;
  ponsCandles: TokenDailyCandle[];
}

interface Outcome {
  date: string;
  returnLog: number;
  features: FeatureVector;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function median(values: number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function quantile(values: number[], probability: number): number | null {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0] ?? null;
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const low = sorted[lower] ?? 0;
  const high = sorted[upper] ?? low;
  return low + (high - low) * (index - lower);
}

function metricSeries(payload: unknown, id: string): Map<string, number> {
  const root = record(payload);
  const metrics = Array.isArray(root?.metrics) ? root.metrics : [];
  const metric = record(metrics.find((candidate) => record(candidate)?.id === id));
  const series = Array.isArray(metric?.series) ? metric.series : [];
  const result = new Map<string, number>();
  for (const candidate of series) {
    const row = record(candidate);
    const date = typeof row?.date === "string" ? row.date : null;
    const value = finite(row?.value);
    if (date && value !== null && value > 0) result.set(date, value);
  }
  return result;
}

function logChange(series: Map<string, number>, date: string, days = 7): number | null {
  const current = series.get(date);
  const previous = series.get(shiftUtcDate(date, -days));
  return current !== undefined && previous !== undefined && current > 0 && previous > 0
    ? Math.log(current / previous)
    : null;
}

function groupChange(series: Map<string, number>[], date: string): number | null {
  return median(
    series.map((item) => logChange(item, date)).filter((value): value is number => value !== null),
  );
}

function sumDates(
  series: Map<string, number>,
  endDate: string,
  startOffset: number,
): number | null {
  let sum = 0;
  for (let offset = startOffset; offset < startOffset + 7; offset += 1) {
    const value = series.get(shiftUtcDate(endDate, -offset));
    if (value === undefined || value < 0) return null;
    sum += value;
  }
  return sum;
}

function platformChange(series: Map<string, number>, date: string): number | null {
  const current = sumDates(series, date, 0);
  const previous = sumDates(series, date, 7);
  return current !== null && previous !== null && current > 0 && previous > 0
    ? Math.log(current / previous)
    : null;
}

function featuresForDate(input: {
  date: string;
  chainUsable: boolean;
  breadth: Map<string, number>[];
  capital: Map<string, number>[];
  market: Map<string, number>[];
  ponsVolumes: Map<string, number>;
}): FeatureVector {
  return {
    chain_breadth: input.chainUsable ? groupChange(input.breadth, input.date) : null,
    chain_capital: input.chainUsable ? groupChange(input.capital, input.date) : null,
    chain_market: input.chainUsable ? groupChange(input.market, input.date) : null,
    pons_platform: platformChange(input.ponsVolumes, input.date),
  };
}

function complete(vector: FeatureVector): vector is Record<FeatureId, number> {
  return FEATURE_IDS.every((id) => vector[id] !== null && Number.isFinite(vector[id]));
}

function robustScales(outcomes: Outcome[]): Record<FeatureId, number> {
  return Object.fromEntries(
    FEATURE_IDS.map((id) => {
      const values = outcomes
        .map((outcome) => outcome.features[id])
        .filter((value): value is number => value !== null && Number.isFinite(value));
      const center = median(values) ?? 0;
      const mad = median(values.map((value) => Math.abs(value - center))) ?? 0;
      const q25 = quantile(values, 0.25) ?? center;
      const q75 = quantile(values, 0.75) ?? center;
      return [id, Math.max(mad * 1.4826, (q75 - q25) / 1.349, 1e-6)];
    }),
  ) as Record<FeatureId, number>;
}

function distance(
  left: FeatureVector,
  right: FeatureVector,
  scales: Record<FeatureId, number>,
): number {
  return Math.sqrt(
    FEATURE_IDS.reduce((sum, id) => {
      const leftValue = left[id];
      const rightValue = right[id];
      if (leftValue === null || rightValue === null) return Number.POSITIVE_INFINITY;
      return sum + ((leftValue - rightValue) / scales[id]) ** 2;
    }, 0) / FEATURE_IDS.length,
  );
}

function nearestOutcomes(outcomes: Outcome[], current: Record<FeatureId, number>): Outcome[] {
  const completeOutcomes = outcomes.filter((outcome) => complete(outcome.features));
  if (completeOutcomes.length < 10) return [];
  const scales = robustScales(completeOutcomes);
  const count = Math.min(
    completeOutcomes.length,
    Math.max(8, Math.ceil(Math.sqrt(outcomes.length))),
  );
  return completeOutcomes
    .map((outcome) => ({ outcome, distance: distance(outcome.features, current, scales) }))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, count)
    .map((item) => item.outcome);
}

function nonOverlappingOutcomes(outcomes: Outcome[]): Outcome[] {
  const selected: Outcome[] = [];
  let lastSelectedAt = Number.NEGATIVE_INFINITY;
  for (const outcome of [...outcomes].sort((left, right) => left.date.localeCompare(right.date))) {
    const timestamp = Date.parse(`${outcome.date}T00:00:00.000Z`);
    if (!Number.isFinite(timestamp) || timestamp - lastSelectedAt < 7 * 86_400_000) continue;
    selected.push(outcome);
    lastSelectedAt = timestamp;
  }
  return selected;
}

function backtestError(outcomes: Outcome[]): number | null {
  const completeOutcomes = outcomes.filter((outcome) => complete(outcome.features));
  if (completeOutcomes.length < 10) return null;
  const scales = robustScales(completeOutcomes);
  const errors: number[] = [];
  for (const target of completeOutcomes) {
    const peers = completeOutcomes.filter((candidate) => candidate !== target);
    const count = Math.min(peers.length, Math.max(5, Math.ceil(Math.sqrt(peers.length))));
    const prediction = median(
      peers
        .map((candidate) => ({
          candidate,
          distance: distance(candidate.features, target.features, scales),
        }))
        .sort((left, right) => left.distance - right.distance)
        .slice(0, count)
        .map((item) => item.candidate.returnLog),
    );
    if (prediction !== null) {
      errors.push(Math.abs(Math.exp(prediction - target.returnLog) - 1) * 100);
    }
  }
  return median(errors);
}

function noChangeBacktestError(outcomes: Outcome[]): number | null {
  return median(outcomes.map((outcome) => Math.abs(Math.exp(outcome.returnLog) - 1) * 100));
}

function driver(
  id: PonsForecastDriver["id"],
  label: string,
  value: number | null,
  asOf: string | null,
): PonsForecastDriver {
  const change7dPercent = value === null ? null : (Math.exp(value) - 1) * 100;
  const direction: PonsForecastDriver["direction"] =
    change7dPercent === null
      ? "unknown"
      : change7dPercent > 2
        ? "supportive"
        : change7dPercent < -2
          ? "headwind"
          : "neutral";
  return { id, label, change7dPercent, direction, asOf };
}

function pairHolderObservation(pair: PairLeaderboardResponse): PairHolderObservation {
  const row = pair.rankings.holder_count.entries.find(
    (entry) => entry.address.toLowerCase() === PAIR_ADDRESS,
  );
  return {
    state: row ? "available" : "unavailable",
    holderCount: row?.value ?? null,
    previousHolderCount: row?.previousValue ?? null,
    changePercent: row?.valueChangePercent ?? null,
    observedAt: row?.observedAt ?? null,
    includedInPriceModel: false,
    reason: row
      ? "原始持币地址会受拆分钱包与机器人影响；先展示和留档，历史质量达标前权重为 0。"
      : "PAIR 持币地址观测暂不可用，未进入价格模型。",
  };
}

function unavailablePairProjection(formula: string): PairAdjustedProjection {
  return {
    state: "unavailable",
    spotPonsReferenceUsd: null,
    adjustedPonsReferenceUsd: null,
    rangeLowUsd: null,
    rangeHighUsd: null,
    actualDeviationPercent: null,
    conversionFactor: null,
    formula,
  };
}

const PAIR_SEVEN_DAY_ADJUSTED_FORMULA =
  "PONS 7日预测价格 ×（PONS 有效供应量 ÷ PAIR 有效供应量）×（PAIR 最近7个共同完整日平台量 ÷ PONS 最近7个共同完整日平台量）";
const PAIR_LATEST_DAY_ADJUSTED_FORMULA =
  "PONS 7日预测价格 ×（PONS 有效供应量 ÷ PAIR 有效供应量）×（PAIR 最新共同完整日平台量 ÷ PONS 最新共同完整日平台量）";

function adjustedPairProjection(input: {
  formula: string;
  currentPonsPrice: number | null;
  forecastMidpoint: number | null;
  forecastLow: number | null;
  forecastHigh: number | null;
  ponsSupply: number | null;
  pairSupply: number | null;
  ponsVolume: number | null;
  pairVolume: number | null;
  actualPriceUsd: number | null;
}): PairAdjustedProjection {
  if (
    input.currentPonsPrice === null ||
    input.ponsSupply === null ||
    !(input.ponsSupply > 0) ||
    input.pairSupply === null ||
    !(input.pairSupply > 0) ||
    input.ponsVolume === null ||
    !(input.ponsVolume > 0) ||
    input.pairVolume === null ||
    input.pairVolume < 0 ||
    input.forecastMidpoint === null ||
    input.forecastLow === null ||
    input.forecastHigh === null
  ) {
    return unavailablePairProjection(input.formula);
  }
  const factor = (input.ponsSupply / input.pairSupply) * (input.pairVolume / input.ponsVolume);
  const adjusted = input.forecastMidpoint * factor;
  return {
    state: "available",
    spotPonsReferenceUsd: input.currentPonsPrice * factor,
    adjustedPonsReferenceUsd: adjusted,
    rangeLowUsd: input.forecastLow * factor,
    rangeHighUsd: input.forecastHigh * factor,
    actualDeviationPercent:
      input.actualPriceUsd !== null && adjusted > 0
        ? (input.actualPriceUsd / adjusted - 1) * 100
        : null,
    conversionFactor: factor,
    formula: input.formula,
  };
}

function adjustedPairAnchor(input: {
  economics: EconomicsResponse | null;
  currentPonsPrice: number | null;
  forecastMidpoint: number | null;
  forecastLow: number | null;
  forecastHigh: number | null;
}): PairAdjustedAnchor {
  // Read through a loose record so a transient V2 snapshot remains usable during an atomic deploy.
  const valuation = record(input.economics?.pairRelativeValuation);
  const inputs = record(valuation?.inputs);
  const ponsSupply = finite(record(inputs?.ponsEffectiveSupply)?.value);
  const pairSupply = finite(record(inputs?.pairEffectiveSupply)?.value);
  const actualPriceUsd = finite(valuation?.actualPriceUsd);
  const sevenDay = adjustedPairProjection({
    ...input,
    formula: PAIR_SEVEN_DAY_ADJUSTED_FORMULA,
    ponsSupply,
    pairSupply,
    ponsVolume: finite(record(inputs?.ponsSevenDayVolumeUsd)?.value),
    pairVolume: finite(record(inputs?.pairSevenDayVolumeUsd)?.value),
    actualPriceUsd,
  });
  const latestPonsVolume =
    finite(record(inputs?.ponsLatestDayVolumeUsd)?.value) ??
    finite(record(inputs?.ponsPlatformVolumeUsd)?.value);
  const latestPairVolume =
    finite(record(inputs?.pairLatestDayVolumeUsd)?.value) ??
    finite(record(inputs?.pairPlatformVolumeUsd)?.value);
  const latestDay = adjustedPairProjection({
    ...input,
    formula: PAIR_LATEST_DAY_ADJUSTED_FORMULA,
    ponsSupply,
    pairSupply,
    ponsVolume: latestPonsVolume,
    pairVolume: latestPairVolume,
    actualPriceUsd,
  });
  return {
    state: sevenDay.state,
    actualPriceUsd,
    sevenDay,
    latestDay,
  };
}

export function buildPonsPriceForecast(input: ForecastInput): PonsPriceForecast {
  const ponsToken = input.economics?.tokens.find(
    (token) => token.address.toLowerCase() === PONS_ADDRESS,
  );
  const sortedCandles = input.ponsCandles
    .filter((candle) => candle.closeUsd > 0)
    .sort((left, right) => left.date.localeCompare(right.date));
  const formingCandle = [...sortedCandles].reverse().find((candle) => candle.state === "forming");
  const formingAge = formingCandle
    ? input.now.valueOf() - Date.parse(formingCandle.observedAt)
    : Number.POSITIVE_INFINITY;
  const formingPriceUsable =
    formingCandle !== undefined &&
    Number.isFinite(formingAge) &&
    formingAge >= -5 * 60_000 &&
    formingAge <= 2 * 60 * 60_000;
  const economicsSpot = ponsToken?.priceUsd.value;
  const currentPriceSource: PonsPriceForecast["currentPriceSource"] =
    economicsSpot !== null && economicsSpot !== undefined && economicsSpot > 0
      ? "economics_spot"
      : formingPriceUsable
        ? "gmgn_forming_candle"
        : "none";
  const currentPriceUsd =
    currentPriceSource === "economics_spot"
      ? (economicsSpot ?? null)
      : currentPriceSource === "gmgn_forming_candle"
        ? (formingCandle?.closeUsd ?? null)
        : null;
  const basePriceUsd = currentPriceUsd !== null && currentPriceUsd > 0 ? currentPriceUsd : null;
  const observedAt =
    currentPriceSource === "economics_spot"
      ? (ponsToken?.priceUsd.asOf ?? null)
      : currentPriceSource === "gmgn_forming_candle"
        ? (formingCandle?.observedAt ?? null)
        : null;
  const closedCandles = sortedCandles
    .filter((candle) => candle.state === "closed" && candle.closeUsd > 0)
    .sort((left, right) => left.date.localeCompare(right.date));
  const candleByDate = new Map(closedCandles.map((candle) => [candle.date, candle]));
  const ponsPlatform = input.platformActivity?.platforms.find(
    (platform) => platform.platformId === "pons",
  );
  const ponsVolumes = new Map(
    (ponsPlatform?.daily ?? [])
      .filter((point) => point.state === "observed" && point.valueUsd !== null)
      .map((point) => [point.date, point.valueUsd as number]),
  );
  const seriesInput = {
    chainUsable: input.chainUsable,
    breadth: [
      metricSeries(input.chainPayload, "transactions"),
      metricSeries(input.chainPayload, "active_addresses"),
    ],
    capital: [
      metricSeries(input.chainPayload, "stablecoin_supply"),
      metricSeries(input.chainPayload, "tvs"),
    ],
    market: [
      metricSeries(input.chainPayload, "dex_volume"),
      metricSeries(input.chainPayload, "protocol_fees"),
      metricSeries(input.chainPayload, "protocol_revenue"),
    ],
    ponsVolumes,
  };
  const rollingOutcomes: Outcome[] = [];
  for (const candle of closedCandles) {
    const future = candleByDate.get(shiftUtcDate(candle.date, 7));
    if (!future) continue;
    rollingOutcomes.push({
      date: candle.date,
      returnLog: Math.log(future.closeUsd / candle.closeUsd),
      features: featuresForDate({ ...seriesInput, date: candle.date }),
    });
  }
  const outcomes = nonOverlappingOutcomes(rollingOutcomes);
  const featureDate =
    [...closedCandles]
      .reverse()
      .map((candle) => candle.date)
      .find((date) => complete(featuresForDate({ ...seriesInput, date }))) ??
    closedCandles.at(-1)?.date ??
    input.now.toISOString().slice(0, 10);
  const currentFeatures = featuresForDate({ ...seriesInput, date: featureDate });
  const matched = complete(currentFeatures) ? nearestOutcomes(outcomes, currentFeatures) : [];
  const selected = matched.length > 0 ? matched : outcomes;
  const method: PonsPriceForecast["method"] =
    matched.length > 0
      ? "matched_regime_neighbors"
      : outcomes.length > 0
        ? "empirical_price_history"
        : "none";
  const enoughHistory = selected.length >= 8;
  const returns = selected.map((outcome) => outcome.returnLog);
  const returnMidpoint = enoughHistory
    ? method === "matched_regime_neighbors"
      ? median(returns)
      : 0
    : null;
  const empiricalLow = enoughHistory ? quantile(returns, 0.25) : null;
  const empiricalHigh = enoughHistory ? quantile(returns, 0.75) : null;
  const returnLow =
    empiricalLow === null
      ? null
      : method === "matched_regime_neighbors"
        ? empiricalLow
        : Math.min(0, empiricalLow);
  const returnHigh =
    empiricalHigh === null
      ? null
      : method === "matched_regime_neighbors"
        ? empiricalHigh
        : Math.max(0, empiricalHigh);
  const state: PonsPriceForecast["state"] =
    basePriceUsd === null ? "unavailable" : enoughHistory ? "available" : "building_history";
  const midpointUsd =
    state === "available" && basePriceUsd !== null && returnMidpoint !== null
      ? basePriceUsd * Math.exp(returnMidpoint)
      : null;
  const rangeLowUsd =
    state === "available" && basePriceUsd !== null && returnLow !== null
      ? basePriceUsd * Math.exp(returnLow)
      : null;
  const rangeHighUsd =
    state === "available" && basePriceUsd !== null && returnHigh !== null
      ? basePriceUsd * Math.exp(returnHigh)
      : null;
  const backtestMedianAbsoluteErrorPercent =
    method === "matched_regime_neighbors"
      ? backtestError(outcomes)
      : noChangeBacktestError(outcomes);
  const confidence: PonsPriceForecast["confidence"] =
    state !== "available"
      ? "unavailable"
      : matched.length >= 20 &&
          closedCandles.length >= 45 &&
          backtestMedianAbsoluteErrorPercent !== null &&
          backtestMedianAbsoluteErrorPercent <= 25
        ? "medium"
        : "low";
  const positiveOutcomePercent =
    enoughHistory && returns.length > 0
      ? (returns.filter((value) => value > 0).length / returns.length) * 100
      : null;
  const latestActivity = ponsPlatform?.activity["7d"].latestAvailable;
  const drivers = [
    driver("chain_breadth", "交易与活跃地址", currentFeatures.chain_breadth, featureDate),
    driver("chain_capital", "稳定币与链上价值", currentFeatures.chain_capital, featureDate),
    driver("chain_market", "DEX 与协议收入", currentFeatures.chain_market, featureDate),
    driver("pons_platform", "Pons 平台成交", currentFeatures.pons_platform, featureDate),
  ];
  const pairAdjustedAnchor = adjustedPairAnchor({
    economics: input.economics,
    currentPonsPrice: basePriceUsd,
    forecastMidpoint: midpointUsd,
    forecastLow: rangeLowUsd,
    forecastHigh: rangeHighUsd,
  });
  return {
    decisionQuestion: "where_might_pons_trade_in_7_days",
    modelVersion: "pons-regime-neighbors-v1",
    modelStatus: "shadow",
    state,
    horizonDays: 7,
    observedAt,
    currentPriceUsd,
    currentPriceSource,
    midpointUsd,
    rangeLowUsd,
    rangeHighUsd,
    medianReturnPercent: returnMidpoint === null ? null : (Math.exp(returnMidpoint) - 1) * 100,
    positiveOutcomePercent,
    confidence,
    method,
    priceObservationDays: closedCandles.length,
    outcomeSampleCount: outcomes.length,
    matchedSampleCount: matched.length,
    backtestMedianAbsoluteErrorPercent,
    chainState: input.chainHeat.state,
    chainLabel: input.chainHeat.label,
    ponsActivityMultiple: latestActivity?.multiple ?? null,
    drivers,
    pairAdjustedAnchor,
    pairHolderObservation: pairHolderObservation(input.pair),
    rules: [
      "预测区间来自 PONS 历史 7 日真实收益，不把当前 PAIR 价格反推回 PONS。",
      "链上广度、资金、市场强度与 Pons 平台成交仅用于寻找相似历史阶段；四个维度等距，不手填权重。",
      "匹配样本不足时退回纯价格历史分布，并自动降为低置信度。",
      "七日结果按不重叠窗口计数，避免把连续滚动样本误当成独立样本。",
      "PAIR 调整参考只替换 PONS 输入价格；七日主结果与最新单日短期结果分别计算，不做加权平均。",
      "持币地址增长当前权重为 0，只展示和积累历史。",
    ],
    warning:
      state === "available"
        ? method === "matched_regime_neighbors"
          ? "这是研究型区间，不是目标价或买卖信号；模型仍处于影子验证阶段。"
          : "链况匹配样本不足，中枢回退为当前价；区间只来自历史 7 日波动。"
        : currentPriceUsd === null
          ? "PONS 当前价格不可用，停止输出预测。"
          : `只有 ${outcomes.length} 个完整 7 日结果，至少需要 8 个。`,
  };
}
