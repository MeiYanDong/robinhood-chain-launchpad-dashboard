import assert from "node:assert/strict";
import test from "node:test";
import { parseBotConfig } from "../../src/bot/config.js";
import { BotError, toBotError } from "../../src/bot/errors.js";

test("Bot config defaults are local, credential-free, bounded, and LLM-off", () => {
  const config = parseBotConfig({});
  assert.equal(config.ledgerBaseUrl, "http://127.0.0.1:4174");
  assert.equal(config.detailBaseUrl, null);
  assert.equal(config.pollTimeoutSeconds, 30);
  assert.equal(config.ledgerTimeoutMs, 3_000);
  assert.equal(config.ledgerCacheTtlMs, 15_000);
  assert.equal(config.contextTtlMs, 15 * 60_000);
  assert.equal(config.telemetryRetentionDays, 180);
  assert.equal(config.llmEnabled, false);
  assert.equal(config.llmDailyBudget, 0);
  assert.equal(config.healthHost, "127.0.0.1");
  assert.equal(config.voluntaryReportsEnabled, false);
  assert.ok(!Object.keys(config).some((key) => /secret|token|api.?key/i.test(key)));
});

test("Bot config accepts an HTTPS detail allowlist and explicit bounded values", () => {
  const config = parseBotConfig({
    BOT_DETAIL_BASE_URL: "https://ledger.example/",
    BOT_LLM_ENABLED: "true",
    BOT_LLM_DAILY_BUDGET: "25",
    BOT_LEDGER_CACHE_TTL_MS: "0",
    BOT_POLL_TIMEOUT_SECONDS: "60",
  });
  assert.equal(config.detailBaseUrl, "https://ledger.example");
  assert.equal(config.llmEnabled, true);
  assert.equal(config.llmDailyBudget, 25);
  assert.equal(config.ledgerCacheTtlMs, 0);
  assert.equal(config.pollTimeoutSeconds, 60);
});

test("Bot config fails closed on unsafe URLs, invalid bounds, and enabled zero-budget LLM", () => {
  for (const env of [
    { BOT_DETAIL_BASE_URL: "http://ledger.example" },
    { BOT_LEDGER_BASE_URL: "http://user:secret@127.0.0.1" },
    { BOT_LEDGER_BASE_URL: "file:///tmp/data" },
    { BOT_POLL_TIMEOUT_SECONDS: "61" },
    { BOT_LEDGER_CACHE_TTL_MS: "15001" },
    { BOT_LLM_ENABLED: "yes" },
    { BOT_LLM_ENABLED: "true", BOT_LLM_DAILY_BUDGET: "0" },
  ]) {
    assert.throws(
      () => parseBotConfig(env),
      (error: unknown) => error instanceof BotError && error.code === "CONFIG_INVALID",
    );
  }
});

test("unified errors expose stable user text without retaining raw exceptions", () => {
  const raw = new Error("https://private-host/?token=super-secret");
  const mapped = toBotError(raw, "LEDGER_UNAVAILABLE");
  assert.equal(mapped.code, "LEDGER_UNAVAILABLE");
  assert.doesNotMatch(mapped.message + mapped.userMessage, /private-host|super-secret/);
  assert.equal(new BotError("DEBOX_AUTH_ERROR").retryable, false);
  assert.equal(new BotError("DEBOX_RATE_LIMITED", true).retryable, true);
});
