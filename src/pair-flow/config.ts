export interface PairFlowSettings {
  pairTokenApiUrl: string;
  treasuryClaimableApiUrl: string;
  geckoOhlcvUrl: string;
  rpcUrl: string;
  explorerApiBaseUrl: string;
  pairTokenAddress: string;
  spyTokenAddress: string;
  deadAddress: string;
  lockerAddress: string;
  poolManagerAddress: string;
  swapAdapterAddresses: string[];
  multicallAddress: string;
  priceOracleAddress: string;
  poolId: string;
  positionTokenId: string;
  creatorAddress: string;
  treasuryAddress: string;
  executorAddress: string;
  historyStartAt: string;
  explorerPageLimit: number;
  explorerMaxPages: number;
  transactionDetailConcurrency: number;
  requestTimeoutMs: number;
  refreshTtlMinutes: number;
  staleAfterMinutes: number;
  tradingFeePercent: number;
  protocolFeePercent: number;
  policyBuybackPercent: number;
}

export const DEFAULT_PAIR_FLOW_SETTINGS: PairFlowSettings = {
  pairTokenApiUrl: "https://pair.fund/api/tokens/0x6b1d42927b1a84ec28fa88d4fc6fa7af404966be",
  treasuryClaimableApiUrl:
    "https://pair.fund/api/fees/claimable/0xbc27542ae2ed2e4d1d380b5fe8b2d48404fd824c",
  geckoOhlcvUrl:
    "https://api.geckoterminal.com/api/v2/networks/robinhood/pools/0xf224a070c8626c890a085b258cf562ee4bf052b6d1d59104b3b44d722640c001/ohlcv/hour?aggregate=1&limit=48",
  rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
  explorerApiBaseUrl: "https://rh-scan.com/api",
  pairTokenAddress: "0x6b1d42927b1a84ec28fa88d4fc6fa7af404966be",
  spyTokenAddress: "0x117cc2133c37b721f49de2a7a74833232b3b4c0c",
  deadAddress: "0x000000000000000000000000000000000000dead",
  lockerAddress: "0xefcf476e8870fb3eb8680f039414fdcce6c2a117",
  poolManagerAddress: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
  swapAdapterAddresses: [
    "0xa57472d29caf87011241249e830c924bf39bf333",
    "0xbdbae060cbab0e9cfe802a7513dd5ecb36cda6c3",
  ],
  multicallAddress: "0xca11bde05977b3631167028862be2a173976ca11",
  priceOracleAddress: "0xf15f6ff9a1f0ed55b8223a4f0bd6f9c8c0ab877b",
  poolId: "0xf224a070c8626c890a085b258cf562ee4bf052b6d1d59104b3b44d722640c001",
  positionTokenId: "1152094",
  creatorAddress: "0xa15e4ad0dbc8df1715a7b254526252cd93bb1102",
  treasuryAddress: "0xbc27542ae2ed2e4d1d380b5fe8b2d48404fd824c",
  executorAddress: "0x18fe9694a335c8b42d228147eddac524748300ea",
  historyStartAt: "2026-08-29T00:00:00.000Z",
  explorerPageLimit: 100,
  explorerMaxPages: 50,
  transactionDetailConcurrency: 6,
  requestTimeoutMs: 20_000,
  refreshTtlMinutes: 5,
  staleAfterMinutes: 20,
  tradingFeePercent: 1,
  protocolFeePercent: 30,
  policyBuybackPercent: 90,
};

function positiveNumber(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be positive`);
  return parsed;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = positiveNumber(value, fallback, name);
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer`);
  return parsed;
}

function percent(value: string | undefined, fallback: number, name: string): number {
  const parsed = positiveNumber(value, fallback, name);
  if (parsed > 100) throw new Error(`${name} must be <= 100`);
  return parsed;
}

export function pairFlowSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): PairFlowSettings {
  return {
    ...DEFAULT_PAIR_FLOW_SETTINGS,
    rpcUrl:
      env.PAIR_FLOW_RPC_URL?.trim() ||
      env.ECONOMICS_RPC_URL?.trim() ||
      DEFAULT_PAIR_FLOW_SETTINGS.rpcUrl,
    requestTimeoutMs: positiveInteger(
      env.PAIR_FLOW_REQUEST_TIMEOUT_MS,
      DEFAULT_PAIR_FLOW_SETTINGS.requestTimeoutMs,
      "PAIR_FLOW_REQUEST_TIMEOUT_MS",
    ),
    explorerMaxPages: positiveInteger(
      env.PAIR_FLOW_EXPLORER_MAX_PAGES,
      DEFAULT_PAIR_FLOW_SETTINGS.explorerMaxPages,
      "PAIR_FLOW_EXPLORER_MAX_PAGES",
    ),
    transactionDetailConcurrency: positiveInteger(
      env.PAIR_FLOW_TRANSACTION_DETAIL_CONCURRENCY,
      DEFAULT_PAIR_FLOW_SETTINGS.transactionDetailConcurrency,
      "PAIR_FLOW_TRANSACTION_DETAIL_CONCURRENCY",
    ),
    refreshTtlMinutes: positiveNumber(
      env.PAIR_FLOW_REFRESH_TTL_MINUTES,
      DEFAULT_PAIR_FLOW_SETTINGS.refreshTtlMinutes,
      "PAIR_FLOW_REFRESH_TTL_MINUTES",
    ),
    staleAfterMinutes: positiveNumber(
      env.PAIR_FLOW_STALE_AFTER_MINUTES,
      DEFAULT_PAIR_FLOW_SETTINGS.staleAfterMinutes,
      "PAIR_FLOW_STALE_AFTER_MINUTES",
    ),
    tradingFeePercent: percent(
      env.PAIR_FLOW_TRADING_FEE_PERCENT,
      DEFAULT_PAIR_FLOW_SETTINGS.tradingFeePercent,
      "PAIR_FLOW_TRADING_FEE_PERCENT",
    ),
    protocolFeePercent: percent(
      env.PAIR_FLOW_PROTOCOL_FEE_PERCENT,
      DEFAULT_PAIR_FLOW_SETTINGS.protocolFeePercent,
      "PAIR_FLOW_PROTOCOL_FEE_PERCENT",
    ),
    policyBuybackPercent: percent(
      env.PAIR_FLOW_POLICY_BUYBACK_PERCENT,
      DEFAULT_PAIR_FLOW_SETTINGS.policyBuybackPercent,
      "PAIR_FLOW_POLICY_BUYBACK_PERCENT",
    ),
  };
}
