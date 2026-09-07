import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_INTELLIGENCE_SETTINGS,
  intelligenceSettingsFromEnv,
} from "../src/intelligence/config.js";
import { IntelligenceService } from "../src/intelligence/service.js";
import type { LongLeaderboardResponse } from "../src/long-tokens/types.js";
import type { PairLeaderboardResponse } from "../src/pair/types.js";

function emptyRadar(service: "pair" | "long") {
  const rankings = Object.fromEntries(
    ["market_cap_usd", "liquidity_depth_usd", "volume_24h_usd", "holder_count"].map((metric) => [
      metric,
      { metric, label: metric, unit: "USD", observedCount: 0, entries: [] },
    ]),
  );
  return {
    service: service === "pair" ? "rhc-pair-token-radar" : "rhc-long-token-radar",
    mode: "live",
    generatedAt: "2026-09-04T03:00:00.000Z",
    reportDate: null,
    windowStart: null,
    cutoffAt: null,
    snapshot: null,
    eligibility: { marketCapFloorUsd: 1, liquidityDepthFloorUsd: 1, marketFreshnessMinutes: 60 },
    rankings,
    sources: [],
    warnings: [],
  } as unknown as PairLeaderboardResponse | LongLeaderboardResponse;
}

test("intelligence service coalesces source reads and honors its cache TTL", async () => {
  let now = new Date("2026-09-04T03:00:00.000Z");
  let calls = 0;
  const service = new IntelligenceService(
    { ...DEFAULT_INTELLIGENCE_SETTINGS, refreshTtlMinutes: 5 },
    {
      economics: { snapshot: () => null },
      pair: { rankings: () => emptyRadar("pair") as PairLeaderboardResponse },
      long: { rankings: () => emptyRadar("long") as LongLeaderboardResponse },
      now: () => now,
      fetcher: async () => {
        calls += 1;
        await Promise.resolve();
        return new Response(JSON.stringify({ generatedAt: now.toISOString() }), { status: 200 });
      },
    },
  );

  const [first, concurrent] = await Promise.all([service.ensureFresh(), service.ensureFresh()]);
  assert.equal(first, concurrent);
  assert.equal(calls, 2);
  assert.equal(service.health().ok, true);
  await service.ensureFresh();
  assert.equal(calls, 2);
  now = new Date("2026-09-04T03:06:00.000Z");
  await service.ensureFresh();
  assert.equal(calls, 4);
});

test("intelligence service degrades unavailable JSON sources without leaking errors", async () => {
  const warnings: Array<Record<string, unknown>> = [];
  const service = new IntelligenceService(DEFAULT_INTELLIGENCE_SETTINGS, {
    economics: { snapshot: () => null },
    pair: { rankings: () => emptyRadar("pair") as PairLeaderboardResponse },
    long: { rankings: () => emptyRadar("long") as LongLeaderboardResponse },
    now: () => new Date("2026-09-04T03:00:00.000Z"),
    warn: (_event, context) => warnings.push(context),
    fetcher: async (input) => {
      const url = String(input);
      if (url.includes("4173")) return new Response("not-json", { status: 200 });
      return new Response("unavailable", { status: 503 });
    },
  });
  const snapshot = await service.refresh();
  assert.equal(snapshot.status, "unavailable");
  assert.equal(warnings.length, 0);
  assert.equal(snapshot.sources.filter((source) => source.status === "failed").length, 5);
});

test("intelligence environment config validates URLs and positive intervals", () => {
  assert.equal(
    intelligenceSettingsFromEnv({ INTELLIGENCE_REFRESH_TTL_MINUTES: "7" }).refreshTtlMinutes,
    7,
  );
  assert.throws(
    () => intelligenceSettingsFromEnv({ INTELLIGENCE_CHAIN_RADAR_URL: "file:///tmp/a" }),
    /must use HTTP/,
  );
  assert.throws(
    () => intelligenceSettingsFromEnv({ INTELLIGENCE_CASHCAT_STATUS_URL: "not-a-url" }),
    /valid URL/,
  );
  assert.throws(
    () => intelligenceSettingsFromEnv({ INTELLIGENCE_REQUEST_TIMEOUT_MS: "0" }),
    /must be positive/,
  );
});
