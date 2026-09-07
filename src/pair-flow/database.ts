import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  PairFlowEvent,
  PairFlowEventsQuery,
  PairTransactionDetail,
  PairFlowResponse,
} from "./types.js";

interface SnapshotRow {
  payload_json: string;
}

interface EventRow extends SnapshotRow {
  event_type: "buyback" | "burn";
}

function serializeWithBigInts(value: unknown): string {
  return JSON.stringify(value, (_key, candidate: unknown) =>
    typeof candidate === "bigint" ? `bigint:${candidate.toString()}` : candidate,
  );
}

function parseWithBigInts<T>(value: string): T {
  return JSON.parse(value, (_key, candidate: unknown) => {
    if (typeof candidate === "string" && /^bigint:\d+$/.test(candidate)) {
      return BigInt(candidate.slice("bigint:".length));
    }
    return candidate;
  }) as T;
}

export class PairFlowDatabase {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec(
      "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
    );
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pair_flow_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        observed_at TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pair_flow_snapshots_observed
        ON pair_flow_snapshots(observed_at DESC);
      CREATE TABLE IF NOT EXISTS pair_flow_transaction_details (
        tx_hash TEXT PRIMARY KEY,
        block_number INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pair_flow_events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL CHECK(event_type IN ('buyback', 'burn')),
        category TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        block_number INTEGER NOT NULL,
        tx_hash TEXT NOT NULL,
        actor_address TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pair_flow_events_time
        ON pair_flow_events(timestamp DESC, block_number DESC);
      CREATE INDEX IF NOT EXISTS idx_pair_flow_events_type_time
        ON pair_flow_events(event_type, timestamp DESC);
    `);
  }

  save(payload: PairFlowResponse): void {
    this.db
      .prepare(`
        INSERT INTO pair_flow_snapshots(observed_at, status, payload_json)
        VALUES (?, ?, ?)
      `)
      .run(payload.observedAt, payload.status, JSON.stringify(payload));
    this.db.exec(`
      DELETE FROM pair_flow_snapshots
      WHERE id NOT IN (
        SELECT id FROM pair_flow_snapshots ORDER BY id DESC LIMIT 2048
      );
    `);
  }

  latest(): PairFlowResponse | null {
    const row = this.db
      .prepare("SELECT payload_json FROM pair_flow_snapshots ORDER BY id DESC LIMIT 1")
      .get() as SnapshotRow | undefined;
    if (!row) return null;
    try {
      const payload = JSON.parse(row.payload_json) as PairFlowResponse;
      return payload.service === "rhc-pair-flow" ? payload : null;
    } catch {
      return null;
    }
  }

  transactionDetails(hashes: string[]): Map<string, PairTransactionDetail> {
    const details = new Map<string, PairTransactionDetail>();
    const statement = this.db.prepare(
      "SELECT payload_json FROM pair_flow_transaction_details WHERE tx_hash = ?",
    );
    for (const hash of [...new Set(hashes)]) {
      const row = statement.get(hash) as SnapshotRow | undefined;
      if (!row) continue;
      try {
        const detail = parseWithBigInts<PairTransactionDetail>(row.payload_json);
        if (detail.hash === hash) details.set(hash, detail);
      } catch {
        // Ignore a damaged cache row; the next refresh can fetch it again.
      }
    }
    return details;
  }

  saveTransactionDetails(details: Iterable<PairTransactionDetail>): void {
    const statement = this.db.prepare(`
      INSERT INTO pair_flow_transaction_details(
        tx_hash, block_number, timestamp, status, payload_json, fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(tx_hash) DO UPDATE SET
        block_number = excluded.block_number,
        timestamp = excluded.timestamp,
        status = excluded.status,
        payload_json = excluded.payload_json,
        fetched_at = excluded.fetched_at
    `);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const detail of details) {
        statement.run(
          detail.hash,
          detail.blockNumber,
          detail.timestamp,
          detail.status,
          serializeWithBigInts(detail),
          detail.fetchedAt,
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  saveEvents(events: PairFlowEvent[], replace: boolean, updatedAt: string): void {
    const statement = this.db.prepare(`
      INSERT INTO pair_flow_events(
        event_id, event_type, category, timestamp, block_number,
        tx_hash, actor_address, payload_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO UPDATE SET
        event_type = excluded.event_type,
        category = excluded.category,
        timestamp = excluded.timestamp,
        block_number = excluded.block_number,
        tx_hash = excluded.tx_hash,
        actor_address = excluded.actor_address,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (replace) this.db.exec("DELETE FROM pair_flow_events");
      for (const event of events) {
        statement.run(
          event.id,
          event.type,
          event.category,
          event.timestamp,
          event.blockNumber,
          event.txHash,
          event.actorAddress,
          JSON.stringify(event),
          updatedAt,
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  eventCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM pair_flow_events").get() as
      | { count: number }
      | undefined;
    return row?.count ?? 0;
  }

  listEvents(
    query: PairFlowEventsQuery,
    since: string | null,
  ): { items: PairFlowEvent[]; matched: number; buyback: number; burn: number } {
    const windowWhere = since ? "timestamp >= ?" : "1 = 1";
    const windowParameters = since ? [since] : [];
    const counts = this.db
      .prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN event_type = 'buyback' THEN 1 ELSE 0 END) AS buyback,
          SUM(CASE WHEN event_type = 'burn' THEN 1 ELSE 0 END) AS burn
        FROM pair_flow_events
        WHERE ${windowWhere}
      `)
      .get(...windowParameters) as { total: number; buyback: number | null; burn: number | null };
    const typeWhere = query.type === "all" ? "" : " AND event_type = ?";
    const parameters: Array<string | number> = [
      ...windowParameters,
      ...(query.type === "all" ? [] : [query.type]),
    ];
    const matched = this.db
      .prepare(`SELECT COUNT(*) AS count FROM pair_flow_events WHERE ${windowWhere}${typeWhere}`)
      .get(...parameters) as { count: number };
    const rows = this.db
      .prepare(`
        SELECT payload_json, event_type
        FROM pair_flow_events
        WHERE ${windowWhere}${typeWhere}
        ORDER BY timestamp DESC, block_number DESC, event_id ASC
        LIMIT ? OFFSET ?
      `)
      .all(...parameters, query.limit, query.offset) as unknown as EventRow[];
    return {
      items: rows.flatMap((row) => {
        try {
          const event = JSON.parse(row.payload_json) as PairFlowEvent;
          return event.type === row.event_type ? [event] : [];
        } catch {
          return [];
        }
      }),
      matched: matched.count,
      buyback: counts.buyback ?? 0,
      burn: counts.burn ?? 0,
    };
  }

  close(): void {
    this.db.close();
  }
}
