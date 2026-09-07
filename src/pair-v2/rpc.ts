import type { PairV2Settings } from "./config.js";

export interface PairV2RpcLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
  removed?: boolean;
}

export interface PairV2RpcBlock {
  number: string;
  timestamp: string;
}

interface RpcResponse<T> {
  jsonrpc?: string;
  id?: number;
  result?: T;
  error?: { code?: number; message?: string };
}

export interface PairV2Rpc {
  call<T>(method: string, params: unknown[]): Promise<T>;
  batch?<T>(calls: Array<{ method: string; params: unknown[] }>): Promise<T[]>;
}

export function hexQuantity(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid RPC quantity");
  return `0x${value.toString(16)}`;
}

export function parseRpcQuantity(value: unknown, name: string): number {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) {
    throw new Error(`${name} is not an RPC quantity`);
  }
  const parsed = Number.parseInt(value.slice(2), 16);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} is outside safe range`);
  return parsed;
}

export function decodeWord(data: string, index: number): string {
  if (!/^0x(?:[0-9a-f]{64})*$/i.test(data)) throw new Error("Invalid ABI data");
  const start = 2 + index * 64;
  const word = data.slice(start, start + 64);
  if (word.length !== 64) throw new Error("ABI word is missing");
  return word.toLowerCase();
}

export function decodeAddressWord(word: string): string {
  if (!/^[0-9a-f]{64}$/i.test(word) || !/^0{24}/i.test(word)) {
    throw new Error("Invalid ABI address word");
  }
  return `0x${word.slice(24).toLowerCase()}`;
}

export function decodeTopicAddress(topic: string): string {
  if (!/^0x[0-9a-f]{64}$/i.test(topic) || !/^0x0{24}/i.test(topic)) {
    throw new Error("Invalid indexed address");
  }
  return `0x${topic.slice(-40).toLowerCase()}`;
}

export function decodeUintWord(word: string): bigint {
  if (!/^[0-9a-f]{64}$/i.test(word)) throw new Error("Invalid ABI uint word");
  return BigInt(`0x${word}`);
}

export function encodeUintWord(value: bigint): string {
  if (value < 0n || value >= 1n << 256n) throw new Error("ABI uint is outside uint256");
  return value.toString(16).padStart(64, "0");
}

export function encodeAddressWord(value: string): string {
  if (!/^0x[0-9a-f]{40}$/i.test(value)) throw new Error("Invalid ABI address");
  return value.slice(2).toLowerCase().padStart(64, "0");
}

export function decimalAmount(raw: bigint, decimals: number): number {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return Number.NaN;
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const fraction = raw % divisor;
  const fractionText = fraction.toString().padStart(decimals, "0").slice(0, 12);
  const value = Number(`${whole.toString()}.${fractionText || "0"}`);
  return Number.isFinite(value) ? value : Number.NaN;
}

function isTransient(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export class JsonRpcClient implements PairV2Rpc {
  constructor(
    private readonly settings: Pick<PairV2Settings, "rpcUrl" | "requestTimeoutMs">,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async call<T>(method: string, params: unknown[]): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.settings.requestTimeoutMs);
      try {
        const response = await this.fetcher(this.settings.rpcUrl, {
          method: "POST",
          signal: controller.signal,
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "user-agent": "rhc-pair-v2-monitor/0.12 (+read-only)",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        });
        if (!response.ok) {
          const error = new Error(`RPC HTTP ${String(response.status)}`);
          if (!isTransient(response.status)) throw error;
          lastError = error;
        } else {
          const payload = (await response.json()) as RpcResponse<T>;
          if (payload.error) {
            throw new Error(
              `RPC ${method} failed: ${payload.error.message?.slice(0, 160) || "unknown error"}`,
            );
          }
          if (!("result" in payload)) throw new Error(`RPC ${method} omitted result`);
          return payload.result as T;
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      } finally {
        clearTimeout(timeout);
      }
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
    throw lastError ?? new Error(`RPC ${method} failed`);
  }

  async batch<T>(calls: Array<{ method: string; params: unknown[] }>): Promise<T[]> {
    if (calls.length === 0) return [];
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.settings.requestTimeoutMs);
      try {
        const response = await this.fetcher(this.settings.rpcUrl, {
          method: "POST",
          signal: controller.signal,
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "user-agent": "rhc-pair-v2-monitor/0.12 (+read-only)",
          },
          body: JSON.stringify(
            calls.map((call, index) => ({
              jsonrpc: "2.0",
              id: index + 1,
              method: call.method,
              params: call.params,
            })),
          ),
        });
        if (!response.ok) {
          const error = new Error(`RPC batch HTTP ${String(response.status)}`);
          if (!isTransient(response.status)) throw error;
          lastError = error;
        } else {
          const payload = (await response.json()) as Array<RpcResponse<T>>;
          if (!Array.isArray(payload)) throw new Error("RPC batch response is not an array");
          const byId = new Map(payload.map((item) => [item.id, item]));
          return calls.map((_call, index) => {
            const item = byId.get(index + 1);
            if (!item || item.error || !("result" in item)) {
              throw new Error(`RPC batch item ${String(index + 1)} failed`);
            }
            return item.result as T;
          });
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      } finally {
        clearTimeout(timeout);
      }
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
    throw lastError ?? new Error("RPC batch failed");
  }
}
