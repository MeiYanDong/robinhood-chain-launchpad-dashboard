import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { shiftUtcDate } from "../../utils/time.js";
import { validateTelemetryBucket, type TelemetryBucket } from "./aggregate.js";

export class TelemetryStore {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS telemetry_buckets (
        date TEXT NOT NULL,
        action TEXT NOT NULL,
        channel TEXT NOT NULL,
        outcome TEXT NOT NULL,
        latency_bucket TEXT NOT NULL,
        used_llm INTEGER NOT NULL,
        stale INTEGER NOT NULL,
        quality_count INTEGER NOT NULL,
        source_failed INTEGER NOT NULL,
        source_count INTEGER NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (
          date, action, channel, outcome, latency_bucket, used_llm, stale,
          quality_count, source_failed, source_count
        )
      );
    `);
  }

  increment(input: Omit<TelemetryBucket, "count">, amount = 1): void {
    const bucket = validateTelemetryBucket({ ...input, count: amount });
    this.database
      .prepare(`
        INSERT INTO telemetry_buckets(
          date, action, channel, outcome, latency_bucket, used_llm, stale,
          quality_count, source_failed, source_count, count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(
          date, action, channel, outcome, latency_bucket, used_llm, stale,
          quality_count, source_failed, source_count
        ) DO UPDATE SET count = count + excluded.count
      `)
      .run(
        bucket.date,
        bucket.action,
        bucket.channel,
        bucket.outcome,
        bucket.latencyBucket,
        bucket.usedLlm ? 1 : 0,
        bucket.stale ? 1 : 0,
        bucket.qualityCount,
        bucket.sourceFailed,
        bucket.sourceCount,
        bucket.count,
      );
  }

  all(): TelemetryBucket[] {
    const rows = this.database
      .prepare("SELECT * FROM telemetry_buckets ORDER BY date, action")
      .all() as unknown as Array<Record<string, unknown>>;
    return rows.map((row) =>
      validateTelemetryBucket({
        date: row.date,
        action: row.action,
        channel: row.channel,
        outcome: row.outcome,
        latencyBucket: row.latency_bucket,
        usedLlm: row.used_llm === 1,
        stale: row.stale === 1,
        qualityCount: row.quality_count,
        sourceFailed: row.source_failed,
        sourceCount: row.source_count,
        count: row.count,
      }),
    );
  }

  prune(retentionDays = 180, now = new Date()): number {
    const cutoff = shiftUtcDate(now.toISOString().slice(0, 10), -(retentionDays - 1));
    return Number(
      this.database.prepare("DELETE FROM telemetry_buckets WHERE date < ?").run(cutoff).changes,
    );
  }

  close(): void {
    this.database.close();
  }
}
