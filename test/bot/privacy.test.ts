import assert from "node:assert/strict";
import test from "node:test";
import { BotError, toBotError } from "../../src/bot/errors.js";
import {
  safeErrorCode,
  type SafeLogEvent,
  StructuredLogger,
} from "../../src/bot/privacy/logging.js";
import { VoluntaryReportFeature } from "../../src/bot/privacy/reports.js";

test("structured logging emits only the fixed safe schema even when runtime input has extra fields", () => {
  const lines: string[] = [];
  const logger = new StructuredLogger(
    (line) => lines.push(line),
    () => new Date("2026-08-30T01:00:00.000Z"),
  );
  const malicious = {
    stage: "ledger",
    outcome: "failed",
    latencyMs: 12,
    code: "LEDGER_UNAVAILABLE",
    message: "raw message: transfer funds",
    userId: "user-secret-123",
    chatId: "group-secret-456",
    updateId: "update-secret-789",
    authorization: "Bearer super-secret",
    url: "http://private-host/path?token=secret",
  } as unknown as Omit<SafeLogEvent, "at">;
  logger.log(malicious);

  assert.deepEqual(JSON.parse(lines[0] ?? "{}"), {
    at: "2026-08-30T01:00:00.000Z",
    stage: "ledger",
    outcome: "failed",
    latencyMs: 12,
    code: "LEDGER_UNAVAILABLE",
  });
  assert.doesNotMatch(lines[0] ?? "", /user-secret|group-secret|update-secret|Bearer|private-host/);
});

test("external exceptions are reduced to stable codes and public messages", () => {
  const raw = new Error("Authorization Bearer secret at http://private-host/stack");
  assert.equal(safeErrorCode(raw, "LEDGER_UNAVAILABLE"), "LEDGER_UNAVAILABLE");
  const safe = toBotError(raw, "LEDGER_UNAVAILABLE");
  assert.equal(safe.code, "LEDGER_UNAVAILABLE");
  assert.doesNotMatch(safe.userMessage, /Bearer|private-host|stack|secret/);
  assert.equal(new BotError("DEBOX_AUTH_ERROR").message, "DEBOX_AUTH_ERROR");
});

test("voluntary sample reporting is disabled by default and has no Phase 1 network path", () => {
  const disabled = new VoluntaryReportFeature(false);
  assert.equal(disabled.status(), "disabled");
  assert.throws(() => disabled.submit(), /not implemented in Phase 1/);
  const shellOnly = new VoluntaryReportFeature(true);
  assert.equal(shellOnly.status(), "not_implemented");
  assert.throws(() => shellOnly.submit(), /not implemented in Phase 1/);
});
