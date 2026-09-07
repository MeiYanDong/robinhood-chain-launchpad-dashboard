export const PAIR_TOKEN_METRICS = [
  "market_cap_usd",
  "liquidity_depth_usd",
  "volume_24h_usd",
  "holder_count",
] as const;

export type PairTokenMetricName = (typeof PAIR_TOKEN_METRICS)[number];
export type PairSourceStatus = "ok" | "degraded" | "failed";
export type PairRunStatus = "running" | "success" | "partial" | "failed";

export interface PairSourceHealth {
  source: string;
  status: PairSourceStatus;
  fetchedAt: string;
  latencyMs: number;
  message: string;
}

export interface PairHolderCacheEntry {
  holderCount: number;
  observedAt: string;
  source: string;
}

export interface PairQuoteAsset {
  address: string;
  symbol: string;
  decimals: number;
}

export interface PairTokenSnapshot {
  address: string;
  name: string;
  symbol: string;
  tokenUrl: string;
  launchedAt: string | null;
  graduated: boolean;
  observedAt: string;
  priceUsd: number | null;
  marketCapUsd: number | null;
  liquidityDepthUsd: number | null;
  volume24hUsd: number | null;
  holderCount: number | null;
  holderObservedAt: string | null;
  holderSource: string | null;
  quoteAssets?: PairQuoteAsset[];
  eligible: boolean;
  eligibilityReason: string | null;
  marketDataSource: string | null;
  marketDataUpdatedAt: string | null;
}

export interface PairCollectionBatch {
  observedAt: string;
  tokens: PairTokenSnapshot[];
  sourceHealth: PairSourceHealth[];
  warnings: string[];
  universeCount: number;
  eligibleCount: number;
}

export interface PairCollectionRun {
  id: number;
  startedAt: string;
  completedAt: string | null;
  observedAt: string | null;
  status: PairRunStatus;
  universeCount: number;
  eligibleCount: number;
  warnings: string[];
  error: string | null;
}

export interface PairPlatformLiveAggregate {
  runId: number;
  observedAt: string;
  tokenCount: number;
  volumeObservedCount: number;
  volume24hUsd: number;
  complete: boolean;
}

export interface PairRankingEntry {
  rank: number;
  previousRank: number | null;
  rankChange: number | null;
  address: string;
  name: string;
  symbol: string;
  tokenUrl: string;
  graduated: boolean;
  priceUsd: number | null;
  quoteAssets?: PairQuoteAsset[];
  value: number;
  previousValue: number | null;
  valueChangePercent: number | null;
  observedAt: string;
}

export interface PairMetricRanking {
  metric: PairTokenMetricName;
  label: string;
  unit: "USD" | "count";
  observedCount: number;
  entries: PairRankingEntry[];
}

export interface PairPublicSourceHealth {
  source: string;
  status: PairSourceStatus;
  fetchedAt: string;
  latencyMs: number;
  message: string;
}

export interface PairLeaderboardResponse {
  service: "rhc-pair-token-radar";
  mode: "live" | "daily";
  generatedAt: string;
  reportDate: string | null;
  windowStart: string | null;
  cutoffAt: string | null;
  snapshot: {
    runId: number;
    observedAt: string;
    status: Exclude<PairRunStatus, "running">;
    stale: boolean;
    universeCount: number;
    eligibleCount: number;
  } | null;
  eligibility: {
    marketCapFloorUsd: number;
    liquidityDepthFloorUsd: number;
    marketFreshnessMinutes: number;
  };
  rankings: Record<PairTokenMetricName, PairMetricRanking>;
  sources: PairPublicSourceHealth[];
  warnings: string[];
}

export interface PairDailyReportRecord {
  reportDate: string;
  cutoffAt: string;
  generatedAt: string;
  runId: number;
  payload: PairLeaderboardResponse;
}
