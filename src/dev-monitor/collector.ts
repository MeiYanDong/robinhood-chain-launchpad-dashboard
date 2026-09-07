import {
  decimalAmount,
  decodeTopicAddress,
  JsonRpcClient,
  type PairV2Rpc,
  type PairV2RpcLog,
  parseRpcQuantity,
} from "../pair-v2/rpc.js";
import type { PairV2DashboardResponse } from "../pair-v2/types.js";
import { finiteNumber, isRecord } from "../utils/http.js";
import type { DevMonitorSettings } from "./config.js";
import type {
  DevMonitorActivity,
  DevMonitorAsset,
  DevMonitorPlatform,
  DevMonitorProfile,
  DevMonitorProject,
} from "./types.js";

const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;
const BYTES32_PATTERN = /^0x[0-9a-f]{64}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const PONS_V1_LAUNCH_TOPIC = "0xdb51ea9ad51ab453a65a4cb7e60c3cb378c9501bb002609f8f97778fb6c4235a";
const PONS_V2_LAUNCH_TOPIC = "0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607";
const LONG_LAUNCH_TOPIC = "0xadc6f1f726f7c710f77ec06adc75f3bb964e5be19581b072c67f7b9b4039267b";
const DECIMALS_SELECTOR = "0x313ce567";
const SYMBOL_SELECTOR = "0x95d89b41";
const CHAIN_ID = 4663;
const RPC_BATCH_SIZE = 50;
const RPC_BATCH_PAUSE_MS = 1_000;
const MARKET_BATCH_PAUSE_MS = 600;

export type DevLaunchSourceId = "pons_v1_active" | "pons_v1_legacy" | "pons_v2" | "long";

export interface DevLaunchSource {
  id: DevLaunchSourceId;
  platform: DevMonitorPlatform;
  address: string;
  topic: string;
  startBlock: number;
}

export const DEV_LAUNCH_SOURCES: DevLaunchSource[] = [
  {
    id: "pons_v1_active",
    platform: "pons_v1",
    address: "0xa5aab3f0c6eeadf30ef1d3eb997108e976351feb",
    topic: PONS_V1_LAUNCH_TOPIC,
    startBlock: 8_991_118,
  },
  {
    id: "pons_v1_legacy",
    platform: "pons_v1",
    address: "0x0c37a24f5d23a486fa692d1500881d698b1f77a4",
    topic: PONS_V1_LAUNCH_TOPIC,
    startBlock: 8_600_612,
  },
  {
    id: "pons_v2",
    platform: "pons_v2",
    address: "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e",
    topic: PONS_V2_LAUNCH_TOPIC,
    startBlock: 0,
  },
  {
    id: "long",
    platform: "long",
    address: "0x22e99278308b393ea1260859b181ad7e78f5eeed",
    topic: LONG_LAUNCH_TOPIC,
    startBlock: 8_636_038,
  },
];

interface RpcLog extends PairV2RpcLog {
  blockHash?: string;
}

interface RpcTransaction {
  hash: string;
  from: string;
  to: string | null;
  value: string;
  blockNumber: string | null;
  blockHash: string | null;
}

interface RpcReceipt {
  transactionHash: string;
  status: string;
  blockNumber: string;
  blockHash: string;
  logs: RpcLog[];
}

interface RpcBlock {
  timestamp: string;
}

interface AssetMetadata {
  symbol: string;
  decimals: number;
}

export interface DevMonitorCollectorDependencies {
  rpc?: PairV2Rpc;
  fetcher?: typeof fetch;
  now?: () => Date;
  wait?: (milliseconds: number) => Promise<void>;
}

export class PacedDevMonitorRpc implements PairV2Rpc {
  private chain: Promise<void> = Promise.resolve();
  private nextRequestAt = 0;

  constructor(
    private readonly inner: PairV2Rpc,
    private readonly minIntervalMs: number,
    private readonly wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    private readonly clock: () => number = Date.now,
  ) {}

  call<T>(method: string, params: unknown[]): Promise<T> {
    return this.schedule(() => this.inner.call<T>(method, params));
  }

  batch<T>(calls: Array<{ method: string; params: unknown[] }>): Promise<T[]> {
    return this.schedule(() =>
      this.inner.batch
        ? this.inner.batch<T>(calls)
        : Promise.all(calls.map((call) => this.inner.call<T>(call.method, call.params))),
    );
  }

  private schedule<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.chain.then(async () => {
      const delay = Math.max(0, this.nextRequestAt - this.clock());
      if (delay > 0) await this.wait(delay);
      try {
        return await operation();
      } finally {
        this.nextRequestAt = this.clock() + this.minIntervalMs;
      }
    });
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export interface DevMonitorMarketEnrichment {
  updates: DevMonitorProject[];
  requestedProjects: number;
  totalBatches: number;
  successfulBatches: number;
  failedBatches: number;
}

function lowerAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  return ADDRESS_PATTERN.test(normalized) ? normalized : null;
}

function lowerHash(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  return BYTES32_PATTERN.test(normalized) ? normalized : null;
}

function blockHash(log: RpcLog): string | null {
  return lowerHash(log.blockHash);
}

function topicAddress(address: string): string {
  return `0x${address.slice(2).padStart(64, "0")}`;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function rpcBatch<T>(
  rpc: PairV2Rpc,
  calls: Array<{ method: string; params: unknown[] }>,
): Promise<T[]> {
  const groups = chunks(calls, RPC_BATCH_SIZE);
  const result: T[] = [];
  for (const [index, group] of groups.entries()) {
    const values = rpc.batch
      ? await rpc.batch<T>(group)
      : await Promise.all(group.map((call) => rpc.call<T>(call.method, call.params)));
    result.push(...values);
    if (index < groups.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, RPC_BATCH_PAUSE_MS));
    }
  }
  return result;
}

async function fetchLogs(
  rpc: PairV2Rpc,
  filter: { address?: string; topics: unknown[] },
  fromBlock: number,
  toBlock: number,
  chunkSize: number,
): Promise<RpcLog[]> {
  if (fromBlock > toBlock) return [];
  const result: RpcLog[] = [];
  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const end = Math.min(toBlock, start + chunkSize - 1);
    const logs = await rpc.call<RpcLog[]>("eth_getLogs", [
      {
        ...filter,
        fromBlock: `0x${start.toString(16)}`,
        toBlock: `0x${end.toString(16)}`,
      },
    ]);
    result.push(...logs.filter((log) => log.removed !== true));
  }
  return result;
}

async function blockTimes(rpc: PairV2Rpc, numbers: number[]): Promise<Map<number, string>> {
  const unique = [...new Set(numbers)].sort((left, right) => left - right);
  const values = await rpcBatch<RpcBlock | null>(
    rpc,
    unique.map((blockNumber) => ({
      method: "eth_getBlockByNumber",
      params: [`0x${blockNumber.toString(16)}`, false],
    })),
  );
  const result = new Map<number, string>();
  values.forEach((block, index) => {
    const blockNumber = unique[index];
    if (blockNumber === undefined || !block) return;
    const seconds = parseRpcQuantity(block.timestamp, "block.timestamp");
    result.set(blockNumber, new Date(seconds * 1_000).toISOString());
  });
  return result;
}

function maxKnown(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return known.length > 0 ? Math.max(...known) : null;
}

function isTransientRpcFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "AbortError" ||
    /fetch failed|network|RPC(?: batch)? HTTP (?:408|425|429|5\d\d)/i.test(error.message)
  );
}

function projectStrength(project: DevMonitorProject): number {
  return (
    (project.marketCapUsd ?? 0) +
    (project.liquidityUsd ?? 0) * 0.75 +
    (project.volume24hUsd ?? 0) * 0.35
  );
}

function successfulProject(project: DevMonitorProject): boolean {
  return (
    ((project.marketCapUsd ?? 0) >= 10_000 && (project.liquidityUsd ?? 0) >= 3_000) ||
    ((project.volume24hUsd ?? 0) >= 10_000 && (project.liquidityUsd ?? 0) >= 2_000)
  );
}

export function deriveDevProfiles(
  projects: DevMonitorProject[],
  observedAt: string,
): DevMonitorProfile[] {
  const grouped = new Map<string, DevMonitorProject[]>();
  for (const project of projects) {
    grouped.set(project.creator, [...(grouped.get(project.creator) ?? []), project]);
  }
  return [...grouped.entries()]
    .map(([address, items]) => {
      const sorted = [...items].sort(
        (left, right) =>
          projectStrength(right) - projectStrength(left) || right.blockNumber - left.blockNumber,
      );
      const topProject = sorted[0] ?? null;
      const topMarketCapUsd = maxKnown(items.map((item) => item.marketCapUsd));
      const topLiquidityUsd = maxKnown(items.map((item) => item.liquidityUsd));
      const topVolume24hUsd = maxKnown(items.map((item) => item.volume24hUsd));
      const qualifiedLaunchCount = items.filter((item) => item.qualityQualified === true).length;
      const successfulLaunchCount = items.filter(successfulProject).length;
      const proven =
        ((topMarketCapUsd ?? 0) >= 25_000 && (topLiquidityUsd ?? 0) >= 10_000) ||
        ((topVolume24hUsd ?? 0) >= 25_000 && (topLiquidityUsd ?? 0) >= 5_000);
      const repeat =
        successfulLaunchCount >= 2 ||
        (qualifiedLaunchCount >= 2 && (topVolume24hUsd ?? 0) >= 1_000);
      const tier = proven ? "proven" : repeat ? "repeat" : "candidate";
      const reasons: string[] = [];
      if (proven) reasons.push("至少一个项目通过真实市值、流动性与成交门槛");
      if (successfulLaunchCount >= 2) reasons.push("至少两次发行达到经济活跃门槛");
      if (qualifiedLaunchCount >= 2) reasons.push("至少两次发行通过 PAIR V2 质量门槛");
      if (reasons.length === 0) reasons.push("已由官方 Factory / Coordinator 发行事件确认");
      const score =
        Math.log10((topMarketCapUsd ?? 0) + 1) * 20 +
        Math.log10((topLiquidityUsd ?? 0) + 1) * 12 +
        Math.log10((topVolume24hUsd ?? 0) + 1) * 8 +
        Math.min(20, items.length * 2) +
        qualifiedLaunchCount * 3 +
        successfulLaunchCount * 5;
      const chronological = [...items].sort(
        (left, right) =>
          left.blockNumber - right.blockNumber || left.address.localeCompare(right.address),
      );
      const first = chronological[0] ?? null;
      const last = chronological.at(-1) ?? null;
      const firstSeenAt = first?.launchedAt ?? first?.observedAt ?? observedAt;
      const lastSeenAt = last?.launchedAt ?? last?.observedAt ?? observedAt;
      return {
        address,
        tier,
        score: Math.round(score * 10) / 10,
        label: topProject?.symbol
          ? `${topProject.symbol} 创建者`
          : `${topProject?.platform ?? "链上"} 创建者`,
        platforms: [...new Set(items.map((item) => item.platform))].sort(),
        launchCount: items.length,
        qualifiedLaunchCount,
        successfulLaunchCount,
        topMarketCapUsd,
        topLiquidityUsd,
        topVolume24hUsd,
        topProject: topProject
          ? {
              address: topProject.address,
              symbol: topProject.symbol,
              platform: topProject.platform,
            }
          : null,
        reasons,
        firstSeenAt,
        lastSeenAt,
        updatedAt: observedAt,
      } satisfies DevMonitorProfile;
    })
    .sort((left, right) => right.score - left.score || left.address.localeCompare(right.address));
}

export function pairV2Projects(
  dashboard: PairV2DashboardResponse | null,
  observedAt: string,
): DevMonitorProject[] {
  if (!dashboard) return [];
  const launches = new Map(
    dashboard.events
      .filter((event) => event.type === "launch" && event.project && event.actor)
      .map((event) => [event.project as string, event] as const),
  );
  return dashboard.tokens.flatMap((token) => {
    const launch = launches.get(token.address);
    const creator = lowerAddress(launch?.actor ?? token.creator);
    if (!launch || !creator) return [];
    return [
      {
        address: token.address,
        platform: "pair_v2",
        creator,
        launchId: launch.id,
        transactionHash: launch.transactionHash,
        blockNumber: launch.blockNumber,
        blockHash: null,
        launchedAt: launch.timestamp,
        attribution: "canonical_event",
        attributionConfidence: "high",
        symbol: token.symbol,
        marketCapUsd: token.marketCapUsd,
        liquidityUsd: token.liquidityUsd,
        volume24hUsd: token.volume24hUsd,
        qualityQualified: token.alpha.quality.state === "qualified",
        observedAt,
      } satisfies DevMonitorProject,
    ];
  });
}

function decodeDynamicString(value: string): string | null {
  if (!/^0x(?:[0-9a-f]{64})+$/i.test(value)) return null;
  const body = value.slice(2);
  if (body.length === 64) {
    const bytes = Buffer.from(body, "hex");
    const end = bytes.indexOf(0);
    const text = bytes
      .subarray(0, end === -1 ? bytes.length : end)
      .toString("utf8")
      .trim();
    return text || null;
  }
  const offset = Number(BigInt(`0x${body.slice(0, 64)}`));
  const lengthWord = body.slice(offset * 2, offset * 2 + 64);
  if (!lengthWord) return null;
  const length = Number(BigInt(`0x${lengthWord}`));
  if (!Number.isSafeInteger(length) || length < 1 || length > 96) return null;
  const start = offset * 2 + 64;
  const text = Buffer.from(body.slice(start, start + length * 2), "hex")
    .toString("utf8")
    .trim();
  return text || null;
}

function boundedSymbol(value: string | null, address: string): string {
  if (!value) return address.slice(2, 8).toUpperCase();
  const normalized = value.replaceAll(/[\p{C}\s]+/gu, " ").trim();
  return normalized ? normalized.slice(0, 24) : address.slice(2, 8).toUpperCase();
}

function parseTransfer(
  log: RpcLog,
): { token: string; from: string; to: string; amount: bigint } | null {
  if (
    log.topics.length !== 3 ||
    log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC ||
    !/^0x[0-9a-f]{64}$/i.test(log.data)
  ) {
    return null;
  }
  const token = lowerAddress(log.address);
  if (!token) return null;
  try {
    return {
      token,
      from: decodeTopicAddress(log.topics[1] as string),
      to: decodeTopicAddress(log.topics[2] as string),
      amount: BigInt(log.data),
    };
  } catch {
    return null;
  }
}

export class DevMonitorCollector {
  private readonly rpc: PairV2Rpc;
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private readonly assetCache = new Map<string, AssetMetadata | null>();

  constructor(
    private readonly settings: DevMonitorSettings,
    dependencies: DevMonitorCollectorDependencies = {},
  ) {
    this.fetcher = dependencies.fetcher ?? fetch;
    this.now = dependencies.now ?? (() => new Date());
    this.wait =
      dependencies.wait ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.rpc =
      dependencies.rpc ??
      new PacedDevMonitorRpc(new JsonRpcClient(settings), settings.rpcMinIntervalMs, this.wait);
  }

  async confirmedHead(): Promise<number> {
    const value = await this.rpc.call<string>("eth_blockNumber", []);
    return Math.max(0, parseRpcQuantity(value, "eth_blockNumber") - this.settings.confirmations);
  }

  async scanLaunchSource(
    source: DevLaunchSource,
    fromBlock: number,
    toBlock: number,
  ): Promise<DevMonitorProject[]> {
    const effectiveFrom = Math.max(source.startBlock, fromBlock);
    const logs = await fetchLogs(
      this.rpc,
      { address: source.address, topics: [source.topic] },
      effectiveFrom,
      toBlock,
      this.settings.logChunkSize,
    );
    const longTransactions = new Map<string, RpcTransaction | null>();
    if (source.id === "long") {
      const hashes = [...new Set(logs.map((log) => log.transactionHash.toLowerCase()))];
      const values = await rpcBatch<RpcTransaction | null>(
        this.rpc,
        hashes.map((hash) => ({ method: "eth_getTransactionByHash", params: [hash] })),
      );
      hashes.forEach((hash, index) => {
        longTransactions.set(hash, values[index] ?? null);
      });
    }
    const observedAt = this.now().toISOString();
    return logs.flatMap((log) => {
      try {
        const transactionHash = lowerHash(log.transactionHash);
        const blockNumber = parseRpcQuantity(log.blockNumber, "log.blockNumber");
        const logIndex = parseRpcQuantity(log.logIndex, "log.logIndex");
        if (!transactionHash) return [];
        let address: string;
        let creator: string;
        let attribution: DevMonitorProject["attribution"] = "canonical_event";
        let attributionConfidence: DevMonitorProject["attributionConfidence"] = "high";
        if (source.id === "pons_v2") {
          if (log.topics.length < 4) return [];
          address = decodeTopicAddress(log.topics[1] as string);
          creator = decodeTopicAddress(log.topics[3] as string);
        } else if (source.id === "long") {
          if (log.topics.length < 4) return [];
          address = decodeTopicAddress(log.topics[2] as string);
          const transaction = longTransactions.get(transactionHash);
          const sender = lowerAddress(transaction?.from);
          const recipient = lowerAddress(transaction?.to);
          if (!sender || recipient !== source.address) return [];
          creator = sender;
          attribution = "canonical_event_transaction_sender";
          attributionConfidence = "medium";
        } else {
          if (log.topics.length < 3) return [];
          address = decodeTopicAddress(log.topics[1] as string);
          creator = decodeTopicAddress(log.topics[2] as string);
        }
        return [
          {
            address,
            platform: source.platform,
            creator,
            launchId: `${String(CHAIN_ID)}:${transactionHash}:${String(logIndex)}`,
            transactionHash,
            blockNumber,
            blockHash: blockHash(log),
            // RPC logs have no timestamp. Keep it unknown instead of issuing one
            // block lookup per historical launch or fabricating an approximate time.
            launchedAt: null,
            attribution,
            attributionConfidence,
            symbol: null,
            marketCapUsd: null,
            liquidityUsd: null,
            volume24hUsd: null,
            qualityQualified: null,
            observedAt,
          } satisfies DevMonitorProject,
        ];
      } catch {
        return [];
      }
    });
  }

  async enrichProjects(projects: DevMonitorProject[]): Promise<DevMonitorMarketEnrichment> {
    const candidates = [...projects]
      .sort((left, right) => right.blockNumber - left.blockNumber)
      .slice(0, 300);
    const batches = chunks(candidates, 30);
    const observedAt = this.now().toISOString();
    const updates: DevMonitorProject[] = [];
    let successfulBatches = 0;
    let failedBatches = 0;
    for (const [batchIndex, batch] of batches.entries()) {
      let payload: Record<string, unknown> | null = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.settings.requestTimeoutMs);
        try {
          const response = await this.fetcher(
            `${this.settings.dexScreenerApiBaseUrl}/tokens/${batch.map((item) => item.address).join(",")}`,
            {
              signal: controller.signal,
              headers: {
                accept: "application/json",
                "user-agent": "rhc-dev-monitor/0.12 (+read-only)",
              },
            },
          );
          if (!response.ok) throw new Error(`DexScreener HTTP ${String(response.status)}`);
          const candidate: unknown = await response.json();
          if (!isRecord(candidate) || !Array.isArray(candidate.pairs)) {
            throw new Error("DexScreener response is invalid");
          }
          payload = candidate;
          break;
        } catch {
          if (attempt === 0) await this.wait(3_000);
        } finally {
          clearTimeout(timeout);
        }
      }
      if (!payload || !Array.isArray(payload.pairs)) {
        failedBatches += 1;
        if (batchIndex < batches.length - 1) await this.wait(MARKET_BATCH_PAUSE_MS);
        continue;
      }
      try {
        const pairsByToken = new Map<string, Array<Record<string, unknown>>>();
        for (const pair of payload.pairs) {
          if (!isRecord(pair) || pair.chainId !== "robinhood") continue;
          const baseToken = isRecord(pair.baseToken) ? pair.baseToken : {};
          const address = lowerAddress(baseToken.address);
          if (!address) continue;
          pairsByToken.set(address, [...(pairsByToken.get(address) ?? []), pair]);
        }
        for (const project of batch) {
          const pairs = pairsByToken.get(project.address) ?? [];
          if (pairs.length === 0) continue;
          const symbols = pairs.flatMap((pair) => {
            const base = isRecord(pair.baseToken) ? pair.baseToken : {};
            return typeof base.symbol === "string" ? [base.symbol] : [];
          });
          const liquidityUsd = pairs.reduce((total, pair) => {
            const liquidity = isRecord(pair.liquidity) ? finiteNumber(pair.liquidity.usd) : null;
            return total + Math.max(0, liquidity ?? 0);
          }, 0);
          const volume24hUsd = pairs.reduce((total, pair) => {
            const volume = isRecord(pair.volume) ? finiteNumber(pair.volume.h24) : null;
            return total + Math.max(0, volume ?? 0);
          }, 0);
          const marketCapUsd = maxKnown(
            pairs.map((pair) => finiteNumber(pair.marketCap) ?? finiteNumber(pair.fdv)),
          );
          updates.push({
            ...project,
            symbol: boundedSymbol(symbols[0] ?? project.symbol, project.address),
            marketCapUsd: marketCapUsd ?? project.marketCapUsd,
            liquidityUsd: liquidityUsd > 0 ? liquidityUsd : project.liquidityUsd,
            volume24hUsd: volume24hUsd > 0 ? volume24hUsd : project.volume24hUsd,
            observedAt,
          });
        }
        successfulBatches += 1;
      } catch {
        failedBatches += 1;
      }
      if (batchIndex < batches.length - 1) await this.wait(MARKET_BATCH_PAUSE_MS);
    }
    return {
      updates,
      requestedProjects: candidates.length,
      totalBatches: batches.length,
      successfulBatches,
      failedBatches,
    };
  }

  private async assetMetadata(address: string): Promise<AssetMetadata | null> {
    if (this.assetCache.has(address)) return this.assetCache.get(address) ?? null;
    try {
      const [decimalsHex, symbolHex] = this.rpc.batch
        ? await this.rpc.batch<string>([
            { method: "eth_call", params: [{ to: address, data: DECIMALS_SELECTOR }, "latest"] },
            { method: "eth_call", params: [{ to: address, data: SYMBOL_SELECTOR }, "latest"] },
          ])
        : await Promise.all([
            this.rpc.call<string>("eth_call", [{ to: address, data: DECIMALS_SELECTOR }, "latest"]),
            this.rpc.call<string>("eth_call", [{ to: address, data: SYMBOL_SELECTOR }, "latest"]),
          ]);
      if (decimalsHex === undefined || symbolHex === undefined) {
        throw new Error("asset metadata response is incomplete");
      }
      if (!/^0x[0-9a-f]{64}$/i.test(decimalsHex)) throw new Error("invalid decimals");
      const decimals = Number(BigInt(decimalsHex));
      if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
        throw new Error("invalid decimals");
      }
      const metadata = {
        decimals,
        symbol: boundedSymbol(decodeDynamicString(symbolHex), address),
      };
      this.assetCache.set(address, metadata);
      return metadata;
    } catch (error) {
      if (isTransientRpcFailure(error)) throw error;
      this.assetCache.set(address, null);
      return null;
    }
  }

  async scanBuys(
    fromBlock: number,
    toBlock: number,
    profiles: DevMonitorProfile[],
    projects: DevMonitorProject[],
  ): Promise<DevMonitorActivity[]> {
    const watched = profiles.filter(
      (profile): profile is DevMonitorProfile & { tier: "repeat" | "proven" } =>
        profile.tier === "repeat" || profile.tier === "proven",
    );
    if (watched.length === 0 || fromBlock > toBlock) return [];
    const logs: RpcLog[] = [];
    for (const addresses of chunks(
      watched.map((profile) => profile.address),
      this.settings.addressTopicBatchSize,
    )) {
      logs.push(
        ...(await fetchLogs(
          this.rpc,
          { topics: [TRANSFER_TOPIC, null, addresses.map(topicAddress)] },
          fromBlock,
          toBlock,
          this.settings.logChunkSize,
        )),
      );
    }
    const hashes = [...new Set(logs.map((log) => log.transactionHash.toLowerCase()))];
    if (hashes.length === 0) return [];
    const receiptCalls = hashes.map((hash) => ({
      method: "eth_getTransactionReceipt",
      params: [hash],
    }));
    const transactionCalls = hashes.map((hash) => ({
      method: "eth_getTransactionByHash",
      params: [hash],
    }));
    const receipts = await rpcBatch<RpcReceipt | null>(this.rpc, receiptCalls);
    const transactions = await rpcBatch<RpcTransaction | null>(this.rpc, transactionCalls);
    const times = await blockTimes(
      this.rpc,
      receipts.flatMap((receipt) =>
        receipt ? [parseRpcQuantity(receipt.blockNumber, "receipt.blockNumber")] : [],
      ),
    );
    const profileByAddress = new Map(watched.map((profile) => [profile.address, profile]));
    const projectByAddress = new Map(projects.map((project) => [project.address, project]));
    const launchTransactions = new Map(
      projects.map((project) => [project.transactionHash, project.address]),
    );
    const observedAt = this.now().toISOString();
    const activities: DevMonitorActivity[] = [];

    for (const [index, hash] of hashes.entries()) {
      const receipt = receipts[index];
      const transaction = transactions[index];
      if (!receipt || !transaction || receipt.status !== "0x1") continue;
      const sender = lowerAddress(transaction.from);
      const receiptBlockHash = lowerHash(receipt.blockHash);
      if (!sender || !receiptBlockHash) continue;
      const blockNumber = parseRpcQuantity(receipt.blockNumber, "receipt.blockNumber");
      const timestamp = times.get(blockNumber);
      if (!timestamp) continue;
      const transfers = receipt.logs.flatMap((log) => {
        const parsed = parseTransfer(log);
        return parsed ? [parsed] : [];
      });
      const devs = [...new Set(transfers.map((transfer) => transfer.to))].filter((address) =>
        profileByAddress.has(address),
      );
      for (const developer of devs) {
        const profile = profileByAddress.get(developer);
        if (!profile) continue;
        const balances = new Map<string, bigint>();
        const hasNonMintInflow = new Set<string>();
        for (const transfer of transfers) {
          if (transfer.to === developer) {
            balances.set(transfer.token, (balances.get(transfer.token) ?? 0n) + transfer.amount);
            if (transfer.from !== ZERO_ADDRESS) hasNonMintInflow.add(transfer.token);
          }
          if (transfer.from === developer) {
            balances.set(transfer.token, (balances.get(transfer.token) ?? 0n) - transfer.amount);
          }
        }
        const targetCandidates = [...balances.entries()].filter(
          ([token, amount]) => amount > 0n && hasNonMintInflow.has(token),
        );
        for (const [targetAddress, targetRaw] of targetCandidates) {
          const outflows = [...balances.entries()].filter(
            ([token, amount]) => token !== targetAddress && amount < 0n,
          );
          const nativeRaw = sender === developer ? BigInt(transaction.value) : 0n;
          if (outflows.length === 0 && nativeRaw <= 0n) continue;
          const targetMetadata = await this.assetMetadata(targetAddress);
          if (!targetMetadata) continue;
          let quote: DevMonitorActivity["quote"];
          let quoteRaw: bigint;
          if (outflows.length > 0) {
            const [quoteAddress, signedRaw] = outflows[0] as [string, bigint];
            const quoteMetadata = await this.assetMetadata(quoteAddress);
            if (!quoteMetadata) continue;
            quote = { address: quoteAddress, ...quoteMetadata };
            quoteRaw = -signedRaw;
          } else {
            quote = { address: "native", symbol: "ETH", decimals: 18 };
            quoteRaw = nativeRaw;
          }
          const confidence = sender === developer ? "high" : "medium";
          activities.push({
            id: `${String(CHAIN_ID)}:${hash}:${developer}:${targetAddress}`,
            type: launchTransactions.get(hash) === targetAddress ? "initial_buy" : "buy",
            developer,
            developerTier: profile.tier,
            transactionHash: hash,
            blockNumber,
            blockHash: receiptBlockHash,
            timestamp,
            target: { address: targetAddress, ...targetMetadata } satisfies DevMonitorAsset,
            targetAmountRaw: targetRaw.toString(),
            targetAmount: decimalAmount(targetRaw, targetMetadata.decimals),
            targetPlatform: projectByAddress.get(targetAddress)?.platform ?? null,
            quote,
            quoteAmountRaw: quoteRaw.toString(),
            quoteAmount: decimalAmount(quoteRaw, quote.decimals),
            transactionSender: sender,
            confidence,
            evidence: [
              "交易 receipt 成功",
              "DEV 地址目标代币净流入",
              quote.address === "native"
                ? "DEV 发起交易且有原生 ETH 支出"
                : "DEV 地址报价资产净流出",
              `${String(this.settings.confirmations)} 个区块确认`,
            ],
            observedAt,
          });
        }
      }
    }
    return activities;
  }
}
