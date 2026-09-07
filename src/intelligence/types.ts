export type IntelligenceStatus = "success" | "partial" | "unavailable";
export type SourceState = "ok" | "degraded" | "failed";
export type HeatState = "cooling" | "normal" | "warming" | "hot" | "overheated" | "unknown";
export type HeatDimensionState = "cooling" | "steady" | "expanding" | "extreme" | "unknown";

export interface IntelligenceSource {
  id: "chain_radar" | "cashcat" | "economics" | "pair" | "long";
  label: string;
  status: SourceState;
  temporalScope: "closed_utc_day" | "live_snapshot" | "rolling_24h";
  observedAt: string | null;
  stale: boolean;
  note: string;
}

export interface RankedToken {
  rank: number;
  address: string;
  symbol: string;
  name: string;
  value: number;
}

export interface LeaderCategory {
  id: "market_cap" | "liquidity" | "volume_24h" | "holder_count";
  label: string;
  unit: "USD" | "count";
  scope: string;
  leader: RankedToken | null;
  top3: RankedToken[];
}

export interface LeaderVerdict {
  state: "confirmed" | "provisional" | "none" | "unknown";
  address: string | null;
  symbol: string | null;
  name: string | null;
  reason: string;
}

export interface LeaderModel {
  decisionQuestion: "who_leads_robinhood_chain";
  modelVersion: "structural-leader-v1";
  structuralLeader: LeaderVerdict;
  cliffLeader: LeaderVerdict;
  categories: LeaderCategory[];
  observedAt: string | null;
  eligibleUniverseCount: number | null;
  rules: string[];
}

export interface HeatMetricEvidence {
  id: string;
  label: string;
  value: number | null;
  change7d: number | null;
  ratioToBaseline: number | null;
  asOf: string | null;
}

export interface HeatDimension {
  id: "breadth" | "market_activity" | "cost_pressure" | "cross_chain";
  label: string;
  state: HeatDimensionState;
  evidence: HeatMetricEvidence[];
  conclusion: string;
}

export interface ChainHeatModel {
  decisionQuestion: "is_robinhood_chain_overheated";
  modelVersion: "chain-heat-v1";
  state: HeatState;
  label: string;
  confidence: "high" | "medium" | "low";
  divergence: boolean | null;
  intensityToBreadthRatio: number | null;
  dimensions: HeatDimension[];
  observedAt: string | null;
  warning: string;
}

export interface TokenHeatRow {
  address: string;
  symbol: string;
  name: string;
  state: HeatState;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  turnover24h: number | null;
  liquidityChurn24h: number | null;
  acceleration5m: number | null;
  acceleration1h: number | null;
  priceChange24hPercent: number | null;
  observedAt: string | null;
  evidence: string[];
  missing: string[];
}

export interface TokenHeatModel {
  decisionQuestion: "which_leaders_are_overheated";
  modelVersion: "token-pressure-v1";
  rows: TokenHeatRow[];
  rules: string[];
}

export type RelativeValuationState =
  | "relative_discount"
  | "in_range"
  | "relative_premium"
  | "unknown";

export interface RelativeValuationRow {
  address: string;
  symbol: string;
  name: string;
  priceUsd: number | null;
  currentMarketCapUsd: number;
  impliedMarketCapUsd: number | null;
  rangeLowMarketCapUsd: number | null;
  rangeHighMarketCapUsd: number | null;
  relativeGapPercent: number | null;
  state: RelativeValuationState;
  metricsUsed: Array<"liquidity_depth_usd" | "volume_24h_usd" | "holder_count">;
  anchorCount: number;
  reason: string;
}

export interface RelativeValuationCohort {
  id: "pair_launches" | "long_launches";
  label: string;
  scope: string;
  observedAt: string | null;
  rows: RelativeValuationRow[];
}

export interface PlatformTokenValuation {
  modelVersion: string;
  state: "available" | "unavailable";
  pairActualPriceUsd: number | null;
  pairImpliedPriceUsd: number | null;
  rangeLowUsd: number | null;
  rangeHighUsd: number | null;
  actualDeviationPercent: number | null;
  confidence: "high" | "medium" | "low" | "unavailable";
  observedAt: string | null;
  reason: string;
}

export interface RelativeValuationModel {
  decisionQuestion: "which_tracked_tokens_are_expensive_or_cheap_relative_to_peers";
  modelVersion: "role-cohort-relative-v1";
  platformToken: PlatformTokenValuation;
  cohorts: RelativeValuationCohort[];
  rules: string[];
}

export interface IntelligenceResponse {
  service: "rhc-market-intelligence";
  generatedAt: string;
  status: IntelligenceStatus;
  leader: LeaderModel;
  chainHeat: ChainHeatModel;
  tokenHeat: TokenHeatModel;
  relativeValuation: RelativeValuationModel;
  sources: IntelligenceSource[];
  warnings: string[];
}
