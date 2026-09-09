export type RuntimeVerificationCode =
  | "INVALID_BASE_URL"
  | "RUNTIME_UNREACHABLE"
  | "RUNTIME_HTTP_ERROR"
  | "RUNTIME_INVALID_JSON"
  | "RUNTIME_CONTRACT_ERROR"
  | "RUNTIME_NOT_READY";

export class RuntimeVerificationError extends Error {
  constructor(
    readonly code: RuntimeVerificationCode,
    message: string,
  ) {
    super(message);
    this.name = "RuntimeVerificationError";
  }
}

export interface RuntimeEndpointCheck {
  path: string;
  status: number;
  targetDate: string | null;
  itemCount: number | null;
}

export interface RuntimeVerificationResult {
  ok: true;
  checkedAt: string;
  checks: RuntimeEndpointCheck[];
}

export interface RuntimeVerifierOptions {
  fetcher?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeBaseUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new RuntimeVerificationError("INVALID_BASE_URL", "Base URL must be a valid URL");
  }
  if (!new Set(["http:", "https:"]).has(parsed.protocol) || parsed.username || parsed.password) {
    throw new RuntimeVerificationError(
      "INVALID_BASE_URL",
      "Base URL must use HTTP(S) without embedded credentials",
    );
  }
  return new URL("/", parsed);
}

async function readJson(
  baseUrl: URL,
  path: string,
  fetcher: typeof fetch,
  timeoutMs: number,
): Promise<{ status: number; payload: Record<string, unknown> }> {
  let response: Response;
  try {
    response = await fetcher(new URL(path, baseUrl), {
      method: "GET",
      redirect: "error",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new RuntimeVerificationError(
      "RUNTIME_UNREACHABLE",
      "Runtime endpoint could not be reached",
    );
  }
  if (!response.ok) {
    throw new RuntimeVerificationError(
      "RUNTIME_HTTP_ERROR",
      "Runtime endpoint returned a non-success status",
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new RuntimeVerificationError("RUNTIME_INVALID_JSON", "Runtime response was not JSON");
  }
  if (!isRecord(payload)) {
    throw new RuntimeVerificationError(
      "RUNTIME_CONTRACT_ERROR",
      "Runtime response did not match the expected object shape",
    );
  }
  return { status: response.status, payload };
}

function targetDate(payload: Record<string, unknown>): string | null {
  return typeof payload.targetDate === "string" ? payload.targetDate : null;
}

const PAIR_RANKING_KEYS = [
  "market_cap_usd",
  "liquidity_depth_usd",
  "volume_24h_usd",
  "holder_count",
] as const;

export async function verifyRuntime(
  baseUrl: string,
  options: RuntimeVerifierOptions = {},
): Promise<RuntimeVerificationResult> {
  const base = safeBaseUrl(baseUrl);
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const now = options.now ?? (() => new Date());
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new RuntimeVerificationError(
      "INVALID_BASE_URL",
      "Runtime timeout must be between 1 and 30000 milliseconds",
    );
  }

  const health = await readJson(base, "/healthz", fetcher, timeoutMs);
  if (health.payload.ok !== true || typeof health.payload.service !== "string") {
    throw new RuntimeVerificationError("RUNTIME_NOT_READY", "Runtime has no usable cache");
  }

  const overview = await readJson(base, "/api/overview?window=30", fetcher, timeoutMs);
  if (
    typeof overview.payload.targetDate !== "string" ||
    !Array.isArray(overview.payload.platforms)
  ) {
    throw new RuntimeVerificationError(
      "RUNTIME_CONTRACT_ERROR",
      "Overview response did not match the expected contract",
    );
  }

  const platformActivity = await readJson(base, "/api/platform-activity", fetcher, timeoutMs);
  const activityPlatforms = platformActivity.payload.platforms;
  if (
    platformActivity.payload.service !== "rhc-platform-activity" ||
    platformActivity.payload.modelVersion !== "platform-activity-v1" ||
    typeof platformActivity.payload.targetDate !== "string" ||
    !Array.isArray(activityPlatforms) ||
    !isRecord(platformActivity.payload.comparisons) ||
    !["pons", "long", "pair"].every((platformId) =>
      activityPlatforms.some(
        (row) =>
          isRecord(row) &&
          row.platformId === platformId &&
          isRecord(row.activity) &&
          isRecord(row.volumes),
      ),
    )
  ) {
    throw new RuntimeVerificationError(
      "RUNTIME_CONTRACT_ERROR",
      "Platform activity response did not match the expected contract",
    );
  }

  const pairDailyVolumeAlert = await readJson(
    base,
    "/api/platform-activity/alerts/health",
    fetcher,
    timeoutMs,
  );
  if (
    pairDailyVolumeAlert.payload.ok !== true ||
    pairDailyVolumeAlert.payload.service !== "rhc-pair-daily-volume-alert" ||
    pairDailyVolumeAlert.payload.configured !== true ||
    pairDailyVolumeAlert.payload.platformId !== "pair" ||
    pairDailyVolumeAlert.payload.metric !== "volume_usd" ||
    pairDailyVolumeAlert.payload.comparison !== "last_two_complete_utc_days" ||
    pairDailyVolumeAlert.payload.thresholdPct !== 10
  ) {
    throw new RuntimeVerificationError(
      "RUNTIME_NOT_READY",
      "PAIR daily volume alert is not configured for the 10 percent threshold",
    );
  }

  const sources = await readJson(base, "/api/sources", fetcher, timeoutMs);
  if (!Array.isArray(sources.payload.sources)) {
    throw new RuntimeVerificationError(
      "RUNTIME_CONTRACT_ERROR",
      "Sources response did not match the expected contract",
    );
  }

  const pairHealth = await readJson(base, "/api/pair/health", fetcher, timeoutMs);
  if (pairHealth.payload.ok !== true || pairHealth.payload.service !== "rhc-pair-token-radar") {
    throw new RuntimeVerificationError("RUNTIME_NOT_READY", "PAIR token radar has no usable cache");
  }

  const pairRankings = await readJson(base, "/api/pair/rankings", fetcher, timeoutMs);
  const pairSnapshot = pairRankings.payload.snapshot;
  const rankings = pairRankings.payload.rankings;
  if (
    pairRankings.payload.service !== "rhc-pair-token-radar" ||
    !isRecord(pairSnapshot) ||
    !isRecord(rankings) ||
    !PAIR_RANKING_KEYS.every(
      (key) => isRecord(rankings[key]) && Array.isArray(rankings[key].entries),
    )
  ) {
    throw new RuntimeVerificationError(
      "RUNTIME_CONTRACT_ERROR",
      "PAIR rankings response did not match the expected contract",
    );
  }

  const pairFlow = await readJson(base, "/api/pair/flow", fetcher, timeoutMs);
  if (
    pairFlow.payload.service !== "rhc-pair-flow" ||
    !isRecord(pairFlow.payload.window) ||
    !isRecord(pairFlow.payload.volume) ||
    !isRecord(pairFlow.payload.burn) ||
    !isRecord(pairFlow.payload.buyback) ||
    !isRecord(pairFlow.payload.pressure) ||
    !Array.isArray(pairFlow.payload.sources)
  ) {
    throw new RuntimeVerificationError(
      "RUNTIME_CONTRACT_ERROR",
      "PAIR flow response did not match the expected contract",
    );
  }

  const pairV2Health = await readJson(base, "/api/pair/v2/health", fetcher, timeoutMs);
  if (
    pairV2Health.payload.ok !== true ||
    pairV2Health.payload.service !== "rhc-pair-v2-monitor" ||
    pairV2Health.payload.backgroundMonitor !== true
  ) {
    throw new RuntimeVerificationError(
      "RUNTIME_NOT_READY",
      "PAIR V2 autonomous monitor has no usable cache",
    );
  }

  const pairV2 = await readJson(base, "/api/pair/v2", fetcher, timeoutMs);
  if (
    pairV2.payload.service !== "rhc-pair-v2-monitor" ||
    !isRecord(pairV2.payload.release) ||
    pairV2.payload.release.canonical !== true ||
    !isRecord(pairV2.payload.overview) ||
    !isRecord(pairV2.payload.monitoring) ||
    !Array.isArray(pairV2.payload.tokens) ||
    !Array.isArray(pairV2.payload.events) ||
    !Array.isArray(pairV2.payload.sources)
  ) {
    throw new RuntimeVerificationError(
      "RUNTIME_CONTRACT_ERROR",
      "PAIR V2 response did not match the expected contract",
    );
  }

  const devMonitor = await readJson(base, "/api/dev-monitor/health", fetcher, timeoutMs);
  if (
    devMonitor.payload.service !== "rhc-dev-monitor" ||
    devMonitor.payload.enabled !== true ||
    devMonitor.payload.baselineComplete !== true ||
    !["success", "partial"].includes(String(devMonitor.payload.status)) ||
    !isRecord(devMonitor.payload.counts) ||
    !isRecord(devMonitor.payload.alerts) ||
    devMonitor.payload.alerts.configured !== true ||
    devMonitor.payload.alerts.policy !== "pair_team_wallet_only" ||
    !Array.isArray(devMonitor.payload.sources)
  ) {
    throw new RuntimeVerificationError(
      "RUNTIME_NOT_READY",
      "DEV creator monitor has not completed its server-side baseline",
    );
  }

  const pairDevLaunches = await readJson(
    base,
    "/api/dev-monitor/pair-launches?tier=all&limit=20&offset=0",
    fetcher,
    timeoutMs,
  );
  if (
    pairDevLaunches.payload.service !== "rhc-dev-monitor" ||
    pairDevLaunches.payload.scope !== "pair_v2_public_launches" ||
    !isRecord(pairDevLaunches.payload.counts) ||
    typeof pairDevLaunches.payload.total !== "number" ||
    !Array.isArray(pairDevLaunches.payload.items)
  ) {
    throw new RuntimeVerificationError(
      "RUNTIME_CONTRACT_ERROR",
      "PAIR DEV launch feed did not match the expected public contract",
    );
  }

  const pairTeamLaunches = await readJson(
    base,
    "/api/dev-monitor/pair-team-launches?limit=20&offset=0",
    fetcher,
    timeoutMs,
  );
  if (
    pairTeamLaunches.payload.service !== "rhc-dev-monitor" ||
    pairTeamLaunches.payload.scope !== "pair_official_team_launches" ||
    !isRecord(pairTeamLaunches.payload.issuer) ||
    pairTeamLaunches.payload.issuer.verification !== "verified_primary_issuer" ||
    !isRecord(pairTeamLaunches.payload.counts) ||
    typeof pairTeamLaunches.payload.total !== "number" ||
    !Array.isArray(pairTeamLaunches.payload.items)
  ) {
    throw new RuntimeVerificationError(
      "RUNTIME_CONTRACT_ERROR",
      "PAIR project-team launch feed did not match the expected public contract",
    );
  }

  const longHealth = await readJson(base, "/api/long/health", fetcher, timeoutMs);
  if (longHealth.payload.ok !== true || longHealth.payload.service !== "rhc-long-token-radar") {
    throw new RuntimeVerificationError("RUNTIME_NOT_READY", "Long token radar has no usable cache");
  }

  const longRankings = await readJson(base, "/api/long/rankings", fetcher, timeoutMs);
  const longSnapshot = longRankings.payload.snapshot;
  const longRankingRows = longRankings.payload.rankings;
  if (
    longRankings.payload.service !== "rhc-long-token-radar" ||
    !isRecord(longSnapshot) ||
    !isRecord(longRankingRows) ||
    !PAIR_RANKING_KEYS.every(
      (key) => isRecord(longRankingRows[key]) && Array.isArray(longRankingRows[key].entries),
    )
  ) {
    throw new RuntimeVerificationError(
      "RUNTIME_CONTRACT_ERROR",
      "Long rankings response did not match the expected contract",
    );
  }

  const economicsHealth = await readJson(base, "/api/economics/health", fetcher, timeoutMs);
  if (
    economicsHealth.payload.ok !== true ||
    economicsHealth.payload.service !== "rhc-launchpad-economics"
  ) {
    throw new RuntimeVerificationError(
      "RUNTIME_NOT_READY",
      "Launchpad economics comparison has no usable cache",
    );
  }

  const economics = await readJson(base, "/api/economics", fetcher, timeoutMs);
  const economicsPlatforms = economics.payload.platforms;
  const economicsTokens = economics.payload.tokens;
  if (
    economics.payload.service !== "rhc-launchpad-economics" ||
    typeof economics.payload.targetDate !== "string" ||
    !Array.isArray(economicsTokens) ||
    !Array.isArray(economicsPlatforms) ||
    !Array.isArray(economics.payload.buybacks) ||
    !isRecord(economics.payload.pairRelativeValuation) ||
    !["pons", "long", "pair"].every((platformId) =>
      economicsPlatforms.some((row) => isRecord(row) && row.platformId === platformId),
    ) ||
    !["pons", "long", "pair"].every((platformId) =>
      economicsTokens.some(
        (row) => isRecord(row) && row.platformId === platformId && isRecord(row.priceUsd),
      ),
    )
  ) {
    throw new RuntimeVerificationError(
      "RUNTIME_CONTRACT_ERROR",
      "Economics response did not match the expected contract",
    );
  }

  const valuation = await readJson(base, "/api/economics/valuation", fetcher, timeoutMs);
  if (
    valuation.payload.modelVersion !== "pons-volume-parity-v1" ||
    !["available", "unavailable"].includes(String(valuation.payload.state)) ||
    !isRecord(valuation.payload.inputs) ||
    !Array.isArray(valuation.payload.commonDates)
  ) {
    throw new RuntimeVerificationError(
      "RUNTIME_CONTRACT_ERROR",
      "PAIR relative valuation did not match the expected contract",
    );
  }

  const valuationHistory = await readJson(
    base,
    "/api/economics/valuation/history",
    fetcher,
    timeoutMs,
  );
  if (
    valuationHistory.payload.service !== "rhc-launchpad-economics" ||
    valuationHistory.payload.window !== "7d" ||
    !Array.isArray(valuationHistory.payload.points) ||
    !Array.isArray(valuationHistory.payload.daily)
  ) {
    throw new RuntimeVerificationError(
      "RUNTIME_CONTRACT_ERROR",
      "PAIR relative valuation history did not match the expected contract",
    );
  }

  const intelligenceHealth = await readJson(base, "/api/intelligence/health", fetcher, timeoutMs);
  if (
    intelligenceHealth.payload.ok !== true ||
    intelligenceHealth.payload.service !== "rhc-market-intelligence"
  ) {
    throw new RuntimeVerificationError(
      "RUNTIME_NOT_READY",
      "Market intelligence has no usable cache",
    );
  }

  const intelligence = await readJson(base, "/api/intelligence", fetcher, timeoutMs);
  if (
    intelligence.payload.service !== "rhc-market-intelligence" ||
    !isRecord(intelligence.payload.leader) ||
    !isRecord(intelligence.payload.chainHeat) ||
    !isRecord(intelligence.payload.tokenHeat) ||
    !isRecord(intelligence.payload.relativeValuation) ||
    !isRecord(intelligence.payload.ponsForecast) ||
    intelligence.payload.ponsForecast.modelVersion !== "pons-regime-neighbors-v1" ||
    !Array.isArray(intelligence.payload.sources)
  ) {
    throw new RuntimeVerificationError(
      "RUNTIME_CONTRACT_ERROR",
      "Market intelligence response did not match the expected contract",
    );
  }

  const productHealth = await readJson(base, "/api/product/health", fetcher, timeoutMs);
  if (
    productHealth.payload.ok !== true ||
    productHealth.payload.service !== "rhc-product-workbench"
  ) {
    throw new RuntimeVerificationError(
      "RUNTIME_NOT_READY",
      "Unified product workbench has no usable cache",
    );
  }

  const product = await readJson(base, "/api/product/today", fetcher, timeoutMs);
  if (
    product.payload.service !== "rhc-product-workbench" ||
    product.payload.schemaVersion !== 1 ||
    !["success", "partial"].includes(String(product.payload.status)) ||
    !isRecord(product.payload.chain) ||
    !isRecord(product.payload.cashcat) ||
    !Array.isArray(product.payload.sources)
  ) {
    throw new RuntimeVerificationError(
      "RUNTIME_CONTRACT_ERROR",
      "Unified product response did not match the expected contract",
    );
  }

  return {
    ok: true,
    checkedAt: now().toISOString(),
    checks: [
      {
        path: "/healthz",
        status: health.status,
        targetDate: targetDate(health.payload),
        itemCount: null,
      },
      {
        path: "/api/overview?window=30",
        status: overview.status,
        targetDate: targetDate(overview.payload),
        itemCount: overview.payload.platforms.length,
      },
      {
        path: "/api/platform-activity",
        status: platformActivity.status,
        targetDate: targetDate(platformActivity.payload),
        itemCount: activityPlatforms.length,
      },
      {
        path: "/api/platform-activity/alerts/health",
        status: pairDailyVolumeAlert.status,
        targetDate: null,
        itemCount:
          typeof pairDailyVolumeAlert.payload.pending === "number"
            ? pairDailyVolumeAlert.payload.pending
            : null,
      },
      {
        path: "/api/sources",
        status: sources.status,
        targetDate: null,
        itemCount: sources.payload.sources.length,
      },
      {
        path: "/api/pair/health",
        status: pairHealth.status,
        targetDate: null,
        itemCount: null,
      },
      {
        path: "/api/pair/rankings",
        status: pairRankings.status,
        targetDate: null,
        itemCount:
          typeof pairSnapshot.eligibleCount === "number" ? pairSnapshot.eligibleCount : null,
      },
      {
        path: "/api/pair/flow",
        status: pairFlow.status,
        targetDate:
          isRecord(pairFlow.payload.window) &&
          typeof pairFlow.payload.window.calendarDate === "string"
            ? pairFlow.payload.window.calendarDate
            : null,
        itemCount: pairFlow.payload.sources.length,
      },
      {
        path: "/api/pair/v2/health",
        status: pairV2Health.status,
        targetDate: null,
        itemCount: null,
      },
      {
        path: "/api/pair/v2",
        status: pairV2.status,
        targetDate: null,
        itemCount: pairV2.payload.tokens.length,
      },
      {
        path: "/api/dev-monitor/health",
        status: devMonitor.status,
        targetDate: null,
        itemCount:
          typeof devMonitor.payload.counts.watched === "number"
            ? devMonitor.payload.counts.watched
            : null,
      },
      {
        path: "/api/dev-monitor/pair-launches?tier=all&limit=20&offset=0",
        status: pairDevLaunches.status,
        targetDate: null,
        itemCount: pairDevLaunches.payload.items.length,
      },
      {
        path: "/api/dev-monitor/pair-team-launches?limit=20&offset=0",
        status: pairTeamLaunches.status,
        targetDate: null,
        itemCount: pairTeamLaunches.payload.items.length,
      },
      {
        path: "/api/long/health",
        status: longHealth.status,
        targetDate: null,
        itemCount: null,
      },
      {
        path: "/api/long/rankings",
        status: longRankings.status,
        targetDate: null,
        itemCount:
          typeof longSnapshot.eligibleCount === "number" ? longSnapshot.eligibleCount : null,
      },
      {
        path: "/api/economics/health",
        status: economicsHealth.status,
        targetDate: targetDate(economicsHealth.payload),
        itemCount: null,
      },
      {
        path: "/api/economics",
        status: economics.status,
        targetDate: targetDate(economics.payload),
        itemCount: economicsPlatforms.length,
      },
      {
        path: "/api/economics/valuation",
        status: valuation.status,
        targetDate:
          typeof valuation.payload.platformWindowEnd === "string"
            ? valuation.payload.platformWindowEnd
            : null,
        itemCount:
          typeof valuation.payload.commonDayCount === "number"
            ? valuation.payload.commonDayCount
            : null,
      },
      {
        path: "/api/economics/valuation/history",
        status: valuationHistory.status,
        targetDate: null,
        itemCount: valuationHistory.payload.points.length,
      },
      {
        path: "/api/intelligence/health",
        status: intelligenceHealth.status,
        targetDate: null,
        itemCount: null,
      },
      {
        path: "/api/intelligence",
        status: intelligence.status,
        targetDate: null,
        itemCount: intelligence.payload.sources.length,
      },
      {
        path: "/api/product/health",
        status: productHealth.status,
        targetDate: null,
        itemCount: null,
      },
      {
        path: "/api/product/today",
        status: product.status,
        targetDate:
          isRecord(product.payload.chain) && typeof product.payload.chain.targetDate === "string"
            ? product.payload.chain.targetDate
            : null,
        itemCount: product.payload.sources.length,
      },
    ],
  };
}
