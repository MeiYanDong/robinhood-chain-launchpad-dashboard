import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  isDevMonitorAlertEligible,
  type DevMonitorNotificationEligibility,
} from "./notification-policy.js";
import type {
  DevMonitorActivity,
  DevMonitorAlert,
  DevMonitorAlertSummary,
  DevMonitorProfile,
  DevMonitorProject,
  DevMonitorSnapshot,
} from "./types.js";

interface JsonRow {
  payload_json: string;
}

export interface DevMonitorAlertOutboxRow extends DevMonitorAlert {
  id: number;
  attempts: number;
}

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export class DevMonitorDatabase {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec(
      "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
    );
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS dev_monitor_projects (
        address TEXT PRIMARY KEY,
        creator TEXT NOT NULL,
        platform TEXT NOT NULL,
        block_number INTEGER NOT NULL,
        transaction_hash TEXT NOT NULL,
        launched_at TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_dev_monitor_projects_creator
        ON dev_monitor_projects(creator, block_number DESC);
      CREATE INDEX IF NOT EXISTS idx_dev_monitor_projects_block
        ON dev_monitor_projects(block_number DESC);

      CREATE TABLE IF NOT EXISTS dev_monitor_profiles (
        address TEXT PRIMARY KEY,
        tier TEXT NOT NULL,
        score REAL NOT NULL,
        updated_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_dev_monitor_profiles_tier_score
        ON dev_monitor_profiles(tier, score DESC);

      CREATE TABLE IF NOT EXISTS dev_monitor_activities (
        activity_id TEXT PRIMARY KEY,
        developer TEXT NOT NULL,
        activity_type TEXT NOT NULL,
        block_number INTEGER NOT NULL,
        transaction_hash TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_dev_monitor_activities_developer_block
        ON dev_monitor_activities(developer, block_number DESC);

      CREATE TABLE IF NOT EXISTS dev_monitor_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS dev_monitor_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        observed_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_dev_monitor_snapshots_id
        ON dev_monitor_snapshots(id DESC);

      CREATE TABLE IF NOT EXISTS dev_monitor_alert_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dedupe_key TEXT NOT NULL UNIQUE,
        severity TEXT NOT NULL,
        alert_type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        developer TEXT NOT NULL,
        project TEXT,
        transaction_hash TEXT,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT,
        last_error TEXT,
        sent_at TEXT,
        deliverable INTEGER NOT NULL DEFAULT 1 CHECK(deliverable IN (0, 1)),
        suppressed_at TEXT,
        suppression_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_dev_monitor_alert_status
        ON dev_monitor_alert_outbox(status, next_attempt_at, id ASC);
    `);
    const alertColumns = new Set(
      (
        this.db.prepare("PRAGMA table_info(dev_monitor_alert_outbox)").all() as unknown as Array<{
          name: string;
        }>
      ).map((column) => column.name),
    );
    if (!alertColumns.has("deliverable")) {
      this.db.exec(
        "ALTER TABLE dev_monitor_alert_outbox ADD COLUMN deliverable INTEGER NOT NULL DEFAULT 1 CHECK(deliverable IN (0, 1))",
      );
    }
    if (!alertColumns.has("suppressed_at")) {
      this.db.exec("ALTER TABLE dev_monitor_alert_outbox ADD COLUMN suppressed_at TEXT");
    }
    if (!alertColumns.has("suppression_reason")) {
      this.db.exec("ALTER TABLE dev_monitor_alert_outbox ADD COLUMN suppression_reason TEXT");
    }
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_dev_monitor_alert_delivery
        ON dev_monitor_alert_outbox(deliverable, status, next_attempt_at, created_at DESC);
    `);
  }

  state(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM dev_monitor_state WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setState(key: string, value: string, updatedAt: string): void {
    this.db
      .prepare(`
        INSERT INTO dev_monitor_state(key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `)
      .run(key, value, updatedAt);
  }

  cursor(source: string): number | null {
    const raw = this.state(`cursor:${source}`);
    if (raw === null) return null;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }

  setCursor(source: string, blockNumber: number, updatedAt: string): void {
    this.setState(`cursor:${source}`, String(blockNumber), updatedAt);
  }

  baselineComplete(): boolean {
    return this.state("baseline_complete") === "1";
  }

  setBaselineComplete(updatedAt: string): void {
    this.setState("baseline_complete", "1", updatedAt);
  }

  upsertProjects(projects: DevMonitorProject[]): DevMonitorProject[] {
    if (projects.length === 0) return [];
    const exists = this.db.prepare("SELECT 1 FROM dev_monitor_projects WHERE address = ?");
    const statement = this.db.prepare(`
      INSERT INTO dev_monitor_projects(
        address, creator, platform, block_number, transaction_hash, launched_at, observed_at,
        payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(address) DO UPDATE SET
        creator = excluded.creator,
        platform = excluded.platform,
        block_number = excluded.block_number,
        transaction_hash = excluded.transaction_hash,
        launched_at = excluded.launched_at,
        observed_at = excluded.observed_at,
        payload_json = excluded.payload_json
    `);
    const inserted: DevMonitorProject[] = [];
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const project of projects) {
        if (!exists.get(project.address)) inserted.push(project);
        statement.run(
          project.address,
          project.creator,
          project.platform,
          project.blockNumber,
          project.transactionHash,
          project.launchedAt ?? project.observedAt,
          project.observedAt,
          JSON.stringify(project),
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return inserted;
  }

  projects(): DevMonitorProject[] {
    const rows = this.db
      .prepare("SELECT payload_json FROM dev_monitor_projects ORDER BY block_number, address")
      .all() as unknown as JsonRow[];
    return rows.flatMap((row) => {
      const parsed = parseJson<DevMonitorProject>(row.payload_json);
      return parsed ? [parsed] : [];
    });
  }

  saveProfiles(profiles: DevMonitorProfile[]): void {
    const statement = this.db.prepare(`
      INSERT INTO dev_monitor_profiles(address, tier, score, updated_at, payload_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(address) DO UPDATE SET
        tier = excluded.tier,
        score = excluded.score,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json
    `);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const profile of profiles) {
        statement.run(
          profile.address,
          profile.tier,
          profile.score,
          profile.updatedAt,
          JSON.stringify(profile),
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  profiles(): DevMonitorProfile[] {
    const rows = this.db
      .prepare("SELECT payload_json FROM dev_monitor_profiles ORDER BY score DESC, address")
      .all() as unknown as JsonRow[];
    return rows.flatMap((row) => {
      const parsed = parseJson<DevMonitorProfile>(row.payload_json);
      return parsed ? [parsed] : [];
    });
  }

  upsertActivities(activities: DevMonitorActivity[]): DevMonitorActivity[] {
    if (activities.length === 0) return [];
    const statement = this.db.prepare(`
      INSERT OR IGNORE INTO dev_monitor_activities(
        activity_id, developer, activity_type, block_number, transaction_hash, observed_at,
        payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const inserted: DevMonitorActivity[] = [];
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const activity of activities) {
        const result = statement.run(
          activity.id,
          activity.developer,
          activity.type,
          activity.blockNumber,
          activity.transactionHash,
          activity.observedAt,
          JSON.stringify(activity),
        );
        if (Number(result.changes) === 1) inserted.push(activity);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return inserted;
  }

  activityCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM dev_monitor_activities").get() as {
      count: number;
    };
    return row.count;
  }

  enqueueAlerts(alerts: DevMonitorAlert[], developerCooldownMinutes = 0): number {
    if (alerts.length === 0) return 0;
    const statement = this.db.prepare(`
      INSERT OR IGNORE INTO dev_monitor_alert_outbox(
        dedupe_key, severity, alert_type, title, message, developer, project,
        transaction_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const recent = this.db.prepare(`
      SELECT 1
      FROM dev_monitor_alert_outbox
      WHERE deliverable = 1
        AND developer = ?
        AND alert_type = ?
        AND created_at >= ?
      LIMIT 1
    `);
    let inserted = 0;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const alert of alerts) {
        if (developerCooldownMinutes > 0 && alert.type !== "developer_promoted") {
          const createdAt = Date.parse(alert.createdAt);
          if (Number.isFinite(createdAt)) {
            const cutoff = new Date(createdAt - developerCooldownMinutes * 60_000).toISOString();
            if (recent.get(alert.developer, alert.type, cutoff)) continue;
          }
        }
        const result = statement.run(
          alert.dedupeKey,
          alert.severity,
          alert.type,
          alert.title,
          alert.message,
          alert.developer,
          alert.project,
          alert.transactionHash,
          alert.createdAt,
        );
        inserted += Number(result.changes);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return inserted;
  }

  pendingAlerts(now: string, limit = 20): DevMonitorAlertOutboxRow[] {
    const rows = this.db
      .prepare(`
        SELECT id, dedupe_key, severity, alert_type, title, message, developer, project,
               transaction_hash, created_at, attempts
        FROM dev_monitor_alert_outbox
        WHERE deliverable = 1
          AND status IN ('pending', 'failed')
          AND attempts < 5
          AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        ORDER BY CASE alert_type
                   WHEN 'developer_buy' THEN 0
                   WHEN 'developer_launch' THEN 1
                   ELSE 2
                 END,
                 created_at DESC,
                 id DESC
        LIMIT ?
      `)
      .all(now, limit) as unknown as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: Number(row.id),
      dedupeKey: String(row.dedupe_key),
      severity: row.severity as DevMonitorAlert["severity"],
      type: row.alert_type as DevMonitorAlert["type"],
      title: String(row.title),
      message: String(row.message),
      developer: String(row.developer),
      project: typeof row.project === "string" ? row.project : null,
      transactionHash: typeof row.transaction_hash === "string" ? row.transaction_hash : null,
      createdAt: String(row.created_at),
      attempts: Number(row.attempts),
    }));
  }

  markAlertSent(id: number, sentAt: string): void {
    this.db
      .prepare(`
        UPDATE dev_monitor_alert_outbox
        SET status = 'sent', attempts = attempts + 1, sent_at = ?, next_attempt_at = NULL,
            last_error = NULL
        WHERE id = ?
      `)
      .run(sentAt, id);
  }

  markAlertFailed(id: number, error: string, now: Date, attempts: number): void {
    const delaySeconds = Math.min(900, 30 * 2 ** Math.max(0, attempts));
    const nextAttemptAt = new Date(now.valueOf() + delaySeconds * 1_000).toISOString();
    this.db
      .prepare(`
        UPDATE dev_monitor_alert_outbox
        SET status = 'failed', attempts = attempts + 1, next_attempt_at = ?, last_error = ?
        WHERE id = ?
      `)
      .run(nextAttemptAt, error.slice(0, 240), id);
  }

  suppressExpiredAlerts(cutoff: string, suppressedAt: string): number {
    const result = this.db
      .prepare(`
        UPDATE dev_monitor_alert_outbox
        SET deliverable = 0,
            next_attempt_at = NULL,
            suppressed_at = ?,
            suppression_reason = 'expired_by_attention_policy'
        WHERE deliverable = 1
          AND status IN ('pending', 'failed')
          AND created_at < ?
      `)
      .run(suppressedAt, cutoff);
    return Number(result.changes);
  }

  suppressUnsentAlerts(suppressedAt: string, reason: string): number {
    const result = this.db
      .prepare(`
        UPDATE dev_monitor_alert_outbox
        SET deliverable = 0,
            next_attempt_at = NULL,
            suppressed_at = ?,
            suppression_reason = ?
        WHERE deliverable = 1
          AND status IN ('pending', 'failed')
      `)
      .run(suppressedAt, reason.slice(0, 120));
    return Number(result.changes);
  }

  suppressIneligibleUnsentAlerts(
    eligibility: DevMonitorNotificationEligibility,
    suppressedAt: string,
    reason: string,
  ): number {
    const rows = this.db
      .prepare(`
        SELECT id, alert_type, developer, project
        FROM dev_monitor_alert_outbox
        WHERE deliverable = 1
          AND status IN ('pending', 'failed')
      `)
      .all() as unknown as Array<{
      id: number;
      alert_type: DevMonitorAlert["type"];
      developer: string;
      project: string | null;
    }>;
    const update = this.db.prepare(`
      UPDATE dev_monitor_alert_outbox
      SET deliverable = 0,
          next_attempt_at = NULL,
          suppressed_at = ?,
          suppression_reason = ?
      WHERE id = ?
        AND deliverable = 1
        AND status IN ('pending', 'failed')
    `);
    let suppressed = 0;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows) {
        if (
          isDevMonitorAlertEligible(
            {
              type: row.alert_type,
              developer: row.developer,
              project: row.project,
            },
            eligibility,
          )
        ) {
          continue;
        }
        suppressed += Number(update.run(suppressedAt, reason.slice(0, 120), row.id).changes);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return suppressed;
  }

  sentAlertCountSince(since: string): number {
    const row = this.db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM dev_monitor_alert_outbox
        WHERE deliverable = 1
          AND status = 'sent'
          AND sent_at >= ?
      `)
      .get(since) as { count: number };
    return row.count;
  }

  lastSentAt(): string | null {
    const row = this.db
      .prepare("SELECT MAX(sent_at) AS last_sent_at FROM dev_monitor_alert_outbox")
      .get() as { last_sent_at: string | null };
    return row.last_sent_at;
  }

  alertSummary(configured: boolean): DevMonitorAlertSummary {
    const row = this.db
      .prepare(`
        SELECT
          SUM(CASE WHEN deliverable = 1 AND status = 'pending' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN deliverable = 1 AND status = 'failed' THEN 1 ELSE 0 END) AS failed,
          SUM(CASE WHEN deliverable = 0 THEN 1 ELSE 0 END) AS suppressed,
          MAX(sent_at) AS last_sent_at
        FROM dev_monitor_alert_outbox
      `)
      .get() as {
      pending: number | null;
      failed: number | null;
      suppressed: number | null;
      last_sent_at: string | null;
    };
    return {
      configured,
      pending: row.pending ?? 0,
      failed: row.failed ?? 0,
      suppressed: row.suppressed ?? 0,
      lastSentAt: row.last_sent_at,
    };
  }

  saveSnapshot(snapshot: DevMonitorSnapshot): void {
    this.db
      .prepare("INSERT INTO dev_monitor_snapshots(observed_at, payload_json) VALUES (?, ?)")
      .run(snapshot.observedAt ?? snapshot.generatedAt, JSON.stringify(snapshot));
    this.db.exec(`
      DELETE FROM dev_monitor_snapshots
      WHERE id NOT IN (SELECT id FROM dev_monitor_snapshots ORDER BY id DESC LIMIT 2048)
    `);
  }

  latestSnapshot(): DevMonitorSnapshot | null {
    const row = this.db
      .prepare("SELECT payload_json FROM dev_monitor_snapshots ORDER BY id DESC LIMIT 1")
      .get() as JsonRow | undefined;
    const parsed = row ? parseJson<DevMonitorSnapshot>(row.payload_json) : null;
    return parsed?.service === "rhc-dev-monitor" ? parsed : null;
  }

  close(): void {
    this.db.close();
  }
}
