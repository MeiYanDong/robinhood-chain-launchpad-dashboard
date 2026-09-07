import type {
  PairCollectionBatch,
  PairCollectionRun,
  PairMetricRanking,
  PairPublicSourceHealth,
  PairTokenMetricName,
} from "../pair/types.js";
import type { TokenMembershipRecord } from "../token-radar/database.js";

export type LongCollectionRun = PairCollectionRun;

export interface LongCollectionBatch extends PairCollectionBatch {
  verifiedMembership: TokenMembershipRecord[];
}

export interface LongLeaderboardResponse {
  service: "rhc-long-token-radar";
  mode: "live" | "daily";
  generatedAt: string;
  reportDate: string | null;
  windowStart: string | null;
  cutoffAt: string | null;
  snapshot: {
    runId: number;
    observedAt: string;
    status: "success" | "partial" | "failed";
    stale: boolean;
    universeCount: number;
    eligibleCount: number;
  } | null;
  eligibility: {
    marketCapFloorUsd: number;
    liquidityDepthFloorUsd: number;
    marketFreshnessMinutes: number;
  };
  rankings: Record<PairTokenMetricName, PairMetricRanking>;
  sources: PairPublicSourceHealth[];
  warnings: string[];
}
