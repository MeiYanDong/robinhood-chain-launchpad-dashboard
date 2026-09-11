import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("storage maintenance keeps three releases and cannot access application databases", async () => {
  const [script, service, timer, cashcatService, cashcatEnvironment] = await Promise.all([
    readFile(new URL("../scripts/production-storage-maintenance.sh", import.meta.url), "utf8"),
    readFile(
      new URL("../deploy/robinhood-chain-storage-maintenance.service", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../deploy/robinhood-chain-storage-maintenance.timer", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../services/cashcat/deploy/linux/cashcat-sentinel.service", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../services/cashcat/deploy/linux/production.env.example", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(script, /MODE="dry-run"/);
  assert.match(script, /KEEP_RELEASES=3/);
  assert.match(script, /KEEP_DEPLOY_BACKUPS=3/);
  assert.match(script, /CASHCAT_STALE_MINUTES=1440/);
  assert.doesNotMatch(script, /\/var\/lib\/robinhood-chain-launchpad/);
  assert.match(service, /InaccessiblePaths=\/var\/lib\/robinhood-chain-launchpad/);
  assert.match(service, /ExecStart=.*production-storage-maintenance\.sh --apply/);
  assert.match(timer, /OnCalendar=\*-\*-\* 19:40:00 UTC/);
  assert.match(timer, /Persistent=true/);
  assert.match(cashcatService, /Environment=CASHCAT_AUTOSTART=0/);
  assert.match(cashcatEnvironment, /CASHCAT_AUTOSTART=0/);
});

test("main database compaction removes only legacy monitor tables from a new copy", async () => {
  const directory = await mkdtemp(join(tmpdir(), "launchpad-compact-"));
  const source = join(directory, "source.sqlite");
  const destination = join(directory, "destination.sqlite");
  try {
    const database = new DatabaseSync(source);
    database.exec(`
      CREATE TABLE platform_daily_metrics (day TEXT PRIMARY KEY, volume REAL NOT NULL);
      INSERT INTO platform_daily_metrics VALUES ('2026-09-11', 42);
      CREATE TABLE pair_v2_token_snapshots (id INTEGER PRIMARY KEY, payload_json TEXT);
      INSERT INTO pair_v2_token_snapshots(payload_json) VALUES ('{"large":true}');
      CREATE TABLE pair_alpha_signals (id INTEGER PRIMARY KEY, score REAL);
      INSERT INTO pair_alpha_signals(score) VALUES (88);
      CREATE TABLE dev_monitor_runs (id INTEGER PRIMARY KEY, observed_at TEXT);
      INSERT INTO dev_monitor_runs(observed_at) VALUES ('2026-09-11T00:00:00Z');
    `);
    database.close();

    await execFileAsync("python3", [
      fileURLToPath(new URL("../scripts/compact-main-database.py", import.meta.url)),
      source,
      destination,
    ]);

    const compacted = new DatabaseSync(destination, { readOnly: true });
    assert.equal(
      compacted.prepare("SELECT volume FROM platform_daily_metrics WHERE day = ?").get("2026-09-11")
        ?.volume,
      42,
    );
    const names = compacted
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((row) => row.name);
    assert.deepEqual(names, ["platform_daily_metrics"]);
    compacted.close();

    const original = new DatabaseSync(source, { readOnly: true });
    assert.equal(
      original.prepare("SELECT COUNT(*) AS count FROM pair_v2_token_snapshots").get()?.count,
      1,
    );
    original.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
