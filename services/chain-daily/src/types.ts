export type Freshness = "ok" | "stale" | "unavailable" | "live";
export type Unit = "usd" | "number" | "percent" | "seconds";

export interface SeriesPoint {
  date: string;
  value: number;
}

export interface ChainValue {
  id: string;
  name: string;
  value: number | null;
  dataDate: string | null;
}

export interface MetricSnapshot {
  id: string;
  label: string;
  shortLabel: string;
  unit: Unit;
  temporalScope: "closed_day" | "latest_snapshot";
  value: number | null;
  dataDate: string | null;
  targetDate: string;
  freshness: Freshness;
  lagDays: number | null;
  avg7d: number | null;
  change7d: number | null;
  change30d: number | null;
  series: SeriesPoint[];
  peers: ChainValue[];
  peerRank: number | null;
  peerTotal: number | null;
  trackedRank: number | null;
  trackedTotal: number | null;
  percentile: number | null;
  sourceId: string;
  definition: string;
  caveat: string | null;
}

export interface SourceReceipt {
  id: string;
  label: string;
  url: string;
  fetchedAt: string;
  ok: boolean;
  httpStatus: number | null;
  bytes: number | null;
  sha256: string | null;
  dataDate: string | null;
  error: string | null;
}

export interface PillarState {
  id: "usage" | "capital" | "economics" | "market";
  label: string;
  state: "accelerating" | "stable" | "softening" | "mixed" | "unknown";
  evidence: string;
}

export interface Insight {
  severity: "positive" | "watch" | "quality";
  title: string;
  detail: string;
  metricId: string | null;
}

export interface StockTokenSnapshot {
  activeAssets: number | null;
  pricedAssets: number | null;
  valuedAssets: number | null;
  estimatedValueUsd: number | null;
  coveragePercent: number | null;
  quoteGeneratedAt: string | null;
  chainId: number;
  method: string;
}

export interface NetworkHealth {
  chainId: number;
  rpcOk: boolean | null;
  officialStatus: string | null;
  blockscout: {
    totalTransactions: number | null;
    totalAddresses: number | null;
    averageBlockTimeMs: number | null;
  };
}

export type AssessmentTone = "positive" | "watch" | "negative" | "neutral" | "unknown";
export type PositionState = "leading" | "middle" | "lagging" | "split" | "unknown";
export type MomentumState = "expanding" | "stable" | "softening" | "rebounding" | "pullback" | "unknown";
export type QualityState = "broad" | "balanced" | "divergent" | "weak" | "unknown";
export type ConfidenceState = "high" | "medium" | "low";
export type OverallAssessmentState =
  | "strong"
  | "leading_mixed"
  | "leading_softening"
  | "improving"
  | "middle"
  | "weak"
  | "unknown";

export interface AssessmentDimension<State extends string> {
  state: State;
  label: string;
  tone: AssessmentTone;
  evidence: string;
}

export interface MetricAssessment {
  metricId: string;
  label: string;
  tone: AssessmentTone;
  position: PositionState;
  momentum: MomentumState;
  peerPercentile: number | null;
  trackedPercentile: number | null;
  positionEvidence: string;
  momentumEvidence: string;
  summary: string;
}

export interface ChainAssessment {
  modelVersion: "benchmark-v1";
  decisionQuestion: "ecosystem_fundamentals";
  overallState: OverallAssessmentState;
  headline: string;
  position: AssessmentDimension<PositionState>;
  momentum: AssessmentDimension<MomentumState | "mixed">;
  quality: AssessmentDimension<QualityState>;
  confidence: AssessmentDimension<ConfidenceState>;
  metrics: MetricAssessment[];
  caveats: string[];
}

export interface QualitySummary {
  okMetrics: number;
  staleMetrics: number;
  unavailableMetrics: number;
  failedSources: number;
  alerts: string[];
}

export interface DashboardSnapshot {
  schemaVersion: 1 | 2;
  runId: string;
  generatedAt: string;
  targetDate: string;
  timezone: "UTC";
  chain: {
    id: "robinhood";
    name: "Robinhood Chain";
    chainId: 4663;
    launchDate: string;
  };
  verdict: string;
  metrics: MetricSnapshot[];
  stockTokens: StockTokenSnapshot;
  networkHealth: NetworkHealth;
  pillars: PillarState[];
  insights: Insight[];
  assessment?: ChainAssessment;
  quality: QualitySummary;
  sources: SourceReceipt[];
}

export interface RawBundle {
  [sourceId: string]: unknown;
}
