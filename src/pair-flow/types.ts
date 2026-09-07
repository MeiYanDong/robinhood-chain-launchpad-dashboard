import type { EvidenceQuality, ValueState } from "../economics/types.js";
import type { PairPlatformLiveAggregate } from "../pair/types.js";

export type PairFlowEvidenceTier = "confirmed" | "policy_expected" | "unattributed" | "unknown";

export type PairFlowUnit = "USD" | "PAIR" | "SPY" | "percent" | "count";

export interface PairFlowValue {
  value: number | null;
  state: ValueState;
  quality: EvidenceQuality;
  tier: PairFlowEvidenceTier;
  unit: PairFlowUnit;
  source: string | null;
  asOf: string | null;
  note: string | null;
}

export interface PairFlowSourceHealth {
  source: string;
  label: string;
  status: "ok" | "degraded" | "failed";
  fetchedAt: string;
  message: string;
  url: string | null;
}

export interface PairMainTokenObservation {
  observedAt: string;
  priceUsd: number | null;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  poolFeeBps: number | null;
  poolId: string;
  positionTokenId: string;
}

export interface PairOhlcvObservation {
  observedAt: string;
  candles: Array<{ timestamp: number; volumeUsd: number }>;
}

export interface PairAddressTransfer {
  hash: string;
  blockNumber: number;
  logIndex: number | null;
  from: string;
  to: string;
  token: string;
  rawValue: bigint;
  decimals: number;
  timestamp: string;
  method: string | null;
  symbol: string | null;
  tokenName: string | null;
  tokenPriceUsd: number | null;
}

export interface PairTransactionTokenTransfer {
  from: string;
  to: string;
  token: string;
  rawValue: bigint;
  decimals: number;
  symbol: string | null;
  tokenName: string | null;
  tokenPriceUsd: number | null;
}

export interface PairTransactionDetail {
  hash: string;
  blockNumber: number;
  from: string;
  to: string | null;
  rawNativeValue: bigint;
  method: string | null;
  status: "success" | "failed" | "unknown";
  timestamp: string;
  tokenTransfers: PairTransactionTokenTransfer[];
  fetchedAt: string;
}

export type PairFlowEventType = "buyback" | "burn";
export type PairFlowEventCategory =
  | "market_buy"
  | "direct_fee_burn"
  | "market_buy_burn"
  | "mixed_burn"
  | "unattributed_burn";
export type PairFlowActorRole = "creator" | "protocol_treasury" | "executor_inferred";

export interface PairFlowEventAsset {
  token: string | null;
  symbol: string;
  amount: number;
  usdValue: number | null;
  valuation: "settlement_observed" | "indexed_price_estimate" | "unknown";
}

export interface PairFlowEventAllocation {
  category: "direct_fee" | "market_acquired" | "unattributed";
  pairAmount: number;
  sourceTxHash: string | null;
}

export interface PairFlowEvent {
  id: string;
  type: PairFlowEventType;
  category: PairFlowEventCategory;
  timestamp: string;
  blockNumber: number;
  txHash: string;
  actorAddress: string;
  actorRole: PairFlowActorRole;
  actorAttribution: "official" | "behavior_inferred";
  pairAmount: number;
  usdValue: number | null;
  usdValuation: "settlement_observed" | "indexed_price_estimate" | "unknown";
  inputAssets: PairFlowEventAsset[];
  allocations: PairFlowEventAllocation[];
  linkedTxHashes: string[];
  transactionStatus: "success" | "failed" | "unknown";
  evidence: "explorer_indexed" | "behavior_inferred";
  explorerUrl: string;
  note: string;
}

export interface PairFlowEventsQuery {
  type: "all" | PairFlowEventType;
  window: "today" | "7d" | "all";
  limit: number;
  offset: number;
}

export interface PairFlowEventsResponse {
  service: "rhc-pair-flow-events";
  generatedAt: string;
  observedAt: string | null;
  historyStartAt: string;
  complete: boolean;
  query: PairFlowEventsQuery;
  counts: {
    matched: number;
    buyback: number;
    burn: number;
  };
  items: PairFlowEvent[];
}

export interface PairTransferHistoryObservation {
  observedAt: string;
  transfers: PairAddressTransfer[];
  walletCount: number;
  complete: boolean;
  truncatedWallets: string[];
}

export interface PairTreasuryClaimableObservation {
  observedAt: string;
  quoteAssetCount: number;
  quoteUsdCoverageCount: number;
  quoteClaimableUsd: number;
  spyClaimable: number;
  spyClaimableUsd: number | null;
}

export interface PairChainObservation {
  observedAt: string;
  blockNumber: string | null;
  collectSimulationSucceeded: boolean;
  pairTotalSupply: number | null;
  pairDeadBalance: number | null;
  walletPairBalances: Record<string, number | null>;
  walletSpyBalances: Record<string, number | null>;
  claimableBefore: {
    creatorPair: number | null;
    treasuryPair: number | null;
    creatorSpy: number | null;
    treasurySpy: number | null;
  };
  claimableAfter: {
    creatorPair: number | null;
    treasuryPair: number | null;
    creatorSpy: number | null;
    treasurySpy: number | null;
  };
  spyPriceUsd: number | null;
  spyPriceUpdatedAt: string | null;
}

export interface PairFlowCollectionBatch {
  observedAt: string;
  mainToken: PairMainTokenObservation | null;
  ohlcv: PairOhlcvObservation | null;
  chain: PairChainObservation | null;
  history: PairTransferHistoryObservation | null;
  treasuryClaimable: PairTreasuryClaimableObservation | null;
  platform: PairPlatformLiveAggregate | null;
  sources: PairFlowSourceHealth[];
  warnings: string[];
}

export interface PairFlowResponse {
  service: "rhc-pair-flow";
  generatedAt: string;
  observedAt: string;
  status: "success" | "partial";
  stale: boolean;
  window: {
    timezone: "Asia/Shanghai";
    calendarDate: string;
    calendarStartAt: string;
    rollingStartAt: string;
  };
  volume: {
    mainPoolTodayUsd: PairFlowValue;
    mainPoolRolling24hUsd: PairFlowValue;
    platformRolling24hUsd: PairFlowValue;
    platformTokenCount: PairFlowValue;
    theoreticalGrossFees24hUsd: PairFlowValue;
    theoreticalProtocolFees24hUsd: PairFlowValue;
    theoreticalPolicyBuyback24hUsd: PairFlowValue;
  };
  burn: {
    totalSupplyPair: PairFlowValue;
    deadLockedPair: PairFlowValue;
    deadLockedPercent: PairFlowValue;
    todayBurnedPair: PairFlowValue;
    todayDirectFeeBurnedPair: PairFlowValue;
    todayMarketAcquiredBurnedPair: PairFlowValue;
    todayUnattributedBurnedPair: PairFlowValue;
    cumulativeDirectFeeBurnedPair: PairFlowValue;
    cumulativeMarketAcquiredPair: PairFlowValue;
    cumulativeMarketAcquiredBurnedPair: PairFlowValue;
    cumulativeUnattributedBurnedPair: PairFlowValue;
    walletPendingPair: PairFlowValue;
    walletMarketAcquiredPendingPair: PairFlowValue;
    lockerPendingDirectPair: PairFlowValue;
  };
  buyback: {
    protocolQuoteAssetsUsd: PairFlowValue;
    protocolQuoteAssetCount: PairFlowValue;
    protocolClaimableSpy: PairFlowValue;
    mainPoolUnsweptSpy: PairFlowValue;
    policyExpectedSpy: PairFlowValue;
    policyExpectedUsd: PairFlowValue;
    protocolWalletSpy: PairFlowValue;
    creatorClaimableSpy: PairFlowValue;
    creatorWalletSpy: PairFlowValue;
    observedFeeSpyReceived: PairFlowValue;
    observedSpySwapSpend: PairFlowValue;
    confirmedFeeFundedSpendUsd: PairFlowValue;
  };
  pressure: {
    poolLiquidityUsd: PairFlowValue;
    policyPendingToLiquidityPercent: PairFlowValue;
    state: "unknown" | "low" | "moderate" | "high";
  };
  attribution: {
    historyStartAt: string;
    complete: boolean;
    fundingLink: "closed" | "partial" | "unknown";
    trackedWallets: Array<{
      role: "creator" | "protocol_treasury" | "executor_inferred";
      address: string;
      attribution: "official" | "behavior_inferred";
    }>;
  };
  sources: PairFlowSourceHealth[];
  warnings: string[];
}
