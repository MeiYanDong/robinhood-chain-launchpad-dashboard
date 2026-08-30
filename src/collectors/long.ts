import { createHash } from "node:crypto";
import { withSession, type Session } from "wreq-js";
import { findRegisteredPlatform, metricPolicyFor } from "../config/platforms.js";
import type {
  CollectionBatch,
  DailyMetric,
  PlatformStat,
  RawObservation,
  SourceHealth,
} from "../domain/types.js";
import { finiteNumber, isRecord } from "../utils/http.js";

export const LONG_GRAPHQL_URL = "https://api.long.xyz/v1/graphql";
export const LONG_APP_URL = "https://app.long.xyz/";
export const LONG_INTEGRATOR_ADDRESS = "0x92d435c96e63c43e12d6d0ab28f6b0b04072f765";
export const LONG_DAILY_SOURCE = "long.officialGraphql.hourlyVolume";
export const LONG_ROLLING_SOURCE = "long.officialGraphql.rollingPools";

const ROBINHOOD_CHAIN_ID = 4663;
const PAGE_SIZE = 1_000;
const MAX_PAGES = 100;
const ASSET_CHUNK_SIZE = 400;
const USD_SCALE = 10n ** 18n;

export interface LongHourRow {
  poolId: string;
  tokenAddress: string;
  hourTimestamp: number;
  volumeUsdScaled: string;
  swapCount: number;
}

interface LongRollingRow {
  volumeUsdScaled: string;
  swapCount: number;
}

export interface LongDailySummary {
  volumeUsd: number;
  swapCount: number;
  activeTokenCount: number;
  hourlyRowCount: number;
  matchedRows: LongHourRow[];
}

function dateHourBounds(targetDate: string): { startHour: number; endHour: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    throw new Error(`Invalid Long target date: ${targetDate}`);
  }
  const startMs = Date.parse(`${targetDate}T00:00:00.000Z`);
  if (!Number.isFinite(startMs)) throw new Error(`Invalid Long target date: ${targetDate}`);
  const startHour = Math.floor(startMs / 3_600_000);
  return { startHour, endHour: startHour + 24 };
}

function nonNegativeIntegerString(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  return value;
}

function graphqlRows(payload: unknown, field: string): unknown[] {
  if (!isRecord(payload) || !isRecord(payload.data) || !Array.isArray(payload.data[field])) {
    throw new Error(`Long GraphQL response is missing data.${field}`);
  }
  return payload.data[field];
}

export function extractLongHourRows(
  payload: unknown,
  startHour: number,
  endHour: number,
): LongHourRow[] {
  const rows: LongHourRow[] = [];
  for (const candidate of graphqlRows(payload, "PoolVolumeHour")) {
    if (!isRecord(candidate)) continue;
    const poolId = typeof candidate.pool_id === "string" ? candidate.pool_id : "";
    const addressMatch = poolId.match(/^4663-(0x[a-f0-9]{40})$/i);
    const tokenAddress = addressMatch?.[1]?.toLowerCase();
    const hourTimestamp = finiteNumber(candidate.hour_timestamp);
    const volumeUsdScaled = nonNegativeIntegerString(candidate.volume_usd);
    const swapCount = finiteNumber(candidate.swap_count);
    if (
      !tokenAddress ||
      hourTimestamp === null ||
      !Number.isInteger(hourTimestamp) ||
      hourTimestamp < startHour ||
      hourTimestamp >= endHour ||
      volumeUsdScaled === null ||
      swapCount === null ||
      !Number.isInteger(swapCount) ||
      swapCount < 0
    ) {
      continue;
    }
    rows.push({
      poolId,
      tokenAddress,
      hourTimestamp,
      volumeUsdScaled,
      swapCount,
    });
  }
  return rows;
}

export function extractLongAssetAddresses(payload: unknown): string[] {
  const addresses: string[] = [];
  for (const candidate of graphqlRows(payload, "Asset")) {
    if (!isRecord(candidate) || typeof candidate.asset_address !== "string") continue;
    const address = candidate.asset_address.toLowerCase();
    if (/^0x[a-f0-9]{40}$/.test(address)) addresses.push(address);
  }
  return addresses;
}

function extractLongRollingRows(payload: unknown): LongRollingRow[] {
  const rows: LongRollingRow[] = [];
  for (const candidate of graphqlRows(payload, "AuctionPool")) {
    if (!isRecord(candidate)) continue;
    const volumeUsdScaled = nonNegativeIntegerString(candidate.pool_volume_24h_usd);
    const swapCount = finiteNumber(candidate.pool_volume_24h_swap_count);
    if (
      volumeUsdScaled === null ||
      swapCount === null ||
      !Number.isInteger(swapCount) ||
      swapCount < 0
    ) {
      continue;
    }
    rows.push({ volumeUsdScaled, swapCount });
  }
  return rows;
}

function scaledUsd(value: bigint): number {
  const whole = value / USD_SCALE;
  const fractional = value % USD_SCALE;
  return Number(whole) + Number(fractional) / Number(USD_SCALE);
}

export function summarizeLongDaily(
  rows: LongHourRow[],
  longAssetAddresses: Iterable<string>,
): LongDailySummary {
  const longAssets = new Set(
    [...longAssetAddresses]
      .map((address) => address.toLowerCase())
      .filter((address) => /^0x[a-f0-9]{40}$/.test(address)),
  );
  const matchedRows = rows.filter((row) => longAssets.has(row.tokenAddress));
  let volumeUsdScaled = 0n;
  let swapCount = 0;
  const activeTokens = new Set<string>();
  for (const row of matchedRows) {
    volumeUsdScaled += BigInt(row.volumeUsdScaled);
    swapCount += row.swapCount;
    activeTokens.add(row.tokenAddress);
  }
  return {
    volumeUsd: scaledUsd(volumeUsdScaled),
    swapCount,
    activeTokenCount: activeTokens.size,
    hourlyRowCount: matchedRows.length,
    matchedRows,
  };
}

async function graphqlRequest(session: Session, query: string): Promise<unknown> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await session.fetch(LONG_GRAPHQL_URL, {
        method: "POST",
        timeout: 30_000,
        headers: {
          accept: "application/graphql-response+json, application/json",
          "content-type": "application/json",
          origin: LONG_APP_URL.slice(0, -1),
          referer: LONG_APP_URL,
        },
        body: JSON.stringify({ query }),
      });
      const body = await response.text();
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const payload: unknown = JSON.parse(body);
      if (isRecord(payload) && Array.isArray(payload.errors) && payload.errors.length > 0) {
        const messages = payload.errors
          .filter(isRecord)
          .map((error) => error.message)
          .filter((message): message is string => typeof message === "string");
        throw new Error(messages.join("; ") || "Long GraphQL returned errors");
      }
      return payload;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`Long GraphQL request failed: ${lastError?.message ?? "unknown error"}`);
}

async function fetchAllHourRows(
  session: Session,
  startHour: number,
  endHour: number,
): Promise<LongHourRow[]> {
  const rows: LongHourRow[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const offset = page * PAGE_SIZE;
    const payload = await graphqlRequest(
      session,
      `{ PoolVolumeHour(` +
        `where:{hour_timestamp:{_gte:${startHour},_lt:${endHour}}},` +
        `order_by:{id:asc},limit:${PAGE_SIZE},offset:${offset}` +
        `){pool_id hour_timestamp volume_usd swap_count} }`,
    );
    const pageRows = extractLongHourRows(payload, startHour, endHour);
    const rawLength = graphqlRows(payload, "PoolVolumeHour").length;
    rows.push(...pageRows);
    if (rawLength < PAGE_SIZE) return rows;
  }
  throw new Error(`Long hourly volume exceeded the ${MAX_PAGES * PAGE_SIZE} row safety cap`);
}

async function fetchLongMembership(session: Session, addresses: string[]): Promise<Set<string>> {
  const longAssets = new Set<string>();
  for (let index = 0; index < addresses.length; index += ASSET_CHUNK_SIZE) {
    const chunk = addresses.slice(index, index + ASSET_CHUNK_SIZE);
    const addressList = chunk.map((address) => JSON.stringify(address)).join(",");
    const payload = await graphqlRequest(
      session,
      `{ Asset(` +
        `where:{chain_id:{_eq:${ROBINHOOD_CHAIN_ID}},` +
        `integrator_address:{_ilike:${JSON.stringify(LONG_INTEGRATOR_ADDRESS)}},` +
        `asset_address:{_in:[${addressList}]}},limit:${PAGE_SIZE}` +
        `){asset_address} }`,
    );
    for (const address of extractLongAssetAddresses(payload)) longAssets.add(address);
  }
  return longAssets;
}

async function fetchRollingRows(session: Session): Promise<LongRollingRow[]> {
  const rows: LongRollingRow[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const offset = page * PAGE_SIZE;
    const payload = await graphqlRequest(
      session,
      `{ AuctionPool(` +
        `where:{chain_id:{_eq:${ROBINHOOD_CHAIN_ID}},` +
        `integrator_address:{_ilike:${JSON.stringify(LONG_INTEGRATOR_ADDRESS)}},` +
        `pool_volume_24h_usd:{_gt:"0"}},` +
        `order_by:{id:asc},limit:${PAGE_SIZE},offset:${offset}` +
        `){pool_volume_24h_usd pool_volume_24h_swap_count} }`,
    );
    const rawLength = graphqlRows(payload, "AuctionPool").length;
    rows.push(...extractLongRollingRows(payload));
    if (rawLength < PAGE_SIZE) return rows;
  }
  throw new Error(`Long rolling pools exceeded the ${MAX_PAGES * PAGE_SIZE} row safety cap`);
}

function longStats(rows: LongRollingRow[], collectedAt: string): PlatformStat[] {
  let volumeUsdScaled = 0n;
  let swapCount = 0;
  for (const row of rows) {
    volumeUsdScaled += BigInt(row.volumeUsdScaled);
    swapCount += row.swapCount;
  }
  const common = {
    platformId: "long",
    source: LONG_ROLLING_SOURCE,
    quality: "reported" as const,
    period: "rolling_24h" as const,
    collectedAt,
    derivation: null,
  };
  return [
    {
      ...common,
      key: "volume_rolling_24h_usd",
      label: "24H 成交量",
      value: scaledUsd(volumeUsdScaled),
      unit: "USD",
      scope: "Official Long rolling 24-hour USD pool volume",
    },
    {
      ...common,
      key: "trades_rolling_24h",
      label: "24H 交易笔数",
      value: swapCount,
      unit: "count",
      scope: "Official Long rolling 24-hour swap count",
    },
    {
      ...common,
      key: "active_tokens_rolling_24h",
      label: "24H 活跃代币",
      value: rows.length,
      unit: "count",
      scope: "Long pools with non-zero official rolling 24-hour volume",
    },
  ];
}

function rawObservation(source: string, fetchedAt: string, payload: unknown): RawObservation {
  const serialized = JSON.stringify(payload);
  return {
    source,
    fetchedAt,
    sha256: createHash("sha256").update(serialized).digest("hex"),
    payload,
  };
}

function failedBatch(message: string): CollectionBatch {
  const platform = findRegisteredPlatform("Long");
  const fetchedAt = new Date().toISOString();
  return {
    platforms: platform ? [platform] : [],
    metrics: [],
    stats: [],
    sourceHealth: [
      {
        source: LONG_DAILY_SOURCE,
        status: "failed",
        fetchedAt,
        latestDataDate: null,
        latencyMs: 0,
        message,
      },
    ],
    raw: [],
    warnings: [`${LONG_DAILY_SOURCE} failed: ${message}`],
  };
}

export async function collectLong(targetDate: string): Promise<CollectionBatch> {
  const platform = findRegisteredPlatform("Long");
  if (!platform) return failedBatch("Long registry entry is missing");
  const started = performance.now();

  try {
    return await withSession(
      async (session) => {
        const { startHour, endHour } = dateHourBounds(targetDate);
        const allHourRows = await fetchAllHourRows(session, startHour, endHour);
        const activeAddresses = [...new Set(allHourRows.map((row) => row.tokenAddress))];
        const longAssets = await fetchLongMembership(session, activeAddresses);
        const daily = summarizeLongDaily(allHourRows, longAssets);
        const fetchedAt = new Date().toISOString();
        const policy = metricPolicyFor(platform, "volume_usd");
        const metric: DailyMetric = {
          platformId: platform.id,
          metric: "volume_usd",
          date: targetDate,
          value: daily.volumeUsd,
          source: LONG_DAILY_SOURCE,
          quality: policy.quality,
          scope: policy.scope,
          derivation: policy.note ?? null,
          collectedAt: fetchedAt,
        };
        const sourceHealth: SourceHealth[] = [
          {
            source: LONG_DAILY_SOURCE,
            status: "ok",
            fetchedAt,
            latestDataDate: targetDate,
            latencyMs: Math.round(performance.now() - started),
            message:
              `${daily.activeTokenCount} active Long assets, ${daily.swapCount} swaps, ` +
              `${daily.hourlyRowCount} matched hourly observations`,
          },
        ];
        const raw: RawObservation[] = [
          rawObservation(LONG_DAILY_SOURCE, fetchedAt, {
            targetDate,
            startHour,
            endHour,
            allHourRowCount: allHourRows.length,
            activeAddressCount: activeAddresses.length,
            longAssetCount: longAssets.size,
            matchedRows: daily.matchedRows,
          }),
        ];
        const warnings: string[] = [];
        let stats: PlatformStat[] = [];

        try {
          const rollingRows = await fetchRollingRows(session);
          const rollingFetchedAt = new Date().toISOString();
          stats = longStats(rollingRows, rollingFetchedAt);
          sourceHealth.push({
            source: LONG_ROLLING_SOURCE,
            status: "ok",
            fetchedAt: rollingFetchedAt,
            latestDataDate: null,
            latencyMs: Math.round(performance.now() - started),
            message: `${rollingRows.length} Long pools with non-zero rolling 24-hour volume`,
          });
          raw.push(
            rawObservation(LONG_ROLLING_SOURCE, rollingFetchedAt, {
              activePoolCount: rollingRows.length,
              stats,
            }),
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          sourceHealth.push({
            source: LONG_ROLLING_SOURCE,
            status: "failed",
            fetchedAt: new Date().toISOString(),
            latestDataDate: null,
            latencyMs: Math.round(performance.now() - started),
            message,
          });
          warnings.push(`${LONG_ROLLING_SOURCE} failed: ${message}`);
        }

        return {
          platforms: [platform],
          metrics: [metric],
          stats,
          sourceHealth,
          raw,
          warnings,
        };
      },
      {
        browser: "chrome",
        os: "macos",
        timeout: 30_000,
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failedBatch(message);
  }
}
