import type { EconomicsResponse, TokenDailyCandle } from "../economics/types.js";
import type { LongLeaderboardResponse } from "../long-tokens/types.js";
import type {
  PairLeaderboardResponse,
  PairRankingEntry,
  PairTokenMetricName,
} from "../pair/types.js";
import type { PlatformActivityResponse } from "../platform-activity/types.js";
import { buildPonsPriceForecast } from "./pons-forecast.js";
import type {
  ChainHeatModel,
  HeatDimension,
  HeatDimensionState,
  HeatMetricEvidence,
  IntelligenceResponse,
  IntelligenceSource,
  LeaderCategory,
  LeaderModel,
  LeaderVerdict,
  PlatformTokenValuation,
  RankedToken,
  RelativeValuationCohort,
  RelativeValuationRow,
  TokenHeatModel,
  TokenHeatRow,
} from "./types.js";

export interface ExternalIntelligenceInput {
  payload: unknown | null;
  status: "ok" | "failed";
}

export interface IntelligenceBuildInput {
  now: Date;
  chain: ExternalIntelligenceInput;
  cashcat: ExternalIntelligenceInput;
  economics: EconomicsResponse | null;
  pair: PairLeaderboardResponse;
  long: LongLeaderboardResponse;
  platformActivity: PlatformActivityResponse | null;
  ponsPriceHistory: TokenDailyCandle[];
}

interface TokenFact {
  address: string;
  symbol: string;
  name: string;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  holderCount: number | null;
  volumes: Record<string, number | null>;
}

interface CohortToken {
  address: string;
  symbol: string;
  name: string;
  priceUsd: number | null;
  marketCapUsd: number | null;
  liquidityDepthUsd: number | null;
  volume24hUsd: number | null;
  holderCount: number | null;
}

const COHORT_METRICS = ["liquidity_depth_usd", "volume_24h_usd", "holder_count"] as const;
type CohortMetric = (typeof COHORT_METRICS)[number];

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nested(value: unknown, ...path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    const object = record(current);
    if (!object) return null;
    current = object[key];
  }
  return current;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function iso(value: unknown): string | null {
  const candidate = text(value);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null;
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

function rankRows(value: unknown): RankedToken[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((candidate) => {
      const row = record(candidate);
      const rank = finite(row?.rank);
      const address = text(row?.address);
      const symbol = text(row?.symbol);
      const amount = finite(row?.value);
      if (rank === null || !address || !symbol || amount === null) return null;
      return {
        rank,
        address,
        symbol,
        name: text(row?.name) ?? symbol,
        value: amount,
      };
    })
    .filter((row): row is RankedToken => row !== null)
    .sort((left, right) => left.rank - right.rank)
    .slice(0, 3);
}

function sameToken(left: string | null, right: string | null): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function category(
  id: LeaderCategory["id"],
  label: string,
  unit: LeaderCategory["unit"],
  scope: string,
  rows: RankedToken[],
): LeaderCategory {
  return { id, label, unit, scope, leader: rows[0] ?? null, top3: rows };
}

function noLeader(state: LeaderVerdict["state"], reason: string): LeaderVerdict {
  return { state, address: null, symbol: null, name: null, reason };
}

function verdictFor(
  row: RankedToken,
  state: LeaderVerdict["state"],
  reason: string,
): LeaderVerdict {
  return {
    state,
    address: row.address,
    symbol: row.symbol,
    name: row.name,
    reason,
  };
}

function ratioOfTopTwo(rows: RankedToken[]): number | null {
  const first = rows[0]?.value;
  const second = rows[1]?.value;
  return first !== undefined && second !== undefined && second > 0 ? first / second : null;
}

function buildLeader(cashcatPayload: unknown): LeaderModel {
  const latest = nested(cashcatPayload, "latest");
  const dimensions = nested(latest, "analysis", "leader", "dimensions");
  const market = rankRows(nested(dimensions, "market_cap", "top3"));
  const liquidity = rankRows(nested(dimensions, "liquidity", "top3"));
  const holders = rankRows(nested(dimensions, "holder_count", "top3"));
  const windows = record(nested(dimensions, "multi_window_volume", "windows"));
  const volumeRows: Record<string, RankedToken[]> = {};
  for (const window of ["5m", "1h", "6h", "24h"]) {
    volumeRows[window] = rankRows(nested(windows?.[window], "top3"));
  }
  const categories = [
    category("market_cap", "市值", "USD", "GMGN 当前标准市值", market),
    category("liquidity", "主池流动性", "USD", "GMGN 最大主池；不是全部池子之和", liquidity),
    category("volume_24h", "24H 成交", "USD", "GMGN 滚动 24 小时成交量", volumeRows["24h"] ?? []),
    category("holder_count", "持币地址", "count", "GMGN 持币地址数；不等于真实人数", holders),
  ];
  const observedAt = iso(nested(latest, "observed_at"));
  const eligibleUniverseCount = finite(nested(latest, "analysis", "leader", "eligible_peer_count"));
  const candidate = market[0];
  const requiredReady =
    Boolean(candidate) &&
    liquidity.length >= 2 &&
    holders.length >= 2 &&
    Object.values(volumeRows).filter((rows) => rows.length >= 2).length === 4;
  if (!candidate || !requiredReady) {
    return {
      decisionQuestion: "who_leads_robinhood_chain",
      modelVersion: "structural-leader-v1",
      structuralLeader: noLeader("unknown", "市值、流动性、成交或持币地址的 Top 3 数据不齐。"),
      cliffLeader: noLeader("unknown", "断崖龙头需要四类数据同时可用。"),
      categories,
      observedAt,
      eligibleUniverseCount,
      rules: leaderRules(),
    };
  }

  const address = candidate.address;
  const liquidityTop3 = liquidity.some((row) => sameToken(row.address, address));
  const holdersTop3 = holders.some((row) => sameToken(row.address, address));
  const leadingWindows = Object.values(volumeRows).filter((rows) =>
    sameToken(rows[0]?.address ?? null, address),
  ).length;
  const structuralLeader =
      liquidityTop3 && holdersTop3 && leadingWindows >= 3
        ? verdictFor(
            candidate,
            "confirmed",
            `市值第 1、流动性与持币地址均在 Top 3，并领先 ${String(leadingWindows)}/4 个成交窗口。`,
          )
        : liquidityTop3 && holdersTop3 && leadingWindows >= 2
          ? verdictFor(candidate, "provisional", "市值领先，但多窗口成交尚未形成稳定主导。")
          : noLeader("none", "当前没有代币同时满足市值、流动性、成交和持币广度条件。"),
    volumeRatios = Object.values(volumeRows)
      .filter((rows) => sameToken(rows[0]?.address ?? null, address))
      .map(ratioOfTopTwo)
      .filter((value): value is number => value !== null && value > 0),
    volumeGeometricRatio =
      volumeRatios.length > 0
        ? Math.exp(
            volumeRatios.reduce((sum, value) => sum + Math.log(value), 0) / volumeRatios.length,
          )
        : null,
    cliffConditions = [
      ratioOfTopTwo(market) !== null && (ratioOfTopTwo(market) ?? 0) >= 1.5,
      sameToken(liquidity[0]?.address ?? null, address) &&
        ratioOfTopTwo(liquidity) !== null &&
        (ratioOfTopTwo(liquidity) ?? 0) >= 1.5,
      sameToken(holders[0]?.address ?? null, address) &&
        ratioOfTopTwo(holders) !== null &&
        (ratioOfTopTwo(holders) ?? 0) >= 1.5,
      leadingWindows >= 3 && volumeGeometricRatio !== null && volumeGeometricRatio >= 1.3,
    ],
    cliffLeader = cliffConditions.every(Boolean)
      ? verdictFor(candidate, "confirmed", "四类优势均达到预设断崖阈值。")
      : noLeader("none", "有结构龙头，但尚未在四类指标上同时形成断崖优势。 ");

  return {
    decisionQuestion: "who_leads_robinhood_chain",
    modelVersion: "structural-leader-v1",
    structuralLeader,
    cliffLeader,
    categories,
    observedAt,
    eligibleUniverseCount,
    rules: leaderRules(),
  };
}

function leaderRules(): string[] {
  return [
    "结构龙头：市值第 1，流动性与持币地址进入 Top 3，并领先至少 3/4 个成交窗口。",
    "断崖龙头：结构龙头之外，市值、流动性、持币地址领先倍数至少 1.5，成交领先倍数至少 1.3。",
    "不同流动性口径不混排；这里固定使用 GMGN 最大主池。",
  ];
}

function chainMetric(payload: unknown, id: string): HeatMetricEvidence {
  const metrics = nested(payload, "metrics");
  const row = Array.isArray(metrics)
    ? record(metrics.find((candidate) => record(candidate)?.id === id))
    : null;
  const freshness = text(row?.freshness);
  return {
    id,
    label: text(row?.label) ?? id,
    value: freshness === "stale" || freshness === "unavailable" ? null : finite(row?.value),
    change7d: freshness === "stale" || freshness === "unavailable" ? null : finite(row?.change7d),
    ratioToBaseline: null,
    asOf: iso(row?.dataDate),
  };
}

function dimension(
  id: HeatDimension["id"],
  label: string,
  state: HeatDimensionState,
  evidence: HeatMetricEvidence[],
  conclusion: string,
): HeatDimension {
  return { id, label, state, evidence, conclusion };
}

function buildChainHeat(
  chainPayload: unknown,
  cashcatPayload: unknown,
  chainSource: IntelligenceSource,
  cashcatSource: IntelligenceSource,
): ChainHeatModel {
  const transactions = chainMetric(chainPayload, "transactions");
  const active = chainMetric(chainPayload, "active_addresses");
  const dex = chainMetric(chainPayload, "dex_volume");
  const fees = chainMetric(chainPayload, "protocol_fees");
  const revenue = chainMetric(chainPayload, "protocol_revenue");
  const cost = chainMetric(chainPayload, "median_tx_cost");
  const attention: HeatMetricEvidence = {
    id: "robinhood_attention",
    label: "跨链注意力 / 自身基线",
    value: finite(
      nested(
        cashcatPayload,
        "latest",
        "analysis",
        "attention",
        "chain_shares",
        "robinhood",
        "attention",
      ),
    ),
    change7d: null,
    ratioToBaseline: finite(
      nested(cashcatPayload, "latest", "analysis", "attention", "robinhood_attention_vs_baseline"),
    ),
    asOf: iso(nested(cashcatPayload, "latest", "observed_at")),
  };
  const activity: HeatMetricEvidence = {
    id: "robinhood_activity",
    label: "跨链活跃量 / 自身基线",
    value: finite(
      nested(
        cashcatPayload,
        "latest",
        "analysis",
        "attention",
        "chain_shares",
        "robinhood",
        "activity",
      ),
    ),
    change7d: null,
    ratioToBaseline: finite(
      nested(cashcatPayload, "latest", "analysis", "attention", "robinhood_activity_vs_baseline"),
    ),
    asOf: iso(nested(cashcatPayload, "latest", "observed_at")),
  };

  const chainUsable = chainSource.status !== "failed" && !chainSource.stale;
  const breadthChanges = chainUsable
    ? [transactions.change7d, active.change7d].filter((value): value is number => value !== null)
    : [];
  const breadthMean = median(breadthChanges);
  const breadthState: HeatDimensionState =
    breadthChanges.length < 2 || breadthMean === null
      ? "unknown"
      : breadthChanges.every((value) => value < -0.05)
        ? "cooling"
        : breadthChanges.every((value) => value >= 0) && breadthMean >= 0.03
          ? "expanding"
          : "steady";
  const breadth = dimension(
    "breadth",
    "用户广度",
    breadthState,
    [transactions, active],
    breadthState === "expanding"
      ? "交易笔数与活跃地址共同扩张。"
      : breadthState === "cooling"
        ? "交易笔数与活跃地址共同回落。"
        : breadthState === "unknown"
          ? "用户广度数据不足。"
          : "用户广度没有形成强方向。",
  );

  const marketChanges = chainUsable
    ? [dex.change7d, fees.change7d, revenue.change7d].filter(
        (value): value is number => value !== null,
      )
    : [];
  const marketMedian = median(marketChanges);
  const marketState: HeatDimensionState =
    marketChanges.length < 2 || marketMedian === null
      ? "unknown"
      : marketMedian >= 1
        ? "extreme"
        : marketMedian >= 0.2
          ? "expanding"
          : marketMedian <= -0.1
            ? "cooling"
            : "steady";
  const market = dimension(
    "market_activity",
    "交易强度",
    marketState,
    [dex, fees, revenue],
    marketState === "extreme"
      ? "DEX 成交与协议费用的 7 日增速处于极端区间。"
      : marketState === "expanding"
        ? "成交与费用正在扩张。"
        : marketState === "cooling"
          ? "成交与费用正在降温。"
          : marketState === "unknown"
            ? "交易强度数据不足。"
            : "成交与费用相对平稳。",
  );

  const costChange = chainUsable ? cost.change7d : null;
  const costState: HeatDimensionState =
    costChange === null
      ? "unknown"
      : costChange >= 1
        ? "extreme"
        : costChange >= 0.25
          ? "expanding"
          : costChange <= -0.2
            ? "cooling"
            : "steady";
  const costs = dimension(
    "cost_pressure",
    "成本压力",
    costState,
    [cost],
    costState === "extreme"
      ? "中位交易成本快速上升，拥挤成本已是风险信号。"
      : costState === "expanding"
        ? "交易成本明显上升。"
        : costState === "cooling"
          ? "交易成本正在回落。"
          : costState === "unknown"
            ? "交易成本数据不足。"
            : "交易成本相对平稳。",
  );

  const crossRatios =
    cashcatSource.status !== "failed" && !cashcatSource.stale
      ? [attention.ratioToBaseline, activity.ratioToBaseline].filter(
          (value): value is number => value !== null,
        )
      : [];
  const crossMedian = median(crossRatios);
  const crossState: HeatDimensionState =
    crossRatios.length < 2 || crossMedian === null
      ? "unknown"
      : crossMedian >= 1.6
        ? "extreme"
        : crossMedian >= 1.15
          ? "expanding"
          : crossMedian <= 0.75
            ? "cooling"
            : "steady";
  const cross = dimension(
    "cross_chain",
    "跨链注意力",
    crossState,
    [attention, activity],
    crossState === "extreme"
      ? "Robinhood Chain 的注意力与活跃量显著高于自身历史基线。"
      : crossState === "expanding"
        ? "跨链注意力或活跃量高于自身基线。"
        : crossState === "cooling"
          ? "注意力与活跃量正在离开 Robinhood Chain。"
          : crossState === "unknown"
            ? "跨链基线数据不足。"
            : "跨链份额接近自身历史基线。",
  );

  const breadthMagnitude = breadthMean === null ? null : Math.max(Math.abs(breadthMean), 0.01);
  const intensityToBreadthRatio =
    marketMedian !== null && breadthMagnitude !== null && marketMedian > 0
      ? marketMedian / breadthMagnitude
      : null;
  const divergence =
    intensityToBreadthRatio === null
      ? null
      : intensityToBreadthRatio >= 4 && marketState === "extreme";
  const usableDimensions = [breadth, market, costs, cross].filter(
    (item) => item.state !== "unknown",
  ).length;
  const state: ChainHeatModel["state"] =
    !chainUsable || usableDimensions < 3
      ? "unknown"
      : marketState === "extreme" && costState === "extreme" && divergence === true
        ? "overheated"
        : marketState === "extreme" || (marketState === "expanding" && crossState === "extreme")
          ? "hot"
          : marketState === "expanding" || crossState === "expanding"
            ? "warming"
            : marketState === "cooling" && breadthState === "cooling"
              ? "cooling"
              : "normal";
  const labels: Record<ChainHeatModel["state"], string> = {
    cooling: "降温",
    normal: "常态",
    warming: "升温",
    hot: "高热",
    overheated: "交易过热",
    unknown: "未知",
  };
  const confidence: ChainHeatModel["confidence"] =
    usableDimensions === 4 && chainSource.status === "ok" && cashcatSource.status === "ok"
      ? "high"
      : usableDimensions >= 3
        ? "medium"
        : "low";
  return {
    decisionQuestion: "is_robinhood_chain_overheated",
    modelVersion: "chain-heat-v1",
    state,
    label: labels[state],
    confidence,
    divergence,
    intensityToBreadthRatio,
    dimensions: [breadth, market, costs, cross],
    observedAt: iso(nested(chainPayload, "generatedAt")),
    warning:
      state === "overheated"
        ? "交易与费用增速远快于用户广度，且成本压力极高；这是拥挤风险，不等于价格必然见顶。"
        : "热度模型描述链上拥挤与活动强度，不预测代币涨跌。",
  };
}

function buildTokenHeat(
  cashcatPayload: unknown,
  economics: EconomicsResponse | null,
): TokenHeatModel {
  const latest = nested(cashcatPayload, "latest");
  const dimensions = nested(latest, "analysis", "leader", "dimensions");
  const windows = record(nested(dimensions, "multi_window_volume", "windows"));
  const facts = new Map<string, TokenFact>();
  const upsert = (
    row: RankedToken,
    field: keyof Pick<TokenFact, "marketCapUsd" | "liquidityUsd" | "holderCount">,
  ) => {
    const key = row.address.toLowerCase();
    const current = facts.get(key) ?? {
      address: row.address,
      symbol: row.symbol,
      name: row.name,
      marketCapUsd: null,
      liquidityUsd: null,
      holderCount: null,
      volumes: {},
    };
    current[field] = row.value;
    facts.set(key, current);
  };
  for (const row of rankRows(nested(dimensions, "market_cap", "top3"))) upsert(row, "marketCapUsd");
  for (const row of rankRows(nested(dimensions, "liquidity", "top3"))) upsert(row, "liquidityUsd");
  for (const row of rankRows(nested(dimensions, "holder_count", "top3")))
    upsert(row, "holderCount");
  for (const window of ["5m", "1h", "6h", "24h"]) {
    for (const row of rankRows(nested(windows?.[window], "top3"))) {
      const key = row.address.toLowerCase();
      const current = facts.get(key) ?? {
        address: row.address,
        symbol: row.symbol,
        name: row.name,
        marketCapUsd: null,
        liquidityUsd: null,
        holderCount: null,
        volumes: {},
      };
      current.volumes[window] = row.value;
      facts.set(key, current);
    }
  }

  const target = record(nested(latest, "collection", "target"));
  const targetAddress = text(target?.address);
  if (targetAddress) {
    const key = targetAddress.toLowerCase();
    const targetVolumes = record(target?.volumes);
    facts.set(key, {
      address: targetAddress,
      symbol: text(target?.symbol) ?? "UNKNOWN",
      name: text(target?.name) ?? text(target?.symbol) ?? "UNKNOWN",
      marketCapUsd: finite(target?.market_cap),
      liquidityUsd: finite(target?.liquidity),
      holderCount: finite(target?.holder_count),
      volumes: Object.fromEntries(
        ["5m", "1h", "6h", "24h"].map((window) => [window, finite(targetVolumes?.[window])]),
      ),
    });
  }
  for (const token of economics?.tokens ?? []) {
    const key = token.address.toLowerCase();
    const current = facts.get(key);
    if (!current) continue;
    current.marketCapUsd ??= token.marketCapUsd.value;
    current.liquidityUsd ??= token.liquidityUsd.value;
    current.holderCount ??= token.holderCount.value;
    current.volumes["24h"] ??= token.volume24hUsd.value;
  }

  const targetPriceChange = finite(
    nested(latest, "collection", "price_history_24h", "change_percent"),
  );
  const observedAt = iso(nested(latest, "observed_at"));
  const rows = [...facts.values()]
    .map((fact): TokenHeatRow => {
      const volume24h = fact.volumes["24h"] ?? null;
      const turnover =
        volume24h !== null && fact.marketCapUsd !== null && fact.marketCapUsd > 0
          ? volume24h / fact.marketCapUsd
          : null;
      const churn =
        volume24h !== null && fact.liquidityUsd !== null && fact.liquidityUsd > 0
          ? volume24h / fact.liquidityUsd
          : null;
      const volume5m = fact.volumes["5m"] ?? null;
      const volume1h = fact.volumes["1h"] ?? null;
      const acceleration5m =
        volume5m !== null && volume1h !== null && volume1h > 0 ? (volume5m * 12) / volume1h : null;
      const acceleration1h =
        volume1h !== null && volume24h !== null && volume24h > 0
          ? (volume1h * 24) / volume24h
          : null;
      const priceChange24hPercent = sameToken(fact.address, targetAddress)
        ? targetPriceChange
        : null;
      const pressureSignals = [
        turnover !== null && turnover >= 0.12,
        churn !== null && churn >= 6,
        acceleration5m !== null && acceleration5m >= 1.25,
        acceleration1h !== null && acceleration1h >= 1.25,
      ].filter(Boolean).length;
      const extremeSignals = [
        turnover !== null && turnover >= 0.3,
        churn !== null && churn >= 15,
        acceleration5m !== null && acceleration5m >= 1.8,
        acceleration1h !== null && acceleration1h >= 1.8,
      ].filter(Boolean).length;
      const enoughCore = turnover !== null && churn !== null;
      const state: TokenHeatRow["state"] = !enoughCore
        ? "unknown"
        : extremeSignals >= 2 && priceChange24hPercent !== null && priceChange24hPercent >= 25
          ? "overheated"
          : pressureSignals >= 2
            ? "hot"
            : pressureSignals === 1
              ? "warming"
              : "normal";
      const evidence = [
        turnover === null ? null : `24H 换手/市值 ${(turnover * 100).toFixed(1)}%`,
        churn === null ? null : `24H 成交/主池 ${churn.toFixed(1)}×`,
        acceleration5m === null ? null : `5M 年化到 1H 节奏 ${acceleration5m.toFixed(2)}×`,
        acceleration1h === null ? null : `1H 年化到 24H 节奏 ${acceleration1h.toFixed(2)}×`,
        priceChange24hPercent === null ? null : `24H 价格 ${priceChange24hPercent.toFixed(1)}%`,
      ].filter((value): value is string => value !== null);
      const missing = [
        turnover === null ? "市值或 24H 成交缺失" : null,
        churn === null ? "主池流动性或 24H 成交缺失" : null,
        acceleration5m === null ? "5M/1H 成交不在保留的 Top 3 中" : null,
        priceChange24hPercent === null ? "24H 价格动量未接入" : null,
      ].filter((value): value is string => value !== null);
      return {
        address: fact.address,
        symbol: fact.symbol,
        name: fact.name,
        state,
        marketCapUsd: fact.marketCapUsd,
        liquidityUsd: fact.liquidityUsd,
        volume24hUsd: volume24h,
        turnover24h: turnover,
        liquidityChurn24h: churn,
        acceleration5m,
        acceleration1h,
        priceChange24hPercent,
        observedAt,
        evidence,
        missing,
      };
    })
    .sort((left, right) => (right.marketCapUsd ?? -1) - (left.marketCapUsd ?? -1))
    .slice(0, 5);
  return {
    decisionQuestion: "which_leaders_are_overheated",
    modelVersion: "token-pressure-v1",
    rows,
    rules: [
      "高热至少需要换手率、流动性周转或短周期加速中的两个信号。",
      "过热还需要至少两个极端信号和 24H 价格上涨至少 25%；缺价格动量时最高只判高热。",
      "该模型衡量交易拥挤，不是买卖信号。",
    ],
  };
}

function mergeRankings(response: PairLeaderboardResponse | LongLeaderboardResponse): CohortToken[] {
  const tokens = new Map<string, CohortToken>();
  const assign = (metric: PairTokenMetricName, entry: PairRankingEntry) => {
    const key = entry.address.toLowerCase();
    const token = tokens.get(key) ?? {
      address: entry.address,
      symbol: entry.symbol,
      name: entry.name,
      priceUsd: entry.priceUsd,
      marketCapUsd: null,
      liquidityDepthUsd: null,
      volume24hUsd: null,
      holderCount: null,
    };
    token.priceUsd ??= entry.priceUsd;
    if (metric === "market_cap_usd") token.marketCapUsd = entry.value;
    if (metric === "liquidity_depth_usd") token.liquidityDepthUsd = entry.value;
    if (metric === "volume_24h_usd") token.volume24hUsd = entry.value;
    if (metric === "holder_count") token.holderCount = entry.value;
    tokens.set(key, token);
  };
  for (const metric of [
    "market_cap_usd",
    "liquidity_depth_usd",
    "volume_24h_usd",
    "holder_count",
  ] as const) {
    for (const entry of response.rankings[metric].entries) assign(metric, entry);
  }
  return [...tokens.values()];
}

function cohortValue(token: CohortToken, metric: CohortMetric): number | null {
  if (metric === "liquidity_depth_usd") return token.liquidityDepthUsd;
  if (metric === "volume_24h_usd") return token.volume24hUsd;
  return token.holderCount;
}

function relativeRow(token: CohortToken, tokens: CohortToken[]): RelativeValuationRow {
  const estimates: Array<{ metric: CohortMetric; value: number; anchors: string[] }> = [];
  for (const metric of COHORT_METRICS) {
    const targetValue = cohortValue(token, metric);
    if (targetValue === null || targetValue <= 0) continue;
    const anchors = tokens.filter(
      (candidate) =>
        !sameToken(candidate.address, token.address) &&
        candidate.marketCapUsd !== null &&
        candidate.marketCapUsd > 0 &&
        (cohortValue(candidate, metric) ?? 0) > 0,
    );
    if (anchors.length < 2) continue;
    const multiples = anchors.map(
      (anchor) => (anchor.marketCapUsd ?? 0) / (cohortValue(anchor, metric) ?? 1),
    );
    const multiple = median(multiples);
    if (multiple === null) continue;
    estimates.push({
      metric,
      value: targetValue * multiple,
      anchors: anchors.map((anchor) => anchor.address),
    });
  }
  const current = token.marketCapUsd;
  if (current === null || current <= 0 || estimates.length < 2) {
    return {
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      priceUsd: token.priceUsd,
      currentMarketCapUsd: current ?? 0,
      impliedMarketCapUsd: null,
      rangeLowMarketCapUsd: null,
      rangeHighMarketCapUsd: null,
      relativeGapPercent: null,
      state: "unknown",
      metricsUsed: estimates.map((item) => item.metric),
      anchorCount: new Set(estimates.flatMap((item) => item.anchors)).size,
      reason: "至少需要当前市值，以及两类指标各自不少于两个同组锚点。",
    };
  }
  const values = estimates.map((item) => item.value);
  const center = median(values);
  const low = quantile(values, 0.25);
  const high = quantile(values, 0.75);
  if (center === null || low === null || high === null || center <= 0) {
    return {
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      priceUsd: token.priceUsd,
      currentMarketCapUsd: current,
      impliedMarketCapUsd: null,
      rangeLowMarketCapUsd: null,
      rangeHighMarketCapUsd: null,
      relativeGapPercent: null,
      state: "unknown",
      metricsUsed: estimates.map((item) => item.metric),
      anchorCount: new Set(estimates.flatMap((item) => item.anchors)).size,
      reason: "相对估值计算结果无效。",
    };
  }
  const state: RelativeValuationRow["state"] =
    current < low ? "relative_discount" : current > high ? "relative_premium" : "in_range";
  return {
    address: token.address,
    symbol: token.symbol,
    name: token.name,
    priceUsd: token.priceUsd,
    currentMarketCapUsd: current,
    impliedMarketCapUsd: center,
    rangeLowMarketCapUsd: low,
    rangeHighMarketCapUsd: high,
    relativeGapPercent: (current / center - 1) * 100,
    state,
    metricsUsed: estimates.map((item) => item.metric),
    anchorCount: new Set(estimates.flatMap((item) => item.anchors)).size,
    reason:
      state === "relative_discount"
        ? "当前市值低于同组锚点给出的四分位区间。"
        : state === "relative_premium"
          ? "当前市值高于同组锚点给出的四分位区间。"
          : "当前市值位于同组锚点给出的四分位区间内。",
  };
}

function buildCohort(
  id: RelativeValuationCohort["id"],
  label: string,
  scope: string,
  response: PairLeaderboardResponse | LongLeaderboardResponse,
  excludedAddresses: Set<string>,
): RelativeValuationCohort {
  const tokens = mergeRankings(response).filter(
    (token) => !excludedAddresses.has(token.address.toLowerCase()),
  );
  return {
    id,
    label,
    scope,
    observedAt: response.snapshot?.observedAt ?? null,
    rows: tokens
      .filter((token) => token.marketCapUsd !== null)
      .map((token) => relativeRow(token, tokens))
      .sort((left, right) => right.currentMarketCapUsd - left.currentMarketCapUsd),
  };
}

function platformTokenValuation(economics: EconomicsResponse | null): PlatformTokenValuation {
  const valuation = economics?.pairRelativeValuation;
  if (!valuation) {
    return {
      modelVersion: "pons-latest-day-volume-parity-v2",
      state: "unavailable",
      pairActualPriceUsd: null,
      pairImpliedPriceUsd: null,
      rangeLowUsd: null,
      rangeHighUsd: null,
      actualDeviationPercent: null,
      confidence: "unavailable",
      observedAt: null,
      reason: "PAIR/PONS 平台币相对估值尚未生成。",
    };
  }
  return {
    modelVersion: valuation.modelVersion,
    state: valuation.state,
    pairActualPriceUsd: valuation.actualPriceUsd,
    pairImpliedPriceUsd: valuation.estimateUsd,
    rangeLowUsd: valuation.rangeLowUsd,
    rangeHighUsd: valuation.rangeHighUsd,
    actualDeviationPercent: valuation.actualDeviationPercent,
    confidence: valuation.confidence,
    observedAt: valuation.observedAt,
    reason:
      valuation.reasons.map((reason) => reason.message).join("；") ||
      "按最新共同完整 UTC 日的平台成交量与有效供应量相对 PONS 锚定；7 日值只作平滑对照。",
  };
}

function sourceAgeStale(observedAt: string | null, now: Date, maximumHours: number): boolean {
  if (!observedAt) return true;
  const timestamp = Date.parse(observedAt);
  return !Number.isFinite(timestamp) || now.valueOf() - timestamp > maximumHours * 60 * 60_000;
}

function buildSources(input: IntelligenceBuildInput): IntelligenceSource[] {
  const chainObservedAt = iso(nested(input.chain.payload, "generatedAt"));
  const chainStale = sourceAgeStale(chainObservedAt, input.now, 72);
  const cashcatObservedAt = iso(nested(input.cashcat.payload, "latest", "observed_at"));
  const cashcatHealth = text(nested(input.cashcat.payload, "health", "status"));
  const cashcatStale = sourceAgeStale(cashcatObservedAt, input.now, 1) || cashcatHealth === "STALE";
  const cashcatOnchain = text(
    nested(input.cashcat.payload, "health", "data_sources", "onchain", "status"),
  );
  const cashcatStatus: IntelligenceSource["status"] =
    input.cashcat.status === "failed" || !cashcatObservedAt || cashcatOnchain === "ERROR"
      ? "failed"
      : cashcatOnchain === "OK"
        ? "ok"
        : "degraded";
  const pairSnapshot = input.pair.snapshot;
  const longSnapshot = input.long.snapshot;
  return [
    {
      id: "chain_radar",
      label: "Robinhood Chain 日度雷达",
      status: input.chain.status === "ok" && chainObservedAt ? "ok" : "failed",
      temporalScope: "closed_utc_day",
      observedAt: chainObservedAt,
      stale: chainStale,
      note: "闭合 UTC 日；用于用户广度、DEX 成交、费用和成本压力。",
    },
    {
      id: "cashcat",
      label: "CashCat Sentinel / GMGN",
      status: cashcatStatus,
      temporalScope: "live_snapshot",
      observedAt: cashcatObservedAt,
      stale: cashcatStale,
      note:
        cashcatStatus === "ok" && cashcatHealth !== "OK"
          ? "本模块使用的 GMGN 市场数据可用；CashCat 的叙事等其它来源可单独降级。"
          : cashcatStatus === "degraded"
            ? "本模块所需的部分链上市场数据降级。"
            : "同链 Top 3、多窗口成交与跨链注意力。",
    },
    {
      id: "economics",
      label: "PONS / Long / PAIR 经营对比",
      status: !input.economics
        ? "failed"
        : input.economics.status === "partial"
          ? "degraded"
          : "ok",
      temporalScope: "closed_utc_day",
      observedAt: input.economics?.observedAt ?? null,
      stale: input.economics?.stale ?? true,
      note: "平台成交、手续费、协议收入、回购与 PAIR/PONS 平台币相对估值。",
    },
    {
      id: "pair",
      label: "PAIR 发射代币榜",
      status: !pairSnapshot ? "failed" : pairSnapshot.status === "partial" ? "degraded" : "ok",
      temporalScope: "rolling_24h",
      observedAt: pairSnapshot?.observedAt ?? null,
      stale: pairSnapshot?.stale ?? true,
      note: "PAIR 官方池总深度；只在 PAIR 发射代币组内比较。",
    },
    {
      id: "long",
      label: "Long 发射代币榜",
      status: !longSnapshot ? "failed" : longSnapshot.status === "partial" ? "degraded" : "ok",
      temporalScope: "rolling_24h",
      observedAt: longSnapshot?.observedAt ?? null,
      stale: longSnapshot?.stale ?? true,
      note: "经 LongLauncher 链上事件验证的 GMGN 活跃样本。",
    },
  ];
}

export function buildIntelligence(input: IntelligenceBuildInput): IntelligenceResponse {
  const sources = buildSources(input);
  const source = (id: IntelligenceSource["id"]) =>
    sources.find((candidate) => candidate.id === id) as IntelligenceSource;
  const leader = buildLeader(input.cashcat.payload);
  const chainHeat = buildChainHeat(
    input.chain.payload,
    input.cashcat.payload,
    source("chain_radar"),
    source("cashcat"),
  );
  const tokenHeat = buildTokenHeat(input.cashcat.payload, input.economics);
  const pairProtocolAddresses = new Set(
    (input.economics?.tokens ?? [])
      .filter((token) => token.platformId === "pair" && token.role === "protocol_token")
      .map((token) => token.address.toLowerCase()),
  );
  pairProtocolAddresses.add("0x6b1d42927b1a84ec28fa88d4fc6fa7af404966be");
  const relativeValuation = {
    decisionQuestion: "which_tracked_tokens_are_expensive_or_cheap_relative_to_peers" as const,
    modelVersion: "role-cohort-relative-v1" as const,
    platformToken: platformTokenValuation(input.economics),
    cohorts: [
      buildCohort(
        "pair_launches",
        "PAIR 发射代币",
        "排除协议币 PAIR；以同组代币的流动性、24H 成交和持币地址分别锚定市值。",
        input.pair,
        pairProtocolAddresses,
      ),
      buildCohort(
        "long_launches",
        "Long 发射代币",
        "仅使用已通过 LongLauncher 事件归属验证的活跃样本。",
        input.long,
        new Set<string>(),
      ),
    ],
    rules: [
      "平台币只与平台币比较；发射代币只与同平台、同角色样本比较。",
      "每类指标至少需要两个其它锚点；至少两类指标可用才给出相对区间。",
      "相对折价或溢价不是绝对低估或高估，也不是目标价。",
    ],
  };
  const ponsForecast = buildPonsPriceForecast({
    now: input.now,
    chainPayload: input.chain.payload,
    chainUsable: source("chain_radar").status !== "failed" && !source("chain_radar").stale,
    chainHeat,
    economics: input.economics,
    pair: input.pair,
    platformActivity: input.platformActivity,
    ponsCandles: input.ponsPriceHistory,
  });
  const usableCohortRows = relativeValuation.cohorts.flatMap((cohort) => cohort.rows);
  const unavailable =
    leader.structuralLeader.state === "unknown" &&
    chainHeat.state === "unknown" &&
    usableCohortRows.length === 0;
  const degradedSources = sources.filter(
    (candidate) => candidate.status !== "ok" || candidate.stale,
  );
  const warnings = degradedSources.map((candidate) =>
    candidate.status === "failed"
      ? `${candidate.label} 当前不可用。`
      : candidate.stale
        ? `${candidate.label} 已超过预期更新时间。`
        : `${candidate.label} 部分来源降级。`,
  );
  return {
    service: "rhc-market-intelligence",
    generatedAt: input.now.toISOString(),
    status: unavailable ? "unavailable" : degradedSources.length > 0 ? "partial" : "success",
    leader,
    chainHeat,
    tokenHeat,
    relativeValuation,
    ponsForecast,
    sources,
    warnings,
  };
}
