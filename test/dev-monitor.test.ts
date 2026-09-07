import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DevMonitorFeishuNotifier, planDevMonitorAlerts } from "../src/dev-monitor/alerts.js";
import {
  DEV_LAUNCH_SOURCES,
  DevMonitorCollector,
  PacedDevMonitorRpc,
  deriveDevProfiles,
  pairV2Projects,
} from "../src/dev-monitor/collector.js";
import {
  DEFAULT_DEV_MONITOR_SETTINGS,
  devMonitorSettingsFromEnv,
} from "../src/dev-monitor/config.js";
import { DevMonitorDatabase } from "../src/dev-monitor/database.js";
import { PAIR_OFFICIAL_PROTOCOL_TOKEN, PAIR_PRIMARY_ISSUER } from "../src/dev-monitor/pair-team.js";
import { DevMonitorService } from "../src/dev-monitor/service.js";
import type {
  DevMonitorActivity,
  DevMonitorProfile,
  DevMonitorProject,
} from "../src/dev-monitor/types.js";
import type { PairV2Rpc, PairV2RpcLog } from "../src/pair-v2/rpc.js";
import type { PairV2DashboardResponse } from "../src/pair-v2/types.js";

const DEV = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x2222222222222222222222222222222222222222";
const ROUTER = "0x3333333333333333333333333333333333333333";
const TX_HASH = `0x${"a".repeat(64)}`;
const BLOCK_HASH = `0x${"b".repeat(64)}`;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function topic(address: string): string {
  return `0x${address.slice(2).padStart(64, "0")}`;
}

function uint(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function dynamicString(value: string): string {
  const bytes = Buffer.from(value);
  const data = bytes.toString("hex").padEnd(Math.ceil(bytes.length / 32) * 64, "0");
  return `0x${32n.toString(16).padStart(64, "0")}${BigInt(bytes.length)
    .toString(16)
    .padStart(64, "0")}${data}`;
}

function project(overrides: Partial<DevMonitorProject> = {}): DevMonitorProject {
  return {
    address: TOKEN,
    platform: "pair_v2",
    creator: DEV,
    launchId: `4663:${TX_HASH}:1`,
    transactionHash: TX_HASH,
    blockNumber: 90,
    blockHash: BLOCK_HASH,
    launchedAt: "2026-09-06T00:00:00.000Z",
    attribution: "canonical_event",
    attributionConfidence: "high",
    symbol: "ALPHA",
    marketCapUsd: 50_000,
    liquidityUsd: 15_000,
    volume24hUsd: 30_000,
    qualityQualified: true,
    observedAt: "2026-09-06T00:01:00.000Z",
    ...overrides,
  };
}

function profile(overrides: Partial<DevMonitorProfile> = {}): DevMonitorProfile {
  return {
    address: DEV,
    tier: "proven",
    score: 100,
    label: "ALPHA 创建者",
    platforms: ["pair_v2"],
    launchCount: 1,
    qualifiedLaunchCount: 1,
    successfulLaunchCount: 1,
    topMarketCapUsd: 50_000,
    topLiquidityUsd: 15_000,
    topVolume24hUsd: 30_000,
    topProject: { address: TOKEN, symbol: "ALPHA", platform: "pair_v2" },
    reasons: ["达到门槛"],
    firstSeenAt: "2026-09-06T00:00:00.000Z",
    lastSeenAt: "2026-09-06T00:00:00.000Z",
    updatedAt: "2026-09-06T00:01:00.000Z",
    ...overrides,
  };
}

function activity(overrides: Partial<DevMonitorActivity> = {}): DevMonitorActivity {
  return {
    id: `4663:${TX_HASH}:${DEV}:${TOKEN}`,
    type: "buy",
    developer: DEV,
    developerTier: "proven",
    transactionHash: TX_HASH,
    blockNumber: 100,
    blockHash: BLOCK_HASH,
    timestamp: "2026-09-06T00:02:00.000Z",
    target: { address: TOKEN, symbol: "ALPHA", decimals: 18 },
    targetAmountRaw: "2000000000000000000",
    targetAmount: 2,
    targetPlatform: "pair_v2",
    quote: { address: "native", symbol: "ETH", decimals: 18 },
    quoteAmountRaw: "1000000000000000000",
    quoteAmount: 1,
    transactionSender: DEV,
    confidence: "high",
    evidence: ["receipt 成功"],
    observedAt: "2026-09-06T00:02:00.000Z",
    ...overrides,
  };
}

test("DEV monitor configuration is opt-in and keeps the webhook on official hosts", () => {
  assert.equal(devMonitorSettingsFromEnv({}).enabled, false);
  const settings = devMonitorSettingsFromEnv({
    DEV_MONITOR_ENABLED: "true",
    DEV_MONITOR_CONFIRMATIONS: "4",
    DEV_MONITOR_FEISHU_WEBHOOK_URL: "https://open.feishu.cn/open-apis/bot/v2/hook/test",
  });
  assert.equal(settings.enabled, true);
  assert.equal(settings.confirmations, 4);
  assert.equal(settings.alertMaxAgeMinutes, 45);
  assert.equal(settings.alertHourlyLimit, 3);
  assert.equal(settings.alertBatchSize, 3);
  assert.equal(settings.alertDeveloperCooldownMinutes, 360);
  assert.equal(settings.alertDeliveryCooldownMinutes, 20);
  assert.equal(settings.buyCatchupBlocksPerPoll, 2_000);
  assert.equal(settings.buyMaxRecoverableLagBlocks, 10_000);
  assert.equal(settings.rpcMinIntervalMs, 750);
  assert.equal(settings.feishuWebhookUrl?.startsWith("https://open.feishu.cn/"), true);
  assert.throws(() =>
    devMonitorSettingsFromEnv({ DEV_MONITOR_FEISHU_WEBHOOK_URL: "https://example.com/hook" }),
  );
});

test("DEV RPC pacing serializes requests and enforces a minimum interval after failures", async () => {
  let currentMs = 0;
  const waits: number[] = [];
  const calls: string[] = [];
  let shouldFail = false;
  const rpc: PairV2Rpc = {
    call: async <T>(method: string) => {
      calls.push(method);
      if (shouldFail) {
        shouldFail = false;
        throw new Error("transient");
      }
      return method as T;
    },
    batch: async <T>() => [] as T[],
  };
  const paced = new PacedDevMonitorRpc(
    rpc,
    750,
    async (milliseconds) => {
      waits.push(milliseconds);
      currentMs += milliseconds;
    },
    () => currentMs,
  );

  assert.equal(await paced.call("first", []), "first");
  shouldFail = true;
  await assert.rejects(paced.call("second", []), /transient/);
  assert.equal(await paced.call("third", []), "third");
  assert.deepEqual(calls, ["first", "second", "third"]);
  assert.deepEqual(waits, [750, 750]);
});

test("profile derivation separates proven, repeat, and unproven creators", () => {
  const repeatDev = "0x4444444444444444444444444444444444444444";
  const candidateDev = "0x5555555555555555555555555555555555555555";
  const profiles = deriveDevProfiles(
    [
      project(),
      project({
        address: "0x6666666666666666666666666666666666666666",
        creator: repeatDev,
        marketCapUsd: 12_000,
        liquidityUsd: 4_000,
        volume24hUsd: 3_000,
      }),
      project({
        address: "0x7777777777777777777777777777777777777777",
        creator: repeatDev,
        marketCapUsd: 11_000,
        liquidityUsd: 3_500,
        volume24hUsd: 2_000,
      }),
      project({
        address: "0x8888888888888888888888888888888888888888",
        creator: candidateDev,
        marketCapUsd: 500,
        liquidityUsd: 100,
        volume24hUsd: 50,
        qualityQualified: false,
      }),
    ],
    "2026-09-06T01:00:00.000Z",
  );
  assert.equal(profiles.find((item) => item.address === DEV)?.tier, "proven");
  assert.equal(profiles.find((item) => item.address === repeatDev)?.tier, "repeat");
  assert.equal(profiles.find((item) => item.address === candidateDev)?.tier, "candidate");
});

test("PAIR V2 creator seeds require the canonical launch event", () => {
  const dashboard = {
    events: [
      {
        id: `4663:${TX_HASH}:1`,
        type: "launch",
        project: TOKEN,
        actor: DEV,
        transactionHash: TX_HASH,
        blockNumber: 90,
        timestamp: "2026-09-06T00:00:00.000Z",
      },
    ],
    tokens: [
      {
        address: TOKEN,
        creator: DEV,
        symbol: "ALPHA",
        marketCapUsd: 50_000,
        liquidityUsd: 15_000,
        volume24hUsd: 30_000,
        alpha: { quality: { state: "qualified" } },
      },
      {
        address: "0x9999999999999999999999999999999999999999",
        creator: DEV,
        symbol: "UNPROVEN",
        alpha: { quality: { state: "qualified" } },
      },
    ],
  } as unknown as PairV2DashboardResponse;
  const seeds = pairV2Projects(dashboard, "2026-09-06T00:01:00.000Z");
  assert.equal(seeds.length, 1);
  assert.equal(seeds[0]?.creator, DEV);
  assert.equal(seeds[0]?.attributionConfidence, "high");
});

test("launch source decoders use each platform's exact indexed identity", async () => {
  let currentSource = DEV_LAUNCH_SOURCES[0] as (typeof DEV_LAUNCH_SOURCES)[number];
  const rpc: PairV2Rpc = {
    call: async <T>(method: string) => {
      if (method !== "eth_getLogs") throw new Error(`unexpected ${method}`);
      const topics =
        currentSource.id === "pons_v2"
          ? [currentSource.topic, topic(TOKEN), topic(ROUTER), topic(DEV)]
          : currentSource.id === "long"
            ? [currentSource.topic, topic(TOKEN), topic(TOKEN), topic(ROUTER)]
            : [currentSource.topic, topic(TOKEN), topic(DEV)];
      return [
        {
          address: currentSource.address,
          topics,
          data: "0x",
          blockNumber: "0x895440",
          blockHash: BLOCK_HASH,
          transactionHash: TX_HASH,
          logIndex: "0x1",
        },
      ] as T;
    },
    batch: async <T>(calls: Array<{ method: string }>) => {
      if (calls[0]?.method === "eth_getBlockByNumber") {
        return calls.map(() => ({ timestamp: "0x68bd1100" })) as T[];
      }
      if (calls[0]?.method === "eth_getTransactionByHash") {
        return calls.map(() => ({ from: DEV, to: currentSource.address })) as T[];
      }
      throw new Error("unexpected batch");
    },
  };
  const collector = new DevMonitorCollector(DEFAULT_DEV_MONITOR_SETTINGS, {
    rpc,
    now: () => new Date("2026-09-06T00:00:00.000Z"),
  });
  for (const source of DEV_LAUNCH_SOURCES) {
    currentSource = source;
    const decoded = await collector.scanLaunchSource(source, 9_000_000, 9_000_000);
    assert.equal(decoded.length, 1, source.id);
    assert.equal(decoded[0]?.address, TOKEN, source.id);
    assert.equal(decoded[0]?.creator, DEV, source.id);
    if (source.id === "long") assert.notEqual(decoded[0]?.address, ROUTER);
    assert.equal(
      decoded[0]?.attributionConfidence,
      source.id === "long" ? "medium" : "high",
      source.id,
    );
  }
});

test("buy classifier requires receipt success, token net inflow, payment, and direct DEV sender", async () => {
  const transferLog: PairV2RpcLog & { blockHash: string } = {
    address: TOKEN,
    topics: [TRANSFER_TOPIC, topic(ROUTER), topic(DEV)],
    data: uint(2n * 10n ** 18n),
    blockNumber: "0x64",
    blockHash: BLOCK_HASH,
    transactionHash: TX_HASH,
    logIndex: "0x1",
  };
  const rpc: PairV2Rpc = {
    call: async <T>(method: string) => {
      if (method === "eth_blockNumber") return "0x66" as T;
      if (method === "eth_getLogs") return [transferLog] as T;
      throw new Error(`unexpected ${method}`);
    },
    batch: async <T>(calls: Array<{ method: string; params: unknown[] }>) => {
      switch (calls[0]?.method) {
        case "eth_getTransactionReceipt":
          return [
            {
              transactionHash: TX_HASH,
              status: "0x1",
              blockNumber: "0x64",
              blockHash: BLOCK_HASH,
              logs: [transferLog],
            },
          ] as T[];
        case "eth_getTransactionByHash":
          return [
            {
              hash: TX_HASH,
              from: DEV,
              to: ROUTER,
              value: "0xde0b6b3a7640000",
              blockNumber: "0x64",
              blockHash: BLOCK_HASH,
            },
          ] as T[];
        case "eth_getBlockByNumber":
          return [{ timestamp: "0x68bd1100" }] as T[];
        case "eth_call":
          return calls.map((call) =>
            (call.params[0] as { data: string }).data === "0x313ce567"
              ? uint(18n)
              : dynamicString("ALPHA"),
          ) as T[];
        default:
          throw new Error(`unexpected batch ${calls[0]?.method}`);
      }
    },
  };
  const collector = new DevMonitorCollector(DEFAULT_DEV_MONITOR_SETTINGS, { rpc });
  assert.equal(await collector.confirmedHead(), 100);
  const activities = await collector.scanBuys(100, 100, [profile()], [project()]);
  assert.equal(activities.length, 1);
  assert.equal(activities[0]?.confidence, "high");
  assert.equal(activities[0]?.targetAmount, 2);
  assert.equal(activities[0]?.quoteAmount, 1);
});

test("DexScreener enrichment updates only matched Robinhood base tokens", async () => {
  const collector = new DevMonitorCollector(DEFAULT_DEV_MONITOR_SETTINGS, {
    rpc: { call: async <T>() => "0x0" as T },
    fetcher: async () =>
      Response.json({
        pairs: [
          {
            chainId: "robinhood",
            baseToken: { address: TOKEN, symbol: "ALPHA" },
            marketCap: 60_000,
            liquidity: { usd: 20_000 },
            volume: { h24: 40_000 },
          },
        ],
      }),
  });
  const enrichment = await collector.enrichProjects([
    project({ marketCapUsd: null, liquidityUsd: null, volume24hUsd: null }),
  ]);
  const updates = enrichment.updates;
  assert.equal(enrichment.failedBatches, 0);
  assert.equal(updates[0]?.marketCapUsd, 60_000);
  assert.equal(updates[0]?.liquidityUsd, 20_000);
  assert.equal(updates[0]?.volume24hUsd, 40_000);
});

test("DexScreener enrichment preserves successful batches when another batch is throttled", async () => {
  const projects = Array.from({ length: 31 }, (_value, index) =>
    project({
      address: `0x${(index + 1).toString(16).padStart(40, "0")}`,
      blockNumber: index,
      marketCapUsd: null,
      liquidityUsd: null,
      volume24hUsd: null,
    }),
  );
  let requests = 0;
  const collector = new DevMonitorCollector(DEFAULT_DEV_MONITOR_SETTINGS, {
    rpc: { call: async <T>() => "0x0" as T },
    wait: async () => undefined,
    fetcher: async () => {
      requests += 1;
      if (requests <= 2) return new Response("rate limited", { status: 429 });
      return Response.json({
        pairs: [
          {
            chainId: "robinhood",
            baseToken: { address: projects[0]?.address, symbol: "SURVIVOR" },
            marketCap: 12_000,
            liquidity: { usd: 4_000 },
            volume: { h24: 8_000 },
          },
        ],
      });
    },
  });

  const enrichment = await collector.enrichProjects(projects);
  assert.equal(enrichment.totalBatches, 2);
  assert.equal(enrichment.failedBatches, 1);
  assert.equal(enrichment.successfulBatches, 1);
  assert.equal(enrichment.updates.length, 1);
  assert.equal(enrichment.updates[0]?.symbol, "SURVIVOR");
  assert.equal(requests, 3);
});

test("alerts suppress baselines and initial buys but send selected launches and buys", () => {
  assert.deepEqual(
    planDevMonitorAlerts({
      baselineComplete: false,
      previousProfiles: [],
      currentProfiles: [profile()],
      insertedProjects: [project()],
      insertedActivities: [activity()],
      createdAt: "2026-09-06T00:03:00.000Z",
    }),
    [],
  );
  const candidate = profile({ tier: "candidate" });
  const alerts = planDevMonitorAlerts({
    baselineComplete: true,
    previousProfiles: [candidate, profile({ address: ROUTER })],
    currentProfiles: [profile(), profile({ address: ROUTER })],
    insertedProjects: [project({ creator: ROUTER })],
    insertedActivities: [activity(), activity({ id: "initial", type: "initial_buy" })],
    createdAt: "2026-09-06T00:03:00.000Z",
  });
  assert.deepEqual(
    alerts.map((item) => item.type).sort(),
    ["developer_buy", "developer_launch"].sort(),
  );
  assert.deepEqual(alerts.map((item) => item.createdAt).sort(), [
    "2026-09-06T00:00:00.000Z",
    "2026-09-06T00:02:00.000Z",
  ]);
});

test("attention policy excludes repeat factories, spammy proven creators, and unknown buy targets", () => {
  const repeat = profile({ tier: "repeat", launchCount: 3, successfulLaunchCount: 2 });
  const spammy = profile({
    address: ROUTER,
    launchCount: 100,
    successfulLaunchCount: 2,
    qualifiedLaunchCount: 0,
  });
  const alerts = planDevMonitorAlerts({
    baselineComplete: true,
    previousProfiles: [repeat, spammy],
    currentProfiles: [repeat, spammy, profile()],
    insertedProjects: [project(), project({ creator: ROUTER, address: ROUTER })],
    insertedActivities: [
      activity({ id: "known" }),
      activity({ id: "unknown", targetPlatform: null }),
      activity({ id: "spam", developer: ROUTER }),
    ],
    createdAt: "2026-09-06T00:03:00.000Z",
  });
  assert.deepEqual(
    alerts.map((item) => item.dedupeKey),
    ["developer_buy:known"],
  );
});

test("database persists deduplicated evidence and notifier records Feishu readback", async () => {
  const directory = mkdtempSync(join(tmpdir(), "dev-monitor-"));
  const database = new DevMonitorDatabase(join(directory, "test.sqlite"));
  const bodies: unknown[] = [];
  try {
    database.setCursor("long", 100, "2026-09-06T00:00:00.000Z");
    assert.equal(database.cursor("long"), 100);
    assert.equal(database.upsertProjects([project()]).length, 1);
    assert.equal(database.upsertProjects([project()]).length, 0);
    database.saveProfiles([profile()]);
    assert.equal(database.profiles()[0]?.tier, "proven");
    assert.equal(database.upsertActivities([activity(), activity()]).length, 1);
    database.enqueueAlerts([
      {
        dedupeKey: "test:1",
        severity: "warning",
        type: "developer_buy",
        title: "test",
        message: "message",
        developer: DEV,
        project: TOKEN,
        transactionHash: TX_HASH,
        createdAt: "2026-09-06T00:00:00.000Z",
      },
    ]);
    const notifier = new DevMonitorFeishuNotifier(
      {
        feishuWebhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/test",
        requestTimeoutMs: 1_000,
      },
      {
        now: () => new Date("2026-09-06T00:01:00.000Z"),
        fetcher: async (_url, init) => {
          bodies.push(JSON.parse(String(init?.body)));
          return Response.json({ code: 0 });
        },
      },
    );
    await notifier.flush(database);
    assert.equal(bodies.length, 1);
    assert.equal(database.alertSummary(true).lastSentAt, "2026-09-06T00:01:00.000Z");
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("outbox applies developer cooldown, expiry, batching, and an hourly attention budget", async () => {
  const directory = mkdtempSync(join(tmpdir(), "dev-monitor-attention-"));
  const database = new DevMonitorDatabase(join(directory, "test.sqlite"));
  const bodies: Array<{ content?: { text?: string } }> = [];
  const now = new Date("2026-09-06T02:00:00.000Z");
  const alert = (key: string, developer: string, createdAt: string) => ({
    dedupeKey: key,
    severity: "warning" as const,
    type: "developer_buy" as const,
    title: "test",
    message: "message",
    developer,
    project: TOKEN,
    transactionHash: TX_HASH,
    createdAt,
  });
  try {
    assert.equal(
      database.enqueueAlerts(
        [
          alert(
            "expired",
            "0x0000000000000000000000000000000000000001",
            "2026-09-06T01:30:00.000Z",
          ),
          alert("first", DEV, "2026-09-06T01:59:00.000Z"),
          alert("cooldown", DEV, "2026-09-06T01:59:30.000Z"),
          alert("second", ROUTER, "2026-09-06T01:59:45.000Z"),
          alert("third", "0x4444444444444444444444444444444444444444", "2026-09-06T01:59:50.000Z"),
        ],
        60,
      ),
      4,
    );
    const notifier = new DevMonitorFeishuNotifier(
      {
        feishuWebhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/test",
        requestTimeoutMs: 1_000,
        alertMaxAgeMinutes: 15,
        alertHourlyLimit: 2,
        alertBatchSize: 3,
      },
      {
        now: () => now,
        fetcher: async (_url, init) => {
          bodies.push(JSON.parse(String(init?.body)) as { content?: { text?: string } });
          return Response.json({ code: 0 });
        },
      },
    );
    await notifier.flush(database);
    await notifier.flush(database);
    assert.equal(bodies.length, 1);
    assert.match(bodies[0]?.content?.text ?? "", /2 条精选信号/);
    assert.deepEqual(database.alertSummary(true), {
      configured: true,
      pending: 1,
      failed: 0,
      suppressed: 1,
      lastSentAt: now.toISOString(),
    });
    assert.equal(database.suppressUnsentAlerts(now.toISOString(), "manual_test"), 1);
    assert.equal(database.alertSummary(true).pending, 0);
    assert.equal(database.alertSummary(true).suppressed, 2);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("existing outbox databases migrate without losing historical rows", () => {
  const directory = mkdtempSync(join(tmpdir(), "dev-monitor-migration-"));
  const databasePath = join(directory, "test.sqlite");
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE dev_monitor_alert_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dedupe_key TEXT NOT NULL UNIQUE,
      severity TEXT NOT NULL,
      alert_type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      developer TEXT NOT NULL,
      project TEXT,
      transaction_hash TEXT,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      last_error TEXT,
      sent_at TEXT
    );
    INSERT INTO dev_monitor_alert_outbox(
      dedupe_key, severity, alert_type, title, message, developer, created_at
    ) VALUES (
      'legacy:1', 'warning', 'developer_launch', 'legacy', 'legacy',
      '${DEV}', '2026-09-06T00:00:00.000Z'
    );
  `);
  legacy.close();

  const database = new DevMonitorDatabase(databasePath);
  try {
    assert.equal(database.alertSummary(false).pending, 1);
    assert.equal(database.suppressUnsentAlerts("2026-09-07T00:00:00.000Z", "legacy_backlog"), 1);
    assert.deepEqual(database.alertSummary(false), {
      configured: false,
      pending: 0,
      failed: 0,
      suppressed: 1,
      lastSentAt: null,
    });
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("ordinary launches wait for the delivery window while verified buys bypass it", async () => {
  const directory = mkdtempSync(join(tmpdir(), "dev-monitor-delivery-window-"));
  const database = new DevMonitorDatabase(join(directory, "test.sqlite"));
  const bodies: unknown[] = [];
  let current = new Date("2026-09-06T02:00:00.000Z");
  const enqueue = (
    dedupeKey: string,
    type: "developer_launch" | "developer_buy",
    developer: string,
  ) =>
    database.enqueueAlerts([
      {
        dedupeKey,
        severity: "warning",
        type,
        title: type,
        message: "message",
        developer,
        project: TOKEN,
        transactionHash: TX_HASH,
        createdAt: current.toISOString(),
      },
    ]);
  try {
    const notifier = new DevMonitorFeishuNotifier(
      {
        feishuWebhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/test",
        requestTimeoutMs: 1_000,
        alertMaxAgeMinutes: 45,
        alertHourlyLimit: 10,
        alertBatchSize: 3,
        alertDeliveryCooldownMinutes: 20,
      },
      {
        now: () => current,
        fetcher: async (_url, init) => {
          bodies.push(JSON.parse(String(init?.body)));
          return Response.json({ code: 0 });
        },
      },
    );
    enqueue("launch:first", "developer_launch", DEV);
    await notifier.flush(database);
    current = new Date("2026-09-06T02:05:00.000Z");
    enqueue("launch:second", "developer_launch", ROUTER);
    await notifier.flush(database);
    assert.equal(bodies.length, 1);
    assert.equal(database.alertSummary(true).pending, 1);

    current = new Date("2026-09-06T02:06:00.000Z");
    enqueue("buy:urgent", "developer_buy", DEV);
    await notifier.flush(database);
    assert.equal(bodies.length, 2);
    assert.equal(database.alertSummary(true).pending, 0);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("service creates a no-spam baseline, then alerts when an existing proven DEV launches again", async () => {
  const directory = mkdtempSync(join(tmpdir(), "dev-monitor-service-"));
  const database = new DevMonitorDatabase(join(directory, "test.sqlite"));
  const sent: unknown[] = [];
  let head = 100;
  try {
    const settings = {
      ...DEFAULT_DEV_MONITOR_SETTINGS,
      enabled: true,
      launchBootstrapBlocks: 10,
      feishuWebhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/test",
    };
    const collector = {
      confirmedHead: async () => head,
      scanLaunchSource: async (source: (typeof DEV_LAUNCH_SOURCES)[number]) =>
        head > 100 && source.id === "pons_v1_active"
          ? [
              project({
                address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                platform: "pons_v1",
                launchId: `4663:0x${"c".repeat(64)}:1`,
                transactionHash: `0x${"c".repeat(64)}`,
                blockNumber: 109,
                launchedAt: "2026-09-06T00:05:00.000Z",
                symbol: "NEXT",
                marketCapUsd: null,
                liquidityUsd: null,
                volume24hUsd: null,
                qualityQualified: null,
              }),
            ]
          : [],
      enrichProjects: async () => ({
        updates: [],
        requestedProjects: 0,
        totalBatches: 0,
        successfulBatches: 0,
        failedBatches: 0,
      }),
      scanBuys: async () => [],
    } as unknown as DevMonitorCollector;
    const notifier = new DevMonitorFeishuNotifier(settings, {
      now: () => new Date("2026-09-06T00:10:00.000Z"),
      fetcher: async (_url, init) => {
        sent.push(JSON.parse(String(init?.body)));
        return Response.json({ code: 0 });
      },
    });
    const pairDashboard = {
      events: [
        {
          id: `4663:${TX_HASH}:1`,
          type: "launch",
          project: TOKEN,
          actor: DEV,
          transactionHash: TX_HASH,
          blockNumber: 90,
          timestamp: "2026-09-06T00:00:00.000Z",
        },
      ],
      tokens: [
        {
          address: TOKEN,
          creator: DEV,
          symbol: "ALPHA",
          marketCapUsd: 50_000,
          liquidityUsd: 15_000,
          volume24hUsd: 30_000,
          alpha: { quality: { state: "qualified" } },
        },
      ],
      overview: { latestBlock: 100 },
    } as unknown as PairV2DashboardResponse;
    const service = new DevMonitorService(
      database,
      settings,
      { snapshot: () => pairDashboard },
      { collector, notifier, now: () => new Date("2026-09-06T00:10:00.000Z") },
    );
    const baseline = await service.refresh();
    assert.equal(baseline.baselineComplete, true);
    assert.equal(baseline.counts.proven, 1);
    assert.equal(sent.length, 0);
    const pairLaunches = service.pairLaunches({ tier: "all", limit: 20, offset: 0 });
    assert.equal(pairLaunches.scope, "pair_v2_public_launches");
    assert.equal(pairLaunches.total, 1);
    assert.equal(pairLaunches.counts.proven, 1);
    assert.equal(pairLaunches.items[0]?.address, TOKEN);
    assert.equal(pairLaunches.items[0]?.creator, DEV);
    assert.equal(pairLaunches.items[0]?.creatorTier, "proven");
    assert.equal(pairLaunches.items[0]?.priceUsd, null);
    head = 110;
    const second = await service.refresh();
    assert.equal(second.status, "success");
    assert.equal(sent.length, 1);
    assert.match(JSON.stringify(sent[0]), /新发币/);
    assert.equal(service.health().counts.projects, 2);
    service.stop();
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("DEV buy catch-up advances in bounded segments without replaying historical alerts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "dev-monitor-buy-catchup-"));
  const database = new DevMonitorDatabase(join(directory, "test.sqlite"));
  const sent: unknown[] = [];
  const scannedRanges: Array<[number, number]> = [];
  let head = 10_000;
  try {
    const settings = {
      ...DEFAULT_DEV_MONITOR_SETTINGS,
      enabled: true,
      launchBootstrapBlocks: 10,
      buyCatchupBlocksPerPoll: 2_000,
      feishuWebhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/test",
    };
    let rejectLargeRange = true;
    const collector = {
      confirmedHead: async () => head,
      scanLaunchSource: async () => [],
      enrichProjects: async () => ({
        updates: [],
        requestedProjects: 0,
        totalBatches: 0,
        successfulBatches: 0,
        failedBatches: 0,
      }),
      scanBuys: async (fromBlock: number, toBlock: number) => {
        scannedRanges.push([fromBlock, toBlock]);
        if (rejectLargeRange && toBlock - fromBlock + 1 > 1_000) {
          rejectLargeRange = false;
          throw new Error("RPC batch HTTP 429");
        }
        return [
          activity({
            id: `buy:${String(fromBlock)}:${String(toBlock)}`,
            blockNumber: toBlock,
            timestamp: "2026-09-06T00:09:00.000Z",
          }),
        ];
      },
    } as unknown as DevMonitorCollector;
    const notifier = new DevMonitorFeishuNotifier(settings, {
      now: () => new Date("2026-09-06T00:10:00.000Z"),
      fetcher: async (_url, init) => {
        sent.push(JSON.parse(String(init?.body)));
        return Response.json({ code: 0 });
      },
    });
    const pairDashboard = {
      events: [
        {
          id: `4663:${TX_HASH}:1`,
          type: "launch",
          project: TOKEN,
          actor: DEV,
          transactionHash: TX_HASH,
          blockNumber: 90,
          timestamp: "2026-09-06T00:00:00.000Z",
        },
      ],
      tokens: [
        {
          address: TOKEN,
          creator: DEV,
          symbol: "ALPHA",
          marketCapUsd: 50_000,
          liquidityUsd: 15_000,
          volume24hUsd: 30_000,
          alpha: { quality: { state: "qualified" } },
        },
      ],
      overview: { latestBlock: head },
    } as unknown as PairV2DashboardResponse;
    const service = new DevMonitorService(
      database,
      settings,
      { snapshot: () => pairDashboard },
      {
        collector,
        notifier,
        now: () => new Date("2026-09-06T00:10:00.000Z"),
        wait: async () => undefined,
      },
    );

    await service.refresh();
    database.setCursor("dev_buys", 100, "2026-09-06T00:10:00.000Z");
    head = 10_100;
    const catchingUp = await service.refresh();
    assert.deepEqual(scannedRanges.slice(0, 2), [
      [89, 2_088],
      [89, 1_088],
    ]);
    assert.equal(database.cursor("dev_buys"), 1_088);
    assert.equal(catchingUp.sources.find((source) => source.id === "dev_buys")?.status, "degraded");
    assert.match(
      catchingUp.sources.find((source) => source.id === "dev_buys")?.message ?? "",
      /历史信号仅入证据账本/,
    );
    assert.equal(database.activityCount(), 1);
    assert.equal(sent.length, 0);

    database.setCursor("dev_buys", 10_000, "2026-09-06T00:10:00.000Z");
    const current = await service.refresh();
    assert.deepEqual(scannedRanges[2], [9_989, 10_100]);
    assert.equal(database.cursor("dev_buys"), 10_100);
    assert.equal(current.sources.find((source) => source.id === "dev_buys")?.status, "ok");
    assert.equal(sent.length, 1);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("DEV buy monitor records an oversized gap and restores the live cursor without replay", async () => {
  const directory = mkdtempSync(join(tmpdir(), "dev-monitor-buy-gap-"));
  const database = new DevMonitorDatabase(join(directory, "test.sqlite"));
  const sent: unknown[] = [];
  const scannedRanges: Array<[number, number]> = [];
  let head = 10_000;
  try {
    const settings = {
      ...DEFAULT_DEV_MONITOR_SETTINGS,
      enabled: true,
      launchBootstrapBlocks: 10,
      buyMaxRecoverableLagBlocks: 5_000,
      feishuWebhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/test",
    };
    const collector = {
      confirmedHead: async () => head,
      scanLaunchSource: async () => [],
      enrichProjects: async () => ({
        updates: [],
        requestedProjects: 0,
        totalBatches: 0,
        successfulBatches: 0,
        failedBatches: 0,
      }),
      scanBuys: async (fromBlock: number, toBlock: number) => {
        scannedRanges.push([fromBlock, toBlock]);
        return [
          activity({
            id: `live:${String(fromBlock)}:${String(toBlock)}`,
            blockNumber: toBlock,
            timestamp: "2026-09-06T00:09:00.000Z",
          }),
        ];
      },
    } as unknown as DevMonitorCollector;
    const notifier = new DevMonitorFeishuNotifier(settings, {
      now: () => new Date("2026-09-06T00:10:00.000Z"),
      fetcher: async (_url, init) => {
        sent.push(JSON.parse(String(init?.body)));
        return Response.json({ code: 0 });
      },
    });
    const pairDashboard = {
      events: [
        {
          id: `4663:${TX_HASH}:1`,
          type: "launch",
          project: TOKEN,
          actor: DEV,
          transactionHash: TX_HASH,
          blockNumber: 90,
          timestamp: "2026-09-06T00:00:00.000Z",
        },
      ],
      tokens: [
        {
          address: TOKEN,
          creator: DEV,
          symbol: "ALPHA",
          marketCapUsd: 50_000,
          liquidityUsd: 15_000,
          volume24hUsd: 30_000,
          alpha: { quality: { state: "qualified" } },
        },
      ],
      overview: { latestBlock: head },
    } as unknown as PairV2DashboardResponse;
    const service = new DevMonitorService(
      database,
      settings,
      { snapshot: () => pairDashboard },
      { collector, notifier, now: () => new Date("2026-09-06T00:10:00.000Z") },
    );

    await service.refresh();
    database.setCursor("dev_buys", 100, "2026-09-06T00:10:00.000Z");
    head = 10_100;
    const recovered = await service.refresh();
    assert.equal(database.cursor("dev_buys"), 10_100);
    assert.equal(scannedRanges.length, 0);
    assert.equal(recovered.sources.find((source) => source.id === "dev_buys")?.status, "degraded");
    assert.match(
      recovered.sources.find((source) => source.id === "dev_buys")?.message ?? "",
      /未回填历史证据区间/,
    );
    assert.deepEqual(JSON.parse(database.state("dev_buys_last_gap") ?? "{}"), {
      fromBlock: 101,
      toBlock: 10_100,
      recordedAt: "2026-09-06T00:10:00.000Z",
    });
    assert.equal(sent.length, 0);

    head = 10_120;
    const live = await service.refresh();
    assert.deepEqual(scannedRanges, [[10_089, 10_120]]);
    assert.equal(database.cursor("dev_buys"), 10_120);
    assert.equal(live.sources.find((source) => source.id === "dev_buys")?.status, "ok");
    assert.equal(sent.length, 1);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("PAIR team launch feed separates the official protocol token from same-wallet launches", () => {
  const directory = mkdtempSync(join(tmpdir(), "pair-team-launches-"));
  const database = new DevMonitorDatabase(join(directory, "test.sqlite"));
  const teamToken = "0x5422663e07d6fc217b0af4532fb1a6c9c7de5555";
  const teamTransaction = `0x${"d".repeat(64)}`;
  const observedAt = "2026-09-06T01:00:00.000Z";
  try {
    const pairDashboard = {
      observedAt,
      events: [
        {
          id: `4663:${teamTransaction}:1`,
          type: "launch",
          project: teamToken,
          actor: PAIR_PRIMARY_ISSUER.address,
          transactionHash: teamTransaction,
          blockNumber: 55_741_428,
          timestamp: "2026-09-06T05:51:28.000Z",
        },
      ],
      tokens: [
        {
          address: teamToken,
          creator: PAIR_PRIMARY_ISSUER.address,
          name: "asd",
          symbol: "asd",
          canonical: true,
          priceUsd: 0.0005,
          marketCapUsd: 500_000,
          liquidityUsd: 80_000,
          volume24hUsd: 1_200_000,
          holderCount: null,
          pools: [
            {
              positionId: "1",
              poolId: `0x${"e".repeat(64)}`,
              canonical: true,
              quote: {
                address: `0x${"a".repeat(40)}`,
                symbol: "SPCX",
                decimals: 18,
              },
            },
          ],
          modeId: 1,
          modeLabel: "费用分账",
          alpha: { quality: { state: "qualified" } },
        },
      ],
      overview: { latestBlock: 55_741_500 },
    } as unknown as PairV2DashboardResponse;
    const projects = pairV2Projects(pairDashboard, observedAt);
    database.upsertProjects(projects);
    database.saveProfiles(deriveDevProfiles(projects, observedAt));
    const service = new DevMonitorService(
      database,
      DEFAULT_DEV_MONITOR_SETTINGS,
      { snapshot: () => pairDashboard },
      {
        now: () => new Date(observedAt),
        pairTokens: {
          token: (address) =>
            address.toLowerCase() === PAIR_OFFICIAL_PROTOCOL_TOKEN.address
              ? ({
                  address: PAIR_OFFICIAL_PROTOCOL_TOKEN.address,
                  name: "PAIR",
                  symbol: "PAIR",
                  priceUsd: 0.005,
                  marketCapUsd: 5_000_000,
                  liquidityDepthUsd: 120_000,
                  volume24hUsd: 900_000,
                  holderCount: 4_000,
                  quoteAssets: [{ address: `0x${"b".repeat(40)}`, symbol: "SPY", decimals: 18 }],
                  marketDataUpdatedAt: observedAt,
                  observedAt,
                } as never)
              : null,
        },
      },
    );

    const response = service.pairTeamLaunches({ limit: 20, offset: 0 });
    assert.equal(response.scope, "pair_official_team_launches");
    assert.equal(response.issuer.address, PAIR_PRIMARY_ISSUER.address);
    assert.equal(response.total, 2);
    assert.deepEqual(response.counts, {
      officialProtocolTokens: 1,
      verifiedIssuerWalletLaunches: 1,
    });
    assert.equal(response.items[0]?.address, teamToken);
    assert.equal(response.items[0]?.relationship, "verified_issuer_wallet_launch");
    assert.equal(response.items[0]?.officiallyConfirmed, false);
    assert.equal(response.items[0]?.quoteAssets[0]?.symbol, "SPCX");
    assert.equal(response.items[1]?.address, PAIR_OFFICIAL_PROTOCOL_TOKEN.address);
    assert.equal(response.items[1]?.relationship, "official_protocol_token");
    assert.equal(response.items[1]?.holderCount, 4_000);
    assert.equal(response.items[1]?.quoteAssets[0]?.symbol, "SPY");
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("service treats a delayed PAIR V2 snapshot as source baseline without historical alert spam", async () => {
  const directory = mkdtempSync(join(tmpdir(), "dev-monitor-delayed-pair-"));
  const database = new DevMonitorDatabase(join(directory, "test.sqlite"));
  const sent: unknown[] = [];
  let pairDashboard: PairV2DashboardResponse | null = null;
  try {
    const settings = {
      ...DEFAULT_DEV_MONITOR_SETTINGS,
      enabled: true,
      launchBootstrapBlocks: 10,
      feishuWebhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/test",
    };
    const collector = {
      confirmedHead: async () => 100,
      scanLaunchSource: async () => [],
      enrichProjects: async () => ({
        updates: [],
        requestedProjects: 0,
        totalBatches: 0,
        successfulBatches: 0,
        failedBatches: 0,
      }),
      scanBuys: async () => [],
    } as unknown as DevMonitorCollector;
    const notifier = new DevMonitorFeishuNotifier(settings, {
      fetcher: async (_url, init) => {
        sent.push(JSON.parse(String(init?.body)));
        return Response.json({ code: 0 });
      },
    });
    const service = new DevMonitorService(
      database,
      settings,
      { snapshot: () => pairDashboard },
      { collector, notifier, now: () => new Date("2026-09-06T00:10:00.000Z") },
    );

    await service.refresh();
    pairDashboard = {
      events: [
        {
          id: `4663:${TX_HASH}:1`,
          type: "launch",
          project: TOKEN,
          actor: DEV,
          transactionHash: TX_HASH,
          blockNumber: 90,
          timestamp: "2026-09-06T00:00:00.000Z",
        },
      ],
      tokens: [
        {
          address: TOKEN,
          creator: DEV,
          symbol: "ALPHA",
          marketCapUsd: 50_000,
          liquidityUsd: 15_000,
          volume24hUsd: 30_000,
          alpha: { quality: { state: "qualified" } },
        },
      ],
      overview: { latestBlock: 100 },
    } as unknown as PairV2DashboardResponse;

    const delayedBaseline = await service.refresh();
    assert.equal(delayedBaseline.counts.proven, 1);
    assert.equal(sent.length, 0);
    assert.equal(delayedBaseline.alerts.pending, 0);
    assert.equal(database.state("pair_v2_baseline_complete"), "1");
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
