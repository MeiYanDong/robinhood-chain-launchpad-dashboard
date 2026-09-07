import assert from "node:assert/strict";
import test from "node:test";
import {
  PairFlowCollector,
  parseAddressTransfer,
  parsePairMainToken,
  parsePairOhlcv,
  parseTransactionDetail,
  parseTreasuryClaimable,
  type PairFlowSourceResult,
} from "../src/pair-flow/collector.js";
import { DEFAULT_PAIR_FLOW_SETTINGS } from "../src/pair-flow/config.js";
import type {
  PairChainObservation,
  PairMainTokenObservation,
  PairOhlcvObservation,
  PairTreasuryClaimableObservation,
  PairTransferHistoryObservation,
} from "../src/pair-flow/types.js";

const settings = { ...DEFAULT_PAIR_FLOW_SETTINGS };
const observedAt = "2026-09-04T16:30:00.000Z";

function result<T>(value: T): PairFlowSourceResult<T> {
  return { value, fetchedAt: observedAt, latencyMs: 3 };
}

function mainToken(): PairMainTokenObservation {
  return {
    observedAt,
    priceUsd: 0.01,
    volume24hUsd: 4_000_000,
    liquidityUsd: 120_000,
    poolFeeBps: 10_000,
    poolId: settings.poolId,
    positionTokenId: settings.positionTokenId,
  };
}

function ohlcv(): PairOhlcvObservation {
  return { observedAt, candles: [{ timestamp: 1_788_537_600, volumeUsd: 50_000 }] };
}

function chain(): PairChainObservation {
  return {
    observedAt,
    blockNumber: "0x1",
    collectSimulationSucceeded: true,
    pairTotalSupply: 1_000_000_000,
    pairDeadBalance: 90_000_000,
    walletPairBalances: {},
    walletSpyBalances: {},
    claimableBefore: { creatorPair: 1, treasuryPair: 2, creatorSpy: 3, treasurySpy: 4 },
    claimableAfter: { creatorPair: 2, treasuryPair: 3, creatorSpy: 4, treasurySpy: 5 },
    spyPriceUsd: 770,
    spyPriceUpdatedAt: observedAt,
  };
}

function history(complete = true): PairTransferHistoryObservation {
  return {
    observedAt,
    transfers: [],
    walletCount: 3,
    complete,
    truncatedWallets: complete ? [] : [settings.creatorAddress],
  };
}

function treasuryClaimable(): PairTreasuryClaimableObservation {
  return {
    observedAt,
    quoteAssetCount: 2,
    quoteUsdCoverageCount: 2,
    quoteClaimableUsd: 1_000,
    spyClaimable: 0.5,
    spyClaimableUsd: 385,
  };
}

test("PAIR flow parsers validate the official pool, OHLCV candles, and transfer rows", () => {
  const parsedToken = parsePairMainToken(
    {
      address: settings.pairTokenAddress,
      priceUsd: "0.01",
      combinedVolume24hUsd: "4000000",
      marketDataUpdatedAt: observedAt,
      pairs: [
        {
          poolId: settings.poolId,
          positionTokenId: settings.positionTokenId,
          totalDepthUsd: "120000",
          poolFee: 10000,
        },
      ],
    },
    observedAt,
    settings,
  );
  assert.deepEqual(parsedToken, mainToken());

  assert.deepEqual(
    parsePairOhlcv(
      {
        data: {
          attributes: {
            ohlcv_list: [
              [1_788_537_600, 1, 2, 0.5, 1.5, 50_000],
              ["bad", 1, 2, 0.5, 1.5, "bad"],
            ],
          },
        },
      },
      observedAt,
    ),
    ohlcv(),
  );

  const parsedTransfer = parseAddressTransfer({
    hash: `0x${"a".repeat(64)}`,
    block: 123,
    logIndex: 7,
    from: settings.lockerAddress,
    to: settings.creatorAddress,
    token: settings.pairTokenAddress,
    value: "1000000000000000000",
    decimals: 18,
    timestamp: observedAt,
    method: "Claim",
    symbol: "PAIR",
    tokenName: "PAIR",
    tokenPriceUsd: "0.01",
  });
  assert.equal(parsedTransfer?.rawValue, 1_000_000_000_000_000_000n);
  assert.equal(parsedTransfer?.method, "Claim");
  assert.equal(parsedTransfer?.symbol, "PAIR");
  assert.equal(parsedTransfer?.tokenPriceUsd, 0.01);
  assert.equal(parseAddressTransfer({ value: "not-a-number" }), null);

  assert.deepEqual(
    parseTreasuryClaimable(
      [
        {
          assetType: "QUOTE",
          quoteToken: { decimals: 18 },
          claimAssetAddress: settings.spyTokenAddress,
          claimableAmount: "500000000000000000",
          claimableAmountUsd: "385",
        },
        {
          assetType: "QUOTE",
          quoteToken: { decimals: 18 },
          claimAssetAddress: "0xff080c8ce2e5feadaca0da81314ae59d232d4afd",
          claimableAmount: "1000000000000000000",
          claimableAmountUsd: "615",
        },
        { assetType: "PROJECT" },
      ],
      observedAt,
      settings,
    ),
    treasuryClaimable(),
  );
});

test("PAIR flow transaction detail parser preserves status and token movements", () => {
  const hash = `0x${"b".repeat(64)}`;
  const detail = parseTransactionDetail(
    {
      hash,
      block: 9,
      from: settings.creatorAddress,
      to: settings.swapAdapterAddresses[0],
      value: "2000000000000000000",
      method: "Swap",
      status: 1,
      timestamp: observedAt,
      tokenTransfers: [
        {
          from: settings.poolManagerAddress,
          to: settings.creatorAddress,
          token: settings.pairTokenAddress,
          value: "50000000000000000000",
          decimals: 18,
          symbol: "PAIR",
          tokenName: "PAIR",
          tokenPriceUsd: 0.01,
        },
      ],
    },
    observedAt,
  );
  assert.equal(detail.hash, hash);
  assert.equal(detail.rawNativeValue, 2_000_000_000_000_000_000n);
  assert.equal(detail.status, "success");
  assert.equal(detail.tokenTransfers[0]?.symbol, "PAIR");
  assert.throws(() => parseTransactionDetail({ hash: "bad" }, observedAt), /identity/);
});

test("PAIR flow parsers reject changed pool identity and empty market responses", () => {
  assert.throws(
    () =>
      parsePairMainToken({ address: settings.pairTokenAddress, pairs: [] }, observedAt, settings),
    /pool is missing/,
  );
  assert.throws(
    () => parsePairOhlcv({ data: { attributes: { ohlcv_list: [] } } }, observedAt),
    /no usable candles/,
  );
});

test("PAIR flow collector coordinates independent sources and preserves degraded evidence", async () => {
  const collector = new PairFlowCollector(settings, {
    fetchPairToken: async () => result(mainToken()),
    fetchOhlcv: async () => result(ohlcv()),
    fetchChain: async () => result({ ...chain(), collectSimulationSucceeded: false }),
    fetchHistory: async () => result(history(false)),
    fetchTreasuryClaimable: async () => result(treasuryClaimable()),
    platformVolume: () => ({
      runId: 1,
      observedAt,
      tokenCount: 20,
      volumeObservedCount: 19,
      volume24hUsd: 5_000_000,
      complete: false,
    }),
    now: () => new Date(observedAt),
  });
  const batch = await collector.collect();
  assert.equal(batch.mainToken?.priceUsd, 0.01);
  assert.equal(batch.platform?.volume24hUsd, 5_000_000);
  assert.equal(batch.sources.find((source) => source.source.includes("rpc"))?.status, "degraded");
  assert.equal(
    batch.sources.find((source) => source.source.includes("addressTransfers"))?.status,
    "degraded",
  );
  assert.equal(
    batch.sources.find((source) => source.source.includes("universeAggregate"))?.status,
    "degraded",
  );
  assert.equal(batch.warnings.length, 3);
});

test("PAIR flow collector paginates all tracked wallets and keeps source failures isolated", async () => {
  const requested: string[] = [];
  const collector = new PairFlowCollector(settings, {
    fetchPairToken: async () => result(mainToken()),
    fetchOhlcv: async () => {
      throw new Error("ohlcv unavailable");
    },
    fetchChain: async () => result(chain()),
    fetchTreasuryClaimable: async () => result(treasuryClaimable()),
    fetchPage: async (url) => {
      requested.push(url);
      return {
        payload: {
          rows: [
            {
              hash: `0x${"1".repeat(64)}`,
              block: 1,
              from: settings.lockerAddress,
              to: settings.creatorAddress,
              token: settings.pairTokenAddress,
              value: "1",
              decimals: 18,
              timestamp: settings.historyStartAt,
              method: "Claim",
            },
          ],
          next: null,
        },
        fetchedAt: observedAt,
        latencyMs: 1,
        sha256: "fixture",
      };
    },
    now: () => new Date(observedAt),
  });
  const batch = await collector.collect();
  assert.equal(requested.length, 3);
  assert.equal(batch.history?.complete, true);
  assert.equal(batch.history?.walletCount, 3);
  assert.equal(batch.ohlcv, null);
  assert.equal(batch.sources[1]?.status, "failed");
});
