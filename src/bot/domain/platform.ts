import type { OverviewResponse, PlatformDetailResponse, SourceHealth } from "../../domain/types.js";
import type { BotPlatformView } from "./types.js";
import { platformView } from "../ledger/view.js";

export interface PlatformResult {
  platform: BotPlatformView;
  requestedWindowDays: number;
  targetDate: string;
  generatedAt: string;
  runStatus: string;
  stale: boolean;
  warnings: string[];
  sources: SourceHealth[];
}

export function buildPlatformResult(
  overview: OverviewResponse,
  detail: PlatformDetailResponse,
  sources: SourceHealth[],
): PlatformResult | null {
  const platform = platformView(overview, detail.platform.id, detail, sources);
  if (!platform) return null;
  return {
    platform,
    requestedWindowDays: overview.windowDays,
    targetDate: overview.targetDate,
    generatedAt: overview.generatedAt,
    runStatus: overview.runStatus,
    stale: overview.stale,
    warnings: [...overview.warnings],
    sources: sources.map((source) => ({ ...source })),
  };
}
