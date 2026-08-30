import assert from "node:assert/strict";
import test from "node:test";
import { BotDomainService } from "../../src/bot/domain/service.js";
import { buildStatusResult } from "../../src/bot/domain/status.js";
import { LedgerClient } from "../../src/bot/ledger/client.js";
import { basePlan } from "../../src/bot/intent/query-plan.js";
import {
  fixtureFetcher,
  normalHealth,
  normalMeta,
  normalOverview,
  normalRoutes,
  normalSources,
} from "../fixtures/ledger/fixtures.js";

test("status combines health, sources, meta, and stale state without internal diagnostics", () => {
  const result = buildStatusResult({
    health: normalHealth(),
    meta: normalMeta(),
    sources: normalSources("degraded"),
    overview: normalOverview(1, { stale: true, runStatus: "partial" }),
    contractCompatible: true,
  });
  assert.equal(result.ready, true);
  assert.equal(result.contractVersion, 1);
  assert.equal(result.targetDate, "2026-08-29");
  assert.equal(result.stale, true);
  assert.deepEqual(result.sourceCounts, { ok: 0, degraded: 1, failed: 0 });
  assert.doesNotMatch(JSON.stringify(result), /host|port|stack|secret|request/i);
});

test("status stays available in a restricted form when meta contract is incompatible", async () => {
  const routes = normalRoutes();
  routes.set("/api/meta", normalMeta({ apiContractVersion: 2 }));
  const service = new BotDomainService(
    new LedgerClient({
      baseUrl: "http://ledger.test",
      fetcher: fixtureFetcher(routes),
      cacheTtlMs: 0,
    }),
  );
  const result = await service.execute(basePlan("status"));
  assert.equal(result.kind, "status");
  if (result.kind !== "status") return;
  assert.equal(result.result.contractCompatible, false);
  assert.equal(result.result.ready, false);
  assert.equal(result.result.contractVersion, null);
});

test("status degrades safely when Ledger endpoints are unavailable", async () => {
  const fetcher: typeof fetch = async () => {
    throw new TypeError("http://private-host/token/secret");
  };
  const service = new BotDomainService(
    new LedgerClient({ baseUrl: "http://ledger.test", fetcher, cacheTtlMs: 0 }),
  );
  const result = await service.execute(basePlan("status"));
  assert.equal(result.kind, "status");
  if (result.kind !== "status") return;
  assert.equal(result.result.ready, false);
  assert.equal(result.result.targetDate, null);
  assert.equal(result.result.latestRunStatus, "unavailable");
  assert.doesNotMatch(JSON.stringify(result), /private-host|secret/);
});
