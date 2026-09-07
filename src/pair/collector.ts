import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fetchJson, finiteNumber, isRecord, type FetchedJson } from "../utils/http.js";
import type { PairTokenSettings } from "./config.js";
import type {
  PairCollectionBatch,
  PairHolderCacheEntry,
  PairQuoteAsset,
  PairSourceHealth,
  PairTokenSnapshot,
} from "./types.js";

const execFileAsync = promisify(execFile);
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const HOLDER_SOURCE = "gmgn.tokenInfo";
const PAIR_SOURCE = "pair.officialApi";

interface PairApiPage {
  items: unknown[];
  total: number;
  page: number;
  limit: number;
}

export interface PairHolderObservation {
  holderCount: number;
  observedAt: string;
  latencyMs: number;
  source: string;
}

export interface PairCollectorDependencies {
  fetchPage?: (url: string) => Promise<FetchedJson>;
  fetchHolder?: (address: string) => Promise<PairHolderObservation>;
  now?: () => Date;
}

function boundedString(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().replaceAll(/\s+/g, " ");
  return normalized ? normalized.slice(0, maxLength) : fallback;
}

function nonNegativeNumber(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function timestamp(value: unknown): string | null {
  let parsed: number;
  if (typeof value === "number") parsed = value < 10_000_000_000 ? value * 1_000 : value;
  else if (typeof value === "string" && value.trim() !== "") parsed = Date.parse(value);
  else return null;
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function normalizeQuoteAssets(value: unknown): PairQuoteAsset[] {
  if (!Array.isArray(value)) return [];
  const byAddress = new Map<string, PairQuoteAsset>();
  for (const item of value) {
    if (!isRecord(item) || !isRecord(item.quoteToken)) continue;
    const quote = item.quoteToken;
    if (typeof quote.address !== "string" || !ADDRESS_PATTERN.test(quote.address)) continue;
    const decimals = finiteNumber(quote.decimals);
    if (decimals === null || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
      continue;
    }
    const address = quote.address.toLowerCase();
    if (byAddress.has(address)) continue;
    byAddress.set(address, {
      address,
      symbol: boundedString(quote.symbol, address.slice(2, 8).toUpperCase(), 24),
      decimals,
    });
  }
  return [...byAddress.values()];
}

function parsePage(payload: unknown): PairApiPage {
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    throw new Error("PAIR token page did not match the documented response shape");
  }
  const total = positiveInteger(payload.total);
  const page = positiveInteger(payload.page);
  const limit = positiveInteger(payload.limit);
  if (total === null || page === null || limit === null) {
    throw new Error("PAIR token page contained invalid pagination metadata");
  }
  return { items: payload.items, total, page, limit };
}

function isFresh(value: string | null, now: Date, minutes: number): boolean {
  if (!value) return false;
  const observed = Date.parse(value);
  if (!Number.isFinite(observed)) return false;
  const age = now.valueOf() - observed;
  return age >= -5 * 60_000 && age <= minutes * 60_000;
}

function eligibilityReason(
  snapshot: PairTokenSnapshot,
  settings: PairTokenSettings,
  now: Date,
): string | null {
  if (snapshot.marketCapUsd === null || snapshot.marketCapUsd < settings.marketCapFloorUsd) {
    return "market_cap_below_floor";
  }
  if (
    snapshot.liquidityDepthUsd === null ||
    snapshot.liquidityDepthUsd < settings.liquidityDepthFloorUsd
  ) {
    return "liquidity_depth_below_floor";
  }
  if (!isFresh(snapshot.marketDataUpdatedAt, now, settings.marketFreshnessMinutes)) {
    return "market_data_stale";
  }
  return null;
}

function normalizeToken(
  value: unknown,
  observedAt: string,
  settings: PairTokenSettings,
  now: Date,
): PairTokenSnapshot | null {
  if (
    !isRecord(value) ||
    typeof value.address !== "string" ||
    !ADDRESS_PATTERN.test(value.address)
  ) {
    return null;
  }
  const address = value.address.toLowerCase();
  const symbol = boundedString(value.symbol, address.slice(2, 8).toUpperCase(), 24);
  const marketDataUpdatedAt = timestamp(value.marketDataUpdatedAt);
  const snapshot: PairTokenSnapshot = {
    address,
    name: boundedString(value.name, symbol, 96),
    symbol,
    tokenUrl: `https://pair.fund/tokens/${address}`,
    launchedAt: timestamp(value.launchedAt),
    graduated: value.graduated === true,
    observedAt,
    priceUsd: nonNegativeNumber(value.priceUsd),
    marketCapUsd: nonNegativeNumber(value.marketCapUsd),
    liquidityDepthUsd: nonNegativeNumber(value.totalDepthUsd),
    volume24hUsd:
      nonNegativeNumber(value.combinedVolume24hUsd) ?? nonNegativeNumber(value.volume24hUsd),
    holderCount: null,
    holderObservedAt: null,
    holderSource: null,
    quoteAssets: normalizeQuoteAssets(value.pairs),
    eligible: false,
    eligibilityReason: null,
    marketDataSource:
      typeof value.marketDataSource === "string" ? value.marketDataSource.slice(0, 64) : null,
    marketDataUpdatedAt,
  };

  if (value.flagged === true || value.hidden === true) {
    snapshot.eligibilityReason = "hidden_or_flagged";
    return snapshot;
  }
  snapshot.eligibilityReason = eligibilityReason(snapshot, settings, now);
  snapshot.eligible = snapshot.eligibilityReason === null;
  return snapshot;
}

async function mapConcurrent<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      const value = values[index];
      if (value !== undefined) results[index] = await mapper(value);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

async function fetchAllPages(
  settings: PairTokenSettings,
  fetchPage: (url: string) => Promise<FetchedJson>,
): Promise<{ items: unknown[]; fetchedAt: string; latencyMs: number }> {
  const started = performance.now();
  const urlFor = (page: number) =>
    `${settings.apiBaseUrl}/tokens?page=${String(page)}&limit=${String(settings.pageLimit)}`;
  const firstFetch = await fetchPage(urlFor(1));
  const first = parsePage(firstFetch.payload);
  if (first.page !== 1) throw new Error("PAIR token pagination started on an unexpected page");
  const pageCount = Math.ceil(first.total / first.limit);
  if (pageCount > settings.maxPages) throw new Error("PAIR token universe exceeded safety cap");

  const pageNumbers = Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) => index + 2);
  const remaining = await mapConcurrent(
    pageNumbers,
    settings.pageConcurrency,
    async (pageNumber) => {
      const fetched = await fetchPage(urlFor(pageNumber));
      const page = parsePage(fetched.payload);
      if (page.page !== pageNumber || page.limit !== first.limit || page.total !== first.total) {
        throw new Error("PAIR token pagination changed during collection");
      }
      return { fetched, page };
    },
  );
  const items = [first, ...remaining.map((result) => result.page)].flatMap((page) => page.items);
  if (items.length !== first.total) {
    throw new Error("PAIR token pagination returned an incomplete universe");
  }
  return {
    items,
    fetchedAt: remaining.reduce(
      (latest, result) => (result.fetched.fetchedAt > latest ? result.fetched.fetchedAt : latest),
      firstFetch.fetchedAt,
    ),
    latencyMs: Math.round(performance.now() - started),
  };
}

function cacheAgeMinutes(entry: PairHolderCacheEntry, now: Date): number {
  const observed = Date.parse(entry.observedAt);
  return Number.isFinite(observed) ? (now.valueOf() - observed) / 60_000 : Number.POSITIVE_INFINITY;
}

async function defaultHolderFetcher(
  settings: PairTokenSettings,
  address: string,
): Promise<PairHolderObservation> {
  const started = performance.now();
  const inheritedNodeOptions = process.env.NODE_OPTIONS ?? "";
  const nodeOptions = inheritedNodeOptions.includes("--use-system-ca")
    ? inheritedNodeOptions
    : `${inheritedNodeOptions} --use-system-ca`.trim();
  const { stdout } = await execFileAsync(
    settings.gmgnBinary,
    ["token", "info", "--chain", "robinhood", "--address", address, "--raw"],
    {
      timeout: settings.gmgnTimeoutMs,
      maxBuffer: 2 * 1_024 * 1_024,
      env: { ...process.env, NODE_OPTIONS: nodeOptions },
    },
  );
  const payload: unknown = JSON.parse(stdout);
  if (!isRecord(payload)) throw new Error("GMGN token info returned an invalid response");
  if (finiteNumber(payload.code) !== null && finiteNumber(payload.code) !== 0) {
    throw new Error("GMGN token info returned a business error");
  }
  const data = isRecord(payload.data) ? payload.data : payload;
  const holderCount = nonNegativeNumber(data.holder_count);
  if (holderCount === null || !Number.isInteger(holderCount)) {
    throw new Error("GMGN token info did not include holder_count");
  }
  return {
    holderCount,
    observedAt: new Date().toISOString(),
    latencyMs: Math.round(performance.now() - started),
    source: HOLDER_SOURCE,
  };
}

export class PairTokenCollector {
  private readonly fetchPage: (url: string) => Promise<FetchedJson>;
  private readonly fetchHolder: (address: string) => Promise<PairHolderObservation>;
  private readonly now: () => Date;

  constructor(
    private readonly settings: PairTokenSettings,
    dependencies: PairCollectorDependencies = {},
  ) {
    this.fetchPage = dependencies.fetchPage ?? ((url) => fetchJson(url, { retries: 1 }));
    this.fetchHolder =
      dependencies.fetchHolder ?? ((address) => defaultHolderFetcher(this.settings, address));
    this.now = dependencies.now ?? (() => new Date());
  }

  async collect(holderCache: Map<string, PairHolderCacheEntry>): Promise<PairCollectionBatch> {
    const now = this.now();
    const observedAt = now.toISOString();
    const pages = await fetchAllPages(this.settings, this.fetchPage);
    const byAddress = new Map<string, PairTokenSnapshot>();
    let invalidTokenCount = 0;
    for (const item of pages.items) {
      const token = normalizeToken(item, observedAt, this.settings, now);
      if (!token) {
        invalidTokenCount += 1;
        continue;
      }
      if (byAddress.has(token.address)) {
        throw new Error("PAIR token pagination returned a duplicate address");
      }
      byAddress.set(token.address, token);
    }
    const tokens = [...byAddress.values()].sort((left, right) =>
      left.address.localeCompare(right.address),
    );
    const eligible = tokens.filter((token) => token.eligible);
    const holderTargets = eligible.filter((token) => {
      const cached = holderCache.get(token.address);
      return !cached || cacheAgeMinutes(cached, now) > this.settings.holderTtlMinutes;
    });

    const holderStarted = performance.now();
    const holderResults = await mapConcurrent(holderTargets, 3, async (token) => {
      try {
        return {
          address: token.address,
          value: await this.fetchHolder(token.address),
          error: false,
        };
      } catch {
        return { address: token.address, value: null, error: true };
      }
    });
    const fetchedHolders = new Map(
      holderResults.flatMap((result) => (result.value ? [[result.address, result.value]] : [])),
    );
    let holderAvailable = 0;
    let holderFetchFailures = 0;

    for (const token of eligible) {
      const fetched = fetchedHolders.get(token.address);
      const cached = holderCache.get(token.address);
      if (fetched) {
        token.holderCount = fetched.holderCount;
        token.holderObservedAt = fetched.observedAt;
        token.holderSource = fetched.source;
        holderAvailable += 1;
        continue;
      }
      const failed = holderResults.some(
        (result) => result.address === token.address && result.error,
      );
      if (failed) holderFetchFailures += 1;
      if (cached && cacheAgeMinutes(cached, now) <= this.settings.holderMaxStaleMinutes) {
        token.holderCount = cached.holderCount;
        token.holderObservedAt = cached.observedAt;
        token.holderSource = cached.source;
        holderAvailable += 1;
      }
    }

    const holderStatus: PairSourceHealth["status"] =
      eligible.length === 0 || (holderAvailable === eligible.length && holderFetchFailures === 0)
        ? "ok"
        : holderAvailable > 0
          ? "degraded"
          : "failed";
    const warnings: string[] = [];
    if (invalidTokenCount > 0) warnings.push("pair_invalid_tokens_skipped");
    if (holderStatus !== "ok") warnings.push("pair_holder_data_partial");
    const holderFetchedAt = eligible.reduce(
      (latest, token) =>
        token.holderObservedAt && token.holderObservedAt > latest ? token.holderObservedAt : latest,
      eligible.length > 0 ? "" : observedAt,
    );

    return {
      observedAt,
      tokens,
      universeCount: tokens.filter((token) => token.eligibilityReason !== "hidden_or_flagged")
        .length,
      eligibleCount: eligible.length,
      warnings,
      sourceHealth: [
        {
          source: PAIR_SOURCE,
          status: "ok",
          fetchedAt: pages.fetchedAt,
          latencyMs: pages.latencyMs,
          message: `${tokens.length} visible token records normalized from the official API.`,
        },
        {
          source: HOLDER_SOURCE,
          status: holderStatus,
          fetchedAt: holderFetchedAt || observedAt,
          latencyMs: holderTargets.length ? Math.round(performance.now() - holderStarted) : 0,
          message: `${holderAvailable}/${eligible.length} eligible tokens have usable holder counts.`,
        },
      ],
    };
  }
}
