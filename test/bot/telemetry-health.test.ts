import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startBotHealthServer } from "../../src/bot/health/server.js";
import { BotHealthTracker } from "../../src/bot/health/state.js";
import { validateTelemetryBucket } from "../../src/bot/telemetry/aggregate.js";
import { TelemetryStore } from "../../src/bot/telemetry/store.js";

const bucket = {
  date: "2026-08-30",
  action: "rank" as const,
  channel: "private" as const,
  outcome: "ok" as const,
  latencyBucket: "lt_250ms" as const,
  usedLlm: false,
  stale: false,
  qualityCount: 1,
  sourceFailed: 0,
  sourceCount: 1,
  count: 1,
};

test("telemetry schema accepts only anonymous aggregate dimensions", () => {
  assert.deepEqual(validateTelemetryBucket(bucket), bucket);
  for (const forbidden of ["message", "userId", "chatId", "updateId", "fingerprint", "notes"]) {
    assert.throws(() => validateTelemetryBucket({ ...bucket, [forbidden]: "secret" }));
  }
  assert.throws(() => validateTelemetryBucket({ ...bucket, count: 0 }));
  assert.throws(() => validateTelemetryBucket({ ...bucket, sourceFailed: -1 }));
  assert.throws(() => validateTelemetryBucket({ ...bucket, outcome: "unique_user" }));
});

test("telemetry store aggregates identical buckets and prunes only old Bot buckets", () => {
  const directory = mkdtempSync(join(tmpdir(), "rhc-bot-telemetry-"));
  const store = new TelemetryStore(join(directory, "bot-state.sqlite"));
  try {
    const { count: _count, ...dimensions } = bucket;
    store.increment(dimensions);
    store.increment(dimensions, 2);
    store.increment({ ...dimensions, date: "2026-01-01" });
    assert.deepEqual(
      store.all().map((row) => [row.date, row.count]),
      [
        ["2026-01-01", 1],
        ["2026-08-30", 3],
      ],
    );
    assert.equal(store.prune(180, new Date("2026-08-30T12:00:00.000Z")), 1);
    assert.deepEqual(
      store.all().map((row) => row.date),
      ["2026-08-30"],
    );
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("health tracker distinguishes liveness from readiness and exposes no identity data", async () => {
  let now = new Date("2026-08-30T01:00:00.000Z");
  const tracker = new BotHealthTracker(() => now);
  const server = startBotHealthServer(tracker, 0);
  if (!server.listening) await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  assert.equal((address as AddressInfo).address, "127.0.0.1");
  const baseUrl = `http://127.0.0.1:${String((address as AddressInfo).port)}`;

  try {
    const live = await fetch(`${baseUrl}/livez`);
    assert.equal(live.status, 200);
    assert.equal((await live.json()).live, true);
    assert.equal((await fetch(`${baseUrl}/readyz`)).status, 503);

    tracker.update({
      configValid: true,
      identityVerified: true,
      pollingStatus: "polling",
      ledgerReachable: true,
      apiContractCompatible: true,
      llmEnabled: false,
      llmBudgetFuseOpen: true,
    });
    now = new Date("2026-08-30T01:01:00.000Z");
    tracker.markPollSuccess();
    tracker.markReplySuccess();
    const ready = await fetch(`${baseUrl}/readyz`);
    assert.equal(ready.status, 200);
    const payload = await ready.json();
    assert.equal(payload.ready, true);
    assert.equal(payload.lastSuccessfulPoll, "2026-08-30T01:01:00.000Z");
    assert.doesNotMatch(
      JSON.stringify(payload),
      /message|user.?id|chat.?id|update.?id|secret|authorization/i,
    );

    tracker.update({ pollingStatus: "auth_failed" });
    assert.equal((await fetch(`${baseUrl}/readyz`)).status, 503);
    assert.equal((await fetch(`${baseUrl}/livez`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/readyz`, { method: "POST" })).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
