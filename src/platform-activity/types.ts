import type { MetricQuality } from "../domain/types.js";

export const PLATFORM_ACTIVITY_IDS = ["pons", "pair", "long"] as const;
export const PLATFORM_ACTIVITY_WINDOWS = [7, 30] as const;

export type PlatformActivityId = (typeof PLATFORM_ACTIVITY_IDS)[number];
export type PlatformActivityWindowDays = (typeof PLATFORM_ACTIVITY_WINDOWS)[number];
export type PlatformVolumeWindow = "7d" | "30d" | "lifetime";
export type PlatformActivityStatus =
  | "available"
  | "building_window"
  | "building_baseline"
  | "partial"
  | "unknown";
export type PlatformActivityBand = "quiet" | "normal" | "active" | "unusually_active" | "unknown";

export interface PlatformDailyVolumePoint {
  date: string;
  valueUsd: number | null;
  rawValueUsd: number | null;
  cumulativeObservedUsd: number;
  state: "observed" | "missing" | "suspect";
}

export interface PlatformVolumeSummary {
  window: PlatformVolumeWindow;
  startDate: string | null;
  endDate: string;
  valueUsd: number | null;
  observedValueUsd: number | null;
  reportedAllTimeUsd: number | null;
  averageDailyUsd: number | null;
  observedDays: number;
  expectedDays: number;
  coverage: number;
  status: "available" | "partial" | "unknown";
  valueKind: "daily_sum" | "reported_all_time" | "observed_lower_bound" | "unknown";
}

export interface PlatformActivityPoint {
  date: string;
  windowDays: PlatformActivityWindowDays;
  windowStart: string;
  averageDailyVolumeUsd: number | null;
  baselineMedianDailyVolumeUsd: number | null;
  baselineObservationCount: number;
  baselineRequired: number;
  multiple: number | null;
  percentile: number | null;
  band: PlatformActivityBand;
  status: PlatformActivityStatus;
  observedDays: number;
  expectedDays: number;
}

export interface PlatformActivitySeries {
  windowDays: PlatformActivityWindowDays;
  current: PlatformActivityPoint | null;
  latestAvailable: PlatformActivityPoint | null;
  points: PlatformActivityPoint[];
}

export interface PlatformActivityPlatformView {
  platformId: PlatformActivityId;
  platformName: string;
  scope: string;
  firstObservedDate: string | null;
  lastObservedDate: string | null;
  latestUsableDate: string | null;
  observedDays: number;
  calendarDays: number;
  historyCoverage: number;
  sources: string[];
  qualities: MetricQuality[];
  daily: PlatformDailyVolumePoint[];
  volumes: Record<PlatformVolumeWindow, PlatformVolumeSummary>;
  activity: Record<"7d" | "30d", PlatformActivitySeries>;
}

export interface PlatformVolumeComparison {
  window: PlatformVolumeWindow;
  state: "available" | "partial" | "not_comparable";
  totalUsd: number | null;
  sharesPercent: Record<PlatformActivityId, number | null>;
  note: string;
}

export interface PlatformActivityResponse {
  service: "rhc-platform-activity";
  modelVersion: "platform-activity-v1";
  targetDate: string;
  generatedAt: string;
  stale: boolean;
  runStatus: string;
  benchmark: {
    formula: string;
    baselineMaximumObservations: number;
    baselineMinimumObservations: number;
    baselineMeaning: string;
    bands: Record<Exclude<PlatformActivityBand, "unknown">, string>;
  };
  platforms: PlatformActivityPlatformView[];
  comparisons: Record<PlatformVolumeWindow, PlatformVolumeComparison>;
  warnings: string[];
}
