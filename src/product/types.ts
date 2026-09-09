import type { IntelligenceResponse } from "../intelligence/types.js";

export type ProductStatus = "success" | "partial" | "unavailable";
export type ProductSourceStatus = "ok" | "degraded" | "failed";
export type ProductDecisionState =
  | "premise_confirmed"
  | "watch"
  | "premise_invalidated"
  | "unknown";

export interface ProductSource {
  id: "chain_daily" | "cashcat_live" | "market_intelligence";
  label: string;
  status: ProductSourceStatus;
  temporalScope: "closed_utc_day" | "live_snapshot" | "mixed_read_model";
  observedAt: string | null;
  stale: boolean;
  note: string;
}

export interface ProductMetric {
  id: string;
  label: string;
  shortLabel: string;
  unit: "usd" | "number" | "percent" | "seconds";
  value: number | null;
  change7d: number | null;
  change30d: number | null;
  dataDate: string | null;
  freshness: "ok" | "stale" | "unavailable" | "live";
  definition: string;
}

export interface ProductChainSnapshot {
  temporalScope: "closed_utc_day";
  targetDate: string | null;
  generatedAt: string | null;
  headline: string;
  overallState: string;
  position: { label: string; evidence: string };
  momentum: { label: string; evidence: string };
  quality: { label: string; evidence: string };
  confidence: { label: string; evidence: string };
  metrics: ProductMetric[];
  stockTokens: {
    activeAssets: number | null;
    estimatedValueUsd: number | null;
    coveragePercent: number | null;
  };
  failedSourceCount: number;
}

export interface CashcatDimension {
  id: "market_cap" | "liquidity" | "volume" | "holders";
  label: string;
  state: string;
  targetValue: number | null;
  ratioToLeader: number | null;
  rank: number | null;
  leaderSymbol: string | null;
  leaderValue: number | null;
}

export interface CashcatPriceCandle {
  observedAt: string;
  closeUsd: number;
  volumeUsd: number | null;
}

export interface ProductCashcatSnapshot {
  temporalScope: "live_snapshot";
  observedAt: string | null;
  decision: {
    state: ProductDecisionState;
    label: string;
    summary: string;
    reasons: string[];
  };
  token: {
    address: string | null;
    symbol: string;
    name: string;
    priceUsd: number | null;
    marketCapUsd: number | null;
    mainPoolLiquidityUsd: number | null;
    indexedLiquidityUsd: number | null;
    holderCount: number | null;
    volumes: {
      m5: number | null;
      h1: number | null;
      h6: number | null;
      h24: number | null;
    };
    primaryPair: string | null;
    primaryVenue: string | null;
    indexedPoolCount: number | null;
  };
  leader: {
    state: string;
    eligiblePeerCount: number | null;
    dimensions: CashcatDimension[];
  };
  attention: {
    state: string;
    robinhoodAttentionShare: number | null;
    robinhoodActivityShare: number | null;
    attentionToBaseline: number | null;
    activityToBaseline: number | null;
    targetHotRank: number | null;
  };
  narrative: {
    state: string;
    founderSupport: string;
    mainstreamAttention: string;
    externalHotspot: string;
  };
  priceHistory24h: {
    changePercent: number | null;
    highUsd: number | null;
    lowUsd: number | null;
    totalVolumeUsd: number | null;
    candles: CashcatPriceCandle[];
  };
  evidenceStatus: string;
  dataHealth: ProductSourceStatus;
  sourceHealth: Array<{
    id: string;
    label: string;
    status: string;
    observedAt: string | null;
  }>;
  evidenceReportUrl: "/cashcat/reports/latest";
}

export interface ProductWorkbenchResponse {
  service: "rhc-product-workbench";
  schemaVersion: 1;
  generatedAt: string;
  status: ProductStatus;
  chain: ProductChainSnapshot;
  cashcat: ProductCashcatSnapshot;
  intelligence: IntelligenceResponse | null;
  sources: ProductSource[];
  warnings: string[];
}
