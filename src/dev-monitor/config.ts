export interface DevMonitorSettings {
  enabled: boolean;
  rpcUrl: string;
  dexScreenerApiBaseUrl: string;
  requestTimeoutMs: number;
  rpcMinIntervalMs: number;
  pollSeconds: number;
  marketPollSeconds: number;
  confirmations: number;
  reorgOverlapBlocks: number;
  launchBootstrapBlocks: number;
  logChunkSize: number;
  buyCatchupBlocksPerPoll: number;
  buyMaxRecoverableLagBlocks: number;
  watchedDeveloperLimit: number;
  addressTopicBatchSize: number;
  alertMaxAgeMinutes: number;
  alertHourlyLimit: number;
  alertBatchSize: number;
  alertDeveloperCooldownMinutes: number;
  alertDeliveryCooldownMinutes: number;
  feishuWebhookUrl: string | null;
}

export const DEFAULT_DEV_MONITOR_SETTINGS: DevMonitorSettings = {
  enabled: false,
  rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
  dexScreenerApiBaseUrl: "https://api.dexscreener.com/latest/dex",
  requestTimeoutMs: 20_000,
  rpcMinIntervalMs: 750,
  pollSeconds: 8,
  marketPollSeconds: 300,
  confirmations: 2,
  reorgOverlapBlocks: 12,
  launchBootstrapBlocks: 250_000,
  logChunkSize: 250_000,
  buyCatchupBlocksPerPoll: 2_000,
  buyMaxRecoverableLagBlocks: 10_000,
  watchedDeveloperLimit: 50,
  addressTopicBatchSize: 40,
  alertMaxAgeMinutes: 45,
  alertHourlyLimit: 3,
  alertBatchSize: 3,
  alertDeveloperCooldownMinutes: 360,
  alertDeliveryCooldownMinutes: 20,
  feishuWebhookUrl: null,
};

function booleanValue(value: string | undefined, fallback: boolean, name: string): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  if (["1", "true", "yes", "on"].includes(value.trim().toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(value.trim().toLowerCase())) return false;
  throw new Error(`${name} must be a boolean`);
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be positive`);
  return parsed;
}

function nonNegativeInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be non-negative`);
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
    throw new Error("DEV_MONITOR_FEISHU_WEBHOOK_URL must be an official HTTPS Feishu/Lark webhook");
  }
  return url.href;
}

export function devMonitorSettingsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): DevMonitorSettings {
  return {
    ...DEFAULT_DEV_MONITOR_SETTINGS,
    enabled: booleanValue(
      env.DEV_MONITOR_ENABLED,
      DEFAULT_DEV_MONITOR_SETTINGS.enabled,
      "DEV_MONITOR_ENABLED",
    ),
    rpcUrl:
      env.DEV_MONITOR_RPC_URL?.trim() ||
      env.PAIR_V2_RPC_URL?.trim() ||
      DEFAULT_DEV_MONITOR_SETTINGS.rpcUrl,
    dexScreenerApiBaseUrl:
      env.DEV_MONITOR_DEXSCREENER_API_BASE_URL?.trim() ||
      DEFAULT_DEV_MONITOR_SETTINGS.dexScreenerApiBaseUrl,
    requestTimeoutMs: positiveInteger(
      env.DEV_MONITOR_REQUEST_TIMEOUT_MS,
      DEFAULT_DEV_MONITOR_SETTINGS.requestTimeoutMs,
      "DEV_MONITOR_REQUEST_TIMEOUT_MS",
    ),
    rpcMinIntervalMs: nonNegativeInteger(
      env.DEV_MONITOR_RPC_MIN_INTERVAL_MS,
      DEFAULT_DEV_MONITOR_SETTINGS.rpcMinIntervalMs,
      "DEV_MONITOR_RPC_MIN_INTERVAL_MS",
    ),
    pollSeconds: positiveInteger(
      env.DEV_MONITOR_POLL_SECONDS,
      DEFAULT_DEV_MONITOR_SETTINGS.pollSeconds,
      "DEV_MONITOR_POLL_SECONDS",
    ),
    marketPollSeconds: positiveInteger(
      env.DEV_MONITOR_MARKET_POLL_SECONDS,
      DEFAULT_DEV_MONITOR_SETTINGS.marketPollSeconds,
      "DEV_MONITOR_MARKET_POLL_SECONDS",
    ),
    confirmations: nonNegativeInteger(
      env.DEV_MONITOR_CONFIRMATIONS,
      DEFAULT_DEV_MONITOR_SETTINGS.confirmations,
      "DEV_MONITOR_CONFIRMATIONS",
    ),
    reorgOverlapBlocks: positiveInteger(
      env.DEV_MONITOR_REORG_OVERLAP_BLOCKS,
      DEFAULT_DEV_MONITOR_SETTINGS.reorgOverlapBlocks,
      "DEV_MONITOR_REORG_OVERLAP_BLOCKS",
    ),
    launchBootstrapBlocks: positiveInteger(
      env.DEV_MONITOR_BOOTSTRAP_BLOCKS,
      DEFAULT_DEV_MONITOR_SETTINGS.launchBootstrapBlocks,
      "DEV_MONITOR_BOOTSTRAP_BLOCKS",
    ),
    logChunkSize: positiveInteger(
      env.DEV_MONITOR_LOG_CHUNK_SIZE,
      DEFAULT_DEV_MONITOR_SETTINGS.logChunkSize,
      "DEV_MONITOR_LOG_CHUNK_SIZE",
    ),
    buyCatchupBlocksPerPoll: positiveInteger(
      env.DEV_MONITOR_BUY_CATCHUP_BLOCKS_PER_POLL,
      DEFAULT_DEV_MONITOR_SETTINGS.buyCatchupBlocksPerPoll,
      "DEV_MONITOR_BUY_CATCHUP_BLOCKS_PER_POLL",
    ),
    buyMaxRecoverableLagBlocks: positiveInteger(
      env.DEV_MONITOR_BUY_MAX_RECOVERABLE_LAG_BLOCKS,
      DEFAULT_DEV_MONITOR_SETTINGS.buyMaxRecoverableLagBlocks,
      "DEV_MONITOR_BUY_MAX_RECOVERABLE_LAG_BLOCKS",
    ),
    watchedDeveloperLimit: positiveInteger(
      env.DEV_MONITOR_WATCH_LIMIT,
      DEFAULT_DEV_MONITOR_SETTINGS.watchedDeveloperLimit,
      "DEV_MONITOR_WATCH_LIMIT",
    ),
    addressTopicBatchSize: positiveInteger(
      env.DEV_MONITOR_TOPIC_BATCH_SIZE,
      DEFAULT_DEV_MONITOR_SETTINGS.addressTopicBatchSize,
      "DEV_MONITOR_TOPIC_BATCH_SIZE",
    ),
    alertMaxAgeMinutes: positiveInteger(
      env.DEV_MONITOR_ALERT_MAX_AGE_MINUTES,
      DEFAULT_DEV_MONITOR_SETTINGS.alertMaxAgeMinutes,
      "DEV_MONITOR_ALERT_MAX_AGE_MINUTES",
    ),
    alertHourlyLimit: positiveInteger(
      env.DEV_MONITOR_ALERT_HOURLY_LIMIT,
      DEFAULT_DEV_MONITOR_SETTINGS.alertHourlyLimit,
      "DEV_MONITOR_ALERT_HOURLY_LIMIT",
    ),
    alertBatchSize: positiveInteger(
      env.DEV_MONITOR_ALERT_BATCH_SIZE,
      DEFAULT_DEV_MONITOR_SETTINGS.alertBatchSize,
      "DEV_MONITOR_ALERT_BATCH_SIZE",
    ),
    alertDeveloperCooldownMinutes: positiveInteger(
      env.DEV_MONITOR_ALERT_DEVELOPER_COOLDOWN_MINUTES,
      DEFAULT_DEV_MONITOR_SETTINGS.alertDeveloperCooldownMinutes,
      "DEV_MONITOR_ALERT_DEVELOPER_COOLDOWN_MINUTES",
    ),
    alertDeliveryCooldownMinutes: positiveInteger(
      env.DEV_MONITOR_ALERT_DELIVERY_COOLDOWN_MINUTES,
      DEFAULT_DEV_MONITOR_SETTINGS.alertDeliveryCooldownMinutes,
      "DEV_MONITOR_ALERT_DELIVERY_COOLDOWN_MINUTES",
    ),
    feishuWebhookUrl: optionalWebhook(env.DEV_MONITOR_FEISHU_WEBHOOK_URL),
  };
}
