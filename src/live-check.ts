import { BANKR_DASHBOARD_URL, extractBankrMetrics } from "./collectors/bankr.js";
import {
  DEFILLAMA_SOURCES,
  extractDefiLlamaMetric,
  extractDefiLlamaSummaryMetric,
} from "./collectors/defillama.js";
import { findRegisteredPlatform } from "./config/platforms.js";
import { collectLetsCash, LETSCASH_DAILY_SOURCE } from "./collectors/letscash.js";
import { collectLong, LONG_DAILY_SOURCE } from "./collectors/long.js";
import { fetchJson, isRecord } from "./utils/http.js";
import { lastClosedUtcDate } from "./utils/time.js";

const targetDate = lastClosedUtcDate();
const required = DEFILLAMA_SOURCES.filter(
  (source) => source.metric === "fees_usd" || source.metric === "volume_usd",
);

const fetched = await Promise.all(
  required.map(async (definition) => ({
    definition,
    response: await fetchJson(definition.url, { timeoutMs: 30_000, retries: 1 }),
  })),
);

const observations = fetched.map(({ definition, response }) => {
  const parsed = extractDefiLlamaMetric(
    response.payload,
    definition.metric,
    definition.source,
    targetDate,
    response.fetchedAt,
  );
  if (parsed.metrics.length === 0) {
    throw new Error(`${definition.source} returned no canonical launchpad observations`);
  }
  return {
    source: definition.source,
    platformCount: parsed.platforms.length,
    observationCount: parsed.metrics.length,
    latestDataDate: parsed.latestDataDate,
    latencyMs: response.latencyMs,
    platformNames: parsed.platforms.map((platform) => platform.name),
  };
});

const discovered = new Set(observations.flatMap((observation) => observation.platformNames));
const expectedGroups = [
  ["Pons"],
  ["LetsCash"],
  ["Flap"],
  ["StonkBrokers"],
];
const missing = expectedGroups
  .filter((aliases) => !aliases.some((alias) => discovered.has(alias)))
  .map((aliases) => aliases[0]);
if (missing.length > 0) {
  throw new Error(`Expected launchpads missing from live DefiLlama contract: ${missing.join(", ")}`);
}

const letscash = findRegisteredPlatform("LetsCash");
if (!letscash) throw new Error("LetsCash registry entry is missing");
const summaryDefinitions = [
  {
    metric: "fees_usd" as const,
    source: "defillama.summary.dailyFees",
    url: "https://api.llama.fi/summary/fees/letscash?dataType=dailyFees",
  },
  {
    metric: "volume_usd" as const,
    source: "defillama.summary.dailyVolume",
    url: "https://api.llama.fi/summary/dexs/letscash?dataType=dailyVolume",
  },
];
const summaryObservations = await Promise.all(
  summaryDefinitions.map(async (definition) => {
    const response = await fetchJson(definition.url, { timeoutMs: 30_000, retries: 1 });
    const parsed = extractDefiLlamaSummaryMetric(
      response.payload,
      letscash,
      "LetsCash",
      definition.metric,
      definition.source,
      targetDate,
      response.fetchedAt,
    );
    if (parsed.metrics.length === 0) {
      throw new Error(`${definition.source} returned no closed-day Robinhood Chain observations`);
    }
    return {
      source: definition.source,
      observationCount: parsed.metrics.length,
      latestDataDate: parsed.latestDataDate,
      latencyMs: response.latencyMs,
    };
  }),
);

const bankrResponse = await fetchJson(BANKR_DASHBOARD_URL, { timeoutMs: 30_000, retries: 1 });
const bankr = extractBankrMetrics(bankrResponse.payload, targetDate, bankrResponse.fetchedAt);
if (bankr.metrics.length === 0) {
  throw new Error("Bankr dashboard returned no closed-day Robinhood Chain volume rows");
}
if (!isRecord(bankrResponse.payload) || !isRecord(bankrResponse.payload.byChain)) {
  throw new Error("Bankr dashboard is missing byChain");
}
const robinhoodSummary = bankrResponse.payload.byChain.robinhood;
if (!isRecord(robinhoodSummary)) {
  throw new Error("Bankr dashboard is missing byChain.robinhood");
}

const letsCashOfficial = await collectLetsCash(targetDate);
const letsCashOfficialMetrics = letsCashOfficial.metrics.filter(
  (metric) => metric.source === LETSCASH_DAILY_SOURCE,
);
if (letsCashOfficialMetrics.length === 0) {
  throw new Error("LetsCash official tokenomics returned no priced closed-day metrics");
}
if (letsCashOfficial.stats.length === 0) {
  throw new Error("LetsCash official tokenomics returned no live/cumulative stats");
}
const failedLetsCashSources = letsCashOfficial.sourceHealth.filter(
  (source) => source.status === "failed",
);
if (failedLetsCashSources.length > 0) {
  throw new Error(
    `LetsCash official collector has failed dependencies: ${failedLetsCashSources
      .map((source) => source.source)
      .join(", ")}`,
  );
}

const longOfficial = await collectLong(targetDate);
const longVolume = longOfficial.metrics.find(
  (metric) => metric.source === LONG_DAILY_SOURCE && metric.metric === "volume_usd",
);
if (!longVolume) {
  throw new Error("Long official GraphQL returned no closed-day volume metric");
}
const failedLongSources = longOfficial.sourceHealth.filter((source) => source.status === "failed");
if (failedLongSources.length > 0) {
  throw new Error(
    `Long official collector has failed dependencies: ${failedLongSources
      .map((source) => source.source)
      .join(", ")}`,
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checkedAt: new Date().toISOString(),
      targetDate,
      defillama: observations,
      defillamaProtocolSummary: summaryObservations,
      bankr: {
        observationCount: bankr.metrics.length,
        latestDataDate: bankr.latestDataDate,
        totalTokensDeployed: robinhoodSummary.totalTokensDeployed ?? null,
        latencyMs: bankrResponse.latencyMs,
      },
      letsCashOfficial: {
        observationCount: letsCashOfficialMetrics.length,
        statCount: letsCashOfficial.stats.length,
        latestDataDate: letsCashOfficialMetrics.reduce(
          (latest, metric) => (!latest || metric.date > latest ? metric.date : latest),
          null as string | null,
        ),
        sources: letsCashOfficial.sourceHealth,
      },
      longOfficial: {
        volumeUsd: longVolume.value,
        statCount: longOfficial.stats.length,
        latestDataDate: longVolume.date,
        sources: longOfficial.sourceHealth,
      },
    },
    null,
    2,
  ),
);
