import { planPairV2Alerts, PairV2FeishuNotifier } from "./alerts.js";
import type { PairV2Settings } from "./config.js";
import type { PairV2Collector } from "./collector.js";
import type { PairV2Database } from "./database.js";
import {
  PAIR_ALPHA_MODEL_VERSION,
  PAIR_V2_ALPHA_MODEL_VERSION,
  percentileRanks,
  scorePairV2Candidate,
} from "./model.js";
import type {
  PairAlphaActionState,
  PairAlphaRadarResponse,
  PairAlphaTokenView,
  PairV2ChainEvent,
  PairV2CollectionBatch,
  PairV2DashboardResponse,
  PairV2Launch,
  PairV2MarketToken,
  PairV2ModeId,
  PairV2RunKind,
  PairV2TokenView,
} from "./types.js";

type PairV2RefreshMode = PairV2RunKind | "hot";

export interface PairV2ServiceDependencies {
  collect?: PairV2Collector["collect"];
  notifier?: PairV2FeishuNotifier;
  now?: () => Date;
  warn?: (event: string, context: Record<string, unknown>) => void;
}

const MODE_LABELS: Record<PairV2ModeId, string> = {
  1: "费用分账",
  2: "回购销毁",
  3: "持有人分红",
};

function sum(values: Array<number | null>): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function sumObserved(values: Array<number | null>): number | null {
  const observed = values.filter((value): value is number => value !== null);
  return observed.length > 0 ? observed.reduce((total, value) => total + value, 0) : null;
}

function safePercent(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 100 : 0;
}

function stageOrder(value: PairV2TokenView["alpha"]["stage"]): number {
  return {
    confirmed: 0,
    forming: 1,
    emerging: 1,
    attention: 2,
    watch: 3,
    rejected: 4,
  }[value];
}

function qualityOrder(value: PairV2TokenView["alpha"]["quality"]["state"]): number {
  return { qualified: 0, unknown: 1, unqualified: 2 }[value];
}

function actionOrder(value: PairAlphaActionState): number {
  return {
    confirmed: 0,
    probe_eligible: 1,
    ignition_watch: 2,
    retest_watch: 3,
    no_chase: 4,
    evidence_wait: 5,
    cold_watch: 6,
    risk_halt: 7,
  }[value];
}

function refreshPriority(value: PairV2RefreshMode): number {
  return { chain: 0, hot: 1, full: 2 }[value];
}

function cohortKey(token: PairV2MarketToken, launch: PairV2Launch | null, now: Date): string {
  const launched = token.launchedAt ? Date.parse(token.launchedAt) : Number.NaN;
  const ageHours = Number.isFinite(launched)
    ? Math.max(0, (now.valueOf() - launched) / 3_600_000)
    : Number.POSITIVE_INFINITY;
  const age = ageHours <= 24 ? "0-24h" : ageHours <= 72 ? "24-72h" : "72h+";
  return `${token.launchVersion ?? "unknown"}:${String(launch?.modeId ?? 0)}:${age}`;
}

function cohortPercentiles(
  groups: Map<string, PairV2MarketToken[]>,
  allTokens: PairV2MarketToken[],
  read: (token: PairV2MarketToken) => number | null,
): Map<string, number | null> {
  const result = new Map<string, number | null>();
  const canonical = allTokens.filter((token) => !token.hidden && !token.flagged);
  for (const group of groups.values()) {
    const sample = group.length >= 3 ? group : canonical;
    const ranks = percentileRanks(sample.map(read));
    const byAddress = new Map(
      sample.map((token, index) => [token.address, ranks[index] ?? null] as const),
    );
    for (const token of group) result.set(token.address, byAddress.get(token.address) ?? null);
  }
  return result;
}

function enrichEvents(events: PairV2ChainEvent[], tokens: PairV2MarketToken[]): PairV2ChainEvent[] {
  const symbols = new Map(
    tokens.flatMap((token) => token.pools.map((pool) => [pool.quote.address, pool.quote.symbol])),
  );
  return events.map((event) => ({
    ...event,
    assetSymbol: event.assetSymbol ?? (event.asset ? (symbols.get(event.asset) ?? null) : null),
  }));
}

export class PairV2Service {
  private readonly collect: PairV2Collector["collect"];
  private readonly notifier: PairV2FeishuNotifier;
  private readonly now: () => Date;
  private readonly warn: (event: string, context: Record<string, unknown>) => void;
  private dashboardCache: PairV2DashboardResponse | null;
  private refreshPromise: Promise<PairV2DashboardResponse> | null = null;
  private refreshKind: PairV2RefreshMode | null = null;
  private chainTimer: NodeJS.Timeout | null = null;
  private hotMarketTimer: NodeJS.Timeout | null = null;
  private marketTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly database: PairV2Database,
    private readonly settings: PairV2Settings,
    collector: PairV2Collector,
    dependencies: PairV2ServiceDependencies = {},
  ) {
    this.collect = dependencies.collect ?? collector.collect.bind(collector);
    this.notifier = dependencies.notifier ?? new PairV2FeishuNotifier(settings);
    this.now = dependencies.now ?? (() => new Date());
    this.warn = dependencies.warn ?? ((event, context) => console.warn(event, context));
    this.dashboardCache = database.latestDashboard();
  }

  async ensureFresh(): Promise<PairV2DashboardResponse> {
    const cached = this.dashboardCache;
    const latestUsable = this.database.latestUsableRun();
    const freshnessAt = latestUsable?.completedAt ?? cached?.observedAt ?? null;
    const observed = freshnessAt ? Date.parse(freshnessAt) : Number.NaN;
    if (
      cached &&
      Number.isFinite(observed) &&
      this.now().valueOf() - observed < this.settings.marketPollSeconds * 2 * 1_000
    ) {
      return this.withFreshness(cached);
    }
    if (cached) {
      void this.refresh("full").catch((error) => {
        this.warn("pair_v2_background_refresh_failed_using_cache", {
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      });
      return this.withFreshness(cached);
    }
    return this.refresh("full");
  }

  refresh(kind: PairV2RefreshMode = "full"): Promise<PairV2DashboardResponse> {
    if (this.refreshPromise) {
      const activeKind = this.refreshKind;
      return this.refreshPromise.then((payload) =>
        activeKind !== null && refreshPriority(kind) > refreshPriority(activeKind)
          ? this.refresh(kind)
          : payload,
      );
    }
    this.refreshKind = kind;
    const promise = this.refreshNow(kind).finally(() => {
      this.refreshPromise = null;
      this.refreshKind = null;
    });
    this.refreshPromise = promise;
    return promise;
  }

  private async refreshNow(kind: PairV2RefreshMode): Promise<PairV2DashboardResponse> {
    const startedAt = this.now().toISOString();
    const runKind: PairV2RunKind = kind === "full" ? "full" : "chain";
    const runId = this.database.startRun(runKind, startedAt);
    const cachedRelease = this.database.release(this.settings.expectedReleaseId);
    const cachedTokens = this.database.tokens();
    const cachedLaunches = cachedRelease ? this.database.launches(cachedRelease.releaseId) : [];
    const cursor = this.database.cursorBlock(this.settings.deploymentBlock);
    const fromBlock = Math.max(
      this.settings.deploymentBlock,
      cursor - this.settings.reorgOverlapBlocks + 1,
    );
    const previous = this.dashboardCache;
    try {
      const batch = await this.collect({
        kind: runKind,
        marketMode: kind === "full" ? "full" : kind === "hot" ? "hot" : "none",
        fromBlock,
        cachedRelease,
        cachedTokens,
        cachedLaunches,
      });
      this.database.saveBatch(runId, batch);
      const partial =
        batch.warnings.length > 0 || batch.sourceHealth.some((source) => source.status !== "ok");
      const status = partial ? "partial" : "success";
      this.database.completeRun(
        runId,
        status,
        this.now().toISOString(),
        batch.observedAt,
        batch.latestBlock,
        batch.warnings,
      );
      const payload = this.buildDashboard(batch, status);
      if (this.notifier.configured) {
        this.database.enqueueAlerts(planPairV2Alerts(previous, payload));
        await this.notifier.flush(this.database);
        payload.alerts = this.database.alertSummary(true);
      }
      // Chain and hot-market passes update the in-memory dashboard immediately.
      // Persist only full-universe checkpoints (or the first usable payload) so
      // an 8-second monitor loop cannot turn a cache into multi-gigabyte I/O.
      if (kind === "full" || previous === null) {
        this.database.saveDashboard(runId, payload);
      }
      this.dashboardCache = payload;
      return payload;
    } catch (error) {
      this.database.completeRun(
        runId,
        "failed",
        this.now().toISOString(),
        null,
        null,
        [],
        error instanceof Error ? error.name : "UnknownError",
      );
      throw error;
    }
  }

  private buildDashboard(
    batch: PairV2CollectionBatch,
    status: "success" | "partial",
  ): PairV2DashboardResponse {
    const release = batch.release;
    const tokens = this.database.tokens();
    const launches = this.database.launches(release.releaseId);
    const launchesByProject = new Map(launches.map((launch) => [launch.project, launch]));
    const tokenByAddress = new Map(tokens.map((token) => [token.address, token]));
    for (const launch of launches) {
      if (tokenByAddress.has(launch.project)) continue;
      tokenByAddress.set(launch.project, {
        address: launch.project,
        name: "尚未被官方市场 API 索引",
        symbol: launch.project.slice(2, 8).toUpperCase(),
        creator: launch.creator,
        launchedAt: launch.timestamp,
        priceUsd: null,
        marketCapUsd: null,
        liquidityUsd: null,
        volume24hUsd: null,
        holderCount: null,
        holderObservedAt: null,
        marketDataUpdatedAt: null,
        hidden: false,
        flagged: false,
        pools: [],
        launchVersion: "v2",
        marketVersion: null,
        launchTransactionHash: launch.transactionHash,
        alphaMarketCandidate: true,
        alphaCandidateReasons: ["current_release_event"],
      });
    }
    const allTokens = [...tokenByAddress.values()];
    const observedMs = Date.parse(batch.observedAt);
    const scoringNow = Number.isFinite(observedMs) ? new Date(observedMs) : this.now();
    const addresses = allTokens.map((token) => token.address);
    const previous5m = this.database.historicalSnapshots(
      addresses,
      new Date(scoringNow.valueOf() - 5 * 60_000).toISOString(),
    );
    const previous15m = this.database.historicalSnapshots(
      addresses,
      new Date(scoringNow.valueOf() - 15 * 60_000).toISOString(),
    );
    const previous1h = this.database.historicalSnapshots(
      addresses,
      new Date(scoringNow.valueOf() - 60 * 60_000).toISOString(),
    );

    const groups = new Map<string, PairV2MarketToken[]>();
    for (const token of allTokens) {
      const launch = launchesByProject.get(token.address) ?? null;
      const key = cohortKey(token, launch, scoringNow);
      groups.set(key, [...(groups.get(key) ?? []), token]);
    }
    const volume5mPercentile = cohortPercentiles(
      groups,
      allTokens,
      (token) => token.shortWindow?.volume5mUsd ?? null,
    );
    const volume1hPercentile = cohortPercentiles(
      groups,
      allTokens,
      (token) => token.shortWindow?.volume1hUsd ?? null,
    );
    const turnoverPercentile = cohortPercentiles(groups, allTokens, (token) =>
      token.shortWindow?.volume1hUsd !== null &&
      token.shortWindow?.volume1hUsd !== undefined &&
      token.marketCapUsd !== null &&
      token.marketCapUsd > 0
        ? token.shortWindow.volume1hUsd / token.marketCapUsd
        : null,
    );
    const holderPercentile = cohortPercentiles(groups, allTokens, (token) => token.holderCount);
    const buyActivityPercentile = cohortPercentiles(
      groups,
      allTokens,
      (token) => token.shortWindow?.buys1h ?? null,
    );

    const events = enrichEvents(this.database.events(release.releaseId, 500), allTokens);
    const buckets = this.database.buckets(release.releaseId);
    const tokenViews: PairV2TokenView[] = allTokens.map((token) => {
      const launch = launchesByProject.get(token.address) ?? null;
      const canonical = launch !== null;
      const volume = canonical ? token.volume24hUsd : null;
      const buybacks = events.filter(
        (event) => event.type === "buyback_executed" && event.project === token.address,
      );
      const inputByAsset = new Map<string, { symbol: string | null; amount: number }>();
      for (const event of buybacks) {
        if (!event.asset || event.amount === null) continue;
        const existing = inputByAsset.get(event.asset) ?? { symbol: event.assetSymbol, amount: 0 };
        existing.amount += event.amount;
        inputByAsset.set(event.asset, existing);
      }
      return {
        ...token,
        canonical,
        modeId: launch?.modeId ?? null,
        modeLabel: launch
          ? MODE_LABELS[launch.modeId]
          : `${(token.launchVersion ?? "unknown").toUpperCase()} 历史发行`,
        vault: launch?.vault ?? null,
        handler: launch?.handler ?? null,
        fees: {
          userFees24hUsd: volume === null ? null : volume * 0.01,
          modeShare24hUsd: volume === null ? null : volume * 0.007,
          protocolShare24hUsd: volume === null ? null : volume * 0.003,
          basis: volume === null ? "unknown" : "calculated",
        },
        buyback: {
          pendingBuckets: buckets.filter((bucket) => bucket.project === token.address),
          executedCount: buybacks.length,
          executedInputByAsset: [...inputByAsset.entries()].map(([asset, value]) => ({
            asset,
            symbol: value.symbol,
            amount: value.amount,
          })),
          burnedAmount: sum(buybacks.map((event) => event.secondaryAmount)),
        },
        alpha: scorePairV2Candidate({
          token,
          launch,
          previous: previous15m.get(token.address) ?? null,
          previous5m: previous5m.get(token.address) ?? null,
          previous15m: previous15m.get(token.address) ?? null,
          previous1h: previous1h.get(token.address) ?? null,
          volumePercentile: volume1hPercentile.get(token.address) ?? null,
          turnoverPercentile: turnoverPercentile.get(token.address) ?? null,
          volume5mPercentile: volume5mPercentile.get(token.address) ?? null,
          volume1hPercentile: volume1hPercentile.get(token.address) ?? null,
          holderPercentile: holderPercentile.get(token.address) ?? null,
          buyActivityPercentile: buyActivityPercentile.get(token.address) ?? null,
          unverifiedProductionGraph: true,
          identityEvidence: launch ? "current_release_event" : "pair_official_api",
          requireCurrentRelease: false,
          now: scoringNow,
        }),
      };
    });
    tokenViews.sort(
      (left, right) =>
        stageOrder(left.alpha.stage) - stageOrder(right.alpha.stage) ||
        qualityOrder(left.alpha.quality.state) - qualityOrder(right.alpha.quality.state) ||
        (right.alpha.signal.score ?? -1) - (left.alpha.signal.score ?? -1) ||
        right.alpha.discoveryScore - left.alpha.discoveryScore ||
        (right.alpha.quality.score ?? -1) - (left.alpha.quality.score ?? -1) ||
        (right.volume24hUsd ?? -1) - (left.volume24hUsd ?? -1),
    );

    const lifecycleSeeds = tokenViews.filter(
      (token) => token.alphaMarketCandidate ?? (token.launchVersion === "v2" || token.canonical),
    );
    const lifecycleByAddress = this.database.observeAlphaStates(lifecycleSeeds, batch.observedAt);
    const alphaTokens: PairAlphaTokenView[] = lifecycleSeeds.map((token) => {
      const generation = token.launchVersion ?? "unknown";
      const canonicalPools = token.pools.filter(
        (pool) => pool.canonical !== false && pool.poolId !== null,
      );
      return {
        ...token,
        identity: {
          generation,
          marketVersion: token.marketVersion ?? null,
          evidence: token.canonical ? "current_release_event" : "pair_official_api",
          currentRelease: token.canonical,
        },
        lifecycle: lifecycleByAddress.get(token.address) ?? {
          firstObservedAt: batch.observedAt,
          firstIgnitionAt: null,
          lastTransitionAt: batch.observedAt,
          previousActionState: null,
        },
        volumeEvidence: {
          official24hUsd: token.volume24hUsd,
          primaryPool24hUsd: token.shortWindow?.primaryVolume24hUsd ?? null,
          canonicalGross24hUsd: token.shortWindow?.volume24hUsd ?? null,
          canonicalPoolCount: canonicalPools.length,
          netQuoteInflowUsd: null,
          netQuoteInflowStatus: "unknown",
        },
      };
    });
    alphaTokens.sort(
      (left, right) =>
        actionOrder(left.alpha.action?.state ?? "evidence_wait") -
          actionOrder(right.alpha.action?.state ?? "evidence_wait") ||
        right.alpha.discoveryScore - left.alpha.discoveryScore ||
        (right.shortWindow?.volume5mUsd ?? -1) - (left.shortWindow?.volume5mUsd ?? -1) ||
        (right.volume24hUsd ?? -1) - (left.volume24hUsd ?? -1),
    );
    const alphaModel = this.database.observeAlphaModel(
      "pair-all-generations",
      PAIR_ALPHA_MODEL_VERSION,
      alphaTokens,
      batch.observedAt,
      { signalKind: "action" },
    );
    const returnedAlphaTokens = alphaTokens.slice(0, this.settings.alphaReturnedTokenLimit);

    const currentTokens = tokenViews.filter((token) => token.canonical);
    const v2AlphaModel = this.database.observeAlphaModel(
      release.releaseId,
      PAIR_V2_ALPHA_MODEL_VERSION,
      currentTokens,
      batch.observedAt,
    );
    const indexedCurrent = currentTokens.filter((token) => token.marketDataUpdatedAt !== null);
    const buybackTokens = currentTokens.filter((token) => token.modeId === 2);
    const visibleMarket = indexedCurrent.filter((token) => !token.hidden && !token.flagged);
    const officialPoolMarket = visibleMarket.filter((token) => token.shortWindow);
    const modeCounts = ([1, 2, 3] as PairV2ModeId[]).map((currentModeId) => ({
      modeId: currentModeId,
      label: MODE_LABELS[currentModeId],
      count: launches.filter((launch) => launch.modeId === currentModeId).length,
    }));
    const responseEvents = events.slice(0, 200);
    const actionCount = (state: PairAlphaActionState) =>
      alphaTokens.filter((token) => token.alpha.action?.state === state).length;
    const generationCounts: PairAlphaRadarResponse["generationCounts"] = [
      { generation: "v1", count: tokens.filter((token) => token.launchVersion === "v1").length },
      { generation: "v2", count: tokens.filter((token) => token.launchVersion === "v2").length },
      {
        generation: "unknown",
        count: tokens.filter(
          (token) => token.launchVersion !== "v1" && token.launchVersion !== "v2",
        ).length,
      },
    ];
    const alphaWarnings = [
      ...batch.warnings,
      "V1 历史代币由 PAIR 官方目录确认，尚未按历史 release 逐笔回填发行事件。",
      "多池成交量同时展示官方口径、主池口径与 canonical 池毛额；地址级净 Quote 流入尚无证据，保持 UNKNOWN。",
      "所有 Alpha 状态均为 Shadow 研究输出，不构成买入、仓位或自动交易指令。",
    ];
    const alphaRadar: PairAlphaRadarResponse = {
      service: "rhc-pair-alpha-radar",
      generatedAt: this.now().toISOString(),
      observedAt: batch.observedAt,
      status,
      stale: false,
      scope: "pair_all_generations",
      monitoring: {
        hotMarketPollSeconds: this.settings.hotMarketPollSeconds,
        fullUniversePollSeconds: this.settings.marketPollSeconds,
      },
      overview: {
        officialUniverseCount: tokens.length,
        visibleUniverseCount: tokens.filter((token) => !token.hidden && !token.flagged).length,
        monitoredMarketCount: alphaTokens.length,
        shortWindowObservedCount: alphaTokens.filter((token) => Boolean(token.shortWindow)).length,
        v1Count: generationCounts.find((item) => item.generation === "v1")?.count ?? 0,
        v2Count: generationCounts.find((item) => item.generation === "v2")?.count ?? 0,
        ignitionCount: actionCount("ignition_watch"),
        retestCount: actionCount("retest_watch"),
        researchCount: actionCount("probe_eligible") + actionCount("confirmed"),
        noChaseCount: actionCount("no_chase"),
        riskHaltCount: actionCount("risk_halt"),
        canonicalGrossVolume5mUsd: sumObserved(
          alphaTokens.map((token) => token.shortWindow?.volume5mUsd ?? null),
        ),
        canonicalGrossVolume1hUsd: sumObserved(
          alphaTokens.map((token) => token.shortWindow?.volume1hUsd ?? null),
        ),
        canonicalGrossVolume24hUsd: sumObserved(
          alphaTokens.map((token) => token.volumeEvidence.canonicalGross24hUsd),
        ),
        primaryPoolVolume24hUsd: sumObserved(
          alphaTokens.map((token) => token.volumeEvidence.primaryPool24hUsd),
        ),
        liquidityUsd: sumObserved(alphaTokens.map((token) => token.liquidityUsd)),
      },
      generationCounts,
      alphaModel,
      tokens: returnedAlphaTokens,
      sources: batch.sourceHealth,
      alerts: this.database.alertSummary(this.notifier.configured),
      warnings: [...new Set(alphaWarnings)],
    };
    return {
      service: "rhc-pair-v2-monitor",
      generatedAt: this.now().toISOString(),
      observedAt: batch.observedAt,
      status,
      stale: false,
      monitoring: {
        chainPollSeconds: this.settings.chainPollSeconds,
        marketPollSeconds: this.settings.marketPollSeconds,
        hotMarketPollSeconds: this.settings.hotMarketPollSeconds,
        staleAfterSeconds: this.settings.staleAfterSeconds,
      },
      release: {
        ...release,
        sourceVerification: "active_graph_unverified",
        auditEvidence: "not_observed",
        upgradeAuthority: "single_eoa_observed",
      },
      overview: {
        latestBlock: batch.latestBlock,
        publicV2TokenCount: tokens.filter((token) => token.launchVersion === "v2").length,
        currentReleaseLaunchCount: launches.length,
        currentReleaseIndexedCount: indexedCurrent.length,
        marketCoveragePercent: safePercent(indexedCurrent.length, launches.length),
        officialPoolTokenCount: officialPoolMarket.length,
        officialPoolVolume5mUsd: sumObserved(
          officialPoolMarket.map((token) => token.shortWindow?.volume5mUsd ?? null),
        ),
        officialPoolVolume1hUsd: sumObserved(
          officialPoolMarket.map((token) => token.shortWindow?.volume1hUsd ?? null),
        ),
        officialPoolVolume24hUsd: sumObserved(
          officialPoolMarket.map((token) => token.shortWindow?.volume24hUsd ?? null),
        ),
        officialPoolLiquidityUsd: sumObserved(
          officialPoolMarket.map((token) => token.liquidityUsd),
        ),
        volume24hUsd: sum(visibleMarket.map((token) => token.volume24hUsd)),
        marketCapUsd: sum(visibleMarket.map((token) => token.marketCapUsd)),
        liquidityUsd: visibleMarket.some((token) => token.liquidityUsd !== null)
          ? sum(visibleMarket.map((token) => token.liquidityUsd))
          : null,
        userFees24hUsd: sum(visibleMarket.map((token) => token.fees.userFees24hUsd)),
        modeShare24hUsd: sum(visibleMarket.map((token) => token.fees.modeShare24hUsd)),
        protocolShare24hUsd: sum(visibleMarket.map((token) => token.fees.protocolShare24hUsd)),
        buybackModeVolume24hUsd: sum(buybackTokens.map((token) => token.volume24hUsd)),
        buybackBudget24hUsd: sum(buybackTokens.map((token) => token.fees.modeShare24hUsd)),
        buybackExecutedCount: events.filter((event) => event.type === "buyback_executed").length,
        holderClaimCount: events.filter((event) => event.type === "holder_claim").length,
        upgradeCount: events.filter((event) => event.type === "upgrade").length,
      },
      modeCounts,
      alphaModel: v2AlphaModel,
      tokens: currentTokens,
      events: responseEvents,
      sources: batch.sourceHealth,
      alerts: this.database.alertSummary(this.notifier.configured),
      warnings: [
        ...batch.warnings,
        "当前生产合约图尚未完成源码与公开审计闭环；风险分与机会分保持分离。",
      ],
      alphaRadar,
    };
  }

  snapshot(): PairV2DashboardResponse | null {
    const payload = this.dashboardCache;
    return payload ? this.withFreshness(payload) : null;
  }

  token(address: string): PairV2TokenView | null {
    const normalized = address.toLowerCase();
    return this.snapshot()?.tokens.find((token) => token.address === normalized) ?? null;
  }

  alpha(): PairAlphaRadarResponse | null {
    return this.snapshot()?.alphaRadar ?? null;
  }

  alphaToken(address: string): PairAlphaTokenView | null {
    const normalized = address.toLowerCase();
    return this.alpha()?.tokens.find((token) => token.address === normalized) ?? null;
  }

  events(limit = 100): { observedAt: string | null; items: PairV2ChainEvent[] } {
    const snapshot = this.snapshot();
    return {
      observedAt: snapshot?.observedAt ?? null,
      items: snapshot?.events.slice(0, limit) ?? [],
    };
  }

  health() {
    const latest = this.database.latestRun();
    const snapshot = this.snapshot();
    return {
      ok: snapshot !== null,
      service: "rhc-pair-v2-monitor",
      latestRunStatus: latest?.status ?? "empty",
      lastRunKind: latest?.kind ?? null,
      observedAt: snapshot?.observedAt ?? null,
      latestBlock: snapshot?.overview.latestBlock ?? null,
      stale: snapshot?.stale ?? true,
      backgroundMonitor:
        this.chainTimer !== null && this.hotMarketTimer !== null && this.marketTimer !== null,
      chainPollSeconds: this.settings.chainPollSeconds,
      hotMarketPollSeconds: this.settings.hotMarketPollSeconds,
      marketPollSeconds: this.settings.marketPollSeconds,
      alerts: this.database.alertSummary(this.notifier.configured),
      generatedAt: this.now().toISOString(),
    };
  }

  start(): void {
    if (this.chainTimer || this.hotMarketTimer || this.marketTimer) return;
    this.chainTimer = setInterval(() => {
      void this.refresh("chain").catch((error) => {
        this.warn("pair_v2_chain_poll_failed", {
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      });
    }, this.settings.chainPollSeconds * 1_000);
    this.hotMarketTimer = setInterval(() => {
      void this.refresh("hot").catch((error) => {
        this.warn("pair_alpha_hot_market_poll_failed", {
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      });
    }, this.settings.hotMarketPollSeconds * 1_000);
    this.marketTimer = setInterval(() => {
      void this.refresh("full").catch((error) => {
        this.warn("pair_v2_market_poll_failed", {
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      });
    }, this.settings.marketPollSeconds * 1_000);
    this.chainTimer.unref();
    this.hotMarketTimer.unref();
    this.marketTimer.unref();
  }

  stop(): void {
    if (this.chainTimer) clearInterval(this.chainTimer);
    if (this.hotMarketTimer) clearInterval(this.hotMarketTimer);
    if (this.marketTimer) clearInterval(this.marketTimer);
    this.chainTimer = null;
    this.hotMarketTimer = null;
    this.marketTimer = null;
  }

  private withFreshness(payload: PairV2DashboardResponse): PairV2DashboardResponse {
    const latestUsable = this.database.latestUsableRun();
    const freshnessAt = latestUsable?.completedAt ?? payload.observedAt;
    const observed = Date.parse(freshnessAt);
    const stale =
      !Number.isFinite(observed) ||
      this.now().valueOf() - observed >= this.settings.staleAfterSeconds * 1_000;
    const generatedAt = this.now().toISOString();
    const alphaRadar = payload.alphaRadar
      ? {
          ...payload.alphaRadar,
          generatedAt,
          stale,
          alerts: this.database.alertSummary(this.notifier.configured),
          warnings: stale
            ? [...new Set([...payload.alphaRadar.warnings, "PAIR Alpha 雷达已超过预期更新时间。"])]
            : payload.alphaRadar.warnings,
        }
      : undefined;
    const refreshed = {
      ...payload,
      generatedAt,
      stale,
      warnings: stale
        ? [...new Set([...payload.warnings, "PAIR V2 监控已超过预期更新时间。"])]
        : payload.warnings,
      alerts: this.database.alertSummary(this.notifier.configured),
    };
    return alphaRadar ? { ...refreshed, alphaRadar } : refreshed;
  }
}
