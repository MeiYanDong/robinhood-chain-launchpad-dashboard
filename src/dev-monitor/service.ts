import type { PairV2DashboardResponse } from "../pair-v2/types.js";
import type { PairTokenSnapshot } from "../pair/types.js";
import { DevMonitorFeishuNotifier, planDevMonitorAlerts } from "./alerts.js";
import {
  DEV_LAUNCH_SOURCES,
  DevMonitorCollector,
  deriveDevProfiles,
  pairV2Projects,
} from "./collector.js";
import type { DevMonitorSettings } from "./config.js";
import type { DevMonitorDatabase } from "./database.js";
import {
  buildDevMonitorNotificationEligibility,
  NON_PAIR_TEAM_NOTIFICATION_REASON,
  type DevMonitorNotificationEligibility,
} from "./notification-policy.js";
import {
  isPairOfficialProtocolToken,
  isPairPrimaryIssuer,
  PAIR_OFFICIAL_PROTOCOL_TOKEN,
  PAIR_PRIMARY_ISSUER,
} from "./pair-team.js";
import type {
  DevMonitorProfile,
  DevMonitorProject,
  DevMonitorSnapshot,
  DevMonitorSourceHealth,
  PairDevLaunchItem,
  PairDevLaunchesQuery,
  PairDevLaunchesResponse,
  PairTeamLaunchItem,
  PairTeamLaunchesQuery,
  PairTeamLaunchesResponse,
} from "./types.js";

export interface DevMonitorPairV2Source {
  snapshot(): PairV2DashboardResponse | null;
}

export interface DevMonitorPairTokenSource {
  token(address: string): PairTokenSnapshot | null;
}

export interface DevMonitorServiceDependencies {
  collector?: DevMonitorCollector;
  notifier?: DevMonitorFeishuNotifier;
  pairTokens?: DevMonitorPairTokenSource;
  now?: () => Date;
  wait?: (milliseconds: number) => Promise<void>;
  warn?: (event: string, context: Record<string, unknown>) => void;
}

function activeProfiles(profiles: DevMonitorProfile[], limit: number): DevMonitorProfile[] {
  return profiles
    .filter((profile) => profile.tier === "proven" || profile.tier === "repeat")
    .sort((left, right) => right.score - left.score || left.address.localeCompare(right.address))
    .slice(0, limit);
}

function sameProjectEvidence(left: DevMonitorProject, right: DevMonitorProject): boolean {
  return (
    left.address === right.address &&
    left.platform === right.platform &&
    left.creator === right.creator &&
    left.launchId === right.launchId &&
    left.transactionHash === right.transactionHash &&
    left.blockNumber === right.blockNumber &&
    left.blockHash === right.blockHash &&
    left.launchedAt === right.launchedAt &&
    left.attribution === right.attribution &&
    left.attributionConfidence === right.attributionConfidence &&
    left.symbol === right.symbol &&
    left.marketCapUsd === right.marketCapUsd &&
    left.liquidityUsd === right.liquidityUsd &&
    left.volume24hUsd === right.volume24hUsd &&
    left.qualityQualified === right.qualityQualified
  );
}

function sameStringList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameProfileEvidence(left: DevMonitorProfile, right: DevMonitorProfile): boolean {
  return (
    left.address === right.address &&
    left.tier === right.tier &&
    left.score === right.score &&
    left.label === right.label &&
    sameStringList(left.platforms, right.platforms) &&
    left.launchCount === right.launchCount &&
    left.qualifiedLaunchCount === right.qualifiedLaunchCount &&
    left.successfulLaunchCount === right.successfulLaunchCount &&
    left.topMarketCapUsd === right.topMarketCapUsd &&
    left.topLiquidityUsd === right.topLiquidityUsd &&
    left.topVolume24hUsd === right.topVolume24hUsd &&
    left.topProject?.address === right.topProject?.address &&
    left.topProject?.symbol === right.topProject?.symbol &&
    left.topProject?.platform === right.topProject?.platform &&
    sameStringList(left.reasons, right.reasons) &&
    left.firstSeenAt === right.firstSeenAt &&
    left.lastSeenAt === right.lastSeenAt
  );
}

function nextFromBlock(
  cursor: number | null,
  head: number,
  bootstrapBlocks: number,
  overlapBlocks: number,
): number {
  return cursor === null
    ? Math.max(0, head - bootstrapBlocks + 1)
    : Math.max(0, cursor - overlapBlocks + 1);
}

function pairQuoteAssets(
  snapshot: PairV2DashboardResponse | null,
  address: string,
  market: PairTokenSnapshot | null = null,
): Array<{ address: string; symbol: string; decimals: number }> {
  const normalizedAddress = address.toLowerCase();
  const v2Token = [...(snapshot?.tokens ?? []), ...(snapshot?.alphaRadar?.tokens ?? [])].find(
    (token) => token.address.toLowerCase() === normalizedAddress,
  );
  const pools = v2Token?.pools ?? [];
  const canonicalPools = pools.filter((pool) => pool.canonical !== false);
  const source = (canonicalPools.length > 0 ? canonicalPools : pools).map((pool) => pool.quote);
  const assets = source.length > 0 ? source : (market?.quoteAssets ?? []);
  return [
    ...new Map(
      assets.map((asset) => [
        asset.address.toLowerCase(),
        { ...asset, address: asset.address.toLowerCase() },
      ]),
    ).values(),
  ];
}

const MAX_BUY_SCAN_REDUCTIONS = 4;

export class DevMonitorService {
  private readonly collector: DevMonitorCollector;
  private readonly notifier: DevMonitorFeishuNotifier;
  private readonly pairTokens: DevMonitorPairTokenSource | null;
  private readonly now: () => Date;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private readonly warn: (event: string, context: Record<string, unknown>) => void;
  private refreshPromise: Promise<DevMonitorSnapshot> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private projectCache: DevMonitorProject[] | null = null;
  private projectIndex = new Map<string, number>();
  private pairProjectCache: DevMonitorProject[] | null = null;
  private profileCache: DevMonitorProfile[] | null = null;
  private profilesDirty = true;
  private notificationEligibilityCache: DevMonitorNotificationEligibility | null = null;

  constructor(
    private readonly database: DevMonitorDatabase,
    private readonly settings: DevMonitorSettings,
    private readonly pairV2: DevMonitorPairV2Source,
    dependencies: DevMonitorServiceDependencies = {},
  ) {
    this.collector = dependencies.collector ?? new DevMonitorCollector(settings);
    this.notifier = dependencies.notifier ?? new DevMonitorFeishuNotifier(settings);
    this.pairTokens = dependencies.pairTokens ?? null;
    this.now = dependencies.now ?? (() => new Date());
    this.wait =
      dependencies.wait ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.warn = dependencies.warn ?? ((event, context) => console.warn(event, context));
  }

  start(): void {
    if (!this.settings.enabled || this.timer) return;
    void this.refresh().catch((error) => {
      this.warn("dev_monitor_initial_refresh_failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    });
    this.timer = setInterval(() => {
      void this.refresh().catch((error) => {
        this.warn("dev_monitor_poll_failed", {
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      });
    }, this.settings.pollSeconds * 1_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  refresh(): Promise<DevMonitorSnapshot> {
    if (this.refreshPromise) return this.refreshPromise;
    const promise = this.refreshNow().finally(() => {
      this.refreshPromise = null;
    });
    this.refreshPromise = promise;
    return promise;
  }

  private projects(): DevMonitorProject[] {
    if (this.projectCache) return this.projectCache;
    this.projectCache = this.database.projects();
    this.projectIndex = new Map(
      this.projectCache.map((project, index) => [project.address, index] as const),
    );
    return this.projectCache;
  }

  private pairProjects(): DevMonitorProject[] {
    this.pairProjectCache ??= this.projects().filter((project) => project.platform === "pair_v2");
    return this.pairProjectCache;
  }

  private profiles(): DevMonitorProfile[] {
    this.profileCache ??= this.database.profiles();
    return this.profileCache;
  }

  private upsertProjects(projects: DevMonitorProject[]): DevMonitorProject[] {
    if (projects.length === 0) return [];
    const cached = this.projects();
    const changed = projects.filter((project) => {
      const index = this.projectIndex.get(project.address);
      const previous = index === undefined ? undefined : cached[index];
      return !previous || !sameProjectEvidence(previous, project);
    });
    if (changed.length === 0) return [];

    const inserted = this.database.upsertProjects(changed);
    for (const project of changed) {
      const index = this.projectIndex.get(project.address);
      if (index === undefined) {
        this.projectIndex.set(project.address, cached.length);
        cached.push(project);
      } else {
        cached[index] = project;
      }
    }
    this.pairProjectCache = null;
    this.profilesDirty = true;
    this.notificationEligibilityCache = null;
    return inserted;
  }

  private refreshProfiles(projects: DevMonitorProject[], observedAt: string): DevMonitorProfile[] {
    if (!this.profilesDirty) return this.profiles();
    const previous = this.profiles();
    const previousByAddress = new Map(previous.map((profile) => [profile.address, profile]));
    const current = deriveDevProfiles(projects, observedAt);
    const changed = current.filter((profile) => {
      const prior = previousByAddress.get(profile.address);
      return !prior || !sameProfileEvidence(prior, profile);
    });
    if (changed.length > 0) this.database.saveProfiles(changed);
    this.profileCache = current;
    this.profilesDirty = false;
    return current;
  }

  private notificationEligibility(
    projects: DevMonitorProject[],
  ): DevMonitorNotificationEligibility {
    this.notificationEligibilityCache ??= buildDevMonitorNotificationEligibility(projects);
    return this.notificationEligibilityCache;
  }

  private async refreshNow(): Promise<DevMonitorSnapshot> {
    const now = this.now();
    const observedAt = now.toISOString();
    if (!this.settings.enabled) return this.disabledSnapshot(observedAt);
    const baselineComplete = this.database.baselineComplete();
    const previousProfiles = this.profiles();
    const sources: DevMonitorSourceHealth[] = [];
    const warnings: string[] = [];
    let head: number;
    try {
      head = await this.collector.confirmedHead();
    } catch (error) {
      const snapshot = this.failedSnapshot(observedAt, error);
      this.database.saveSnapshot(snapshot);
      return snapshot;
    }

    const pairSnapshot = this.pairV2.snapshot();
    const pairProjects = pairV2Projects(pairSnapshot, observedAt);
    const insertedPairProjects = this.upsertProjects(pairProjects);
    const pairV2BaselineComplete = this.database.state("pair_v2_baseline_complete") === "1";
    if (pairSnapshot && !pairV2BaselineComplete) {
      this.database.setState("pair_v2_baseline_complete", "1", observedAt);
    }
    const alertableProjects =
      baselineComplete && pairV2BaselineComplete ? [...insertedPairProjects] : [];
    sources.push({
      id: "pair_v2",
      status: pairSnapshot ? "ok" : "degraded",
      observedAt,
      scannedFromBlock: null,
      scannedToBlock: pairSnapshot?.overview.latestBlock ?? null,
      observed: pairProjects.length,
      message: pairSnapshot
        ? `${String(pairProjects.length)} 个 PAIR V2 项目通过 canonical launch 事件绑定创建者。`
        : "PAIR V2 快照尚未就绪。",
    });

    for (const source of DEV_LAUNCH_SOURCES) {
      const cursor = this.database.cursor(source.id);
      const fromBlock = Math.max(
        source.startBlock,
        nextFromBlock(
          cursor,
          head,
          this.settings.launchBootstrapBlocks,
          this.settings.reorgOverlapBlocks,
        ),
      );
      try {
        const projects = await this.collector.scanLaunchSource(source, fromBlock, head);
        const inserted = this.upsertProjects(projects);
        if (cursor !== null && baselineComplete) alertableProjects.push(...inserted);
        this.database.setCursor(source.id, head, observedAt);
        sources.push({
          id: source.id,
          status: "ok",
          observedAt,
          scannedFromBlock: fromBlock,
          scannedToBlock: head,
          observed: projects.length,
          message: `${source.id} 官方发行事件已扫描。`,
        });
      } catch (error) {
        const errorName = error instanceof Error ? error.name : "UnknownError";
        warnings.push(`${source.id} 本轮扫描失败，游标未前移。`);
        sources.push({
          id: source.id,
          status: "failed",
          observedAt,
          scannedFromBlock: fromBlock,
          scannedToBlock: head,
          observed: 0,
          message: errorName,
        });
      }
    }

    const lastMarketAttempt = this.database.state("last_market_attempt_at");
    const lastMarketMs = lastMarketAttempt ? Date.parse(lastMarketAttempt) : Number.NaN;
    const marketDue =
      !Number.isFinite(lastMarketMs) ||
      now.valueOf() - lastMarketMs >= this.settings.marketPollSeconds * 1_000;
    if (marketDue) {
      this.database.setState("last_market_attempt_at", observedAt, observedAt);
      try {
        const enrichment = await this.collector.enrichProjects(this.projects());
        this.upsertProjects(enrichment.updates);
        const sourceStatus =
          enrichment.failedBatches === 0
            ? "ok"
            : enrichment.successfulBatches > 0
              ? "degraded"
              : "failed";
        if (sourceStatus === "ok") {
          this.database.setState("last_market_refresh_at", observedAt, observedAt);
        } else {
          warnings.push(
            `DexScreener 有 ${String(enrichment.failedBatches)}/${String(enrichment.totalBatches)} 个批次失败，失败项目保持未知。`,
          );
        }
        sources.push({
          id: "dexscreener",
          status: sourceStatus,
          observedAt,
          scannedFromBlock: null,
          scannedToBlock: null,
          observed: enrichment.updates.length,
          message: `${String(enrichment.updates.length)}/${String(enrichment.requestedProjects)} 个项目匹配公开市场；${String(enrichment.successfulBatches)}/${String(enrichment.totalBatches)} 个批次成功。`,
        });
      } catch (error) {
        warnings.push("DexScreener 项目画像更新失败，沿用链上归属与上次市场快照。");
        sources.push({
          id: "dexscreener",
          status: "degraded",
          observedAt,
          scannedFromBlock: null,
          scannedToBlock: null,
          observed: 0,
          message: error instanceof Error ? error.name : "UnknownError",
        });
      }
    }

    const projects = this.projects();
    const notificationEligibility = this.notificationEligibility(projects);
    const profiles = this.refreshProfiles(projects, observedAt);
    const watched = activeProfiles(profiles, this.settings.watchedDeveloperLimit);
    const buyCursor = this.database.cursor("dev_buys");
    const buyFromBlock = nextFromBlock(buyCursor, head, 1, this.settings.reorgOverlapBlocks);
    let insertedActivities = [] as Awaited<ReturnType<DevMonitorCollector["scanBuys"]>>;
    let alertableActivities = [] as Awaited<ReturnType<DevMonitorCollector["scanBuys"]>>;
    if (buyCursor === null) {
      this.database.setCursor("dev_buys", head, observedAt);
      sources.push({
        id: "dev_buys",
        status: "ok",
        observedAt,
        scannedFromBlock: head,
        scannedToBlock: head,
        observed: 0,
        message: "买入监控从当前确认区块建立基线，不补发历史交易。",
      });
    } else if (head - buyCursor > this.settings.buyMaxRecoverableLagBlocks) {
      const gapFromBlock = buyCursor + 1;
      this.database.setState(
        "dev_buys_last_gap",
        JSON.stringify({ fromBlock: gapFromBlock, toBlock: head, recordedAt: observedAt }),
        observedAt,
      );
      this.database.setCursor("dev_buys", head, observedAt);
      warnings.push(
        `DEV 买入游标落后 ${String(head - buyCursor)} 块，已跳过历史回放并恢复实时监听；缺口已留档，不发送旧信号。`,
      );
      sources.push({
        id: "dev_buys",
        status: "degraded",
        observedAt,
        scannedFromBlock: head,
        scannedToBlock: head,
        observed: 0,
        message: `实时监听已恢复；${String(gapFromBlock)}–${String(head)} 为未回填历史证据区间，不进入飞书。`,
      });
    } else {
      const requestedBuyToBlock = Math.min(
        head,
        buyFromBlock + this.settings.buyCatchupBlocksPerPoll - 1,
      );
      let buyToBlock = requestedBuyToBlock;
      let reductions = 0;
      try {
        let activities: Awaited<ReturnType<DevMonitorCollector["scanBuys"]>>;
        for (;;) {
          try {
            activities = await this.collector.scanBuys(buyFromBlock, buyToBlock, watched, projects);
            break;
          } catch (error) {
            if (buyToBlock <= buyFromBlock || reductions >= MAX_BUY_SCAN_REDUCTIONS) throw error;
            reductions += 1;
            buyToBlock = buyFromBlock + Math.floor((buyToBlock - buyFromBlock) / 2);
            await this.wait(Math.min(5_000, 1_000 * 2 ** (reductions - 1)));
          }
        }
        insertedActivities = this.database.upsertActivities(activities);
        this.database.setCursor("dev_buys", buyToBlock, observedAt);
        const caughtUp = buyToBlock >= head;
        if (caughtUp) alertableActivities = insertedActivities;
        const remainingBlocks = Math.max(0, head - buyToBlock);
        if (reductions > 0) {
          warnings.push(
            `DEV 买入扫描因 RPC 压力自适应缩小 ${String(reductions)} 次，本轮仍已保存成功进度。`,
          );
        }
        if (!caughtUp) {
          warnings.push(
            `DEV 买入扫描正在分段追赶，尚余 ${String(remainingBlocks)} 个确认区块；追赶期间不发送历史买入提醒。`,
          );
        }
        sources.push({
          id: "dev_buys",
          status: caughtUp ? "ok" : "degraded",
          observedAt,
          scannedFromBlock: buyFromBlock,
          scannedToBlock: buyToBlock,
          observed: insertedActivities.length,
          message: caughtUp
            ? `${String(watched.length)} 个重点 DEV 的 ERC-20 净流入与支付腿已核验。`
            : `${String(watched.length)} 个重点 DEV 正在安全追赶；本轮扫描 ${String(buyToBlock - buyFromBlock + 1)} 块，剩余 ${String(remainingBlocks)} 块，历史信号仅入证据账本。`,
        });
      } catch (error) {
        warnings.push("DEV 买入扫描失败，游标未前移。");
        sources.push({
          id: "dev_buys",
          status: "failed",
          observedAt,
          scannedFromBlock: buyFromBlock,
          scannedToBlock: buyToBlock,
          observed: 0,
          message: error instanceof Error ? error.name : "UnknownError",
        });
      }
    }

    if (
      this.notifier.configured &&
      (alertableProjects.length > 0 || alertableActivities.length > 0)
    ) {
      const alerts = planDevMonitorAlerts({
        baselineComplete,
        previousProfiles,
        currentProfiles: profiles,
        insertedProjects: alertableProjects,
        insertedActivities: alertableActivities,
        notificationEligibility,
        createdAt: observedAt,
      });
      this.database.enqueueAlerts(alerts, this.settings.alertDeveloperCooldownMinutes);
    }
    this.database.suppressIneligibleUnsentAlerts(
      notificationEligibility,
      observedAt,
      NON_PAIR_TEAM_NOTIFICATION_REASON,
    );
    await this.notifier.flush(this.database);
    if (!baselineComplete) this.database.setBaselineComplete(observedAt);

    const status = sources.some((source) => source.status !== "ok") ? "partial" : "success";
    const snapshot: DevMonitorSnapshot = {
      service: "rhc-dev-monitor",
      enabled: true,
      generatedAt: observedAt,
      observedAt,
      status,
      latestConfirmedBlock: head,
      pollSeconds: this.settings.pollSeconds,
      confirmations: this.settings.confirmations,
      baselineComplete: true,
      counts: {
        projects: projects.length,
        candidates: profiles.filter((profile) => profile.tier === "candidate").length,
        repeat: profiles.filter((profile) => profile.tier === "repeat").length,
        proven: profiles.filter((profile) => profile.tier === "proven").length,
        watched: watched.length,
        buys: this.database.activityCount(),
      },
      alerts: this.database.alertSummary(this.notifier.configured),
      sources,
      warnings,
    };
    this.database.saveSnapshot(snapshot);
    return snapshot;
  }

  health(): DevMonitorSnapshot {
    const generatedAt = this.now().toISOString();
    const snapshot = this.database.latestSnapshot();
    if (snapshot) {
      return {
        ...snapshot,
        generatedAt,
        alerts: this.database.alertSummary(this.notifier.configured),
      };
    }
    return this.settings.enabled
      ? this.startingSnapshot(generatedAt)
      : this.disabledSnapshot(generatedAt);
  }

  pairLaunches(query: PairDevLaunchesQuery): PairDevLaunchesResponse {
    const profiles = new Map(this.profiles().map((profile) => [profile.address, profile]));
    const pairSnapshot = this.pairV2.snapshot();
    const pairTokens = new Map(
      [...(pairSnapshot?.tokens ?? []), ...(pairSnapshot?.alphaRadar?.tokens ?? [])].map(
        (token) => [token.address.toLowerCase(), token],
      ),
    );
    const allItems = this.pairProjects()
      .flatMap((project): PairDevLaunchItem[] => {
        const profile = profiles.get(project.creator);
        if (!profile) return [];
        const token = pairTokens.get(project.address.toLowerCase());
        return [
          {
            address: project.address,
            name: token?.name ?? null,
            symbol: token?.symbol ?? project.symbol,
            creator: project.creator,
            creatorTier: profile.tier,
            creatorScore: profile.score,
            creatorLabel: profile.label,
            creatorLaunchCount: profile.launchCount,
            creatorQualifiedLaunchCount: profile.qualifiedLaunchCount,
            creatorSuccessfulLaunchCount: profile.successfulLaunchCount,
            transactionHash: project.transactionHash,
            blockNumber: project.blockNumber,
            launchedAt: project.launchedAt,
            attributionConfidence: project.attributionConfidence,
            modeId: token?.modeId ?? null,
            modeLabel: token?.modeLabel ?? null,
            priceUsd: token?.priceUsd ?? null,
            marketCapUsd: token?.marketCapUsd ?? project.marketCapUsd,
            liquidityUsd: token?.liquidityUsd ?? project.liquidityUsd,
            volume24hUsd: token?.volume24hUsd ?? project.volume24hUsd,
            holderCount: token?.holderCount ?? null,
            quoteAssets: pairQuoteAssets(pairSnapshot, project.address),
            qualityQualified:
              token?.alpha.quality.state === "qualified" || project.qualityQualified === true
                ? true
                : token?.alpha.quality.state === "unqualified" || project.qualityQualified === false
                  ? false
                  : null,
          },
        ];
      })
      .sort(
        (left, right) =>
          right.blockNumber - left.blockNumber || right.address.localeCompare(left.address),
      );
    const counts = {
      all: allItems.length,
      candidate: allItems.filter((item) => item.creatorTier === "candidate").length,
      repeat: allItems.filter((item) => item.creatorTier === "repeat").length,
      proven: allItems.filter((item) => item.creatorTier === "proven").length,
      watched: allItems.filter(
        (item) => item.creatorTier === "repeat" || item.creatorTier === "proven",
      ).length,
    };
    const filtered = allItems.filter((item) => {
      if (query.tier === "all") return true;
      if (query.tier === "watched") {
        return item.creatorTier === "repeat" || item.creatorTier === "proven";
      }
      return item.creatorTier === query.tier;
    });
    const latestSnapshot = this.database.latestSnapshot();
    return {
      service: "rhc-dev-monitor",
      scope: "pair_v2_public_launches",
      generatedAt: this.now().toISOString(),
      observedAt: latestSnapshot?.observedAt ?? null,
      tier: query.tier,
      limit: query.limit,
      offset: query.offset,
      total: filtered.length,
      counts,
      items: filtered.slice(query.offset, query.offset + query.limit),
    };
  }

  pairTeamLaunches(query: PairTeamLaunchesQuery): PairTeamLaunchesResponse {
    const pairSnapshot = this.pairV2.snapshot();
    const pairV2ObservedAt = pairSnapshot?.observedAt ?? null;
    const byAddress = new Map<string, PairTeamLaunchItem>();
    const currentReleaseItems = this.pairLaunches({ tier: "all", limit: 500, offset: 0 }).items;

    for (const item of currentReleaseItems.filter((candidate) =>
      isPairPrimaryIssuer(candidate.creator),
    )) {
      const market = this.pairTokens?.token(item.address) ?? null;
      const officiallyConfirmed = isPairOfficialProtocolToken(item.address);
      byAddress.set(item.address.toLowerCase(), {
        address: item.address,
        name: item.name ?? market?.name ?? null,
        symbol: item.symbol ?? market?.symbol ?? null,
        issuer: PAIR_PRIMARY_ISSUER.address,
        issuerLabel: PAIR_PRIMARY_ISSUER.label,
        relationship: officiallyConfirmed
          ? "official_protocol_token"
          : "verified_issuer_wallet_launch",
        relationshipLabel: officiallyConfirmed ? "官方协议代币" : "项目方钱包发行 · 未见官方确认",
        officiallyConfirmed,
        transactionHash: item.transactionHash,
        blockNumber: item.blockNumber,
        launchedAt: item.launchedAt,
        modeId: item.modeId,
        modeLabel: item.modeLabel,
        priceUsd: item.priceUsd ?? market?.priceUsd ?? null,
        marketCapUsd: item.marketCapUsd ?? market?.marketCapUsd ?? null,
        liquidityUsd: item.liquidityUsd ?? market?.liquidityDepthUsd ?? null,
        volume24hUsd: item.volume24hUsd ?? market?.volume24hUsd ?? null,
        holderCount: item.holderCount ?? market?.holderCount ?? null,
        quoteAssets: pairQuoteAssets(pairSnapshot, item.address, market),
        marketObservedAt: market?.marketDataUpdatedAt ?? market?.observedAt ?? pairV2ObservedAt,
      });
    }

    const protocolMarket = this.pairTokens?.token(PAIR_OFFICIAL_PROTOCOL_TOKEN.address) ?? null;
    const currentProtocol = byAddress.get(PAIR_OFFICIAL_PROTOCOL_TOKEN.address);
    byAddress.set(PAIR_OFFICIAL_PROTOCOL_TOKEN.address, {
      address: PAIR_OFFICIAL_PROTOCOL_TOKEN.address,
      name: currentProtocol?.name ?? protocolMarket?.name ?? PAIR_OFFICIAL_PROTOCOL_TOKEN.name,
      symbol:
        currentProtocol?.symbol ?? protocolMarket?.symbol ?? PAIR_OFFICIAL_PROTOCOL_TOKEN.symbol,
      issuer: PAIR_PRIMARY_ISSUER.address,
      issuerLabel: PAIR_PRIMARY_ISSUER.label,
      relationship: "official_protocol_token",
      relationshipLabel: "官方协议代币",
      officiallyConfirmed: true,
      transactionHash:
        currentProtocol?.transactionHash ?? PAIR_OFFICIAL_PROTOCOL_TOKEN.transactionHash,
      blockNumber: currentProtocol?.blockNumber ?? PAIR_OFFICIAL_PROTOCOL_TOKEN.blockNumber,
      launchedAt: currentProtocol?.launchedAt ?? PAIR_OFFICIAL_PROTOCOL_TOKEN.launchedAt,
      modeId: currentProtocol?.modeId ?? null,
      modeLabel: currentProtocol?.modeLabel ?? null,
      priceUsd: currentProtocol?.priceUsd ?? protocolMarket?.priceUsd ?? null,
      marketCapUsd: currentProtocol?.marketCapUsd ?? protocolMarket?.marketCapUsd ?? null,
      liquidityUsd: currentProtocol?.liquidityUsd ?? protocolMarket?.liquidityDepthUsd ?? null,
      volume24hUsd: currentProtocol?.volume24hUsd ?? protocolMarket?.volume24hUsd ?? null,
      holderCount: currentProtocol?.holderCount ?? protocolMarket?.holderCount ?? null,
      quoteAssets:
        currentProtocol?.quoteAssets ??
        pairQuoteAssets(pairSnapshot, PAIR_OFFICIAL_PROTOCOL_TOKEN.address, protocolMarket),
      marketObservedAt:
        currentProtocol?.marketObservedAt ??
        protocolMarket?.marketDataUpdatedAt ??
        protocolMarket?.observedAt ??
        pairV2ObservedAt,
    });

    const items = [...byAddress.values()].sort(
      (left, right) =>
        (right.blockNumber ?? -1) - (left.blockNumber ?? -1) ||
        right.address.localeCompare(left.address),
    );
    const latestSnapshot = this.database.latestSnapshot();
    return {
      service: "rhc-dev-monitor",
      scope: "pair_official_team_launches",
      generatedAt: this.now().toISOString(),
      observedAt: latestSnapshot?.observedAt ?? pairV2ObservedAt,
      issuer: {
        address: PAIR_PRIMARY_ISSUER.address,
        label: PAIR_PRIMARY_ISSUER.label,
        verification: "verified_primary_issuer",
        evidence: [...PAIR_PRIMARY_ISSUER.evidence],
      },
      limit: query.limit,
      offset: query.offset,
      total: items.length,
      counts: {
        officialProtocolTokens: items.filter((item) => item.officiallyConfirmed).length,
        verifiedIssuerWalletLaunches: items.filter((item) => !item.officiallyConfirmed).length,
      },
      items: items.slice(query.offset, query.offset + query.limit),
      warnings: [
        "同一项目方钱包发行只证明链上发送者一致；除官方明确确认的代币外，不代表 PAIR 品牌背书。",
        ...(protocolMarket
          ? []
          : ["PAIR 通用代币行情缓存尚未就绪，官方代币仍显示但行情保持未知。"]),
      ],
    };
  }

  private startingSnapshot(generatedAt: string): DevMonitorSnapshot {
    return {
      service: "rhc-dev-monitor",
      enabled: true,
      generatedAt,
      observedAt: null,
      status: "starting",
      latestConfirmedBlock: null,
      pollSeconds: this.settings.pollSeconds,
      confirmations: this.settings.confirmations,
      baselineComplete: false,
      counts: { projects: 0, candidates: 0, repeat: 0, proven: 0, watched: 0, buys: 0 },
      alerts: this.database.alertSummary(this.notifier.configured),
      sources: [],
      warnings: [],
    };
  }

  private disabledSnapshot(generatedAt: string): DevMonitorSnapshot {
    return {
      ...this.startingSnapshot(generatedAt),
      enabled: false,
      status: "disabled",
    };
  }

  private failedSnapshot(generatedAt: string, error: unknown): DevMonitorSnapshot {
    const previous = this.database.latestSnapshot();
    return {
      ...(previous ?? this.startingSnapshot(generatedAt)),
      enabled: true,
      generatedAt,
      observedAt: generatedAt,
      status: "failed",
      alerts: this.database.alertSummary(this.notifier.configured),
      warnings: [
        ...(previous?.warnings ?? []),
        `Robinhood Chain 确认区块读取失败：${error instanceof Error ? error.name : "UnknownError"}`,
      ],
    };
  }
}
