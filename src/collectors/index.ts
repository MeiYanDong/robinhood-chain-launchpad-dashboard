import { PLATFORM_REGISTRY } from "../config/platforms.js";
import { preferredMetric } from "../config/source-priority.js";
import type {
  CollectionBatch,
  DailyMetric,
  PlatformConfig,
  PlatformStat,
} from "../domain/types.js";
import { collectBankr } from "./bankr.js";
import { collectDefiLlama } from "./defillama.js";
import { collectLetsCash } from "./letscash.js";
import { collectLong } from "./long.js";
import { collectPairProtocol } from "./pair-protocol.js";
import { collectPonsAnalytics } from "./pons-analytics.js";

export const COLLECTOR_DEADLINE_MS = 120_000;

interface ActiveCollector {
  targetDate: string;
  promise: Promise<CollectionBatch>;
}

const activeCollectors = new Map<string, ActiveCollector>();

export async function collectWithDeadline(
  id: string,
  targetDate: string,
  collect: (targetDate: string) => Promise<CollectionBatch>,
  timeoutMs = COLLECTOR_DEADLINE_MS,
): Promise<CollectionBatch> {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Collector deadline must be a positive integer");
  }

  let active = activeCollectors.get(id);
  if (active && active.targetDate !== targetDate) {
    throw new Error(`${id} is still collecting an earlier target date`);
  }
  if (!active) {
    const promise = Promise.resolve().then(() => collect(targetDate));
    active = { targetDate, promise };
    activeCollectors.set(id, active);
    void promise.then(
      () => {
        if (activeCollectors.get(id)?.promise === promise) activeCollectors.delete(id);
      },
      () => {
        if (activeCollectors.get(id)?.promise === promise) activeCollectors.delete(id);
      },
    );
  }

  let timeout: NodeJS.Timeout | null = null;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`${id} exceeded its collector deadline`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([active.promise, deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function mergeBatches(batches: CollectionBatch[]): CollectionBatch {
  const platformById = new Map<string, PlatformConfig>();
  for (const platform of PLATFORM_REGISTRY) platformById.set(platform.id, platform);

  const metricByKey = new Map<string, DailyMetric>();
  for (const batch of batches) {
    for (const platform of batch.platforms) platformById.set(platform.id, platform);
    for (const metric of batch.metrics) {
      const key = `${metric.platformId}\u0000${metric.metric}\u0000${metric.date}`;
      const existing = metricByKey.get(key);
      metricByKey.set(key, existing ? preferredMetric(existing, metric) : metric);
    }
  }

  const statByKey = new Map<string, PlatformStat>();
  for (const batch of batches) {
    for (const stat of batch.stats) {
      const key = `${stat.platformId}\u0000${stat.key}`;
      const existing = statByKey.get(key);
      if (
        !existing ||
        stat.collectedAt > existing.collectedAt ||
        (stat.collectedAt === existing.collectedAt && stat.source < existing.source)
      ) {
        statByKey.set(key, stat);
      }
    }
  }

  return {
    platforms: [...platformById.values()],
    metrics: [...metricByKey.values()],
    stats: [...statByKey.values()],
    sourceHealth: batches.flatMap((batch) => batch.sourceHealth),
    raw: batches.flatMap((batch) => batch.raw),
    warnings: batches.flatMap((batch) => batch.warnings),
  };
}

export async function collectAll(targetDate: string): Promise<CollectionBatch> {
  const collectors = [
    { id: "defillama.collector", collect: collectDefiLlama },
    { id: "bankr.collector", collect: collectBankr },
    { id: "letscash.collector", collect: collectLetsCash },
    { id: "long.collector", collect: collectLong },
    { id: "pair-protocol.collector", collect: collectPairProtocol },
    { id: "pons-analytics.collector", collect: collectPonsAnalytics },
  ];
  const settled = await Promise.allSettled(
    collectors.map((collector) => collectWithDeadline(collector.id, targetDate, collector.collect)),
  );
  const batches: CollectionBatch[] = settled.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    const collector = collectors[index];
    const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
    const fetchedAt = new Date().toISOString();
    return {
      platforms: [],
      metrics: [],
      stats: [],
      sourceHealth: [
        {
          source: collector?.id ?? `collector.${index}`,
          status: "failed",
          fetchedAt,
          latestDataDate: null,
          latencyMs: 0,
          message,
        },
      ],
      raw: [],
      warnings: [`${collector?.id ?? `collector.${index}`} crashed: ${message}`],
    };
  });
  return mergeBatches(batches);
}
