export interface EconomicsSettings {
  pairTokenApiUrl: string;
  ponsTokenAddress: string;
  pairTokenAddress: string;
  deadAddress: string;
  ponsTokenUrl: string;
  pairTokenUrl: string;
  rpcUrl: string;
  rpcFallbackUrls?: string[];
  gmgnBinary: string;
  gmgnTimeoutMs: number;
  priceHistoryDays: number;
  priceHistoryTtlMinutes: number;
  requestTimeoutMs: number;
  refreshTtlMinutes: number;
  staleAfterMinutes: number;
}

export const DEFAULT_ECONOMICS_SETTINGS: EconomicsSettings = {
  pairTokenApiUrl: "https://pair.fund/api/tokens/0x6b1d42927b1a84ec28fa88d4fc6fa7af404966be",
  ponsTokenAddress: "0x39dbed3a2bd333467115de45665cc57f813c4571",
  pairTokenAddress: "0x6b1d42927b1a84ec28fa88d4fc6fa7af404966be",
  deadAddress: "0x000000000000000000000000000000000000dead",
  ponsTokenUrl: "https://gmgn.ai/robinhood/token/0x39dbed3a2bd333467115de45665cc57f813c4571",
  pairTokenUrl: "https://pair.fund/tokens/0x6b1d42927b1a84ec28fa88d4fc6fa7af404966be",
  rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
  gmgnBinary: "gmgn-cli",
  gmgnTimeoutMs: 20_000,
  priceHistoryDays: 120,
  priceHistoryTtlMinutes: 60,
  requestTimeoutMs: 20_000,
  refreshTtlMinutes: 15,
  staleAfterMinutes: 45,
};

function positiveNumber(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be positive`);
  return parsed;
}

export function economicsSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): EconomicsSettings {
  return {
    ...DEFAULT_ECONOMICS_SETTINGS,
    rpcUrl: env.ECONOMICS_RPC_URL?.trim() || DEFAULT_ECONOMICS_SETTINGS.rpcUrl,
    rpcFallbackUrls: [
      ...new Set(
        (env.ECONOMICS_RPC_FALLBACK_URLS ?? "")
          .split(",")
          .map((url) => url.trim())
          .filter(Boolean),
      ),
    ].slice(0, 2),
    gmgnBinary: env.ECONOMICS_GMGN_BIN?.trim() || DEFAULT_ECONOMICS_SETTINGS.gmgnBinary,
    gmgnTimeoutMs: positiveNumber(
      env.ECONOMICS_GMGN_TIMEOUT_MS,
      DEFAULT_ECONOMICS_SETTINGS.gmgnTimeoutMs,
      "ECONOMICS_GMGN_TIMEOUT_MS",
    ),
    priceHistoryDays: positiveNumber(
      env.ECONOMICS_PRICE_HISTORY_DAYS,
      DEFAULT_ECONOMICS_SETTINGS.priceHistoryDays,
      "ECONOMICS_PRICE_HISTORY_DAYS",
    ),
    priceHistoryTtlMinutes: positiveNumber(
      env.ECONOMICS_PRICE_HISTORY_TTL_MINUTES,
      DEFAULT_ECONOMICS_SETTINGS.priceHistoryTtlMinutes,
      "ECONOMICS_PRICE_HISTORY_TTL_MINUTES",
    ),
    requestTimeoutMs: positiveNumber(
      env.ECONOMICS_REQUEST_TIMEOUT_MS,
      DEFAULT_ECONOMICS_SETTINGS.requestTimeoutMs,
      "ECONOMICS_REQUEST_TIMEOUT_MS",
    ),
    refreshTtlMinutes: positiveNumber(
      env.ECONOMICS_REFRESH_TTL_MINUTES,
      DEFAULT_ECONOMICS_SETTINGS.refreshTtlMinutes,
      "ECONOMICS_REFRESH_TTL_MINUTES",
    ),
    staleAfterMinutes: positiveNumber(
      env.ECONOMICS_STALE_AFTER_MINUTES,
      DEFAULT_ECONOMICS_SETTINGS.staleAfterMinutes,
      "ECONOMICS_STALE_AFTER_MINUTES",
    ),
  };
}
