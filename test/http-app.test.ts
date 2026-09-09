import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  createDashboardRequestHandler,
  type ChainDailyHttpApi,
  type DashboardHttpApi,
  type DevMonitorHttpApi,
  type EconomicsHttpApi,
  type IntelligenceHttpApi,
  type LongTokenHttpApi,
  type PairFlowHttpApi,
  type PlatformVolumeAlertHttpApi,
  type PairTokenHttpApi,
  type PairV2HttpApi,
  type ProductHttpApi,
} from "../src/http/app.js";

interface TestContext {
  baseUrl: string;
  port: number;
  events: Array<{ event: string; context: Record<string, unknown> }>;
}

function fakeDashboard(overrides: Partial<DashboardHttpApi> = {}): DashboardHttpApi {
  return {
    health: () => ({ ok: true, service: "fixture" }),
    meta: () => ({ route: "meta", apiContractVersion: 1 }),
    overview: (windowDays) => ({ route: "overview", windowDays }),
    platformActivity: () => ({ route: "platform-activity" }),
    platformDetail: (platformId) =>
      platformId === "pons" ? { route: "platform", platformId } : null,
    coverage: () => ({ route: "coverage" }),
    sources: () => ({ route: "sources" }),
    refresh: async () => ({ route: "refresh" }),
    ...overrides,
  };
}

function fakePair(overrides: Partial<PairTokenHttpApi> = {}): PairTokenHttpApi {
  return {
    health: () => ({ ok: true, service: "pair-fixture" }),
    rankings: () => ({ route: "pair-rankings" }),
    latestDailyReport: () => ({ route: "pair-report" }),
    sources: () => ({ route: "pair-sources" }),
    refresh: async () => ({ route: "pair-refresh" }),
    generateDailyReport: () => ({ route: "pair-generate" }),
    ...overrides,
  };
}

function fakeLong(overrides: Partial<LongTokenHttpApi> = {}): LongTokenHttpApi {
  return {
    health: () => ({ ok: true, service: "long-fixture" }),
    rankings: () => ({ route: "long-rankings" }),
    latestDailyReport: () => ({ route: "long-report" }),
    sources: () => ({ route: "long-sources" }),
    refresh: async () => ({ route: "long-refresh" }),
    generateDailyReport: () => ({ route: "long-generate" }),
    ...overrides,
  };
}

function fakePairFlow(overrides: Partial<PairFlowHttpApi> = {}): PairFlowHttpApi {
  return {
    health: () => ({ ok: true, service: "pair-flow-fixture" }),
    ensureFresh: async () => ({ route: "pair-flow" }),
    refresh: async () => ({ route: "pair-flow-refresh" }),
    events: async (query) => ({ route: "pair-flow-events", query }),
    ...overrides,
  };
}

function fakePairV2(overrides: Partial<PairV2HttpApi> = {}): PairV2HttpApi {
  const token = {
    address: "0x1111111111111111111111111111111111115555",
  } as ReturnType<PairV2HttpApi["token"]>;
  const alphaToken = {
    address: "0x350cadde605e083f58d286e8b3a6b086685fa1ec",
  } as ReturnType<PairV2HttpApi["alphaToken"]>;
  const alpha = { route: "pair-alpha" } as never;
  return {
    health: () => ({ ok: true, service: "pair-v2-fixture" }),
    ensureFresh: async () => ({ route: "pair-v2" }) as never,
    refresh: async () => ({ route: "pair-v2-refresh" }) as never,
    token: (address) => (address === token?.address ? token : null),
    alpha: () => alpha,
    alphaToken: (address) => (address === alphaToken?.address ? alphaToken : null),
    events: (limit) => ({ observedAt: null, items: [{ limit }] }) as never,
    ...overrides,
  };
}

function fakeDevMonitor(overrides: Partial<DevMonitorHttpApi> = {}): DevMonitorHttpApi {
  return {
    health: () => ({
      service: "rhc-dev-monitor",
      enabled: true,
      generatedAt: "2026-09-06T00:00:00.000Z",
      observedAt: "2026-09-06T00:00:00.000Z",
      status: "success",
      latestConfirmedBlock: 12_345_678,
      pollSeconds: 8,
      confirmations: 2,
      baselineComplete: true,
      counts: {
        projects: 109,
        candidates: 4,
        repeat: 2,
        proven: 1,
        watched: 3,
        buys: 0,
      },
      alerts: {
        configured: true,
        policy: "pair_team_wallet_only",
        pending: 0,
        failed: 0,
        suppressed: 0,
        lastSentAt: null,
      },
      sources: [],
      warnings: [],
    }),
    pairLaunches: (query) => ({
      service: "rhc-dev-monitor",
      scope: "pair_v2_public_launches",
      generatedAt: "2026-09-06T00:00:00.000Z",
      observedAt: "2026-09-06T00:00:00.000Z",
      tier: query.tier,
      limit: query.limit,
      offset: query.offset,
      total: 1,
      counts: { all: 1, candidate: 0, repeat: 0, proven: 1, watched: 1 },
      items: [
        {
          address: "0x2222222222222222222222222222222222225555",
          name: "Alpha",
          symbol: "ALPHA",
          creator: "0x1111111111111111111111111111111111111111",
          creatorTier: "proven",
          creatorScore: 100,
          creatorLabel: "ALPHA 创建者",
          creatorLaunchCount: 1,
          creatorQualifiedLaunchCount: 1,
          creatorSuccessfulLaunchCount: 1,
          transactionHash: `0x${"a".repeat(64)}`,
          blockNumber: 12_345_600,
          launchedAt: "2026-09-06T00:00:00.000Z",
          attributionConfidence: "high",
          modeId: 2,
          modeLabel: "回购销毁",
          priceUsd: 0.001,
          marketCapUsd: 50_000,
          liquidityUsd: 15_000,
          volume24hUsd: 30_000,
          holderCount: 100,
          quoteAssets: [{ address: `0x${"c".repeat(40)}`, symbol: "SPCX", decimals: 18 }],
          qualityQualified: true,
        },
      ],
    }),
    pairTeamLaunches: (query) => ({
      service: "rhc-dev-monitor",
      scope: "pair_official_team_launches",
      generatedAt: "2026-09-06T00:00:00.000Z",
      observedAt: "2026-09-06T00:00:00.000Z",
      issuer: {
        address: "0xa15e4ad0dbc8df1715a7b254526252cd93bb1102",
        label: "PAIR 主发行钱包",
        verification: "verified_primary_issuer",
        evidence: [],
      },
      limit: query.limit,
      offset: query.offset,
      total: 1,
      counts: { officialProtocolTokens: 1, verifiedIssuerWalletLaunches: 0 },
      items: [
        {
          address: "0x6b1d42927b1a84ec28fa88d4fc6fa7af404966be",
          name: "PAIR",
          symbol: "PAIR",
          issuer: "0xa15e4ad0dbc8df1715a7b254526252cd93bb1102",
          issuerLabel: "PAIR 主发行钱包",
          relationship: "official_protocol_token",
          relationshipLabel: "官方协议代币",
          officiallyConfirmed: true,
          transactionHash: `0x${"b".repeat(64)}`,
          blockNumber: 49_391_541,
          launchedAt: "2026-08-29T19:07:54.000Z",
          modeId: null,
          modeLabel: null,
          priceUsd: 0.005,
          marketCapUsd: 5_000_000,
          liquidityUsd: 120_000,
          volume24hUsd: 900_000,
          holderCount: 4_000,
          quoteAssets: [{ address: `0x${"d".repeat(40)}`, symbol: "SPY", decimals: 18 }],
          marketObservedAt: "2026-09-06T00:00:00.000Z",
        },
      ],
      warnings: [],
    }),
    ...overrides,
  };
}

function fakeEconomics(overrides: Partial<EconomicsHttpApi> = {}): EconomicsHttpApi {
  return {
    health: () => ({ ok: true, service: "economics-fixture" }),
    snapshot: () => ({ route: "economics-snapshot" }),
    valuation: () => ({ route: "economics-valuation" }),
    valuationHistory: () => ({ route: "economics-valuation-history" }),
    sources: () => ({ route: "economics-sources" }),
    refresh: async () => ({ route: "economics-rebuild" }),
    refreshAll: async () => ({ route: "economics-refresh" }),
    ...overrides,
  };
}

function fakeIntelligence(overrides: Partial<IntelligenceHttpApi> = {}): IntelligenceHttpApi {
  return {
    health: () => ({ ok: true, service: "intelligence-fixture" }),
    ensureFresh: async () => ({ route: "intelligence-snapshot" }),
    refresh: async () => ({ route: "intelligence-refresh" }),
    ...overrides,
  };
}

function fakeProduct(overrides: Partial<ProductHttpApi> = {}): ProductHttpApi {
  return {
    health: () => ({ ok: true, service: "product-fixture" }),
    ensureFresh: async () => ({ route: "product-today" }),
    refresh: async () => ({ route: "product-refresh" }),
    ...overrides,
  };
}

function fakeChainDaily(overrides: Partial<ChainDailyHttpApi> = {}): ChainDailyHttpApi {
  return {
    latest: async () => ({
      targetDate: "2026-09-07",
      generatedAt: "2026-09-08T07:00:00.000Z",
      metrics: [],
    }),
    ...overrides,
  };
}

function fakePlatformVolumeAlert(
  overrides: Partial<PlatformVolumeAlertHttpApi> = {},
): PlatformVolumeAlertHttpApi {
  return {
    health: () => ({
      ok: true,
      service: "rhc-pair-daily-volume-alert",
      configured: true,
      thresholdPct: 10,
    }),
    ...overrides,
  };
}

async function withServer(
  run: (context: TestContext) => Promise<void>,
  dashboard = fakeDashboard(),
  pair?: PairTokenHttpApi,
  long?: LongTokenHttpApi,
  economics?: EconomicsHttpApi,
  intelligence?: IntelligenceHttpApi,
  pairFlow?: PairFlowHttpApi,
  pairV2?: PairV2HttpApi,
  devMonitor?: DevMonitorHttpApi,
  product?: ProductHttpApi,
  pairDailyVolumeAlerts?: PlatformVolumeAlertHttpApi,
  chainDaily: ChainDailyHttpApi = fakeChainDaily(),
): Promise<void> {
  const publicDirectory = mkdtempSync(join(tmpdir(), "rhc-http-"));
  writeFileSync(join(publicDirectory, "index.html"), "<h1>ledger</h1>");
  writeFileSync(join(publicDirectory, "app.js"), "console.log('ledger');");
  const events: TestContext["events"] = [];
  const server = createServer(
    createDashboardRequestHandler({
      dashboard,
      ...(pair ? { pair } : {}),
      ...(long ? { long } : {}),
      ...(economics ? { economics } : {}),
      ...(intelligence ? { intelligence } : {}),
      ...(pairFlow ? { pairFlow } : {}),
      ...(pairV2 ? { pairV2 } : {}),
      ...(devMonitor ? { devMonitor } : {}),
      ...(product ? { product } : {}),
      ...(pairDailyVolumeAlerts ? { pairDailyVolumeAlerts } : {}),
      chainDaily,
      publicDirectory,
      logger: {
        error(event, context) {
          events.push({ event, context });
        },
      },
    }),
  );

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = (address as AddressInfo).port;

  try {
    await run({ baseUrl: `http://127.0.0.1:${String(port)}`, port, events });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    rmSync(publicDirectory, { recursive: true, force: true });
  }
}

test("DEV monitor keeps health aggregate-only and exposes scoped PAIR launch records", async () => {
  await withServer(
    async ({ baseUrl }) => {
      for (const path of ["/api/dev-monitor/health", "/pair-v2/api/dev-monitor/health"]) {
        const response = await fetch(`${baseUrl}${path}`);
        assert.equal(response.status, 200);
        const body = (await response.json()) as Record<string, unknown>;
        assert.equal(body.service, "rhc-dev-monitor");
        assert.equal((body.alerts as Record<string, unknown>).configured, true);
        assert.equal("profiles" in body, false);
        assert.equal("activities" in body, false);
      }
      for (const path of [
        "/api/dev-monitor/pair-launches?tier=proven&limit=10&offset=0",
        "/pair-v2/api/dev-monitor/pair-launches?tier=proven&limit=10&offset=0",
      ]) {
        const response = await fetch(`${baseUrl}${path}`);
        assert.equal(response.status, 200);
        const body = (await response.json()) as Record<string, unknown>;
        assert.equal(body.scope, "pair_v2_public_launches");
        assert.equal(body.tier, "proven");
        assert.equal(body.limit, 10);
        assert.equal((body.items as unknown[]).length, 1);
        assert.equal("activities" in body, false);
      }
      const invalid = await fetch(`${baseUrl}/api/dev-monitor/pair-launches?tier=secret`);
      assert.equal(invalid.status, 400);
      assert.equal((await invalid.json()).code, "INVALID_PAIR_DEV_LAUNCH_QUERY");

      for (const path of [
        "/api/dev-monitor/pair-team-launches?limit=20&offset=0",
        "/pair-v2/api/dev-monitor/pair-team-launches?limit=20&offset=0",
      ]) {
        const response = await fetch(`${baseUrl}${path}`);
        assert.equal(response.status, 200);
        const body = (await response.json()) as Record<string, unknown>;
        assert.equal(body.scope, "pair_official_team_launches");
        assert.equal(
          (body.issuer as Record<string, unknown>).verification,
          "verified_primary_issuer",
        );
        assert.equal((body.items as unknown[]).length, 1);
        assert.equal("activities" in body, false);
      }
      const invalidTeamQuery = await fetch(`${baseUrl}/api/dev-monitor/pair-team-launches?limit=0`);
      assert.equal(invalidTeamQuery.status, 400);
      assert.equal((await invalidTeamQuery.json()).code, "INVALID_PAIR_TEAM_LAUNCH_QUERY");
    },
    fakeDashboard(),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    fakeDevMonitor(),
  );

  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/dev-monitor/health`);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "DEV_MONITOR_UNAVAILABLE");
  });
});

test("PAIR V2 and cross-generation Alpha routes expose isolated read models", async () => {
  await withServer(
    async ({ baseUrl }) => {
      assert.deepEqual(await (await fetch(`${baseUrl}/api/pair/v2/health`)).json(), {
        ok: true,
        service: "pair-v2-fixture",
      });
      assert.deepEqual(await (await fetch(`${baseUrl}/api/pair/v2`)).json(), {
        route: "pair-v2",
      });
      assert.deepEqual(await (await fetch(`${baseUrl}/api/pair/v2/events?limit=25`)).json(), {
        observedAt: null,
        items: [{ limit: 25 }],
      });
      assert.equal(
        (
          await (
            await fetch(`${baseUrl}/api/pair/v2/tokens/0x1111111111111111111111111111111111115555`)
          ).json()
        ).address,
        "0x1111111111111111111111111111111111115555",
      );
      assert.deepEqual(
        await (await fetch(`${baseUrl}/api/pair/v2/refresh`, { method: "POST" })).json(),
        { route: "pair-v2-refresh" },
      );
      assert.deepEqual(await (await fetch(`${baseUrl}/api/pair/alpha`)).json(), {
        route: "pair-alpha",
      });
      assert.equal(
        (
          await (
            await fetch(
              `${baseUrl}/pair-alpha/api/pair/alpha/tokens/0x350cadde605e083f58d286e8b3a6b086685fa1ec`,
            )
          ).json()
        ).address,
        "0x350cadde605e083f58d286e8b3a6b086685fa1ec",
      );
      assert.deepEqual(
        await (await fetch(`${baseUrl}/api/pair/alpha/refresh`, { method: "POST" })).json(),
        { route: "pair-alpha" },
      );
    },
    fakeDashboard(),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    fakePairV2(),
  );
});

test("PAIR V2 HTTP routes validate limits and addresses and fail explicitly when absent", async () => {
  await withServer(async ({ baseUrl }) => {
    const unavailable = await fetch(`${baseUrl}/api/pair/v2`);
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).code, "PAIR_V2_MODULE_UNAVAILABLE");
  });
  await withServer(
    async ({ baseUrl }) => {
      assert.equal((await fetch(`${baseUrl}/api/pair/v2/events?limit=0`)).status, 400);
      assert.equal((await fetch(`${baseUrl}/api/pair/v2/tokens/not-an-address`)).status, 400);
      assert.equal(
        (await fetch(`${baseUrl}/api/pair/v2/tokens/0x2222222222222222222222222222222222225555`))
          .status,
        404,
      );
    },
    fakeDashboard(),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    fakePairV2(),
  );
});

async function rawGet(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: "127.0.0.1", port, path, method: "GET" }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        resolve({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    request.on("error", reject);
    request.end();
  });
}

test("HTTP API routes return their business results", async () => {
  await withServer(async ({ baseUrl }) => {
    const health = await fetch(`${baseUrl}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, service: "fixture" });

    const overview = await fetch(`${baseUrl}/api/overview?window=7`);
    assert.equal(overview.status, 200);
    assert.deepEqual(await overview.json(), { route: "overview", windowDays: 7 });

    const meta = await fetch(`${baseUrl}/api/meta`);
    assert.equal(meta.status, 200);
    assert.deepEqual(await meta.json(), { route: "meta", apiContractVersion: 1 });

    const platformActivity = await fetch(`${baseUrl}/api/platform-activity`);
    assert.equal(platformActivity.status, 200);
    assert.deepEqual(await platformActivity.json(), { route: "platform-activity" });

    const platform = await fetch(`${baseUrl}/api/platforms/pons`);
    assert.equal(platform.status, 200);
    assert.deepEqual(await platform.json(), { route: "platform", platformId: "pons" });

    assert.deepEqual(await (await fetch(`${baseUrl}/api/coverage`)).json(), {
      route: "coverage",
    });
    assert.deepEqual(await (await fetch(`${baseUrl}/api/sources`)).json(), {
      route: "sources",
    });
    assert.deepEqual(await (await fetch(`${baseUrl}/api/refresh`, { method: "POST" })).json(), {
      route: "refresh",
    });
  });
});

test("platform activity alert health exposes configuration without its webhook", async () => {
  await withServer(
    async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/api/platform-activity/alerts/health`);
      assert.equal(response.status, 200);
      const body = (await response.json()) as Record<string, unknown>;
      assert.equal(body.service, "rhc-pair-daily-volume-alert");
      assert.equal(body.configured, true);
      assert.equal(body.thresholdPct, 10);
      assert.equal("feishuWebhookUrl" in body, false);
    },
    fakeDashboard(),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    fakePlatformVolumeAlert(),
  );

  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/platform-activity/alerts/health`);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "PLATFORM_VOLUME_ALERT_UNAVAILABLE");
  });
});

test("PAIR HTTP routes expose isolated rankings, reports, sources, and refresh actions", async () => {
  await withServer(
    async ({ baseUrl }) => {
      assert.deepEqual(await (await fetch(`${baseUrl}/api/pair/health`)).json(), {
        ok: true,
        service: "pair-fixture",
      });
      assert.deepEqual(await (await fetch(`${baseUrl}/api/pair/rankings`)).json(), {
        route: "pair-rankings",
      });
      assert.deepEqual(await (await fetch(`${baseUrl}/api/pair/reports/latest`)).json(), {
        route: "pair-report",
      });
      assert.deepEqual(await (await fetch(`${baseUrl}/api/pair/sources`)).json(), {
        route: "pair-sources",
      });
      assert.deepEqual(
        await (await fetch(`${baseUrl}/api/pair/refresh`, { method: "POST" })).json(),
        { route: "pair-refresh" },
      );
      assert.deepEqual(
        await (await fetch(`${baseUrl}/api/pair/reports/generate`, { method: "POST" })).json(),
        { route: "pair-generate" },
      );
    },
    fakeDashboard(),
    fakePair(),
  );
});

test("PAIR HTTP routes fail explicitly when the module or daily report is unavailable", async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/pair/rankings`);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "PAIR_MODULE_UNAVAILABLE");
  });

  await withServer(
    async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/api/pair/reports/latest`);
      assert.equal(response.status, 404);
      assert.equal((await response.json()).code, "PAIR_REPORT_NOT_FOUND");
    },
    fakeDashboard(),
    fakePair({ latestDailyReport: () => null }),
  );
});

test("PAIR flow HTTP routes expose cached reads, health, and explicit refresh", async () => {
  await withServer(
    async ({ baseUrl }) => {
      assert.deepEqual(await (await fetch(`${baseUrl}/api/pair/flow/health`)).json(), {
        ok: true,
        service: "pair-flow-fixture",
      });
      assert.deepEqual(await (await fetch(`${baseUrl}/api/pair/flow`)).json(), {
        route: "pair-flow",
      });
      assert.deepEqual(
        await (await fetch(`${baseUrl}/api/pair/flow/refresh`, { method: "POST" })).json(),
        { route: "pair-flow-refresh" },
      );
      assert.deepEqual(await (await fetch(`${baseUrl}/launchpads/api/pair/flow`)).json(), {
        route: "pair-flow",
      });
      assert.deepEqual(
        await (
          await fetch(`${baseUrl}/pair-flow/api/pair/flow/events?type=burn&window=7d&limit=25`)
        ).json(),
        {
          route: "pair-flow-events",
          query: { type: "burn", window: "7d", limit: 25, offset: 0 },
        },
      );
      const invalid = await fetch(`${baseUrl}/api/pair/flow/events?limit=999`);
      assert.equal(invalid.status, 400);
      assert.equal((await invalid.json()).code, "INVALID_PAIR_FLOW_EVENTS_QUERY");
    },
    fakeDashboard(),
    fakePair(),
    undefined,
    undefined,
    undefined,
    fakePairFlow(),
  );

  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/pair/flow`);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "PAIR_FLOW_MODULE_UNAVAILABLE");
  });
});

test("Long HTTP routes expose rankings, reports, sources, and isolated refresh actions", async () => {
  await withServer(
    async ({ baseUrl }) => {
      assert.deepEqual(await (await fetch(`${baseUrl}/api/long/health`)).json(), {
        ok: true,
        service: "long-fixture",
      });
      assert.deepEqual(await (await fetch(`${baseUrl}/api/long/rankings`)).json(), {
        route: "long-rankings",
      });
      assert.deepEqual(await (await fetch(`${baseUrl}/api/long/reports/latest`)).json(), {
        route: "long-report",
      });
      assert.deepEqual(await (await fetch(`${baseUrl}/api/long/sources`)).json(), {
        route: "long-sources",
      });
      assert.deepEqual(
        await (await fetch(`${baseUrl}/api/long/refresh`, { method: "POST" })).json(),
        { route: "long-refresh" },
      );
      assert.deepEqual(
        await (await fetch(`${baseUrl}/api/long/reports/generate`, { method: "POST" })).json(),
        { route: "long-generate" },
      );
    },
    fakeDashboard(),
    fakePair(),
    fakeLong(),
  );

  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/long/rankings`);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "LONG_MODULE_UNAVAILABLE");
  });

  await withServer(
    async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/api/long/reports/latest`);
      assert.equal(response.status, 404);
      assert.equal((await response.json()).code, "LONG_REPORT_NOT_FOUND");
    },
    fakeDashboard(),
    fakePair(),
    fakeLong({ latestDailyReport: () => null }),
  );
});

test("economics HTTP routes expose the comparison snapshot and explicit readiness", async () => {
  await withServer(
    async ({ baseUrl }) => {
      assert.deepEqual(await (await fetch(`${baseUrl}/api/economics/health`)).json(), {
        ok: true,
        service: "economics-fixture",
      });
      assert.deepEqual(await (await fetch(`${baseUrl}/api/economics`)).json(), {
        route: "economics-snapshot",
      });
      assert.deepEqual(await (await fetch(`${baseUrl}/api/economics/valuation`)).json(), {
        route: "economics-valuation",
      });
      assert.deepEqual(await (await fetch(`${baseUrl}/api/economics/valuation/history`)).json(), {
        route: "economics-valuation-history",
      });
      assert.deepEqual(await (await fetch(`${baseUrl}/api/economics/sources`)).json(), {
        route: "economics-sources",
      });
      assert.deepEqual(
        await (await fetch(`${baseUrl}/api/economics/refresh`, { method: "POST" })).json(),
        { route: "economics-refresh" },
      );
      assert.deepEqual(
        await (await fetch(`${baseUrl}/api/economics/rebuild`, { method: "POST" })).json(),
        { route: "economics-rebuild" },
      );
    },
    fakeDashboard(),
    undefined,
    undefined,
    fakeEconomics(),
  );

  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/economics`);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "ECONOMICS_MODULE_UNAVAILABLE");
  });

  await withServer(
    async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/api/economics`);
      assert.equal(response.status, 503);
      assert.equal((await response.json()).code, "ECONOMICS_NOT_READY");
    },
    fakeDashboard(),
    undefined,
    undefined,
    fakeEconomics({ snapshot: () => null }),
  );

  await withServer(
    async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/api/economics/valuation`);
      assert.equal(response.status, 503);
      assert.equal((await response.json()).code, "VALUATION_NOT_READY");
    },
    fakeDashboard(),
    undefined,
    undefined,
    fakeEconomics({ valuation: () => null }),
  );
});

test("market intelligence exposes cached reads, explicit refresh, and prefixed routes", async () => {
  await withServer(
    async ({ baseUrl }) => {
      assert.deepEqual(await (await fetch(`${baseUrl}/api/intelligence/health`)).json(), {
        ok: true,
        service: "intelligence-fixture",
      });
      assert.deepEqual(await (await fetch(`${baseUrl}/api/intelligence`)).json(), {
        route: "intelligence-snapshot",
      });
      assert.deepEqual(await (await fetch(`${baseUrl}/leaders/api/intelligence`)).json(), {
        route: "intelligence-snapshot",
      });
      assert.deepEqual(
        await (await fetch(`${baseUrl}/api/intelligence/refresh`, { method: "POST" })).json(),
        { route: "intelligence-refresh" },
      );
      assert.equal((await fetch(`${baseUrl}/leaders/`)).status, 200);
      assert.equal((await fetch(`${baseUrl}/chain/`)).status, 200);
      assert.equal((await fetch(`${baseUrl}/launchpads/app.js`)).status, 200);
    },
    fakeDashboard(),
    undefined,
    undefined,
    undefined,
    fakeIntelligence(),
  );

  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/intelligence`);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "INTELLIGENCE_MODULE_UNAVAILABLE");
  });
});

test("full-chain latest snapshot is available at root and the unified chain prefix", async () => {
  await withServer(async ({ baseUrl }) => {
    for (const path of ["/api/latest", "/chain/api/latest"]) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        targetDate: "2026-09-07",
        generatedAt: "2026-09-08T07:00:00.000Z",
        metrics: [],
      });
    }
  });
});

test("PAIR workbench is primary while retired product routes remain safe redirects", async () => {
  await withServer(
    async ({ baseUrl }) => {
      assert.deepEqual(await (await fetch(`${baseUrl}/api/product/health`)).json(), {
        ok: true,
        service: "product-fixture",
      });
      assert.deepEqual(await (await fetch(`${baseUrl}/api/product/today`)).json(), {
        route: "product-today",
      });
      assert.deepEqual(await (await fetch(`${baseUrl}/market/api/product/today`)).json(), {
        route: "product-today",
      });
      assert.deepEqual(
        await (await fetch(`${baseUrl}/api/product/refresh`, { method: "POST" })).json(),
        { route: "product-refresh" },
      );
      const root = await fetch(`${baseUrl}/`);
      assert.equal(root.status, 200);
      assert.equal(await root.text(), "<h1>ledger</h1>");
      for (const [path, location] of [
        ["/market/", "/launchpads/"],
        ["/alpha/", "/pair-alpha/"],
        ["/assets/", "/leaders/"],
        ["/assets/cashcat/", "/leaders/"],
      ]) {
        const response = await fetch(`${baseUrl}${path}`, { redirect: "manual" });
        assert.equal(response.status, 308);
        assert.equal(response.headers.get("location"), location);
      }
      const legacy = await fetch(`${baseUrl}/leaders/`);
      assert.equal(await legacy.text(), "<h1>ledger</h1>");
    },
    fakeDashboard(),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    fakeProduct(),
  );

  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/product/today`);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "PRODUCT_WORKBENCH_UNAVAILABLE");
  });
});

test("legacy forwarded prefixes keep their deep workbenches after nginx rewrites the path", async () => {
  await withServer(async ({ baseUrl }) => {
    for (const prefix of [
      "/chain",
      "/leaders",
      "/launchpads",
      "/pair-alpha",
      "/pair-v2",
      "/pair-flow",
    ]) {
      const response = await fetch(baseUrl, {
        headers: { "x-forwarded-prefix": prefix },
      });
      assert.equal(response.status, 200);
      assert.equal(await response.text(), "<h1>ledger</h1>");
    }
  });
});

test("HTTP API rejects invalid inputs with stable error codes", async () => {
  await withServer(async ({ baseUrl, port }) => {
    const invalidWindow = await fetch(`${baseUrl}/api/overview?window=2`);
    assert.equal(invalidWindow.status, 400);
    assert.deepEqual(await invalidWindow.json(), {
      error: "window must be 1, 7, or 30",
      code: "INVALID_WINDOW",
    });

    const invalidPlatform = await fetch(`${baseUrl}/api/platforms/NOT_VALID`);
    assert.equal(invalidPlatform.status, 400);
    assert.equal((await invalidPlatform.json()).code, "INVALID_PLATFORM_ID");

    const missingPlatform = await fetch(`${baseUrl}/api/platforms/missing`);
    assert.equal(missingPlatform.status, 404);
    assert.equal((await missingPlatform.json()).code, "PLATFORM_NOT_FOUND");

    const invalidPath = await rawGet(port, "/%E0%A4%A");
    assert.equal(invalidPath.status, 400);
    assert.equal(JSON.parse(invalidPath.body).code, "INVALID_PATH");
  });
});

test("static files enforce containment, content policy, and HEAD semantics", async () => {
  await withServer(async ({ baseUrl, port }) => {
    const index = await fetch(`${baseUrl}/`);
    assert.equal(index.status, 200);
    assert.equal(await index.text(), "<h1>ledger</h1>");
    assert.equal(index.headers.get("cache-control"), "no-cache");
    assert.match(index.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);

    const asset = await fetch(`${baseUrl}/app.js`, { method: "HEAD" });
    assert.equal(asset.status, 200);
    assert.equal(await asset.text(), "");
    assert.equal(asset.headers.get("cache-control"), "public, max-age=300");

    const traversal = await rawGet(port, "/..%2Fpackage.json");
    assert.equal(traversal.status, 403);
    assert.equal(JSON.parse(traversal.body).code, "FORBIDDEN");

    const missing = await fetch(`${baseUrl}/missing.html`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).code, "NOT_FOUND");
  });
});

test("internal exceptions are logged by class but never returned to the client", async () => {
  const secretMarker = "postgres://internal-user:secret@private-host/db";
  await withServer(
    async ({ baseUrl, events }) => {
      const response = await fetch(`${baseUrl}/api/overview`);
      assert.equal(response.status, 500);
      const body = await response.text();
      assert.doesNotMatch(body, /internal-user|private-host|secret/);
      assert.deepEqual(JSON.parse(body), {
        error: "Internal server error",
        code: "INTERNAL_ERROR",
      });
      assert.deepEqual(events, [
        {
          event: "dashboard_request_failed",
          context: { method: "GET", pathname: "/api/overview", errorName: "Error" },
        },
      ]);
    },
    fakeDashboard({
      overview() {
        throw new Error(secretMarker);
      },
    }),
  );
});

test("health endpoint reports unavailable service with HTTP 503", async () => {
  await withServer(
    async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/healthz`);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { ok: false, service: "fixture" });
    },
    fakeDashboard({ health: () => ({ ok: false, service: "fixture" }) }),
  );
});
