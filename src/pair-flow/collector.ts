import { fetchJson, finiteNumber, isRecord, type FetchedJson } from "../utils/http.js";
import {
  decodeAggregate3,
  decodeOraclePrice,
  decodeUint,
  encodeAggregate3,
  encodeBalanceOf,
  encodeClaimable,
  encodeCollectFees,
  encodePriceOf,
  encodeTotalSupply,
  type Multicall3Call,
} from "./abi.js";
import type { PairFlowSettings } from "./config.js";
import type {
  PairAddressTransfer,
  PairChainObservation,
  PairFlowCollectionBatch,
  PairFlowSourceHealth,
  PairMainTokenObservation,
  PairOhlcvObservation,
  PairTransactionDetail,
  PairTransactionTokenTransfer,
  PairTreasuryClaimableObservation,
  PairTransferHistoryObservation,
} from "./types.js";
import type { PairPlatformLiveAggregate } from "../pair/types.js";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export interface PairFlowSourceResult<T> {
  value: T;
  fetchedAt: string;
  latencyMs: number;
}

export interface PairFlowCollectorDependencies {
  fetchPairToken?: () => Promise<PairFlowSourceResult<PairMainTokenObservation>>;
  fetchOhlcv?: () => Promise<PairFlowSourceResult<PairOhlcvObservation>>;
  fetchChain?: () => Promise<PairFlowSourceResult<PairChainObservation>>;
  fetchHistory?: () => Promise<PairFlowSourceResult<PairTransferHistoryObservation>>;
  fetchTreasuryClaimable?: () => Promise<PairFlowSourceResult<PairTreasuryClaimableObservation>>;
  platformVolume?: () => PairPlatformLiveAggregate | null;
  fetchPage?: (url: string) => Promise<FetchedJson>;
  fetchTransactionDetail?: (hash: string) => Promise<PairTransactionDetail>;
  fetcher?: typeof fetch;
  now?: () => Date;
}

function nonNegative(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function lowerAddress(value: unknown): string | null {
  return typeof value === "string" && ADDRESS_PATTERN.test(value) ? value.toLowerCase() : null;
}

function timestamp(value: unknown): string | null {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1_000 : value;
    return new Date(milliseconds).toISOString();
  }
  return null;
}

export function parsePairMainToken(
  payload: unknown,
  fetchedAt: string,
  settings: PairFlowSettings,
): PairMainTokenObservation {
  if (!isRecord(payload)) throw new Error("PAIR token payload is not an object");
  if (lowerAddress(payload.address) !== settings.pairTokenAddress) {
    throw new Error("PAIR token payload returned an unexpected address");
  }
  if (!Array.isArray(payload.pairs)) throw new Error("PAIR token payload has no pair list");
  const pair = payload.pairs.find(
    (candidate) => isRecord(candidate) && candidate.poolId === settings.poolId,
  );
  if (!isRecord(pair)) throw new Error("PAIR/SPY pool is missing from the official token payload");
  const positionTokenId = String(pair.positionTokenId ?? pair.positionId ?? "");
  if (positionTokenId !== settings.positionTokenId) {
    throw new Error("PAIR/SPY position token id changed unexpectedly");
  }
  return {
    observedAt: timestamp(payload.marketDataUpdatedAt) ?? fetchedAt,
    priceUsd: nonNegative(payload.priceUsd) ?? nonNegative(payload.compositePriceUsd),
    volume24hUsd: nonNegative(payload.combinedVolume24hUsd) ?? nonNegative(payload.volume24hUsd),
    liquidityUsd: nonNegative(pair.totalDepthUsd) ?? nonNegative(pair.liquidityUsd),
    poolFeeBps: nonNegative(pair.poolFee),
    poolId: settings.poolId,
    positionTokenId,
  };
}

export function parsePairOhlcv(payload: unknown, fetchedAt: string): PairOhlcvObservation {
  if (!isRecord(payload) || !isRecord(payload.data) || !isRecord(payload.data.attributes)) {
    throw new Error("GeckoTerminal OHLCV payload is not an object");
  }
  const list = payload.data.attributes.ohlcv_list;
  if (!Array.isArray(list)) throw new Error("GeckoTerminal OHLCV list is missing");
  const candles = list.flatMap((candidate) => {
    if (!Array.isArray(candidate)) return [];
    const candleTimestamp = finiteNumber(candidate[0]);
    const volumeUsd = nonNegative(candidate[5]);
    if (candleTimestamp === null || volumeUsd === null) return [];
    return [{ timestamp: candleTimestamp, volumeUsd }];
  });
  if (candles.length === 0) throw new Error("GeckoTerminal OHLCV contained no usable candles");
  return { observedAt: fetchedAt, candles };
}

function rawTokenAmount(rawValue: unknown, decimalsValue: unknown): number | null {
  const decimals = finiteNumber(decimalsValue);
  if (
    typeof rawValue !== "string" ||
    !/^\d+$/.test(rawValue) ||
    decimals === null ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 36
  ) {
    return null;
  }
  const raw = BigInt(rawValue);
  const divisor = 10n ** BigInt(decimals);
  const value = Number(raw / divisor) + Number(raw % divisor) / Number(divisor);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function parseTreasuryClaimable(
  payload: unknown,
  fetchedAt: string,
  settings: PairFlowSettings,
): PairTreasuryClaimableObservation {
  if (!Array.isArray(payload)) throw new Error("PAIR treasury claimable payload is not an array");
  let quoteAssetCount = 0;
  let quoteUsdCoverageCount = 0;
  let quoteClaimableUsd = 0;
  let spyClaimable = 0;
  let spyClaimableUsd = 0;
  let spyUsdComplete = true;

  for (const candidate of payload) {
    if (!isRecord(candidate) || candidate.assetType !== "QUOTE") continue;
    if (!isRecord(candidate.quoteToken)) {
      throw new Error("PAIR treasury quote entry is missing token metadata");
    }
    const asset = lowerAddress(candidate.claimAssetAddress);
    const amount = rawTokenAmount(candidate.claimableAmount, candidate.quoteToken.decimals);
    if (!asset || amount === null) throw new Error("PAIR treasury quote entry is invalid");
    const usd = nonNegative(candidate.claimableAmountUsd);
    quoteAssetCount += 1;
    if (usd !== null) {
      quoteUsdCoverageCount += 1;
      quoteClaimableUsd += usd;
    }
    if (asset === settings.spyTokenAddress.toLowerCase()) {
      spyClaimable += amount;
      if (usd === null) spyUsdComplete = false;
      else spyClaimableUsd += usd;
    }
  }

  return {
    observedAt: fetchedAt,
    quoteAssetCount,
    quoteUsdCoverageCount,
    quoteClaimableUsd,
    spyClaimable,
    spyClaimableUsd: spyUsdComplete ? spyClaimableUsd : null,
  };
}

export function parseAddressTransfer(value: unknown): PairAddressTransfer | null {
  if (!isRecord(value)) return null;
  const from = lowerAddress(value.from);
  const to = lowerAddress(value.to);
  const token = lowerAddress(value.token);
  const blockNumber = finiteNumber(value.block);
  const decimals = finiteNumber(value.decimals);
  const observedAt = timestamp(value.timestamp);
  if (
    !from ||
    !to ||
    !token ||
    blockNumber === null ||
    !Number.isInteger(blockNumber) ||
    decimals === null ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 36 ||
    !observedAt ||
    typeof value.hash !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/.test(value.hash) ||
    typeof value.value !== "string" ||
    !/^\d+$/.test(value.value)
  ) {
    return null;
  }
  const logIndex = finiteNumber(value.logIndex);
  return {
    hash: value.hash.toLowerCase(),
    blockNumber,
    logIndex: logIndex !== null && Number.isInteger(logIndex) ? logIndex : null,
    from,
    to,
    token,
    rawValue: BigInt(value.value),
    decimals,
    timestamp: observedAt,
    method: typeof value.method === "string" ? value.method.slice(0, 64) : null,
    symbol: typeof value.symbol === "string" ? value.symbol.slice(0, 32) : null,
    tokenName: typeof value.tokenName === "string" ? value.tokenName.slice(0, 128) : null,
    tokenPriceUsd: nonNegative(value.tokenPriceUsd),
  };
}

function parseTransactionTokenTransfer(value: unknown): PairTransactionTokenTransfer | null {
  if (!isRecord(value)) return null;
  const from = lowerAddress(value.from);
  const to = lowerAddress(value.to);
  const token = lowerAddress(value.token);
  const decimals = finiteNumber(value.decimals);
  if (
    !from ||
    !to ||
    !token ||
    decimals === null ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 36 ||
    typeof value.value !== "string" ||
    !/^\d+$/.test(value.value)
  ) {
    return null;
  }
  return {
    from,
    to,
    token,
    rawValue: BigInt(value.value),
    decimals,
    symbol: typeof value.symbol === "string" ? value.symbol.slice(0, 32) : null,
    tokenName: typeof value.tokenName === "string" ? value.tokenName.slice(0, 128) : null,
    tokenPriceUsd: nonNegative(value.tokenPriceUsd),
  };
}

export function parseTransactionDetail(payload: unknown, fetchedAt: string): PairTransactionDetail {
  if (!isRecord(payload)) throw new Error("RH-scan transaction payload is invalid");
  const hash = typeof payload.hash === "string" ? payload.hash.toLowerCase() : "";
  const from = lowerAddress(payload.from);
  const to = payload.to === null ? null : lowerAddress(payload.to);
  const blockNumber = finiteNumber(payload.block);
  const observedAt = timestamp(payload.timestamp);
  if (
    !/^0x[0-9a-f]{64}$/.test(hash) ||
    !from ||
    (payload.to !== null && !to) ||
    blockNumber === null ||
    !Number.isInteger(blockNumber) ||
    !observedAt ||
    typeof payload.value !== "string" ||
    !/^\d+$/.test(payload.value)
  ) {
    throw new Error("RH-scan transaction identity is invalid");
  }
  const statusValue = finiteNumber(payload.status);
  const status = statusValue === 1 ? "success" : statusValue === 0 ? "failed" : "unknown";
  const tokenTransfers = Array.isArray(payload.tokenTransfers)
    ? payload.tokenTransfers.flatMap((candidate) => {
        const parsed = parseTransactionTokenTransfer(candidate);
        return parsed ? [parsed] : [];
      })
    : [];
  return {
    hash,
    blockNumber,
    from,
    to,
    rawNativeValue: BigInt(payload.value),
    method: typeof payload.method === "string" ? payload.method.slice(0, 64) : null,
    status,
    timestamp: observedAt,
    tokenTransfers,
    fetchedAt,
  };
}

function nextCursor(payload: Record<string, unknown>): string | null {
  if (typeof payload.next === "string" && payload.next) return payload.next;
  if (isRecord(payload.cursor) && typeof payload.cursor.next === "string") {
    return payload.cursor.next || null;
  }
  return null;
}

async function fetchWalletHistory(
  wallet: string,
  settings: PairFlowSettings,
  fetchPage: (url: string) => Promise<FetchedJson>,
): Promise<{ transfers: PairAddressTransfer[]; complete: boolean; fetchedAt: string }> {
  const start = Date.parse(settings.historyStartAt);
  let cursor: string | null = null;
  let fetchedAt = new Date(0).toISOString();
  const transfers: PairAddressTransfer[] = [];
  const seenCursors = new Set<string>();
  for (let page = 0; page < settings.explorerMaxPages; page += 1) {
    const query = new URLSearchParams({ limit: String(settings.explorerPageLimit) });
    if (cursor) query.set("before", cursor);
    const fetched = await fetchPage(
      `${settings.explorerApiBaseUrl}/address/${wallet}/transfers?${query.toString()}`,
    );
    fetchedAt = fetched.fetchedAt > fetchedAt ? fetched.fetchedAt : fetchedAt;
    if (!isRecord(fetched.payload) || !Array.isArray(fetched.payload.rows)) {
      throw new Error("RH-scan address-transfer payload is invalid");
    }
    const rows = fetched.payload.rows.flatMap((row) => {
      const parsed = parseAddressTransfer(row);
      return parsed ? [parsed] : [];
    });
    transfers.push(...rows.filter((row) => Date.parse(row.timestamp) >= start));
    const oldest = rows.reduce(
      (value, row) => Math.min(value, Date.parse(row.timestamp)),
      Number.POSITIVE_INFINITY,
    );
    const next = nextCursor(fetched.payload);
    if (!next || oldest <= start || fetched.payload.rows.length === 0) {
      return { transfers, complete: true, fetchedAt };
    }
    if (seenCursors.has(next)) throw new Error("RH-scan pagination cursor repeated");
    seenCursors.add(next);
    cursor = next;
  }
  return { transfers, complete: false, fetchedAt };
}

async function fetchTransferHistory(
  settings: PairFlowSettings,
  fetchPage: (url: string) => Promise<FetchedJson>,
): Promise<PairFlowSourceResult<PairTransferHistoryObservation>> {
  const started = performance.now();
  const wallets = [settings.creatorAddress, settings.treasuryAddress, settings.executorAddress];
  const results = await Promise.all(
    wallets.map(async (wallet) => ({
      wallet,
      ...(await fetchWalletHistory(wallet, settings, fetchPage)),
    })),
  );
  const fetchedAt = results.reduce(
    (latest, result) => (result.fetchedAt > latest ? result.fetchedAt : latest),
    new Date(0).toISOString(),
  );
  return {
    value: {
      observedAt: fetchedAt,
      transfers: results.flatMap((result) => result.transfers),
      walletCount: wallets.length,
      complete: results.every((result) => result.complete),
      truncatedWallets: results.filter((result) => !result.complete).map((result) => result.wallet),
    },
    fetchedAt,
    latencyMs: Math.round(performance.now() - started),
  };
}

function calls(settings: PairFlowSettings): Multicall3Call[] {
  const call = (target: string, callData: string): Multicall3Call => ({
    target,
    allowFailure: true,
    callData,
  });
  return [
    call(
      settings.lockerAddress,
      encodeClaimable(settings.creatorAddress, settings.pairTokenAddress),
    ),
    call(
      settings.lockerAddress,
      encodeClaimable(settings.treasuryAddress, settings.pairTokenAddress),
    ),
    call(
      settings.lockerAddress,
      encodeClaimable(settings.creatorAddress, settings.spyTokenAddress),
    ),
    call(
      settings.lockerAddress,
      encodeClaimable(settings.treasuryAddress, settings.spyTokenAddress),
    ),
    call(settings.lockerAddress, encodeCollectFees(settings.positionTokenId)),
    call(
      settings.lockerAddress,
      encodeClaimable(settings.creatorAddress, settings.pairTokenAddress),
    ),
    call(
      settings.lockerAddress,
      encodeClaimable(settings.treasuryAddress, settings.pairTokenAddress),
    ),
    call(
      settings.lockerAddress,
      encodeClaimable(settings.creatorAddress, settings.spyTokenAddress),
    ),
    call(
      settings.lockerAddress,
      encodeClaimable(settings.treasuryAddress, settings.spyTokenAddress),
    ),
    call(settings.pairTokenAddress, encodeTotalSupply()),
    call(settings.pairTokenAddress, encodeBalanceOf(settings.deadAddress)),
    call(settings.pairTokenAddress, encodeBalanceOf(settings.creatorAddress)),
    call(settings.pairTokenAddress, encodeBalanceOf(settings.treasuryAddress)),
    call(settings.pairTokenAddress, encodeBalanceOf(settings.executorAddress)),
    call(settings.spyTokenAddress, encodeBalanceOf(settings.creatorAddress)),
    call(settings.spyTokenAddress, encodeBalanceOf(settings.treasuryAddress)),
    call(settings.spyTokenAddress, encodeBalanceOf(settings.executorAddress)),
    call(settings.priceOracleAddress, encodePriceOf(settings.spyTokenAddress)),
  ];
}

function rpcPayload(value: unknown): { callResult: string; blockNumber: string | null } {
  if (!Array.isArray(value)) throw new Error("RPC batch response is not an array");
  let callResult: string | null = null;
  let blockNumber: string | null = null;
  for (const candidate of value) {
    if (!isRecord(candidate)) continue;
    if (candidate.id === 1 && typeof candidate.result === "string") callResult = candidate.result;
    if (candidate.id === 2 && typeof candidate.result === "string") blockNumber = candidate.result;
  }
  if (!callResult) throw new Error("RPC multicall result is missing");
  return { callResult, blockNumber };
}

async function fetchChainObservation(
  settings: PairFlowSettings,
  fetcher: typeof fetch,
): Promise<PairFlowSourceResult<PairChainObservation>> {
  const started = performance.now();
  const body = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [
        { to: settings.multicallAddress, data: encodeAggregate3(calls(settings)) },
        "latest",
      ],
    },
    { jsonrpc: "2.0", id: 2, method: "eth_blockNumber", params: [] },
  ];
  const response = await fetcher(settings.rpcUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "rhc-pair-flow/1.0 (+read-only research dashboard)",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(settings.requestTimeoutMs),
  });
  if (!response.ok) throw new Error(`RPC HTTP ${String(response.status)}`);
  const fetchedAt = new Date().toISOString();
  const payload = rpcPayload(await response.json());
  const results = decodeAggregate3(payload.callResult);
  if (results.length !== 18) throw new Error("RPC multicall returned an unexpected result count");
  const uint = (index: number, decimals = 18) => {
    const result = results[index];
    return result?.success ? decodeUint(result.returnData, decimals) : null;
  };
  const oracleResult = results[17];
  const oracle = oracleResult?.success ? decodeOraclePrice(oracleResult.returnData) : null;
  const walletPairBalances = Object.fromEntries(
    [settings.creatorAddress, settings.treasuryAddress, settings.executorAddress].map(
      (address, index) => [address, uint(11 + index)],
    ),
  );
  const walletSpyBalances = Object.fromEntries(
    [settings.creatorAddress, settings.treasuryAddress, settings.executorAddress].map(
      (address, index) => [address, uint(14 + index)],
    ),
  );
  return {
    value: {
      observedAt: fetchedAt,
      blockNumber: payload.blockNumber,
      collectSimulationSucceeded: results[4]?.success === true,
      pairTotalSupply: uint(9),
      pairDeadBalance: uint(10),
      walletPairBalances,
      walletSpyBalances,
      claimableBefore: {
        creatorPair: uint(0),
        treasuryPair: uint(1),
        creatorSpy: uint(2),
        treasurySpy: uint(3),
      },
      claimableAfter: {
        creatorPair: uint(5),
        treasuryPair: uint(6),
        creatorSpy: uint(7),
        treasurySpy: uint(8),
      },
      spyPriceUsd: oracle?.priceUsd ?? null,
      spyPriceUpdatedAt: oracle?.updatedAt ?? null,
    },
    fetchedAt,
    latencyMs: Math.round(performance.now() - started),
  };
}

function sourceHealth<T>(
  source: string,
  label: string,
  url: string | null,
  result: PromiseSettledResult<PairFlowSourceResult<T>>,
  failedAt: string,
  degraded?: (value: T) => string | null,
): PairFlowSourceHealth {
  if (result.status === "rejected") {
    return {
      source,
      label,
      status: "failed",
      fetchedAt: failedAt,
      message: "当前来源不可用。",
      url,
    };
  }
  const degradedMessage = degraded?.(result.value.value) ?? null;
  return {
    source,
    label,
    status: degradedMessage ? "degraded" : "ok",
    fetchedAt: result.value.fetchedAt,
    message: degradedMessage ?? "数据可用。",
    url,
  };
}

export class PairFlowCollector {
  private readonly fetchPairToken: () => Promise<PairFlowSourceResult<PairMainTokenObservation>>;
  private readonly fetchOhlcv: () => Promise<PairFlowSourceResult<PairOhlcvObservation>>;
  private readonly fetchChain: () => Promise<PairFlowSourceResult<PairChainObservation>>;
  private readonly fetchHistory: () => Promise<
    PairFlowSourceResult<PairTransferHistoryObservation>
  >;
  private readonly fetchTreasuryClaimable: () => Promise<
    PairFlowSourceResult<PairTreasuryClaimableObservation>
  >;
  private readonly platformVolume: () => PairFlowCollectionBatch["platform"];
  private readonly fetchTransactionDetail: (hash: string) => Promise<PairTransactionDetail>;
  private readonly now: () => Date;

  constructor(
    private readonly settings: PairFlowSettings,
    dependencies: PairFlowCollectorDependencies = {},
  ) {
    const fetchPage = dependencies.fetchPage ?? ((url: string) => fetchJson(url, { retries: 1 }));
    const fetcher = dependencies.fetcher ?? fetch;
    this.fetchPairToken =
      dependencies.fetchPairToken ??
      (async () => {
        const fetched = await fetchJson(this.settings.pairTokenApiUrl, { retries: 1 });
        return {
          value: parsePairMainToken(fetched.payload, fetched.fetchedAt, this.settings),
          fetchedAt: fetched.fetchedAt,
          latencyMs: fetched.latencyMs,
        };
      });
    this.fetchOhlcv =
      dependencies.fetchOhlcv ??
      (async () => {
        const fetched = await fetchJson(this.settings.geckoOhlcvUrl, { retries: 1 });
        return {
          value: parsePairOhlcv(fetched.payload, fetched.fetchedAt),
          fetchedAt: fetched.fetchedAt,
          latencyMs: fetched.latencyMs,
        };
      });
    this.fetchChain =
      dependencies.fetchChain ?? (() => fetchChainObservation(this.settings, fetcher));
    this.fetchHistory =
      dependencies.fetchHistory ?? (() => fetchTransferHistory(this.settings, fetchPage));
    this.fetchTreasuryClaimable =
      dependencies.fetchTreasuryClaimable ??
      (async () => {
        const fetched = await fetchJson(this.settings.treasuryClaimableApiUrl, { retries: 1 });
        return {
          value: parseTreasuryClaimable(fetched.payload, fetched.fetchedAt, this.settings),
          fetchedAt: fetched.fetchedAt,
          latencyMs: fetched.latencyMs,
        };
      });
    this.platformVolume = dependencies.platformVolume ?? (() => null);
    this.fetchTransactionDetail =
      dependencies.fetchTransactionDetail ??
      (async (hash) => {
        const fetched = await fetchJson(`${this.settings.explorerApiBaseUrl}/tx/${hash}`, {
          retries: 1,
        });
        return parseTransactionDetail(fetched.payload, fetched.fetchedAt);
      });
    this.now = dependencies.now ?? (() => new Date());
  }

  async fetchTransactionDetails(hashes: string[]): Promise<Map<string, PairTransactionDetail>> {
    const unique = [...new Set(hashes.map((hash) => hash.toLowerCase()))].filter((hash) =>
      /^0x[0-9a-f]{64}$/.test(hash),
    );
    const details = new Map<string, PairTransactionDetail>();
    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(this.settings.transactionDetailConcurrency, unique.length) },
      async () => {
        while (cursor < unique.length) {
          const index = cursor;
          cursor += 1;
          const hash = unique[index];
          if (!hash) continue;
          try {
            const detail = await this.fetchTransactionDetail(hash);
            details.set(hash, detail);
          } catch {
            // An individual explorer detail failure must not hide the transfer-index evidence.
          }
        }
      },
    );
    await Promise.all(workers);
    return details;
  }

  async collect(): Promise<PairFlowCollectionBatch> {
    const observedAt = this.now().toISOString();
    const platform = this.platformVolume();
    const [pairTokenResult, ohlcvResult, chainResult, historyResult, treasuryResult] =
      await Promise.allSettled([
        this.fetchPairToken(),
        this.fetchOhlcv(),
        this.fetchChain(),
        this.fetchHistory(),
        this.fetchTreasuryClaimable(),
      ]);
    const sources: PairFlowSourceHealth[] = [
      sourceHealth(
        "pair.officialTokenApi",
        "PAIR 官方代币 API",
        this.settings.pairTokenApiUrl,
        pairTokenResult,
        observedAt,
      ),
      sourceHealth(
        "geckoterminal.pairSpyOhlcv",
        "PAIR/SPY 主池 OHLCV",
        this.settings.geckoOhlcvUrl,
        ohlcvResult,
        observedAt,
      ),
      sourceHealth(
        "robinhood.rpc.pairFlow",
        "Robinhood Chain 链上余额",
        this.settings.rpcUrl,
        chainResult,
        observedAt,
        (chain) =>
          chain.collectSimulationSucceeded && chain.pairDeadBalance !== null
            ? null
            : "部分链上读取或手续费收集模拟不可用。",
      ),
      sourceHealth(
        "rh-scan.addressTransfers",
        "RH-scan 地址转账索引",
        this.settings.explorerApiBaseUrl,
        historyResult,
        observedAt,
        (history) => (history.complete ? null : "历史分页达到安全上限，归因不完整。"),
      ),
      sourceHealth(
        "pair.officialTreasuryClaimableApi",
        "PAIR 协议金库可领取费用",
        this.settings.treasuryClaimableApiUrl,
        treasuryResult,
        observedAt,
        (claimable) =>
          claimable.quoteUsdCoverageCount === claimable.quoteAssetCount
            ? null
            : `${String(claimable.quoteUsdCoverageCount)}/${String(claimable.quoteAssetCount)} 种报价资产有美元估值；总额仅为已估值下限。`,
      ),
      {
        source: "pair.tokenRadar.universeAggregate",
        label: "PAIR 全平台代币聚合",
        status: platform ? (platform.complete ? "ok" : "degraded") : "failed",
        fetchedAt: platform?.observedAt ?? observedAt,
        message: platform
          ? `${String(platform.volumeObservedCount)}/${String(platform.tokenCount)} 枚可见代币有 24H 成交量。`
          : "当前没有全平台聚合快照。",
        url: "https://pair.fund/api/tokens",
      },
    ];
    if (sources.every((source) => source.status === "failed")) {
      throw new Error("PAIR flow collector returned no usable source");
    }
    return {
      observedAt,
      mainToken: pairTokenResult.status === "fulfilled" ? pairTokenResult.value.value : null,
      ohlcv: ohlcvResult.status === "fulfilled" ? ohlcvResult.value.value : null,
      chain: chainResult.status === "fulfilled" ? chainResult.value.value : null,
      history: historyResult.status === "fulfilled" ? historyResult.value.value : null,
      treasuryClaimable: treasuryResult.status === "fulfilled" ? treasuryResult.value.value : null,
      platform,
      sources,
      warnings: sources
        .filter((source) => source.status !== "ok")
        .map((source) => `${source.source}_${source.status}`),
    };
  }
}
