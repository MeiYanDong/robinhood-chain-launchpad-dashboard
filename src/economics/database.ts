import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  EconomicsResponse,
  PairRelativeValuationHistoryPoint,
  StoredEconomicsSnapshot,
} from "./types.js";
import { toPairRelativeValuationHistoryPoint } from "./valuation.js";

interface SnapshotRow {
  id: number;
  observed_at: string;
  target_date: string;
  status: EconomicsResponse["status"];
  payload_json: string;
}

interface ValuationSnapshotRow {
  payload_json: string;
}

const VALUATION_HISTORY_LIMIT = 2_048;

export class EconomicsDatabase {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec(
      "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
    );
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS economics_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        observed_at TEXT NOT NULL,
        target_date TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_economics_snapshots_observed
        ON economics_snapshots(observed_at DESC);

      CREATE TABLE IF NOT EXISTS pair_relative_valuation_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        economics_snapshot_id INTEGER NOT NULL UNIQUE,
        observed_at TEXT NOT NULL,
        model_version TEXT NOT NULL,
        state TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        FOREIGN KEY(economics_snapshot_id) REFERENCES economics_snapshots(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_pair_relative_valuation_observed
        ON pair_relative_valuation_snapshots(observed_at DESC);
    `);
  }

  save(payload: EconomicsResponse): number {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.db
        .prepare(`
          INSERT INTO economics_snapshots(observed_at, target_date, status, payload_json)
          VALUES (?, ?, ?, ?)
        `)
        .run(payload.observedAt, payload.targetDate, payload.status, JSON.stringify(payload));
      const snapshotId = Number(result.lastInsertRowid);
      const historyPoint = toPairRelativeValuationHistoryPoint(payload.pairRelativeValuation);
      this.db
        .prepare(`
          INSERT INTO pair_relative_valuation_snapshots(
            economics_snapshot_id,
            observed_at,
            model_version,
            state,
            payload_json
          ) VALUES (?, ?, ?, ?, ?)
        `)
        .run(
          snapshotId,
          historyPoint.observedAt,
          historyPoint.modelVersion,
          historyPoint.state,
          JSON.stringify(historyPoint),
        );
      this.db.exec("COMMIT");
      return snapshotId;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  latest(): StoredEconomicsSnapshot | null {
    const row = this.db
      .prepare("SELECT * FROM economics_snapshots ORDER BY id DESC LIMIT 1")
      .get() as SnapshotRow | undefined;
    if (!row) return null;
    try {
      return {
        id: row.id,
        observedAt: row.observed_at,
        targetDate: row.target_date,
        status: row.status,
        payload: JSON.parse(row.payload_json) as EconomicsResponse,
      };
    } catch {
      return null;
    }
  }

  valuationHistory(
    since: string | null = null,
    limit: number = VALUATION_HISTORY_LIMIT,
  ): PairRelativeValuationHistoryPoint[] {
    const normalizedLimit = Number.isFinite(limit) ? Math.trunc(limit) : VALUATION_HISTORY_LIMIT;
    const boundedLimit = Math.max(1, Math.min(VALUATION_HISTORY_LIMIT, normalizedLimit));
    const rows = this.db
      .prepare(`
        SELECT payload_json
        FROM pair_relative_valuation_snapshots
        WHERE (? IS NULL OR observed_at >= ?)
        ORDER BY id DESC
        LIMIT ?
      `)
      .all(since, since, boundedLimit) as unknown as ValuationSnapshotRow[];
    const points: PairRelativeValuationHistoryPoint[] = [];
    for (const row of rows.reverse()) {
      try {
        const point = JSON.parse(row.payload_json) as PairRelativeValuationHistoryPoint;
        if (typeof point.observedAt === "string" && typeof point.modelVersion === "string") {
          points.push(point);
        }
      } catch {
        // Ignore a corrupt compact point without losing the full economics snapshot.
      }
    }
    return points;
  }

  close(): void {
    this.db.close();
  }
}
