import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fetchJson, finiteNumber, isRecord } from "../utils/http.js";
import type { EconomicsSettings } from "./config.js";
import type {
  EconomicsCollectionBatch,
  EconomicsSourceHealth,
  ProtocolTokenMarketObservation,
  TokenSupplyObservation,
} from "./types.js";

const execFileAsync = promisify(execFile);
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;

export interface EconomicsSourceResult<T> {
  value: T;
  fetchedAt: string;
  latencyMs: number;
}

export interface EconomicsCollectorDependencies {
  fetchPairToken?: () => Promise<EconomicsSourceResult<ProtocolTokenMarketObservation>>;
  fetchPonsToken?: () => Promise<EconomicsSourceResult<ProtocolTokenMarketObservation>>;
  fetchTokenSupplies?: () => Promise<EconomicsSourceResult<TokenSupplyObservation[]>>;
  now?: () => Date;
}

function boundedString(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().replaceAll(/\s+/g, " ");
  return normalized ? normalized.slice(0, maxLength) : fallback;
}

function nonNegative(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function nestedRecord(value: Record<string, unknown>, key: string): Record<string, unknown> {
  return isRecord(value[key]) ? value[key] : {};
}

export function parsePairProtocolToken(
  payload: unknown,
  observedAt: string,
  settings: EconomicsSettings,
): ProtocolTokenMarketObservation {
  if (!isRecord(payload)) throw new Error("PAIR protocol-token payload is not an object");
  const address = typeof payload.address === "string" ? payload.address.toLowerCase() : "";
  if (address !== settings.pairTokenAddress) {
    throw new Error("PAIR protocol-token response returned an unexpected address");
  }
  return {
    platformId: "pair",
    address,
    name: boundedString(payload.name, "PAIR", 96),
    symbol: boundedString(payload.symbol, "PAIR", 24),
    tokenUrl: settings.pairTokenUrl,
    observedAt,
    priceUsd: nonNegative(payload.priceUsd),
    marketCapUsd: nonNegative(payload.marketCapUsd),
    liquidityUsd: nonNegative(payload.totalDepthUsd),
    volume24hUsd: nonNegative(payload.combinedVolume24hUsd) ?? nonNegative(payload.volume24hUsd),
    holderCount: null,
    source: "pair.officialTokenApi",
    quality: "official",
  };
}

export function parsePonsProtocolToken(
  payload: unknown,
  observedAt: string,
  settings: EconomicsSettings,
): ProtocolTokenMarketObservation {
  const root = isRecord(payload) && isRecord(payload.data) ? payload.data : payload;
  if (!isRecord(root)) throw new Error("PONS token-info payload is not an object");
  const address = typeof root.address === "string" ? root.address.toLowerCase() : "";
  if (address !== settings.ponsTokenAddress) {
    throw new Error("PONS token-info response returned an unexpected address");
  }
  const price = nestedRecord(root, "price");
  const priceUsd = nonNegative(price.price);
  const supply = nonNegative(root.circulating_supply) ?? nonNegative(root.total_supply);
  const holderCount = nonNegative(root.holder_count);
  return {
    platformId: "pons",
    address,
    name: boundedString(root.name, "Pons", 96),
    symbol: boundedString(root.symbol, "PONS", 24),
    tokenUrl: settings.ponsTokenUrl,
    observedAt,
    priceUsd,
    marketCapUsd: priceUsd !== null && supply !== null ? priceUsd * supply : null,
    liquidityUsd: nonNegative(root.liquidity),
    volume24hUsd: nonNegative(price.volume_24h),
    holderCount: holderCount !== null && Number.isInteger(holderCount) ? holderCount : null,
    source: "gmgn.ponsTokenInfo",
    quality: "derived",
  };
}

function parseRpcHex(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error(`RPC ${label} result is not hexadecimal`);
  }
  return BigInt(value);
}

function scaledNumber(raw: bigint, decimals: number): number {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error("Token decimals are outside the supported range");
  }
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const fraction = raw % divisor;
  return Number(whole) + Number(fraction) / Number(divisor);
}

function rpcResults(payload: unknown): Map<number, string> {
  if (!Array.isArray(payload)) throw new Error("RPC batch response is not an array");
  const values = new Map<number, string>();
  for (const candidate of payload) {
    if (!isRecord(candidate)) continue;
    const id = finiteNumber(candidate.id);
    if (id === null || !Number.isInteger(id) || typeof candidate.result !== "string") continue;
    values.set(id, candidate.result);
  }
  return values;
}

export function parseTokenSupplies(
  payload: unknown,
  observedAt: string,
  settings: EconomicsSettings,
): TokenSupplyObservation[] {
  const values = rpcResults(payload);
  const blockNumber = values.get(7) ?? null;
  const tokens = [
    { address: settings.ponsTokenAddress, totalId: 1, burnId: 2, decimalsId: 3 },
    { address: settings.pairTokenAddress, totalId: 4, burnId: 5, decimalsId: 6 },
  ];
  return tokens.map((token) => {
    const totalHex = values.get(token.totalId);
    const burnHex = values.get(token.burnId);
    const decimalsHex = values.get(token.decimalsId);
    if (!totalHex || !burnHex || !decimalsHex) throw new Error("RPC batch response is incomplete");
    const decimals = Number(parseRpcHex(decimalsHex, "decimals"));
    const totalSupply = scaledNumber(parseRpcHex(totalHex, "totalSupply"), decimals);
    const burnedSupply = scaledNumber(parseRpcHex(burnHex, "burn balance"), decimals);
    if (burnedSupply > totalSupply) throw new Error("Burn balance exceeds total supply");
    return {
      address: token.address,
      decimals,
      totalSupply,
      burnedSupply,
      observedAt,
      blockNumber,
    };
  });
}

async function defaultPairTokenFetcher(
  settings: EconomicsSettings,
): Promise<EconomicsSourceResult<ProtocolTokenMarketObservation>> {
  const fetched = await fetchJson(settings.pairTokenApiUrl, {
    timeoutMs: settings.requestTimeoutMs,
    retries: 1,
  });
  return {
    value: parsePairProtocolToken(fetched.payload, fetched.fetchedAt, settings),
    fetchedAt: fetched.fetchedAt,
    latencyMs: fetched.latencyMs,
  };
}

async function defaultPonsTokenFetcher(
  settings: EconomicsSettings,
): Promise<EconomicsSourceResult<ProtocolTokenMarketObservation>> {
  const started = performance.now();
  const inheritedNodeOptions = process.env.NODE_OPTIONS ?? "";
  const nodeOptions = inheritedNodeOptions.includes("--use-system-ca")
    ? inheritedNodeOptions
    : `${inheritedNodeOptions} --use-system-ca`.trim();
  const { stdout } = await execFileAsync(
    settings.gmgnBinary,
    ["token", "info", "--chain", "robinhood", "--address", settings.ponsTokenAddress, "--raw"],
    {
      timeout: settings.gmgnTimeoutMs,
      maxBuffer: 3 * 1_024 * 1_024,
      env: { ...process.env, NODE_OPTIONS: nodeOptions },
    },
  );
  const fetchedAt = new Date().toISOString();
  return {
    value: parsePonsProtocolToken(JSON.parse(stdout) as unknown, fetchedAt, settings),
    fetchedAt,
    latencyMs: Math.round(performance.now() - started),
  };
}

function balanceOfData(address: string): string {
  if (!ADDRESS_PATTERN.test(address)) throw new Error("Dead address is invalid");
  return `0x70a08231${address.slice(2).padStart(64, "0")}`;
}

async function defaultSupplyFetcher(
  settings: EconomicsSettings,
): Promise<EconomicsSourceResult<TokenSupplyObservation[]>> {
  return fetchTokenSuppliesFromRpc(settings);
}

export async function fetchTokenSuppliesFromRpc(
  settings: EconomicsSettings,
  options: { fetcher?: typeof fetch; retryDelayMs?: number } = {},
): Promise<EconomicsSourceResult<TokenSupplyObservation[]>> {
  const started = performance.now();
  const fetcher = options.fetcher ?? fetch;
  const retryDelayMs = options.retryDelayMs ?? 250;
  const call = (id: number, to: string, data: string) => ({
    jsonrpc: "2.0",
    id,
    method: "eth_call",
    params: [{ to, data }, "latest"],
  });
  const body = [
    call(1, settings.ponsTokenAddress, "0x18160ddd"),
    call(2, settings.ponsTokenAddress, balanceOfData(settings.deadAddress)),
    call(3, settings.ponsTokenAddress, "0x313ce567"),
    call(4, settings.pairTokenAddress, "0x18160ddd"),
    call(5, settings.pairTokenAddress, balanceOfData(settings.deadAddress)),
    call(6, settings.pairTokenAddress, "0x313ce567"),
    { jsonrpc: "2.0", id: 7, method: "eth_blockNumber", params: [] },
  ];
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetcher(settings.rpcUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "user-agent": "rhc-launch-ledger/0.7 (+read-only research dashboard)",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(settings.requestTimeoutMs),
      });
      if (!response.ok) throw new Error(`RPC HTTP ${String(response.status)}`);
      const payload: unknown = await response.json();
      const fetchedAt = new Date().toISOString();
      return {
        value: parseTokenSupplies(payload, fetchedAt, settings),
        fetchedAt,
        latencyMs: Math.round(performance.now() - started),
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === 0 && retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }
  // Batch rejection must not discard a working single-call endpoint. Pin every
  // fallback eth_call to one block, and check the chain before accepting it.
  for (const rpcUrl of [...new Set([settings.rpcUrl, ...(settings.rpcFallbackUrls ?? [])])]) {
    try {
      const request = async (method: string, params: unknown[], id: number) => {
        const response = await fetcher(rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json", "user-agent": "rhc-launch-ledger" },
          body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
          signal: AbortSignal.timeout(Math.min(settings.requestTimeoutMs, 5_000)),
        });
        if (!response.ok) throw new Error("RPC transport unavailable");
        const result: unknown = await response.json();
        if (
          !isRecord(result) ||
          result.id !== id ||
          typeof result.result !== "string" ||
          result.error
        ) {
          throw new Error("RPC result invalid");
        }
        return result.result;
      };
      if (BigInt(await request("eth_chainId", [], 8)) !== 4663n) continue;
      const block = await request("eth_blockNumber", [], 7);
      parseRpcHex(block, "block");
      const results = [{ id: 7, result: block }];
      for (const item of body.slice(0, 6)) {
        results.push({
          id: item.id,
          result: await request("eth_call", [item.params[0], block], item.id),
        });
      }
      const fetchedAt = new Date().toISOString();
      return {
        value: parseTokenSupplies(results, fetchedAt, settings),
        fetchedAt,
        latencyMs: Math.round(performance.now() - started),
      };
    } catch {
      // Fail closed and do not expose a credential-bearing URL in errors.
    }
  }
  throw new Error(
    `RPC supply unavailable after bounded batch and single-call attempts (${lastError?.name ?? "UnknownError"})`,
  );
}

function buildSourceHealth<T>(
  source: string,
  label: string,
  url: string,
  result: PromiseSettledResult<EconomicsSourceResult<T>>,
  failedAt: string,
): EconomicsSourceHealth {
  if (result.status === "fulfilled") {
    return {
      source,
      label,
      status: "ok",
      fetchedAt: result.value.fetchedAt,
      message: "数据可用。",
      url,
    };
  }
  return {
    source,
    label,
    status: "failed",
    fetchedAt: failedAt,
    message: "当前来源不可用。",
    url,
  };
}

export class EconomicsCollector {
  private readonly fetchPairToken: () => Promise<
    EconomicsSourceResult<ProtocolTokenMarketObservation>
  >;
  private readonly fetchPonsToken: () => Promise<
    EconomicsSourceResult<ProtocolTokenMarketObservation>
  >;
  private readonly fetchTokenSupplies: () => Promise<
    EconomicsSourceResult<TokenSupplyObservation[]>
  >;
  private readonly now: () => Date;

  constructor(
    private readonly settings: EconomicsSettings,
    dependencies: EconomicsCollectorDependencies = {},
  ) {
    this.fetchPairToken =
      dependencies.fetchPairToken ?? (() => defaultPairTokenFetcher(this.settings));
    this.fetchPonsToken =
      dependencies.fetchPonsToken ?? (() => defaultPonsTokenFetcher(this.settings));
    this.fetchTokenSupplies =
      dependencies.fetchTokenSupplies ?? (() => defaultSupplyFetcher(this.settings));
    this.now = dependencies.now ?? (() => new Date());
  }

  async collect(): Promise<EconomicsCollectionBatch> {
    const observedAt = this.now().toISOString();
    const [pairResult, ponsResult, supplyResult] = await Promise.allSettled([
      this.fetchPairToken(),
      this.fetchPonsToken(),
      this.fetchTokenSupplies(),
    ]);
    const tokenMarkets = [pairResult, ponsResult].flatMap((result) =>
      result.status === "fulfilled" ? [result.value.value] : [],
    );
    const tokenSupplies = supplyResult.status === "fulfilled" ? supplyResult.value.value : [];
    const sourceHealth: EconomicsSourceHealth[] = [
      buildSourceHealth(
        "pair.officialTokenApi",
        "PAIR 官方代币 API",
        this.settings.pairTokenApiUrl,
        pairResult,
        observedAt,
      ),
      buildSourceHealth(
        "gmgn.ponsTokenInfo",
        "GMGN PONS 市场数据",
        this.settings.ponsTokenUrl,
        ponsResult,
        observedAt,
      ),
      buildSourceHealth(
        "robinhood.rpc.tokenSupply",
        "Robinhood Chain 链上供应量",
        "https://rpc.mainnet.chain.robinhood.com",
        supplyResult,
        observedAt,
      ),
    ];
    return {
      observedAt,
      tokenMarkets,
      tokenSupplies,
      sourceHealth,
      warnings: sourceHealth
        .filter((source) => source.status !== "ok")
        .map((source) => `${source.source}_unavailable`),
    };
  }
}
