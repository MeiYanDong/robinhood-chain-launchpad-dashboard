import assert from "node:assert/strict";
import test from "node:test";
import { buildPairFlowLedger } from "../src/pair-flow/ledger.js";
import type { PairAddressTransfer } from "../src/pair-flow/types.js";

const pair = `0x${"a".repeat(40)}`;
const spy = `0x${"b".repeat(40)}`;
const locker = `0x${"c".repeat(40)}`;
const pool = `0x${"d".repeat(40)}`;
const adapter = `0x${"e".repeat(40)}`;
const dead = `0x${"0".repeat(36)}dead`;
const creator = `0x${"1".repeat(40)}`;
const treasury = `0x${"2".repeat(40)}`;

function transfer(input: {
  index: number;
  token: string;
  from: string;
  to: string;
  amount: number;
  method?: string;
  timestamp?: string;
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
    timestamp: input.timestamp ?? "2026-09-04T16:30:00.000Z",
    method: input.method ?? "Transfer",
    symbol: null,
    tokenName: null,
    tokenPriceUsd: null,
  };
}

test("PAIR FIFO ledger separates direct fees, market buys, burns, pending lots, and SPY swaps", () => {
  const marketIn = transfer({
    index: 2,
    token: pair,
    from: pool,
    to: creator,
    amount: 50,
    method: "Swap",
  });
  const summary = buildPairFlowLedger(
    [
      transfer({ index: 1, token: pair, from: locker, to: creator, amount: 100 }),
      marketIn,
      marketIn,
      transfer({ index: 3, token: pair, from: creator, to: treasury, amount: 20 }),
      transfer({ index: 4, token: pair, from: creator, to: dead, amount: 110 }),
      transfer({ index: 5, token: pair, from: treasury, to: dead, amount: 20 }),
      transfer({ index: 6, token: spy, from: locker, to: creator, amount: 5, method: "Claim" }),
      transfer({ index: 7, token: spy, from: creator, to: adapter, amount: 4, method: "Swap" }),
      transfer({
        index: 8,
        token: pair,
        from: pool,
        to: creator,
        amount: 5,
        method: "Swap",
        timestamp: "2026-09-04T15:59:00.000Z",
      }),
    ],
    {
      pairTokenAddress: pair,
      spyTokenAddress: spy,
      lockerAddress: locker,
      poolManagerAddress: pool,
      swapAdapterAddresses: [adapter],
      deadAddress: dead,
      trackedWallets: [creator, treasury],
      calendarStartAt: "2026-09-04T16:00:00.000Z",
    },
  );

  assert.equal(summary.cumulativeDirectFeePair, 100);
  assert.equal(summary.cumulativeMarketAcquiredPair, 55);
  assert.equal(summary.burnedDirectFeePair, 100);
  assert.equal(summary.burnedMarketAcquiredPair, 30);
  assert.equal(summary.todayBurnedPair, 130);
  assert.equal(summary.todayDirectFeeBurnedPair, 100);
  assert.equal(summary.todayMarketAcquiredBurnedPair, 30);
  assert.equal(summary.pendingMarketAcquiredPair, 25);
  assert.equal(summary.reconstructedPairBalance, 25);
  assert.equal(summary.observedFeeSpyReceived, 5);
  assert.equal(summary.observedSpySwapSpend, 4);
});

test("PAIR FIFO ledger keeps unknown origins explicit when an outflow has no tracked lot", () => {
  const summary = buildPairFlowLedger(
    [transfer({ index: 1, token: pair, from: creator, to: dead, amount: 7 })],
    {
      pairTokenAddress: pair,
      spyTokenAddress: spy,
      lockerAddress: locker,
      poolManagerAddress: pool,
      swapAdapterAddresses: [],
      deadAddress: dead,
      trackedWallets: [creator],
      calendarStartAt: "2026-09-04T16:00:00.000Z",
    },
  );
  assert.equal(summary.burnedUnattributedPair, 7);
  assert.equal(summary.todayUnattributedBurnedPair, 7);
});
