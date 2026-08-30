import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateMeta } from "../../src/bot/ledger/contract.js";
import { API_CONTRACT_VERSION, APP_VERSION, SUPPORTED_WINDOWS } from "../../src/config/app.js";
import { CORE_METRICS } from "../../src/domain/types.js";
import { DashboardService } from "../../src/services/dashboard.js";
import { DashboardDatabase } from "../../src/storage/database.js";

test("GET /api/meta service contract is stable, read-only, and aligned with package version", () => {
  const directory = mkdtempSync(join(tmpdir(), "rhc-meta-"));
  const database = new DashboardDatabase(join(directory, "ledger.sqlite"));
  let collectorCalls = 0;
  try {
    const service = new DashboardService(database, 15, {
      collect: async () => {
        collectorCalls += 1;
        throw new Error("meta must not collect");
      },
    });
    const meta = validateMeta(service.meta());
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

    assert.equal(meta.service, "rhc-launch-ledger");
    assert.equal(meta.appVersion, APP_VERSION);
    assert.equal(meta.appVersion, packageJson.version);
    assert.equal(meta.apiContractVersion, API_CONTRACT_VERSION);
    assert.equal(Number.isInteger(meta.apiContractVersion), true);
    assert.deepEqual(meta.supportedWindows, SUPPORTED_WINDOWS);
    assert.deepEqual(meta.coreMetrics, CORE_METRICS);
    assert.equal(meta.coreMetrics.includes("protocol_revenue_usd"), true);
    assert.equal(meta.coreMetrics.includes("protocol_income_usd" as never), false);
    assert.equal(
      meta.platforms.every((platform) => /^[a-z0-9-]+$/.test(platform.id)),
      true,
    );
    assert.equal(collectorCalls, 0);
    assert.equal(database.latestRun(), null);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
