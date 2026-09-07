export type DevMonitorPlatform = "pair_v2" | "pons_v1" | "pons_v2" | "long";
export type DevMonitorTier = "candidate" | "repeat" | "proven";
export type DevMonitorConfidence = "medium" | "high";

export interface DevMonitorProject {
  address: string;
  platform: DevMonitorPlatform;
  creator: string;
  launchId: string;
  transactionHash: string;
  blockNumber: number;
  blockHash: string | null;
  launchedAt: string | null;
  attribution: "canonical_event" | "canonical_event_transaction_sender";
  attributionConfidence: DevMonitorConfidence;
  symbol: string | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  qualityQualified: boolean | null;
  observedAt: string;
}

export interface DevMonitorProfile {
  address: string;
  tier: DevMonitorTier;
  score: number;
  label: string;
  platforms: DevMonitorPlatform[];
  launchCount: number;
  qualifiedLaunchCount: number;
  successfulLaunchCount: number;
  topMarketCapUsd: number | null;
  topLiquidityUsd: number | null;
  topVolume24hUsd: number | null;
  topProject: {
    address: string;
    symbol: string | null;
    platform: DevMonitorPlatform;
  } | null;
  reasons: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  updatedAt: string;
}

export interface DevMonitorAsset {
  address: string;
  symbol: string;
  decimals: number;
}

export interface DevMonitorActivity {
  id: string;
  type: "buy" | "initial_buy";
  developer: string;
  developerTier: Exclude<DevMonitorTier, "candidate">;
  transactionHash: string;
  blockNumber: number;
  blockHash: string;
  timestamp: string;
  target: DevMonitorAsset;
  targetAmountRaw: string;
  targetAmount: number | null;
  targetPlatform: DevMonitorPlatform | null;
  quote: DevMonitorAsset | { address: "native"; symbol: "ETH"; decimals: 18 };
  quoteAmountRaw: string;
  quoteAmount: number | null;
  transactionSender: string;
  confidence: DevMonitorConfidence;
  evidence: string[];
  observedAt: string;
}

export interface DevMonitorSourceHealth {
  id:
    | "pair_v2"
    | "pons_v1_active"
    | "pons_v1_legacy"
    | "pons_v2"
    | "long"
    | "dev_buys"
    | "dexscreener";
  status: "ok" | "degraded" | "failed";
  observedAt: string;
  scannedFromBlock: number | null;
  scannedToBlock: number | null;
  observed: number;
  message: string;
}

export interface DevMonitorAlert {
  dedupeKey: string;
  severity: "info" | "warning";
  type: "developer_launch" | "developer_buy" | "developer_promoted";
  title: string;
  message: string;
  developer: string;
  project: string | null;
  transactionHash: string | null;
  createdAt: string;
}

export interface DevMonitorAlertSummary {
  configured: boolean;
  policy: "pair_team_wallet_only";
  pending: number;
  failed: number;
  suppressed: number;
  lastSentAt: string | null;
}

export interface DevMonitorSnapshot {
  service: "rhc-dev-monitor";
  enabled: boolean;
  generatedAt: string;
  observedAt: string | null;
  status: "starting" | "success" | "partial" | "failed" | "disabled";
  latestConfirmedBlock: number | null;
  pollSeconds: number;
  confirmations: number;
  baselineComplete: boolean;
  counts: {
    projects: number;
    candidates: number;
    repeat: number;
    proven: number;
    watched: number;
    buys: number;
  };
  alerts: DevMonitorAlertSummary;
  sources: DevMonitorSourceHealth[];
  warnings: string[];
}

export type PairDevTierFilter = DevMonitorTier | "all" | "watched";

export interface PairDevLaunchesQuery {
  tier: PairDevTierFilter;
  limit: number;
  offset: number;
}

export interface PairDevLaunchItem {
  address: string;
  name: string | null;
  symbol: string | null;
  creator: string;
  creatorTier: DevMonitorTier;
  creatorScore: number;
  creatorLabel: string;
  creatorLaunchCount: number;
  creatorQualifiedLaunchCount: number;
  creatorSuccessfulLaunchCount: number;
  transactionHash: string;
  blockNumber: number;
  launchedAt: string | null;
  attributionConfidence: DevMonitorConfidence;
  modeId: number | null;
  modeLabel: string | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  holderCount: number | null;
  quoteAssets: DevMonitorAsset[];
  qualityQualified: boolean | null;
}

export interface PairDevLaunchesResponse {
  service: "rhc-dev-monitor";
  scope: "pair_v2_public_launches";
  generatedAt: string;
  observedAt: string | null;
  tier: PairDevTierFilter;
  limit: number;
  offset: number;
  total: number;
  counts: {
    all: number;
    candidate: number;
    repeat: number;
    proven: number;
    watched: number;
  };
  items: PairDevLaunchItem[];
}

export type PairTeamLaunchRelationship =
  | "official_protocol_token"
  | "verified_issuer_wallet_launch";

export interface PairTeamLaunchesQuery {
  limit: number;
  offset: number;
}

export interface PairTeamEvidence {
  kind: "official_token_api" | "onchain_launch_transaction";
  url: string;
  note: string;
}

export interface PairTeamLaunchItem {
  address: string;
  name: string | null;
  symbol: string | null;
  issuer: string;
  issuerLabel: string;
  relationship: PairTeamLaunchRelationship;
  relationshipLabel: string;
  officiallyConfirmed: boolean;
  transactionHash: string;
  blockNumber: number | null;
  launchedAt: string | null;
  modeId: number | null;
  modeLabel: string | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  holderCount: number | null;
  quoteAssets: DevMonitorAsset[];
  marketObservedAt: string | null;
}

export interface PairTeamLaunchesResponse {
  service: "rhc-dev-monitor";
  scope: "pair_official_team_launches";
  generatedAt: string;
  observedAt: string | null;
  issuer: {
    address: string;
    label: string;
    verification: "verified_primary_issuer";
    evidence: PairTeamEvidence[];
  };
  limit: number;
  offset: number;
  total: number;
  counts: {
    officialProtocolTokens: number;
    verifiedIssuerWalletLaunches: number;
  };
  items: PairTeamLaunchItem[];
  warnings: string[];
}
