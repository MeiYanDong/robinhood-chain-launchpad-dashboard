import { assessDailyMetrics, usableDailyMetric } from "../domain/data-quality.js";
import type { DailyMetric, MetricName } from "../domain/types.js";
import type { LongLeaderboardResponse } from "../long-tokens/types.js";
import type { PairLeaderboardResponse, PairRankingEntry } from "../pair/types.js";
import { lastClosedUtcDate, shiftUtcDate } from "../utils/time.js";
import type { EconomicsSettings } from "./config.js";
import type { EconomicsCollector } from "./collector.js";
import type { EconomicsDatabase } from "./database.js";
import { aggregateValuationDaily } from "./history.js";
import type {
  BuybackPolicy,
  BuybackSummaryRow,
  EconomicsCollectionBatch,
  EconomicsPlatformId,
  EconomicsResponse,
  EconomicsSourceHealth,
  EvidenceQuality,
  EvidenceValue,
  PairRelativeValuationHistoryResponse,
  PlatformEconomicsRow,
  ProtocolTokenMarketObservation,
  TokenEconomicsRow,
  TokenDailyCandle,
  TokenSupplyObservation,
} from "./types.js";
import {
  buildPairRelativeValuation,
  invalidateStalePairRelativeValuation,
  refreshPairRelativeValuationFreshness,
} from "./valuation.js";

const ECONOMICS_PLATFORMS = ["pons", "long", "pair"] as const;
const PONS_DOCS_URL = "https://docs.ponsfamily.com/";
const PAIR_BUYBACK_SOURCE_URL =
  "https://www.blockprism.org/press-release/pair-launches-the-first-multipool-rwa-launchpad-on-robinhood-chain-pairing-new-tokens-with-baskets-of-tokenized-stocks-partners-with-aws-to-scale-its-infrastructure-833/";

export interface EconomicsDashboardProvider {
  metricsForPlatforms(
    startDate: string,
    endDate: string,
    platformIds: readonly string[],
  ): DailyMetric[];
  refresh(): Promise<unknown>;
}

export interface EconomicsPairProvider {
  rankings(): PairLeaderboardResponse;
  refresh(): Promise<unknown>;
}

export interface EconomicsLongProvider {
  rankings(): LongLeaderboardResponse;
  refresh(): Promise<unknown>;
}

export interface EconomicsServiceDependencies {
  dashboard: EconomicsDashboardProvider;
  pair: EconomicsPairProvider;
  long: EconomicsLongProvider;
  collect?: EconomicsCollector["collect"];
  collectPonsPriceHistory?: EconomicsCollector["collectPonsPriceHistory"];
  now?: () => Date;
  warn?: (event: string, context: Record<string, unknown>) => void;
}

function unknownValue(note: string): EvidenceValue {
  return {
    value: null,
    state: "unknown",
    quality: "unknown",
    source: null,
    asOf: null,
    note,
  };
}

function notApplicable(note: string): EvidenceValue {
  return {
    value: null,
    state: "not_applicable",
    quality: "not_applicable",
    source: null,
    asOf: null,
    note,
  };
}

function value(input: {
  value: number;
  state?: "observed" | "derived";
  quality: EvidenceQuality;
  source: string;
  asOf: string;
  note?: string;
}): EvidenceValue {
  return {
    value: input.value,
    state: input.state ?? "observed",
    quality: input.quality,
    source: input.source,
    asOf: input.asOf,
    note: input.note ?? null,
  };
}

function metricEvidenceQuality(metric: DailyMetric): EvidenceQuality {
  if (metric.quality === "scope_mismatch" || metric.quality === "suite_wide") {
    return "scope_mismatch";
  }
  if (metric.quality === "unknown") return "unknown";
  if (
    metric.source.startsWith("pair.officialStats") ||
    metric.source.startsWith("pons.officialAnalytics") ||
    metric.source.startsWith("long.officialGraphql")
  ) {
    return "official";
  }
  return "third_party";
}

function dailyMetricValue(metric: DailyMetric | null, missingNote: string): EvidenceValue {
  if (!metric) return { ...unknownValue(missingNote), validation: "missing" };
  if (!usableDailyMetric(metric))
    return {
      ...unknownValue("来源数值待核验，暂不参与份额或估值。"),
      source: metric.source,
      asOf: metric.collectedAt,
      dataDate: metric.date,
      rawValue: metric.value,
      validation: "suspect",
    };
  return value({
    value: metric.value,
    state: metric.quality === "derived" ? "derived" : "observed",
    quality: metricEvidenceQuality(metric),
    source: metric.source,
    asOf: metric.collectedAt,
    note: `${metric.scope}${metric.derivation ? ` · ${metric.derivation}` : ""}`,
  });
}

function findMetric(
  metrics: DailyMetric[],
  platformId: EconomicsPlatformId,
  metric: MetricName,
  date: string,
): DailyMetric | null {
  return (
    metrics.find(
      (candidate) =>
        candidate.platformId === platformId &&
        candidate.metric === metric &&
        candidate.date === date,
    ) ?? null
  );
}

function latestComparisonDate(metrics: DailyMetric[], fallback: string): string {
  const datesFor = (platformId: EconomicsPlatformId) =>
    new Set(
      metrics
        .filter((metric) => metric.platformId === platformId && metric.metric === "volume_usd")
        .map((metric) => metric.date),
    );
  const datesByPlatform = ECONOMICS_PLATFORMS.map(datesFor);
  const common = [...(datesByPlatform[0] ?? new Set<string>())]
    .filter((date) => datesByPlatform.every((dates) => dates.has(date)))
    .sort()
    .reverse();
  if (common[0]) return common[0];
  const available = datesByPlatform
    .flatMap((dates) => [...dates])
    .sort()
    .reverse();
  return available[0] ?? fallback;
}

function rankingEntry(
  response: PairLeaderboardResponse | LongLeaderboardResponse,
  metric: keyof typeof response.rankings,
  address: string,
): PairRankingEntry | null {
  return (
    response.rankings[metric].entries.find(
      (entry) => entry.address.toLowerCase() === address.toLowerCase(),
    ) ?? null
  );
}

function marketQuality(market: ProtocolTokenMarketObservation): EvidenceQuality {
  return market.quality === "official" ? "official" : "third_party";
}

function protocolTokenRow(input: {
  platformId: "pons" | "pair";
  platformName: string;
  address: string;
  fallbackName: string;
  fallbackSymbol: string;
  fallbackUrl: string;
  market: ProtocolTokenMarketObservation | null;
  supply: TokenSupplyObservation | null;
  holderOverride: PairRankingEntry | null;
}): TokenEconomicsRow {
  const market = input.market;
  const supply = input.supply;
  const identity = market ?? {
    name: input.fallbackName,
    symbol: input.fallbackSymbol,
    tokenUrl: input.fallbackUrl,
    observedAt: null,
  };
  const marketCap =
    market?.marketCapUsd !== null && market?.marketCapUsd !== undefined
      ? value({
          value: market.marketCapUsd,
          state: market.quality === "derived" ? "derived" : "observed",
          quality: marketQuality(market),
          source: market.source,
          asOf: market.observedAt,
          note:
            market.quality === "derived"
              ? "由市场价格乘数据源供应量计算。"
              : "数据源报告的标准市值。",
        })
      : unknownValue("当前市场来源没有可用市值。 ");
  const burnAdjusted =
      market?.priceUsd !== null && market?.priceUsd !== undefined && supply
        ? value({
            value: market.priceUsd * (supply.totalSupply - supply.burnedSupply),
            state: "derived",
            quality: marketQuality(market),
            source: `${market.source}+robinhood.rpc.tokenSupply`,
            asOf: supply.observedAt,
            note: "价格 ×（链上 totalSupply − 销毁地址余额）。",
          })
        : unknownValue("缺少价格或链上销毁余额，无法计算销毁调整市值。"),
    holder = input.holderOverride?.value ?? market?.holderCount ?? null;
  const holderSource = input.holderOverride ? "token-radar.holderCount" : market?.source;

  return {
    platformId: input.platformId,
    platformName: input.platformName,
    role: "protocol_token",
    address: input.address,
    name: identity.name,
    symbol: identity.symbol,
    tokenUrl: identity.tokenUrl,
    observedAt: identity.observedAt,
    priceUsd:
      market?.priceUsd !== null && market?.priceUsd !== undefined
        ? value({
            value: market.priceUsd,
            quality: marketQuality(market),
            source: market.source,
            asOf: market.observedAt,
            note: "市场数据源直接报告的当前美元价格。",
          })
        : unknownValue("当前市场来源没有可用价格。"),
    marketCapUsd: marketCap,
    burnAdjustedMarketCapUsd: burnAdjusted,
    liquidityUsd:
      market?.liquidityUsd !== null && market?.liquidityUsd !== undefined
        ? value({
            value: market.liquidityUsd,
            quality: marketQuality(market),
            source: market.source,
            asOf: market.observedAt,
          })
        : unknownValue("当前市场来源没有可用流动性。"),
    volume24hUsd:
      market?.volume24hUsd !== null && market?.volume24hUsd !== undefined
        ? value({
            value: market.volume24hUsd,
            quality: marketQuality(market),
            source: market.source,
            asOf: market.observedAt,
          })
        : unknownValue("当前市场来源没有可用 24H 成交量。"),
    holderCount:
      holder !== null
        ? value({
            value: holder,
            quality: "third_party",
            source: holderSource ?? "unknown",
            asOf: input.holderOverride?.observedAt ?? market?.observedAt ?? "",
            note: "持币地址数，不等于去重后的真实人数。",
          })
        : unknownValue("当前没有可用持币地址观测。"),
    totalSupply: supply
      ? value({
          value: supply.totalSupply,
          quality: "onchain",
          source: "robinhood.rpc.tokenSupply",
          asOf: supply.observedAt,
        })
      : unknownValue("链上供应量读取失败。"),
    burnedSupply: supply
      ? value({
          value: supply.burnedSupply,
          quality: "onchain",
          source: "robinhood.rpc.tokenSupply",
          asOf: supply.observedAt,
          note: "销毁地址累计余额；不自动等同于协议回购。",
        })
      : unknownValue("链上销毁地址余额读取失败。"),
    burnedPercent: supply
      ? value({
          value: supply.totalSupply === 0 ? 0 : (supply.burnedSupply / supply.totalSupply) * 100,
          state: "derived",
          quality: "onchain",
          source: "robinhood.rpc.tokenSupply",
          asOf: supply.observedAt,
        })
      : unknownValue("链上供应量读取失败。"),
  };
}

function longLeaderRow(response: LongLeaderboardResponse): TokenEconomicsRow {
  const leader = response.snapshot?.stale
    ? null
    : (response.rankings.market_cap_usd.entries[0] ?? null);
  if (!leader) {
    const missing = unknownValue("当前没有通过 LongLauncher 归属验证的市值龙头。 ");
    return {
      platformId: "long",
      platformName: "Long",
      role: "dynamic_market_cap_leader",
      address: "",
      name: "龙头未识别",
      symbol: "—",
      tokenUrl: "https://app.long.xyz/tokens",
      observedAt: null,
      priceUsd: missing,
      marketCapUsd: missing,
      burnAdjustedMarketCapUsd: notApplicable("Long 展示动态龙头，不适用平台币销毁调整。"),
      liquidityUsd: unknownValue("当前没有可用流动性。"),
      volume24hUsd: unknownValue("当前没有可用 24H 成交量。"),
      holderCount: unknownValue("当前没有可用持币地址观测。"),
      totalSupply: notApplicable("Long 展示动态龙头，不作为平台币供应量比较。"),
      burnedSupply: notApplicable("Long 展示动态龙头，不作为平台币销毁量比较。"),
      burnedPercent: notApplicable("Long 展示动态龙头，不作为平台币销毁比例比较。"),
    };
  }
  const metric = (name: "liquidity_depth_usd" | "volume_24h_usd" | "holder_count") =>
    rankingEntry(response, name, leader.address);
  const observed = (entry: PairRankingEntry | null, missingNote: string) =>
    entry
      ? value({
          value: entry.value,
          quality: "third_party",
          source: "gmgn.marketRank.longxyz+long.launcherEvents",
          asOf: entry.observedAt,
        })
      : unknownValue(missingNote);
  return {
    platformId: "long",
    platformName: "Long",
    role: "dynamic_market_cap_leader",
    address: leader.address,
    name: leader.name,
    symbol: leader.symbol,
    tokenUrl: leader.tokenUrl,
    observedAt: leader.observedAt,
    priceUsd:
      leader.priceUsd !== null
        ? value({
            value: leader.priceUsd,
            quality: "third_party",
            source: "gmgn.marketRank.longxyz+long.launcherEvents",
            asOf: leader.observedAt,
            note: "GMGN Long 活跃代币榜直接报告的当前美元价格。",
          })
        : unknownValue("当前没有可用价格。"),
    marketCapUsd: observed(leader, "当前没有可用市值。"),
    burnAdjustedMarketCapUsd: notApplicable("Long 展示动态龙头，不适用平台币销毁调整。"),
    liquidityUsd: observed(metric("liquidity_depth_usd"), "该龙头未进入流动性 Top 5。"),
    volume24hUsd: observed(metric("volume_24h_usd"), "该龙头未进入成交量 Top 5。"),
    holderCount: observed(metric("holder_count"), "该龙头未进入持币地址 Top 5。"),
    totalSupply: notApplicable("Long 展示动态龙头，不作为平台币供应量比较。"),
    burnedSupply: notApplicable("Long 展示动态龙头，不作为平台币销毁量比较。"),
    burnedPercent: notApplicable("Long 展示动态龙头，不作为平台币销毁比例比较。"),
  };
}

function policy(platformId: EconomicsPlatformId): BuybackPolicy {
  if (platformId === "pons") {
    return {
      applies: true,
      percentage: 80,
      basis: "协议手续费中的政策分配比例",
      evidence: "documented",
      sourceUrl: PONS_DOCS_URL,
    };
  }
  if (platformId === "pair") {
    return {
      applies: true,
      percentage: 90,
      basis: "协议手续费中的公开声明分配比例",
      evidence: "announced",
      sourceUrl: PAIR_BUYBACK_SOURCE_URL,
    };
  }
  return {
    applies: false,
    percentage: null,
    basis: "Long 没有回购机制",
    evidence: "not_applicable",
    sourceUrl: null,
  };
}

function platformName(platformId: EconomicsPlatformId): string {
  return platformId === "pons" ? "Pons" : platformId === "pair" ? "PAIR" : "Long";
}

function platformRow(
  platformId: EconomicsPlatformId,
  date: string,
  metrics: DailyMetric[],
): PlatformEconomicsRow {
  const volumeMetric = findMetric(metrics, platformId, "volume_usd", date);
  const feeMetric = findMetric(metrics, platformId, "fees_usd", date);
  const revenueMetric = findMetric(metrics, platformId, "protocol_revenue_usd", date);
  const buybackPolicy = policy(platformId);
  const protocolRevenue = dailyMetricValue(revenueMetric, "当前没有同范围的闭合日协议收入。");
  const buybackBudget =
      buybackPolicy.applies && buybackPolicy.percentage !== null && protocolRevenue.value !== null
        ? value({
            value: protocolRevenue.value * (buybackPolicy.percentage / 100),
            state: "derived",
            quality: protocolRevenue.quality,
            source: `${protocolRevenue.source ?? "unknown"}+buyback-policy`,
            asOf: protocolRevenue.asOf ?? date,
            note: "理论政策预算，不代表已经执行的回购。",
          })
        : buybackPolicy.applies
          ? unknownValue("缺少同日协议收入，无法计算理论回购预算。")
          : notApplicable("Long 没有回购机制。"),
    executed = buybackPolicy.applies
      ? unknownValue("尚无资金来源、Swap 与销毁完整闭环的逐笔证据。")
      : notApplicable("Long 没有回购机制。"),
    retained = buybackPolicy.applies
      ? unknownValue("实际回购支出未知，不能计算回购后留存。")
      : protocolRevenue.value !== null
        ? unknownValue("无回购不代表协议收入等于留存或利润。")
        : unknownValue("协议收入和运营支出均未知。"),
    netProfit = unknownValue("缺少完整运营成本、市场支出、工资与税费，净利润不可计算。 ");

  return {
    platformId,
    platformName: platformName(platformId),
    date,
    volumeUsd: dailyMetricValue(volumeMetric, "当前没有闭合日平台成交量。"),
    threePlatformSharePercent: unknownValue("三平台同日成交量未齐，份额未计算。"),
    userFeesUsd: dailyMetricValue(feeMetric, "当前没有同范围的用户手续费。"),
    protocolRevenueAccruedUsd: protocolRevenue,
    protocolRevenueReceivedUsd: unknownValue("上游没有拆分应计分配与金库实收。"),
    buybackPolicy,
    policyBuybackBudgetUsd: buybackBudget,
    executedBuybackUsd: executed,
    retainedAfterBuybackUsd: retained,
    netProfitUsd: netProfit,
  };
}

function applyMarketShares(rows: PlatformEconomicsRow[]): {
  ready: boolean;
  denominator: number | null;
} {
  if (rows.some((row) => row.volumeUsd.value === null)) return { ready: false, denominator: null };
  const denominator = rows.reduce((sum, row) => sum + (row.volumeUsd.value ?? 0), 0);
  if (!(denominator > 0)) return { ready: false, denominator: null };
  for (const row of rows) {
    row.threePlatformSharePercent = value({
      value: ((row.volumeUsd.value ?? 0) / denominator) * 100,
      state: "derived",
      quality: rows.some((candidate) => candidate.volumeUsd.quality === "scope_mismatch")
        ? "scope_mismatch"
        : "official",
      source: "pons+long+pair.closedUtcDayVolume",
      asOf: row.date,
      note: "本平台闭合日成交量 ÷ Pons、Long、PAIR 同日成交量合计。",
    });
  }
  return { ready: true, denominator };
}

function buybackRows(
  platforms: PlatformEconomicsRow[],
  tokens: TokenEconomicsRow[],
): BuybackSummaryRow[] {
  return platforms.map((platform) => {
    const token = tokens.find((candidate) => candidate.platformId === platform.platformId);
    if (!platform.buybackPolicy.applies) {
      return {
        platformId: platform.platformId,
        platformName: platform.platformName,
        policy: platform.buybackPolicy,
        cumulativeBurnedTokens: notApplicable("Long 没有回购机制。"),
        cumulativeBurnedPercent: notApplicable("Long 没有回购机制。"),
        dailyExecutedSpendUsd: notApplicable("Long 没有回购机制。"),
        dailyExecutedTokens: notApplicable("Long 没有回购机制。"),
        lastVerifiedTransaction: null,
        proofStatus: "not_applicable",
        note: "Long 回购列固定显示不适用，不显示为 0。",
      };
    }
    return {
      platformId: platform.platformId,
      platformName: platform.platformName,
      policy: platform.buybackPolicy,
      cumulativeBurnedTokens: token?.burnedSupply ?? unknownValue("链上累计销毁量暂不可用。"),
      cumulativeBurnedPercent: token?.burnedPercent ?? unknownValue("链上累计销毁比例暂不可用。"),
      dailyExecutedSpendUsd: platform.executedBuybackUsd,
      dailyExecutedTokens: unknownValue("尚未取得逐笔回购输出代币证据。"),
      lastVerifiedTransaction: null,
      proofStatus: "policy_and_cumulative_burn_only",
      note:
        platform.platformId === "pons"
          ? "仅统计 PONS 协议币回购；不混入 Pons V2 创作者份额回购与五年锁仓。"
          : "累计销毁余额不自动等同于由协议手续费执行的 PAIR 回购。",
    };
  });
}

function platformSource(
  platformId: EconomicsPlatformId,
  row: PlatformEconomicsRow,
  generatedAt: string,
): EconomicsSourceHealth {
  const urls: Record<EconomicsPlatformId, string> = {
    pons: "https://www.ponsfamily.com/analytics",
    pair: "https://pair.fund/stats",
    long: "https://app.long.xyz/",
  };
  return {
    source: row.volumeUsd.source ?? `${platformId}.closedDayVolume`,
    label: `${row.platformName} 闭合日成交量`,
    status: row.volumeUsd.value === null ? "degraded" : "ok",
    fetchedAt: row.volumeUsd.asOf ?? generatedAt,
    message: row.volumeUsd.value === null ? "当前闭合日数据不可用。" : `${row.date} 数据可用。`,
    url: urls[platformId],
  };
}

export class EconomicsService {
  private refreshPromise: Promise<EconomicsResponse> | null = null;
  private readonly collect: EconomicsCollector["collect"];
  private readonly collectPonsPriceHistory: EconomicsCollector["collectPonsPriceHistory"];
  private readonly now: () => Date;
  private readonly warn: (event: string, context: Record<string, unknown>) => void;

  constructor(
    private readonly database: EconomicsDatabase,
    private readonly settings: EconomicsSettings,
    private readonly providers: Pick<EconomicsServiceDependencies, "dashboard" | "pair" | "long">,
    collector: EconomicsCollector,
    dependencies: Omit<EconomicsServiceDependencies, "dashboard" | "pair" | "long"> = {},
  ) {
    this.collect = dependencies.collect ?? collector.collect.bind(collector);
    this.collectPonsPriceHistory =
      dependencies.collectPonsPriceHistory ?? collector.collectPonsPriceHistory.bind(collector);
    this.now = dependencies.now ?? (() => new Date());
    this.warn = dependencies.warn ?? ((event, context) => console.warn(event, context));
  }

  async ensureFresh(): Promise<void> {
    const latest = this.database.latest();
    const observedAt = latest ? Date.parse(latest.observedAt) : Number.NaN;
    if (
      Number.isFinite(observedAt) &&
      latest?.payload.pairRelativeValuation !== undefined &&
      this.now().valueOf() - observedAt < this.settings.refreshTtlMinutes * 60_000
    ) {
      return;
    }
    try {
      await this.refresh();
    } catch (error) {
      if (!latest) throw error;
      this.warn("economics_refresh_failed_using_cache", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  refresh(): Promise<EconomicsResponse> {
    if (this.refreshPromise) return this.refreshPromise;
    const pending = this.refreshNow().finally(() => {
      this.refreshPromise = null;
    });
    this.refreshPromise = pending;
    return pending;
  }

  async refreshAll(): Promise<EconomicsResponse> {
    await Promise.allSettled([
      this.providers.dashboard.refresh(),
      this.providers.pair.refresh(),
      this.providers.long.refresh(),
    ]);
    return this.refresh();
  }

  private async refreshNow(): Promise<EconomicsResponse> {
    const now = this.now();
    // GMGN applies an IP-wide rate limit. Keep spot and K-line reads serial,
    // while the hourly K-line cache prevents redundant history requests.
    const batch = await this.collect();
    const priceHistoryHealth = await this.refreshPonsPriceHistory(now);
    const response = this.buildResponse({
      ...batch,
      sourceHealth: [...batch.sourceHealth, priceHistoryHealth],
      warnings:
        priceHistoryHealth.status === "ok"
          ? batch.warnings
          : [...batch.warnings, "gmgn.ponsPriceHistory_unavailable"],
    });
    this.database.save(response);
    return response;
  }

  private async refreshPonsPriceHistory(now: Date): Promise<EconomicsSourceHealth> {
    const source = "gmgn.ponsPriceHistory";
    const label = "GMGN PONS 日线";
    const url = this.settings.ponsTokenUrl;
    const cachedAt = this.database.tokenDailyCandlesFetchedAt(this.settings.ponsTokenAddress);
    const cachedAge = cachedAt ? now.valueOf() - Date.parse(cachedAt) : Number.POSITIVE_INFINITY;
    if (
      cachedAt &&
      Number.isFinite(cachedAge) &&
      cachedAge >= -60_000 &&
      cachedAge < this.settings.priceHistoryTtlMinutes * 60_000
    ) {
      return {
        source,
        label,
        status: "ok",
        fetchedAt: cachedAt,
        message: "小时级日线缓存可用。",
        url,
      };
    }
    try {
      const result = await this.collectPonsPriceHistory();
      this.database.upsertTokenDailyCandles(this.settings.ponsTokenAddress, result.value);
      return {
        source,
        label,
        status: "ok",
        fetchedAt: result.fetchedAt,
        message: `${result.value.length} 个日线价格点可用。`,
        url,
      };
    } catch (error) {
      const cached = this.database.tokenDailyCandles(this.settings.ponsTokenAddress, 1);
      this.warn("pons_price_history_refresh_failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
        cached: cached.length > 0,
      });
      return {
        source,
        label,
        status: cached.length > 0 ? "degraded" : "failed",
        fetchedAt: cachedAt ?? now.toISOString(),
        message: cached.length > 0 ? "刷新失败，继续使用已保存日线。" : "日线暂不可用。",
        url,
      };
    }
  }

  private buildResponse(batch: EconomicsCollectionBatch): EconomicsResponse {
    const now = this.now();
    const generatedAt = now.toISOString();
    const lastClosed = lastClosedUtcDate(now);
    const metrics = assessDailyMetrics(
      this.providers.dashboard.metricsForPlatforms(
        shiftUtcDate(lastClosed, -120),
        lastClosed,
        ECONOMICS_PLATFORMS,
      ),
    );
    const targetDate = latestComparisonDate(metrics, lastClosed);
    const pairRankings = this.providers.pair.rankings();
    const longRankings = this.providers.long.rankings();
    const marketByPlatform = new Map(
      batch.tokenMarkets.map((market) => [market.platformId, market]),
    );
    const supplyByAddress = new Map(
      batch.tokenSupplies.map((supply) => [supply.address.toLowerCase(), supply]),
    );
    const pairHolder = rankingEntry(pairRankings, "holder_count", this.settings.pairTokenAddress);
    const tokens = [
      protocolTokenRow({
        platformId: "pons",
        platformName: "Pons",
        address: this.settings.ponsTokenAddress,
        fallbackName: "Pons",
        fallbackSymbol: "PONS",
        fallbackUrl: this.settings.ponsTokenUrl,
        market: marketByPlatform.get("pons") ?? null,
        supply: supplyByAddress.get(this.settings.ponsTokenAddress) ?? null,
        holderOverride: null,
      }),
      longLeaderRow(longRankings),
      protocolTokenRow({
        platformId: "pair",
        platformName: "PAIR",
        address: this.settings.pairTokenAddress,
        fallbackName: "PAIR",
        fallbackSymbol: "PAIR",
        fallbackUrl: this.settings.pairTokenUrl,
        market: marketByPlatform.get("pair") ?? null,
        supply: supplyByAddress.get(this.settings.pairTokenAddress) ?? null,
        holderOverride: pairHolder,
      }),
    ];
    const platforms = ECONOMICS_PLATFORMS.map((platformId) =>
      platformRow(platformId, targetDate, metrics),
    );
    const share = applyMarketShares(platforms);
    const pairRelativeValuation = buildPairRelativeValuation({
      now,
      observedAt: batch.observedAt,
      metrics,
      ponsToken: tokens.find((token) => token.platformId === "pons") ?? null,
      pairToken: tokens.find((token) => token.platformId === "pair") ?? null,
      ponsPolicy: policy("pons"),
      pairPolicy: policy("pair"),
    });
    const sourceHealth = [
      ...batch.sourceHealth,
      ...platforms.map((platform) => platformSource(platform.platformId, platform, generatedAt)),
    ];
    const lagging = targetDate !== lastClosed;
    const status =
      sourceHealth.some((source) => source.status !== "ok") || !share.ready || lagging
        ? "partial"
        : "success";
    const warnings = [
      ...(lagging ? [`闭合日来源最新共同日期为 ${targetDate}。`] : []),
      ...(!share.ready ? ["三平台同日成交量未齐，市场份额暂不计算。"] : []),
      ...platforms
        .filter((row) => row.volumeUsd.validation === "suspect")
        .map((row) => `${row.platformName} 成交量原值待核验，已停止使用。`),
      ...(batch.warnings.length > 0 ? ["部分代币或链上来源暂不可用。"] : []),
    ];
    return {
      service: "rhc-launchpad-economics",
      generatedAt,
      observedAt: batch.observedAt,
      targetDate,
      status,
      stale: false,
      dataQuality: {
        snapshotFresh: true,
        platformDataComplete: share.ready && !lagging,
        valuationReady: pairRelativeValuation.state === "available",
        issues: [
          ...platforms
            .filter((row) => row.volumeUsd.value === null)
            .map((row) => `${row.platformId}:${row.volumeUsd.validation ?? "missing"}`),
          ...(lagging ? ["closed_day_lagging"] : []),
          ...pairRelativeValuation.reasons
            .filter((reason) => reason.severity === "blocking")
            .map((reason) => reason.code),
        ],
      },
      shareDefinition: "pons_long_pair_closed_utc_day",
      shareReady: share.ready,
      shareDenominatorUsd: share.denominator,
      tokens,
      platforms,
      buybacks: buybackRows(platforms, tokens),
      pairRelativeValuation,
      sources: sourceHealth,
      warnings,
    };
  }

  snapshot(): EconomicsResponse | null {
    const latest = this.database.latest();
    if (!latest) return null;
    const now = this.now();
    const stale =
      now.valueOf() - Date.parse(latest.observedAt) >= this.settings.staleAfterMinutes * 60_000;
    const storedValuation = latest.payload.pairRelativeValuation;
    const valuation =
      storedValuation ??
      buildPairRelativeValuation({
        now,
        observedAt: latest.observedAt,
        metrics: [],
        ponsToken: null,
        pairToken: null,
        ponsPolicy: policy("pons"),
        pairPolicy: policy("pair"),
      });
    const freshValuation = refreshPairRelativeValuationFreshness(valuation, now);
    return {
      ...latest.payload,
      tokens: latest.payload.tokens.map((token) => {
        const result = { ...token };
        for (const field of [
          "priceUsd",
          "marketCapUsd",
          "burnAdjustedMarketCapUsd",
          "liquidityUsd",
          "volume24hUsd",
          "holderCount",
          "totalSupply",
          "burnedSupply",
          "burnedPercent",
        ] as const) {
          const evidence = token[field];
          if (evidence.value === null) continue;
          const age = now.valueOf() - Date.parse(evidence.asOf ?? "");
          const limit = field === "holderCount" ? 150 : 30;
          result[field] =
            !Number.isFinite(age) || age < -60_000 || age >= limit * 60_000
              ? {
                  ...evidence,
                  value: null,
                  rawValue: evidence.value,
                  state: "unknown",
                  validation: "stale",
                  note: "该指标观测已过期，历史原值不作为当前值。",
                }
              : { ...evidence, validation: "usable" };
        }
        return result;
      }),
      generatedAt: now.toISOString(),
      stale,
      dataQuality: {
        platformDataComplete: false,
        issues: [],
        ...latest.payload.dataQuality,
        snapshotFresh: !stale,
        valuationReady: !stale && freshValuation.state === "available",
      },
      status: stale ? "partial" : latest.payload.status,
      pairRelativeValuation: stale
        ? invalidateStalePairRelativeValuation(freshValuation)
        : freshValuation,
      warnings: stale
        ? [...latest.payload.warnings, "三强对比快照已超过预期更新时间。"]
        : latest.payload.warnings,
    };
  }

  valuation() {
    return this.snapshot()?.pairRelativeValuation ?? null;
  }

  valuationHistory(): PairRelativeValuationHistoryResponse {
    const now = this.now();
    const endDate = now.toISOString().slice(0, 10);
    const startDate = shiftUtcDate(endDate, -6);
    const points = this.database.valuationHistory(`${startDate}T00:00:00.000Z`);
    return {
      service: "rhc-launchpad-economics",
      generatedAt: now.toISOString(),
      window: "7d",
      points,
      daily: aggregateValuationDaily({
        points,
        ponsCandles: this.ponsPriceHistory(),
        startDate,
        endDate,
      }),
    };
  }

  ponsPriceHistory(): TokenDailyCandle[] {
    return this.database.tokenDailyCandles(
      this.settings.ponsTokenAddress,
      Math.ceil(this.settings.priceHistoryDays),
    );
  }

  sources() {
    const snapshot = this.snapshot();
    return {
      generatedAt: this.now().toISOString(),
      targetDate: snapshot?.targetDate ?? null,
      definitions: {
        source_market_cap: "代币市场来源报告或由该来源价格与供应量计算的市值。",
        burn_adjusted_market_cap: "价格 ×（链上总供应量 − 销毁地址累计余额）。",
        user_fees: "用户支付的交易毛手续费；Gas 和发射费不混入。",
        protocol_revenue: "归属于协议的收入；应计分配与金库实收分列。",
        policy_buyback_budget: "按公开政策比例计算的理论预算，不是实际回购。",
        executed_buyback: "只接受资金来源、Swap 与销毁或锁仓完整闭环的逐笔证据。",
        net_profit: "协议收入减回购、分配、运营成本及税费；成本未知时保持未知。",
        pair_relative_valuation:
          "PONS 当前价格 × 有效供应量比 × 最近 7 个共同闭合 UTC 日的平台成交量比。",
        valuation_range: "逐日同公式结果的第 25 至第 75 百分位，不是价格承诺。",
        valuation_deviation: "（PAIR 实际价格 ÷ 相对估值中心 − 1）× 100%。",
        policy_scenario: "在其它条件不变时，将公开手续费分配比例 80% 与 90% 单独换算。",
      },
      caveats: [
        "市场份额只在 Pons、Long、PAIR 三个平台同一闭合 UTC 日成交量齐全时计算。",
        "销毁地址余额证明累计销毁，不自动证明协议使用手续费执行了回购。",
        "Pons V2 创作者份额回购与五年锁仓不计入 PONS 协议币回购。",
        "Long 没有回购机制，因此显示不适用而不是 0。",
        "相对估值至少需要 5 个共同闭合日；缺失日不补 0，PAIR 实际价格不参与估值中心。",
        "政策比例只进入独立情景值；实际回购未形成逐笔闭环前，不作为估值中心输入。",
      ],
      sources: snapshot?.sources ?? [],
    };
  }

  health() {
    const snapshot = this.snapshot();
    return {
      ok: Boolean(snapshot),
      service: "rhc-launchpad-economics",
      targetDate: snapshot?.targetDate ?? null,
      status: snapshot?.status ?? "empty",
      stale: snapshot?.stale ?? true,
      generatedAt: this.now().toISOString(),
      observedAt: snapshot?.observedAt ?? null,
      dataQuality: snapshot?.dataQuality ?? null,
    };
  }
}
