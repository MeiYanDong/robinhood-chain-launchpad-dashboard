import { DatabaseSync } from "node:sqlite";
import type {
  PairCollectionBatch,
  PairCollectionRun,
  PairHolderCacheEntry,
  PairQuoteAsset,
  PairRunStatus,
  PairSourceHealth,
  PairTokenSnapshot,
} from "../pair/types.js";

interface RunRow {
  id: number;
  started_at: string;
  completed_at: string | null;
  observed_at: string | null;
  status: PairRunStatus;
  universe_count: number;
  eligible_count: number;
  warnings_json: string;
  error: string | null;
}

interface SnapshotRow {
  run_id: number;
  token_address: string;
  name: string;
  symbol: string;
  token_url: string;
  launched_at: string | null;
  graduated: number;
  observed_at: string;
  price_usd: number | null;
  market_cap_usd: number | null;
  liquidity_depth_usd: number | null;
  volume_24h_usd: number | null;
  holder_count: number | null;
  holder_observed_at: string | null;
  holder_source: string | null;
  quote_assets_json: string;
  eligible: number;
  eligibility_reason: string | null;
  market_data_source: string | null;
  market_data_updated_at: string | null;
}

interface SourceRow {
  source: string;
  status: PairSourceHealth["status"];
  fetched_at: string;
  latency_ms: number;
  message: string;
}

interface ReportRow {
  report_date: string;
  cutoff_at: string;
  generated_at: string;
  run_id: number;
  payload_json: string;
}

export interface TokenRadarDailyReportRecord<TPayload> {
  reportDate: string;
  cutoffAt: string;
  generatedAt: string;
  runId: number;
  payload: TPayload;
}

export interface TokenMembershipRecord {
  tokenAddress: string;
  launcherAddress: string;
  verifiedAt: string;
  blockNumber: string;
  transactionHash: string;
}

function parseWarnings(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function parseQuoteAssets(value: string): PairQuoteAsset[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): PairQuoteAsset[] => {
      if (
        typeof item !== "object" ||
        item === null ||
        typeof (item as PairQuoteAsset).address !== "string" ||
        typeof (item as PairQuoteAsset).symbol !== "string" ||
        !Number.isInteger((item as PairQuoteAsset).decimals)
      ) {
        return [];
      }
      return [item as PairQuoteAsset];
    });
  } catch {
    return [];
  }
}

function safeNamespace(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error("Invalid token radar namespace");
  return value;
}

export class TokenRadarDatabase<TPayload> {
  protected readonly db: DatabaseSync;
  private readonly tables: {
    runs: string;
    tokens: string;
    snapshots: string;
    sources: string;
    reports: string;
    memberships: string;
  };

  constructor(databasePath: string, namespace: string) {
    const prefix = safeNamespace(namespace);
    this.tables = {
      runs: `${prefix}_collection_runs`,
      tokens: `${prefix}_tokens`,
      snapshots: `${prefix}_token_snapshots`,
      sources: `${prefix}_source_health`,
      reports: `${prefix}_daily_reports`,
      memberships: `${prefix}_token_memberships`,
    };
    this.db = new DatabaseSync(databasePath);
    this.db.exec(
      "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
    );
    this.migrate();
  }

  private migrate(): void {
    const { runs, tokens, snapshots, sources, reports, memberships } = this.tables;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${runs} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        observed_at TEXT,
        status TEXT NOT NULL,
        universe_count INTEGER NOT NULL DEFAULT 0,
        eligible_count INTEGER NOT NULL DEFAULT 0,
        warnings_json TEXT NOT NULL DEFAULT '[]',
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS ${tokens} (
        address TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        symbol TEXT NOT NULL,
        token_url TEXT NOT NULL,
        launched_at TEXT,
        graduated INTEGER NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ${snapshots} (
        run_id INTEGER NOT NULL,
        token_address TEXT NOT NULL,
        name TEXT NOT NULL,
        symbol TEXT NOT NULL,
        token_url TEXT NOT NULL,
        launched_at TEXT,
        graduated INTEGER NOT NULL,
        observed_at TEXT NOT NULL,
        price_usd REAL,
        market_cap_usd REAL,
        liquidity_depth_usd REAL,
        volume_24h_usd REAL,
        holder_count INTEGER,
        holder_observed_at TEXT,
        holder_source TEXT,
        quote_assets_json TEXT NOT NULL DEFAULT '[]',
        eligible INTEGER NOT NULL,
        eligibility_reason TEXT,
        market_data_source TEXT,
        market_data_updated_at TEXT,
        PRIMARY KEY (run_id, token_address),
        FOREIGN KEY (run_id) REFERENCES ${runs}(id),
        FOREIGN KEY (token_address) REFERENCES ${tokens}(address)
      );

      CREATE INDEX IF NOT EXISTS idx_${snapshots}_token_run
        ON ${snapshots}(token_address, run_id DESC);

      CREATE TABLE IF NOT EXISTS ${sources} (
        run_id INTEGER NOT NULL,
        source TEXT NOT NULL,
        status TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        latency_ms INTEGER NOT NULL,
        message TEXT NOT NULL,
        PRIMARY KEY (run_id, source),
        FOREIGN KEY (run_id) REFERENCES ${runs}(id)
      );

      CREATE TABLE IF NOT EXISTS ${reports} (
        report_date TEXT PRIMARY KEY,
        cutoff_at TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        run_id INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES ${runs}(id)
      );

      CREATE TABLE IF NOT EXISTS ${memberships} (
        token_address TEXT NOT NULL,
        launcher_address TEXT NOT NULL,
        verified_at TEXT NOT NULL,
        block_number TEXT NOT NULL,
        transaction_hash TEXT NOT NULL,
        PRIMARY KEY (token_address, launcher_address)
      );
    `);

    const snapshotColumns = this.db
      .prepare(`PRAGMA table_info(${snapshots})`)
      .all() as unknown as Array<{ name: string }>;
    if (!snapshotColumns.some((column) => column.name === "price_usd")) {
      this.db.exec(`ALTER TABLE ${snapshots} ADD COLUMN price_usd REAL`);
    }
    if (!snapshotColumns.some((column) => column.name === "quote_assets_json")) {
      this.db.exec(
        `ALTER TABLE ${snapshots} ADD COLUMN quote_assets_json TEXT NOT NULL DEFAULT '[]'`,
      );
    }
  }

  startRun(startedAt: string): number {
    const result = this.db
      .prepare(`INSERT INTO ${this.tables.runs}(started_at, status) VALUES (?, 'running')`)
      .run(startedAt);
    return Number(result.lastInsertRowid);
  }

  completeRun(
    runId: number,
    status: Exclude<PairRunStatus, "running">,
    batch: PairCollectionBatch | null,
    error: string | null = null,
  ): void {
    this.db
      .prepare(`
        UPDATE ${this.tables.runs}
        SET completed_at = ?, observed_at = ?, status = ?, universe_count = ?, eligible_count = ?,
            warnings_json = ?, error = ?
        WHERE id = ?
      `)
      .run(
        new Date().toISOString(),
        batch?.observedAt ?? null,
        status,
        batch?.universeCount ?? 0,
        batch?.eligibleCount ?? 0,
        JSON.stringify(batch?.warnings ?? []),
        error,
        runId,
      );
  }

  writeBatch(runId: number, batch: PairCollectionBatch): void {
    const tokenStatement = this.db.prepare(`
      INSERT INTO ${this.tables.tokens}(
        address, name, symbol, token_url, launched_at, graduated, first_seen_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(address) DO UPDATE SET
        name = excluded.name,
        symbol = excluded.symbol,
        token_url = excluded.token_url,
        launched_at = COALESCE(excluded.launched_at, ${this.tables.tokens}.launched_at),
        graduated = excluded.graduated,
        last_seen_at = excluded.last_seen_at
    `);
    const snapshotStatement = this.db.prepare(`
      INSERT INTO ${this.tables.snapshots}(
        run_id, token_address, name, symbol, token_url, launched_at, graduated, observed_at,
        price_usd, market_cap_usd, liquidity_depth_usd, volume_24h_usd, holder_count,
        holder_observed_at, holder_source, quote_assets_json, eligible, eligibility_reason,
        market_data_source, market_data_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const sourceStatement = this.db.prepare(`
      INSERT INTO ${this.tables.sources}(run_id, source, status, fetched_at, latency_ms, message)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    this.db.exec("BEGIN");
    try {
      for (const token of batch.tokens) {
        tokenStatement.run(
          token.address,
          token.name,
          token.symbol,
          token.tokenUrl,
          token.launchedAt,
          token.graduated ? 1 : 0,
          batch.observedAt,
          batch.observedAt,
        );
      }
      for (const token of batch.tokens.filter((candidate) => candidate.eligible)) {
        snapshotStatement.run(
          runId,
          token.address,
          token.name,
          token.symbol,
          token.tokenUrl,
          token.launchedAt,
          token.graduated ? 1 : 0,
          token.observedAt,
          token.priceUsd,
          token.marketCapUsd,
          token.liquidityDepthUsd,
          token.volume24hUsd,
          token.holderCount,
          token.holderObservedAt,
          token.holderSource,
          JSON.stringify(token.quoteAssets ?? []),
          token.eligible ? 1 : 0,
          token.eligibilityReason,
          token.marketDataSource,
          token.marketDataUpdatedAt,
        );
      }
      for (const source of batch.sourceHealth) {
        sourceStatement.run(
          runId,
          source.source,
          source.status,
          source.fetchedAt,
          source.latencyMs,
          source.message,
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private mapRun(row: RunRow): PairCollectionRun {
    return {
      id: row.id,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      observedAt: row.observed_at,
      status: row.status,
      universeCount: row.universe_count,
      eligibleCount: row.eligible_count,
      warnings: parseWarnings(row.warnings_json),
      error: row.error,
    };
  }

  getRun(runId: number): PairCollectionRun | null {
    const row = this.db.prepare(`SELECT * FROM ${this.tables.runs} WHERE id = ?`).get(runId) as
      | RunRow
      | undefined;
    return row ? this.mapRun(row) : null;
  }

  latestRun(): PairCollectionRun | null {
    const row = this.db
      .prepare(`SELECT * FROM ${this.tables.runs} ORDER BY id DESC LIMIT 1`)
      .get() as RunRow | undefined;
    return row ? this.mapRun(row) : null;
  }

  latestUsableRun(): PairCollectionRun | null {
    const row = this.db
      .prepare(`
        SELECT * FROM ${this.tables.runs}
        WHERE status IN ('success', 'partial')
        ORDER BY id DESC LIMIT 1
      `)
      .get() as RunRow | undefined;
    return row ? this.mapRun(row) : null;
  }

  usableRunAtOrBefore(observedAtUpperBound: string): PairCollectionRun | null {
    const row = this.db
      .prepare(`
        SELECT * FROM ${this.tables.runs}
        WHERE status IN ('success', 'partial')
          AND observed_at IS NOT NULL
          AND observed_at <= ?
        ORDER BY observed_at DESC, id DESC
        LIMIT 1
      `)
      .get(observedAtUpperBound) as RunRow | undefined;
    return row ? this.mapRun(row) : null;
  }

  getSnapshots(runId: number): PairTokenSnapshot[] {
    const rows = this.db
      .prepare(`SELECT * FROM ${this.tables.snapshots} WHERE run_id = ? ORDER BY token_address`)
      .all(runId) as unknown as SnapshotRow[];
    return rows.map((row) => ({
      address: row.token_address,
      name: row.name,
      symbol: row.symbol,
      tokenUrl: row.token_url,
      launchedAt: row.launched_at,
      graduated: row.graduated === 1,
      observedAt: row.observed_at,
      priceUsd: row.price_usd,
      marketCapUsd: row.market_cap_usd,
      liquidityDepthUsd: row.liquidity_depth_usd,
      volume24hUsd: row.volume_24h_usd,
      holderCount: row.holder_count,
      holderObservedAt: row.holder_observed_at,
      holderSource: row.holder_source,
      quoteAssets: parseQuoteAssets(row.quote_assets_json),
      eligible: row.eligible === 1,
      eligibilityReason: row.eligibility_reason,
      marketDataSource: row.market_data_source,
      marketDataUpdatedAt: row.market_data_updated_at,
    }));
  }

  getLatestHolderCache(): Map<string, PairHolderCacheEntry> {
    const rows = this.db
      .prepare(`
        SELECT token_address, holder_count, holder_observed_at, holder_source
        FROM (
          SELECT token_address, holder_count, holder_observed_at, holder_source,
                 ROW_NUMBER() OVER (
                   PARTITION BY token_address
                   ORDER BY holder_observed_at DESC, run_id DESC
                 ) AS row_number
          FROM ${this.tables.snapshots}
          WHERE holder_count IS NOT NULL AND holder_observed_at IS NOT NULL
        )
        WHERE row_number = 1
      `)
      .all() as unknown as Array<{
      token_address: string;
      holder_count: number;
      holder_observed_at: string;
      holder_source: string | null;
    }>;
    return new Map(
      rows.map((row) => [
        row.token_address,
        {
          holderCount: row.holder_count,
          observedAt: row.holder_observed_at,
          source: row.holder_source ?? "gmgn.tokenInfo",
        },
      ]),
    );
  }

  getVerifiedAddresses(launcherAddress: string): Set<string> {
    const rows = this.db
      .prepare(`SELECT token_address FROM ${this.tables.memberships} WHERE launcher_address = ?`)
      .all(launcherAddress.toLowerCase()) as unknown as Array<{ token_address: string }>;
    return new Set(rows.map((row) => row.token_address));
  }

  saveVerifiedMembership(records: TokenMembershipRecord[]): void {
    if (records.length === 0) return;
    const statement = this.db.prepare(`
      INSERT INTO ${this.tables.memberships}(
        token_address, launcher_address, verified_at, block_number, transaction_hash
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(token_address, launcher_address) DO UPDATE SET
        verified_at = excluded.verified_at,
        block_number = excluded.block_number,
        transaction_hash = excluded.transaction_hash
    `);
    this.db.exec("BEGIN");
    try {
      for (const record of records) {
        statement.run(
          record.tokenAddress.toLowerCase(),
          record.launcherAddress.toLowerCase(),
          record.verifiedAt,
          record.blockNumber,
          record.transactionHash,
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getSourceHealth(runId: number): PairSourceHealth[] {
    const rows = this.db
      .prepare(`SELECT * FROM ${this.tables.sources} WHERE run_id = ? ORDER BY source`)
      .all(runId) as unknown as SourceRow[];
    return rows.map((row) => ({
      source: row.source,
      status: row.status,
      fetchedAt: row.fetched_at,
      latencyMs: row.latency_ms,
      message: row.message,
    }));
  }

  saveDailyReport(report: TokenRadarDailyReportRecord<TPayload>): void {
    this.db
      .prepare(`
        INSERT INTO ${this.tables.reports}(report_date, cutoff_at, generated_at, run_id, payload_json)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(report_date) DO UPDATE SET
          cutoff_at = excluded.cutoff_at,
          generated_at = excluded.generated_at,
          run_id = excluded.run_id,
          payload_json = excluded.payload_json
      `)
      .run(
        report.reportDate,
        report.cutoffAt,
        report.generatedAt,
        report.runId,
        JSON.stringify(report.payload),
      );
  }

  private mapReport(row: ReportRow | undefined): TokenRadarDailyReportRecord<TPayload> | null {
    if (!row) return null;
    try {
      return {
        reportDate: row.report_date,
        cutoffAt: row.cutoff_at,
        generatedAt: row.generated_at,
        runId: row.run_id,
        payload: JSON.parse(row.payload_json) as TPayload,
      };
    } catch {
      return null;
    }
  }

  latestDailyReport(): TokenRadarDailyReportRecord<TPayload> | null {
    const row = this.db
      .prepare(`SELECT * FROM ${this.tables.reports} ORDER BY report_date DESC LIMIT 1`)
      .get() as ReportRow | undefined;
    return this.mapReport(row);
  }

  previousDailyReport(reportDate: string): TokenRadarDailyReportRecord<TPayload> | null {
    const row = this.db
      .prepare(`
        SELECT * FROM ${this.tables.reports}
        WHERE report_date < ?
        ORDER BY report_date DESC LIMIT 1
      `)
      .get(reportDate) as ReportRow | undefined;
    return this.mapReport(row);
  }

  close(): void {
    this.db.close();
  }
}
