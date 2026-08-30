import type { WindowDays } from "../../domain/types.js";
import { BotError } from "../errors.js";
import {
  type LedgerCoverageResponse,
  type LedgerHealthResponse,
  type LedgerSourcesResponse,
  validateCoverage,
  validateHealth,
  validateMeta,
  validateOverview,
  validatePlatform,
  validateSources,
} from "./contract.js";
import type {
  LedgerMetaResponse,
  OverviewResponse,
  PlatformDetailResponse,
} from "../../domain/types.js";

export interface LedgerClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  cacheTtlMs?: number;
  fetcher?: typeof fetch;
  now?: () => number;
}

interface CacheEntry {
  expiresAt: number;
  value: unknown;
}

type Validator<T> = (value: unknown) => T;

export class LedgerClient {
  private readonly baseUrl: URL;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private boundary: string | null = null;

  constructor(options: LedgerClientOptions) {
    let parsed: URL;
    try {
      parsed = new URL(options.baseUrl);
    } catch {
      throw new BotError("CONFIG_INVALID");
    }
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
      throw new BotError("CONFIG_INVALID");
    this.baseUrl = new URL("/", parsed);
    this.timeoutMs = options.timeoutMs ?? 3_000;
    this.cacheTtlMs = options.cacheTtlMs ?? 15_000;
    if (this.timeoutMs < 1 || this.cacheTtlMs < 0 || this.cacheTtlMs > 15_000)
      throw new BotError("CONFIG_INVALID");
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
  }

  getHealth(): Promise<LedgerHealthResponse> {
    return this.get("health", "/healthz", validateHealth);
  }

  async getMeta(): Promise<LedgerMetaResponse> {
    const meta = await this.get("meta", "/api/meta", validateMeta);
    const nextBoundary = `${String(meta.apiContractVersion)}:${String(meta.targetDate)}`;
    if (this.boundary !== null && this.boundary !== nextBoundary) this.cache.clear();
    this.boundary = nextBoundary;
    return meta;
  }

  getOverview(windowDays: WindowDays): Promise<OverviewResponse> {
    return this.get(
      `overview:${String(windowDays)}`,
      `/api/overview?window=${String(windowDays)}`,
      (value) => validateOverview(value, windowDays),
    );
  }

  getPlatform(platformId: string): Promise<PlatformDetailResponse> {
    if (!/^[a-z0-9-]{1,64}$/.test(platformId)) throw new BotError("USER_INPUT_INVALID");
    return this.get(`platform:${platformId}`, `/api/platforms/${platformId}`, (value) =>
      validatePlatform(value, platformId),
    );
  }

  getCoverage(): Promise<LedgerCoverageResponse> {
    return this.get("coverage", "/api/coverage", validateCoverage);
  }

  getSources(): Promise<LedgerSourcesResponse> {
    return this.get("sources", "/api/sources", validateSources);
  }

  private get<T>(key: string, path: string, validate: Validator<T>): Promise<T> {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return Promise.resolve(cached.value as T);
    if (cached) this.cache.delete(key);

    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;

    const pending = this.fetchAndValidate(path, validate)
      .then((value) => {
        if (this.cacheTtlMs > 0) {
          this.cache.set(key, { expiresAt: this.now() + this.cacheTtlMs, value });
        }
        return value;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, pending);
    return pending;
  }

  private async fetchAndValidate<T>(path: string, validate: Validator<T>): Promise<T> {
    let lastError: BotError | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      // Keep a referenced timer so a hung fetch cannot let a short-lived process exit first.
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetcher(new URL(path, this.baseUrl), {
          method: "GET",
          redirect: "manual",
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        if (response.status >= 500 && attempt === 0) continue;
        if (!response.ok) throw new BotError("LEDGER_HTTP_ERROR", response.status >= 500);
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw new BotError("CONTRACT_INCOMPATIBLE");
        }
        return validate(payload);
      } catch (error) {
        if (error instanceof BotError) {
          if (error.code === "CONTRACT_INCOMPATIBLE" || error.code === "VERSION_NOT_AVAILABLE")
            throw error;
          lastError = error;
          if (!error.retryable || attempt === 1) throw error;
          continue;
        }
        const isTimeout =
          controller.signal.aborted ||
          (error instanceof DOMException &&
            (error.name === "TimeoutError" || error.name === "AbortError"));
        lastError = new BotError(isTimeout ? "LEDGER_TIMEOUT" : "LEDGER_UNAVAILABLE", true);
        if (attempt === 1) throw lastError;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError ?? new BotError("LEDGER_UNAVAILABLE");
  }
}
