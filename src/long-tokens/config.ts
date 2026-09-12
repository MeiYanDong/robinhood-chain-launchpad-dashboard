export interface LongTokenSettings {
  marketCapFloorUsd: number;
  liquidityDepthFloorUsd: number;
  marketFreshnessMinutes: number;
  refreshTtlMinutes: number;
  staleAfterMinutes: number;
  gmgnBinary: string;
  gmgnTimeoutMs: number;
}

export const DEFAULT_LONG_TOKEN_SETTINGS: LongTokenSettings = {
  marketCapFloorUsd: 10_000,
  liquidityDepthFloorUsd: 1_000,
  marketFreshnessMinutes: 60,
  refreshTtlMinutes: 15,
  staleAfterMinutes: 45,
  gmgnBinary: "gmgn-cli",
  gmgnTimeoutMs: 30_000,
};

function positiveNumber(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be positive`);
  return parsed;
}

export function longTokenSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): LongTokenSettings {
  return {
    ...DEFAULT_LONG_TOKEN_SETTINGS,
    marketCapFloorUsd: positiveNumber(
      env.LONG_ACTIVE_MCAP_FLOOR_USD,
      DEFAULT_LONG_TOKEN_SETTINGS.marketCapFloorUsd,
      "LONG_ACTIVE_MCAP_FLOOR_USD",
    ),
    liquidityDepthFloorUsd: positiveNumber(
      env.LONG_ACTIVE_DEPTH_FLOOR_USD,
      DEFAULT_LONG_TOKEN_SETTINGS.liquidityDepthFloorUsd,
      "LONG_ACTIVE_DEPTH_FLOOR_USD",
    ),
    marketFreshnessMinutes: positiveNumber(
      env.LONG_MARKET_FRESHNESS_MINUTES,
      DEFAULT_LONG_TOKEN_SETTINGS.marketFreshnessMinutes,
      "LONG_MARKET_FRESHNESS_MINUTES",
    ),
    refreshTtlMinutes: positiveNumber(
      env.LONG_REFRESH_TTL_MINUTES,
      DEFAULT_LONG_TOKEN_SETTINGS.refreshTtlMinutes,
      "LONG_REFRESH_TTL_MINUTES",
    ),
    staleAfterMinutes: positiveNumber(
      env.LONG_STALE_AFTER_MINUTES,
      DEFAULT_LONG_TOKEN_SETTINGS.staleAfterMinutes,
      "LONG_STALE_AFTER_MINUTES",
    ),
    gmgnBinary: env.LONG_GMGN_BIN?.trim() || DEFAULT_LONG_TOKEN_SETTINGS.gmgnBinary,
    gmgnTimeoutMs: positiveNumber(
      env.LONG_GMGN_TIMEOUT_MS,
      DEFAULT_LONG_TOKEN_SETTINGS.gmgnTimeoutMs,
      "LONG_GMGN_TIMEOUT_MS",
    ),
  };
}
