import {
  dynamicPlatform,
  findRegisteredPlatform,
  metricPolicyFor,
  normalizePlatformName,
} from "../config/platforms.js";
import type { CollectionBatch, DailyMetric, MetricName, PlatformConfig } from "../domain/types.js";
import { fetchJson, finiteNumber, isRecord } from "../utils/http.js";
import { isDateOnOrBefore, unixSecondsToUtcDate } from "../utils/time.js";

const CHAIN_NAME = "Robinhood Chain";
const CHAIN_PATH = "Robinhood%20Chain";
const SUMMARY_CONCURRENCY = 8;

export interface DefiLlamaSourceDefinition {
  metric: MetricName;
  source: string;
  summarySource: string;
  endpoint: "fees" | "dexs";
  dataType: "dailyFees" | "dailyRevenue" | "dailyProtocolRevenue" | "dailyVolume";
  url: string;
}

export const DEFILLAMA_SOURCES: DefiLlamaSourceDefinition[] = [
  {
    metric: "fees_usd",
    source: "defillama.dailyFees",
    summarySource: "defillama.summary.dailyFees",
    endpoint: "fees",
    dataType: "dailyFees",
    url: `https://api.llama.fi/overview/fees/${CHAIN_PATH}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=false&dataType=dailyFees`,
  },
  {
    metric: "revenue_usd",
    source: "defillama.dailyRevenue",
    summarySource: "defillama.summary.dailyRevenue",
    endpoint: "fees",
    dataType: "dailyRevenue",
    url: `https://api.llama.fi/overview/fees/${CHAIN_PATH}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=false&dataType=dailyRevenue`,
  },
  {
    metric: "protocol_revenue_usd",
    source: "defillama.dailyProtocolRevenue",
    summarySource: "defillama.summary.dailyProtocolRevenue",
    endpoint: "fees",
    dataType: "dailyProtocolRevenue",
    url: `https://api.llama.fi/overview/fees/${CHAIN_PATH}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=false&dataType=dailyProtocolRevenue`,
  },
  {
    metric: "volume_usd",
    source: "defillama.dailyVolume",
    summarySource: "defillama.summary.dailyVolume",
    endpoint: "dexs",
    dataType: "dailyVolume",
    url: `https://api.llama.fi/overview/dexs/${CHAIN_PATH}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=false&dataType=dailyVolume`,
  },
];

export interface DefiLlamaProtocol {
  name: string;
  slug: string | null;
  platform: PlatformConfig;
}

interface ParsedMetricPayload {
  platforms: PlatformConfig[];
  protocols: DefiLlamaProtocol[];
  metrics: DailyMetric[];
  latestDataDate: string | null;
}

interface ParsedOverview {
  definition: DefiLlamaSourceDefinition;
  parsed: ParsedMetricPayload;
}

interface SummaryCandidate {
  definition: DefiLlamaSourceDefinition;
  protocol: DefiLlamaProtocol;
}

interface SummarySuccess {
  candidate: SummaryCandidate;
  fetched: Awaited<ReturnType<typeof fetchJson>>;
  parsed: ParsedMetricPayload;
}

interface SummaryFailure {
  candidate: SummaryCandidate;
  error: string;
}

interface SummaryCollectionResult
  extends Pick<CollectionBatch, "metrics" | "sourceHealth" | "raw" | "warnings"> {
  replacementKeys: Set<string>;
}

function launchpadProtocols(payload: Record<string, unknown>): DefiLlamaProtocol[] {
  const rawProtocols = Array.isArray(payload.protocols) ? payload.protocols : [];
  const protocols: DefiLlamaProtocol[] = [];

  for (const rawProtocol of rawProtocols) {
    if (!isRecord(rawProtocol) || typeof rawProtocol.name !== "string") continue;
    const category =
      typeof rawProtocol.category === "string" ? rawProtocol.category.toLowerCase() : "";
    if (category !== "launchpad") continue;

    const slug =
      typeof rawProtocol.slug === "string" && rawProtocol.slug.trim() !== ""
        ? rawProtocol.slug
        : null;
    const platform = findRegisteredPlatform(rawProtocol.name) ?? dynamicPlatform(rawProtocol.name);
    protocols.push({ name: rawProtocol.name, slug, platform });
  }

  return protocols;
}

function breakdownRows(payload: Record<string, unknown>): Array<[number, Record<string, unknown>]> {
  const raw = payload.totalDataChartBreakdown;
  if (!Array.isArray(raw)) return [];

  const rows: Array<[number, Record<string, unknown>]> = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const timestamp = finiteNumber(row[0]);
    const values = row[1];
    if (timestamp === null || !isRecord(values)) continue;
    rows.push([timestamp, values]);
  }
  return rows;
}

function metricFromValue(input: {
  platform: PlatformConfig;
  metric: MetricName;
  date: string;
  value: number;
  source: string;
  collectedAt: string;
  derivation: string | null;
}): DailyMetric {
  const policy = metricPolicyFor(input.platform, input.metric);
  return {
    platformId: input.platform.id,
    metric: input.metric,
    date: input.date,
    value: input.value,
    source: input.source,
    quality: policy.quality,
    scope: policy.scope,
    derivation: input.derivation ?? policy.note ?? null,
    collectedAt: input.collectedAt,
  };
}

export function extractDefiLlamaMetric(
  payload: unknown,
  metric: MetricName,
  source: string,
  targetDate: string,
  collectedAt: string,
): ParsedMetricPayload {
  if (!isRecord(payload)) {
    throw new Error("DefiLlama payload is not an object");
  }

  const protocols = launchpadProtocols(payload);
  const discoveredIndex = new Set(
    protocols.map((protocol) => normalizePlatformName(protocol.name)),
  );
  const platformById = new Map<string, PlatformConfig>();

  for (const protocol of protocols) platformById.set(protocol.platform.id, protocol.platform);

  const grouped = new Map<
    string,
    { platform: PlatformConfig; date: string; value: number; aliases: Set<string> }
  >();

  for (const [timestamp, values] of breakdownRows(payload)) {
    const date = unixSecondsToUtcDate(timestamp);
    if (!isDateOnOrBefore(date, targetDate)) continue;

    for (const [rawName, rawValue] of Object.entries(values)) {
      const registered = findRegisteredPlatform(rawName);
      if (!registered && !discoveredIndex.has(normalizePlatformName(rawName))) continue;

      const value = finiteNumber(rawValue);
      if (value === null || value < 0) continue;

      const platform = registered ?? dynamicPlatform(rawName);
      // Bankr has a first-party chain-split volume feed. Keep the canonical
      // Bankr series single-source instead of silently falling back to an
      // aggregator with a different accounting boundary.
      if (platform.id === "bankr") continue;
      platformById.set(platform.id, platform);
      const key = `${platform.id}\u0000${date}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.value += value;
        existing.aliases.add(rawName);
      } else {
        grouped.set(key, {
          platform,
          date,
          value,
          aliases: new Set([rawName]),
        });
      }
    }
  }

  const metrics: DailyMetric[] = [];
  let latestDataDate: string | null = null;
  for (const item of grouped.values()) {
    const groupedAliases = [...item.aliases];
    metrics.push(
      metricFromValue({
        platform: item.platform,
        metric,
        date: item.date,
        value: item.value,
        source,
        collectedAt,
        derivation:
          groupedAliases.length > 1
            ? `Canonical sum of adapter records: ${groupedAliases.join(", ")}`
            : null,
      }),
    );
    if (latestDataDate === null || item.date > latestDataDate) latestDataDate = item.date;
  }

  return {
    platforms: [...platformById.values()],
    protocols,
    metrics,
    latestDataDate,
  };
}

export function extractDefiLlamaSummaryMetric(
  payload: unknown,
  platform: PlatformConfig,
  protocolName: string,
  metric: MetricName,
  source: string,
  targetDate: string,
  collectedAt: string,
): ParsedMetricPayload {
  if (!isRecord(payload)) {
    throw new Error("DefiLlama protocol summary payload is not an object");
  }

  const metrics: DailyMetric[] = [];
  let latestDataDate: string | null = null;
  for (const [timestamp, values] of breakdownRows(payload)) {
    const date = unixSecondsToUtcDate(timestamp);
    if (!isDateOnOrBefore(date, targetDate)) continue;

    const chainValues = values[CHAIN_NAME];
    if (!isRecord(chainValues)) continue;

    let value = 0;
    let observed = false;
    for (const rawValue of Object.values(chainValues)) {
      const parsed = finiteNumber(rawValue);
      if (parsed === null || parsed < 0) continue;
      value += parsed;
      observed = true;
    }
    if (!observed) continue;

    metrics.push(
      metricFromValue({
        platform,
        metric,
        date,
        value,
        source,
        collectedAt,
        derivation: `Protocol-level Robinhood Chain summary for ${protocolName}; the chain overview is used only for discovery and failure fallback.`,
      }),
    );
    if (latestDataDate === null || date > latestDataDate) latestDataDate = date;
  }

  return {
    platforms: [platform],
    protocols: [{ name: protocolName, slug: null, platform }],
    metrics,
    latestDataDate,
  };
}

export function selectSummaryFallbacks(overviews: ParsedOverview[]): SummaryCandidate[] {
  const candidates = new Map<string, SummaryCandidate>();

  for (const overview of overviews) {
    for (const protocol of overview.parsed.protocols) {
      if (!protocol.slug || protocol.platform.id === "bankr") continue;
      const key = `${overview.definition.metric}\u0000${protocol.slug}`;
      candidates.set(key, { definition: overview.definition, protocol });
    }
  }

  return [...candidates.values()];
}

function summaryUrl(candidate: SummaryCandidate): string {
  const { definition, protocol } = candidate;
  return `https://api.llama.fi/summary/${definition.endpoint}/${encodeURIComponent(protocol.slug ?? "")}?dataType=${definition.dataType}`;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item !== undefined) results[index] = await mapper(item);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function mergeSummaryMetrics(successes: SummarySuccess[]): DailyMetric[] {
  const grouped = new Map<string, { metric: DailyMetric; protocolNames: Set<string> }>();

  for (const success of successes) {
    for (const metric of success.parsed.metrics) {
      const key = `${metric.platformId}\u0000${metric.metric}\u0000${metric.date}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.metric.value += metric.value;
        existing.protocolNames.add(success.candidate.protocol.name);
        if (metric.collectedAt > existing.metric.collectedAt) {
          existing.metric.collectedAt = metric.collectedAt;
        }
      } else {
        grouped.set(key, {
          metric: { ...metric },
          protocolNames: new Set([success.candidate.protocol.name]),
        });
      }
    }
  }

  return [...grouped.values()].map(({ metric, protocolNames }) => ({
    ...metric,
    derivation:
      protocolNames.size > 1
        ? `Canonical sum of Robinhood Chain protocol summaries: ${[...protocolNames].join(", ")}.`
        : metric.derivation,
  }));
}

function platformMetricKey(platformId: string, metric: MetricName): string {
  return `${platformId}\u0000${metric}`;
}

async function collectSummaryFallbacks(
  overviews: ParsedOverview[],
  targetDate: string,
): Promise<SummaryCollectionResult> {
  const candidates = selectSummaryFallbacks(overviews);
  if (candidates.length === 0) {
    return {
      metrics: [],
      sourceHealth: [],
      raw: [],
      warnings: [],
      replacementKeys: new Set(),
    };
  }

  const outcomes = await mapWithConcurrency<SummaryCandidate, SummarySuccess | SummaryFailure>(
    candidates,
    SUMMARY_CONCURRENCY,
    async (candidate) => {
      try {
        const fetched = await fetchJson(summaryUrl(candidate), { timeoutMs: 25_000, retries: 1 });
        const parsed = extractDefiLlamaSummaryMetric(
          fetched.payload,
          candidate.protocol.platform,
          candidate.protocol.name,
          candidate.definition.metric,
          candidate.definition.summarySource,
          targetDate,
          fetched.fetchedAt,
        );
        return { candidate, fetched, parsed };
      } catch (error) {
        return {
          candidate,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  const successes = outcomes.filter((outcome): outcome is SummarySuccess => "fetched" in outcome);
  const failures = outcomes.filter((outcome): outcome is SummaryFailure => "error" in outcome);
  const sourceHealth: CollectionBatch["sourceHealth"] = [];
  const warnings: string[] = [];
  const mergedMetrics = mergeSummaryMetrics(successes);
  const replacementKeys = new Set<string>();

  const candidateGroups = new Map<string, SummaryCandidate[]>();
  for (const candidate of candidates) {
    const key = platformMetricKey(candidate.protocol.platform.id, candidate.definition.metric);
    const group = candidateGroups.get(key) ?? [];
    group.push(candidate);
    candidateGroups.set(key, group);
  }
  for (const [key, expected] of candidateGroups) {
    const successful = successes.filter(
      (success) =>
        platformMetricKey(
          success.candidate.protocol.platform.id,
          success.candidate.definition.metric,
        ) === key,
    );
    const hasObservations = mergedMetrics.some(
      (metric) => platformMetricKey(metric.platformId, metric.metric) === key,
    );
    if (successful.length === expected.length && hasObservations) replacementKeys.add(key);
  }

  for (const definition of DEFILLAMA_SOURCES) {
    const expected = candidates.filter(
      (candidate) => candidate.definition.metric === definition.metric,
    );
    if (expected.length === 0) continue;
    const successful = successes.filter(
      (success) => success.candidate.definition.metric === definition.metric,
    );
    const failed = failures.filter(
      (failure) => failure.candidate.definition.metric === definition.metric,
    );
    const observations = successful.flatMap((success) => success.parsed.metrics);
    const latestDataDate = observations.reduce(
      (latest, metric) => (!latest || metric.date > latest ? metric.date : latest),
      null as string | null,
    );
    const fetchedAt =
      successful.reduce(
        (latest, success) =>
          success.fetched.fetchedAt > latest ? success.fetched.fetchedAt : latest,
        "",
      ) || new Date().toISOString();
    const empty = successful.filter((success) => success.parsed.metrics.length === 0).length;

    sourceHealth.push({
      source: definition.summarySource,
      status:
        successful.length === 0 ? "failed" : failed.length > 0 || empty > 0 ? "degraded" : "ok",
      fetchedAt,
      latestDataDate,
      latencyMs: successful.reduce(
        (maximum, success) => Math.max(maximum, success.fetched.latencyMs),
        0,
      ),
      message: `${successful.length}/${expected.length} protocol summaries fetched; ${observations.length} daily observations (${empty} empty responses).`,
    });

    if (failed.length > 0) {
      const details = failed
        .map((failure) => `${failure.candidate.protocol.name}: ${failure.error}`)
        .join(" | ");
      warnings.push(`${definition.summarySource} partial failure — ${details}`);
    }
  }

  return {
    metrics: mergedMetrics.filter((metric) =>
      replacementKeys.has(platformMetricKey(metric.platformId, metric.metric)),
    ),
    sourceHealth,
    raw: successes.map((success) => ({
      source: `${success.candidate.definition.summarySource}:${success.candidate.protocol.slug}`,
      fetchedAt: success.fetched.fetchedAt,
      sha256: success.fetched.sha256,
      payload: success.fetched.payload,
    })),
    warnings,
    replacementKeys,
  };
}

export async function collectDefiLlama(targetDate: string): Promise<CollectionBatch> {
  const settled = await Promise.allSettled(
    DEFILLAMA_SOURCES.map(async (definition) => ({
      definition,
      fetched: await fetchJson(definition.url, { timeoutMs: 25_000, retries: 1 }),
    })),
  );

  const platforms = new Map<string, PlatformConfig>();
  const metrics: DailyMetric[] = [];
  const sourceHealth: CollectionBatch["sourceHealth"] = [];
  const raw: CollectionBatch["raw"] = [];
  const warnings: string[] = [];
  const parsedOverviews: ParsedOverview[] = [];

  settled.forEach((result, index) => {
    const definition = DEFILLAMA_SOURCES[index];
    if (!definition) return;

    if (result.status === "rejected") {
      const message =
        result.reason instanceof Error ? result.reason.message : String(result.reason);
      sourceHealth.push({
        source: definition.source,
        status: "failed",
        fetchedAt: new Date().toISOString(),
        latestDataDate: null,
        latencyMs: 0,
        message,
      });
      warnings.push(`${definition.source} failed: ${message}`);
      return;
    }

    try {
      const parsed = extractDefiLlamaMetric(
        result.value.fetched.payload,
        definition.metric,
        definition.source,
        targetDate,
        result.value.fetched.fetchedAt,
      );
      parsedOverviews.push({ definition, parsed });
      for (const platform of parsed.platforms) platforms.set(platform.id, platform);
      metrics.push(...parsed.metrics);
      raw.push({
        source: definition.source,
        fetchedAt: result.value.fetched.fetchedAt,
        sha256: result.value.fetched.sha256,
        payload: result.value.fetched.payload,
      });
      sourceHealth.push({
        source: definition.source,
        status: parsed.metrics.length > 0 ? "ok" : "degraded",
        fetchedAt: result.value.fetched.fetchedAt,
        latestDataDate: parsed.latestDataDate,
        latencyMs: result.value.fetched.latencyMs,
        message:
          parsed.metrics.length > 0
            ? `${parsed.metrics.length} canonical daily observations`
            : "Request succeeded but no launchpad observations were parsed",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sourceHealth.push({
        source: definition.source,
        status: "failed",
        fetchedAt: result.value.fetched.fetchedAt,
        latestDataDate: null,
        latencyMs: result.value.fetched.latencyMs,
        message,
      });
      warnings.push(`${definition.source} parse failed: ${message}`);
    }
  });

  const fallback = await collectSummaryFallbacks(parsedOverviews, targetDate);
  const retainedOverviewMetrics = metrics.filter(
    (metric) => !fallback.replacementKeys.has(platformMetricKey(metric.platformId, metric.metric)),
  );
  metrics.length = 0;
  metrics.push(...retainedOverviewMetrics, ...fallback.metrics);
  sourceHealth.push(...fallback.sourceHealth);
  raw.push(...fallback.raw);
  warnings.push(...fallback.warnings);

  return {
    platforms: [...platforms.values()],
    metrics,
    stats: [],
    sourceHealth,
    raw,
    warnings,
  };
}
