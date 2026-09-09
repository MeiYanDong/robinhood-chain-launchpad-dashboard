import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fetchJson, finiteNumber, isRecord, type FetchedJson } from "../utils/http.js";
import type { PairV2Settings } from "./config.js";
import {
  decimalAmount,
  decodeAddressWord,
  decodeTopicAddress,
  decodeUintWord,
  decodeWord,
  encodeAddressWord,
  encodeUintWord,
  hexQuantity,
  JsonRpcClient,
  parseRpcQuantity,
  type PairV2Rpc,
  type PairV2RpcBlock,
  type PairV2RpcLog,
} from "./rpc.js";
import type {
  PairV2Bucket,
  PairV2ChainEvent,
  PairV2CollectionBatch,
  PairV2CollectionContext,
  PairV2Launch,
  PairV2MarketToken,
  PairV2ModeId,
  PairV2Pool,
  PairV2QuoteAsset,
  PairV2Release,
  PairV2ShortWindowMarket,
  PairV2SourceHealth,
} from "./types.js";

const execFileAsync = promisify(execFile);
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/i;
const BYTES32_PATTERN = /^0x[0-9a-f]{64}$/i;

export const PAIR_V2_TOPICS = {
  launch: "0x8aae1ddb61bb894868f4b1a037b2a84d5f25e02118d13a83e11eb3ebbeb9f076",
  buyback: "0x53d370fdd15769ce3833adc1c65db843f5a8d4767df83832d215275fd54363bf",
  holderClaim: "0x2cdaea43eb2c4890ec7426064d5bda51dbbf00ead2aa0ac8803e3da93b587da4",
  upgraded: "0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b",
  nativeFeesCollected: "0xbc417acde43118d9ba469c0618bf9eb8452713c09bd56a2926d2eb5ee58936a5",
} as const;

const BUYBACK_BUCKET_SELECTOR = "aea375bd";
const PAIR_RELEASE_SOURCE = "pair_release" as const;
const PAIR_TOKENS_SOURCE = "pair_tokens" as const;
const DEXSCREENER_SOURCE = "dexscreener_pairs" as const;
const RPC_SOURCE = "robinhood_rpc" as const;
const HOLDERS_SOURCE = "gmgn_holders" as const;

interface PairApiPage {
  items: unknown[];
  total: number;
  page: number;
  limit: number;
}

interface ParsedLogIdentity {
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
  emitter: string;
}

export interface HolderObservation {
  count: number;
  observedAt: string;
}

export interface PairV2CollectorDependencies {
  fetchPage?: (url: string) => Promise<FetchedJson>;
  rpc?: PairV2Rpc;
  fetchHolder?: (address: string) => Promise<HolderObservation>;
  now?: () => Date;
}

function lowerAddress(value: unknown): string | null {
  return typeof value === "string" && ADDRESS_PATTERN.test(value) ? value.toLowerCase() : null;
}

function stringValue(value: unknown, fallback: string, maxLength = 96): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().replaceAll(/\s+/g, " ");
  return normalized ? normalized.slice(0, maxLength) : fallback;
}

function nonNegative(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function timestamp(value: unknown): string | null {
  let parsed = Number.NaN;
  if (typeof value === "number") parsed = value < 10_000_000_000 ? value * 1_000 : value;
  else if (typeof value === "string" && value.trim()) parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function optionalUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim(), "https://pair.fund");
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function integerText(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return /^\d+$/.test(normalized) ? normalized : null;
}

function parsePage(payload: unknown): PairApiPage {
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    throw new Error("PAIR V2 token page has an unexpected response shape");
  }
  const total = positiveInteger(payload.total);
  const page = positiveInteger(payload.page);
  const limit = positiveInteger(payload.limit);
  if (total === null || page === null || limit === null) {
    throw new Error("PAIR V2 token pagination metadata is invalid");
  }
  return { items: payload.items, total, page, limit };
}

function parseQuote(value: unknown): PairV2QuoteAsset | null {
  if (!isRecord(value)) return null;
  const address = lowerAddress(value.address);
  const decimals = finiteNumber(value.decimals);
  if (
    !address ||
    decimals === null ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 36
  ) {
    return null;
  }
  return {
    address,
    symbol: stringValue(value.symbol, address.slice(2, 8).toUpperCase(), 24),
    decimals,
  };
}

function parsePools(value: unknown): PairV2Pool[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const position = candidate.positionId ?? candidate.positionTokenId;
    const positionId =
      typeof position === "string" && /^\d+$/.test(position)
        ? position
        : typeof position === "number" && Number.isSafeInteger(position) && position >= 0
          ? String(position)
          : null;
    const quote = parseQuote(candidate.quoteToken);
    if (!positionId || !quote || seen.has(positionId)) return [];
    seen.add(positionId);
    return [
      {
        positionId,
        poolId:
          typeof candidate.poolId === "string" && BYTES32_PATTERN.test(candidate.poolId)
            ? candidate.poolId.toLowerCase()
            : null,
        quote,
        canonical: candidate.canonical !== false,
        weightBps: nonNegativeInteger(candidate.weightBps ?? candidate.allocationBps),
      },
    ];
  });
}

export function parseMarketToken(value: unknown): PairV2MarketToken | null {
  if (!isRecord(value)) return null;
  const address = lowerAddress(value.address);
  if (!address) return null;
  const launchVersion =
    value.launchVersion === "v1" || value.launchVersion === "v2" ? value.launchVersion : "unknown";
  const symbol = stringValue(value.symbol, address.slice(2, 8).toUpperCase(), 24);
  const pools = parsePools(value.pairs);
  const pairDepths = Array.isArray(value.pairs)
    ? value.pairs.flatMap((pair) =>
        isRecord(pair) && nonNegative(pair.totalDepthUsd) !== null
          ? [nonNegative(pair.totalDepthUsd) as number]
          : [],
      )
    : [];
  const holderCount = nonNegativeInteger(value.holders);
  return {
    address,
    name: stringValue(value.name, symbol, 96),
    symbol,
    creator: lowerAddress(value.creator),
    launchedAt: timestamp(value.launchedAt),
    priceUsd: nonNegative(value.priceUsd),
    marketCapUsd: nonNegative(value.marketCapUsd),
    liquidityUsd:
      nonNegative(value.totalDepthUsd) ??
      (pairDepths.length > 0 ? pairDepths.reduce((sum, item) => sum + item, 0) : null),
    volume24hUsd: nonNegative(value.combinedVolume24hUsd) ?? nonNegative(value.volume24hUsd),
    holderCount,
    holderObservedAt: holderCount === null ? null : new Date().toISOString(),
    marketDataUpdatedAt: timestamp(value.marketDataUpdatedAt),
    hidden: value.hidden === true,
    flagged: value.flagged === true,
    pools,
    profile: {
      descriptionPresent:
        typeof value.description === "string" && value.description.trim().length >= 32,
      websiteUrl: optionalUrl(value.website),
      twitterUrl: optionalUrl(value.twitter),
      telegramUrl: optionalUrl(value.telegram),
      metadataUri: optionalUrl(value.metadataUri),
    },
    shortWindow: null,
    marketDataSource:
      typeof value.marketDataSource === "string" && value.marketDataSource.trim()
        ? value.marketDataSource.trim().slice(0, 48)
        : null,
    dexScreenerUrl: optionalUrl(value.dexScreenerUrl),
    graduated: value.graduated === true,
    migrationProgressPercent:
      nonNegative(value.websiteMigrationProgress) ?? nonNegative(value.progress),
    initialDeveloperBuyRaw: integerText(value.initialDeveloperBuy),
    quoteSpentOnDeveloperBuyRaw: integerText(value.quoteSpentOnDeveloperBuy),
    launchVersion,
    marketVersion:
      typeof value.marketVersion === "string" && value.marketVersion.trim()
        ? value.marketVersion.trim().slice(0, 48)
        : null,
    launchTransactionHash:
      typeof value.launchTxHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(value.launchTxHash)
        ? value.launchTxHash.toLowerCase()
        : null,
    alphaMarketCandidate: false,
    alphaCandidateReasons: [],
  };
}

function parseRelease(
  payload: unknown,
  settings: PairV2Settings,
  observedAt: string,
): PairV2Release {
  if (!isRecord(payload) || !isRecord(payload.addresses)) {
    throw new Error("PAIR V2 release attestation has an unexpected response shape");
  }
  const addressNames = [
    "launchpad",
    "modeRegistry",
    "coordinator",
    "tokenFactory",
    "hook",
    "buybackExecutor",
    "aggregator",
  ] as const;
  const addresses = {} as PairV2Release["addresses"];
  for (const name of addressNames) {
    const address = lowerAddress(payload.addresses[name]);
    if (!address) throw new Error(`PAIR V2 release omitted ${name}`);
    addresses[name] = address;
  }
  const releaseId = typeof payload.releaseId === "string" ? payload.releaseId.toLowerCase() : "";
  const manifestSha256 =
    typeof payload.manifestSha256 === "string" ? payload.manifestSha256.toLowerCase() : "";
  const attestedBlock = finiteNumber(payload.blockNumber);
  if (
    !BYTES32_PATTERN.test(releaseId) ||
    !/^[0-9a-f]{64}$/.test(manifestSha256) ||
    attestedBlock === null ||
    !Number.isSafeInteger(attestedBlock)
  ) {
    throw new Error("PAIR V2 release identity is invalid");
  }
  return {
    releaseId,
    manifestSha256,
    schema: stringValue(payload.schema, "unknown", 96),
    capability: stringValue(payload.capability, "unknown", 96),
    ready: payload.ready === true,
    configured: payload.configured === true,
    canonical:
      payload.ready === true &&
      payload.configured === true &&
      releaseId === settings.expectedReleaseId &&
      manifestSha256 === settings.expectedManifestSha256,
    deploymentBlock: settings.deploymentBlock,
    attestedBlock,
    addresses,
    observedAt,
  };
}

async function mapConcurrent<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  let failed = false;
  let firstError: unknown = null;
  async function worker(): Promise<void> {
    for (;;) {
      if (failed) return;
      const index = next;
      next += 1;
      if (index >= values.length) return;
      const value = values[index];
      if (value === undefined) continue;
      try {
        results[index] = await mapper(value);
      } catch (error) {
        if (!failed) firstError = error;
        failed = true;
        return;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  if (failed) throw firstError;
  return results;
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchAllPairTokens(
  settings: PairV2Settings,
  fetchPage: (url: string) => Promise<FetchedJson>,
): Promise<{
  tokens: PairV2MarketToken[];
  fetchedAt: string;
  latencyMs: number;
  expected: number;
  rawCount: number;
}> {
  const started = performance.now();
  const urlFor = (page: number) =>
    `${settings.apiBaseUrl}/tokens?page=${String(page)}&limit=${String(settings.pageLimit)}&sort=newest&timeframe=all`;
  const firstFetch = await fetchPage(urlFor(1));
  const first = parsePage(firstFetch.payload);
  const pageCount = Math.ceil(first.total / first.limit);
  if (pageCount > settings.maxPages) throw new Error("PAIR token universe exceeded safety cap");
  const pages = await mapConcurrent(
    Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) => index + 2),
    settings.pageConcurrency,
    async (pageNumber) => {
      const fetched = await fetchPage(urlFor(pageNumber));
      const page = parsePage(fetched.payload);
      if (page.page !== pageNumber || page.total !== first.total || page.limit !== first.limit) {
        throw new Error("PAIR token pagination drifted during collection");
      }
      return { fetched, page };
    },
  );
  const rawItems = [first, ...pages.map((item) => item.page)].flatMap((page) => page.items);
  const byAddress = new Map<string, PairV2MarketToken>();
  for (const item of rawItems) {
    const token = parseMarketToken(item);
    if (token) byAddress.set(token.address, token);
  }
  return {
    tokens: [...byAddress.values()].sort((left, right) =>
      left.address.localeCompare(right.address),
    ),
    fetchedAt: pages.reduce(
      (latest, page) => (page.fetched.fetchedAt > latest ? page.fetched.fetchedAt : latest),
      firstFetch.fetchedAt,
    ),
    latencyMs: Math.round(performance.now() - started),
    expected: first.total,
    rawCount: rawItems.length,
  };
}

function marketAgeHours(token: PairV2MarketToken, now: Date): number {
  const launchedAt = token.launchedAt ? Date.parse(token.launchedAt) : Number.NaN;
  if (!Number.isFinite(launchedAt)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now.valueOf() - launchedAt) / 3_600_000);
}

function candidateReasons(token: PairV2MarketToken, settings: PairV2Settings, now: Date): string[] {
  const reasons: string[] = [];
  if (token.launchVersion === "v2") reasons.push("v2_generation");
  if ((token.shortWindow?.volume5mUsd ?? 0) > 0) reasons.push("retained_short_activity");
  if ((token.volume24hUsd ?? 0) >= settings.alphaMinimumVolume24hUsd) {
    reasons.push("official_volume_floor");
  }
  if ((token.marketCapUsd ?? 0) >= settings.alphaMinimumMarketCapUsd) {
    reasons.push("market_cap_floor");
  }
  if (marketAgeHours(token, now) <= settings.alphaRecentHours) reasons.push("recent_launch");
  return reasons;
}

export function selectAlphaMarketCandidates(
  tokens: PairV2MarketToken[],
  settings: PairV2Settings,
  now: Date,
): PairV2MarketToken[] {
  const currentGeneration = tokens.filter((token) => token.launchVersion === "v2");
  const legacy = tokens
    .filter((token) => token.launchVersion !== "v2")
    .map((token) => ({ token, reasons: candidateReasons(token, settings, now) }))
    .filter(({ reasons }) => reasons.length > 0)
    .sort(
      (left, right) =>
        Number(right.reasons.includes("retained_short_activity")) -
          Number(left.reasons.includes("retained_short_activity")) ||
        (right.token.volume24hUsd ?? -1) - (left.token.volume24hUsd ?? -1) ||
        (right.token.marketCapUsd ?? -1) - (left.token.marketCapUsd ?? -1) ||
        Date.parse(right.token.launchedAt ?? "") - Date.parse(left.token.launchedAt ?? ""),
    )
    .slice(0, settings.alphaLegacyCandidateLimit)
    .map(({ token }) => token);
  const selected = new Set([...currentGeneration, ...legacy].map((token) => token.address));
  return tokens.map((token) => {
    const reasons = candidateReasons(token, settings, now);
    return {
      ...token,
      alphaMarketCandidate: selected.has(token.address),
      alphaCandidateReasons: selected.has(token.address) ? reasons : [],
    };
  });
}

export function selectHotMarketAddresses(tokens: PairV2MarketToken[], limit: number): Set<string> {
  return new Set(
    tokens
      .filter((token) => token.alphaMarketCandidate)
      .sort(
        (left, right) =>
          (right.shortWindow?.volume5mUsd ?? -1) - (left.shortWindow?.volume5mUsd ?? -1) ||
          (right.shortWindow?.volume1hUsd ?? -1) - (left.shortWindow?.volume1hUsd ?? -1) ||
          (right.volume24hUsd ?? -1) - (left.volume24hUsd ?? -1) ||
          Date.parse(right.launchedAt ?? "") - Date.parse(left.launchedAt ?? ""),
      )
      .slice(0, limit)
      .map((token) => token.address),
  );
}

interface DexScreenerPairObservation {
  pairId: string;
  tokenAddress: string;
  url: string | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  volume5mUsd: number | null;
  volume1hUsd: number | null;
  volume6hUsd: number | null;
  volume24hUsd: number | null;
  buys5m: number | null;
  sells5m: number | null;
  buys1h: number | null;
  sells1h: number | null;
  priceChange1hPct: number | null;
  priceChange6hPct: number | null;
  priceChange24hPct: number | null;
  priceChange5mPct: number | null;
}

function nestedRecord(value: unknown, key: string): Record<string, unknown> {
  return isRecord(value) && isRecord(value[key]) ? value[key] : {};
}

function parseDexScreenerPairs(payload: unknown): DexScreenerPairObservation[] {
  if (!isRecord(payload) || !Array.isArray(payload.pairs)) {
    throw new Error("DexScreener pair response has an unexpected shape");
  }
  return payload.pairs.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const pairId =
      typeof candidate.pairAddress === "string" && BYTES32_PATTERN.test(candidate.pairAddress)
        ? candidate.pairAddress.toLowerCase()
        : null;
    const baseToken = isRecord(candidate.baseToken) ? candidate.baseToken : {};
    const tokenAddress = lowerAddress(baseToken.address);
    if (!pairId || !tokenAddress || candidate.chainId !== "robinhood") return [];
    const volume = isRecord(candidate.volume) ? candidate.volume : {};
    const priceChange = isRecord(candidate.priceChange) ? candidate.priceChange : {};
    const liquidity = isRecord(candidate.liquidity) ? candidate.liquidity : {};
    const txns = isRecord(candidate.txns) ? candidate.txns : {};
    const m5 = nestedRecord(txns, "m5");
    const h1 = nestedRecord(txns, "h1");
    return [
      {
        pairId,
        tokenAddress,
        url: optionalUrl(candidate.url),
        priceUsd: nonNegative(candidate.priceUsd),
        marketCapUsd: nonNegative(candidate.marketCap) ?? nonNegative(candidate.fdv),
        liquidityUsd: nonNegative(liquidity.usd),
        volume5mUsd: nonNegative(volume.m5),
        volume1hUsd: nonNegative(volume.h1),
        volume6hUsd: nonNegative(volume.h6),
        volume24hUsd: nonNegative(volume.h24),
        buys5m: nonNegativeInteger(m5.buys),
        sells5m: nonNegativeInteger(m5.sells),
        buys1h: nonNegativeInteger(h1.buys),
        sells1h: nonNegativeInteger(h1.sells),
        priceChange1hPct: finiteNumber(priceChange.h1),
        priceChange6hPct: finiteNumber(priceChange.h6),
        priceChange24hPct: finiteNumber(priceChange.h24),
        priceChange5mPct: finiteNumber(priceChange.m5),
      },
    ];
  });
}

function sumObserved(
  observations: DexScreenerPairObservation[],
  read: (observation: DexScreenerPairObservation) => number | null,
): number | null {
  const values = observations.map(read).filter((value): value is number => value !== null);
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) : null;
}

function primaryObservation(
  observations: DexScreenerPairObservation[],
): DexScreenerPairObservation | null {
  return (
    [...observations].sort(
      (left, right) =>
        (right.liquidityUsd ?? -1) - (left.liquidityUsd ?? -1) ||
        (right.volume1hUsd ?? -1) - (left.volume1hUsd ?? -1),
    )[0] ?? null
  );
}

function weightedMedianPrice(observations: DexScreenerPairObservation[]): number | null {
  const priced = observations
    .flatMap((observation) =>
      observation.priceUsd !== null
        ? [{ price: observation.priceUsd, weight: Math.max(observation.liquidityUsd ?? 0, 1) }]
        : [],
    )
    .sort((left, right) => left.price - right.price);
  if (priced.length === 0) return null;
  const totalWeight = priced.reduce((total, item) => total + item.weight, 0);
  let accumulated = 0;
  for (const item of priced) {
    accumulated += item.weight;
    if (accumulated >= totalWeight / 2) return item.price;
  }
  return priced.at(-1)?.price ?? null;
}

async function enrichWithDexScreener(
  tokens: PairV2MarketToken[],
  settings: PairV2Settings,
  fetchPage: (url: string) => Promise<FetchedJson>,
  trackedAddresses?: Set<string>,
): Promise<{
  tokens: PairV2MarketToken[];
  fetchedAt: string;
  latencyMs: number;
  observedTokens: number;
  expectedTokens: number;
  updatedAddresses: string[];
}> {
  const started = performance.now();
  const pairToToken = new Map<string, string>();
  for (const token of tokens.filter(
    (candidate) =>
      candidate.alphaMarketCandidate &&
      (trackedAddresses === undefined || trackedAddresses.has(candidate.address)),
  )) {
    for (const pool of token.pools) {
      if (pool.poolId && pool.canonical !== false) pairToToken.set(pool.poolId, token.address);
    }
  }
  const pairIds = [...pairToToken.keys()];
  if (pairIds.length === 0) {
    return {
      tokens,
      fetchedAt: new Date().toISOString(),
      latencyMs: Math.round(performance.now() - started),
      observedTokens: 0,
      expectedTokens: 0,
      updatedAddresses: [],
    };
  }

  const pages = await mapConcurrent(
    Array.from({ length: Math.ceil(pairIds.length / 30) }, (_, index) =>
      pairIds.slice(index * 30, index * 30 + 30),
    ),
    Math.min(2, settings.pageConcurrency),
    async (ids) => {
      const url = `${settings.dexScreenerApiBaseUrl}/pairs/robinhood/${ids.join(",")}`;
      const fetched = await fetchPage(url);
      return { fetched, observations: parseDexScreenerPairs(fetched.payload) };
    },
  );
  const byToken = new Map<string, DexScreenerPairObservation[]>();
  for (const observation of pages.flatMap((page) => page.observations)) {
    const expectedToken = pairToToken.get(observation.pairId);
    if (!expectedToken || expectedToken !== observation.tokenAddress) continue;
    byToken.set(expectedToken, [...(byToken.get(expectedToken) ?? []), observation]);
  }
  const fetchedAt = pages.reduce(
    (latest, page) => (page.fetched.fetchedAt > latest ? page.fetched.fetchedAt : latest),
    pages[0]?.fetched.fetchedAt ?? new Date().toISOString(),
  );
  return {
    tokens: tokens.map((token) => {
      const observations = byToken.get(token.address) ?? [];
      const primary = primaryObservation(observations);
      if (!primary) return token;
      // A nearly empty canonical pool can report a technically valid but
      // economically meaningless price. Keep it in gross volume/liquidity
      // evidence, but do not let dust manufacture an astronomical spread or
      // move the consensus price.
      const meaningfulLiquidityFloor = Math.max(25, (primary.liquidityUsd ?? 0) * 0.01);
      const priceObservations = observations.filter(
        (item) =>
          item.pairId === primary.pairId ||
          (item.liquidityUsd !== null && item.liquidityUsd >= meaningfulLiquidityFloor),
      );
      const prices = priceObservations.flatMap((item) =>
        item.priceUsd === null ? [] : [item.priceUsd],
      );
      const consensusPriceUsd = weightedMedianPrice(priceObservations);
      const minimumPriceUsd = prices.length > 0 ? Math.min(...prices) : null;
      const maximumPriceUsd = prices.length > 0 ? Math.max(...prices) : null;
      const crossPoolSpreadPct =
        minimumPriceUsd !== null && minimumPriceUsd > 0 && maximumPriceUsd !== null
          ? ((maximumPriceUsd - minimumPriceUsd) / minimumPriceUsd) * 100
          : null;
      const shortWindow: PairV2ShortWindowMarket = {
        observedAt: fetchedAt,
        source: "dexscreener",
        pairCount: observations.length,
        volume5mUsd: sumObserved(observations, (item) => item.volume5mUsd),
        volume1hUsd: sumObserved(observations, (item) => item.volume1hUsd),
        volume6hUsd: sumObserved(observations, (item) => item.volume6hUsd),
        volume24hUsd: sumObserved(observations, (item) => item.volume24hUsd),
        buys5m: sumObserved(observations, (item) => item.buys5m),
        sells5m: sumObserved(observations, (item) => item.sells5m),
        buys1h: sumObserved(observations, (item) => item.buys1h),
        sells1h: sumObserved(observations, (item) => item.sells1h),
        priceChange1hPct: primary.priceChange1hPct,
        priceChange6hPct: primary.priceChange6hPct,
        priceChange24hPct: primary.priceChange24hPct,
        priceChange5mPct: primary.priceChange5mPct,
        primaryPoolId: primary.pairId,
        primaryVolume5mUsd: primary.volume5mUsd,
        primaryVolume1hUsd: primary.volume1hUsd,
        primaryVolume24hUsd: primary.volume24hUsd,
        primaryLiquidityUsd: primary.liquidityUsd,
        consensusPriceUsd,
        minimumPriceUsd,
        maximumPriceUsd,
        crossPoolSpreadPct,
      };
      return {
        ...token,
        priceUsd: consensusPriceUsd ?? token.priceUsd ?? primary.priceUsd,
        marketCapUsd: primary.marketCapUsd ?? token.marketCapUsd,
        liquidityUsd: sumObserved(observations, (item) => item.liquidityUsd) ?? token.liquidityUsd,
        volume24hUsd: token.volume24hUsd,
        marketDataUpdatedAt: fetchedAt,
        dexScreenerUrl: token.dexScreenerUrl ?? primary.url,
        shortWindow,
      };
    }),
    fetchedAt,
    latencyMs: Math.round(performance.now() - started),
    observedTokens: byToken.size,
    expectedTokens: new Set(pairToToken.values()).size,
    updatedAddresses: [...byToken.keys()],
  };
}

function cachedHolderFresh(
  token: PairV2MarketToken | undefined,
  now: Date,
  minutes: number,
): boolean {
  if (!token?.holderObservedAt || token.holderCount === null) return false;
  const observed = Date.parse(token.holderObservedAt);
  return Number.isFinite(observed) && now.valueOf() - observed <= minutes * 60_000;
}

async function defaultHolderFetcher(
  settings: PairV2Settings,
  address: string,
): Promise<HolderObservation> {
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
  if (!isRecord(payload)) throw new Error("GMGN holder response is invalid");
  const data = isRecord(payload.data) ? payload.data : payload;
  const count = nonNegative(data.holder_count);
  if (count === null || !Number.isInteger(count)) throw new Error("GMGN omitted holder_count");
  return { count, observedAt: new Date().toISOString() };
}

function logIdentity(log: PairV2RpcLog): ParsedLogIdentity {
  const emitter = lowerAddress(log.address);
  if (
    !emitter ||
    !BYTES32_PATTERN.test(log.transactionHash) ||
    !Array.isArray(log.topics) ||
    log.removed === true
  ) {
    throw new Error("RPC log identity is invalid");
  }
  return {
    emitter,
    blockNumber: parseRpcQuantity(log.blockNumber, "log.blockNumber"),
    transactionHash: log.transactionHash.toLowerCase(),
    logIndex: parseRpcQuantity(log.logIndex, "log.logIndex"),
  };
}

function modeId(value: bigint): PairV2ModeId {
  const parsed = Number(value);
  if (parsed !== 1 && parsed !== 2 && parsed !== 3) throw new Error("Unknown PAIR V2 mode");
  return parsed;
}

function launchFromLog(
  log: PairV2RpcLog,
  release: PairV2Release,
  blockTimes: Map<number, string>,
  chainId: number,
): PairV2Launch | null {
  if (
    log.address.toLowerCase() !== release.addresses.coordinator ||
    log.topics[0]?.toLowerCase() !== PAIR_V2_TOPICS.launch ||
    log.topics.length < 4
  ) {
    return null;
  }
  const identity = logIdentity(log);
  const timestampValue = blockTimes.get(identity.blockNumber);
  if (!timestampValue) throw new Error("Launch event is missing block timestamp");
  return {
    eventId: `${String(chainId)}:${identity.transactionHash}:${String(identity.logIndex)}`,
    releaseId: release.releaseId,
    project: decodeTopicAddress(log.topics[1] as string),
    creator: decodeTopicAddress(log.topics[2] as string),
    vault: decodeTopicAddress(log.topics[3] as string),
    modeId: modeId(decodeUintWord(decodeWord(log.data, 0))),
    modeVersion: Number(decodeUintWord(decodeWord(log.data, 1))),
    handler: decodeAddressWord(decodeWord(log.data, 2)),
    salt: `0x${decodeWord(log.data, 3)}`,
    blockNumber: identity.blockNumber,
    transactionHash: identity.transactionHash,
    logIndex: identity.logIndex,
    timestamp: timestampValue,
  };
}

function amountFields(raw: bigint, decimals: number): { raw: string; value: number | null } {
  const value = decimalAmount(raw, decimals);
  return { raw: raw.toString(), value: Number.isFinite(value) ? value : null };
}

function eventBase(
  log: PairV2RpcLog,
  releaseId: string,
  timestampValue: string,
  chainId: number,
): Pick<
  PairV2ChainEvent,
  | "id"
  | "releaseId"
  | "blockNumber"
  | "transactionHash"
  | "logIndex"
  | "timestamp"
  | "emitter"
  | "evidence"
> {
  const identity = logIdentity(log);
  return {
    id: `${String(chainId)}:${identity.transactionHash}:${String(identity.logIndex)}`,
    releaseId,
    blockNumber: identity.blockNumber,
    transactionHash: identity.transactionHash,
    logIndex: identity.logIndex,
    timestamp: timestampValue,
    emitter: identity.emitter,
    evidence: "onchain",
  };
}

function addressOrder(address: string): bigint {
  return BigInt(address);
}

function chainEventFromLog(
  log: PairV2RpcLog,
  release: PairV2Release,
  launchByVault: Map<string, PairV2Launch>,
  poolByPosition: Map<string, { project: string; pool: PairV2Pool }>,
  blockTimes: Map<number, string>,
  chainId: number,
): PairV2ChainEvent | null {
  const identity = logIdentity(log);
  const timestampValue = blockTimes.get(identity.blockNumber);
  if (!timestampValue) throw new Error("Chain event is missing block timestamp");
  const topic = log.topics[0]?.toLowerCase();
  const base = eventBase(log, release.releaseId, timestampValue, chainId);

  if (topic === PAIR_V2_TOPICS.launch) {
    const launch = launchFromLog(log, release, blockTimes, chainId);
    if (!launch) return null;
    return {
      ...base,
      type: "launch",
      project: launch.project,
      vault: launch.vault,
      actor: launch.creator,
      asset: null,
      assetSymbol: null,
      amountRaw: null,
      amount: null,
      secondaryAmountRaw: null,
      secondaryAmount: null,
      epoch: null,
      positionId: null,
      modeId: launch.modeId,
      implementation: null,
    };
  }

  if (
    topic === PAIR_V2_TOPICS.buyback &&
    identity.emitter === release.addresses.buybackExecutor &&
    log.topics.length >= 4
  ) {
    const project = decodeAddressWord(decodeWord(log.data, 0));
    const launch = [...launchByVault.values()].find((item) => item.project === project);
    if (!launch) return null;
    const input = amountFields(decodeUintWord(decodeWord(log.data, 2)), 18);
    const burned = amountFields(decodeUintWord(decodeWord(log.data, 3)), 18);
    return {
      ...base,
      type: "buyback_executed",
      project,
      vault: decodeTopicAddress(log.topics[2] as string),
      actor: decodeTopicAddress(log.topics[1] as string),
      asset: decodeTopicAddress(log.topics[3] as string),
      assetSymbol: null,
      amountRaw: input.raw,
      amount: input.value,
      secondaryAmountRaw: burned.raw,
      secondaryAmount: burned.value,
      epoch: Number(decodeUintWord(decodeWord(log.data, 1))),
      positionId: null,
      modeId: launch.modeId,
      implementation: null,
    };
  }

  const launch = launchByVault.get(identity.emitter);
  if (!launch) {
    if (
      topic === PAIR_V2_TOPICS.upgraded &&
      identity.emitter === release.addresses.launchpad &&
      log.topics.length >= 2
    ) {
      return {
        ...base,
        type: "upgrade",
        project: null,
        vault: null,
        actor: null,
        asset: null,
        assetSymbol: null,
        amountRaw: null,
        amount: null,
        secondaryAmountRaw: null,
        secondaryAmount: null,
        epoch: null,
        positionId: null,
        modeId: null,
        implementation: decodeTopicAddress(log.topics[1] as string),
      };
    }
    return null;
  }

  if (topic === PAIR_V2_TOPICS.holderClaim && log.topics.length >= 3) {
    const asset = decodeTopicAddress(log.topics[2] as string);
    const pool = [...poolByPosition.values()].find(
      (item) => item.project === launch.project && item.pool.quote.address === asset,
    );
    const amount = amountFields(
      decodeUintWord(decodeWord(log.data, 0)),
      pool?.pool.quote.decimals ?? 18,
    );
    return {
      ...base,
      type: "holder_claim",
      project: launch.project,
      vault: launch.vault,
      actor: decodeTopicAddress(log.topics[1] as string),
      asset,
      assetSymbol: pool?.pool.quote.symbol ?? null,
      amountRaw: amount.raw,
      amount: amount.value,
      secondaryAmountRaw: null,
      secondaryAmount: null,
      epoch: null,
      positionId: null,
      modeId: launch.modeId,
      implementation: null,
    };
  }

  if (topic === PAIR_V2_TOPICS.nativeFeesCollected && log.topics.length >= 2) {
    const positionId = decodeUintWord(log.topics[1]?.slice(2) as string).toString();
    const mapped = poolByPosition.get(positionId);
    if (!mapped || mapped.project !== launch.project) return null;
    const amount0 = decodeUintWord(decodeWord(log.data, 0));
    const amount1 = decodeUintWord(decodeWord(log.data, 1));
    const quoteIsToken0 = addressOrder(mapped.pool.quote.address) < addressOrder(mapped.project);
    const quoteRaw = quoteIsToken0 ? amount0 : amount1;
    const projectRaw = quoteIsToken0 ? amount1 : amount0;
    const quoteAmount = amountFields(quoteRaw, mapped.pool.quote.decimals);
    const projectAmount = amountFields(projectRaw, 18);
    return {
      ...base,
      type: "fee_collected",
      project: launch.project,
      vault: launch.vault,
      actor: null,
      asset: mapped.pool.quote.address,
      assetSymbol: mapped.pool.quote.symbol,
      amountRaw: quoteAmount.raw,
      amount: quoteAmount.value,
      secondaryAmountRaw: projectAmount.raw,
      secondaryAmount: projectAmount.value,
      epoch: null,
      positionId,
      modeId: launch.modeId,
      implementation: null,
    };
  }
  return null;
}

async function fetchLogs(
  rpc: PairV2Rpc,
  fromBlock: number,
  toBlock: number,
  chunkSize: number,
): Promise<PairV2RpcLog[]> {
  if (fromBlock > toBlock) return [];
  const ranges: Array<{ from: number; to: number }> = [];
  for (let from = fromBlock; from <= toBlock; from += chunkSize) {
    ranges.push({ from, to: Math.min(toBlock, from + chunkSize - 1) });
  }
  const topicSet = Object.values(PAIR_V2_TOPICS);
  const pages = await mapConcurrent(ranges, 1, ({ from, to }) =>
    rpc.call<PairV2RpcLog[]>("eth_getLogs", [
      { fromBlock: hexQuantity(from), toBlock: hexQuantity(to), topics: [topicSet] },
    ]),
  );
  return pages.flat().filter((log) => log.removed !== true);
}

async function blockTimesForLogs(
  rpc: PairV2Rpc,
  logs: PairV2RpcLog[],
): Promise<Map<number, string>> {
  const blockNumbers = [
    ...new Set(logs.map((log) => parseRpcQuantity(log.blockNumber, "log.blockNumber"))),
  ];
  const calls = blockNumbers.map((blockNumber) => ({
    method: "eth_getBlockByNumber",
    params: [hexQuantity(blockNumber), false],
  }));
  let blockPayloads: PairV2RpcBlock[];
  try {
    blockPayloads = rpc.batch
      ? await rpc.batch<PairV2RpcBlock>(calls)
      : await mapConcurrent(calls, 1, (call) => rpc.call<PairV2RpcBlock>(call.method, call.params));
  } catch {
    await pause(2_000);
    blockPayloads = [];
    for (const call of calls) {
      blockPayloads.push(await rpc.call<PairV2RpcBlock>(call.method, call.params));
      await pause(125);
    }
  }
  const blocks = blockNumbers.map((blockNumber, index) => {
    const block = blockPayloads[index];
    if (!block) throw new Error("RPC block batch omitted a block");
    const seconds = parseRpcQuantity(block.timestamp, "block.timestamp");
    return { blockNumber, timestamp: new Date(seconds * 1_000).toISOString() };
  });
  return new Map(blocks.map((block) => [block.blockNumber, block.timestamp]));
}

async function readBuckets(
  rpc: PairV2Rpc,
  release: PairV2Release,
  launches: PairV2Launch[],
  tokens: PairV2MarketToken[],
  settings: PairV2Settings,
  observedAt: string,
  observedBlock: number,
): Promise<{ buckets: PairV2Bucket[]; failed: number }> {
  const tokenByAddress = new Map(tokens.map((token) => [token.address, token]));
  const calls = launches
    .filter((launch) => launch.modeId === 2)
    .flatMap((launch) => {
      const token = tokenByAddress.get(launch.project);
      return (token?.pools ?? []).flatMap((pool) =>
        Array.from({ length: settings.maxBucketEpoch }, (_, index) => ({
          launch,
          pool,
          epoch: index + 1,
        })),
      );
    });
  const rpcCalls = calls.map(({ launch, pool, epoch }) => ({
    method: "eth_call",
    params: [
      {
        to: launch.vault,
        data: `0x${BUYBACK_BUCKET_SELECTOR}${encodeUintWord(BigInt(epoch))}${encodeAddressWord(pool.quote.address)}`,
      },
      hexQuantity(observedBlock),
    ],
  }));
  let failed = 0;
  const chunks = Array.from({ length: Math.ceil(rpcCalls.length / 20) }, (_, index) =>
    rpcCalls.slice(index * 20, index * 20 + 20),
  );
  const chunkPayloads = await mapConcurrent(chunks, 2, async (chunk) => {
    if (rpc.batch) {
      try {
        return await rpc.batch<string>(chunk);
      } catch {
        // A failed JSON-RPC batch is retried only for its own chunk below.
      }
    }
    return mapConcurrent(chunk, 4, async (call) => {
      try {
        return await rpc.call<string>(call.method, call.params);
      } catch {
        failed += 1;
        return null;
      }
    });
  });
  const payloads = chunkPayloads.flat();
  const results = calls.map(({ launch, pool, epoch }, index) => {
    try {
      const result = payloads[index];
      if (result === null || result === undefined) return null;
      const raw = decodeUintWord(result.slice(2).padStart(64, "0"));
      if (raw === 0n) return null;
      const amount = decimalAmount(raw, pool.quote.decimals);
      return {
        releaseId: release.releaseId,
        project: launch.project,
        vault: launch.vault,
        epoch,
        asset: pool.quote.address,
        assetSymbol: pool.quote.symbol,
        decimals: pool.quote.decimals,
        amountRaw: raw.toString(),
        amount: Number.isFinite(amount) ? amount : 0,
        observedBlock,
        observedAt,
      } satisfies PairV2Bucket;
    } catch {
      failed += 1;
      return null;
    }
  });
  return { buckets: results.flatMap((value) => (value ? [value] : [])), failed };
}

export class PairV2Collector {
  private readonly fetchPage: (url: string) => Promise<FetchedJson>;
  private readonly rpc: PairV2Rpc;
  private readonly fetchHolder: (address: string) => Promise<HolderObservation>;
  private readonly now: () => Date;
  private readonly holderAttemptedAt = new Map<string, number>();

  constructor(
    private readonly settings: PairV2Settings,
    dependencies: PairV2CollectorDependencies = {},
  ) {
    this.fetchPage =
      dependencies.fetchPage ??
      ((url) => fetchJson(url, { retries: 1, timeoutMs: this.settings.requestTimeoutMs }));
    this.rpc = dependencies.rpc ?? new JsonRpcClient(settings);
    this.fetchHolder =
      dependencies.fetchHolder ?? ((address) => defaultHolderFetcher(this.settings, address));
    this.now = dependencies.now ?? (() => new Date());
  }

  async collect(context: PairV2CollectionContext): Promise<PairV2CollectionBatch> {
    const now = this.now();
    const observedAt = now.toISOString();
    const warnings: string[] = [];
    const sourceHealth: PairV2SourceHealth[] = [];
    let marketUpdatedAddresses: string[] = [];

    let release: PairV2Release;
    let tokens: PairV2MarketToken[];
    if (context.kind === "full") {
      const releaseStarted = performance.now();
      const releaseFetch = await this.fetchPage(this.settings.releaseAttestationUrl);
      release = parseRelease(releaseFetch.payload, this.settings, releaseFetch.fetchedAt);
      sourceHealth.push({
        id: PAIR_RELEASE_SOURCE,
        label: "PAIR 版本认证",
        status: release.canonical ? "ok" : "failed",
        fetchedAt: releaseFetch.fetchedAt,
        latencyMs: Math.round(performance.now() - releaseStarted),
        observed: release.canonical ? 1 : 0,
        expected: 1,
        message: release.canonical
          ? "releaseId 与 manifest 已匹配。"
          : "releaseId、manifest 或 ready 状态不匹配。",
      });
      if (!release.canonical) throw new Error("PAIR V2 release attestation is not canonical");

      const tokenFetch = await fetchAllPairTokens(this.settings, this.fetchPage);
      const cachedByAddress = new Map(context.cachedTokens.map((token) => [token.address, token]));
      tokens = selectAlphaMarketCandidates(
        tokenFetch.tokens.map((token) => {
          const cached = cachedByAddress.get(token.address);
          return cached?.shortWindow
            ? {
                ...token,
                shortWindow: cached.shortWindow,
                dexScreenerUrl: token.dexScreenerUrl ?? cached.dexScreenerUrl ?? null,
              }
            : token;
        }),
        this.settings,
        now,
      );
      sourceHealth.push({
        id: PAIR_TOKENS_SOURCE,
        label: "PAIR 官方代币接口",
        status: tokenFetch.rawCount >= tokenFetch.expected ? "ok" : "degraded",
        fetchedAt: tokenFetch.fetchedAt,
        latencyMs: tokenFetch.latencyMs,
        observed: tokenFetch.rawCount,
        expected: tokenFetch.expected,
        message: `完整翻页后识别 ${String(tokens.length)} 枚 PAIR 官方公开代币，其中 ${String(tokens.filter((token) => token.alphaMarketCandidate).length)} 枚进入短周期行情池。`,
      });

      const dexStartedAt = this.now().toISOString();
      try {
        const dex = await enrichWithDexScreener(tokens, this.settings, this.fetchPage);
        tokens = dex.tokens;
        marketUpdatedAddresses = dex.updatedAddresses;
        const dexStatus =
          dex.expectedTokens === 0
            ? "degraded"
            : dex.observedTokens === dex.expectedTokens
              ? "ok"
              : dex.observedTokens > 0
                ? "degraded"
                : "failed";
        if (dexStatus !== "ok") {
          warnings.push("部分 PAIR Alpha 候选缺少可匹配的官方 poolId 或 DexScreener 短周期行情。");
        }
        sourceHealth.push({
          id: DEXSCREENER_SOURCE,
          label: "DexScreener 官方池行情",
          status: dexStatus,
          fetchedAt: dex.fetchedAt,
          latencyMs: dex.latencyMs,
          observed: dex.observedTokens,
          expected: dex.expectedTokens,
          message: `${String(dex.observedTokens)}/${String(dex.expectedTokens)} 枚代币已匹配官方 poolId，并取得 5m/1h 量价与买卖笔数。`,
        });
      } catch (error) {
        warnings.push("DexScreener 短周期行情暂不可用。");
        sourceHealth.push({
          id: DEXSCREENER_SOURCE,
          label: "DexScreener 官方池行情",
          status: "failed",
          fetchedAt: dexStartedAt,
          latencyMs: Math.max(0, Math.round(this.now().valueOf() - Date.parse(dexStartedAt))),
          observed: 0,
          expected: tokens.filter((token) => token.pools.some((pool) => pool.poolId)).length,
          message: `短周期行情读取失败：${error instanceof Error ? error.name : "UnknownError"}。`,
        });
      }

      const holderCooldownMs = this.settings.holderRefreshMinutes * 60_000;
      const holderScope = tokens.filter((token) => token.alphaMarketCandidate);
      const holderTargets = holderScope
        .filter((token) => {
          if (token.holderCount !== null) return false;
          if (
            cachedHolderFresh(
              cachedByAddress.get(token.address),
              now,
              this.settings.holderRefreshMinutes,
            )
          ) {
            return false;
          }
          const lastAttempt = this.holderAttemptedAt.get(token.address);
          return lastAttempt === undefined || now.valueOf() - lastAttempt >= holderCooldownMs;
        })
        .sort(
          (left, right) =>
            (right.shortWindow?.volume5mUsd ?? -1) - (left.shortWindow?.volume5mUsd ?? -1) ||
            Date.parse(right.launchedAt ?? "") - Date.parse(left.launchedAt ?? ""),
        )
        .slice(0, this.settings.holderBatchSize);
      for (const token of holderTargets) this.holderAttemptedAt.set(token.address, now.valueOf());
      const holderStarted = performance.now();
      const holderResults = await mapConcurrent(holderTargets, 3, async (token) => {
        try {
          return { address: token.address, value: await this.fetchHolder(token.address) };
        } catch {
          return { address: token.address, value: null };
        }
      });
      const holderByAddress = new Map(
        holderResults.flatMap((item) => (item.value ? [[item.address, item.value]] : [])),
      );
      let usableHolders = 0;
      for (const token of holderScope) {
        const fetched = holderByAddress.get(token.address);
        const cached = cachedByAddress.get(token.address);
        if (fetched) {
          token.holderCount = fetched.count;
          token.holderObservedAt = fetched.observedAt;
          usableHolders += 1;
        } else if (token.holderCount !== null) {
          token.holderObservedAt = observedAt;
          usableHolders += 1;
        } else if (cachedHolderFresh(cached, now, this.settings.holderRefreshMinutes * 3)) {
          token.holderCount = cached?.holderCount ?? null;
          token.holderObservedAt = cached?.holderObservedAt ?? null;
          usableHolders += 1;
        }
      }
      const holderStatus =
        usableHolders === holderScope.length ? "ok" : usableHolders > 0 ? "degraded" : "failed";
      if (holderStatus !== "ok") warnings.push("部分 PAIR Alpha 候选持币地址数暂不可用。");
      sourceHealth.push({
        id: HOLDERS_SOURCE,
        label: "GMGN 持币地址",
        status: holderStatus,
        fetchedAt: observedAt,
        latencyMs: Math.round(performance.now() - holderStarted),
        observed: usableHolders,
        expected: holderScope.length,
        message: `${String(usableHolders)}/${String(holderScope.length)} 枚行情候选有可用持币地址数。`,
      });
    } else {
      if (!context.cachedRelease) throw new Error("PAIR V2 chain refresh has no cached release");
      release = context.cachedRelease;
      tokens = selectAlphaMarketCandidates(context.cachedTokens, this.settings, now);
      if (context.marketMode === "hot") {
        const dexStartedAt = this.now().toISOString();
        try {
          const dex = await enrichWithDexScreener(
            tokens,
            this.settings,
            this.fetchPage,
            selectHotMarketAddresses(tokens, this.settings.alphaHotCandidateLimit),
          );
          tokens = dex.tokens;
          marketUpdatedAddresses = dex.updatedAddresses;
          const dexStatus =
            dex.expectedTokens === 0
              ? "degraded"
              : dex.observedTokens === dex.expectedTokens
                ? "ok"
                : dex.observedTokens > 0
                  ? "degraded"
                  : "failed";
          if (dexStatus !== "ok") {
            warnings.push("热市场轮询只取得部分 PAIR Alpha 候选的短周期行情。");
          }
          sourceHealth.push({
            id: DEXSCREENER_SOURCE,
            label: "DexScreener 官方池行情",
            status: dexStatus,
            fetchedAt: dex.fetchedAt,
            latencyMs: dex.latencyMs,
            observed: dex.observedTokens,
            expected: dex.expectedTokens,
            message: `热市场轮询更新 ${String(dex.observedTokens)}/${String(dex.expectedTokens)} 枚候选。`,
          });
        } catch (error) {
          warnings.push("DexScreener 热市场轮询暂不可用。");
          sourceHealth.push({
            id: DEXSCREENER_SOURCE,
            label: "DexScreener 官方池行情",
            status: "failed",
            fetchedAt: dexStartedAt,
            latencyMs: Math.max(0, Math.round(this.now().valueOf() - Date.parse(dexStartedAt))),
            observed: 0,
            expected: tokens.filter(
              (token) =>
                token.alphaMarketCandidate &&
                token.pools.some((pool) => pool.poolId && pool.canonical !== false),
            ).length,
            message: `热市场轮询失败：${error instanceof Error ? error.name : "UnknownError"}。`,
          });
        }
      }
      sourceHealth.push(
        {
          id: PAIR_RELEASE_SOURCE,
          label: "PAIR 版本认证",
          status: "ok",
          fetchedAt: release.observedAt,
          latencyMs: 0,
          observed: 1,
          expected: 1,
          message: "链级轮询复用最近一次已匹配的 release。",
        },
        {
          id: PAIR_TOKENS_SOURCE,
          label: "PAIR 官方代币接口",
          status: tokens.length > 0 ? "ok" : "failed",
          fetchedAt: release.observedAt,
          latencyMs: 0,
          observed: tokens.length,
          expected: null,
          message:
            context.marketMode === "hot"
              ? "热市场轮询复用官方全量目录，只更新候选池行情。"
              : "链级轮询复用最近一次完整市场快照。",
        },
        {
          id: HOLDERS_SOURCE,
          label: "GMGN 持币地址",
          status: tokens.some((token) => token.holderCount !== null) ? "degraded" : "failed",
          fetchedAt: release.observedAt,
          latencyMs: 0,
          observed: tokens.filter(
            (token) => token.alphaMarketCandidate && token.holderCount !== null,
          ).length,
          expected: tokens.filter((token) => token.alphaMarketCandidate).length,
          message: "持币地址数在市场轮询时更新。",
        },
      );
      if (context.marketMode !== "hot") {
        const marketScope = tokens.filter((token) => token.alphaMarketCandidate);
        sourceHealth.push({
          id: DEXSCREENER_SOURCE,
          label: "DexScreener 官方池行情",
          status:
            marketScope.some((token) => token.shortWindow) ||
            !marketScope.some((token) => token.pools.some((pool) => pool.poolId))
              ? "degraded"
              : "failed",
          fetchedAt:
            marketScope.find((token) => token.shortWindow)?.shortWindow?.observedAt ??
            release.observedAt,
          latencyMs: 0,
          observed: marketScope.filter((token) => token.shortWindow).length,
          expected: marketScope.filter((token) => token.pools.some((pool) => pool.poolId)).length,
          message: "短周期量价由 15 秒热市场轮询更新。",
        });
      }
    }

    const rpcStarted = performance.now();
    const headHex = await this.rpc.call<string>("eth_blockNumber", []);
    const head = parseRpcQuantity(headHex, "eth_blockNumber");
    const latestBlock = Math.max(release.deploymentBlock, head - this.settings.logConfirmations);
    const scanFromBlock = Math.max(release.deploymentBlock, context.fromBlock);
    const fetchedLogs = await fetchLogs(
      this.rpc,
      scanFromBlock,
      latestBlock,
      this.settings.logChunkSize,
    );
    // Launches inside the overlap window are provisional until observed again.
    // Dropping them prevents an orphaned launch/vault from surviving a short reorg.
    const stableLaunches = context.cachedLaunches.filter(
      (launch) => launch.blockNumber < scanFromBlock,
    );
    const currentVaults = new Set(stableLaunches.map((launch) => launch.vault));
    for (const log of fetchedLogs) {
      if (
        log.address.toLowerCase() === release.addresses.coordinator &&
        log.topics[0]?.toLowerCase() === PAIR_V2_TOPICS.launch &&
        log.topics[3]
      ) {
        try {
          currentVaults.add(decodeTopicAddress(log.topics[3]));
        } catch {
          // The malformed launch is reported by the normal decoder below.
        }
      }
    }
    const logs = fetchedLogs.filter((log) => {
      const emitter = log.address.toLowerCase();
      const topic = log.topics[0]?.toLowerCase();
      if (topic === PAIR_V2_TOPICS.launch) return emitter === release.addresses.coordinator;
      if (topic === PAIR_V2_TOPICS.buyback) return emitter === release.addresses.buybackExecutor;
      if (topic === PAIR_V2_TOPICS.upgraded) return emitter === release.addresses.launchpad;
      return currentVaults.has(emitter);
    });
    const blockTimes = await blockTimesForLogs(this.rpc, logs);
    const newLaunches = logs.flatMap((log) => {
      try {
        const launch = launchFromLog(log, release, blockTimes, this.settings.chainId);
        return launch ? [launch] : [];
      } catch {
        warnings.push("存在无法解码的 V2 发行事件。");
        return [];
      }
    });
    const launchByProject = new Map(
      [...stableLaunches, ...newLaunches].map((launch) => [launch.project, launch]),
    );
    const launches = [...launchByProject.values()].sort(
      (left, right) => left.blockNumber - right.blockNumber || left.logIndex - right.logIndex,
    );
    const launchByVault = new Map(launches.map((launch) => [launch.vault, launch]));
    const poolByPosition = new Map(
      tokens.flatMap((token) =>
        token.pools.map((pool) => [pool.positionId, { project: token.address, pool }] as const),
      ),
    );
    const events = logs.flatMap((log) => {
      try {
        const event = chainEventFromLog(
          log,
          release,
          launchByVault,
          poolByPosition,
          blockTimes,
          this.settings.chainId,
        );
        return event ? [event] : [];
      } catch {
        warnings.push("存在无法解码的 V2 链上事件。");
        return [];
      }
    });

    let buckets: PairV2Bucket[] = [];
    let bucketFailures = 0;
    if (context.kind === "full") {
      const result = await readBuckets(
        this.rpc,
        release,
        launches,
        tokens,
        this.settings,
        observedAt,
        latestBlock,
      );
      buckets = result.buckets;
      bucketFailures = result.failed;
      if (bucketFailures > 0) warnings.push("部分回购桶余额读取失败。 ");
    }
    sourceHealth.push({
      id: RPC_SOURCE,
      label: "Robinhood Chain RPC",
      status: bucketFailures > 0 ? "degraded" : "ok",
      fetchedAt: observedAt,
      latencyMs: Math.round(performance.now() - rpcStarted),
      observed: events.length,
      expected: null,
      message: `已扫描至确认区块 ${String(latestBlock)}；本轮读取 ${String(events.length)} 条当前 release 事件。`,
    });

    return {
      kind: context.kind,
      observedAt,
      latestBlock,
      scanFromBlock,
      release,
      tokens,
      launches,
      events,
      buckets,
      sourceHealth,
      warnings: [...new Set(warnings.map((warning) => warning.trim()))],
      marketUpdatedAddresses,
    };
  }
}
