import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PairV2FeishuNotifier, planPairV2Alerts } from "../src/pair-v2/alerts.js";
import { DEFAULT_PAIR_V2_SETTINGS } from "../src/pair-v2/config.js";
import { PairV2Database } from "../src/pair-v2/database.js";
import type { PairV2DashboardResponse } from "../src/pair-v2/types.js";

function dashboard(): PairV2DashboardResponse {
  return {
    service: "rhc-pair-v2-monitor",
    generatedAt: "2026-09-05T08:00:00.000Z",
    observedAt: "2026-09-05T08:00:00.000Z",
    status: "success",
    stale: false,
    monitoring: {
      chainPollSeconds: 8,
      marketPollSeconds: 60,
      staleAfterSeconds: 150,
    },
    release: {
      releaseId: DEFAULT_PAIR_V2_SETTINGS.expectedReleaseId,
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
        launchpad: "0x1111111111111111111111111111111111111111",
        modeRegistry: "0x2222222222222222222222222222222222222222",
        coordinator: "0x3333333333333333333333333333333333333333",
        tokenFactory: "0x4444444444444444444444444444444444444444",
        hook: "0x5555555555555555555555555555555555555555",
        buybackExecutor: "0x6666666666666666666666666666666666666666",
        aggregator: "0x7777777777777777777777777777777777777777",
      },
      sourceVerification: "active_graph_unverified",
      auditEvidence: "not_observed",
      upgradeAuthority: "single_eoa_observed",
    },
    overview: {
      latestBlock: 110,
      publicV2TokenCount: 0,
      currentReleaseLaunchCount: 0,
      currentReleaseIndexedCount: 0,
      marketCoveragePercent: 0,
      officialPoolTokenCount: 0,
      officialPoolVolume5mUsd: null,
      officialPoolVolume1hUsd: null,
      officialPoolVolume24hUsd: null,
      officialPoolLiquidityUsd: null,
      volume24hUsd: 0,
      marketCapUsd: 0,
      liquidityUsd: null,
      userFees24hUsd: 0,
      modeShare24hUsd: 0,
      protocolShare24hUsd: 0,
      buybackModeVolume24hUsd: 0,
      buybackBudget24hUsd: 0,
      buybackExecutedCount: 0,
      holderClaimCount: 0,
      upgradeCount: 0,
    },
    modeCounts: [],
    alphaModel: {
      version: "pair-v2-alpha-v2.0.0",
      status: "shadow",
      validated: false,
      observationStartedAt: null,
      observationDays: 0,
      firstSignalCount: 0,
      matured24hCount: 0,
      graduation: {
        minimumDays: 14,
        minimumMaturedProjects: 50,
        dayProgressPercent: 0,
        sampleProgressPercent: 0,
        readyForReview: false,
      },
      horizons: ["5m", "30m", "2h", "24h"].map((horizon) => ({
        horizon: horizon as "5m" | "30m" | "2h" | "24h",
        observedCount: 0,
        medianGrossReturnPct: null,
        medianFeeAdjustedReturnPct: null,
        positiveRatePercent: null,
        loss20RatePercent: null,
      })),
      limitations: [],
    },
    tokens: [],
    events: [],
    sources: [],
    alerts: { configured: false, pending: 0, failed: 0, lastSentAt: null },
    warnings: [],
  };
}

test("PAIR V2 alerts are transition-based and do not flood on the first baseline", () => {
  const first = dashboard();
  assert.deepEqual(planPairV2Alerts(null, first), []);
  const current = structuredClone(first);
  current.observedAt = "2026-09-05T09:00:00.000Z";
  current.events = [
    {
      id: `4663:0x${"a".repeat(64)}:1`,
      releaseId: current.release.releaseId,
      type: "upgrade",
      blockNumber: 120,
      transactionHash: `0x${"a".repeat(64)}`,
      logIndex: 1,
      timestamp: current.observedAt,
      emitter: current.release.addresses.launchpad,
      project: null,
      vault: null,
      actor: null,
      asset: null,
      assetSymbol: null,
      amountRaw: null,
      amount: null,
      secondaryAmountRaw: null,
      secondaryAmount: null,
      epoch: null,
      positionId: null,
      modeId: null,
      implementation: "0x8888888888888888888888888888888888888888",
      evidence: "onchain",
    },
  ];
  const alerts = planPairV2Alerts(first, current);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.severity, "critical");
  assert.equal(alerts[0]?.type, "upgrade");
});

test("PAIR V2 alerts only promote research-eligible signals and keep heat and risk separate", () => {
  const previous = dashboard();
  const current = dashboard();
  current.observedAt = "2026-09-05T09:00:00.000Z";
  const token = (
    signalState: "watch" | "forming",
    researchEligible: boolean,
    heatState: "normal" | "overheated",
    risk: "low" | "high",
  ) =>
    ({
      address: "0x1111111111111111111111111111111111115555",
      symbol: "ALPHA",
      alpha: {
        stage: signalState,
        discoveryScore: 80,
        confirmationScore: signalState === "forming" ? 70 : 40,
        heatScore: heatState === "overheated" ? 88 : 30,
        risk,
        confidence: "high",
        confidenceScore: 95,
        reasons: [],
        risks: [],
        missing: [],
        quality: { score: 76, state: "qualified", reasons: [], missing: [] },
        signal: {
          score: signalState === "forming" ? 70 : 40,
          state: signalState,
          researchEligible,
          reasons: [],
          missing: [],
        },
        heat: { score: heatState === "overheated" ? 88 : 30, state: heatState, reasons: [] },
        riskProfile: {
          platform: "high",
          token: risk,
          tradeReady: false,
          platformReasons: [],
          tokenReasons: risk === "high" ? ["流动性下降"] : [],
        },
      },
    }) as unknown as PairV2DashboardResponse["tokens"][number];
  previous.tokens = [token("watch", false, "normal", "low")];
  current.tokens = [token("forming", true, "overheated", "high")];

  const alerts = planPairV2Alerts(previous, current);
  assert.deepEqual(
    alerts.map((alert) => alert.type),
    ["alpha", "heat", "risk"],
  );
  assert.match(alerts[0]?.message ?? "", /Shadow 信号/);
});

test("Feishu notifier sends only queued alerts and records a successful readback", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pair-v2-alert-"));
  const database = new PairV2Database(join(directory, "test.sqlite"));
  const bodies: unknown[] = [];
  try {
    database.enqueueAlerts([
      {
        dedupeKey: "fixture:1",
        severity: "warning",
        type: "alpha",
        title: "Alpha",
        message: "signal",
        project: null,
        createdAt: "2026-09-05T08:00:00.000Z",
      },
    ]);
    const notifier = new PairV2FeishuNotifier(
      {
        feishuWebhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/test",
        requestTimeoutMs: 1_000,
      },
      {
        now: () => new Date("2026-09-05T08:01:00.000Z"),
        fetcher: async (_url, init) => {
          bodies.push(JSON.parse(String(init?.body)));
          return Response.json({ code: 0 });
        },
      },
    );
    await notifier.flush(database);
    assert.equal(bodies.length, 1);
    assert.equal(database.pendingAlerts().length, 0);
    assert.equal(database.alertSummary(true).lastSentAt, "2026-09-05T08:01:00.000Z");
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
