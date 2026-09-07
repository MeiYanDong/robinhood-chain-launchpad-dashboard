export interface IntelligenceSettings {
  chainRadarUrl: string;
  cashcatStatusUrl: string;
  requestTimeoutMs: number;
  refreshTtlMinutes: number;
}

export const DEFAULT_INTELLIGENCE_SETTINGS: IntelligenceSettings = {
  chainRadarUrl: "http://127.0.0.1:4173/api/latest",
  cashcatStatusUrl: "http://127.0.0.1:8010/api/status",
  requestTimeoutMs: 8_000,
  refreshTtlMinutes: 5,
};

function positiveNumber(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be positive`);
  return parsed;
}

function httpUrl(value: string | undefined, fallback: string, name: string): string {
  const candidate = value?.trim() || fallback;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (!new Set(["http:", "https:"]).has(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`${name} must use HTTP(S) without embedded credentials`);
  }
  return parsed.href;
}

export function intelligenceSettingsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): IntelligenceSettings {
  return {
    chainRadarUrl: httpUrl(
      env.INTELLIGENCE_CHAIN_RADAR_URL,
      DEFAULT_INTELLIGENCE_SETTINGS.chainRadarUrl,
      "INTELLIGENCE_CHAIN_RADAR_URL",
    ),
    cashcatStatusUrl: httpUrl(
      env.INTELLIGENCE_CASHCAT_STATUS_URL,
      DEFAULT_INTELLIGENCE_SETTINGS.cashcatStatusUrl,
      "INTELLIGENCE_CASHCAT_STATUS_URL",
    ),
    requestTimeoutMs: positiveNumber(
      env.INTELLIGENCE_REQUEST_TIMEOUT_MS,
      DEFAULT_INTELLIGENCE_SETTINGS.requestTimeoutMs,
      "INTELLIGENCE_REQUEST_TIMEOUT_MS",
    ),
    refreshTtlMinutes: positiveNumber(
      env.INTELLIGENCE_REFRESH_TTL_MINUTES,
      DEFAULT_INTELLIGENCE_SETTINGS.refreshTtlMinutes,
      "INTELLIGENCE_REFRESH_TTL_MINUTES",
    ),
  };
}
