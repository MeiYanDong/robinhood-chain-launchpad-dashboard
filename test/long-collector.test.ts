import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_LONG_TOKEN_SETTINGS } from "../src/long-tokens/config.js";
import { LongTokenCollector } from "../src/long-tokens/collector.js";

const now = new Date("2026-09-01T12:00:00.000Z");
const settings = { ...DEFAULT_LONG_TOKEN_SETTINGS, rpcThrottleMs: 0 };

function address(id: number): string {
  return `0x${String(id).padStart(40, "0")}`;
}

function row(id: number, value: number, overrides: Record<string, unknown> = {}) {
  return {
    address: address(id),
    name: `Long Token ${String(id)}`,
    symbol: `L${String(id)}`,
    price: value / 100_000,
    market_cap: value,
    liquidity: value / 2,
    volume: value / 4,
    holder_count: value,
    launchpad_platform: "longxyz",
    launchpad_status: "1",
    creation_timestamp: 1_788_192_000,
    ...overrides,
  };
}

function rankFetch(rows: unknown[]) {
  return async () => ({
    payload: { code: 0, data: { rank: rows } },
    fetchedAt: now.toISOString(),
    latencyMs: 8,
  });
}

function membership(tokenAddress: string) {
  return {
    tokenAddress,
    launcherAddress: settings.launcherAddress,
    verifiedAt: now.toISOString(),
    blockNumber: "0x900000",
    transactionHash: `0x${"a".repeat(64)}`,
  };
}

test("Long collector builds an economic active sample and verifies every Top 5 candidate", async () => {
  const verified: string[] = [];
  const collector = new LongTokenCollector(settings, {
    now: () => now,
    pause: async () => undefined,
    fetchRank: rankFetch([
      row(1, 60_000),
      row(2, 50_000),
      row(3, 40_000),
      row(4, 30_000),
      row(5, 20_000),
      row(6, 5_000),
      row(7, 70_000, { launchpad_platform: "another-platform" }),
    ]),
    verifyMembership: async (tokenAddress) => {
      verified.push(tokenAddress);
      return membership(tokenAddress);
    },
  });

  const batch = await collector.collect(new Set());

  assert.equal(batch.universeCount, 6);
  assert.equal(batch.eligibleCount, 5);
  assert.deepEqual(verified, [1, 2, 3, 4, 5].map(address));
  assert.equal(batch.verifiedMembership.length, 5);
  assert.equal(batch.tokens[0]?.tokenUrl, `https://app.long.xyz/tokens/${address(1)}`);
  assert.equal(batch.tokens[0]?.priceUsd, 0.6);
  assert.equal(batch.tokens[0]?.holderCount, 60_000);
  assert.equal(batch.tokens.at(-1)?.eligibilityReason, "market_cap_below_floor");
  assert.deepEqual(batch.warnings, ["long_invalid_rows_skipped"]);
  assert.ok(batch.sourceHealth.every((source) => source.status === "ok"));
});

test("Long collector reuses immutable launcher membership cache", async () => {
  let verifierCalls = 0;
  const rows = [row(1, 60_000), row(2, 50_000), row(3, 40_000), row(4, 30_000), row(5, 20_000)];
  const collector = new LongTokenCollector(settings, {
    now: () => now,
    fetchRank: rankFetch(rows),
    verifyMembership: async (tokenAddress) => {
      verifierCalls += 1;
      return membership(tokenAddress);
    },
  });

  const batch = await collector.collect(new Set(rows.map((item) => String(item.address))));

  assert.equal(verifierCalls, 0);
  assert.deepEqual(batch.verifiedMembership, []);
  assert.match(batch.sourceHealth[1]?.message ?? "", /5\/5/);
});

test("Long collector fails closed on malformed ranks and mismatched launcher receipts", async () => {
  const malformed = new LongTokenCollector(settings, {
    fetchRank: async () => ({
      payload: { code: 0, data: {} },
      fetchedAt: now.toISOString(),
      latencyMs: 1,
    }),
  });
  await assert.rejects(malformed.collect(new Set()), /rank rows/);

  const mismatch = new LongTokenCollector(settings, {
    now: () => now,
    fetchRank: rankFetch([row(1, 60_000)]),
    verifyMembership: async () => membership(address(2)),
  });
  await assert.rejects(mismatch.collect(new Set()), /mismatched token/);
});
