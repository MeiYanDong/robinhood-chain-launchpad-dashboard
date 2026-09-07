import { TokenRadarDatabase } from "../token-radar/database.js";
import type {
  PairCollectionBatch,
  PairLeaderboardResponse,
  PairPlatformLiveAggregate,
} from "./types.js";

export class PairTokenDatabase extends TokenRadarDatabase<PairLeaderboardResponse> {
  constructor(databasePath: string) {
    super(databasePath, "pair");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pair_universe_aggregates (
        run_id INTEGER PRIMARY KEY,
        observed_at TEXT NOT NULL,
        token_count INTEGER NOT NULL,
        volume_observed_count INTEGER NOT NULL,
        volume_24h_usd REAL NOT NULL,
        FOREIGN KEY(run_id) REFERENCES pair_collection_runs(id) ON DELETE CASCADE
      );
    `);
  }

  getHolderCache() {
    return this.getLatestHolderCache();
  }

  saveUniverseAggregate(runId: number, batch: PairCollectionBatch): void {
    const visibleTokens = batch.tokens.filter(
      (token) => token.eligibilityReason !== "hidden_or_flagged",
    );
    const observedVolumes = visibleTokens.flatMap((token) =>
      token.volume24hUsd !== null && Number.isFinite(token.volume24hUsd)
        ? [token.volume24hUsd]
        : [],
    );
    this.db
      .prepare(`
        INSERT INTO pair_universe_aggregates(
          run_id, observed_at, token_count, volume_observed_count, volume_24h_usd
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(run_id) DO UPDATE SET
          observed_at = excluded.observed_at,
          token_count = excluded.token_count,
          volume_observed_count = excluded.volume_observed_count,
          volume_24h_usd = excluded.volume_24h_usd
      `)
      .run(
        runId,
        batch.observedAt,
        visibleTokens.length,
        observedVolumes.length,
        observedVolumes.reduce((sum, volume) => sum + volume, 0),
      );
  }

  getUniverseAggregate(runId: number): PairPlatformLiveAggregate | null {
    const row = this.db
      .prepare(`
        SELECT run_id, observed_at, token_count, volume_observed_count, volume_24h_usd
        FROM pair_universe_aggregates
        WHERE run_id = ?
      `)
      .get(runId) as
      | {
          run_id: number;
          observed_at: string;
          token_count: number;
          volume_observed_count: number;
          volume_24h_usd: number;
        }
      | undefined;
    if (!row) return null;
    return {
      runId: row.run_id,
      observedAt: row.observed_at,
      tokenCount: row.token_count,
      volumeObservedCount: row.volume_observed_count,
      volume24hUsd: row.volume_24h_usd,
      complete: row.token_count === row.volume_observed_count,
    };
  }
}
