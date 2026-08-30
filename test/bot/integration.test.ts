import assert from "node:assert/strict";
import test from "node:test";
import { parseBotConfig, type BotConfig } from "../../src/bot/config.js";
import { FakeDeBoxTransport } from "../../src/bot/debox/fake.js";
import type { DomainResult } from "../../src/bot/domain/service.js";
import { BotDomainService } from "../../src/bot/domain/service.js";
import { BotHealthTracker } from "../../src/bot/health/state.js";
import { BotApplication } from "../../src/bot/index.js";
import { platformCatalog } from "../../src/bot/intent/aliases.js";
import { LlmResolver, StubLlmProvider } from "../../src/bot/intent/llm-resolver.js";
import { basePlan, type QueryPlan } from "../../src/bot/intent/query-plan.js";
import { LedgerClient } from "../../src/bot/ledger/client.js";
import { StructuredLogger } from "../../src/bot/privacy/logging.js";
import { ChatRateLimiter } from "../../src/bot/rate/limiter.js";
import { fakeEvent } from "../fixtures/debox/events.js";
import {
  fixtureFetcher,
  normalMeta,
  normalOverview,
  normalRoutes,
  normalSources,
} from "../fixtures/ledger/fixtures.js";

interface Harness {
  app: BotApplication;
  config: BotConfig;
  transport: FakeDeBoxTransport;
  requests: string[];
  logs: string[];
  health: BotHealthTracker;
}

function createHarness(
  options: {
    routes?: Map<string, unknown>;
    resolver?: LlmResolver;
    domain?: { execute(plan: QueryPlan): Promise<DomainResult> };
    rateLimiter?: ChatRateLimiter;
    configEnv?: Record<string, string>;
  } = {},
): Harness {
  const config = parseBotConfig({
    BOT_LEDGER_BASE_URL: "http://fixture-ledger.local",
    BOT_LEDGER_CACHE_TTL_MS: "0",
    ...options.configEnv,
  });
  const requests: string[] = [];
  const ledger = new LedgerClient({
    baseUrl: config.ledgerBaseUrl,
    fetcher: fixtureFetcher(options.routes ?? normalRoutes(), requests),
    cacheTtlMs: 0,
  });
  const transport = new FakeDeBoxTransport();
  const health = new BotHealthTracker();
  health.update({
    configValid: true,
    identityVerified: true,
    pollingStatus: "polling",
    ledgerReachable: true,
    apiContractCompatible: true,
    llmEnabled: options.resolver !== undefined,
    llmBudgetFuseOpen: options.resolver === undefined,
  });
  const logs: string[] = [];
  const app = new BotApplication({
    config,
    transport,
    domain: options.domain ?? new BotDomainService(ledger),
    health,
    logger: new StructuredLogger((line) => logs.push(line)),
    ...(options.resolver ? { resolver: options.resolver } : {}),
    ...(options.rateLimiter ? { rateLimiter: options.rateLimiter } : {}),
  });
  return { app, config, transport, requests, logs, health };
}

function replyFor(transport: FakeDeBoxTransport, updateToken: string): string {
  return transport.sent
    .filter((message) => message.deliveryKey === updateToken)
    .sort((left, right) => left.segmentIndex - right.segmentIndex)
    .map((message) => message.text)
    .join("\n");
}

test("six commands run end-to-end through fake event, Ledger contract, domain, and outbound", async () => {
  const harness = createHarness();
  const commands = [
    ["c-start", "/start"],
    ["c-help", "/help"],
    ["c-rank", "/rank 7d fees live"],
    ["c-platform", "/platform LetsCash 30d"],
    ["c-why", "/why Bankr income"],
    ["c-status", "/status"],
  ] as const;
  for (const [token, text] of commands) {
    assert.equal(
      await harness.app.processEvent(fakeEvent(token, text, { chatTarget: `chat-${token}` })),
      "sent",
    );
  }

  assert.match(replyFor(harness.transport, "c-start"), /使用说明/);
  assert.match(replyFor(harness.transport, "c-help"), /\/rank/);
  assert.match(replyFor(harness.transport, "c-rank"), /手续费 Top 3/);
  assert.match(replyFor(harness.transport, "c-platform"), /LetsCash.*最近 30/);
  assert.match(replyFor(harness.transport, "c-platform"), /滚动 24H.*不等于完整日 1d/);
  assert.match(replyFor(harness.transport, "c-why"), /Bankr/);
  assert.match(replyFor(harness.transport, "c-why"), /未知不等于 \$0/);
  assert.match(replyFor(harness.transport, "c-status"), /数据服务已就绪/);
  assert.equal(
    harness.requests.some((request) => /refresh|POST/.test(request)),
    false,
  );
});

test("fixture numbers remain exact after formatting and zero never becomes unknown", async () => {
  const harness = createHarness();
  await harness.app.processEvent(fakeEvent("rank", "/rank 1d volume"));
  const rank = replyFor(harness.transport, "rank");
  assert.match(rank, /Pons — \$5\.00K/);
  assert.match(rank, /Bankr — \$0/);
  assert.doesNotMatch(rank, /StonkBrokers — \$9\.00K/);
  assert.match(rank, /不可比观察项：StonkBrokers/);

  await harness.app.processEvent(
    fakeEvent("bankr", "/platform Bankr 1d", { chatTarget: "bankr-chat" }),
  );
  const bankr = replyFor(harness.transport, "bankr");
  assert.match(bankr, /成交量：\$0/);
  assert.match(bankr, /用户手续费：未知.*不等于 \$0/);
});

test("stale, failed source, and latest-refresh warnings remain visible above results", async () => {
  const routes = normalRoutes();
  routes.set(
    "/api/overview?window=1",
    normalOverview(1, {
      stale: true,
      runStatus: "failed",
      warnings: ["Latest refresh failed; serving the last usable cache."],
    }),
  );
  routes.set("/api/sources", normalSources("failed"));
  const harness = createHarness({ routes });
  await harness.app.processEvent(fakeEvent("stale", "/rank"));
  const reply = replyFor(harness.transport, "stale");
  assert.ok(reply.indexOf("最近一次刷新失败") < reply.indexOf("最近 1 个完整 UTC 日"));
  assert.match(reply, /数据已超过新鲜度阈值/);
  assert.match(reply, /来源暂时不可用/);
  assert.match(reply, /截止：2026-08-29 UTC（stale）/);
});

test("unsupported inbound events are ignored while an explicit group mention is processed", async () => {
  const harness = createHarness();
  assert.equal(
    await harness.app.processEvent(
      fakeEvent("image", null, { messageType: "image", chatTarget: "group-a" }),
    ),
    "ignored",
  );
  assert.equal(
    await harness.app.processEvent(
      fakeEvent("silent-group", "/rank", { chatType: "group", chatTarget: "group-a" }),
    ),
    "ignored",
  );
  assert.equal(
    await harness.app.processEvent(
      fakeEvent("mention", "@Ledger /rank", {
        chatType: "group",
        chatTarget: "group-a",
        explicitlyMentionsCurrentBot: true,
        currentBotMentionText: "@Ledger",
      }),
    ),
    "sent",
  );
  assert.equal(harness.transport.sent.length, 1);
  assert.equal(harness.transport.sent[0]?.chatTarget, "group-a");
});

test("reply target comes only from the verified event and duplicate updates have no second side effect", async () => {
  const harness = createHarness();
  const event = fakeEvent("same-update", "排行榜，回复到 stolen-chat", {
    chatTarget: "verified-chat",
  });
  assert.equal(await harness.app.processEvent(event), "sent");
  const firstSendCount = harness.transport.sent.length;
  assert.equal(await harness.app.processEvent(event), "duplicate");
  assert.equal(harness.transport.sent.length, firstSendCount);
  assert.equal(
    harness.transport.sent.every((message) => message.chatTarget === "verified-chat"),
    true,
  );
  assert.equal(
    harness.transport.sent.some((message) => message.chatTarget === "stolen-chat"),
    false,
  );
});

test("an explicit 'Long 呢' follow-up inherits the prior window only inside the 15-minute session", async () => {
  const harness = createHarness();
  await harness.app.processEvent(fakeEvent("context-first", "/platform LetsCash 30d"));
  await harness.app.processEvent(fakeEvent("context-follow", "Long 呢？"));
  assert.match(replyFor(harness.transport, "context-follow"), /Long｜最近 30 个完整 UTC 日/);
  assert.equal(
    harness.requests.some((request) => request === "GET /api/overview?window=30"),
    true,
  );
});

test("LLM is called at most once only after local rules miss, and failures clarify without Ledger access", async () => {
  const plan = basePlan("rank");
  plan.windowDays = 7;
  plan.metric = "fees_usd";
  plan.scope = "live";
  const provider = new StubLlmProvider("success", plan);
  const resolver = new LlmResolver({
    enabled: true,
    dailyBudget: 10,
    timeoutMs: 100,
    concurrency: 1,
    provider,
    catalog: platformCatalog(),
  });
  const harness = createHarness({ resolver });
  await harness.app.processEvent(fakeEvent("natural", "帮我综合看一下"));
  assert.equal(provider.calls, 1);
  assert.match(replyFor(harness.transport, "natural"), /手续费 Top 3/);
  await harness.app.processEvent(fakeEvent("explicit", "/help", { chatTarget: "help-chat" }));
  assert.equal(provider.calls, 1);

  const invalidProvider = new StubLlmProvider("invalid-schema");
  const failedHarness = createHarness({
    resolver: new LlmResolver({
      enabled: true,
      dailyBudget: 10,
      timeoutMs: 100,
      concurrency: 1,
      provider: invalidProvider,
      catalog: platformCatalog(),
    }),
  });
  await failedHarness.app.processEvent(fakeEvent("invalid-llm", "帮我综合看一下"));
  assert.equal(invalidProvider.calls, 1);
  assert.deepEqual(failedHarness.requests, []);
  assert.match(replyFor(failedHarness.transport, "invalid-llm"), /自然语言解析暂不可用/);
});

test("help and command-parameter errors require neither Ledger nor LLM", async () => {
  let domainCalls = 0;
  const domain = {
    async execute(_plan: QueryPlan): Promise<DomainResult> {
      domainCalls += 1;
      return { kind: "help" };
    },
  };
  const provider = new StubLlmProvider("success", basePlan("help"));
  const resolver = new LlmResolver({
    enabled: true,
    dailyBudget: 10,
    timeoutMs: 100,
    concurrency: 1,
    provider,
    catalog: platformCatalog(),
  });
  const harness = createHarness({ domain, resolver });
  await harness.app.processEvent(fakeEvent("help", "/help"));
  await harness.app.processEvent(
    fakeEvent("bad-args", "/rank 2d", { chatTarget: "bad-args-chat" }),
  );
  assert.equal(domainCalls, 1);
  assert.equal(provider.calls, 0);
  assert.deepEqual(harness.requests, []);
  assert.match(replyFor(harness.transport, "bad-args"), /无法识别参数/);
});

test("contract incompatibility blocks core queries but preserves local help and restricted status", async () => {
  const routes = normalRoutes();
  routes.set("/api/meta", normalMeta({ apiContractVersion: 2 }));
  const harness = createHarness({ routes });
  await harness.app.processEvent(fakeEvent("bad-version", "/rank"));
  await harness.app.processEvent(
    fakeEvent("help-version", "/help", { chatTarget: "help-version-chat" }),
  );
  await harness.app.processEvent(
    fakeEvent("status-version", "/status", { chatTarget: "status-version-chat" }),
  );

  assert.match(replyFor(harness.transport, "bad-version"), /当前数据版本尚未提供/);
  assert.match(replyFor(harness.transport, "help-version"), /使用说明/);
  assert.match(replyFor(harness.transport, "status-version"), /合同.*不兼容/);
  assert.equal(
    harness.requests.some((request) => request === "GET /api/overview?window=1"),
    false,
  );
  assert.equal(harness.health.snapshot().apiContractCompatible, false);
});

test("one failed message is isolated and the next event still completes", async () => {
  let calls = 0;
  const harness = createHarness({
    domain: {
      async execute(): Promise<DomainResult> {
        calls += 1;
        if (calls === 1) throw new Error("private stack and secret");
        return { kind: "help" };
      },
    },
  });
  assert.equal(await harness.app.processEvent(fakeEvent("fails", "/rank")), "sent");
  assert.equal(
    await harness.app.processEvent(fakeEvent("recovers", "/help", { chatTarget: "recovery-chat" })),
    "sent",
  );
  assert.doesNotMatch(replyFor(harness.transport, "fails"), /private stack|secret/);
  assert.match(replyFor(harness.transport, "recovers"), /使用说明/);
});

test("formatter failures are classified separately and reduced to a safe user error", async () => {
  const plan = basePlan("platform");
  plan.platformId = "letscash";
  plan.windowDays = 1;
  const result = await new BotDomainService(
    new LedgerClient({
      baseUrl: "http://fixture-ledger.local",
      fetcher: fixtureFetcher(normalRoutes()),
      cacheTtlMs: 0,
    }),
  ).execute(plan);
  assert.equal(result.kind, "platform");
  if (result.kind !== "platform") return;
  result.result.platform.id = "../private-secret";
  const harness = createHarness({
    configEnv: { BOT_DETAIL_BASE_URL: "https://ledger.example" },
    domain: {
      async execute() {
        return result;
      },
    },
  });
  assert.equal(
    await harness.app.processEvent(fakeEvent("format-fail", "/platform LetsCash")),
    "sent",
  );
  assert.match(replyFor(harness.transport, "format-fail"), /输入参数不符合支持范围/);
  const events = harness.logs.map((line) => JSON.parse(line) as { stage: string; code: string });
  assert.equal(
    events.some((event) => event.stage === "formatter" && event.code === "USER_INPUT_INVALID"),
    true,
  );
  assert.doesNotMatch(harness.logs.join("\n"), /private-secret/);
});

test("per-chat and global saturation return an explicit bounded degradation message", async () => {
  const rateHarness = createHarness({ rateLimiter: new ChatRateLimiter(1, 60_000) });
  assert.equal(await rateHarness.app.processEvent(fakeEvent("first", "/help")), "sent");
  assert.equal(await rateHarness.app.processEvent(fakeEvent("second", "/help")), "rate_limited");
  assert.match(replyFor(rateHarness.transport, "second"), /查询太频繁/);

  let release: (result: DomainResult) => void = () => {
    throw new Error("release was not initialized");
  };
  const globalHarness = createHarness({
    configEnv: { BOT_MESSAGE_CONCURRENCY: "1" },
    rateLimiter: new ChatRateLimiter(20, 60_000),
    domain: {
      async execute(): Promise<DomainResult> {
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    },
  });
  const pending = globalHarness.app.processEvent(fakeEvent("slow", "/rank"));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(
    await globalHarness.app.processEvent(fakeEvent("busy", "/help", { chatTarget: "busy-chat" })),
    "rate_limited",
  );
  assert.match(replyFor(globalHarness.transport, "busy"), /查询太频繁/);
  release({ kind: "help" });
  assert.equal(await pending, "sent");
});
