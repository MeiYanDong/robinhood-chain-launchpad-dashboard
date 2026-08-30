import { BotError } from "./errors.js";

export interface BotConfig {
  ledgerBaseUrl: string;
  detailBaseUrl: string | null;
  pollTimeoutSeconds: number;
  ledgerTimeoutMs: number;
  ledgerCacheTtlMs: number;
  contextTtlMs: number;
  telemetryRetentionDays: number;
  llmEnabled: boolean;
  llmDailyBudget: number;
  llmTimeoutMs: number;
  messageConcurrency: number;
  ledgerConcurrency: number;
  llmConcurrency: number;
  sendConcurrency: number;
  healthHost: "127.0.0.1";
  healthPort: number;
  voluntaryReportsEnabled: boolean;
}

function integer(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new BotError("CONFIG_INVALID");
  }
  return parsed;
}

function boolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new BotError("CONFIG_INVALID");
}

function safeUrl(value: string, protocols: string[]): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new BotError("CONFIG_INVALID");
  }
  if (
    !protocols.includes(parsed.protocol) ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new BotError("CONFIG_INVALID");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  return parsed.toString().replace(/\/$/, "");
}

export function parseBotConfig(env: Record<string, string | undefined>): BotConfig {
  const ledgerBaseUrl = safeUrl(env.BOT_LEDGER_BASE_URL ?? "http://127.0.0.1:4174", [
    "http:",
    "https:",
  ]);
  const detailBaseUrl = env.BOT_DETAIL_BASE_URL
    ? safeUrl(env.BOT_DETAIL_BASE_URL, ["https:"])
    : null;
  const llmEnabled = boolean(env.BOT_LLM_ENABLED, false);
  const llmDailyBudget = integer(env.BOT_LLM_DAILY_BUDGET, 0, 0, 1_000_000);
  if (llmEnabled && llmDailyBudget === 0) throw new BotError("CONFIG_INVALID");

  return {
    ledgerBaseUrl,
    detailBaseUrl,
    pollTimeoutSeconds: integer(env.BOT_POLL_TIMEOUT_SECONDS, 30, 1, 60),
    ledgerTimeoutMs: integer(env.BOT_LEDGER_TIMEOUT_MS, 3_000, 100, 30_000),
    ledgerCacheTtlMs: integer(env.BOT_LEDGER_CACHE_TTL_MS, 15_000, 0, 15_000),
    contextTtlMs: integer(env.BOT_CONTEXT_TTL_MS, 15 * 60_000, 1_000, 24 * 60 * 60_000),
    telemetryRetentionDays: integer(env.BOT_TELEMETRY_RETENTION_DAYS, 180, 1, 365),
    llmEnabled,
    llmDailyBudget,
    llmTimeoutMs: integer(env.BOT_LLM_TIMEOUT_MS, 5_000, 100, 10_000),
    messageConcurrency: integer(env.BOT_MESSAGE_CONCURRENCY, 4, 1, 32),
    ledgerConcurrency: integer(env.BOT_LEDGER_CONCURRENCY, 4, 1, 16),
    llmConcurrency: integer(env.BOT_LLM_CONCURRENCY, 2, 1, 8),
    sendConcurrency: integer(env.BOT_SEND_CONCURRENCY, 2, 1, 8),
    healthHost: "127.0.0.1",
    healthPort: integer(env.BOT_HEALTH_PORT, 4180, 1, 65_535),
    voluntaryReportsEnabled: boolean(env.BOT_VOLUNTARY_REPORTS_ENABLED, false),
  };
}
