import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { collectLongAssetMembership, type LongAssetMembershipResult } from "../collectors/long.js";
import type { PairTokenSnapshot } from "../pair/types.js";
import { finiteNumber, isRecord } from "../utils/http.js";
import type { LongTokenSettings } from "./config.js";
import type { LongCollectionBatch } from "./types.js";

const execFileAsync = promisify(execFile);
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const GMGN_SOURCE = "gmgn.marketRank.longxyz";
const MEMBERSHIP_SOURCE = "long.officialGraphql.assetMembership";

interface RankFetchResult {
  payload: unknown;
  fetchedAt: string;
  latencyMs: number;
}

export interface LongCollectorDependencies {
  fetchRank?: () => Promise<RankFetchResult>;
  fetchMembership?: (addresses: string[]) => Promise<LongAssetMembershipResult>;
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

function nonNegativeInteger(value: unknown): number | null {
  const parsed = nonNegativeNumber(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function timestamp(value: unknown): string | null {
  let parsed: number;
  if (typeof value === "number") parsed = value < 10_000_000_000 ? value * 1_000 : value;
  else if (typeof value === "string" && value.trim() !== "") {
    const numeric = Number(value);
    parsed = Number.isFinite(numeric)
      ? numeric < 10_000_000_000
        ? numeric * 1_000
        : numeric
      : Date.parse(value);
  } else return null;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function eligibilityReason(
  snapshot: PairTokenSnapshot,
  settings: LongTokenSettings,
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
  return null;
}

function normalizeToken(
  value: unknown,
  observedAt: string,
  settings: LongTokenSettings,
): PairTokenSnapshot | null {
  if (
    !isRecord(value) ||
    value.launchpad_platform !== "longxyz" ||
    typeof value.address !== "string" ||
    !ADDRESS_PATTERN.test(value.address)
  ) {
    return null;
  }
  const address = value.address.toLowerCase();
  const symbol = boundedString(value.symbol, address.slice(2, 8).toUpperCase(), 24);
  const holderCount = nonNegativeInteger(value.holder_count);
  const snapshot: PairTokenSnapshot = {
    address,
    name: boundedString(value.name, symbol, 96),
    symbol,
    tokenUrl: `https://app.long.xyz/tokens/${address}`,
    launchedAt: timestamp(value.creation_timestamp) ?? timestamp(value.open_timestamp),
    graduated: String(value.launchpad_status ?? "") === "1",
    observedAt,
    priceUsd: nonNegativeNumber(value.price),
    marketCapUsd: nonNegativeNumber(value.market_cap),
    liquidityDepthUsd: nonNegativeNumber(value.liquidity),
    volume24hUsd: nonNegativeNumber(value.volume),
    holderCount,
    holderObservedAt: holderCount === null ? null : observedAt,
    holderSource: holderCount === null ? null : GMGN_SOURCE,
    eligible: false,
    eligibilityReason: null,
    marketDataSource: GMGN_SOURCE,
    marketDataUpdatedAt: observedAt,
  };
  snapshot.eligibilityReason = eligibilityReason(snapshot, settings);
  snapshot.eligible = snapshot.eligibilityReason === null;
  return snapshot;
}

function parseRankRows(payload: unknown): unknown[] {
  if (!isRecord(payload)) throw new Error("GMGN Long ranking returned an invalid response");
  const code = finiteNumber(payload.code);
  if (code !== null && code !== 0) throw new Error("GMGN Long ranking returned a business error");
  const data = isRecord(payload.data) ? payload.data : payload;
  if (!Array.isArray(data.rank)) throw new Error("GMGN Long ranking did not include rank rows");
  return data.rank;
}

async function defaultRankFetcher(settings: LongTokenSettings): Promise<RankFetchResult> {
  const started = performance.now();
  const inheritedNodeOptions = process.env.NODE_OPTIONS ?? "";
  const nodeOptions = inheritedNodeOptions.includes("--use-system-ca")
    ? inheritedNodeOptions
    : `${inheritedNodeOptions} --use-system-ca`.trim();
  const { stdout } = await execFileAsync(
    settings.gmgnBinary,
    [
      "market",
      "trending",
      "--chain",
      "robinhood",
      "--interval",
      "24h",
      "--limit",
      "100",
      "--platform",
      "longxyz",
      "--order-by",
      "volume",
      "--direction",
      "desc",
      "--raw",
    ],
    {
      timeout: settings.gmgnTimeoutMs,
      maxBuffer: 5 * 1_024 * 1_024,
      env: { ...process.env, NODE_OPTIONS: nodeOptions },
    },
  );
  return {
    payload: JSON.parse(stdout) as unknown,
    fetchedAt: new Date().toISOString(),
    latencyMs: Math.round(performance.now() - started),
  };
}

export class LongTokenCollector {
  private readonly fetchRank: () => Promise<RankFetchResult>;
  private readonly fetchMembership: (addresses: string[]) => Promise<LongAssetMembershipResult>;
  private readonly now: () => Date;

  constructor(
    private readonly settings: LongTokenSettings,
    dependencies: LongCollectorDependencies = {},
  ) {
    this.fetchRank = dependencies.fetchRank ?? (() => defaultRankFetcher(this.settings));
    this.fetchMembership = dependencies.fetchMembership ?? collectLongAssetMembership;
    this.now = dependencies.now ?? (() => new Date());
  }

  async collect(_verifiedCache: Set<string>): Promise<LongCollectionBatch> {
    const observedAt = this.now().toISOString();
    const rankFetch = await this.fetchRank();
    const rows = parseRankRows(rankFetch.payload);
    const tokens: PairTokenSnapshot[] = [];
    const addresses = new Set<string>();
    let invalidRows = 0;
    for (const row of rows) {
      const token = normalizeToken(row, observedAt, this.settings);
      if (!token) {
        invalidRows += 1;
        continue;
      }
      if (addresses.has(token.address))
        throw new Error("GMGN Long ranking returned a duplicate token");
      addresses.add(token.address);
      tokens.push(token);
    }
    if (tokens.length === 0) throw new Error("GMGN Long ranking returned no valid tokens");
    tokens.sort((left, right) => left.address.localeCompare(right.address));

    const verificationStarted = performance.now();
    const membership = await this.fetchMembership(tokens.map((token) => token.address));
    const requested = new Set(tokens.map((token) => token.address));
    const verifiedAddresses = new Set(
      [...membership.addresses]
        .map((address) => address.toLowerCase())
        .filter((address) => requested.has(address)),
    );
    const verifiedTokens = tokens.filter((token) => verifiedAddresses.has(token.address));
    if (verifiedTokens.length === 0) {
      throw new Error("Long official index returned no matching active tokens");
    }

    const warnings: string[] = [];
    if (invalidRows > 0) warnings.push("long_invalid_rows_skipped");
    if (rows.length >= 100) warnings.push("long_active_sample_capped");
    if (verifiedTokens.length < tokens.length) warnings.push("long_unverified_rows_skipped");
    const eligibleCount = verifiedTokens.filter((token) => token.eligible).length;
    return {
      observedAt,
      tokens: verifiedTokens,
      universeCount: verifiedTokens.length,
      eligibleCount,
      verifiedMembership: [],
      warnings,
      sourceHealth: [
        {
          source: GMGN_SOURCE,
          status: "ok",
          fetchedAt: rankFetch.fetchedAt,
          latencyMs: rankFetch.latencyMs,
          message: `${tokens.length} active Long token records normalized from the market rank.`,
        },
        {
          source: MEMBERSHIP_SOURCE,
          status: "ok",
          fetchedAt: membership.fetchedAt,
          latencyMs: membership.latencyMs || Math.round(performance.now() - verificationStarted),
          message:
            `${verifiedTokens.length}/${tokens.length} active records match the official ` +
            "Long integrator index.",
        },
      ],
    };
  }
}
