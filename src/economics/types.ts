import type { MetricQuality } from "../domain/types.js";

export type EconomicsPlatformId = "pons" | "long" | "pair";
export type ValueState = "observed" | "derived" | "unknown" | "not_applicable";
export type EvidenceQuality =
  | "official"
  | "onchain"
  | "third_party"
  | "scope_mismatch"
  | "unknown"
  | "not_applicable";

export interface EvidenceValue {
  value: number | null;
  state: ValueState;
  quality: EvidenceQuality;
  source: string | null;
  asOf: string | null;
  note: string | null;
}

export interface EconomicsSourceHealth {
  source: string;
  label: string;
  status: "ok" | "degraded" | "failed";
  fetchedAt: string;
  message: string;
  url: string | null;
}

export interface ProtocolTokenMarketObservation {
  platformId: "pons" | "pair";
  address: string;
  name: string;
  symbol: string;
  tokenUrl: string;
  observedAt: string;
  priceUsd: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  holderCount: number | null;
  source: string;
  quality: "official" | "third_party" | "derived";
}

export interface TokenSupplyObservation {
  address: string;
  decimals: number;
  totalSupply: number;
  burnedSupply: number;
  observedAt: string;
  blockNumber: string | null;
}

export interface EconomicsCollectionBatch {
  observedAt: string;
  tokenMarkets: ProtocolTokenMarketObservation[];
  tokenSupplies: TokenSupplyObservation[];
  sourceHealth: EconomicsSourceHealth[];
  warnings: string[];
}

export interface TokenEconomicsRow {
  platformId: EconomicsPlatformId;
  platformName: string;
  role: "protocol_token" | "dynamic_market_cap_leader";
  address: string;
  name: string;
  symbol: string;
  tokenUrl: string;
  observedAt: string | null;
  priceUsd: EvidenceValue;
  marketCapUsd: EvidenceValue;
  burnAdjustedMarketCapUsd: EvidenceValue;
  liquidityUsd: EvidenceValue;
  volume24hUsd: EvidenceValue;
  holderCount: EvidenceValue;
  totalSupply: EvidenceValue;
  burnedSupply: EvidenceValue;
  burnedPercent: EvidenceValue;
}

export interface BuybackPolicy {
  applies: boolean;
  percentage: number | null;
  basis: string;
  evidence: "documented" | "announced" | "not_applicable";
  sourceUrl: string | null;
}

export interface PlatformEconomicsRow {
  platformId: EconomicsPlatformId;
  platformName: string;
  date: string;
  volumeUsd: EvidenceValue;
  threePlatformSharePercent: EvidenceValue;
  userFeesUsd: EvidenceValue;
  protocolRevenueAccruedUsd: EvidenceValue;
  protocolRevenueReceivedUsd: EvidenceValue;
  buybackPolicy: BuybackPolicy;
  policyBuybackBudgetUsd: EvidenceValue;
  executedBuybackUsd: EvidenceValue;
  retainedAfterBuybackUsd: EvidenceValue;
  netProfitUsd: EvidenceValue;
}

export interface BuybackSummaryRow {
  platformId: EconomicsPlatformId;
  platformName: string;
  policy: BuybackPolicy;
  cumulativeBurnedTokens: EvidenceValue;
  cumulativeBurnedPercent: EvidenceValue;
  dailyExecutedSpendUsd: EvidenceValue;
  dailyExecutedTokens: EvidenceValue;
  lastVerifiedTransaction: string | null;
  proofStatus: "transaction_verified" | "policy_and_cumulative_burn_only" | "not_applicable";
  note: string;
}

export type PairRelativeValuationState = "available" | "unavailable";
export type PairRelativeValuationConfidence = "high" | "medium" | "low" | "unavailable";

export type PairRelativeValuationReasonCode =
  | "INSUFFICIENT_COMMON_DAYS"
  | "PONS_PRICE_MISSING"
  | "PONS_PRICE_STALE"
  | "PONS_EFFECTIVE_SUPPLY_MISSING"
  | "PAIR_EFFECTIVE_SUPPLY_MISSING"
  | "PONS_VOLUME_ZERO"
  | "PAIR_PRICE_MISSING"
  | "PAIR_PRICE_STALE"
  | "PAIR_ESTIMATE_ZERO"
  | "CALCULATION_INVALID"
  | "SHORT_SHARED_HISTORY"
  | "PARTIAL_VOLUME_INPUT"
  | "THIRD_PARTY_BENCHMARK_PRICE"
  | "ECONOMICS_SNAPSHOT_STALE";

export interface PairRelativeValuationReason {
  code: PairRelativeValuationReasonCode;
  severity: "blocking" | "note";
  message: string;
}

export interface PairRelativeValuationInputs {
  ponsPriceUsd: EvidenceValue;
  pairActualPriceUsd: EvidenceValue;
  ponsEffectiveSupply: EvidenceValue;
  pairEffectiveSupply: EvidenceValue;
  ponsPlatformVolumeUsd: EvidenceValue;
  pairPlatformVolumeUsd: EvidenceValue;
}

export interface PairRelativeValuationPolicyScenario {
  state: PairRelativeValuationState;
  estimateUsd: number | null;
  ponsFeeAllocationPercent: number | null;
  pairFeeAllocationPercent: number | null;
  assumption: "all_other_factors_equal";
}

export interface PairRelativeValuation {
  modelVersion: "pons-volume-parity-v1";
  state: PairRelativeValuationState;
  observedAt: string;
  priceFreshnessMinutes: number;
  windowDefinition: "latest_7_common_closed_utc_days";
  minimumCommonDays: 5;
  commonDayCount: number;
  totalCommonDayCount: number;
  commonDates: string[];
  platformWindowStart: string | null;
  platformWindowEnd: string | null;
  formula: string;
  estimateUsd: number | null;
  rangeLowUsd: number | null;
  rangeHighUsd: number | null;
  actualPriceUsd: number | null;
  actualDeviationPercent: number | null;
  policyScenario: PairRelativeValuationPolicyScenario;
  confidence: PairRelativeValuationConfidence;
  inputs: PairRelativeValuationInputs;
  reasons: PairRelativeValuationReason[];
}

export interface PairRelativeValuationHistoryPoint {
  modelVersion: PairRelativeValuation["modelVersion"];
  observedAt: string;
  state: PairRelativeValuationState;
  platformWindowEnd: string | null;
  estimateUsd: number | null;
  rangeLowUsd: number | null;
  rangeHighUsd: number | null;
  actualPriceUsd: number | null;
  actualDeviationPercent: number | null;
  confidence: PairRelativeValuationConfidence;
}

export interface PairRelativeValuationHistoryResponse {
  service: "rhc-launchpad-economics";
  generatedAt: string;
  window: "7d";
  points: PairRelativeValuationHistoryPoint[];
}

export interface EconomicsResponse {
  service: "rhc-launchpad-economics";
  generatedAt: string;
  observedAt: string;
  targetDate: string;
  status: "success" | "partial";
  stale: boolean;
  shareDefinition: "pons_long_pair_closed_utc_day";
  shareReady: boolean;
  shareDenominatorUsd: number | null;
  tokens: TokenEconomicsRow[];
  platforms: PlatformEconomicsRow[];
  buybacks: BuybackSummaryRow[];
  pairRelativeValuation: PairRelativeValuation;
  sources: EconomicsSourceHealth[];
  warnings: string[];
}

export interface StoredEconomicsSnapshot {
  id: number;
  observedAt: string;
  targetDate: string;
  status: EconomicsResponse["status"];
  payload: EconomicsResponse;
}

export function metricQualityToEvidence(quality: MetricQuality): EvidenceQuality {
  if (quality === "scope_mismatch" || quality === "suite_wide") return "scope_mismatch";
  if (quality === "unknown") return "unknown";
  return quality === "reported" ? "official" : "third_party";
}
