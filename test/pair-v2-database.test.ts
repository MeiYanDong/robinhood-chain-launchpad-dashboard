import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PairV2Database } from "../src/pair-v2/database.js";
import type { PairV2CollectionBatch, PairV2TokenView } from "../src/pair-v2/types.js";

function batch(): PairV2CollectionBatch {
  const releaseId = `0x${"a".repeat(64)}`;
  return {
    kind: "full",
    observedAt: "2026-09-05T08:00:00.000Z",
    latestBlock: 110,
    scanFromBlock: 100,
    release: {
      releaseId,
      manifestSha256: "b".repeat(64),
      schema: "fixture",
      capability: "fixture",
      ready: true,
      configured: true,
      canonical: true,
      deploymentBlock: 100,
      attestedBlock: 110,
      observedAt: "2026-09-05T08:00:00.000Z",
      addresses: {
        launchpad: "0x1111111111111111111111111111111111111111",
        modeRegistry: "0x2222222222222222222222222222222222222222",
        coordinator: "0x3333333333333333333333333333333333333333",
        tokenFactory: "0x4444444444444444444444444444444444444444",
        hook: "0x5555555555555555555555555555555555555555",
        buybackExecutor: "0x6666666666666666666666666666666666666666",
        aggregator: "0x7777777777777777777777777777777777777777",
      },
    },
    tokens: [
      {
        address: "0x8888888888888888888888888888888888885555",
        name: "Alpha",
        symbol: "A",
        creator: null,
        launchedAt: "2026-09-05T07:00:00.000Z",
        priceUsd: 0.1,
        marketCapUsd: 1000,
        liquidityUsd: 200,
        volume24hUsd: 500,
        holderCount: 12,
        holderObservedAt: "2026-09-05T08:00:00.000Z",
        marketDataUpdatedAt: "2026-09-05T08:00:00.000Z",
        hidden: false,
        flagged: false,
        pools: [],
      },
    ],
    launches: [
      {
        eventId: `4663:0x${"c".repeat(64)}:1`,
        releaseId,
        project: "0x8888888888888888888888888888888888885555",
        creator: "0x9999999999999999999999999999999999999999",
        vault: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        handler: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        modeId: 2,
        modeVersion: 5,
        salt: `0x${"d".repeat(64)}`,
        blockNumber: 100,
        transactionHash: `0x${"c".repeat(64)}`,
        logIndex: 1,
        timestamp: "2026-09-05T07:00:00.000Z",
      },
    ],
    events: [
      {
        id: `4663:0x${"c".repeat(64)}:1`,
        releaseId,
        type: "launch",
        blockNumber: 100,
        transactionHash: `0x${"c".repeat(64)}`,
        logIndex: 1,
        timestamp: "2026-09-05T07:00:00.000Z",
        emitter: "0x3333333333333333333333333333333333333333",
        project: "0x8888888888888888888888888888888888885555",
        vault: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        actor: "0x9999999999999999999999999999999999999999",
        asset: null,
        assetSymbol: null,
        amountRaw: null,
        amount: null,
        secondaryAmountRaw: null,
        secondaryAmount: null,
        epoch: null,
        positionId: null,
        modeId: 2,
        implementation: null,
        evidence: "onchain",
      },
    ],
    buckets: [
      {
        releaseId,
        project: "0x8888888888888888888888888888888888885555",
        vault: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        epoch: 1,
        asset: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        assetSymbol: "SPY",
        decimals: 18,
        amountRaw: "1000000000000000000",
        amount: 1,
        observedBlock: 110,
        observedAt: "2026-09-05T08:00:00.000Z",
      },
    ],
    sourceHealth: [
      {
        id: "robinhood_rpc",
        label: "RPC",
        status: "ok",
        fetchedAt: "2026-09-05T08:00:00.000Z",
        latencyMs: 1,
        observed: 1,
        expected: null,
        message: "ok",
      },
    ],
    warnings: [],
  };
}

test("PAIR V2 database persists normalized release, token, event, bucket, and cursor state", () => {
  const directory = mkdtempSync(join(tmpdir(), "pair-v2-db-"));
  const database = new PairV2Database(join(directory, "test.sqlite"));
  try {
    const value = batch();
    const runId = database.startRun("full", value.observedAt);
    database.saveBatch(runId, value);
    database.completeRun(runId, "success", value.observedAt, value.observedAt, 110, []);

    assert.equal(database.release(value.release.releaseId)?.canonical, true);
    assert.equal(database.tokens().length, 1);
    assert.equal(database.launches(value.release.releaseId).length, 1);
    assert.equal(database.events(value.release.releaseId).length, 1);
    assert.equal(database.buckets(value.release.releaseId)[0]?.amount, 1);
    assert.equal(database.cursorBlock(0), 110);
    assert.equal(database.sources(runId)[0]?.id, "robinhood_rpc");
    assert.equal(
      database.historicalSnapshots([value.tokens[0]?.address ?? ""], "2026-09-05T08:01:00.000Z")
        .size,
      1,
    );

    assert.equal(
      database.enqueueAlerts([
        {
          dedupeKey: "alert:1",
          severity: "info",
          type: "launch",
          title: "new",
          message: "new launch",
          project: null,
          createdAt: value.observedAt,
        },
      ]),
      1,
    );
    assert.equal(database.enqueueAlerts(database.pendingAlerts()), 0);
    const pending = database.pendingAlerts()[0];
    assert.ok(pending);
    database.markAlertSent(pending.id, value.observedAt);
    assert.equal(database.alertSummary(true).lastSentAt, value.observedAt);

    const emptyUniverse = structuredClone(value);
    emptyUniverse.observedAt = "2026-09-05T08:02:00.000Z";
    emptyUniverse.tokens = [];
    const replacementRun = database.startRun("full", emptyUniverse.observedAt);
    database.saveBatch(replacementRun, emptyUniverse);
    assert.deepEqual(database.tokens(), []);
    assert.equal(
      database.historicalSnapshots([value.tokens[0]?.address ?? ""], "2026-09-05T08:03:00.000Z")
        .size,
      1,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("PAIR V2 database replaces the canonical launch set after a reorg", () => {
  const directory = mkdtempSync(join(tmpdir(), "pair-v2-reorg-"));
  const database = new PairV2Database(join(directory, "test.sqlite"));
  try {
    const initial = batch();
    const firstRun = database.startRun("full", initial.observedAt);
    database.saveBatch(firstRun, initial);

    const replacement = structuredClone(initial);
    replacement.kind = "chain";
    replacement.observedAt = "2026-09-05T08:01:00.000Z";
    replacement.scanFromBlock = 99;
    replacement.latestBlock = 120;
    replacement.launches = [];
    replacement.events = [];
    replacement.buckets = [];
    replacement.tokens = [];
    const secondRun = database.startRun("chain", replacement.observedAt);
    database.saveBatch(secondRun, replacement);

    assert.deepEqual(database.launches(initial.release.releaseId), []);
    assert.deepEqual(database.events(initial.release.releaseId), []);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("PAIR V2 database prunes market history outside the confirmation horizon", () => {
  const directory = mkdtempSync(join(tmpdir(), "pair-v2-retention-"));
  const database = new PairV2Database(join(directory, "test.sqlite"));
  try {
    const old = batch();
    old.observedAt = "2026-09-01T08:00:00.000Z";
    const oldRun = database.startRun("full", old.observedAt);
    database.saveBatch(oldRun, old);

    const current = batch();
    current.observedAt = "2026-09-05T08:00:00.000Z";
    const currentRun = database.startRun("full", current.observedAt);
    database.saveBatch(currentRun, current);

    assert.equal(
      database.historicalSnapshots([current.tokens[0]?.address ?? ""], "2026-09-02T08:00:00.000Z")
        .size,
      0,
    );
    assert.equal(
      database.historicalSnapshots([current.tokens[0]?.address ?? ""], "2026-09-05T08:00:00.000Z")
        .size,
      1,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("PAIR V2 database freezes the first shadow signal and settles each replay horizon once", () => {
  const directory = mkdtempSync(join(tmpdir(), "pair-v2-alpha-ledger-"));
  const database = new PairV2Database(join(directory, "test.sqlite"));
  try {
    const initial = batch();
    const token = initial.tokens[0];
    assert.ok(token);
    const alphaToken: PairV2TokenView = {
      ...token,
      canonical: true,
      modeId: 2,
      modeLabel: "回购销毁",
      vault: initial.launches[0]?.vault ?? null,
      handler: initial.launches[0]?.handler ?? null,
      fees: {
        userFees24hUsd: 5,
        modeShare24hUsd: 3.5,
        protocolShare24hUsd: 1.5,
        basis: "calculated",
      },
      buyback: {
        pendingBuckets: [],
        executedCount: 0,
        executedInputByAsset: [],
        burnedAmount: 0,
      },
      alpha: {
        modelVersion: "model-test",
        modelStatus: "shadow",
        quality: {
          score: 80,
          state: "qualified",
          profileScore: 75,
          liquidityScore: 85,
          adoptionScore: 79,
          reasons: ["fixture"],
          missing: [],
        },
        signal: {
          score: 72,
          state: "forming",
          researchEligible: true,
          reasons: ["fixture"],
          missing: [],
        },
        heat: { score: 40, state: "normal", reasons: [] },
        riskProfile: {
          platform: "high",
          token: "low",
          tradeReady: false,
          platformReasons: ["fixture"],
          tokenReasons: [],
        },
        evidence: {
          confidence: "high",
          completenessPercent: 95,
          available: ["fixture"],
          missing: [],
        },
        action: {
          state: "ignition_watch",
          label: "点火观察",
          informationalOnly: true,
          reasons: ["fixture"],
        },
        metrics: {
          marketCapChange5mPct: 5,
          marketCapChange15mPct: 10,
          holderChange15mPct: 2,
          liquidityChange15mPct: 1,
          volume5mUsd: 50,
          volume1hUsd: 200,
          buys5m: 8,
          sells5m: 2,
          buys1h: 20,
          sells1h: 8,
          buyPressure5m: 75,
          buyPressure1h: 65,
          priceChange1hPct: 8,
        },
        discoveryScore: 78,
        confirmationScore: 72,
        heatScore: 40,
        stage: "forming",
        risk: "low",
        confidence: "high",
        confidenceScore: 95,
        reasons: ["fixture"],
        risks: [],
        missing: [],
      },
    };

    const initialRun = database.startRun("full", initial.observedAt);
    database.saveBatch(initialRun, initial);
    const firstLifecycle = database
      .observeAlphaStates([alphaToken], initial.observedAt)
      .get(alphaToken.address);
    assert.equal(firstLifecycle?.firstObservedAt, initial.observedAt);
    assert.equal(firstLifecycle?.firstIgnitionAt, initial.observedAt);
    const transitionedAt = "2026-09-05T08:01:00.000Z";
    const transitionedLifecycle = database
      .observeAlphaStates(
        [
          {
            ...alphaToken,
            alpha: {
              ...alphaToken.alpha,
              action: {
                state: "no_chase",
                label: "过热勿追",
                informationalOnly: true,
                reasons: ["fixture"],
              },
            },
          },
        ],
        transitionedAt,
      )
      .get(alphaToken.address);
    assert.equal(transitionedLifecycle?.firstObservedAt, initial.observedAt);
    assert.equal(transitionedLifecycle?.firstIgnitionAt, initial.observedAt);
    assert.equal(transitionedLifecycle?.previousActionState, "ignition_watch");
    assert.equal(transitionedLifecycle?.lastTransitionAt, transitionedAt);
    const first = database.observeAlphaModel(
      initial.release.releaseId,
      "model-test",
      [alphaToken],
      initial.observedAt,
    );
    assert.equal(first.firstSignalCount, 1);
    assert.equal(first.matured24hCount, 0);

    const checkpoints = [
      ["2026-09-05T08:05:00.000Z", 0.11],
      ["2026-09-05T08:30:00.000Z", 0.12],
      ["2026-09-05T10:00:00.000Z", 0.09],
      ["2026-09-05T14:00:00.000Z", 0.1],
      ["2026-09-06T08:00:00.000Z", 0.13],
    ] as const;
    let summary = first;
    for (const [observedAt, priceUsd] of checkpoints) {
      const current = batch();
      current.observedAt = observedAt;
      current.tokens[0] = { ...current.tokens[0], priceUsd } as (typeof current.tokens)[number];
      const runId = database.startRun("full", observedAt);
      database.saveBatch(runId, current);
      summary = database.observeAlphaModel(
        current.release.releaseId,
        "model-test",
        [{ ...alphaToken, priceUsd }],
        observedAt,
      );
    }

    assert.equal(summary.firstSignalCount, 1);
    assert.equal(summary.matured24hCount, 1);
    assert.deepEqual(
      summary.horizons.map((horizon) => horizon.observedCount),
      [1, 1, 1, 1, 1],
    );
    assert.equal(summary.horizons[0]?.medianFeeAdjustedReturnPct, 7.81);
    assert.equal(summary.graduation.readyForReview, false);
    assert.equal(summary.validated, false);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("market history stays compact without losing replay numbers or full current token", () => {
  const database = new PairV2Database(":memory:");
  try {
    const value = batch();
    const runId = database.startRun(value.kind, value.observedAt);
    database.saveBatch(runId, value);
    const address = value.tokens[0]?.address ?? "";
    const history = database.historicalSnapshots([address], "2026-09-05T08:01:00.000Z");
    assert.equal(history.get(address)?.priceUsd, 0.1);
  } finally {
    database.close();
  }
});
