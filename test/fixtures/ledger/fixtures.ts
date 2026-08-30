import { CORE_METRICS } from "../../../src/domain/types.js";
import type {
  LedgerMetaResponse,
  MetricName,
  MetricQuality,
  MetricWindowValue,
  OverviewResponse,
  PlatformConfig,
  PlatformDetailResponse,
  PlatformOverviewRow,
  SourceHealth,
  WindowDays,
} from "../../../src/domain/types.js";
import { PLATFORM_REGISTRY } from "../../../src/config/platforms.js";
import type {
  LedgerCoverageResponse,
  LedgerHealthResponse,
  LedgerSourcesResponse,
} from "../../../src/bot/ledger/contract.js";

export const FIXTURE_DATE = "2026-08-29";
export const FIXTURE_GENERATED_AT = "2026-08-30T01:00:00.000Z";

function config(id: string): PlatformConfig {
  const platform = PLATFORM_REGISTRY.find((candidate) => candidate.id === id);
  if (!platform) throw new Error(`Fixture platform is missing: ${id}`);
  return platform;
}

function windowValue(
  value: number | null,
  windowDays: number,
  quality: MetricQuality = "reported",
): MetricWindowValue {
  return {
    value,
    observedDays: value === null ? 0 : windowDays,
    windowDays,
    coverage: value === null ? 0 : 1,
    latestDate: value === null ? null : FIXTURE_DATE,
    sources: value === null ? [] : ["fixture.source"],
    qualities: value === null ? [] : [quality],
  };
}

const VALUES: Record<string, Record<MetricName, number | null>> = {
  pons: {
    volume_usd: 5_000,
    fees_usd: 700,
    protocol_revenue_usd: 300,
    revenue_usd: 350,
  },
  letscash: {
    volume_usd: 3_000,
    fees_usd: 350,
    protocol_revenue_usd: 36,
    revenue_usd: 40,
  },
  long: {
    volume_usd: 3_000,
    fees_usd: null,
    protocol_revenue_usd: null,
    revenue_usd: null,
  },
  bankr: {
    volume_usd: 0,
    fees_usd: null,
    protocol_revenue_usd: null,
    revenue_usd: null,
  },
  flap: {
    volume_usd: null,
    fees_usd: 70,
    protocol_revenue_usd: 20,
    revenue_usd: 25,
  },
  stonkbrokers: {
    volume_usd: 9_000,
    fees_usd: 100,
    protocol_revenue_usd: 50,
    revenue_usd: 60,
  },
};

function row(id: string, windowDays: WindowDays): PlatformOverviewRow {
  const platform = config(id);
  const values = VALUES[id] as Record<MetricName, number | null>;
  const metrics = Object.fromEntries(
    CORE_METRICS.map((metric) => [
      metric,
      windowValue(values[metric], windowDays, platform.metricPolicies[metric]?.quality),
    ]),
  ) as Record<MetricName, MetricWindowValue>;
  return {
    id: platform.id,
    name: platform.name,
    status: platform.status,
    comparability: platform.comparability,
    excludeFromTotals: platform.excludeFromTotals,
    scope: platform.scope,
    notes: [...platform.notes],
    metrics,
  };
}

function summary(rows: PlatformOverviewRow[]): OverviewResponse["summary"] {
  const eligible = rows.filter((candidate) => !candidate.excludeFromTotals);
  const metrics = Object.fromEntries(
    CORE_METRICS.map((metric) => {
      const known = eligible.filter((candidate) => candidate.metrics[metric].value !== null);
      return [
        metric,
        {
          value:
            known.length === 0
              ? null
              : known.reduce(
                  (total, candidate) => total + (candidate.metrics[metric].value ?? 0),
                  0,
                ),
          observedDays: known.length,
          windowDays: eligible.length,
          coverage: eligible.length === 0 ? 0 : known.length / eligible.length,
          latestDate: known.length === 0 ? null : FIXTURE_DATE,
          sources: known.length === 0 ? [] : ["fixture.source"],
          qualities: [
            ...new Set(known.flatMap((candidate) => candidate.metrics[metric].qualities)),
          ],
        },
      ];
    }),
  ) as Record<MetricName, MetricWindowValue>;
  return {
    ...metrics,
    activePlatforms: rows.filter((candidate) =>
      CORE_METRICS.some((metric) => candidate.metrics[metric].value !== null),
    ).length,
    eligiblePlatforms: eligible.length,
  };
}

export function normalOverview(
  windowDays: WindowDays = 1,
  overrides: Partial<
    Pick<OverviewResponse, "stale" | "runStatus" | "warnings" | "targetDate">
  > = {},
): OverviewResponse {
  const platforms = ["pons", "letscash", "long", "bankr", "flap", "stonkbrokers"].map((id) =>
    row(id, windowDays),
  );
  return {
    targetDate: FIXTURE_DATE,
    windowDays,
    generatedAt: FIXTURE_GENERATED_AT,
    stale: false,
    runStatus: "success",
    summary: summary(platforms),
    platforms,
    warnings: [],
    ...overrides,
  };
}

export function normalMeta(overrides: Partial<LedgerMetaResponse> = {}): LedgerMetaResponse {
  return {
    service: "rhc-launch-ledger",
    appVersion: "0.4.0",
    apiContractVersion: 1,
    targetDate: FIXTURE_DATE,
    supportedWindows: [1, 7, 30],
    coreMetrics: CORE_METRICS,
    platforms: ["pons", "letscash", "long", "bankr", "flap", "stonkbrokers"].map((id) => ({
      id,
      status: config(id).status,
      supportedMetrics: Object.keys(config(id).metricPolicies) as MetricName[],
      hasRollingStats: id === "letscash" || id === "long",
    })),
    ...overrides,
  };
}

export function normalHealth(overrides: Partial<LedgerHealthResponse> = {}): LedgerHealthResponse {
  return {
    ok: true,
    service: "rhc-launch-ledger",
    targetDate: FIXTURE_DATE,
    latestRunStatus: "success",
    generatedAt: FIXTURE_GENERATED_AT,
    ...overrides,
  };
}

export function normalSources(sourceStatus: SourceHealth["status"] = "ok"): LedgerSourcesResponse {
  const run = {
    id: 1,
    startedAt: "2026-08-30T00:59:00.000Z",
    completedAt: FIXTURE_GENERATED_AT,
    targetDate: FIXTURE_DATE,
    status: sourceStatus === "ok" ? ("success" as const) : ("partial" as const),
    warnings: sourceStatus === "ok" ? [] : ["One or more source results require attention."],
    error: null,
  };
  return {
    generatedAt: FIXTURE_GENERATED_AT,
    usableRun: run,
    latestRun: run,
    sources: [
      {
        source: "fixture.source",
        status: sourceStatus,
        fetchedAt: FIXTURE_GENERATED_AT,
        latestDataDate: FIXTURE_DATE,
        latencyMs: 10,
        message:
          sourceStatus === "ok"
            ? "Source responded successfully."
            : sourceStatus === "degraded"
              ? "Source returned partial or degraded data."
              : "Source is currently unavailable.",
      },
    ],
  };
}

export function normalPlatform(id = "letscash"): PlatformDetailResponse {
  const platform = config(id);
  const metrics = VALUES[id] as Record<MetricName, number | null>;
  return {
    platform,
    targetDate: FIXTURE_DATE,
    generatedAt: FIXTURE_GENERATED_AT,
    series: Object.fromEntries(
      CORE_METRICS.map((metric) => [
        metric,
        metrics[metric] === null ? [] : [{ date: FIXTURE_DATE, value: metrics[metric] as number }],
      ]),
    ) as PlatformDetailResponse["series"],
    coverage: Object.fromEntries(
      CORE_METRICS.map((metric) => [
        metric,
        windowValue(metrics[metric], 64, platform.metricPolicies[metric]?.quality),
      ]),
    ) as PlatformDetailResponse["coverage"],
    stats:
      id === "letscash"
        ? [
            {
              platformId: id,
              key: "volume_rolling_24h_usd",
              label: "滚动 24H 成交量",
              value: 900,
              unit: "USD",
              period: "rolling_24h",
              source: "fixture.source",
              quality: "reported",
              scope: "fixture rolling snapshot",
              derivation: null,
              collectedAt: FIXTURE_GENERATED_AT,
            },
          ]
        : [],
  };
}

export function normalCoverage(): LedgerCoverageResponse {
  return {
    targetDate: FIXTURE_DATE,
    generatedAt: FIXTURE_GENERATED_AT,
    definitions: {
      volume_usd: "来源范围内的 USD 名义成交量。",
      fees_usd: "用户支付的全部费用。",
      protocol_revenue_usd: "归到协议、团队或金库的平台收入。",
      revenue_usd: "DefiLlama 较宽的 Revenue，不等于净利润。",
    },
    caveats: ["Missing observations remain null."],
    platforms: ["pons", "letscash", "long", "bankr", "flap", "stonkbrokers"].map((id) => {
      const platform = config(id);
      const overview = row(id, 30);
      return {
        id,
        name: platform.name,
        comparability: platform.comparability,
        excludeFromTotals: platform.excludeFromTotals,
        scope: platform.scope,
        notes: [...platform.notes],
        metrics: overview.metrics,
        metricPolicies: platform.metricPolicies,
      };
    }),
  };
}

export function normalRoutes(): Map<string, unknown> {
  return new Map<string, unknown>([
    ["/healthz", normalHealth()],
    ["/api/meta", normalMeta()],
    ["/api/overview?window=1", normalOverview(1)],
    ["/api/overview?window=7", normalOverview(7)],
    ["/api/overview?window=30", normalOverview(30)],
    ["/api/platforms/letscash", normalPlatform("letscash")],
    ["/api/platforms/bankr", normalPlatform("bankr")],
    ["/api/platforms/long", normalPlatform("long")],
    ["/api/coverage", normalCoverage()],
    ["/api/sources", normalSources()],
  ]);
}

export function fixtureFetcher(
  routes: Map<string, unknown> = normalRoutes(),
  requests: string[] = [],
): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const key = url.pathname + url.search;
    requests.push(`${init?.method ?? "GET"} ${key}`);
    const payload = routes.get(key);
    if (payload === undefined) {
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}
