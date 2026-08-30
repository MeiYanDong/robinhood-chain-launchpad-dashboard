import type { OverviewResponse } from "../../domain/types.js";
import { BotError } from "../errors.js";
import type { QueryPlan } from "../intent/query-plan.js";
import type { LedgerClient } from "../ledger/client.js";
import { explainEvidence, type ExplanationResult } from "./explain.js";
import { buildPlatformResult, type PlatformResult } from "./platform.js";
import { rankPlatforms, type RankResult } from "./rank.js";
import { buildStatusResult, type StatusResult } from "./status.js";

export type DomainResult =
  | { kind: "help" }
  | { kind: "rank"; overview: OverviewResponse; result: RankResult }
  | { kind: "platform"; result: PlatformResult }
  | {
      kind: "explain";
      result: ExplanationResult;
      targetDate: string;
      generatedAt: string;
      runStatus: string;
      stale: boolean;
    }
  | { kind: "status"; result: StatusResult; generatedAt: string };

export class BotDomainService {
  constructor(private readonly ledger: LedgerClient) {}

  async execute(plan: QueryPlan): Promise<DomainResult> {
    if (plan.needsClarification) throw new BotError("QUERY_PLAN_INVALID");
    if (plan.action === "help") return { kind: "help" };
    if (plan.action === "status") return this.status();

    const meta = await this.ledger.getMeta();
    if (plan.platformId && !meta.platforms.some((platform) => platform.id === plan.platformId)) {
      throw new BotError("VERSION_NOT_AVAILABLE");
    }

    if (plan.action === "rank") {
      const [overview, sources] = await Promise.all([
        this.ledger.getOverview(plan.windowDays as 1 | 7 | 30),
        this.ledger.getSources(),
      ]);
      return {
        kind: "rank",
        overview,
        result: rankPlatforms(
          overview,
          plan.metric as "volume_usd" | "fees_usd" | "protocol_revenue_usd",
          plan.scope as "live" | "all",
          sources.sources,
        ),
      };
    }
    if (plan.action === "platform" && plan.platformId) {
      const [overview, detail, sources] = await Promise.all([
        this.ledger.getOverview(plan.windowDays as 1 | 7 | 30),
        this.ledger.getPlatform(plan.platformId),
        this.ledger.getSources(),
      ]);
      const result = buildPlatformResult(overview, detail, sources.sources);
      if (!result) throw new BotError("CONTRACT_INCOMPATIBLE");
      return { kind: "platform", result };
    }
    if (plan.action === "explain") {
      const [coverage, sources, overview] = await Promise.all([
        this.ledger.getCoverage(),
        this.ledger.getSources(),
        this.ledger.getOverview(1),
      ]);
      return {
        kind: "explain",
        result: explainEvidence(plan, coverage, sources.sources),
        targetDate: overview.targetDate,
        generatedAt: overview.generatedAt,
        runStatus: overview.runStatus,
        stale: overview.stale,
      };
    }
    throw new BotError("QUERY_PLAN_INVALID");
  }

  private async status(): Promise<DomainResult> {
    const [healthResult, sourcesResult] = await Promise.allSettled([
      this.ledger.getHealth(),
      this.ledger.getSources(),
    ]);
    const health = healthResult.status === "fulfilled" ? healthResult.value : null;
    const sources = sourcesResult.status === "fulfilled" ? sourcesResult.value : null;
    let contractCompatible = true;
    let meta = null;
    let overview = null;
    try {
      meta = await this.ledger.getMeta();
      overview = await this.ledger.getOverview(1);
    } catch (error) {
      if (
        error instanceof BotError &&
        (error.code === "CONTRACT_INCOMPATIBLE" || error.code === "VERSION_NOT_AVAILABLE")
      ) {
        contractCompatible = false;
      }
    }
    return {
      kind: "status",
      result: buildStatusResult({ health, meta, sources, overview, contractCompatible }),
      generatedAt: new Date().toISOString(),
    };
  }
}
