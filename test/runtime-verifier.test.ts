import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeVerificationError, verifyRuntime } from "../src/ops/runtime-verifier.js";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("runtime verification performs only the nineteen documented GET checks", async () => {
  const requests: Array<{ url: string; method: string; redirect: RequestRedirect }> = [];
  const responses: Record<string, unknown> = {
    "/healthz": { ok: true, service: "rhc-launch-ledger", targetDate: "2026-08-29" },
    "/api/overview?window=30": { targetDate: "2026-08-29", platforms: [{ id: "pons" }] },
    "/api/sources": { sources: [{ source: "fixture", status: "ok" }] },
    "/api/pair/health": { ok: true, service: "rhc-pair-token-radar" },
    "/api/pair/rankings": {
      service: "rhc-pair-token-radar",
      snapshot: { eligibleCount: 11 },
      rankings: {
        market_cap_usd: { entries: [{ address: "0x1" }] },
        liquidity_depth_usd: { entries: [{ address: "0x2" }] },
        volume_24h_usd: { entries: [{ address: "0x3" }] },
        holder_count: { entries: [{ address: "0x4" }] },
      },
    },
    "/api/pair/flow": {
      service: "rhc-pair-flow",
      window: { calendarDate: "2026-08-30" },
      volume: {},
      burn: {},
      buyback: {},
      pressure: {},
      sources: [{ source: "rpc", status: "ok" }],
    },
    "/api/pair/v2/health": {
      ok: true,
      service: "rhc-pair-v2-monitor",
      backgroundMonitor: true,
    },
    "/api/pair/v2": {
      service: "rhc-pair-v2-monitor",
      release: { canonical: true },
      overview: { latestBlock: 123 },
      monitoring: { chainPollSeconds: 8, marketPollSeconds: 60 },
      tokens: [{ address: "0x9" }],
      events: [],
      sources: [{ id: "robinhood_rpc" }],
    },
    "/api/dev-monitor/health": {
      service: "rhc-dev-monitor",
      enabled: true,
      baselineComplete: true,
      status: "partial",
      counts: { projects: 100, watched: 4 },
      alerts: { configured: true, pending: 0, failed: 0 },
      sources: [{ id: "pair_v2", status: "ok" }],
    },
    "/api/dev-monitor/pair-launches?tier=all&limit=20&offset=0": {
      service: "rhc-dev-monitor",
      scope: "pair_v2_public_launches",
      total: 1,
      counts: { all: 1, candidate: 0, repeat: 0, proven: 1, watched: 1 },
      items: [{ address: "0x9", creator: "0xa", creatorTier: "proven" }],
    },
    "/api/dev-monitor/pair-team-launches?limit=20&offset=0": {
      service: "rhc-dev-monitor",
      scope: "pair_official_team_launches",
      issuer: {
        address: "0xa15e4ad0dbc8df1715a7b254526252cd93bb1102",
        verification: "verified_primary_issuer",
      },
      total: 2,
      counts: { officialProtocolTokens: 1, verifiedIssuerWalletLaunches: 1 },
      items: [{ address: "0x6b1d" }, { address: "0x5422" }],
    },
    "/api/long/health": { ok: true, service: "rhc-long-token-radar" },
    "/api/long/rankings": {
      service: "rhc-long-token-radar",
      snapshot: { eligibleCount: 8 },
      rankings: {
        market_cap_usd: { entries: [{ address: "0x5" }] },
        liquidity_depth_usd: { entries: [{ address: "0x6" }] },
        volume_24h_usd: { entries: [{ address: "0x7" }] },
        holder_count: { entries: [{ address: "0x8" }] },
      },
    },
    "/api/economics/health": {
      ok: true,
      service: "rhc-launchpad-economics",
      targetDate: "2026-08-29",
    },
    "/api/economics": {
      service: "rhc-launchpad-economics",
      targetDate: "2026-08-29",
      tokens: ["pons", "long", "pair"].map((platformId) => ({
        platformId,
        priceUsd: { value: 0.1, state: "observed" },
      })),
      platforms: [{ platformId: "pons" }, { platformId: "long" }, { platformId: "pair" }],
      buybacks: [],
      pairRelativeValuation: {
        modelVersion: "pons-volume-parity-v1",
        state: "available",
      },
    },
    "/api/economics/valuation": {
      modelVersion: "pons-volume-parity-v1",
      state: "available",
      inputs: {},
      commonDates: ["2026-08-23", "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27"],
      commonDayCount: 5,
      platformWindowEnd: "2026-08-27",
    },
    "/api/economics/valuation/history": {
      service: "rhc-launchpad-economics",
      window: "7d",
      points: [{ observedAt: "2026-08-30T11:45:00.000Z" }],
    },
    "/api/intelligence/health": {
      ok: true,
      service: "rhc-market-intelligence",
    },
    "/api/intelligence": {
      service: "rhc-market-intelligence",
      leader: {},
      chainHeat: {},
      tokenHeat: {},
      relativeValuation: {},
      sources: [{ id: "chain_radar" }],
    },
  };
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    requests.push({
      url: url.pathname + url.search,
      method: init?.method ?? "GET",
      redirect: init?.redirect ?? "follow",
    });
    return jsonResponse(responses[url.pathname + url.search]);
  };

  const result = await verifyRuntime("http://127.0.0.1:4174", {
    fetcher,
    now: () => new Date("2026-08-30T12:00:00.000Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.checkedAt, "2026-08-30T12:00:00.000Z");
  assert.deepEqual(requests, [
    { url: "/healthz", method: "GET", redirect: "error" },
    { url: "/api/overview?window=30", method: "GET", redirect: "error" },
    { url: "/api/sources", method: "GET", redirect: "error" },
    { url: "/api/pair/health", method: "GET", redirect: "error" },
    { url: "/api/pair/rankings", method: "GET", redirect: "error" },
    { url: "/api/pair/flow", method: "GET", redirect: "error" },
    { url: "/api/pair/v2/health", method: "GET", redirect: "error" },
    { url: "/api/pair/v2", method: "GET", redirect: "error" },
    { url: "/api/dev-monitor/health", method: "GET", redirect: "error" },
    {
      url: "/api/dev-monitor/pair-launches?tier=all&limit=20&offset=0",
      method: "GET",
      redirect: "error",
    },
    {
      url: "/api/dev-monitor/pair-team-launches?limit=20&offset=0",
      method: "GET",
      redirect: "error",
    },
    { url: "/api/long/health", method: "GET", redirect: "error" },
    { url: "/api/long/rankings", method: "GET", redirect: "error" },
    { url: "/api/economics/health", method: "GET", redirect: "error" },
    { url: "/api/economics", method: "GET", redirect: "error" },
    { url: "/api/economics/valuation", method: "GET", redirect: "error" },
    { url: "/api/economics/valuation/history", method: "GET", redirect: "error" },
    { url: "/api/intelligence/health", method: "GET", redirect: "error" },
    { url: "/api/intelligence", method: "GET", redirect: "error" },
  ]);
  assert.equal(result.checks[1]?.itemCount, 1);
  assert.equal(result.checks[4]?.itemCount, 11);
  assert.equal(result.checks[5]?.itemCount, 1);
  assert.equal(result.checks[7]?.itemCount, 1);
  assert.equal(result.checks[8]?.itemCount, 4);
  assert.equal(result.checks[9]?.itemCount, 1);
  assert.equal(result.checks[10]?.itemCount, 2);
  assert.equal(result.checks[12]?.itemCount, 8);
  assert.equal(result.checks[14]?.itemCount, 3);
  assert.equal(result.checks[15]?.itemCount, 5);
  assert.equal(result.checks[16]?.itemCount, 1);
  assert.equal(result.checks[18]?.itemCount, 1);
});

test("runtime verification fails closed on readiness and response contract errors", async () => {
  await assert.rejects(
    verifyRuntime("http://127.0.0.1:4174", {
      fetcher: async () => jsonResponse({ ok: false, service: "rhc-launch-ledger" }),
    }),
    (error: unknown) =>
      error instanceof RuntimeVerificationError && error.code === "RUNTIME_NOT_READY",
  );

  let requestNumber = 0;
  await assert.rejects(
    verifyRuntime("http://127.0.0.1:4174", {
      fetcher: async () => {
        requestNumber += 1;
        return requestNumber === 1
          ? jsonResponse({ ok: true, service: "rhc-launch-ledger" })
          : jsonResponse({ targetDate: "2026-08-29", platforms: "not-an-array" });
      },
    }),
    (error: unknown) =>
      error instanceof RuntimeVerificationError && error.code === "RUNTIME_CONTRACT_ERROR",
  );
});

test("runtime verification rejects embedded credentials and non-success responses", async () => {
  await assert.rejects(
    verifyRuntime("http://user:secret@127.0.0.1:4174"),
    (error: unknown) =>
      error instanceof RuntimeVerificationError && error.code === "INVALID_BASE_URL",
  );

  await assert.rejects(
    verifyRuntime("http://127.0.0.1:4174", {
      fetcher: async () => jsonResponse({ error: "unavailable" }, 503),
    }),
    (error: unknown) =>
      error instanceof RuntimeVerificationError && error.code === "RUNTIME_HTTP_ERROR",
  );
});
