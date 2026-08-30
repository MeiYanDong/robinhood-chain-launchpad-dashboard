import { CORE_METRICS } from "../../domain/types.js";
import type {
  LedgerMetaResponse,
  MetricName,
  MetricQuality,
  MetricWindowValue,
  OverviewResponse,
  PlatformDetailResponse,
  MetricPolicy,
  PlatformOverviewRow,
  SourceHealth,
  WindowDays,
} from "../../domain/types.js";
import { BotError } from "../errors.js";

export interface LedgerHealthResponse {
  ok: boolean;
  service: string;
  targetDate: string | null;
  latestRunStatus: string;
  generatedAt: string;
}

export interface LedgerRunView {
  id: number;
  startedAt: string;
  completedAt: string | null;
  targetDate: string;
  status: "running" | "success" | "partial" | "failed";
  warnings: string[];
  error: null;
}

export interface LedgerSourcesResponse {
  generatedAt: string;
  usableRun: LedgerRunView | null;
  latestRun: LedgerRunView | null;
  sources: SourceHealth[];
}

export interface LedgerCoverageResponse {
  targetDate: string;
  generatedAt: string;
  definitions: Record<MetricName, string>;
  caveats: string[];
  platforms: Array<{
    id: string;
    name: string;
    comparability: string;
    excludeFromTotals: boolean;
    scope: string;
    notes: string[];
    metrics: Record<MetricName, MetricWindowValue>;
    metricPolicies: Partial<Record<MetricName, MetricPolicy>>;
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contractFail(): never {
  throw new BotError("CONTRACT_INCOMPATIBLE");
}

function string(value: unknown): value is string {
  return typeof value === "string";
}

function nullableString(value: unknown): value is string | null {
  return value === null || string(value);
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(string);
}

function validDate(value: unknown): value is string {
  return string(value) && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

const QUALITIES = new Set<MetricQuality>([
  "reported",
  "derived",
  "partial",
  "scope_mismatch",
  "suite_wide",
  "unknown",
]);
const PLATFORM_STATUSES = new Set(["live", "tracked", "activity_only", "historical", "unknown"]);
const COMPARABILITIES = new Set([
  "comparable",
  "partial",
  "scope_mismatch",
  "suite_wide",
  "unknown",
]);
const STAT_UNITS = new Set(["ETH", "USD", "count", "token"]);
const STAT_PERIODS = new Set(["rolling_24h", "all_time", "current"]);

function validTimestamp(value: unknown): value is string {
  return string(value) && Number.isFinite(Date.parse(value));
}

function nullableDate(value: unknown): value is string | null {
  return value === null || validDate(value);
}

function validateMetricPolicies(value: unknown): void {
  if (!isRecord(value)) contractFail();
  for (const [metric, policy] of Object.entries(value)) {
    if (!CORE_METRICS.includes(metric as MetricName) || !isRecord(policy)) contractFail();
    if (
      !QUALITIES.has(policy.quality as MetricQuality) ||
      !string(policy.scope) ||
      (policy.note !== undefined && !string(policy.note))
    )
      contractFail();
  }
}

function validateSourceLinks(value: unknown): void {
  if (!Array.isArray(value)) contractFail();
  for (const link of value) {
    if (
      !isRecord(link) ||
      !string(link.label) ||
      !string(link.url) ||
      !/^https:\/\//.test(link.url) ||
      !["official", "adapter", "methodology", "explorer"].includes(link.kind as string)
    )
      contractFail();
  }
}

function validateMetricWindow(value: unknown, expectedWindow?: number): MetricWindowValue {
  if (!isRecord(value)) contractFail();
  if (value.value !== null && (typeof value.value !== "number" || !Number.isFinite(value.value)))
    contractFail();
  if (
    typeof value.observedDays !== "number" ||
    !Number.isInteger(value.observedDays) ||
    value.observedDays < 0 ||
    typeof value.windowDays !== "number" ||
    !Number.isInteger(value.windowDays) ||
    value.windowDays < 0 ||
    value.observedDays > value.windowDays ||
    (expectedWindow !== undefined && value.windowDays !== expectedWindow) ||
    typeof value.coverage !== "number" ||
    value.coverage < 0 ||
    value.coverage > 1 ||
    !nullableDate(value.latestDate) ||
    !stringArray(value.sources) ||
    !Array.isArray(value.qualities) ||
    !value.qualities.every((quality) => QUALITIES.has(quality as MetricQuality))
  )
    contractFail();
  return value as unknown as MetricWindowValue;
}

function validateMetricRecord(
  value: unknown,
  expectedWindow?: number,
): Record<MetricName, MetricWindowValue> {
  if (!isRecord(value)) contractFail();
  const result = {} as Record<MetricName, MetricWindowValue>;
  for (const metric of CORE_METRICS)
    result[metric] = validateMetricWindow(value[metric], expectedWindow);
  return result;
}

function validatePlatformRow(value: unknown, windowDays: WindowDays): PlatformOverviewRow {
  if (!isRecord(value)) contractFail();
  if (
    !string(value.id) ||
    !/^[a-z0-9-]+$/.test(value.id) ||
    !string(value.name) ||
    !PLATFORM_STATUSES.has(value.status as string) ||
    !COMPARABILITIES.has(value.comparability as string) ||
    typeof value.excludeFromTotals !== "boolean" ||
    !string(value.scope) ||
    !stringArray(value.notes)
  )
    contractFail();
  validateMetricRecord(value.metrics, windowDays);
  return value as unknown as PlatformOverviewRow;
}

export function validateMeta(value: unknown): LedgerMetaResponse {
  if (!isRecord(value)) contractFail();
  if (value.apiContractVersion !== 1) throw new BotError("VERSION_NOT_AVAILABLE");
  const supportedWindows = value.supportedWindows;
  const coreMetrics = value.coreMetrics;
  if (
    value.service !== "rhc-launch-ledger" ||
    !string(value.appVersion) ||
    !nullableDate(value.targetDate) ||
    !Array.isArray(supportedWindows) ||
    supportedWindows.length !== 3 ||
    ![1, 7, 30].every((window) => supportedWindows.includes(window)) ||
    !Array.isArray(coreMetrics) ||
    coreMetrics.length !== CORE_METRICS.length ||
    !CORE_METRICS.every((metric) => coreMetrics.includes(metric)) ||
    !Array.isArray(value.platforms)
  )
    contractFail();
  for (const platform of value.platforms) {
    if (
      !isRecord(platform) ||
      !string(platform.id) ||
      !/^[a-z0-9-]+$/.test(platform.id) ||
      !PLATFORM_STATUSES.has(platform.status as string) ||
      !Array.isArray(platform.supportedMetrics) ||
      !platform.supportedMetrics.every((metric) => CORE_METRICS.includes(metric as MetricName)) ||
      typeof platform.hasRollingStats !== "boolean"
    )
      contractFail();
  }
  return value as unknown as LedgerMetaResponse;
}

export function validateHealth(value: unknown): LedgerHealthResponse {
  if (
    !isRecord(value) ||
    typeof value.ok !== "boolean" ||
    value.service !== "rhc-launch-ledger" ||
    !nullableDate(value.targetDate) ||
    !string(value.latestRunStatus) ||
    !validTimestamp(value.generatedAt)
  )
    contractFail();
  return value as unknown as LedgerHealthResponse;
}

export function validateOverview(value: unknown, expectedWindow: WindowDays): OverviewResponse {
  if (
    !isRecord(value) ||
    !validDate(value.targetDate) ||
    value.windowDays !== expectedWindow ||
    !validTimestamp(value.generatedAt) ||
    typeof value.stale !== "boolean" ||
    !string(value.runStatus) ||
    !stringArray(value.warnings) ||
    !Array.isArray(value.platforms) ||
    !isRecord(value.summary)
  )
    contractFail();
  for (const platform of value.platforms) validatePlatformRow(platform, expectedWindow);
  validateMetricRecord(value.summary);
  if (
    !Number.isInteger(value.summary.activePlatforms) ||
    !Number.isInteger(value.summary.eligiblePlatforms)
  )
    contractFail();
  return value as unknown as OverviewResponse;
}

export function validatePlatform(value: unknown, expectedId: string): PlatformDetailResponse {
  if (
    !isRecord(value) ||
    !isRecord(value.platform) ||
    value.platform.id !== expectedId ||
    !validDate(value.targetDate) ||
    !validTimestamp(value.generatedAt) ||
    !isRecord(value.series) ||
    !isRecord(value.coverage) ||
    !Array.isArray(value.stats) ||
    !string(value.platform.name) ||
    !Array.isArray(value.platform.aliases) ||
    !value.platform.aliases.every(string) ||
    !PLATFORM_STATUSES.has(value.platform.status as string) ||
    !COMPARABILITIES.has(value.platform.comparability as string) ||
    typeof value.platform.excludeFromTotals !== "boolean" ||
    !string(value.platform.scope) ||
    !stringArray(value.platform.notes) ||
    !Array.isArray(value.platform.sourceLinks) ||
    !isRecord(value.platform.metricPolicies)
  )
    contractFail();
  validateSourceLinks(value.platform.sourceLinks);
  validateMetricPolicies(value.platform.metricPolicies);
  for (const metric of CORE_METRICS) {
    if (!Array.isArray(value.series[metric])) contractFail();
    for (const point of value.series[metric]) {
      if (
        !isRecord(point) ||
        !validDate(point.date) ||
        typeof point.value !== "number" ||
        !Number.isFinite(point.value)
      )
        contractFail();
    }
    validateMetricWindow(value.coverage[metric], 64);
  }
  for (const stat of value.stats) {
    if (
      !isRecord(stat) ||
      stat.platformId !== expectedId ||
      !string(stat.key) ||
      !string(stat.label) ||
      typeof stat.value !== "number" ||
      !Number.isFinite(stat.value) ||
      !STAT_UNITS.has(stat.unit as string) ||
      !STAT_PERIODS.has(stat.period as string) ||
      !string(stat.source) ||
      !QUALITIES.has(stat.quality as MetricQuality) ||
      !string(stat.scope) ||
      !nullableString(stat.derivation) ||
      !validTimestamp(stat.collectedAt)
    )
      contractFail();
  }
  return value as unknown as PlatformDetailResponse;
}

function validateRun(value: unknown): LedgerRunView | null {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    !Number.isInteger(value.id) ||
    !validTimestamp(value.startedAt) ||
    !(value.completedAt === null || validTimestamp(value.completedAt)) ||
    !validDate(value.targetDate) ||
    !["running", "success", "partial", "failed"].includes(value.status as string) ||
    !stringArray(value.warnings) ||
    value.error !== null
  )
    contractFail();
  return value as unknown as LedgerRunView;
}

export function validateSources(value: unknown): LedgerSourcesResponse {
  if (!isRecord(value) || !validTimestamp(value.generatedAt) || !Array.isArray(value.sources))
    contractFail();
  validateRun(value.usableRun);
  validateRun(value.latestRun);
  for (const source of value.sources) {
    if (
      !isRecord(source) ||
      !string(source.source) ||
      !["ok", "degraded", "failed"].includes(source.status as string) ||
      !validTimestamp(source.fetchedAt) ||
      !nullableDate(source.latestDataDate) ||
      typeof source.latencyMs !== "number" ||
      !Number.isInteger(source.latencyMs) ||
      source.latencyMs < 0 ||
      !string(source.message)
    )
      contractFail();
  }
  return value as unknown as LedgerSourcesResponse;
}

export function validateCoverage(value: unknown): LedgerCoverageResponse {
  if (!isRecord(value)) contractFail();
  const definitions = value.definitions;
  if (
    !validDate(value.targetDate) ||
    !validTimestamp(value.generatedAt) ||
    !isRecord(definitions) ||
    !CORE_METRICS.every((metric) => string(definitions[metric])) ||
    !stringArray(value.caveats) ||
    !Array.isArray(value.platforms)
  )
    contractFail();
  for (const platform of value.platforms) {
    if (
      !isRecord(platform) ||
      !string(platform.id) ||
      !/^[a-z0-9-]+$/.test(platform.id) ||
      !string(platform.name) ||
      !COMPARABILITIES.has(platform.comparability as string) ||
      typeof platform.excludeFromTotals !== "boolean" ||
      !string(platform.scope) ||
      !stringArray(platform.notes)
    )
      contractFail();
    validateMetricRecord(platform.metrics);
    validateMetricPolicies(platform.metricPolicies);
  }
  return value as unknown as LedgerCoverageResponse;
}
