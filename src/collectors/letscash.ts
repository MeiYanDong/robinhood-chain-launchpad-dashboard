import { findRegisteredPlatform } from "../config/platforms.js";
import type {
  CollectionBatch,
  DailyMetric,
  MetricQuality,
  PlatformStat,
  PlatformStatPeriod,
  PlatformStatUnit,
} from "../domain/types.js";
import { fetchJson, finiteNumber, isRecord } from "../utils/http.js";
import { isDateOnOrBefore, parseLooseUtcDate } from "../utils/time.js";

export const LETSCASH_TOKENOMICS_URL = "https://api.letscash.fun/api/tokenomics?surface=current";
export const LETSCASH_DAILY_SOURCE = "letscash.officialTokenomics+defillama.historicalEthUsd";
export const DEFILLAMA_ETH_USD_SOURCE = "defillama.historicalEthUsd";
const ETH_PRICE_COIN = "coingecko:ethereum";
const PLATFORM_FEE_RATE = 0.003;
const DAY_MS = 86_400_000;

export interface LetsCashDailyEthRow {
  date: string;
  volEth: number;
  feesEth: number;
}

export interface LetsCashMetricExtraction {
  metrics: DailyMetric[];
  dailyRows: LetsCashDailyEthRow[];
  pricedDates: string[];
  missingPriceDates: string[];
  latestDataDate: string | null;
}

export function extractLetsCashDailyEthRows(
  payload: unknown,
  targetDate: string,
): LetsCashDailyEthRow[] {
  if (!isRecord(payload) || !Array.isArray(payload.daily)) {
    throw new Error("LetsCash tokenomics payload is missing daily rows");
  }

  const byDate = new Map<string, LetsCashDailyEthRow>();
  for (const candidate of payload.daily) {
    if (!isRecord(candidate)) continue;
    const date = parseLooseUtcDate(candidate.t);
    const volEth = finiteNumber(candidate.volEth);
    const feesEth = finiteNumber(candidate.feesEth);
    if (
      !date ||
      !isDateOnOrBefore(date, targetDate) ||
      volEth === null ||
      feesEth === null ||
      volEth < 0 ||
      feesEth < 0
    ) {
      continue;
    }
    byDate.set(date, { date, volEth, feesEth });
  }

  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function extractEthUsdByDate(payload: unknown): Map<string, number> {
  if (!isRecord(payload) || !isRecord(payload.coins)) {
    throw new Error("DefiLlama ETH price payload is missing coins");
  }
  const coin = payload.coins[ETH_PRICE_COIN];
  if (!isRecord(coin) || !Array.isArray(coin.prices)) {
    throw new Error("DefiLlama ETH price payload is missing daily prices");
  }

  const prices = new Map<string, number>();
  for (const candidate of coin.prices) {
    if (!isRecord(candidate)) continue;
    const timestamp = finiteNumber(candidate.timestamp);
    const milliseconds =
      timestamp === null ? Number.NaN : timestamp > 10_000_000_000 ? timestamp : timestamp * 1_000;
    // The price API can return the nearest observation at 23:59:59. Bucket
    // against the nearest UTC midnight instead of truncating it to yesterday.
    const date = Number.isFinite(milliseconds)
      ? new Date(Math.round(milliseconds / DAY_MS) * DAY_MS).toISOString().slice(0, 10)
      : null;
    const price = finiteNumber(candidate.price);
    if (!date || price === null || price <= 0) continue;
    prices.set(date, price);
  }
  return prices;
}

export function extractLetsCashMetrics(
  tokenomicsPayload: unknown,
  pricePayload: unknown,
  targetDate: string,
  collectedAt: string,
): LetsCashMetricExtraction {
  const dailyRows = extractLetsCashDailyEthRows(tokenomicsPayload, targetDate);
  const prices = extractEthUsdByDate(pricePayload);
  const metrics: DailyMetric[] = [];
  const pricedDates: string[] = [];
  const missingPriceDates: string[] = [];

  for (const row of dailyRows) {
    const ethUsd = prices.get(row.date);
    if (ethUsd === undefined) {
      missingPriceDates.push(row.date);
      continue;
    }
    pricedDates.push(row.date);
    const common = {
      platformId: "letscash",
      date: row.date,
      source: LETSCASH_DAILY_SOURCE,
      quality: "derived" as const,
      collectedAt,
    };
    metrics.push(
      {
        ...common,
        metric: "volume_usd",
        value: row.volEth * ethUsd,
        scope: "LetsCash official indexed daily ETH trading volume",
        derivation:
          "Official UTC-day volEth multiplied by the DefiLlama ETH/USD reference price at the UTC bucket boundary.",
      },
      {
        ...common,
        metric: "fees_usd",
        value: row.feesEth * ethUsd,
        scope: "LetsCash official indexed daily user fees",
        derivation:
          "Official UTC-day feesEth multiplied by the DefiLlama ETH/USD reference price at the UTC bucket boundary.",
      },
      {
        ...common,
        metric: "protocol_revenue_usd",
        value: row.volEth * PLATFORM_FEE_RATE * ethUsd,
        scope: "LetsCash platform-retained 0.3% trade fee",
        derivation:
          "Derived as official UTC-day volEth × 0.3% platform fee × the DefiLlama ETH/USD reference price; the API does not expose a direct daily platform-revenue series.",
      },
    );
  }

  return {
    metrics,
    dailyRows,
    pricedDates,
    missingPriceDates,
    latestDataDate: pricedDates.at(-1) ?? null,
  };
}

function nestedNumber(payload: Record<string, unknown>, group: string, key: string): number | null {
  const nested = payload[group];
  return isRecord(nested) ? finiteNumber(nested[key]) : null;
}

export function extractLetsCashStats(payload: unknown, collectedAt: string): PlatformStat[] {
  if (!isRecord(payload)) throw new Error("LetsCash tokenomics payload is not an object");
  const stats: PlatformStat[] = [];

  const add = (input: {
    key: string;
    label: string;
    value: number | null;
    unit: PlatformStatUnit;
    period: PlatformStatPeriod;
    quality?: MetricQuality;
    scope: string;
    derivation?: string;
  }): void => {
    if (input.value === null || input.value < 0) return;
    stats.push({
      platformId: "letscash",
      key: input.key,
      label: input.label,
      value: input.value,
      unit: input.unit,
      period: input.period,
      source: "letscash.officialTokenomics",
      quality: input.quality ?? "reported",
      scope: input.scope,
      derivation: input.derivation ?? null,
      collectedAt,
    });
  };

  const rollingVolume = nestedNumber(payload, "volumeEth", "day");
  add({
    key: "volume_rolling_24h_eth",
    label: "24H 成交量",
    value: rollingVolume,
    unit: "ETH",
    period: "rolling_24h",
    scope: "Rolling 24-hour official indexed volume",
  });
  add({
    key: "fees_rolling_24h_eth",
    label: "24H 总手续费",
    value: nestedNumber(payload, "feesEth", "day"),
    unit: "ETH",
    period: "rolling_24h",
    scope: "Rolling 24-hour official indexed user fees",
  });
  add({
    key: "platform_revenue_rolling_24h_eth",
    label: "24H 平台收入估算",
    value: rollingVolume === null ? null : rollingVolume * PLATFORM_FEE_RATE,
    unit: "ETH",
    period: "rolling_24h",
    quality: "derived",
    scope: "Rolling 24-hour platform-retained fee",
    derivation:
      "Official rolling volumeEth × 0.3%; no direct rolling platform-revenue field is exposed.",
  });
  add({
    key: "volume_all_time_eth",
    label: "累计成交量",
    value: nestedNumber(payload, "volumeEth", "allTime"),
    unit: "ETH",
    period: "all_time",
    scope: "All-time official indexed volume",
  });
  add({
    key: "fees_all_time_eth",
    label: "累计总手续费",
    value: nestedNumber(payload, "feesEth", "allTime"),
    unit: "ETH",
    period: "all_time",
    scope: "All-time official indexed user fees",
  });
  add({
    key: "platform_revenue_all_time_eth",
    label: "累计平台收入",
    value: finiteNumber(payload.platformEth),
    unit: "ETH",
    period: "all_time",
    scope: "All-time platform share reported directly by LetsCash",
  });
  add({
    key: "creator_revenue_all_time_eth",
    label: "累计创作者收入",
    value: finiteNumber(payload.creatorsEth),
    unit: "ETH",
    period: "all_time",
    scope: "All-time creator share reported directly by LetsCash",
  });
  add({
    key: "trades_all_time",
    label: "累计交易数",
    value: finiteNumber(payload.trades),
    unit: "count",
    period: "all_time",
    scope: "All-time trades reported by the LetsCash indexer",
  });
  add({
    key: "traders_all_time",
    label: "累计交易者",
    value: finiteNumber(payload.traders),
    unit: "count",
    period: "all_time",
    scope: "All-time unique traders reported by the LetsCash indexer",
  });
  add({
    key: "tokens_launched_all_time",
    label: "累计发射代币",
    value: finiteNumber(payload.tokensLaunched),
    unit: "count",
    period: "all_time",
    scope: "All-time launches reported by the LetsCash indexer",
  });

  return stats;
}

function ethPriceChartUrl(rows: LetsCashDailyEthRow[]): string {
  const first = rows[0];
  const last = rows.at(-1);
  if (!first || !last) throw new Error("Cannot request ETH prices without LetsCash daily rows");
  const start = Date.parse(`${first.date}T00:00:00.000Z`) / 1_000;
  const end = Date.parse(`${last.date}T00:00:00.000Z`);
  const span = Math.floor((end - start * 1_000) / 86_400_000) + 1;
  const url = new URL(`https://coins.llama.fi/chart/${ETH_PRICE_COIN}`);
  url.searchParams.set("start", String(start));
  url.searchParams.set("span", String(span));
  url.searchParams.set("period", "1d");
  url.searchParams.set("searchWidth", "12h");
  return url.toString();
}

export async function collectLetsCash(targetDate: string): Promise<CollectionBatch> {
  const platform = findRegisteredPlatform("LetsCash");
  if (!platform) throw new Error("LetsCash registry entry is missing");

  let tokenomics: Awaited<ReturnType<typeof fetchJson>>;
  try {
    tokenomics = await fetchJson(LETSCASH_TOKENOMICS_URL, { timeoutMs: 20_000, retries: 1 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fetchedAt = new Date().toISOString();
    return {
      platforms: [platform],
      metrics: [],
      stats: [],
      sourceHealth: [
        {
          source: "letscash.officialTokenomics",
          status: "failed",
          fetchedAt,
          latestDataDate: null,
          latencyMs: 0,
          message,
        },
      ],
      raw: [],
      warnings: [`letscash.officialTokenomics failed: ${message}`],
    };
  }

  let dailyRows: LetsCashDailyEthRow[] = [];
  let stats: PlatformStat[] = [];
  try {
    dailyRows = extractLetsCashDailyEthRows(tokenomics.payload, targetDate);
    stats = extractLetsCashStats(tokenomics.payload, tokenomics.fetchedAt);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      platforms: [platform],
      metrics: [],
      stats: [],
      sourceHealth: [
        {
          source: "letscash.officialTokenomics",
          status: "failed",
          fetchedAt: tokenomics.fetchedAt,
          latestDataDate: null,
          latencyMs: tokenomics.latencyMs,
          message,
        },
      ],
      raw: [
        {
          source: "letscash.officialTokenomics",
          fetchedAt: tokenomics.fetchedAt,
          sha256: tokenomics.sha256,
          payload: tokenomics.payload,
        },
      ],
      warnings: [`letscash.officialTokenomics parse failed: ${message}`],
    };
  }

  const sourceHealth: CollectionBatch["sourceHealth"] = [
    {
      source: "letscash.officialTokenomics",
      status: dailyRows.length > 0 && stats.length > 0 ? "ok" : "degraded",
      fetchedAt: tokenomics.fetchedAt,
      latestDataDate: dailyRows.at(-1)?.date ?? null,
      latencyMs: tokenomics.latencyMs,
      message: `${dailyRows.length} closed UTC daily ETH rows and ${stats.length} live/cumulative stats parsed`,
    },
  ];
  const raw: CollectionBatch["raw"] = [
    {
      source: "letscash.officialTokenomics",
      fetchedAt: tokenomics.fetchedAt,
      sha256: tokenomics.sha256,
      payload: tokenomics.payload,
    },
  ];
  const warnings: string[] = [];
  let metrics: DailyMetric[] = [];

  if (dailyRows.length === 0) {
    warnings.push("LetsCash official tokenomics returned no closed UTC daily rows.");
  } else {
    try {
      const prices = await fetchJson(ethPriceChartUrl(dailyRows), {
        timeoutMs: 20_000,
        retries: 1,
      });
      const extracted = extractLetsCashMetrics(
        tokenomics.payload,
        prices.payload,
        targetDate,
        tokenomics.fetchedAt > prices.fetchedAt ? tokenomics.fetchedAt : prices.fetchedAt,
      );
      metrics = extracted.metrics;
      sourceHealth.push({
        source: DEFILLAMA_ETH_USD_SOURCE,
        status: extracted.missingPriceDates.length === 0 ? "ok" : "degraded",
        fetchedAt: prices.fetchedAt,
        latestDataDate: extracted.latestDataDate,
        latencyMs: prices.latencyMs,
        message: `${extracted.pricedDates.length}/${extracted.dailyRows.length} LetsCash UTC days received an ETH/USD reference price`,
      });
      raw.push({
        source: DEFILLAMA_ETH_USD_SOURCE,
        fetchedAt: prices.fetchedAt,
        sha256: prices.sha256,
        payload: prices.payload,
      });
      if (extracted.missingPriceDates.length > 0) {
        warnings.push(
          `LetsCash daily USD conversion missing ETH prices for: ${extracted.missingPriceDates.join(", ")}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sourceHealth.push({
        source: DEFILLAMA_ETH_USD_SOURCE,
        status: "failed",
        fetchedAt: new Date().toISOString(),
        latestDataDate: null,
        latencyMs: 0,
        message,
      });
      warnings.push(`${DEFILLAMA_ETH_USD_SOURCE} failed: ${message}`);
    }
  }

  return {
    platforms: [platform],
    metrics,
    stats,
    sourceHealth,
    raw,
    warnings,
  };
}
