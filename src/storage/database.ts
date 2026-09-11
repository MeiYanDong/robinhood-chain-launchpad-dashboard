import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  CollectionBatch,
  DailyMetric,
  PlatformConfig,
  PlatformStat,
  RawObservation,
  SourceHealth,
} from "../domain/types.js";
import type { PlatformVolumeAlert } from "../platform-activity/alerts.js";
import type {
  PairRollingVolumeSnapshot,
  PairWarmingAlert,
  PairWarmingStateRecord,
} from "../platform-activity/warming.js";

export interface CollectionRun {
  id: number;
  startedAt: string;
  completedAt: string | null;
  targetDate: string;
  status: "running" | "success" | "partial" | "failed";
  warnings: string[];
  error: string | null;
}

interface RunRow {
  id: number;
  started_at: string;
  completed_at: string | null;
  target_date: string;
  status: CollectionRun["status"];
  warnings_json: string;
  error: string | null;
}

interface PlatformRow {
  config_json: string;
}

interface MetricRow {
  platform_id: string;
  metric: DailyMetric["metric"];
  date: string;
  value: number;
  source: string;
  quality: DailyMetric["quality"];
  scope: string;
  derivation: string | null;
  collected_at: string;
}

interface SourceRow {
  source: string;
  status: SourceHealth["status"];
  fetched_at: string;
  latest_data_date: string | null;
  latency_ms: number;
  message: string;
}

interface PlatformStatRow {
  platform_id: string;
  stat_key: string;
  label: string;
  value: number;
  unit: PlatformStat["unit"];
  period: PlatformStat["period"];
  source: string;
  quality: PlatformStat["quality"];
  scope: string;
  derivation: string | null;
  collected_at: string;
}

export interface PlatformVolumeAlertOutboxRow {
  id: number;
  dedupeKey: string;
  platformId: string;
  metric: DailyMetric["metric"];
  previousDate: string;
  currentDate: string;
  previousValue: number;
  currentValue: number;
  changePct: number;
  thresholdPct: number;
  source: string;
  createdAt: string;
  attempts: number;
}

export interface PairWarmingAlertOutboxRow extends PairWarmingAlert {
  id: number;
  attempts: number;
}

export class DashboardDatabase {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec(
      "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
    );
    this.migrate();
    this.recoverInterruptedRuns();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS platforms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        config_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS daily_metrics (
        platform_id TEXT NOT NULL,
        metric TEXT NOT NULL,
        date TEXT NOT NULL,
        value REAL NOT NULL,
        source TEXT NOT NULL,
        quality TEXT NOT NULL,
        scope TEXT NOT NULL,
        derivation TEXT,
        collected_at TEXT NOT NULL,
        PRIMARY KEY (platform_id, metric, date),
        FOREIGN KEY (platform_id) REFERENCES platforms(id)
      );

      CREATE INDEX IF NOT EXISTS idx_daily_metrics_date
        ON daily_metrics(date, metric);

      CREATE TABLE IF NOT EXISTS platform_stats (
        platform_id TEXT NOT NULL,
        stat_key TEXT NOT NULL,
        label TEXT NOT NULL,
        value REAL NOT NULL,
        unit TEXT NOT NULL,
        period TEXT NOT NULL,
        source TEXT NOT NULL,
        quality TEXT NOT NULL,
        scope TEXT NOT NULL,
        derivation TEXT,
        collected_at TEXT NOT NULL,
        PRIMARY KEY (platform_id, stat_key),
        FOREIGN KEY (platform_id) REFERENCES platforms(id)
      );

      CREATE TABLE IF NOT EXISTS collection_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        target_date TEXT NOT NULL,
        status TEXT NOT NULL,
        warnings_json TEXT NOT NULL DEFAULT '[]',
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS source_health (
        source TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        latest_data_date TEXT,
        latency_ms INTEGER NOT NULL,
        message TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS raw_observations (
        source TEXT PRIMARY KEY,
        fetched_at TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS platform_volume_alert_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dedupe_key TEXT NOT NULL UNIQUE,
        platform_id TEXT NOT NULL,
        metric TEXT NOT NULL,
        previous_date TEXT NOT NULL,
        current_date TEXT NOT NULL,
        previous_value REAL NOT NULL,
        current_value REAL NOT NULL,
        change_pct REAL NOT NULL,
        threshold_pct REAL NOT NULL,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL,
        sent_at TEXT,
        last_error TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_platform_volume_alert_delivery
        ON platform_volume_alert_outbox(status, next_attempt_at, id ASC);

      CREATE TABLE IF NOT EXISTS pair_volume_warming_state (
        singleton_id INTEGER PRIMARY KEY CHECK(singleton_id = 1),
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pair_volume_warming_alert_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dedupe_key TEXT NOT NULL UNIQUE,
        level TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL,
        sent_at TEXT,
        last_error TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_pair_volume_warming_alert_delivery
        ON pair_volume_warming_alert_outbox(status, next_attempt_at, id ASC);
    `);
  }

  private recoverInterruptedRuns(): void {
    this.db
      .prepare(`
        UPDATE collection_runs
        SET status = 'failed', completed_at = ?, error = 'process_interrupted'
        WHERE status = 'running'
      `)
      .run(new Date().toISOString());
  }

  seedPlatforms(platforms: PlatformConfig[]): void {
    const now = new Date().toISOString();
    const statement = this.db.prepare(`
      INSERT INTO platforms(id, name, config_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        config_json = excluded.config_json,
        updated_at = excluded.updated_at
    `);
    this.db.exec("BEGIN");
    try {
      for (const platform of platforms) {
        statement.run(platform.id, platform.name, JSON.stringify(platform), now);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  startRun(targetDate: string): number {
    const result = this.db
      .prepare(`
        INSERT INTO collection_runs(started_at, target_date, status, warnings_json)
        VALUES (?, ?, 'running', '[]')
      `)
      .run(new Date().toISOString(), targetDate);
    return Number(result.lastInsertRowid);
  }

  completeRun(
    runId: number,
    status: "success" | "partial" | "failed",
    warnings: string[],
    error: string | null = null,
    completedAt: string = new Date().toISOString(),
  ): void {
    this.db
      .prepare(`
        UPDATE collection_runs
        SET completed_at = ?, status = ?, warnings_json = ?, error = ?
        WHERE id = ?
      `)
      .run(completedAt, status, JSON.stringify(warnings), error, runId);
  }

  writeBatch(batch: CollectionBatch): void {
    const platformStatement = this.db.prepare(`
      INSERT INTO platforms(id, name, config_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        config_json = excluded.config_json,
        updated_at = excluded.updated_at
    `);
    const metricStatement = this.db.prepare(`
      INSERT INTO daily_metrics(
        platform_id, metric, date, value, source, quality, scope, derivation, collected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(platform_id, metric, date) DO UPDATE SET
        value = excluded.value,
        source = excluded.source,
        quality = excluded.quality,
        scope = excluded.scope,
        derivation = excluded.derivation,
        collected_at = excluded.collected_at
    `);
    const sourceStatement = this.db.prepare(`
      INSERT INTO source_health(
        source, status, fetched_at, latest_data_date, latency_ms, message
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(source) DO UPDATE SET
        status = excluded.status,
        fetched_at = excluded.fetched_at,
        latest_data_date = excluded.latest_data_date,
        latency_ms = excluded.latency_ms,
        message = excluded.message
    `);
    const statStatement = this.db.prepare(`
      INSERT INTO platform_stats(
        platform_id, stat_key, label, value, unit, period, source, quality,
        scope, derivation, collected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(platform_id, stat_key) DO UPDATE SET
        label = excluded.label,
        value = excluded.value,
        unit = excluded.unit,
        period = excluded.period,
        source = excluded.source,
        quality = excluded.quality,
        scope = excluded.scope,
        derivation = excluded.derivation,
        collected_at = excluded.collected_at
    `);
    const rawStatement = this.db.prepare(`
      INSERT INTO raw_observations(source, fetched_at, sha256, payload_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(source) DO UPDATE SET
        fetched_at = excluded.fetched_at,
        sha256 = excluded.sha256,
        payload_json = excluded.payload_json
    `);

    const now = new Date().toISOString();
    this.db.exec("BEGIN");
    try {
      for (const platform of batch.platforms) {
        platformStatement.run(platform.id, platform.name, JSON.stringify(platform), now);
      }
      for (const metric of batch.metrics) {
        metricStatement.run(
          metric.platformId,
          metric.metric,
          metric.date,
          metric.value,
          metric.source,
          metric.quality,
          metric.scope,
          metric.derivation,
          metric.collectedAt,
        );
      }
      for (const stat of batch.stats) {
        statStatement.run(
          stat.platformId,
          stat.key,
          stat.label,
          stat.value,
          stat.unit,
          stat.period,
          stat.source,
          stat.quality,
          stat.scope,
          stat.derivation,
          stat.collectedAt,
        );
      }
      for (const source of batch.sourceHealth) {
        sourceStatement.run(
          source.source,
          source.status,
          source.fetchedAt,
          source.latestDataDate,
          source.latencyMs,
          source.message,
        );
      }
      for (const observation of batch.raw) {
        rawStatement.run(
          observation.source,
          observation.fetchedAt,
          observation.sha256,
          JSON.stringify(observation.payload),
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  latestUsableRun(): CollectionRun | null {
    const row = this.db
      .prepare(`
        SELECT * FROM collection_runs
        WHERE status IN ('success', 'partial')
        ORDER BY id DESC
        LIMIT 1
      `)
      .get() as RunRow | undefined;
    return row ? this.mapRun(row) : null;
  }

  latestRun(): CollectionRun | null {
    const row = this.db.prepare("SELECT * FROM collection_runs ORDER BY id DESC LIMIT 1").get() as
      | RunRow
      | undefined;
    return row ? this.mapRun(row) : null;
  }

  private mapRun(row: RunRow): CollectionRun {
    let warnings: string[] = [];
    try {
      const parsed: unknown = JSON.parse(row.warnings_json);
      if (Array.isArray(parsed))
        warnings = parsed.filter((item): item is string => typeof item === "string");
    } catch {
      warnings = ["Stored run warnings could not be parsed."];
    }
    return {
      id: row.id,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      targetDate: row.target_date,
      status: row.status,
      warnings,
      error: row.error,
    };
  }

  getPlatforms(): PlatformConfig[] {
    const rows = this.db
      .prepare("SELECT config_json FROM platforms ORDER BY name")
      .all() as unknown as PlatformRow[];
    const platforms: PlatformConfig[] = [];
    for (const row of rows) {
      try {
        platforms.push(JSON.parse(row.config_json) as PlatformConfig);
      } catch {
        // Ignore malformed cache rows; the static registry will be reseeded.
      }
    }
    return platforms;
  }

  getPlatform(id: string): PlatformConfig | null {
    const row = this.db.prepare("SELECT config_json FROM platforms WHERE id = ?").get(id) as
      | PlatformRow
      | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.config_json) as PlatformConfig;
    } catch {
      return null;
    }
  }

  getMetrics(startDate: string, endDate: string, platformId?: string): DailyMetric[] {
    const rows = (platformId
      ? this.db
          .prepare(`
              SELECT * FROM daily_metrics
              WHERE date >= ? AND date <= ? AND platform_id = ?
              ORDER BY date, platform_id, metric
            `)
          .all(startDate, endDate, platformId)
      : this.db
          .prepare(`
              SELECT * FROM daily_metrics
              WHERE date >= ? AND date <= ?
              ORDER BY date, platform_id, metric
            `)
          .all(startDate, endDate)) as unknown as MetricRow[];

    return rows.map((row) => ({
      platformId: row.platform_id,
      metric: row.metric,
      date: row.date,
      value: row.value,
      source: row.source,
      quality: row.quality,
      scope: row.scope,
      derivation: row.derivation,
      collectedAt: row.collected_at,
    }));
  }

  getMetricHistory(platformId: string, metric: DailyMetric["metric"]): DailyMetric[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM daily_metrics
        WHERE platform_id = ? AND metric = ?
        ORDER BY date, collected_at
      `)
      .all(platformId, metric) as unknown as MetricRow[];

    return rows.map((row) => ({
      platformId: row.platform_id,
      metric: row.metric,
      date: row.date,
      value: row.value,
      source: row.source,
      quality: row.quality,
      scope: row.scope,
      derivation: row.derivation,
      collectedAt: row.collected_at,
    }));
  }

  getSourceHealth(): SourceHealth[] {
    const rows = this.db
      .prepare("SELECT * FROM source_health ORDER BY source")
      .all() as unknown as SourceRow[];
    return rows.map((row) => ({
      source: row.source,
      status: row.status,
      fetchedAt: row.fetched_at,
      latestDataDate: row.latest_data_date,
      latencyMs: row.latency_ms,
      message: row.message,
    }));
  }

  getPlatformStats(platformId: string): PlatformStat[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM platform_stats
        WHERE platform_id = ?
        ORDER BY period, stat_key
      `)
      .all(platformId) as unknown as PlatformStatRow[];
    return rows.map((row) => ({
      platformId: row.platform_id,
      key: row.stat_key,
      label: row.label,
      value: row.value,
      unit: row.unit,
      period: row.period,
      source: row.source,
      quality: row.quality,
      scope: row.scope,
      derivation: row.derivation,
      collectedAt: row.collected_at,
    }));
  }

  getRawObservation(source: string): RawObservation | null {
    const row = this.db.prepare("SELECT * FROM raw_observations WHERE source = ?").get(source) as
      | { source: string; fetched_at: string; sha256: string; payload_json: string }
      | undefined;
    if (!row) return null;
    try {
      return {
        source: row.source,
        fetchedAt: row.fetched_at,
        sha256: row.sha256,
        payload: JSON.parse(row.payload_json) as unknown,
      };
    } catch {
      return null;
    }
  }

  enqueuePlatformVolumeAlert(alert: PlatformVolumeAlert): boolean {
    const result = this.db
      .prepare(`
        INSERT OR IGNORE INTO platform_volume_alert_outbox(
          dedupe_key, platform_id, metric, previous_date, current_date,
          previous_value, current_value, change_pct, threshold_pct, source,
          created_at, next_attempt_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        alert.dedupeKey,
        alert.platformId,
        alert.metric,
        alert.previousDate,
        alert.currentDate,
        alert.previousValue,
        alert.currentValue,
        alert.changePct,
        alert.thresholdPct,
        alert.source,
        alert.createdAt,
        alert.createdAt,
      );
    return Number(result.changes) === 1;
  }

  pendingPlatformVolumeAlerts(now: string, limit = 5): PlatformVolumeAlertOutboxRow[] {
    const rows = this.db
      .prepare(`
        SELECT
          id, dedupe_key, platform_id, metric, previous_date,
          "current_date" AS alert_current_date,
          previous_value, current_value, change_pct, threshold_pct, source,
          created_at, attempts
        FROM platform_volume_alert_outbox
        WHERE status IN ('pending', 'failed')
          AND attempts < 5
          AND next_attempt_at <= ?
        ORDER BY id ASC
        LIMIT ?
      `)
      .all(now, limit) as unknown as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: Number(row.id),
      dedupeKey: String(row.dedupe_key),
      platformId: String(row.platform_id),
      metric: row.metric as DailyMetric["metric"],
      previousDate: String(row.previous_date),
      currentDate: String(row.alert_current_date),
      previousValue: Number(row.previous_value),
      currentValue: Number(row.current_value),
      changePct: Number(row.change_pct),
      thresholdPct: Number(row.threshold_pct),
      source: String(row.source),
      createdAt: String(row.created_at),
      attempts: Number(row.attempts),
    }));
  }

  markPlatformVolumeAlertSent(id: number, sentAt: string): void {
    this.db
      .prepare(`
        UPDATE platform_volume_alert_outbox
        SET status = 'sent', attempts = attempts + 1, sent_at = ?, last_error = NULL
        WHERE id = ?
      `)
      .run(sentAt, id);
  }

  markPlatformVolumeAlertFailed(
    id: number,
    error: string,
    now: Date,
    previousAttempts: number,
  ): void {
    const delayMinutes = Math.min(60, 2 ** previousAttempts * 5);
    const nextAttemptAt = new Date(now.valueOf() + delayMinutes * 60_000).toISOString();
    this.db
      .prepare(`
        UPDATE platform_volume_alert_outbox
        SET status = 'failed', attempts = attempts + 1,
            next_attempt_at = ?, last_error = ?
        WHERE id = ?
      `)
      .run(nextAttemptAt, error.slice(0, 240), id);
  }

  platformVolumeAlertSummary(): {
    pending: number;
    failed: number;
    lastSentAt: string | null;
  } {
    const row = this.db
      .prepare(`
        SELECT
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
          MAX(sent_at) AS last_sent_at
        FROM platform_volume_alert_outbox
      `)
      .get() as { pending: number | null; failed: number | null; last_sent_at: string | null };
    return {
      pending: row.pending ?? 0,
      failed: row.failed ?? 0,
      lastSentAt: row.last_sent_at,
    };
  }

  getPairRollingVolumeSnapshots(since: string, limit = 256): PairRollingVolumeSnapshot[] {
    const pairTables = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM sqlite_schema
         WHERE type = 'table' AND name IN ('pair_collection_runs', 'pair_universe_aggregates', 'pair_source_health')`,
      )
      .get() as { count: number };
    if (pairTables.count !== 3) return [];
    const rows = this.db
      .prepare(`
        SELECT
          aggregates.run_id,
          runs.observed_at,
          aggregates.token_count,
          aggregates.volume_observed_count,
          aggregates.volume_24h_usd,
          COALESCE(source.status, 'failed') AS source_status
        FROM pair_universe_aggregates AS aggregates
        JOIN pair_collection_runs AS runs ON runs.id = aggregates.run_id
        LEFT JOIN pair_source_health AS source
          ON source.run_id = aggregates.run_id AND source.source = 'pair.officialApi'
        WHERE runs.status IN ('success', 'partial')
          AND runs.observed_at IS NOT NULL
          AND runs.observed_at >= ?
        ORDER BY runs.observed_at DESC, aggregates.run_id DESC
        LIMIT ?
      `)
      .all(since, limit) as unknown as Array<Record<string, unknown>>;
    return rows
      .map((row) => ({
        runId: Number(row.run_id),
        observedAt: String(row.observed_at),
        tokenCount: Number(row.token_count),
        volumeObservedCount: Number(row.volume_observed_count),
        volume24hUsd: Number(row.volume_24h_usd),
        sourceStatus: row.source_status as PairRollingVolumeSnapshot["sourceStatus"],
      }))
      .reverse();
  }

  getPairWarmingState(): PairWarmingStateRecord | null {
    const row = this.db
      .prepare("SELECT payload_json FROM pair_volume_warming_state WHERE singleton_id = 1")
      .get() as { payload_json: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.payload_json) as PairWarmingStateRecord;
    } catch {
      return null;
    }
  }

  savePairWarmingState(state: PairWarmingStateRecord): void {
    this.db
      .prepare(`
        INSERT INTO pair_volume_warming_state(singleton_id, payload_json, updated_at)
        VALUES (1, ?, ?)
        ON CONFLICT(singleton_id) DO UPDATE SET
          payload_json = excluded.payload_json,
          updated_at = excluded.updated_at
      `)
      .run(JSON.stringify(state), state.updatedAt);
  }

  enqueuePairWarmingAlert(alert: PairWarmingAlert): boolean {
    const result = this.db
      .prepare(`
        INSERT OR IGNORE INTO pair_volume_warming_alert_outbox(
          dedupe_key, level, observed_at, payload_json, created_at, next_attempt_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        alert.dedupeKey,
        alert.level,
        alert.observedAt,
        JSON.stringify(alert),
        alert.createdAt,
        alert.createdAt,
      );
    return Number(result.changes) === 1;
  }

  pendingPairWarmingAlerts(now: string, limit = 5): PairWarmingAlertOutboxRow[] {
    const rows = this.db
      .prepare(`
        SELECT id, payload_json, attempts
        FROM pair_volume_warming_alert_outbox
        WHERE status IN ('pending', 'failed')
          AND attempts < 5
          AND next_attempt_at <= ?
        ORDER BY id ASC
        LIMIT ?
      `)
      .all(now, limit) as unknown as Array<{
      id: number;
      payload_json: string;
      attempts: number;
    }>;
    return rows.flatMap((row) => {
      try {
        return [
          {
            ...(JSON.parse(row.payload_json) as PairWarmingAlert),
            id: row.id,
            attempts: row.attempts,
          },
        ];
      } catch {
        return [];
      }
    });
  }

  markPairWarmingAlertSent(id: number, sentAt: string): void {
    this.db
      .prepare(`
        UPDATE pair_volume_warming_alert_outbox
        SET status = 'sent', attempts = attempts + 1, sent_at = ?, last_error = NULL
        WHERE id = ?
      `)
      .run(sentAt, id);
  }

  markPairWarmingAlertFailed(id: number, error: string, now: Date, previousAttempts: number): void {
    const delayMinutes = Math.min(60, 2 ** previousAttempts * 5);
    const nextAttemptAt = new Date(now.valueOf() + delayMinutes * 60_000).toISOString();
    this.db
      .prepare(`
        UPDATE pair_volume_warming_alert_outbox
        SET status = 'failed', attempts = attempts + 1,
            next_attempt_at = ?, last_error = ?
        WHERE id = ?
      `)
      .run(nextAttemptAt, error.slice(0, 240), id);
  }

  pairWarmingAlertSummary(): {
    pending: number;
    failed: number;
    lastSentAt: string | null;
  } {
    const row = this.db
      .prepare(`
        SELECT
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
          MAX(sent_at) AS last_sent_at
        FROM pair_volume_warming_alert_outbox
      `)
      .get() as { pending: number | null; failed: number | null; last_sent_at: string | null };
    return {
      pending: row.pending ?? 0,
      failed: row.failed ?? 0,
      lastSentAt: row.last_sent_at,
    };
  }

  close(): void {
    this.db.close();
  }
}
