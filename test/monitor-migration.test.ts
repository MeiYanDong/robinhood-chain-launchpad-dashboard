import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

test("monitor split preserves cursor/outbox and source while excluding legacy dashboard cache", () => {
  const directory = mkdtempSync(join(tmpdir(), "ledger-split-"));
  const source = join(directory, "source.sqlite");
  const destination = join(directory, "monitor.sqlite");
  const db = new DatabaseSync(source);
  db.exec(`CREATE TABLE pair_v2_state(key TEXT PRIMARY KEY,value TEXT);
    INSERT INTO pair_v2_state VALUES ('cursor','500');
    CREATE TABLE dev_monitor_alert_outbox(id INTEGER PRIMARY KEY,status TEXT);
    INSERT INTO dev_monitor_alert_outbox VALUES (1,'sent');
    CREATE TABLE pair_v2_dashboard_snapshots(id INTEGER,payload TEXT);
    INSERT INTO pair_v2_dashboard_snapshots VALUES (1,'old');`);
  try {
    const run = spawnSync("python3", ["scripts/split-monitor-database.py", source, destination], {
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr);
    const copy = new DatabaseSync(destination);
    try {
      assert.equal(copy.prepare("SELECT value FROM pair_v2_state").get()?.value, "500");
      assert.equal(
        copy.prepare("SELECT status FROM dev_monitor_alert_outbox").get()?.status,
        "sent",
      );
      assert.equal(
        copy
          .prepare(
            "SELECT count(*) AS n FROM sqlite_master WHERE name='pair_v2_dashboard_snapshots'",
          )
          .get()?.n,
        0,
      );
      assert.equal(db.prepare("SELECT count(*) AS n FROM pair_v2_dashboard_snapshots").get()?.n, 1);
      copy.exec(
        "UPDATE pair_v2_state SET value='900'; INSERT INTO dev_monitor_alert_outbox VALUES (2,'sent')",
      );
      const restored = spawnSync(
        "python3",
        ["scripts/restore-monitor-database.py", destination, source],
        { encoding: "utf8" },
      );
      assert.equal(restored.status, 0, restored.stderr);
      assert.equal(db.prepare("SELECT value FROM pair_v2_state").get()?.value, "900");
      assert.equal(
        db.prepare("SELECT status FROM dev_monitor_alert_outbox WHERE id=2").get()?.status,
        "sent",
      );
      assert.notEqual(
        spawnSync("python3", ["scripts/split-monitor-database.py", source, destination]).status,
        0,
      );
    } finally {
      copy.close();
    }
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
