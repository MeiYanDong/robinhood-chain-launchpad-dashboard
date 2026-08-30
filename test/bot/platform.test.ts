import assert from "node:assert/strict";
import test from "node:test";
import { buildPlatformResult } from "../../src/bot/domain/platform.js";
import { metricView, platformView } from "../../src/bot/ledger/view.js";
import { normalOverview, normalPlatform, normalSources } from "../fixtures/ledger/fixtures.js";

test("platform result uses requested-window overview metrics and never detail 64-day coverage", () => {
  const overview = normalOverview(30);
  const detail = normalPlatform("letscash");
  detail.coverage.volume_usd.value = 999_999;
  detail.coverage.volume_usd.observedDays = 64;
  const result = buildPlatformResult(overview, detail, normalSources().sources);

  assert.ok(result);
  assert.equal(result.requestedWindowDays, 30);
  assert.equal(result.platform.metrics.volume_usd.value, 3_000);
  assert.equal(result.platform.metrics.volume_usd.observedDays, 30);
  assert.equal(result.platform.metrics.volume_usd.windowDays, 30);
});

test("rolling 24h remains a separate stat and is not relabeled as 1d", () => {
  const result = buildPlatformResult(
    normalOverview(1),
    normalPlatform("letscash"),
    normalSources().sources,
  );
  assert.ok(result);
  assert.equal(result.platform.metrics.volume_usd.value, 3_000);
  assert.equal(result.platform.stats[0]?.period, "rolling_24h");
  assert.equal(result.platform.stats[0]?.value, 900);
});

test("platform metrics preserve null, zero, qualities, coverage, and unknown reasons", () => {
  const overview = normalOverview(7);
  const bankr = overview.platforms.find((row) => row.id === "bankr");
  const long = overview.platforms.find((row) => row.id === "long");
  assert.ok(bankr && long);
  assert.equal(metricView(bankr, "volume_usd").value, 0);
  assert.equal(metricView(bankr, "volume_usd").unknownReason, null);
  assert.equal(metricView(long, "fees_usd").value, null);
  assert.equal(metricView(long, "fees_usd").unknownReason, "SOURCE_NOT_REPORTING");
  assert.equal(
    metricView(long, "fees_usd", normalSources("failed").sources).unknownReason,
    "SOURCE_FAILED",
  );
});

test("platform view fails closed for missing or mismatched data", () => {
  const overview = normalOverview(1);
  assert.equal(platformView(overview, "missing", null), null);
  assert.equal(platformView(overview, "letscash", normalPlatform("long")), null);
});
