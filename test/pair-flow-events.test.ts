import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PAIR_FLOW_SETTINGS } from "../src/pair-flow/config.js";
import {
  buildPairFlowEvents,
  pairFlowCandidateTransactionHashes,
} from "../src/pair-flow/events.js";
import type {
  PairAddressTransfer,
  PairTransactionDetail,
  PairTransactionTokenTransfer,
} from "../src/pair-flow/types.js";

const settings = { ...DEFAULT_PAIR_FLOW_SETTINGS };

function hash(index: number): string {
  return `0x${index.toString(16).padStart(64, "0")}`;
}

function transfer(input: {
  index: number;
  from: string;
  to: string;
  amount: number;
  method?: string;
  price?: number;
}): PairAddressTransfer {
  return {
    hash: hash(input.index),
    blockNumber: input.index,
    logIndex: input.index,
    from: input.from,
    to: input.to,
    token: settings.pairTokenAddress,
    rawValue: BigInt(input.amount) * 10n ** 18n,
    decimals: 18,
    timestamp: `2026-09-0${String(input.index)}T00:00:00.000Z`,
    method: input.method ?? "Transfer",
    symbol: "PAIR",
    tokenName: "PAIR",
    tokenPriceUsd: input.price ?? 0.01,
  };
}

function detailTransfer(input: {
  from: string;
  to: string;
  token: string;
  amount: bigint;
  decimals: number;
  symbol: string;
  price: number;
}): PairTransactionTokenTransfer {
  return {
    from: input.from,
    to: input.to,
    token: input.token,
    rawValue: input.amount,
    decimals: input.decimals,
    symbol: input.symbol,
    tokenName: input.symbol,
    tokenPriceUsd: input.price,
  };
}

test("PAIR flow events keep every market buy and burn while linking FIFO lots", () => {
  const direct = transfer({
    index: 1,
    from: settings.lockerAddress,
    to: settings.creatorAddress,
    amount: 100,
  });
  const buy = transfer({
    index: 2,
    from: settings.poolManagerAddress,
    to: settings.creatorAddress,
    amount: 50,
    method: "Swap",
  });
  const burnMixed = transfer({
    index: 3,
    from: settings.creatorAddress,
    to: settings.deadAddress,
    amount: 120,
  });
  const burnMarket = transfer({
    index: 4,
    from: settings.creatorAddress,
    to: settings.deadAddress,
    amount: 30,
  });
  const unrelatedExecutorSwap = transfer({
    index: 5,
    from: settings.poolManagerAddress,
    to: "0x1111111111111111111111111111111111111111",
    amount: 999,
    method: "Swap",
  });
  const detail: PairTransactionDetail = {
    hash: buy.hash,
    blockNumber: buy.blockNumber,
    from: settings.creatorAddress,
    to: settings.swapAdapterAddresses[0] ?? null,
    rawNativeValue: 2n * 10n ** 18n,
    method: "Swap",
    status: "success",
    timestamp: buy.timestamp,
    tokenTransfers: [
      detailTransfer({
        from: settings.swapAdapterAddresses[0] ?? settings.creatorAddress,
        to: settings.poolManagerAddress,
        token: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
        amount: 4_858_041_786n,
        decimals: 6,
        symbol: "USDG",
        price: 1,
      }),
      detailTransfer({
        from: settings.poolManagerAddress,
        to: settings.creatorAddress,
        token: settings.pairTokenAddress,
        amount: 50n * 10n ** 18n,
        decimals: 18,
        symbol: "PAIR",
        price: 0.01,
      }),
    ],
    fetchedAt: buy.timestamp,
  };

  const input = [direct, buy, burnMixed, burnMarket, unrelatedExecutorSwap];
  assert.deepEqual(pairFlowCandidateTransactionHashes(input, settings), [
    buy.hash,
    burnMixed.hash,
    burnMarket.hash,
  ]);
  const events = buildPairFlowEvents(input, new Map([[buy.hash, detail]]), settings);
  assert.equal(events.length, 3);

  const buyEvent = events.find((event) => event.type === "buyback");
  assert.equal(buyEvent?.pairAmount, 50);
  assert.equal(buyEvent?.usdValue, 4_858.041786);
  assert.equal(buyEvent?.usdValuation, "settlement_observed");
  assert.equal(buyEvent?.inputAssets[0]?.symbol, "ETH");
  assert.deepEqual(buyEvent?.linkedTxHashes, [burnMixed.hash, burnMarket.hash]);

  const mixed = events.find((event) => event.txHash === burnMixed.hash);
  assert.equal(mixed?.category, "mixed_burn");
  assert.equal(mixed?.allocations[0]?.category, "direct_fee");
  assert.equal(mixed?.allocations[0]?.pairAmount, 100);
  assert.equal(mixed?.allocations[1]?.pairAmount, 20);
  assert.deepEqual(mixed?.linkedTxHashes, [buy.hash]);

  const market = events.find((event) => event.txHash === burnMarket.hash);
  assert.equal(market?.category, "market_buy_burn");
  assert.equal(market?.allocations[0]?.pairAmount, 30);
});

test("behavior-inferred executor events stay visibly inferred", () => {
  const buy = transfer({
    index: 2,
    from: settings.poolManagerAddress,
    to: settings.executorAddress,
    amount: 12,
    method: "Swap",
  });
  const [event] = buildPairFlowEvents([buy], new Map(), settings);
  assert.equal(event?.actorRole, "executor_inferred");
  assert.equal(event?.actorAttribution, "behavior_inferred");
  assert.equal(event?.evidence, "behavior_inferred");
  assert.equal(event?.usdValue, null);
});
