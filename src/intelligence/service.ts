import type { EconomicsResponse, TokenDailyCandle } from "../economics/types.js";
import type { LongLeaderboardResponse } from "../long-tokens/types.js";
import type { PairLeaderboardResponse } from "../pair/types.js";
import type { PlatformActivityResponse } from "../platform-activity/types.js";
import type { IntelligenceSettings } from "./config.js";
import { buildIntelligence, type ExternalIntelligenceInput } from "./model.js";
import type { IntelligenceResponse } from "./types.js";

export interface IntelligenceEconomicsProvider {
  snapshot(): EconomicsResponse | null;
  ponsPriceHistory(): TokenDailyCandle[];
}

export interface IntelligenceDashboardProvider {
  platformActivity(): PlatformActivityResponse;
}

export interface IntelligencePairProvider {
  rankings(): PairLeaderboardResponse;
}

export interface IntelligenceLongProvider {
  rankings(): LongLeaderboardResponse;
}

export interface IntelligenceServiceDependencies {
  economics: IntelligenceEconomicsProvider;
  pair: IntelligencePairProvider;
  long: IntelligenceLongProvider;
  dashboard: IntelligenceDashboardProvider;
  fetcher?: typeof fetch;
  now?: () => Date;
  warn?: (event: string, context: Record<string, unknown>) => void;
}

async function fetchJson(
  url: string,
  timeoutMs: number,
  fetcher: typeof fetch,
): Promise<ExternalIntelligenceInput> {
  try {
    const response = await fetcher(url, {
      method: "GET",
      redirect: "error",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { payload: null, status: "failed" };
    const payload: unknown = await response.json();
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return { payload: null, status: "failed" };
    }
    return { payload, status: "ok" };
  } catch {
    return { payload: null, status: "failed" };
  }
}

export class IntelligenceService {
  private cached: IntelligenceResponse | null = null;
  private refreshedAt: number | null = null;
  private refreshPromise: Promise<IntelligenceResponse> | null = null;
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;
  private readonly warn: (event: string, context: Record<string, unknown>) => void;

  constructor(
    private readonly settings: IntelligenceSettings,
    private readonly dependencies: IntelligenceServiceDependencies,
  ) {
    this.fetcher = dependencies.fetcher ?? fetch;
    this.now = dependencies.now ?? (() => new Date());
    this.warn = dependencies.warn ?? ((event, context) => console.warn(event, context));
  }

  async ensureFresh(): Promise<IntelligenceResponse> {
    const age =
      this.refreshedAt === null
        ? Number.POSITIVE_INFINITY
        : this.now().valueOf() - this.refreshedAt;
    if (this.cached && age < this.settings.refreshTtlMinutes * 60_000) return this.cached;
    return this.refresh();
  }

  refresh(): Promise<IntelligenceResponse> {
    if (this.refreshPromise) return this.refreshPromise;
    const promise = this.refreshNow().finally(() => {
      this.refreshPromise = null;
    });
    this.refreshPromise = promise;
    return promise;
  }

  private async refreshNow(): Promise<IntelligenceResponse> {
    const [chain, cashcat] = await Promise.all([
      fetchJson(this.settings.chainRadarUrl, this.settings.requestTimeoutMs, this.fetcher),
      fetchJson(this.settings.cashcatStatusUrl, this.settings.requestTimeoutMs, this.fetcher),
    ]);
    const now = this.now();
    try {
      const snapshot = buildIntelligence({
        now,
        chain,
        cashcat,
        economics: this.dependencies.economics.snapshot(),
        pair: this.dependencies.pair.rankings(),
        long: this.dependencies.long.rankings(),
        platformActivity: this.dependencies.dashboard.platformActivity(),
        ponsPriceHistory: this.dependencies.economics.ponsPriceHistory(),
      });
      this.cached = snapshot;
      this.refreshedAt = now.valueOf();
      return snapshot;
    } catch (error) {
      this.warn("intelligence_refresh_failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      if (this.cached) return this.cached;
      throw error;
    }
  }

  snapshot(): IntelligenceResponse | null {
    return this.cached;
  }

  health() {
    return {
      ok: Boolean(this.cached),
      service: "rhc-market-intelligence" as const,
      status: this.cached?.status ?? "unavailable",
      generatedAt: this.cached?.generatedAt ?? null,
      refreshTtlMinutes: this.settings.refreshTtlMinutes,
    };
  }
}
