import type { EvidenceQuality, ValueState } from "../economics/types.js";
import type { PairFlowCollector } from "./collector.js";
import type { PairFlowSettings } from "./config.js";
import type { PairFlowDatabase } from "./database.js";
import { buildPairFlowEvents, pairFlowCandidateTransactionHashes } from "./events.js";
import { buildPairFlowLedger, type PairFlowLedgerSummary } from "./ledger.js";
import type {
  PairFlowCollectionBatch,
  PairFlowEvidenceTier,
  PairFlowEventsQuery,
  PairFlowEventsResponse,
  PairFlowResponse,
  PairTransactionDetail,
  PairFlowUnit,
  PairFlowValue,
} from "./types.js";

export interface PairFlowServiceDependencies {
  collect?: PairFlowCollector["collect"];
  fetchTransactionDetails?: PairFlowCollector["fetchTransactionDetails"];
  now?: () => Date;
  warn?: (event: string, context: Record<string, unknown>) => void;
}

function evidence(input: {
  value: number;
  unit: PairFlowUnit;
  state?: Exclude<ValueState, "unknown" | "not_applicable">;
  quality: EvidenceQuality;
  tier: PairFlowEvidenceTier;
  source: string;
  asOf: string;
  note?: string;
}): PairFlowValue {
  return {
    value: input.value,
    unit: input.unit,
    state: input.state ?? "observed",
    quality: input.quality,
    tier: input.tier,
    source: input.source,
    asOf: input.asOf,
    note: input.note ?? null,
  };
}

function unknown(unit: PairFlowUnit, note: string): PairFlowValue {
  return {
    value: null,
    unit,
    state: "unknown",
    quality: "unknown",
    tier: "unknown",
    source: null,
    asOf: null,
    note,
  };
}

function chinaWindow(now: Date): PairFlowResponse["window"] {
  const chinaOffsetMs = 8 * 60 * 60_000;
  const calendarDate = new Date(now.valueOf() + chinaOffsetMs).toISOString().slice(0, 10);
  const utcMidnight = Date.parse(`${calendarDate}T00:00:00.000Z`);
  return {
    timezone: "Asia/Shanghai",
    calendarDate,
    calendarStartAt: new Date(utcMidnight - chinaOffsetMs).toISOString(),
    rollingStartAt: new Date(now.valueOf() - 24 * 60 * 60_000).toISOString(),
  };
}

function allKnown(values: Array<number | null | undefined>): values is number[] {
  return values.every((value) => value !== null && value !== undefined && Number.isFinite(value));
}

function sumKnown(values: Array<number | null | undefined>): number | null {
  return allKnown(values) ? values.reduce((sum, value) => sum + value, 0) : null;
}

function historyEvidence(
  historyComplete: boolean,
  value: number,
  unit: PairFlowUnit,
  asOf: string,
  note: string,
  tier: PairFlowEvidenceTier = "confirmed",
): PairFlowValue {
  return historyComplete
    ? evidence({
        value,
        unit,
        quality: "third_party",
        tier,
        source: "rh-scan.addressTransfers",
        asOf,
        note,
      })
    : unknown(unit, `${note} 历史分页未完整覆盖，暂不报部分和。`);
}

function pressureState(value: number | null): PairFlowResponse["pressure"]["state"] {
  if (value === null || !Number.isFinite(value)) return "unknown";
  if (value >= 2) return "high";
  if (value >= 0.5) return "moderate";
  return "low";
}

function walletValue(record: Record<string, number | null>, address: string): number | null {
  return record[address] ?? record[address.toLowerCase()] ?? null;
}

export class PairFlowService {
  private refreshPromise: Promise<PairFlowResponse> | null = null;
  private readonly collect: PairFlowCollector["collect"];
  private readonly fetchTransactionDetails: PairFlowCollector["fetchTransactionDetails"];
  private readonly now: () => Date;
  private readonly warn: (event: string, context: Record<string, unknown>) => void;

  constructor(
    private readonly database: PairFlowDatabase,
    private readonly settings: PairFlowSettings,
    collector: PairFlowCollector,
    dependencies: PairFlowServiceDependencies = {},
  ) {
    this.collect = dependencies.collect ?? collector.collect.bind(collector);
    this.fetchTransactionDetails =
      dependencies.fetchTransactionDetails ??
      (dependencies.collect
        ? async () => new Map<string, PairTransactionDetail>()
        : collector.fetchTransactionDetails.bind(collector));
    this.now = dependencies.now ?? (() => new Date());
    this.warn = dependencies.warn ?? ((event, context) => console.warn(event, context));
  }

  async ensureFresh(): Promise<PairFlowResponse> {
    const latest = this.database.latest();
    const observedAt = latest ? Date.parse(latest.observedAt) : Number.NaN;
    if (
      latest &&
      Number.isFinite(observedAt) &&
      this.now().valueOf() - observedAt < this.settings.refreshTtlMinutes * 60_000
    ) {
      return this.snapshot() ?? latest;
    }
    try {
      return await this.refresh();
    } catch (error) {
      if (!latest) throw error;
      this.warn("pair_flow_refresh_failed_using_cache", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return this.snapshot() ?? latest;
    }
  }

  refresh(): Promise<PairFlowResponse> {
    if (this.refreshPromise) return this.refreshPromise;
    const pending = this.refreshNow().finally(() => {
      this.refreshPromise = null;
    });
    this.refreshPromise = pending;
    return pending;
  }

  private async refreshNow(): Promise<PairFlowResponse> {
    const batch = await this.collect();
    const response = this.buildResponse(batch);
    if (batch.history) {
      const hashes = pairFlowCandidateTransactionHashes(batch.history.transfers, this.settings);
      const details = this.database.transactionDetails(hashes);
      const missing = hashes.filter((hash) => !details.has(hash));
      if (missing.length > 0) {
        const fetched = await this.fetchTransactionDetails(missing);
        this.database.saveTransactionDetails(fetched.values());
        for (const [hash, detail] of fetched) details.set(hash, detail);
      }
      const events = buildPairFlowEvents(batch.history.transfers, details, this.settings);
      this.database.saveEvents(events, batch.history.complete, response.generatedAt);
    }
    this.database.save(response);
    return response;
  }

  async events(query: PairFlowEventsQuery): Promise<PairFlowEventsResponse> {
    const snapshot = await this.ensureFresh();
    if (this.database.eventCount() === 0 && snapshot.attribution.complete) {
      await this.refresh();
    }
    const now = this.now();
    const since =
      query.window === "today"
        ? chinaWindow(now).calendarStartAt
        : query.window === "7d"
          ? new Date(now.valueOf() - 7 * 24 * 60 * 60_000).toISOString()
          : null;
    const result = this.database.listEvents(query, since);
    const latest = this.snapshot();
    return {
      service: "rhc-pair-flow-events",
      generatedAt: now.toISOString(),
      observedAt: latest?.observedAt ?? null,
      historyStartAt: this.settings.historyStartAt,
      complete: latest?.attribution.complete ?? false,
      query,
      counts: {
        matched: result.matched,
        buyback: result.buyback,
        burn: result.burn,
      },
      items: result.items,
    };
  }

  private buildResponse(batch: PairFlowCollectionBatch): PairFlowResponse {
    const now = this.now();
    const generatedAt = now.toISOString();
    const window = chinaWindow(now);
    const historyComplete = batch.history?.complete === true;
    const ledger: PairFlowLedgerSummary | null = batch.history
      ? buildPairFlowLedger(batch.history.transfers, {
          pairTokenAddress: this.settings.pairTokenAddress,
          spyTokenAddress: this.settings.spyTokenAddress,
          lockerAddress: this.settings.lockerAddress,
          poolManagerAddress: this.settings.poolManagerAddress,
          swapAdapterAddresses: this.settings.swapAdapterAddresses,
          deadAddress: this.settings.deadAddress,
          trackedWallets: [
            this.settings.creatorAddress,
            this.settings.treasuryAddress,
            this.settings.executorAddress,
          ],
          calendarStartAt: window.calendarStartAt,
        })
      : null;
    const chain = batch.chain;
    const chainAt = chain?.observedAt ?? batch.observedAt;
    const historyAt = batch.history?.observedAt ?? batch.observedAt;
    const mainToken = batch.mainToken;
    const platform = batch.platform;
    const todayVolume = batch.ohlcv
      ? batch.ohlcv.candles
          .filter(
            (candle) =>
              candle.timestamp * 1_000 >= Date.parse(window.calendarStartAt) &&
              candle.timestamp * 1_000 <= now.valueOf(),
          )
          .reduce((sum, candle) => sum + candle.volumeUsd, 0)
      : null;
    const platformVolume = platform?.volume24hUsd ?? null;
    const grossFees =
      platformVolume !== null ? platformVolume * (this.settings.tradingFeePercent / 100) : null;
    const protocolFees =
      grossFees !== null ? grossFees * (this.settings.protocolFeePercent / 100) : null;
    const policyBudget =
      protocolFees !== null ? protocolFees * (this.settings.policyBuybackPercent / 100) : null;

    const pairWalletBalances = chain
      ? [
          walletValue(chain.walletPairBalances, this.settings.creatorAddress),
          walletValue(chain.walletPairBalances, this.settings.treasuryAddress),
          walletValue(chain.walletPairBalances, this.settings.executorAddress),
        ]
      : [];
    const walletPendingPair = chain ? sumKnown(pairWalletBalances) : null;
    const reconstructedMatchesChain =
      ledger !== null &&
      walletPendingPair !== null &&
      Math.abs(ledger.reconstructedPairBalance - walletPendingPair) <=
        Math.max(0.000001, walletPendingPair * 0.000001);

    const claimableAfter = chain?.collectSimulationSucceeded ? chain.claimableAfter : null;
    const lockerPendingPair = claimableAfter
      ? sumKnown([claimableAfter.creatorPair, claimableAfter.treasuryPair])
      : null;
    const officialTreasury = batch.treasuryClaimable;
    const protocolClaimableSpy =
      officialTreasury?.spyClaimable ?? chain?.claimableBefore.treasurySpy ?? null;
    const mainPoolUnsweptSpy =
      chain?.collectSimulationSucceeded &&
      chain.claimableBefore.treasurySpy !== null &&
      chain.claimableAfter.treasurySpy !== null
        ? Math.max(0, chain.claimableAfter.treasurySpy - chain.claimableBefore.treasurySpy)
        : null;
    const creatorClaimableSpy = claimableAfter?.creatorSpy ?? null;
    const policySpyBase =
      protocolClaimableSpy !== null
        ? protocolClaimableSpy + (mainPoolUnsweptSpy ?? 0)
        : (chain?.claimableAfter.treasurySpy ?? null);
    const policyExpectedSpy =
      policySpyBase !== null ? policySpyBase * (this.settings.policyBuybackPercent / 100) : null;
    const mainPoolUnsweptUsd =
      mainPoolUnsweptSpy !== null && chain?.spyPriceUsd !== null && chain?.spyPriceUsd !== undefined
        ? mainPoolUnsweptSpy * chain.spyPriceUsd
        : null;
    const protocolQuoteAssetsUsd = officialTreasury?.quoteClaimableUsd ?? null;
    const policyUsdBase =
      protocolQuoteAssetsUsd !== null
        ? protocolQuoteAssetsUsd + (mainPoolUnsweptUsd ?? 0)
        : chain?.claimableAfter.treasurySpy !== null &&
            chain?.claimableAfter.treasurySpy !== undefined &&
            chain.spyPriceUsd !== null
          ? chain.claimableAfter.treasurySpy * chain.spyPriceUsd
          : null;
    const policyExpectedUsd =
      policyUsdBase !== null ? policyUsdBase * (this.settings.policyBuybackPercent / 100) : null;
    const treasuryWalletSpy = chain
      ? walletValue(chain.walletSpyBalances, this.settings.treasuryAddress)
      : null;
    const creatorWalletSpy = chain
      ? sumKnown([
          walletValue(chain.walletSpyBalances, this.settings.creatorAddress),
          walletValue(chain.walletSpyBalances, this.settings.executorAddress),
        ])
      : null;
    const poolLiquidity = mainToken?.liquidityUsd ?? null;
    const pressurePercent =
      policyExpectedUsd !== null && poolLiquidity !== null && poolLiquidity > 0
        ? (policyExpectedUsd / poolLiquidity) * 100
        : null;
    const deadUnattributedRaw =
      chain?.pairDeadBalance !== null &&
      chain?.pairDeadBalance !== undefined &&
      ledger &&
      historyComplete
        ? Math.max(
            0,
            chain.pairDeadBalance - ledger.burnedDirectFeePair - ledger.burnedMarketAcquiredPair,
          )
        : null;
    const deadUnattributed =
      deadUnattributedRaw !== null && deadUnattributedRaw < 0.000001 ? 0 : deadUnattributedRaw;
    const status = batch.sources.some((source) => source.status !== "ok") ? "partial" : "success";

    return {
      service: "rhc-pair-flow",
      generatedAt,
      observedAt: batch.observedAt,
      status,
      stale: false,
      window,
      volume: {
        mainPoolTodayUsd:
          todayVolume !== null
            ? evidence({
                value: todayVolume,
                unit: "USD",
                state: "derived",
                quality: "third_party",
                tier: "confirmed",
                source: "geckoterminal.pairSpyOhlcv",
                asOf: batch.ohlcv?.observedAt ?? batch.observedAt,
                note: "PAIR/SPY 主池从北京时间 00:00 起的小时 K 线成交额合计。",
              })
            : unknown("USD", "主池北京时间今日成交额暂不可用。"),
        mainPoolRolling24hUsd:
          mainToken?.volume24hUsd !== null && mainToken?.volume24hUsd !== undefined
            ? evidence({
                value: mainToken.volume24hUsd,
                unit: "USD",
                quality: "official",
                tier: "confirmed",
                source: "pair.officialTokenApi",
                asOf: mainToken.observedAt,
                note: "PAIR 官方代币 API 报告的 PAIR/SPY 主池滚动 24H 成交额。",
              })
            : unknown("USD", "主池滚动 24H 成交额暂不可用。"),
        platformRolling24hUsd:
          platformVolume !== null && platform
            ? evidence({
                value: platformVolume,
                unit: "USD",
                state: "derived",
                quality: "official",
                tier: "confirmed",
                source: "pair.tokenRadar.universeAggregate",
                asOf: platform.observedAt,
                note: platform.complete
                  ? `${String(platform.tokenCount)} 枚可见代币的官方 24H 成交额求和。`
                  : `${String(platform.volumeObservedCount)}/${String(platform.tokenCount)} 枚可见代币有成交额；当前值是已观测下限，缺失不补 0。`,
              })
            : unknown("USD", "全平台滚动 24H 成交额暂不可用。"),
        platformTokenCount: platform
          ? evidence({
              value: platform.tokenCount,
              unit: "count",
              quality: "official",
              tier: "confirmed",
              source: "pair.tokenRadar.universeAggregate",
              asOf: platform.observedAt,
            })
          : unknown("count", "全平台代币覆盖数暂不可用。"),
        theoreticalGrossFees24hUsd:
          grossFees !== null && platform
            ? evidence({
                value: grossFees,
                unit: "USD",
                state: "derived",
                quality: "official",
                tier: "policy_expected",
                source: "pair.tokenRadar.universeAggregate+pair.feePolicy",
                asOf: platform.observedAt,
                note: `滚动 24H 成交额 × ${String(this.settings.tradingFeePercent)}% 交易费；不是金库实收。`,
              })
            : unknown("USD", "缺少全平台成交额，无法计算理论用户手续费。"),
        theoreticalProtocolFees24hUsd:
          protocolFees !== null && platform
            ? evidence({
                value: protocolFees,
                unit: "USD",
                state: "derived",
                quality: "official",
                tier: "policy_expected",
                source: "pair.tokenRadar.universeAggregate+PairV4Locker",
                asOf: platform.observedAt,
                note: `理论用户手续费 × ${String(this.settings.protocolFeePercent)}% 协议份额；不是当前待回购余额。`,
              })
            : unknown("USD", "缺少理论手续费，无法计算协议份额。"),
        theoreticalPolicyBuyback24hUsd:
          policyBudget !== null && platform
            ? evidence({
                value: policyBudget,
                unit: "USD",
                state: "derived",
                quality: "official",
                tier: "policy_expected",
                source: "pair.tokenRadar.universeAggregate+pair.buybackPolicy",
                asOf: platform.observedAt,
                note: `${platform.complete ? "" : "基于已观测成交额下限；"}协议份额 × ${String(this.settings.policyBuybackPercent)}% 公开回购比例；表示 24H 理论新增预算，不等于待回购余额。`,
              })
            : unknown("USD", "缺少协议份额，无法计算 24H 理论回购预算。"),
      },
      burn: {
        totalSupplyPair:
          chain?.pairTotalSupply !== null && chain?.pairTotalSupply !== undefined
            ? evidence({
                value: chain.pairTotalSupply,
                unit: "PAIR",
                quality: "onchain",
                tier: "confirmed",
                source: "robinhood.rpc.pairFlow",
                asOf: chainAt,
                note: "ERC-20 totalSupply；转入死亡地址通常不会让该数值下降。",
              })
            : unknown("PAIR", "PAIR totalSupply 链上读取暂不可用。"),
        deadLockedPair:
          chain?.pairDeadBalance !== null && chain?.pairDeadBalance !== undefined
            ? evidence({
                value: chain.pairDeadBalance,
                unit: "PAIR",
                quality: "onchain",
                tier: "confirmed",
                source: "robinhood.rpc.pairFlow",
                asOf: chainAt,
                note: "死亡地址当前 PAIR 余额；证明代币不可由普通私钥转回，不自动证明回购来源。",
              })
            : unknown("PAIR", "死亡地址 PAIR 余额暂不可用。"),
        deadLockedPercent:
          chain?.pairDeadBalance !== null &&
          chain?.pairDeadBalance !== undefined &&
          chain.pairTotalSupply !== null &&
          chain.pairTotalSupply > 0
            ? evidence({
                value: (chain.pairDeadBalance / chain.pairTotalSupply) * 100,
                unit: "percent",
                state: "derived",
                quality: "onchain",
                tier: "confirmed",
                source: "robinhood.rpc.pairFlow",
                asOf: chainAt,
              })
            : unknown("percent", "缺少死亡地址余额或总供应量。"),
        todayBurnedPair: ledger
          ? historyEvidence(
              historyComplete,
              ledger.todayBurnedPair,
              "PAIR",
              historyAt,
              "受监控团队地址今日转入死亡地址的 PAIR。",
            )
          : unknown("PAIR", "今日销毁转账索引暂不可用。"),
        todayDirectFeeBurnedPair: ledger
          ? historyEvidence(
              historyComplete,
              ledger.todayDirectFeeBurnedPair,
              "PAIR",
              historyAt,
              "FIFO 归因：由 Locker 直接收到后在今日销毁。",
            )
          : unknown("PAIR", "今日直接手续费销毁暂不可用。"),
        todayMarketAcquiredBurnedPair: ledger
          ? historyEvidence(
              historyComplete,
              ledger.todayMarketAcquiredBurnedPair,
              "PAIR",
              historyAt,
              "FIFO 归因：由 Swap 市场流入后在今日销毁；尚不自动认定由手续费资助。",
            )
          : unknown("PAIR", "今日市场买入后销毁暂不可用。"),
        todayUnattributedBurnedPair: ledger
          ? historyEvidence(
              historyComplete,
              ledger.todayUnattributedBurnedPair,
              "PAIR",
              historyAt,
              "今日销毁中无法归为 Locker 直发或 Swap 流入的部分。",
              "unattributed",
            )
          : unknown("PAIR", "今日未归因销毁暂不可用。"),
        cumulativeDirectFeeBurnedPair: ledger
          ? historyEvidence(
              historyComplete,
              ledger.burnedDirectFeePair,
              "PAIR",
              historyAt,
              "FIFO 归因：Locker 直接分配并由受监控地址销毁的累计 PAIR。",
            )
          : unknown("PAIR", "累计直接手续费销毁暂不可用。"),
        cumulativeMarketAcquiredPair: ledger
          ? historyEvidence(
              historyComplete,
              ledger.cumulativeMarketAcquiredPair,
              "PAIR",
              historyAt,
              "受监控地址从 PoolManager、已知路由或 Swap 转入的累计 PAIR。",
            )
          : unknown("PAIR", "累计市场买入 PAIR 暂不可用。"),
        cumulativeMarketAcquiredBurnedPair: ledger
          ? historyEvidence(
              historyComplete,
              ledger.burnedMarketAcquiredPair,
              "PAIR",
              historyAt,
              "FIFO 归因：市场买入后由受监控地址转入死亡地址的累计 PAIR。",
            )
          : unknown("PAIR", "累计市场买入后销毁暂不可用。"),
        cumulativeUnattributedBurnedPair:
          deadUnattributed !== null
            ? evidence({
                value: deadUnattributed,
                unit: "PAIR",
                state: "derived",
                quality: "onchain",
                tier: "unattributed",
                source: "robinhood.rpc.pairFlow+rh-scan.addressTransfers",
                asOf: chainAt,
                note: "死亡地址总余额减去受监控地址已归因销毁；包含初始销毁及其它来源。",
              })
            : unknown("PAIR", "缺少完整历史或死亡地址余额，无法计算未归因销毁。"),
        walletPendingPair:
          walletPendingPair !== null
            ? evidence({
                value: walletPendingPair,
                unit: "PAIR",
                quality: "onchain",
                tier: "unattributed",
                source: "robinhood.rpc.pairFlow",
                asOf: chainAt,
                note: "三个受监控团队地址当前 PAIR 余额；尚未转入死亡地址，也不保证全部会销毁。",
              })
            : unknown("PAIR", "团队地址 PAIR 余额读取不完整。"),
        walletMarketAcquiredPendingPair:
          ledger && historyComplete && reconstructedMatchesChain
            ? evidence({
                value: ledger.pendingMarketAcquiredPair,
                unit: "PAIR",
                state: "derived",
                quality: "third_party",
                tier: "confirmed",
                source: "rh-scan.addressTransfers+robinhood.rpc.pairFlow",
                asOf: chainAt,
                note: "完整 FIFO 历史与当前链上钱包余额已对账的市场买入未销毁部分。",
              })
            : unknown("PAIR", "历史批次与当前钱包余额未完成对账，不能拆出已买未销毁部分。"),
        lockerPendingDirectPair:
          lockerPendingPair !== null
            ? evidence({
                value: lockerPendingPair,
                unit: "PAIR",
                state: "derived",
                quality: "onchain",
                tier: "policy_expected",
                source: "robinhood.rpc.pairFlow",
                asOf: chainAt,
                note: "eth_call 内模拟 collectFees 后，创作者与协议可领 PAIR 合计；未广播交易，后续销毁仍是行为预期。",
              })
            : unknown("PAIR", "Locker 可领 PAIR 模拟暂不可用。"),
      },
      buyback: {
        protocolQuoteAssetsUsd:
          protocolQuoteAssetsUsd !== null && officialTreasury
            ? evidence({
                value: protocolQuoteAssetsUsd,
                unit: "USD",
                state: "derived",
                quality: "official",
                tier:
                  officialTreasury.quoteUsdCoverageCount === officialTreasury.quoteAssetCount
                    ? "confirmed"
                    : "unattributed",
                source: "pair.officialTreasuryClaimableApi",
                asOf: officialTreasury.observedAt,
                note:
                  officialTreasury.quoteUsdCoverageCount === officialTreasury.quoteAssetCount
                    ? "协议金库跨全部 Locker 已归集、尚可领取的报价资产美元总额；不含仍留在 LP 仓位内的未归集费用。"
                    : `${String(officialTreasury.quoteUsdCoverageCount)}/${String(officialTreasury.quoteAssetCount)} 种报价资产有美元估值；当前值是下限。`,
              })
            : unknown("USD", "协议金库全平台已归集报价资产暂不可用。"),
        protocolQuoteAssetCount: officialTreasury
          ? evidence({
              value: officialTreasury.quoteAssetCount,
              unit: "count",
              quality: "official",
              tier: "confirmed",
              source: "pair.officialTreasuryClaimableApi",
              asOf: officialTreasury.observedAt,
              note: "当前具有非零可领取余额的报价资产种类数。",
            })
          : unknown("count", "协议金库报价资产种类数暂不可用。"),
        protocolClaimableSpy:
          protocolClaimableSpy !== null
            ? evidence({
                value: protocolClaimableSpy,
                unit: "SPY",
                state: officialTreasury ? "observed" : "derived",
                quality: officialTreasury ? "official" : "onchain",
                tier: "confirmed",
                source: officialTreasury
                  ? "pair.officialTreasuryClaimableApi"
                  : "robinhood.rpc.pairFlow",
                asOf: officialTreasury?.observedAt ?? chainAt,
                note: officialTreasury
                  ? "协议金库跨全部 Locker 已归集、尚可领取的 SPY；不含仍留在 LP 仓位内的未归集费用。"
                  : "当前 V4 Locker 链上可领取 SPY；全平台接口不可用时的降级值。",
              })
            : unknown("SPY", "协议金库 Locker 可领 SPY 暂不可用。"),
        mainPoolUnsweptSpy:
          mainPoolUnsweptSpy !== null
            ? evidence({
                value: mainPoolUnsweptSpy,
                unit: "SPY",
                state: "derived",
                quality: "onchain",
                tier: "confirmed",
                source: "robinhood.rpc.pairFlow",
                asOf: chainAt,
                note: "只读模拟 collectFees 前后差额；仅覆盖 PAIR/SPY 主池尚未归集的协议 SPY。",
              })
            : unknown("SPY", "PAIR/SPY 主池未归集 SPY 模拟暂不可用。"),
        policyExpectedSpy:
          policyExpectedSpy !== null
            ? evidence({
                value: policyExpectedSpy,
                unit: "SPY",
                state: "derived",
                quality: "onchain",
                tier: "policy_expected",
                source:
                  "pair.officialTreasuryClaimableApi+robinhood.rpc.pairFlow+pair.buybackPolicy",
                asOf: officialTreasury?.observedAt ?? chainAt,
                note: `已归集 SPY 加 PAIR/SPY 主池待归集增量，再乘 ${String(this.settings.policyBuybackPercent)}% 公开回购比例；只是 SPY 分项，合约没有强制执行该用途。`,
              })
            : unknown("SPY", "缺少协议可领 SPY，无法计算政策待回购量。"),
        policyExpectedUsd:
          policyExpectedUsd !== null
            ? evidence({
                value: policyExpectedUsd,
                unit: "USD",
                state: "derived",
                quality: "onchain",
                tier: "policy_expected",
                source:
                  "pair.officialTreasuryClaimableApi+robinhood.rpc.pairFlow+pair.buybackPolicy",
                asOf: officialTreasury?.observedAt ?? chain?.spyPriceUpdatedAt ?? chainAt,
                note: `${officialTreasury ? "全平台已归集报价资产" : "降级为当前 V4 Locker SPY"}${mainPoolUnsweptUsd !== null ? "，加 PAIR/SPY 主池待归集 SPY" : ""}，再乘 ${String(this.settings.policyBuybackPercent)}% 公开回购比例；其它池尚未归集费用仍未知，不是已成交金额。`,
              })
            : unknown("USD", "缺少政策 SPY 数量或预言机价格。"),
        protocolWalletSpy:
          treasuryWalletSpy !== null
            ? evidence({
                value: treasuryWalletSpy,
                unit: "SPY",
                quality: "onchain",
                tier: "unattributed",
                source: "robinhood.rpc.pairFlow",
                asOf: chainAt,
                note: "协议金库当前 SPY 钱包余额；钱包资金可混同，未直接并入政策待回购。",
              })
            : unknown("SPY", "协议金库钱包 SPY 余额暂不可用。"),
        creatorClaimableSpy:
          creatorClaimableSpy !== null
            ? evidence({
                value: creatorClaimableSpy,
                unit: "SPY",
                state: "derived",
                quality: "onchain",
                tier: "unattributed",
                source: "robinhood.rpc.pairFlow",
                asOf: chainAt,
                note: "创作者在 Locker 中可领的 SPY；不属于协议 90% 回购承诺的强制口径。",
              })
            : unknown("SPY", "创作者 Locker 可领 SPY 暂不可用。"),
        creatorWalletSpy:
          creatorWalletSpy !== null
            ? evidence({
                value: creatorWalletSpy,
                unit: "SPY",
                quality: "onchain",
                tier: "unattributed",
                source: "robinhood.rpc.pairFlow",
                asOf: chainAt,
                note: "创作者与行为关联执行地址当前 SPY 余额；未证明全部来自平台手续费。",
              })
            : unknown("SPY", "团队非金库地址 SPY 余额暂不可用。"),
        observedFeeSpyReceived: ledger
          ? historyEvidence(
              historyComplete,
              ledger.observedFeeSpyReceived,
              "SPY",
              historyAt,
              "受监控地址累计从 Locker 实收的 SPY。",
            )
          : unknown("SPY", "累计实收手续费 SPY 暂不可用。"),
        observedSpySwapSpend: ledger
          ? historyEvidence(
              historyComplete,
              ledger.observedSpySwapSpend,
              "SPY",
              historyAt,
              "受监控地址累计在标记为 Swap 的转账中支出的 SPY；来源资金尚未唯一归因。",
              "unattributed",
            )
          : unknown("SPY", "累计 Swap 支出 SPY 暂不可用。"),
        confirmedFeeFundedSpendUsd: unknown(
          "USD",
          "尚未把每笔 Locker SPY 入账、具体 Swap 输入与 PAIR 输出按交易批次完全闭环，因此不宣称手续费资助的已执行美元金额。",
        ),
      },
      pressure: {
        poolLiquidityUsd:
          poolLiquidity !== null && mainToken
            ? evidence({
                value: poolLiquidity,
                unit: "USD",
                quality: "official",
                tier: "confirmed",
                source: "pair.officialTokenApi",
                asOf: mainToken.observedAt,
              })
            : unknown("USD", "PAIR/SPY 主池流动性暂不可用。"),
        policyPendingToLiquidityPercent:
          pressurePercent !== null
            ? evidence({
                value: pressurePercent,
                unit: "percent",
                state: "derived",
                quality: "onchain",
                tier: "policy_expected",
                source: "robinhood.rpc.pairFlow+pair.officialTokenApi",
                asOf: chainAt,
                note: "政策待回购美元值 ÷ 当前主池流动性；只表示资金压力比例，不是价格预测。",
              })
            : unknown("percent", "缺少待回购美元值或主池流动性。"),
        state: pressureState(pressurePercent),
      },
      attribution: {
        historyStartAt: this.settings.historyStartAt,
        complete: historyComplete,
        fundingLink: batch.history ? "partial" : "unknown",
        trackedWallets: [
          {
            role: "creator",
            address: this.settings.creatorAddress,
            attribution: "official",
          },
          {
            role: "protocol_treasury",
            address: this.settings.treasuryAddress,
            attribution: "official",
          },
          {
            role: "executor_inferred",
            address: this.settings.executorAddress,
            attribution: "behavior_inferred",
          },
        ],
      },
      sources: batch.sources,
      warnings: [
        ...batch.warnings,
        ...(!reconstructedMatchesChain && ledger && historyComplete
          ? ["pair_wallet_history_balance_mismatch"]
          : []),
        "spy_fee_to_swap_funding_link_partial",
      ],
    };
  }

  snapshot(): PairFlowResponse | null {
    const latest = this.database.latest();
    if (!latest) return null;
    const now = this.now();
    const stale =
      now.valueOf() - Date.parse(latest.observedAt) >= this.settings.staleAfterMinutes * 60_000;
    return {
      ...latest,
      generatedAt: now.toISOString(),
      stale,
      status: stale ? "partial" : latest.status,
      warnings:
        stale && !latest.warnings.includes("pair_flow_snapshot_stale")
          ? [...latest.warnings, "pair_flow_snapshot_stale"]
          : latest.warnings,
    };
  }

  health() {
    const snapshot = this.snapshot();
    return {
      ok: Boolean(snapshot),
      service: "rhc-pair-flow",
      observedAt: snapshot?.observedAt ?? null,
      status: snapshot?.status ?? "empty",
      stale: snapshot?.stale ?? true,
      generatedAt: this.now().toISOString(),
      eventCount: this.database.eventCount(),
    };
  }
}
