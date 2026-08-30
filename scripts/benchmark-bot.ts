import { arch, cpus, platform, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import { parseBotConfig } from "../src/bot/config.js";
import { FakeDeBoxTransport } from "../src/bot/debox/fake.js";
import type { DomainResult } from "../src/bot/domain/service.js";
import { BotDomainService } from "../src/bot/domain/service.js";
import { BotHealthTracker } from "../src/bot/health/state.js";
import { BotApplication } from "../src/bot/index.js";
import { platformCatalog } from "../src/bot/intent/aliases.js";
import { LlmResolver, StubLlmProvider } from "../src/bot/intent/llm-resolver.js";
import { basePlan, type QueryPlan } from "../src/bot/intent/query-plan.js";
import { LedgerClient } from "../src/bot/ledger/client.js";
import { StructuredLogger } from "../src/bot/privacy/logging.js";
import { ChatRateLimiter } from "../src/bot/rate/limiter.js";
import { fakeEvent } from "../test/fixtures/debox/events.js";
import { fixtureFetcher, normalRoutes } from "../test/fixtures/ledger/fixtures.js";

function percentile(values: number[], percentileValue: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentileValue * sorted.length) - 1);
  return sorted[index] ?? 0;
}

function summary(values: number[]) {
  return {
    samples: values.length,
    p50Ms: Number(percentile(values, 0.5).toFixed(3)),
    p95Ms: Number(percentile(values, 0.95).toFixed(3)),
    maxMs: Number(Math.max(...values).toFixed(3)),
  };
}

function createApplication(resolver?: LlmResolver) {
  const config = parseBotConfig({
    BOT_LEDGER_BASE_URL: "http://fixture-ledger.local",
    BOT_LEDGER_CACHE_TTL_MS: "15000",
    BOT_MESSAGE_CONCURRENCY: "4",
  });
  const transport = new FakeDeBoxTransport();
  const health = new BotHealthTracker();
  health.update({
    configValid: true,
    identityVerified: true,
    pollingStatus: "polling",
    ledgerReachable: true,
    apiContractCompatible: true,
  });
  const application = new BotApplication({
    config,
    transport,
    domain: new BotDomainService(
      new LedgerClient({
        baseUrl: config.ledgerBaseUrl,
        fetcher: fixtureFetcher(normalRoutes()),
        cacheTtlMs: config.ledgerCacheTtlMs,
      }),
    ),
    health,
    logger: new StructuredLogger(() => undefined),
    rateLimiter: new ChatRateLimiter(5, 10_000),
    ...(resolver ? { resolver } : {}),
  });
  return { application, transport };
}

async function measurePath(
  application: BotApplication,
  text: string,
  prefix: string,
  samples: number,
): Promise<number[]> {
  const values: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const started = performance.now();
    const outcome = await application.processEvent(
      fakeEvent(`${prefix}-update-${String(index)}`, text, {
        chatTarget: `${prefix}-chat-${String(index)}`,
      }),
    );
    values.push(performance.now() - started);
    if (outcome !== "sent") throw new Error(`${prefix} benchmark did not send`);
  }
  return values;
}

const deterministic = createApplication();
const deterministicTimes = await measurePath(
  deterministic.application,
  "/rank 1d volume",
  "deterministic",
  200,
);

const llmPlan = basePlan("rank");
llmPlan.windowDays = 7;
llmPlan.metric = "fees_usd";
llmPlan.scope = "live";
const provider = new StubLlmProvider("success", llmPlan);
const llm = createApplication(
  new LlmResolver({
    enabled: true,
    dailyBudget: 200,
    timeoutMs: 5_000,
    concurrency: 2,
    provider,
    catalog: platformCatalog(),
  }),
);
const llmTimes = await measurePath(llm.application, "帮我综合看一下", "llm", 100);

const pressureConfig = parseBotConfig({
  BOT_LEDGER_BASE_URL: "http://fixture-ledger.local",
  BOT_MESSAGE_CONCURRENCY: "4",
});
const pressureTransport = new FakeDeBoxTransport();
const pressureHealth = new BotHealthTracker();
let active = 0;
let maxActive = 0;
const slowDomain = {
  async execute(_plan: QueryPlan): Promise<DomainResult> {
    active += 1;
    maxActive = Math.max(maxActive, active);
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      return { kind: "help" };
    } finally {
      active -= 1;
    }
  },
};
const pressureApp = new BotApplication({
  config: pressureConfig,
  transport: pressureTransport,
  domain: slowDomain,
  health: pressureHealth,
  logger: new StructuredLogger(() => undefined),
  rateLimiter: new ChatRateLimiter(10, 10_000),
});
const heapBefore = process.memoryUsage().heapUsed;
const pressureOutcomes = await Promise.all(
  Array.from({ length: 200 }, (_value, index) =>
    pressureApp.processEvent(
      fakeEvent(`pressure-update-${String(index)}`, "/help", {
        chatTarget: `pressure-chat-${String(index)}`,
      }),
    ),
  ),
);
const heapDeltaBytes = Math.max(0, process.memoryUsage().heapUsed - heapBefore);

const deterministicSummary = summary(deterministicTimes);
const llmSummary = summary(llmTimes);
const maximumReplyLength = Math.max(
  ...deterministic.transport.sent.map((message) => message.text.length),
  ...llm.transport.sent.map((message) => message.text.length),
);
const report = {
  mode: "fixture-only",
  externalNetworkUsed: false,
  realCredentialsUsed: false,
  machine: {
    node: process.version,
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0]?.model ?? "unknown",
    logicalCpuCount: cpus().length,
    totalMemoryBytes: totalmem(),
  },
  deterministic: deterministicSummary,
  llmStub: { ...llmSummary, providerCalls: provider.calls },
  configuredTimeoutsMs: { ledger: 3_000, llm: 5_000 },
  maximumReplyLength,
  pressure: {
    samples: pressureOutcomes.length,
    sent: pressureOutcomes.filter((outcome) => outcome === "sent").length,
    rateLimited: pressureOutcomes.filter((outcome) => outcome === "rate_limited").length,
    maxDomainConcurrency: maxActive,
    configuredMessageConcurrency: pressureConfig.messageConcurrency,
    heapDeltaBytes,
  },
  thresholds: {
    deterministicP95Ms: 3_000,
    llmP95Ms: 10_000,
    regularReplyTargetCharacters: 1_500,
    hardReplyLimitCharacters: 5_000,
  },
  passed:
    deterministicSummary.p95Ms <= 3_000 &&
    llmSummary.p95Ms <= 10_000 &&
    maximumReplyLength <= 1_500 &&
    maxActive <= pressureConfig.messageConcurrency,
};

console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
