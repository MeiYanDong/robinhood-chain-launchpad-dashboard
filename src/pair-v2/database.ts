import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  PairAlphaLifecycleObservation,
  PairV2Alert,
  PairV2AlertSummary,
  PairV2AlphaModelSummary,
  PairV2Bucket,
  PairV2ChainEvent,
  PairV2CollectionBatch,
  PairV2DashboardResponse,
  PairV2HistoricalSnapshot,
  PairV2Launch,
  PairV2MarketToken,
  PairV2Release,
  PairV2RunKind,
  PairV2RunRecord,
  PairV2RunStatus,
  PairV2SourceHealth,
  PairV2TokenView,
} from "./types.js";

interface JsonRow {
  payload_json: string;
}

const TOKEN_HISTORY_RETENTION_HOURS = 72;
const RUN_RETENTION_COUNT = 8_192;
const ALPHA_MINIMUM_DAYS = 14;
const ALPHA_MINIMUM_MATURED_PROJECTS = 50;
const PAIR_ALPHA_MINIMUM_MATURED_PROJECTS = 100;
const ALPHA_HORIZONS = [
  { id: "5m", seconds: 5 * 60, toleranceSeconds: 5 * 60 },
  { id: "30m", seconds: 30 * 60, toleranceSeconds: 15 * 60 },
  { id: "2h", seconds: 2 * 3_600, toleranceSeconds: 60 * 60 },
  { id: "6h", seconds: 6 * 3_600, toleranceSeconds: 2 * 3_600 },
  { id: "24h", seconds: 24 * 3_600, toleranceSeconds: 6 * 3_600 },
] as const;

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const right = sorted[middle];
  if (right === undefined) return null;
  if (sorted.length % 2 === 1) return right;
  const left = sorted[middle - 1];
  return left === undefined ? right : (left + right) / 2;
}

export interface PairV2AlertOutboxRow extends PairV2Alert {
  id: number;
  attempts: number;
}

export class PairV2Database {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec(
      "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
    );
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pair_v2_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL CHECK(kind IN ('chain', 'full')),
        started_at TEXT NOT NULL,
        completed_at TEXT,
        observed_at TEXT,
        status TEXT NOT NULL CHECK(status IN ('running', 'success', 'partial', 'failed')),
        latest_block INTEGER,
        warnings_json TEXT NOT NULL DEFAULT '[]',
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_pair_v2_runs_status_time
        ON pair_v2_runs(status, id DESC);

      CREATE TABLE IF NOT EXISTS pair_v2_releases (
        release_id TEXT PRIMARY KEY,
        manifest_sha256 TEXT NOT NULL,
        canonical INTEGER NOT NULL,
        observed_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pair_v2_tokens (
        address TEXT PRIMARY KEY,
        last_run_id INTEGER NOT NULL,
        observed_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        FOREIGN KEY(last_run_id) REFERENCES pair_v2_runs(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS pair_v2_token_snapshots (
        run_id INTEGER NOT NULL,
        address TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        price_usd REAL,
        market_cap_usd REAL,
        liquidity_usd REAL,
        volume_24h_usd REAL,
        holder_count INTEGER,
        payload_json TEXT NOT NULL,
        PRIMARY KEY(run_id, address),
        FOREIGN KEY(run_id) REFERENCES pair_v2_runs(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_pair_v2_token_history
        ON pair_v2_token_snapshots(address, observed_at DESC);

      CREATE TABLE IF NOT EXISTS pair_v2_launches (
        event_id TEXT PRIMARY KEY,
        release_id TEXT NOT NULL,
        project TEXT NOT NULL,
        vault TEXT NOT NULL,
        mode_id INTEGER NOT NULL,
        block_number INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_pair_v2_launch_project_release
        ON pair_v2_launches(release_id, project);

      CREATE TABLE IF NOT EXISTS pair_v2_events (
        event_id TEXT PRIMARY KEY,
        release_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        block_number INTEGER NOT NULL,
        log_index INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        project TEXT,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pair_v2_events_release_time
        ON pair_v2_events(release_id, block_number DESC, log_index DESC);

      CREATE TABLE IF NOT EXISTS pair_v2_buckets (
        release_id TEXT NOT NULL,
        project TEXT NOT NULL,
        vault TEXT NOT NULL,
        epoch INTEGER NOT NULL,
        asset TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY(release_id, project, epoch, asset)
      );

      CREATE TABLE IF NOT EXISTS pair_v2_source_health (
        run_id INTEGER NOT NULL,
        source_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY(run_id, source_id),
        FOREIGN KEY(run_id) REFERENCES pair_v2_runs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS pair_v2_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pair_v2_dashboard_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL,
        observed_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        FOREIGN KEY(run_id) REFERENCES pair_v2_runs(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_pair_v2_dashboard_snapshots_time
        ON pair_v2_dashboard_snapshots(id DESC);

      -- The dashboard is a materialized cache, not an analytical history table.
      -- Keep one crash-recovery checkpoint instead of rewriting and retaining
      -- thousands of multi-megabyte copies. The legacy table remains untouched
      -- so this migration is reversible and does not delete historical data.
      CREATE TABLE IF NOT EXISTS pair_v2_dashboard_current (
        slot INTEGER PRIMARY KEY CHECK(slot = 1),
        run_id INTEGER NOT NULL,
        observed_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        FOREIGN KEY(run_id) REFERENCES pair_v2_runs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS pair_v2_alert_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dedupe_key TEXT NOT NULL UNIQUE,
        severity TEXT NOT NULL,
        alert_type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        project TEXT,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        sent_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_pair_v2_alert_status
        ON pair_v2_alert_outbox(status, id ASC);

      CREATE TABLE IF NOT EXISTS pair_v2_alpha_signals (
        signal_id TEXT PRIMARY KEY,
        release_id TEXT NOT NULL,
        project TEXT NOT NULL,
        model_version TEXT NOT NULL,
        signal_state TEXT NOT NULL,
        signaled_at TEXT NOT NULL,
        entry_price_usd REAL NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_pair_v2_alpha_first_signal
        ON pair_v2_alpha_signals(release_id, project, model_version);
      CREATE INDEX IF NOT EXISTS idx_pair_v2_alpha_signal_time
        ON pair_v2_alpha_signals(model_version, signaled_at);

      CREATE TABLE IF NOT EXISTS pair_v2_alpha_outcomes (
        signal_id TEXT NOT NULL,
        horizon TEXT NOT NULL,
        target_at TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        exit_price_usd REAL NOT NULL,
        gross_return_pct REAL NOT NULL,
        fee_adjusted_return_pct REAL NOT NULL,
        PRIMARY KEY(signal_id, horizon),
        FOREIGN KEY(signal_id) REFERENCES pair_v2_alpha_signals(signal_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_pair_v2_alpha_outcome_horizon
        ON pair_v2_alpha_outcomes(horizon, observed_at);

      CREATE TABLE IF NOT EXISTS pair_alpha_state (
        address TEXT PRIMARY KEY,
        first_observed_at TEXT NOT NULL,
        first_ignition_at TEXT,
        last_action_state TEXT NOT NULL,
        last_transition_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pair_alpha_state_ignition
        ON pair_alpha_state(first_ignition_at, updated_at DESC);
    `);
    this.db.exec(`
      INSERT OR IGNORE INTO pair_v2_dashboard_current(slot, run_id, observed_at, payload_json)
      SELECT 1, run_id, observed_at, payload_json
      FROM pair_v2_dashboard_snapshots
      ORDER BY id DESC
      LIMIT 1
    `);
  }

  startRun(kind: PairV2RunKind, startedAt: string): number {
    const result = this.db
      .prepare("INSERT INTO pair_v2_runs(kind, started_at, status) VALUES (?, ?, 'running')")
      .run(kind, startedAt);
    return Number(result.lastInsertRowid);
  }

  completeRun(
    runId: number,
    status: Exclude<PairV2RunStatus, "running">,
    completedAt: string,
    observedAt: string | null,
    latestBlock: number | null,
    warnings: string[],
    error: string | null = null,
  ): void {
    this.db
      .prepare(`
        UPDATE pair_v2_runs
        SET completed_at = ?, observed_at = ?, status = ?, latest_block = ?, warnings_json = ?, error = ?
        WHERE id = ?
      `)
      .run(completedAt, observedAt, status, latestBlock, JSON.stringify(warnings), error, runId);
  }

  private runFromRow(row: Record<string, unknown> | undefined): PairV2RunRecord | null {
    if (!row) return null;
    return {
      id: Number(row.id),
      kind: row.kind as PairV2RunKind,
      startedAt: String(row.started_at),
      completedAt: typeof row.completed_at === "string" ? row.completed_at : null,
      observedAt: typeof row.observed_at === "string" ? row.observed_at : null,
      status: row.status as PairV2RunStatus,
      latestBlock: typeof row.latest_block === "number" ? row.latest_block : null,
      warnings: parseJson<string[]>(String(row.warnings_json)) ?? [],
      error: typeof row.error === "string" ? row.error : null,
    };
  }

  latestRun(): PairV2RunRecord | null {
    const row = this.db.prepare("SELECT * FROM pair_v2_runs ORDER BY id DESC LIMIT 1").get() as
      | Record<string, unknown>
      | undefined;
    return this.runFromRow(row);
  }

  latestUsableRun(): PairV2RunRecord | null {
    const row = this.db
      .prepare(
        "SELECT * FROM pair_v2_runs WHERE status IN ('success', 'partial') ORDER BY id DESC LIMIT 1",
      )
      .get() as Record<string, unknown> | undefined;
    return this.runFromRow(row);
  }

  saveBatch(runId: number, batch: PairV2CollectionBatch): void {
    const releaseStatement = this.db.prepare(`
      INSERT INTO pair_v2_releases(release_id, manifest_sha256, canonical, observed_at, payload_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(release_id) DO UPDATE SET
        manifest_sha256 = excluded.manifest_sha256,
        canonical = excluded.canonical,
        observed_at = excluded.observed_at,
        payload_json = excluded.payload_json
    `);
    const tokenStatement = this.db.prepare(`
      INSERT INTO pair_v2_tokens(address, last_run_id, observed_at, payload_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(address) DO UPDATE SET
        last_run_id = excluded.last_run_id,
        observed_at = excluded.observed_at,
        payload_json = excluded.payload_json
    `);
    const snapshotStatement = this.db.prepare(`
      INSERT INTO pair_v2_token_snapshots(
        run_id, address, observed_at, price_usd, market_cap_usd, liquidity_usd,
        volume_24h_usd, holder_count, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const launchStatement = this.db.prepare(`
      INSERT INTO pair_v2_launches(
        event_id, release_id, project, vault, mode_id, block_number, timestamp, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO UPDATE SET
        release_id = excluded.release_id,
        project = excluded.project,
        vault = excluded.vault,
        mode_id = excluded.mode_id,
        block_number = excluded.block_number,
        timestamp = excluded.timestamp,
        payload_json = excluded.payload_json
    `);
    const eventStatement = this.db.prepare(`
      INSERT INTO pair_v2_events(
        event_id, release_id, event_type, block_number, log_index, timestamp, project, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO UPDATE SET
        event_type = excluded.event_type,
        block_number = excluded.block_number,
        log_index = excluded.log_index,
        timestamp = excluded.timestamp,
        project = excluded.project,
        payload_json = excluded.payload_json
    `);
    const bucketStatement = this.db.prepare(`
      INSERT INTO pair_v2_buckets(
        release_id, project, vault, epoch, asset, observed_at, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(release_id, project, epoch, asset) DO UPDATE SET
        vault = excluded.vault,
        observed_at = excluded.observed_at,
        payload_json = excluded.payload_json
    `);
    const sourceStatement = this.db.prepare(`
      INSERT INTO pair_v2_source_health(run_id, source_id, payload_json)
      VALUES (?, ?, ?)
      ON CONFLICT(run_id, source_id) DO UPDATE SET payload_json = excluded.payload_json
    `);

    this.db.exec("BEGIN IMMEDIATE");
    try {
      releaseStatement.run(
        batch.release.releaseId,
        batch.release.manifestSha256,
        batch.release.canonical ? 1 : 0,
        batch.release.observedAt,
        JSON.stringify(batch.release),
      );
      if (batch.kind === "full") {
        // The official token pages are a complete snapshot. Replace the current
        // materialized universe while retaining append-only historical snapshots.
        this.db.prepare("DELETE FROM pair_v2_tokens").run();
        for (const token of batch.tokens) {
          tokenStatement.run(token.address, runId, batch.observedAt, JSON.stringify(token));
          snapshotStatement.run(
            runId,
            token.address,
            batch.observedAt,
            token.priceUsd,
            token.marketCapUsd,
            token.liquidityUsd,
            token.volume24hUsd,
            token.holderCount,
            "{}",
          );
        }
      } else if (batch.marketUpdatedAddresses && batch.marketUpdatedAddresses.length > 0) {
        const updated = new Set(batch.marketUpdatedAddresses);
        for (const token of batch.tokens.filter((candidate) => updated.has(candidate.address))) {
          tokenStatement.run(token.address, runId, batch.observedAt, JSON.stringify(token));
          snapshotStatement.run(
            runId,
            token.address,
            batch.observedAt,
            token.priceUsd,
            token.marketCapUsd,
            token.liquidityUsd,
            token.volume24hUsd,
            token.holderCount,
            "{}",
          );
        }
      }
      // The collector returns the complete canonical launch set for the release.
      // Replacing this small set removes launches orphaned by an overlap-window reorg.
      this.db
        .prepare("DELETE FROM pair_v2_launches WHERE release_id = ?")
        .run(batch.release.releaseId);
      for (const launch of batch.launches) {
        launchStatement.run(
          launch.eventId,
          launch.releaseId,
          launch.project,
          launch.vault,
          launch.modeId,
          launch.blockNumber,
          launch.timestamp,
          JSON.stringify(launch),
        );
      }
      this.db
        .prepare("DELETE FROM pair_v2_events WHERE release_id = ? AND block_number >= ?")
        .run(batch.release.releaseId, batch.scanFromBlock);
      for (const event of batch.events) {
        eventStatement.run(
          event.id,
          event.releaseId,
          event.type,
          event.blockNumber,
          event.logIndex,
          event.timestamp,
          event.project,
          JSON.stringify(event),
        );
      }
      if (batch.kind === "full") {
        this.db
          .prepare("DELETE FROM pair_v2_buckets WHERE release_id = ?")
          .run(batch.release.releaseId);
        for (const bucket of batch.buckets) {
          bucketStatement.run(
            bucket.releaseId,
            bucket.project,
            bucket.vault,
            bucket.epoch,
            bucket.asset,
            bucket.observedAt,
            JSON.stringify(bucket),
          );
        }
        const observed = Date.parse(batch.observedAt);
        if (Number.isFinite(observed)) {
          const cutoff = new Date(
            observed - TOKEN_HISTORY_RETENTION_HOURS * 3_600_000,
          ).toISOString();
          this.db.prepare("DELETE FROM pair_v2_token_snapshots WHERE observed_at < ?").run(cutoff);
        }
      }
      for (const source of batch.sourceHealth) {
        sourceStatement.run(runId, source.id, JSON.stringify(source));
      }
      this.db
        .prepare(`
          INSERT INTO pair_v2_state(key, value, updated_at) VALUES ('cursor_block', ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `)
        .run(String(batch.latestBlock), batch.observedAt);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  cursorBlock(fallback: number): number {
    const row = this.db
      .prepare("SELECT value FROM pair_v2_state WHERE key = 'cursor_block'")
      .get() as { value: string } | undefined;
    if (!row) return fallback;
    const parsed = Number(row.value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
  }

  release(releaseId?: string): PairV2Release | null {
    const row = releaseId
      ? (this.db
          .prepare("SELECT payload_json FROM pair_v2_releases WHERE release_id = ?")
          .get(releaseId) as JsonRow | undefined)
      : (this.db
          .prepare("SELECT payload_json FROM pair_v2_releases ORDER BY observed_at DESC LIMIT 1")
          .get() as JsonRow | undefined);
    return row ? parseJson<PairV2Release>(row.payload_json) : null;
  }

  tokens(): PairV2MarketToken[] {
    const rows = this.db
      .prepare("SELECT payload_json FROM pair_v2_tokens ORDER BY address")
      .all() as unknown as JsonRow[];
    return rows.flatMap((row) => {
      const parsed = parseJson<PairV2MarketToken>(row.payload_json);
      return parsed ? [parsed] : [];
    });
  }

  launches(releaseId: string): PairV2Launch[] {
    const rows = this.db
      .prepare(
        "SELECT payload_json FROM pair_v2_launches WHERE release_id = ? ORDER BY block_number, event_id",
      )
      .all(releaseId) as unknown as JsonRow[];
    return rows.flatMap((row) => {
      const parsed = parseJson<PairV2Launch>(row.payload_json);
      return parsed ? [parsed] : [];
    });
  }

  events(releaseId: string, limit = 500): PairV2ChainEvent[] {
    const rows = this.db
      .prepare(`
        SELECT payload_json FROM pair_v2_events
        WHERE release_id = ?
        ORDER BY block_number DESC, log_index DESC
        LIMIT ?
      `)
      .all(releaseId, limit) as unknown as JsonRow[];
    return rows.flatMap((row) => {
      const parsed = parseJson<PairV2ChainEvent>(row.payload_json);
      return parsed ? [parsed] : [];
    });
  }

  buckets(releaseId: string): PairV2Bucket[] {
    const rows = this.db
      .prepare(
        "SELECT payload_json FROM pair_v2_buckets WHERE release_id = ? ORDER BY project, epoch, asset",
      )
      .all(releaseId) as unknown as JsonRow[];
    return rows.flatMap((row) => {
      const parsed = parseJson<PairV2Bucket>(row.payload_json);
      return parsed ? [parsed] : [];
    });
  }

  sources(runId: number): PairV2SourceHealth[] {
    const rows = this.db
      .prepare("SELECT payload_json FROM pair_v2_source_health WHERE run_id = ? ORDER BY source_id")
      .all(runId) as unknown as JsonRow[];
    return rows.flatMap((row) => {
      const parsed = parseJson<PairV2SourceHealth>(row.payload_json);
      return parsed ? [parsed] : [];
    });
  }

  historicalSnapshots(addresses: string[], before: string): Map<string, PairV2HistoricalSnapshot> {
    const result = new Map<string, PairV2HistoricalSnapshot>();
    const statement = this.db.prepare(`
      SELECT observed_at, price_usd, market_cap_usd, liquidity_usd, volume_24h_usd, holder_count
      FROM pair_v2_token_snapshots
      WHERE address = ? AND observed_at <= ?
      ORDER BY observed_at DESC
      LIMIT 1
    `);
    for (const address of addresses) {
      const row = statement.get(address, before) as
        | {
            observed_at: string;
            price_usd: number | null;
            market_cap_usd: number | null;
            liquidity_usd: number | null;
            volume_24h_usd: number | null;
            holder_count: number | null;
          }
        | undefined;
      if (!row) continue;
      result.set(address, {
        observedAt: row.observed_at,
        priceUsd: row.price_usd,
        marketCapUsd: row.market_cap_usd,
        liquidityUsd: row.liquidity_usd,
        volume24hUsd: row.volume_24h_usd,
        holderCount: row.holder_count,
      });
    }
    return result;
  }

  observeAlphaModel(
    releaseId: string,
    modelVersion: string,
    tokens: PairV2TokenView[],
    observedAt: string,
    options: { signalKind?: "research" | "action" } = {},
  ): PairV2AlphaModelSummary {
    const insertSignal = this.db.prepare(`
      INSERT OR IGNORE INTO pair_v2_alpha_signals(
        signal_id, release_id, project, model_version, signal_state,
        signaled_at, entry_price_usd, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const token of tokens) {
        const actionState = token.alpha.action?.state ?? "evidence_wait";
        const qualifies =
          options.signalKind === "action"
            ? [
                "ignition_watch",
                "retest_watch",
                "probe_eligible",
                "confirmed",
                "no_chase",
              ].includes(actionState)
            : token.alpha.signal.researchEligible &&
              ["forming", "confirmed"].includes(token.alpha.signal.state);
        if (!qualifies || token.priceUsd === null || token.priceUsd <= 0) {
          continue;
        }
        const signalId = `${modelVersion}:${releaseId}:${token.address}`;
        insertSignal.run(
          signalId,
          releaseId,
          token.address,
          modelVersion,
          options.signalKind === "action" ? actionState : token.alpha.signal.state,
          observedAt,
          token.priceUsd,
          JSON.stringify({
            token: {
              address: token.address,
              symbol: token.symbol,
              modeId: token.modeId,
              priceUsd: token.priceUsd,
              marketCapUsd: token.marketCapUsd,
              liquidityUsd: token.liquidityUsd,
              holderCount: token.holderCount,
            },
            alpha: token.alpha,
          }),
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    this.settleAlphaOutcomes(modelVersion, observedAt);
    return this.alphaModelSummary(modelVersion, observedAt);
  }

  private settleAlphaOutcomes(modelVersion: string, observedAt: string): void {
    const nowMs = Date.parse(observedAt);
    if (!Number.isFinite(nowMs)) return;
    const signals = this.db
      .prepare(`
        SELECT signal_id, project, signaled_at, entry_price_usd
        FROM pair_v2_alpha_signals
        WHERE model_version = ?
        ORDER BY signaled_at ASC
      `)
      .all(modelVersion) as unknown as Array<{
      signal_id: string;
      project: string;
      signaled_at: string;
      entry_price_usd: number;
    }>;
    const hasOutcome = this.db.prepare(
      "SELECT 1 AS found FROM pair_v2_alpha_outcomes WHERE signal_id = ? AND horizon = ?",
    );
    const findSnapshot = this.db.prepare(`
      SELECT observed_at, price_usd
      FROM pair_v2_token_snapshots
      WHERE address = ?
        AND observed_at >= ?
        AND observed_at <= ?
        AND price_usd IS NOT NULL
        AND price_usd > 0
      ORDER BY observed_at ASC
      LIMIT 1
    `);
    const insertOutcome = this.db.prepare(`
      INSERT OR IGNORE INTO pair_v2_alpha_outcomes(
        signal_id, horizon, target_at, observed_at, exit_price_usd,
        gross_return_pct, fee_adjusted_return_pct
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const signal of signals) {
        const signaledMs = Date.parse(signal.signaled_at);
        if (!Number.isFinite(signaledMs) || signal.entry_price_usd <= 0) continue;
        for (const horizon of ALPHA_HORIZONS) {
          if (hasOutcome.get(signal.signal_id, horizon.id)) continue;
          const targetMs = signaledMs + horizon.seconds * 1_000;
          if (nowMs < targetMs) continue;
          const targetAt = new Date(targetMs).toISOString();
          const toleranceAt = new Date(targetMs + horizon.toleranceSeconds * 1_000).toISOString();
          const snapshot = findSnapshot.get(signal.project, targetAt, toleranceAt) as
            | { observed_at: string; price_usd: number }
            | undefined;
          if (!snapshot) continue;
          const grossReturnPct = (snapshot.price_usd / signal.entry_price_usd - 1) * 100;
          const feeAdjustedReturnPct =
            (snapshot.price_usd / signal.entry_price_usd) * 0.99 * 0.99 * 100 - 100;
          insertOutcome.run(
            signal.signal_id,
            horizon.id,
            targetAt,
            snapshot.observed_at,
            snapshot.price_usd,
            roundMetric(grossReturnPct),
            roundMetric(feeAdjustedReturnPct),
          );
        }
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private alphaModelSummary(modelVersion: string, observedAt: string): PairV2AlphaModelSummary {
    const signalSummary = this.db
      .prepare(`
        SELECT COUNT(*) AS count, MIN(signaled_at) AS first_at
        FROM pair_v2_alpha_signals
        WHERE model_version = ?
      `)
      .get(modelVersion) as { count: number; first_at: string | null };
    const outcomes = this.db
      .prepare(`
        SELECT outcome.horizon, outcome.gross_return_pct, outcome.fee_adjusted_return_pct
        FROM pair_v2_alpha_outcomes outcome
        JOIN pair_v2_alpha_signals signal ON signal.signal_id = outcome.signal_id
        WHERE signal.model_version = ?
      `)
      .all(modelVersion) as unknown as Array<{
      horizon: string;
      gross_return_pct: number;
      fee_adjusted_return_pct: number;
    }>;
    const nowMs = Date.parse(observedAt);
    const startedMs = signalSummary.first_at ? Date.parse(signalSummary.first_at) : Number.NaN;
    const observationDays =
      Number.isFinite(nowMs) && Number.isFinite(startedMs)
        ? roundMetric(Math.max(0, (nowMs - startedMs) / 86_400_000))
        : 0;
    const matured24hCount = outcomes.filter((outcome) => outcome.horizon === "24h").length;
    const minimumMaturedProjects = modelVersion.startsWith("pair-alpha")
      ? PAIR_ALPHA_MINIMUM_MATURED_PROJECTS
      : ALPHA_MINIMUM_MATURED_PROJECTS;
    const readyForReview =
      observationDays >= ALPHA_MINIMUM_DAYS && matured24hCount >= minimumMaturedProjects;
    return {
      version: modelVersion,
      status: "shadow",
      validated: false,
      observationStartedAt: signalSummary.first_at,
      observationDays,
      firstSignalCount: Number(signalSummary.count),
      matured24hCount,
      graduation: {
        minimumDays: ALPHA_MINIMUM_DAYS,
        minimumMaturedProjects,
        dayProgressPercent: roundMetric(
          Math.min(100, (observationDays / ALPHA_MINIMUM_DAYS) * 100),
        ),
        sampleProgressPercent: roundMetric(
          Math.min(100, (matured24hCount / minimumMaturedProjects) * 100),
        ),
        readyForReview,
      },
      horizons: ALPHA_HORIZONS.map((horizon) => {
        const rows = outcomes.filter((outcome) => outcome.horizon === horizon.id);
        const gross = rows.map((row) => row.gross_return_pct);
        const feeAdjusted = rows.map((row) => row.fee_adjusted_return_pct);
        return {
          horizon: horizon.id,
          observedCount: rows.length,
          medianGrossReturnPct:
            median(gross) === null ? null : roundMetric(median(gross) as number),
          medianFeeAdjustedReturnPct:
            median(feeAdjusted) === null ? null : roundMetric(median(feeAdjusted) as number),
          positiveRatePercent:
            rows.length === 0
              ? null
              : roundMetric((feeAdjusted.filter((value) => value > 0).length / rows.length) * 100),
          loss20RatePercent:
            rows.length === 0
              ? null
              : roundMetric(
                  (feeAdjusted.filter((value) => value <= -20).length / rows.length) * 100,
                ),
        };
      }),
      limitations: [
        "当前为 Shadow 研究信号，不生成买入或仓位指令。",
        "收益仅扣除双边 1% 平台费；滑点、Gas 与可退出深度尚未进入净收益。",
        "达到天数与样本门槛只表示可人工复核，不会自动宣告模型有效。",
      ],
    };
  }

  observeAlphaStates(
    tokens: PairV2TokenView[],
    observedAt: string,
  ): Map<string, PairAlphaLifecycleObservation> {
    const read = this.db.prepare(`
      SELECT first_observed_at, first_ignition_at, last_action_state, last_transition_at
      FROM pair_alpha_state
      WHERE address = ?
    `);
    const upsert = this.db.prepare(`
      INSERT INTO pair_alpha_state(
        address, first_observed_at, first_ignition_at, last_action_state,
        last_transition_at, updated_at, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(address) DO UPDATE SET
        first_ignition_at = excluded.first_ignition_at,
        last_action_state = excluded.last_action_state,
        last_transition_at = excluded.last_transition_at,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json
    `);
    const result = new Map<string, PairAlphaLifecycleObservation>();
    const ignitionStates = new Set([
      "ignition_watch",
      "retest_watch",
      "probe_eligible",
      "confirmed",
      "no_chase",
    ]);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const token of tokens) {
        const actionState = token.alpha.action?.state ?? "evidence_wait";
        const existing = read.get(token.address) as
          | {
              first_observed_at: string;
              first_ignition_at: string | null;
              last_action_state: string;
              last_transition_at: string;
            }
          | undefined;
        const firstObservedAt = existing?.first_observed_at ?? observedAt;
        const firstIgnitionAt =
          existing?.first_ignition_at ?? (ignitionStates.has(actionState) ? observedAt : null);
        const previousActionState = existing?.last_action_state ?? null;
        const lastTransitionAt =
          previousActionState === null || previousActionState !== actionState
            ? observedAt
            : (existing?.last_transition_at ?? observedAt);
        const lifecycle: PairAlphaLifecycleObservation = {
          firstObservedAt,
          firstIgnitionAt,
          lastTransitionAt,
          previousActionState:
            previousActionState as PairAlphaLifecycleObservation["previousActionState"],
        };
        upsert.run(
          token.address,
          firstObservedAt,
          firstIgnitionAt,
          actionState,
          lastTransitionAt,
          observedAt,
          JSON.stringify({ lifecycle, actionState }),
        );
        result.set(token.address, lifecycle);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return result;
  }

  saveDashboard(runId: number, payload: PairV2DashboardResponse): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(`
          INSERT INTO pair_v2_dashboard_current(slot, run_id, observed_at, payload_json)
          VALUES (1, ?, ?, ?)
          ON CONFLICT(slot) DO UPDATE SET
            run_id = excluded.run_id,
            observed_at = excluded.observed_at,
            payload_json = excluded.payload_json
        `)
        .run(runId, payload.observedAt, JSON.stringify(payload));
      this.db.exec(`
        DELETE FROM pair_v2_runs
        WHERE id NOT IN (
          SELECT id FROM pair_v2_runs ORDER BY id DESC LIMIT ${RUN_RETENTION_COUNT}
        )
          AND id NOT IN (SELECT last_run_id FROM pair_v2_tokens)
          AND id NOT IN (SELECT run_id FROM pair_v2_token_snapshots)
          AND id NOT IN (SELECT run_id FROM pair_v2_dashboard_snapshots)
          AND id NOT IN (SELECT run_id FROM pair_v2_dashboard_current)
      `);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  latestDashboard(): PairV2DashboardResponse | null {
    const row = this.db
      .prepare("SELECT payload_json FROM pair_v2_dashboard_current WHERE slot = 1")
      .get() as JsonRow | undefined;
    const payload = row ? parseJson<PairV2DashboardResponse>(row.payload_json) : null;
    if (payload?.service === "rhc-pair-v2-monitor") return payload;
    const legacy = this.db
      .prepare("SELECT payload_json FROM pair_v2_dashboard_snapshots ORDER BY id DESC LIMIT 1")
      .get() as JsonRow | undefined;
    const fallback = legacy ? parseJson<PairV2DashboardResponse>(legacy.payload_json) : null;
    return fallback?.service === "rhc-pair-v2-monitor" ? fallback : null;
  }

  enqueueAlerts(alerts: PairV2Alert[]): number {
    const statement = this.db.prepare(`
      INSERT OR IGNORE INTO pair_v2_alert_outbox(
        dedupe_key, severity, alert_type, title, message, project, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    let inserted = 0;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const alert of alerts) {
        const result = statement.run(
          alert.dedupeKey,
          alert.severity,
          alert.type,
          alert.title,
          alert.message,
          alert.project,
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

  pendingAlerts(limit = 10): PairV2AlertOutboxRow[] {
    const rows = this.db
      .prepare(`
        SELECT id, dedupe_key, severity, alert_type, title, message, project, created_at, attempts
        FROM pair_v2_alert_outbox
        WHERE status IN ('pending', 'failed') AND attempts < 5
        ORDER BY id ASC LIMIT ?
      `)
      .all(limit) as unknown as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: Number(row.id),
      dedupeKey: String(row.dedupe_key),
      severity: row.severity as PairV2Alert["severity"],
      type: row.alert_type as PairV2Alert["type"],
      title: String(row.title),
      message: String(row.message),
      project: typeof row.project === "string" ? row.project : null,
      createdAt: String(row.created_at),
      attempts: Number(row.attempts),
    }));
  }

  markAlertSent(id: number, sentAt: string): void {
    this.db
      .prepare(
        "UPDATE pair_v2_alert_outbox SET status = 'sent', attempts = attempts + 1, sent_at = ?, last_error = NULL WHERE id = ?",
      )
      .run(sentAt, id);
  }

  markAlertFailed(id: number, error: string): void {
    this.db
      .prepare(
        "UPDATE pair_v2_alert_outbox SET status = 'failed', attempts = attempts + 1, last_error = ? WHERE id = ?",
      )
      .run(error.slice(0, 240), id);
  }

  alertSummary(configured: boolean): PairV2AlertSummary {
    const row = this.db
      .prepare(`
        SELECT
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
          MAX(sent_at) AS last_sent_at
        FROM pair_v2_alert_outbox
      `)
      .get() as { pending: number | null; failed: number | null; last_sent_at: string | null };
    return {
      configured,
      pending: row.pending ?? 0,
      failed: row.failed ?? 0,
      lastSentAt: row.last_sent_at,
    };
  }

  close(): void {
    this.db.close();
  }
}
