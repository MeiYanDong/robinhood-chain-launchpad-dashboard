import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PairFlowCollector } from "../src/pair-flow/collector.js";
import { DEFAULT_PAIR_FLOW_SETTINGS } from "../src/pair-flow/config.js";
import { PairFlowDatabase } from "../src/pair-flow/database.js";
import { PairFlowService } from "../src/pair-flow/service.js";
import type {
  PairAddressTransfer,
  PairFlowCollectionBatch,
  PairFlowSourceHealth,
} from "../src/pair-flow/types.js";

const settings = { ...DEFAULT_PAIR_FLOW_SETTINGS };

function transfer(input: {
  index: number;
  token: string;
  from: string;
  to: string;
  amount: number;
  method?: string;
}): PairAddressTransfer {
  return {
    hash: `0x${input.index.toString(16).padStart(64, "0")}`,
    blockNumber: input.index,
    logIndex: input.index,
    from: input.from,
    to: input.to,
    token: input.token,
    rawValue: BigInt(input.amount) * 10n ** 18n,
    decimals: 18,
    timestamp: "2026-09-04T16:30:00.000Z",
    method: input.method ?? "Transfer",
    symbol: null,
    tokenName: null,
    tokenPriceUsd: null,
  };
}

function source(source: string, status: PairFlowSourceHealth["status"] = "ok") {
  return {
    source,
    label: source,
    status,
    fetchedAt: "2026-09-04T16:40:00.000Z",
    message: status === "ok" ? "数据可用。" : "部分数据不可用。",
    url: "https://example.com",
  } satisfies PairFlowSourceHealth;
}

function fullBatch(): PairFlowCollectionBatch {
  const transfers = [
    transfer({
      index: 1,
      token: settings.pairTokenAddress,
      from: settings.lockerAddress,
      to: settings.creatorAddress,
      amount: 100,
    }),
    transfer({
      index: 2,
      token: settings.pairTokenAddress,
      from: settings.poolManagerAddress,
      to: settings.creatorAddress,
      amount: 50,
      method: "Swap",
    }),
    transfer({
      index: 3,
      token: settings.pairTokenAddress,
      from: settings.creatorAddress,
      to: settings.deadAddress,
      amount: 150,
    }),
    transfer({
      index: 4,
      token: settings.spyTokenAddress,
      from: settings.lockerAddress,
      to: settings.treasuryAddress,
      amount: 5,
      method: "Claim",
    }),
    transfer({
      index: 5,
      token: settings.spyTokenAddress,
      from: settings.treasuryAddress,
      to: settings.swapAdapterAddresses[0] ?? settings.poolManagerAddress,
      amount: 4,
      method: "Swap",
    }),
  ];
  return {
    observedAt: "2026-09-04T16:40:00.000Z",
    mainToken: {
      observedAt: "2026-09-04T16:39:00.000Z",
      priceUsd: 0.1,
      volume24hUsd: 20_000,
      liquidityUsd: 10_000,
      poolFeeBps: 10_000,
      poolId: settings.poolId,
      positionTokenId: settings.positionTokenId,
    },
    ohlcv: {
      observedAt: "2026-09-04T16:40:00.000Z",
      candles: [
        { timestamp: Date.parse("2026-09-04T15:00:00.000Z") / 1_000, volumeUsd: 2_000 },
        { timestamp: Date.parse("2026-09-04T16:00:00.000Z") / 1_000, volumeUsd: 1_000 },
      ],
    },
    chain: {
      observedAt: "2026-09-04T16:40:00.000Z",
      blockNumber: "0x123",
      collectSimulationSucceeded: true,
      pairTotalSupply: 1_000,
      pairDeadBalance: 150,
      walletPairBalances: {
        [settings.creatorAddress]: 0,
        [settings.treasuryAddress]: 0,
        [settings.executorAddress]: 0,
      },
      walletSpyBalances: {
        [settings.creatorAddress]: 0.2,
        [settings.treasuryAddress]: 0.5,
        [settings.executorAddress]: 0.3,
      },
      claimableBefore: {
        creatorPair: 7,
        treasuryPair: 3,
        creatorSpy: 0.5,
        treasurySpy: 1,
      },
      claimableAfter: {
        creatorPair: 10,
        treasuryPair: 5,
        creatorSpy: 1,
        treasurySpy: 2,
      },
      spyPriceUsd: 100,
      spyPriceUpdatedAt: "2026-09-04T16:35:00.000Z",
    },
    history: {
      observedAt: "2026-09-04T16:40:00.000Z",
      transfers,
      walletCount: 3,
      complete: true,
      truncatedWallets: [],
    },
    treasuryClaimable: {
      observedAt: "2026-09-04T16:40:00.000Z",
      quoteAssetCount: 2,
      quoteUsdCoverageCount: 2,
      quoteClaimableUsd: 1_000,
      spyClaimable: 1,
      spyClaimableUsd: 100,
    },
    platform: {
      runId: 9,
      observedAt: "2026-09-04T16:38:00.000Z",
      tokenCount: 10,
      volumeObservedCount: 10,
      volume24hUsd: 100_000,
      complete: true,
    },
    sources: [source("pair"), source("ohlcv"), source("rpc"), source("history")],
    warnings: [],
  };
}

async function withService(
  run: (context: {
    service: PairFlowService;
    database: PairFlowDatabase;
    setNow(value: string): void;
    setBatch(value: PairFlowCollectionBatch): void;
    calls(): number;
  }) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "pair-flow-service-"));
  const database = new PairFlowDatabase(join(directory, "test.sqlite"));
  let now = new Date("2026-09-04T16:40:00.000Z");
  let batch = fullBatch();
  let callCount = 0;
  const unusedCollector = new PairFlowCollector(settings, {
    fetchPairToken: async () => {
      throw new Error("unused");
    },
  });
  const service = new PairFlowService(database, settings, unusedCollector, {
    now: () => now,
    collect: async () => {
      callCount += 1;
      return batch;
    },
  });
  try {
    await run({
      service,
      database,
      setNow(value) {
        now = new Date(value);
      },
      setBatch(value) {
        batch = value;
      },
      calls: () => callCount,
    });
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("PAIR flow service publishes the dual ledger without mixing policy and execution", async () => {
  await withService(async ({ service, database, calls }) => {
    const response = await service.refresh();
    assert.equal(response.status, "success");
    assert.equal(response.window.calendarDate, "2026-09-05");
    assert.equal(response.volume.mainPoolTodayUsd.value, 1_000);
    assert.equal(response.volume.mainPoolRolling24hUsd.value, 20_000);
    assert.equal(response.volume.platformRolling24hUsd.value, 100_000);
    assert.equal(response.volume.theoreticalGrossFees24hUsd.value, 1_000);
    assert.equal(response.volume.theoreticalProtocolFees24hUsd.value, 300);
    assert.equal(response.volume.theoreticalPolicyBuyback24hUsd.value, 270);

    assert.equal(response.burn.deadLockedPair.value, 150);
    assert.equal(response.burn.deadLockedPercent.value, 15);
    assert.equal(response.burn.cumulativeDirectFeeBurnedPair.value, 100);
    assert.equal(response.burn.cumulativeMarketAcquiredPair.value, 50);
    assert.equal(response.burn.cumulativeMarketAcquiredBurnedPair.value, 50);
    assert.equal(response.burn.walletPendingPair.value, 0);
    assert.equal(response.burn.walletMarketAcquiredPendingPair.value, 0);
    assert.equal(response.burn.lockerPendingDirectPair.value, 15);

    assert.equal(response.buyback.protocolQuoteAssetsUsd.value, 1_000);
    assert.equal(response.buyback.protocolQuoteAssetCount.value, 2);
    assert.equal(response.buyback.protocolClaimableSpy.value, 1);
    assert.equal(response.buyback.mainPoolUnsweptSpy.value, 1);
    assert.ok(Math.abs((response.buyback.policyExpectedSpy.value ?? 0) - 1.8) < 1e-9);
    assert.equal(response.buyback.policyExpectedUsd.value, 990);
    assert.equal(response.buyback.protocolWalletSpy.tier, "unattributed");
    assert.equal(response.buyback.confirmedFeeFundedSpendUsd.value, null);
    assert.ok(
      Math.abs((response.pressure.policyPendingToLiquidityPercent.value ?? 0) - 9.9) < 1e-9,
    );
    assert.equal(response.pressure.state, "high");
    assert.equal(response.attribution.fundingLink, "partial");
    assert.equal(database.latest()?.burn.deadLockedPair.value, 150);
    const events = await service.events({ type: "all", window: "today", limit: 20, offset: 0 });
    assert.equal(events.counts.matched, 2);
    assert.equal(events.counts.buyback, 1);
    assert.equal(events.counts.burn, 1);
    assert.equal(events.items[0]?.type, "burn");
    assert.deepEqual(events.items[0]?.linkedTxHashes, [`0x${String(2).padStart(64, "0")}`]);

    const cached = await service.ensureFresh();
    assert.equal(cached.burn.deadLockedPair.value, 150);
    assert.equal(calls(), 1);
    assert.equal(service.health().ok, true);
  });
});

test("PAIR flow service keeps missing and truncated evidence unknown and marks stale cache", async () => {
  await withService(async ({ service, setBatch, setNow }) => {
    const batch = fullBatch();
    setBatch({
      ...batch,
      chain: null,
      history: batch.history ? { ...batch.history, complete: false } : null,
      platform: null,
      sources: [source("rpc", "failed"), source("history", "degraded")],
      warnings: ["rpc_failed"],
    });
    const response = await service.refresh();
    assert.equal(response.status, "partial");
    assert.equal(response.burn.deadLockedPair.value, null);
    assert.equal(response.burn.todayBurnedPair.value, null);
    assert.equal(response.buyback.policyExpectedUsd.value, 900);
    assert.equal(response.buyback.mainPoolUnsweptSpy.value, null);
    assert.equal(response.volume.platformRolling24hUsd.value, null);
    assert.equal(response.pressure.state, "high");

    setNow("2026-09-04T17:10:01.000Z");
    const stale = service.snapshot();
    assert.equal(stale?.stale, true);
    assert.equal(stale?.status, "partial");
    assert.ok(stale?.warnings.includes("pair_flow_snapshot_stale"));
  });
});

test("PAIR flow service coalesces refreshes and falls back to the last snapshot", async () => {
  await withService(async ({ service, setNow, setBatch, calls }) => {
    await service.refresh();
    setNow("2026-09-04T17:00:00.000Z");
    setBatch(fullBatch());
    const first = service.refresh();
    const second = service.refresh();
    assert.equal(first, second);
    await first;
    assert.equal(calls(), 2);
  });
});
