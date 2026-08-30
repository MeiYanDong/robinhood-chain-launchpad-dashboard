import { BotApplication } from "../src/bot/index.js";
import { parseBotConfig } from "../src/bot/config.js";
import { FakeDeBoxTransport } from "../src/bot/debox/fake.js";
import { LongPollingController } from "../src/bot/debox/poller.js";
import { BotDomainService } from "../src/bot/domain/service.js";
import { BotHealthTracker } from "../src/bot/health/state.js";
import { LedgerClient } from "../src/bot/ledger/client.js";
import { StructuredLogger } from "../src/bot/privacy/logging.js";
import { fakeEvent } from "../test/fixtures/debox/events.js";
import { fixtureFetcher, normalRoutes } from "../test/fixtures/ledger/fixtures.js";

const ledgerRequests: string[] = [];
const config = parseBotConfig({
  BOT_LEDGER_BASE_URL: "http://fixture-ledger.local",
  BOT_LEDGER_CACHE_TTL_MS: "0",
});
const ledger = new LedgerClient({
  baseUrl: config.ledgerBaseUrl,
  timeoutMs: config.ledgerTimeoutMs,
  cacheTtlMs: config.ledgerCacheTtlMs,
  fetcher: fixtureFetcher(normalRoutes(), ledgerRequests),
});
const transport = new FakeDeBoxTransport();
const health = new BotHealthTracker();
health.update({
  configValid: true,
  identityVerified: true,
  pollingStatus: "polling",
  ledgerReachable: true,
  apiContractCompatible: true,
  llmEnabled: false,
  llmBudgetFuseOpen: true,
});
const safeLogs: string[] = [];
const application = new BotApplication({
  config,
  transport,
  domain: new BotDomainService(ledger),
  health,
  logger: new StructuredLogger((line) => safeLogs.push(line)),
});
transport.enqueue([
  fakeEvent("fixture-update-1", "/rank 1d volume"),
  fakeEvent("fixture-update-2", "/platform LetsCash 30d", { chatTarget: "fixture-chat-2" }),
  fakeEvent("fixture-update-3", "/status", { chatTarget: "fixture-chat-3" }),
]);

const poller = new LongPollingController(transport, async (event) => {
  await application.processEvent(event);
});
const processed = await poller.runOnce();

console.log(
  JSON.stringify(
    {
      mode: "fixture-only",
      externalNetworkUsed: false,
      realCredentialsUsed: false,
      processed,
      replies: transport.sent.map((message) => message.text),
      ledgerRequests,
      safeLogCount: safeLogs.length,
      ready: health.snapshot().ready,
    },
    null,
    2,
  ),
);
