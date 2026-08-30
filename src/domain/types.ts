export const CORE_METRICS = [
  "volume_usd",
  "fees_usd",
  "protocol_revenue_usd",
  "revenue_usd",
] as const;

export type CoreMetricName = (typeof CORE_METRICS)[number];
export type MetricName = CoreMetricName;
export type WindowDays = 1 | 7 | 30;

export type Comparability =
  | "comparable"
  | "partial"
  | "scope_mismatch"
  | "suite_wide"
  | "unknown";

export type PlatformStatus =
  | "live"
  | "tracked"
  | "activity_only"
  | "historical"
  | "unknown";

export type MetricQuality =
  | "reported"
  | "derived"
  | "partial"
  | "scope_mismatch"
  | "suite_wide"
  | "unknown";

export interface SourceLink {
  label: string;
  url: string;
  kind: "official" | "adapter" | "methodology" | "explorer";
}

export interface MetricPolicy {
  quality: MetricQuality;
  scope: string;
  note?: string;
}

export interface PlatformConfig {
  id: string;
  name: string;
  aliases: string[];
  website?: string;
  status: PlatformStatus;
  comparability: Comparability;
  excludeFromTotals: boolean;
  scope: string;
  notes: string[];
  sourceLinks: SourceLink[];
  metricPolicies: Partial<Record<MetricName, MetricPolicy>>;
}

export interface DailyMetric {
  platformId: string;
  metric: MetricName;
  date: string;
  value: number;
  source: string;
  quality: MetricQuality;
  scope: string;
  derivation: string | null;
  collectedAt: string;
}

export interface SourceHealth {
  source: string;
  status: "ok" | "degraded" | "failed";
  fetchedAt: string;
  latestDataDate: string | null;
  latencyMs: number;
  message: string;
}

export interface RawObservation {
  source: string;
  fetchedAt: string;
  sha256: string;
  payload: unknown;
}

export type PlatformStatUnit = "ETH" | "USD" | "count" | "token";
export type PlatformStatPeriod = "rolling_24h" | "all_time" | "current";

export interface PlatformStat {
  platformId: string;
  key: string;
  label: string;
  value: number;
  unit: PlatformStatUnit;
  period: PlatformStatPeriod;
  source: string;
  quality: MetricQuality;
  scope: string;
  derivation: string | null;
  collectedAt: string;
}

export interface CollectionBatch {
  platforms: PlatformConfig[];
  metrics: DailyMetric[];
  stats: PlatformStat[];
  sourceHealth: SourceHealth[];
  raw: RawObservation[];
  warnings: string[];
}

export interface MetricWindowValue {
  value: number | null;
  observedDays: number;
  windowDays: number;
  coverage: number;
  latestDate: string | null;
  sources: string[];
  qualities: MetricQuality[];
}

export interface PlatformOverviewRow {
  id: string;
  name: string;
  status: PlatformStatus;
  comparability: Comparability;
  excludeFromTotals: boolean;
  scope: string;
  notes: string[];
  metrics: Record<MetricName, MetricWindowValue>;
}

export interface OverviewResponse {
  targetDate: string;
  windowDays: WindowDays;
  generatedAt: string;
  stale: boolean;
  runStatus: string;
  summary: Record<MetricName, MetricWindowValue> & {
    activePlatforms: number;
    eligiblePlatforms: number;
  };
  platforms: PlatformOverviewRow[];
  warnings: string[];
}

export interface PlatformDetailResponse {
  platform: PlatformConfig;
  targetDate: string;
  generatedAt: string;
  series: Record<MetricName, Array<{ date: string; value: number }>>;
  coverage: Record<MetricName, MetricWindowValue>;
  stats: PlatformStat[];
}
