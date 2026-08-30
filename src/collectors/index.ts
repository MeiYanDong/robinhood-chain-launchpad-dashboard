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
  ];
  const settled = await Promise.allSettled(
    collectors.map((collector) => collector.collect(targetDate)),
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
