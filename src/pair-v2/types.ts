export type PairV2ModeId = 1 | 2 | 3;
export type PairV2RunKind = "chain" | "full";
export type PairV2RunStatus = "running" | "success" | "partial" | "failed";
export type PairV2SourceStatus = "ok" | "degraded" | "failed";
export type PairV2AlphaStage =
  | "rejected"
  | "watch"
  | "attention"
  | "forming"
  | "confirmed"
  | "emerging";
export type PairV2RiskState = "low" | "medium" | "high" | "critical";
export type PairV2Confidence = "low" | "medium" | "high";
export type PairV2QualityState = "unknown" | "unqualified" | "qualified";
export type PairV2HeatState = "normal" | "hot" | "overheated";
export type PairV2ModelStatus = "shadow" | "validated";
export type PairAlphaActionState =
  | "risk_halt"
  | "no_chase"
  | "confirmed"
  | "probe_eligible"
  | "retest_watch"
  | "ignition_watch"
  | "evidence_wait"
  | "cold_watch";
export type PairAlphaIdentityEvidence = "current_release_event" | "pair_official_api" | "unknown";
export type PairV2EventType =
  | "launch"
  | "fee_collected"
  | "buyback_executed"
  | "holder_claim"
  | "upgrade";

export interface PairV2SourceHealth {
  id: "pair_release" | "pair_tokens" | "dexscreener_pairs" | "robinhood_rpc" | "gmgn_holders";
  label: string;
  status: PairV2SourceStatus;
  fetchedAt: string;
  latencyMs: number;
  observed: number;
  expected: number | null;
  message: string;
}

export interface PairV2ReleaseAddresses {
  launchpad: string;
  modeRegistry: string;
  coordinator: string;
  tokenFactory: string;
  hook: string;
  buybackExecutor: string;
  aggregator: string;
}

export interface PairV2Release {
  releaseId: string;
  manifestSha256: string;
  schema: string;
  capability: string;
  ready: boolean;
  configured: boolean;
  canonical: boolean;
  deploymentBlock: number;
  attestedBlock: number;
  addresses: PairV2ReleaseAddresses;
  observedAt: string;
}

export interface PairV2QuoteAsset {
  address: string;
  symbol: string;
  decimals: number;
}

export interface PairV2Pool {
  positionId: string;
  poolId: string | null;
  quote: PairV2QuoteAsset;
  canonical?: boolean;
  weightBps?: number | null;
}

export interface PairV2ProjectProfile {
  descriptionPresent: boolean;
  websiteUrl: string | null;
  twitterUrl: string | null;
  telegramUrl: string | null;
  metadataUri: string | null;
}

export interface PairV2ShortWindowMarket {
  observedAt: string;
  source: "dexscreener";
  pairCount: number;
  volume5mUsd: number | null;
  volume1hUsd: number | null;
  volume6hUsd: number | null;
  volume24hUsd: number | null;
  buys5m: number | null;
  sells5m: number | null;
  buys1h: number | null;
  sells1h: number | null;
  priceChange1hPct: number | null;
  priceChange6hPct: number | null;
  priceChange24hPct: number | null;
  priceChange5mPct?: number | null;
  primaryPoolId?: string | null;
  primaryVolume5mUsd?: number | null;
  primaryVolume1hUsd?: number | null;
  primaryVolume24hUsd?: number | null;
  primaryLiquidityUsd?: number | null;
  consensusPriceUsd?: number | null;
  minimumPriceUsd?: number | null;
  maximumPriceUsd?: number | null;
  crossPoolSpreadPct?: number | null;
}

export interface PairV2MarketToken {
  address: string;
  name: string;
  symbol: string;
  creator: string | null;
  launchedAt: string | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  holderCount: number | null;
  holderObservedAt: string | null;
  marketDataUpdatedAt: string | null;
  hidden: boolean;
  flagged: boolean;
  pools: PairV2Pool[];
  profile?: PairV2ProjectProfile;
  shortWindow?: PairV2ShortWindowMarket | null;
  marketDataSource?: string | null;
  dexScreenerUrl?: string | null;
  graduated?: boolean;
  migrationProgressPercent?: number | null;
  initialDeveloperBuyRaw?: string | null;
  quoteSpentOnDeveloperBuyRaw?: string | null;
  launchVersion?: "v1" | "v2" | "unknown";
  marketVersion?: string | null;
  launchTransactionHash?: string | null;
  alphaMarketCandidate?: boolean;
  alphaCandidateReasons?: string[];
}

export interface PairV2Launch {
  eventId: string;
  releaseId: string;
  project: string;
  creator: string;
  vault: string;
  handler: string;
  modeId: PairV2ModeId;
  modeVersion: number;
  salt: string;
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
  timestamp: string;
}

export interface PairV2ChainEvent {
  id: string;
  releaseId: string;
  type: PairV2EventType;
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
  timestamp: string;
  emitter: string;
  project: string | null;
  vault: string | null;
  actor: string | null;
  asset: string | null;
  assetSymbol: string | null;
  amountRaw: string | null;
  amount: number | null;
  secondaryAmountRaw: string | null;
  secondaryAmount: number | null;
  epoch: number | null;
  positionId: string | null;
  modeId: PairV2ModeId | null;
  implementation: string | null;
  evidence: "onchain";
}

export interface PairV2Bucket {
  releaseId: string;
  project: string;
  vault: string;
  epoch: number;
  asset: string;
  assetSymbol: string;
  decimals: number;
  amountRaw: string;
  amount: number;
  observedBlock: number;
  observedAt: string;
}

export interface PairV2CollectionContext {
  kind: PairV2RunKind;
  marketMode?: "none" | "hot" | "full";
  fromBlock: number;
  cachedRelease: PairV2Release | null;
  cachedTokens: PairV2MarketToken[];
  cachedLaunches: PairV2Launch[];
}

export interface PairV2CollectionBatch {
  kind: PairV2RunKind;
  observedAt: string;
  latestBlock: number;
  scanFromBlock: number;
  release: PairV2Release;
  tokens: PairV2MarketToken[];
  launches: PairV2Launch[];
  events: PairV2ChainEvent[];
  buckets: PairV2Bucket[];
  sourceHealth: PairV2SourceHealth[];
  warnings: string[];
  marketUpdatedAddresses?: string[];
}

export interface PairV2HistoricalSnapshot {
  observedAt: string;
  priceUsd: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  holderCount: number | null;
}

export interface PairV2AlphaResult {
  modelVersion: string;
  modelStatus: PairV2ModelStatus;
  quality: {
    score: number | null;
    state: PairV2QualityState;
    profileScore: number;
    liquidityScore: number | null;
    adoptionScore: number | null;
    reasons: string[];
    missing: string[];
  };
  signal: {
    score: number | null;
    state: PairV2AlphaStage;
    researchEligible: boolean;
    reasons: string[];
    missing: string[];
  };
  heat: {
    score: number;
    state: PairV2HeatState;
    reasons: string[];
  };
  riskProfile: {
    platform: PairV2RiskState;
    token: PairV2RiskState;
    tradeReady: boolean;
    platformReasons: string[];
    tokenReasons: string[];
  };
  evidence: {
    confidence: PairV2Confidence;
    completenessPercent: number;
    available: string[];
    missing: string[];
  };
  metrics: {
    marketCapChange5mPct: number | null;
    marketCapChange15mPct: number | null;
    holderChange15mPct: number | null;
    liquidityChange15mPct: number | null;
    volume5mUsd: number | null;
    volume1hUsd: number | null;
    buys5m: number | null;
    sells5m: number | null;
    buys1h: number | null;
    sells1h: number | null;
    buyPressure5m: number | null;
    buyPressure1h: number | null;
    priceChange1hPct: number | null;
  };
  action?: {
    state: PairAlphaActionState;
    label: string;
    informationalOnly: boolean;
    reasons: string[];
  };
  // Compatibility fields retained for cached dashboards and existing consumers.
  discoveryScore: number;
  confirmationScore: number | null;
  heatScore: number;
  stage: PairV2AlphaStage;
  risk: PairV2RiskState;
  confidence: PairV2Confidence;
  confidenceScore: number;
  reasons: string[];
  risks: string[];
  missing: string[];
}

export interface PairV2ScoringCandidate {
  token: PairV2MarketToken;
  launch: PairV2Launch | null;
  previous: PairV2HistoricalSnapshot | null;
  previous5m?: PairV2HistoricalSnapshot | null;
  previous15m?: PairV2HistoricalSnapshot | null;
  previous1h?: PairV2HistoricalSnapshot | null;
  volumePercentile: number | null;
  turnoverPercentile: number | null;
  volume5mPercentile?: number | null;
  volume1hPercentile?: number | null;
  holderPercentile?: number | null;
  buyActivityPercentile?: number | null;
  unverifiedProductionGraph: boolean;
  identityEvidence?: PairAlphaIdentityEvidence;
  requireCurrentRelease?: boolean;
  now: Date;
}

export interface PairV2AlphaOutcomeHorizon {
  horizon: "5m" | "30m" | "2h" | "6h" | "24h";
  observedCount: number;
  medianGrossReturnPct: number | null;
  medianFeeAdjustedReturnPct: number | null;
  positiveRatePercent: number | null;
  loss20RatePercent: number | null;
}

export interface PairAlphaLifecycleObservation {
  firstObservedAt: string;
  firstIgnitionAt: string | null;
  lastTransitionAt: string;
  previousActionState: PairAlphaActionState | null;
}

export interface PairAlphaTokenView extends PairV2TokenView {
  identity: {
    generation: "v1" | "v2" | "unknown";
    marketVersion: string | null;
    evidence: PairAlphaIdentityEvidence;
    currentRelease: boolean;
  };
  lifecycle: PairAlphaLifecycleObservation;
  volumeEvidence: {
    official24hUsd: number | null;
    primaryPool24hUsd: number | null;
    canonicalGross24hUsd: number | null;
    canonicalPoolCount: number;
    netQuoteInflowUsd: null;
    netQuoteInflowStatus: "unknown";
  };
}

export interface PairAlphaRadarResponse {
  service: "rhc-pair-alpha-radar";
  generatedAt: string;
  observedAt: string;
  status: "success" | "partial";
  stale: boolean;
  scope: "pair_all_generations";
  monitoring: {
    hotMarketPollSeconds: number;
    fullUniversePollSeconds: number;
  };
  overview: {
    officialUniverseCount: number;
    visibleUniverseCount: number;
    monitoredMarketCount: number;
    shortWindowObservedCount: number;
    v1Count: number;
    v2Count: number;
    ignitionCount: number;
    retestCount: number;
    researchCount: number;
    noChaseCount: number;
    riskHaltCount: number;
    canonicalGrossVolume5mUsd: number | null;
    canonicalGrossVolume1hUsd: number | null;
    canonicalGrossVolume24hUsd: number | null;
    primaryPoolVolume24hUsd: number | null;
    liquidityUsd: number | null;
  };
  generationCounts: Array<{ generation: "v1" | "v2" | "unknown"; count: number }>;
  alphaModel: PairV2AlphaModelSummary;
  tokens: PairAlphaTokenView[];
  sources: PairV2SourceHealth[];
  alerts: PairV2AlertSummary;
  warnings: string[];
}

export interface PairV2AlphaModelSummary {
  version: string;
  status: PairV2ModelStatus;
  validated: boolean;
  observationStartedAt: string | null;
  observationDays: number;
  firstSignalCount: number;
  matured24hCount: number;
  graduation: {
    minimumDays: number;
    minimumMaturedProjects: number;
    dayProgressPercent: number;
    sampleProgressPercent: number;
    readyForReview: boolean;
  };
  horizons: PairV2AlphaOutcomeHorizon[];
  limitations: string[];
}

export interface PairV2TokenView extends PairV2MarketToken {
  canonical: boolean;
  modeId: PairV2ModeId | null;
  modeLabel: string;
  vault: string | null;
  handler: string | null;
  fees: {
    userFees24hUsd: number | null;
    modeShare24hUsd: number | null;
    protocolShare24hUsd: number | null;
    basis: "calculated" | "unknown";
  };
  buyback: {
    pendingBuckets: PairV2Bucket[];
    executedCount: number;
    executedInputByAsset: Array<{
      asset: string;
      symbol: string | null;
      amount: number;
    }>;
    burnedAmount: number;
  };
  alpha: PairV2AlphaResult;
}

export interface PairV2AlertSummary {
  configured: boolean;
  pending: number;
  failed: number;
  lastSentAt: string | null;
}

export interface PairV2DashboardResponse {
  service: "rhc-pair-v2-monitor";
  generatedAt: string;
  observedAt: string;
  status: "success" | "partial";
  stale: boolean;
  monitoring: {
    chainPollSeconds: number;
    marketPollSeconds: number;
    hotMarketPollSeconds?: number;
    staleAfterSeconds: number;
  };
  release: PairV2Release & {
    sourceVerification: "active_graph_unverified";
    auditEvidence: "not_observed";
    upgradeAuthority: "single_eoa_observed";
  };
  overview: {
    latestBlock: number;
    publicV2TokenCount: number;
    currentReleaseLaunchCount: number;
    currentReleaseIndexedCount: number;
    marketCoveragePercent: number;
    officialPoolTokenCount: number;
    officialPoolVolume5mUsd: number | null;
    officialPoolVolume1hUsd: number | null;
    officialPoolVolume24hUsd: number | null;
    officialPoolLiquidityUsd: number | null;
    volume24hUsd: number;
    marketCapUsd: number;
    liquidityUsd: number | null;
    userFees24hUsd: number;
    modeShare24hUsd: number;
    protocolShare24hUsd: number;
    buybackModeVolume24hUsd: number;
    buybackBudget24hUsd: number;
    buybackExecutedCount: number;
    holderClaimCount: number;
    upgradeCount: number;
  };
  modeCounts: Array<{ modeId: PairV2ModeId; label: string; count: number }>;
  alphaModel: PairV2AlphaModelSummary;
  tokens: PairV2TokenView[];
  events: PairV2ChainEvent[];
  sources: PairV2SourceHealth[];
  alerts: PairV2AlertSummary;
  warnings: string[];
  alphaRadar?: PairAlphaRadarResponse;
}

export interface PairV2RunRecord {
  id: number;
  kind: PairV2RunKind;
  startedAt: string;
  completedAt: string | null;
  observedAt: string | null;
  status: PairV2RunStatus;
  latestBlock: number | null;
  warnings: string[];
  error: string | null;
}

export interface PairV2Alert {
  dedupeKey: string;
  severity: "info" | "warning" | "critical";
  type: "release" | "launch" | "alpha" | "heat" | "risk" | "buyback" | "upgrade";
  title: string;
  message: string;
  project: string | null;
  createdAt: string;
}
