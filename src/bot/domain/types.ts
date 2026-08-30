import type {
  Comparability,
  MetricName,
  MetricQuality,
  PlatformStat,
  PlatformStatus,
  SourceHealth,
  WindowDays,
} from "../../domain/types.js";

export type UnknownReason =
  | "NO_OBSERVATION"
  | "SOURCE_NOT_REPORTING"
  | "SOURCE_FAILED"
  | "STALE_WITHOUT_CURRENT_VALUE"
  | "SCOPE_NOT_COMPARABLE"
  | "VERSION_NOT_AVAILABLE"
  | "PLATFORM_NOT_SUPPORTED"
  | "CONTRACT_INCOMPATIBLE";

export type BotAnswerStatus = "ok" | "clarification" | "degraded" | "unavailable" | "unsupported";

export type BotWarningCode =
  | "NO_AVAILABLE_DATA"
  | "CONTRACT_INCOMPATIBLE"
  | "LATEST_REFRESH_FAILED"
  | "STALE"
  | "SOURCE_FAILED"
  | "SOURCE_DEGRADED"
  | "PARTIAL"
  | "SCOPE_MISMATCH"
  | "SUITE_WIDE"
  | "DERIVED"
  | "INFO";

export interface BotWarning {
  code: BotWarningCode;
  message: string;
  priority: number;
}

export interface BotEvidence {
  targetDate: string | null;
  generatedAt: string;
  runStatus: string;
  stale: boolean;
}

export interface BotAnswer {
  status: BotAnswerStatus;
  title: string;
  bodyLines: string[];
  warnings: BotWarning[];
  suggestedCommands: string[];
  detailUrl: string | null;
  evidence: BotEvidence | null;
}

export interface BotMetricView {
  metric: MetricName;
  value: number | null;
  observedDays: number;
  windowDays: number;
  coverage: number;
  latestDate: string | null;
  sources: string[];
  qualities: MetricQuality[];
  scope: string;
  comparability: Comparability;
  excludeFromTotals: boolean;
  unknownReason: UnknownReason | null;
}

export interface BotPlatformView {
  id: string;
  name: string;
  status: PlatformStatus;
  scope: string;
  notes: string[];
  comparability: Comparability;
  excludeFromTotals: boolean;
  metrics: Record<MetricName, BotMetricView>;
  stats: PlatformStat[];
}

export interface BotDataContext {
  targetDate: string;
  generatedAt: string;
  runStatus: string;
  stale: boolean;
  warnings: string[];
  sources: SourceHealth[];
  windowDays: WindowDays;
}
