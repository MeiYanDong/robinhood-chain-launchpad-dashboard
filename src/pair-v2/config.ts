export interface PairV2Settings {
  apiBaseUrl: string;
  dexScreenerApiBaseUrl: string;
  releaseAttestationUrl: string;
  rpcUrl: string;
  expectedReleaseId: string;
  expectedManifestSha256: string;
  deploymentBlock: number;
  chainId: number;
  pageLimit: number;
  maxPages: number;
  pageConcurrency: number;
  logChunkSize: number;
  logConfirmations: number;
  reorgOverlapBlocks: number;
  requestTimeoutMs: number;
  chainPollSeconds: number;
  hotMarketPollSeconds: number;
  marketPollSeconds: number;
  staleAfterSeconds: number;
  maxBucketEpoch: number;
  holderRefreshMinutes: number;
  holderBatchSize: number;
  alphaLegacyCandidateLimit: number;
  alphaHotCandidateLimit: number;
  alphaRecentHours: number;
  alphaMinimumVolume24hUsd: number;
  alphaMinimumMarketCapUsd: number;
  alphaReturnedTokenLimit: number;
  gmgnBinary: string;
  gmgnTimeoutMs: number;
  feishuWebhookUrl: string | null;
}

export const DEFAULT_PAIR_V2_SETTINGS: PairV2Settings = {
  apiBaseUrl: "https://pair.fund/api",
  dexScreenerApiBaseUrl: "https://api.dexscreener.com/latest/dex",
  releaseAttestationUrl:
    "https://pair.fund/api/v5-v2/standard-route/consumer-live?releaseId=0x85ec0ee2de653cc6695b022063c2dec735634e629961db989275797609e9cebd&manifestSha256=df121499c083fc848a915101abf6dc121c0c83ca75ea1c28b0f81010ac10a83b&fresh=1",
  rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
  expectedReleaseId: "0x85ec0ee2de653cc6695b022063c2dec735634e629961db989275797609e9cebd",
  expectedManifestSha256: "df121499c083fc848a915101abf6dc121c0c83ca75ea1c28b0f81010ac10a83b",
  deploymentBlock: 54_695_970,
  chainId: 4663,
  pageLimit: 50,
  maxPages: 100,
  pageConcurrency: 4,
  logChunkSize: 500_000,
  logConfirmations: 2,
  reorgOverlapBlocks: 12,
  requestTimeoutMs: 20_000,
  chainPollSeconds: 8,
  hotMarketPollSeconds: 15,
  marketPollSeconds: 60,
  staleAfterSeconds: 150,
  maxBucketEpoch: 8,
  holderRefreshMinutes: 10,
  holderBatchSize: 9,
  alphaLegacyCandidateLimit: 240,
  alphaHotCandidateLimit: 72,
  alphaRecentHours: 72,
  alphaMinimumVolume24hUsd: 250,
  alphaMinimumMarketCapUsd: 8_000,
  alphaReturnedTokenLimit: 300,
  gmgnBinary: "gmgn-cli",
  gmgnTimeoutMs: 20_000,
  feishuWebhookUrl: null,
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

function optionalWebhook(value: string | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  const url = new URL(normalized);
  if (
    url.protocol !== "https:" ||
    !["open.feishu.cn", "open.larksuite.com"].includes(url.hostname)
  ) {
    throw new Error("PAIR_V2_FEISHU_WEBHOOK_URL must be an official HTTPS Feishu/Lark webhook");
  }
  return url.href;
}

export function pairV2SettingsFromEnv(env: NodeJS.ProcessEnv = process.env): PairV2Settings {
  const expectedReleaseId =
    env.PAIR_V2_RELEASE_ID?.trim().toLowerCase() || DEFAULT_PAIR_V2_SETTINGS.expectedReleaseId;
  const expectedManifestSha256 =
    env.PAIR_V2_MANIFEST_SHA256?.trim().toLowerCase() ||
    DEFAULT_PAIR_V2_SETTINGS.expectedManifestSha256;
  if (!/^0x[0-9a-f]{64}$/.test(expectedReleaseId)) {
    throw new Error("PAIR_V2_RELEASE_ID must be a 32-byte hex value");
  }
  if (!/^[0-9a-f]{64}$/.test(expectedManifestSha256)) {
    throw new Error("PAIR_V2_MANIFEST_SHA256 must be a SHA-256 hex value");
  }
  return {
    ...DEFAULT_PAIR_V2_SETTINGS,
    dexScreenerApiBaseUrl:
      env.PAIR_V2_DEXSCREENER_API_BASE_URL?.trim() ||
      DEFAULT_PAIR_V2_SETTINGS.dexScreenerApiBaseUrl,
    rpcUrl:
      env.PAIR_V2_RPC_URL?.trim() ||
      env.PAIR_FLOW_RPC_URL?.trim() ||
      DEFAULT_PAIR_V2_SETTINGS.rpcUrl,
    releaseAttestationUrl:
      env.PAIR_V2_RELEASE_ATTESTATION_URL?.trim() || DEFAULT_PAIR_V2_SETTINGS.releaseAttestationUrl,
    expectedReleaseId,
    expectedManifestSha256,
    deploymentBlock: positiveInteger(
      env.PAIR_V2_DEPLOYMENT_BLOCK,
      DEFAULT_PAIR_V2_SETTINGS.deploymentBlock,
      "PAIR_V2_DEPLOYMENT_BLOCK",
    ),
    logChunkSize: positiveInteger(
      env.PAIR_V2_LOG_CHUNK_SIZE,
      DEFAULT_PAIR_V2_SETTINGS.logChunkSize,
      "PAIR_V2_LOG_CHUNK_SIZE",
    ),
    chainPollSeconds: positiveInteger(
      env.PAIR_V2_CHAIN_POLL_SECONDS,
      DEFAULT_PAIR_V2_SETTINGS.chainPollSeconds,
      "PAIR_V2_CHAIN_POLL_SECONDS",
    ),
    hotMarketPollSeconds: positiveInteger(
      env.PAIR_ALPHA_HOT_MARKET_POLL_SECONDS,
      DEFAULT_PAIR_V2_SETTINGS.hotMarketPollSeconds,
      "PAIR_ALPHA_HOT_MARKET_POLL_SECONDS",
    ),
    marketPollSeconds: positiveInteger(
      env.PAIR_V2_MARKET_POLL_SECONDS,
      DEFAULT_PAIR_V2_SETTINGS.marketPollSeconds,
      "PAIR_V2_MARKET_POLL_SECONDS",
    ),
    staleAfterSeconds: positiveInteger(
      env.PAIR_V2_STALE_AFTER_SECONDS,
      DEFAULT_PAIR_V2_SETTINGS.staleAfterSeconds,
      "PAIR_V2_STALE_AFTER_SECONDS",
    ),
    maxBucketEpoch: positiveInteger(
      env.PAIR_V2_MAX_BUCKET_EPOCH,
      DEFAULT_PAIR_V2_SETTINGS.maxBucketEpoch,
      "PAIR_V2_MAX_BUCKET_EPOCH",
    ),
    holderRefreshMinutes: positiveNumber(
      env.PAIR_V2_HOLDER_REFRESH_MINUTES,
      DEFAULT_PAIR_V2_SETTINGS.holderRefreshMinutes,
      "PAIR_V2_HOLDER_REFRESH_MINUTES",
    ),
    holderBatchSize: positiveInteger(
      env.PAIR_V2_HOLDER_BATCH_SIZE,
      DEFAULT_PAIR_V2_SETTINGS.holderBatchSize,
      "PAIR_V2_HOLDER_BATCH_SIZE",
    ),
    alphaLegacyCandidateLimit: positiveInteger(
      env.PAIR_ALPHA_LEGACY_CANDIDATE_LIMIT,
      DEFAULT_PAIR_V2_SETTINGS.alphaLegacyCandidateLimit,
      "PAIR_ALPHA_LEGACY_CANDIDATE_LIMIT",
    ),
    alphaHotCandidateLimit: positiveInteger(
      env.PAIR_ALPHA_HOT_CANDIDATE_LIMIT,
      DEFAULT_PAIR_V2_SETTINGS.alphaHotCandidateLimit,
      "PAIR_ALPHA_HOT_CANDIDATE_LIMIT",
    ),
    alphaRecentHours: positiveNumber(
      env.PAIR_ALPHA_RECENT_HOURS,
      DEFAULT_PAIR_V2_SETTINGS.alphaRecentHours,
      "PAIR_ALPHA_RECENT_HOURS",
    ),
    alphaMinimumVolume24hUsd: positiveNumber(
      env.PAIR_ALPHA_MIN_VOLUME_24H_USD,
      DEFAULT_PAIR_V2_SETTINGS.alphaMinimumVolume24hUsd,
      "PAIR_ALPHA_MIN_VOLUME_24H_USD",
    ),
    alphaMinimumMarketCapUsd: positiveNumber(
      env.PAIR_ALPHA_MIN_MARKET_CAP_USD,
      DEFAULT_PAIR_V2_SETTINGS.alphaMinimumMarketCapUsd,
      "PAIR_ALPHA_MIN_MARKET_CAP_USD",
    ),
    alphaReturnedTokenLimit: positiveInteger(
      env.PAIR_ALPHA_RETURNED_TOKEN_LIMIT,
      DEFAULT_PAIR_V2_SETTINGS.alphaReturnedTokenLimit,
      "PAIR_ALPHA_RETURNED_TOKEN_LIMIT",
    ),
    requestTimeoutMs: positiveInteger(
      env.PAIR_V2_REQUEST_TIMEOUT_MS,
      DEFAULT_PAIR_V2_SETTINGS.requestTimeoutMs,
      "PAIR_V2_REQUEST_TIMEOUT_MS",
    ),
    gmgnTimeoutMs: positiveInteger(
      env.PAIR_V2_GMGN_TIMEOUT_MS,
      DEFAULT_PAIR_V2_SETTINGS.gmgnTimeoutMs,
      "PAIR_V2_GMGN_TIMEOUT_MS",
    ),
    gmgnBinary: env.PAIR_V2_GMGN_BIN?.trim() || DEFAULT_PAIR_V2_SETTINGS.gmgnBinary,
    feishuWebhookUrl: optionalWebhook(env.PAIR_V2_FEISHU_WEBHOOK_URL),
  };
}
