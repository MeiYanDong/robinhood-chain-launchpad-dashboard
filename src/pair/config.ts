export interface PairTokenSettings {
  apiBaseUrl: string;
  pageLimit: number;
  maxPages: number;
  pageConcurrency: number;
  marketCapFloorUsd: number;
  liquidityDepthFloorUsd: number;
  marketFreshnessMinutes: number;
  refreshTtlMinutes: number;
  staleAfterMinutes: number;
  holderTtlMinutes: number;
  holderMaxStaleMinutes: number;
  gmgnBinary: string;
  gmgnTimeoutMs: number;
}

export const DEFAULT_PAIR_TOKEN_SETTINGS: PairTokenSettings = {
  apiBaseUrl: "https://pair.fund/api",
  pageLimit: 50,
  maxPages: 100,
  pageConcurrency: 4,
  marketCapFloorUsd: 10_000,
  liquidityDepthFloorUsd: 1_000,
  marketFreshnessMinutes: 60,
  refreshTtlMinutes: 15,
  staleAfterMinutes: 45,
  holderTtlMinutes: 60,
  holderMaxStaleMinutes: 150,
  gmgnBinary: "gmgn-cli",
  gmgnTimeoutMs: 20_000,
};

function positiveNumber(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be positive`);
  return parsed;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = positiveNumber(value, fallback, name);
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer`);
  return parsed;
}

export function pairTokenSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): PairTokenSettings {
  const settings: PairTokenSettings = {
    ...DEFAULT_PAIR_TOKEN_SETTINGS,
    marketCapFloorUsd: positiveNumber(
      env.PAIR_ACTIVE_MCAP_FLOOR_USD,
      DEFAULT_PAIR_TOKEN_SETTINGS.marketCapFloorUsd,
      "PAIR_ACTIVE_MCAP_FLOOR_USD",
    ),
    liquidityDepthFloorUsd: positiveNumber(
      env.PAIR_ACTIVE_DEPTH_FLOOR_USD,
      DEFAULT_PAIR_TOKEN_SETTINGS.liquidityDepthFloorUsd,
      "PAIR_ACTIVE_DEPTH_FLOOR_USD",
    ),
    marketFreshnessMinutes: positiveNumber(
      env.PAIR_MARKET_FRESHNESS_MINUTES,
      DEFAULT_PAIR_TOKEN_SETTINGS.marketFreshnessMinutes,
      "PAIR_MARKET_FRESHNESS_MINUTES",
    ),
    refreshTtlMinutes: positiveNumber(
      env.PAIR_REFRESH_TTL_MINUTES,
      DEFAULT_PAIR_TOKEN_SETTINGS.refreshTtlMinutes,
      "PAIR_REFRESH_TTL_MINUTES",
    ),
    holderTtlMinutes: positiveNumber(
      env.PAIR_HOLDER_TTL_MINUTES,
      DEFAULT_PAIR_TOKEN_SETTINGS.holderTtlMinutes,
      "PAIR_HOLDER_TTL_MINUTES",
    ),
    holderMaxStaleMinutes: positiveNumber(
      env.PAIR_HOLDER_MAX_STALE_MINUTES,
      DEFAULT_PAIR_TOKEN_SETTINGS.holderMaxStaleMinutes,
      "PAIR_HOLDER_MAX_STALE_MINUTES",
    ),
    gmgnTimeoutMs: positiveInteger(
      env.PAIR_GMGN_TIMEOUT_MS,
      DEFAULT_PAIR_TOKEN_SETTINGS.gmgnTimeoutMs,
      "PAIR_GMGN_TIMEOUT_MS",
    ),
    gmgnBinary: env.PAIR_GMGN_BIN?.trim() || DEFAULT_PAIR_TOKEN_SETTINGS.gmgnBinary,
  };

  if (settings.holderMaxStaleMinutes < settings.holderTtlMinutes) {
    throw new Error("PAIR_HOLDER_MAX_STALE_MINUTES must be >= PAIR_HOLDER_TTL_MINUTES");
  }
  return settings;
}
