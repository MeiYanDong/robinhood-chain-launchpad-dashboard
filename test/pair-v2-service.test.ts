import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DEFAULT_PAIR_V2_SETTINGS } from "../src/pair-v2/config.js";
import type { PairV2Collector } from "../src/pair-v2/collector.js";
import { PairV2Database } from "../src/pair-v2/database.js";
import { PairV2Service } from "../src/pair-v2/service.js";
import type { PairV2ChainEvent, PairV2CollectionBatch } from "../src/pair-v2/types.js";

const RELEASE_ID = DEFAULT_PAIR_V2_SETTINGS.expectedReleaseId;
const PROJECT = "0x1111111111111111111111111111111111115555";
const VAULT = "0x2222222222222222222222222222222222222222";

function chainEvent(type: PairV2ChainEvent["type"], blockNumber: number): PairV2ChainEvent {
  return {
    id: `4663:0x${String(blockNumber).padStart(64, "a")}:1`,
    releaseId: RELEASE_ID,
    type,
    blockNumber,
    transactionHash: `0x${String(blockNumber).padStart(64, "a")}`,
    logIndex: 1,
    timestamp: "2026-09-05T08:00:00.000Z",
    emitter:
      type === "buyback_executed"
        ? "0x8fea00440300bb2d3e9377b995e6f62fe99c1a0c"
        : "0xf98b202fd8717b79f9c5e5dd67c2f9e640bbd25d",
    project: PROJECT,
    vault: VAULT,
    actor: "0x3333333333333333333333333333333333333333",
    asset: type === "buyback_executed" ? "0x4444444444444444444444444444444444444444" : null,
    assetSymbol: type === "buyback_executed" ? "SPY" : null,
    amountRaw: type === "buyback_executed" ? "1000000000000000000" : null,
    amount: type === "buyback_executed" ? 1 : null,
    secondaryAmountRaw: type === "buyback_executed" ? "2000000000000000000" : null,
    secondaryAmount: type === "buyback_executed" ? 2 : null,
    epoch: type === "buyback_executed" ? 1 : null,
    positionId: null,
    modeId: 2,
    implementation: null,
    evidence: "onchain",
  };
}

function collection(kind: "full" | "chain", events: PairV2ChainEvent[]): PairV2CollectionBatch {
  return {
    kind,
    observedAt: "2026-09-05T08:00:00.000Z",
    latestBlock: kind === "full" ? 110 : 120,
    scanFromBlock: kind === "full" ? 100 : 109,
    release: {
      releaseId: RELEASE_ID,
      manifestSha256: DEFAULT_PAIR_V2_SETTINGS.expectedManifestSha256,
      schema: "fixture",
      capability: "fixture",
      ready: true,
      configured: true,
      canonical: true,
      deploymentBlock: 100,
      attestedBlock: 110,
      observedAt: "2026-09-05T08:00:00.000Z",
      addresses: {
        launchpad: "0x8660a7f019c7943b0b0a91b8e39aff3b6db6ae62",
        modeRegistry: "0xda5c65431e2adc1c64af51e3ce7de2485abeab69",
        coordinator: "0xf98b202fd8717b79f9c5e5dd67c2f9e640bbd25d",
        tokenFactory: "0xece4ce499e1f75ceb75581a16b48c86eba0a3e3a",
        hook: "0xd2f759a1cf13c30127c551c3aee04629aea200c0",
        buybackExecutor: "0x8fea00440300bb2d3e9377b995e6f62fe99c1a0c",
        aggregator: "0xe6c5a027da3f4506cde435b5e5bb6680c870f771",
      },
    },
    tokens:
      kind === "full"
        ? [
            {
              address: PROJECT,
              name: "Alpha",
              symbol: "A",
              creator: "0x3333333333333333333333333333333333333333",
              launchedAt: "2026-09-05T07:00:00.000Z",
              priceUsd: 0.0001,
              marketCapUsd: 10_000,
              liquidityUsd: 2_000,
              volume24hUsd: 1_000,
              holderCount: 20,
              holderObservedAt: "2026-09-05T08:00:00.000Z",
              marketDataUpdatedAt: "2026-09-05T08:00:00.000Z",
              hidden: false,
              flagged: false,
              pools: [],
              launchVersion: "v2",
              alphaMarketCandidate: true,
              alphaCandidateReasons: ["v2_generation"],
            },
            {
              address: "0x9999999999999999999999999999999999995555",
              name: "Historical proof",
              symbol: "OLD",
              creator: null,
              launchedAt: "2026-09-04T07:00:00.000Z",
              priceUsd: 0.0002,
              marketCapUsd: 20_000,
              liquidityUsd: 3_000,
              volume24hUsd: 2_000,
              holderCount: 30,
              holderObservedAt: "2026-09-05T08:00:00.000Z",
              marketDataUpdatedAt: "2026-09-05T08:00:00.000Z",
              hidden: false,
              flagged: false,
              pools: [],
              launchVersion: "v1",
              marketVersion: "v4-multi",
              alphaMarketCandidate: true,
              alphaCandidateReasons: ["official_volume_floor"],
            },
          ]
        : [],
    launches: [
      {
        eventId: `4663:0x${"a".repeat(64)}:1`,
        releaseId: RELEASE_ID,
        project: PROJECT,
        creator: "0x3333333333333333333333333333333333333333",
        vault: VAULT,
        handler: "0x4444444444444444444444444444444444444444",
        modeId: 2,
        modeVersion: 5,
        salt: `0x${"b".repeat(64)}`,
        blockNumber: 100,
        transactionHash: `0x${"a".repeat(64)}`,
        logIndex: 1,
        timestamp: "2026-09-05T07:00:00.000Z",
      },
    ],
    events,
    buckets:
      kind === "full"
        ? [
            {
              releaseId: RELEASE_ID,
              project: PROJECT,
              vault: VAULT,
              epoch: 1,
              asset: "0x4444444444444444444444444444444444444444",
              assetSymbol: "SPY",
              decimals: 18,
              amountRaw: "3000000000000000000",
              amount: 3,
              observedBlock: 110,
              observedAt: "2026-09-05T08:00:00.000Z",
            },
          ]
        : [],
    sourceHealth: [
      {
        id: "robinhood_rpc",
        label: "RPC",
        status: "ok",
        fetchedAt: "2026-09-05T08:00:00.000Z",
        latencyMs: 1,
        observed: events.length,
        expected: null,
        message: "ok",
      },
    ],
    warnings: [],
  };
}

test("PAIR V2 service materializes separate estimates, actual events, buckets, and health", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pair-v2-service-"));
  const databasePath = join(directory, "test.sqlite");
  const database = new PairV2Database(databasePath);
  let calls = 0;
  const fakeCollector = {} as PairV2Collector;
  const settings = {
    ...DEFAULT_PAIR_V2_SETTINGS,
    deploymentBlock: 100,
    chainPollSeconds: 3_600,
    marketPollSeconds: 3_600,
  };
  const service = new PairV2Service(database, settings, fakeCollector, {
    now: () => new Date("2026-09-05T08:00:00.000Z"),
    collect: async (context) => {
      calls += 1;
      return context.kind === "full"
        ? collection("full", [chainEvent("launch", 100)])
        : collection("chain", [chainEvent("buyback_executed", 120)]);
    },
  });
  try {
    const full = await service.refresh("full");
    assert.deepEqual(full.monitoring, {
      chainPollSeconds: 3_600,
      marketPollSeconds: 3_600,
      hotMarketPollSeconds: 15,
      staleAfterSeconds: 150,
    });
    assert.equal(full.overview.userFees24hUsd, 10);
    assert.equal(full.overview.publicV2TokenCount, 1);
    assert.equal(full.tokens.length, 1);
    assert.equal(full.tokens[0]?.canonical, true);
    assert.equal(full.overview.buybackBudget24hUsd, 7);
    assert.equal(full.tokens[0]?.buyback.pendingBuckets[0]?.amount, 3);
    assert.equal(full.overview.buybackExecutedCount, 0);
    assert.equal(full.alphaModel.status, "shadow");
    assert.equal(full.alphaModel.validated, false);
    assert.equal(full.alphaModel.firstSignalCount, 0);
    assert.equal(full.alphaRadar?.overview.officialUniverseCount, 2);
    assert.equal(full.alphaRadar?.overview.monitoredMarketCount, 2);
    assert.equal(
      full.alphaRadar?.generationCounts.find((item) => item.generation === "v1")?.count,
      1,
    );

    const chain = await service.refresh("chain");
    assert.equal(chain.overview.buybackExecutedCount, 1);
    assert.equal(chain.tokens[0]?.buyback.burnedAmount, 2);
    assert.equal(chain.tokens[0]?.buyback.pendingBuckets[0]?.amount, 3);
    assert.equal(service.token(PROJECT)?.symbol, "A");
    assert.equal(service.alphaToken("0x9999999999999999999999999999999999995555")?.symbol, "OLD");
    assert.equal(service.events(1).items.length, 1);
    assert.equal(service.health().ok, true);
    assert.equal(calls, 2);

    const inspector = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const current = inspector
        .prepare("SELECT COUNT(*) AS count, MAX(run_id) AS run_id FROM pair_v2_dashboard_current")
        .get() as { count: number; run_id: number };
      const legacy = inspector
        .prepare("SELECT COUNT(*) AS count FROM pair_v2_dashboard_snapshots")
        .get() as { count: number };
      assert.equal(current.count, 1);
      assert.equal(current.run_id, 1);
      assert.equal(legacy.count, 0);
    } finally {
      inspector.close();
    }

    service.start();
    assert.equal(service.health().backgroundMonitor, true);
    service.stop();
    assert.equal(service.health().backgroundMonitor, false);
  } finally {
    service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("PAIR V2 service returns an older snapshot immediately while refreshing in background", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pair-v2-cache-"));
  const database = new PairV2Database(join(directory, "test.sqlite"));
  const fakeCollector = {} as PairV2Collector;
  let now = new Date("2026-09-05T08:00:00.000Z");
  let calls = 0;
  let resolveBackground!: (batch: PairV2CollectionBatch) => void;
  const service = new PairV2Service(
    database,
    {
      ...DEFAULT_PAIR_V2_SETTINGS,
      deploymentBlock: 100,
      marketPollSeconds: 60,
    },
    fakeCollector,
    {
      now: () => now,
      collect: async () => {
        calls += 1;
        if (calls === 1) return collection("full", []);
        return await new Promise<PairV2CollectionBatch>((resolve) => {
          resolveBackground = resolve;
        });
      },
    },
  );

  try {
    await service.refresh("full");
    now = new Date("2026-09-05T08:03:00.000Z");

    const cached = await service.ensureFresh();
    assert.equal(cached.observedAt, "2026-09-05T08:00:00.000Z");
    assert.equal(cached.stale, true);
    assert.equal(calls, 2);

    resolveBackground(collection("full", []));
    await service.refresh("full");
  } finally {
    service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("PAIR V2 freshness starts when a slow collection completes, not when it began", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pair-v2-completion-freshness-"));
  const database = new PairV2Database(join(directory, "test.sqlite"));
  const fakeCollector = {} as PairV2Collector;
  let now = new Date("2026-09-05T08:00:00.000Z");
  let calls = 0;
  const service = new PairV2Service(
    database,
    {
      ...DEFAULT_PAIR_V2_SETTINGS,
      deploymentBlock: 100,
      marketPollSeconds: 60,
      staleAfterSeconds: 150,
    },
    fakeCollector,
    {
      now: () => now,
      collect: async () => {
        calls += 1;
        now = new Date("2026-09-05T08:03:00.000Z");
        return collection("full", []);
      },
    },
  );

  try {
    await service.refresh("full");
    now = new Date("2026-09-05T08:04:00.000Z");

    const cached = await service.ensureFresh();
    assert.equal(cached.observedAt, "2026-09-05T08:00:00.000Z");
    assert.equal(cached.stale, false);
    assert.equal(calls, 1);
  } finally {
    service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("PAIR V2 service persists a safe failure stage instead of an upstream URL", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pair-v2-error-code-"));
  const database = new PairV2Database(join(directory, "test.sqlite"));
  const service = new PairV2Service(
    database,
    { ...DEFAULT_PAIR_V2_SETTINGS, deploymentBlock: 100 },
    {} as PairV2Collector,
    {
      collect: async () => {
        throw new Error(
          "Failed to fetch https://pair.fund/api/v5-v2/standard-route/consumer-live?secret=value",
        );
      },
    },
  );

  try {
    await assert.rejects(service.refresh("full"));
    assert.equal(database.latestRun()?.error, "pair_v2_attestation_unavailable");
    assert.doesNotMatch(database.latestRun()?.error ?? "", /https|secret/);
  } finally {
    service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
