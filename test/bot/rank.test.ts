import assert from "node:assert/strict";
import test from "node:test";
import { rankPlatforms } from "../../src/bot/domain/rank.js";
import { normalOverview, normalSources } from "../fixtures/ledger/fixtures.js";

test("rank filters null, preserves zero, isolates suite-wide values, and returns Top 5", () => {
  const overview = normalOverview(1);
  const result = rankPlatforms(overview, "volume_usd", "live", normalSources().sources);

  assert.deepEqual(
    result.entries.map((entry) => [entry.name, entry.metric.value]),
    [
      ["Pons", 5_000],
      ["LetsCash", 3_000],
      ["Long", 3_000],
      ["Bankr", 0],
    ],
  );
  assert.equal(result.missingCount, 1);
  assert.deepEqual(
    result.incomparable.map((entry) => entry.name),
    ["StonkBrokers"],
  );
  assert.equal(result.incomparable[0]?.metric.value, 9_000);
  assert.equal(
    result.entries.some((entry) => entry.platformId === "stonkbrokers"),
    false,
  );
});

test("rank supports fees and platform-income without conflating Revenue", () => {
  const overview = normalOverview(7);
  const fees = rankPlatforms(overview, "fees_usd", "live");
  assert.deepEqual(
    fees.entries.map((entry) => [entry.name, entry.metric.value]),
    [
      ["Pons", 700],
      ["LetsCash", 350],
      ["Flap", 70],
    ],
  );
  const income = rankPlatforms(overview, "protocol_revenue_usd", "live");
  assert.equal(income.entries[0]?.name, "Pons");
  assert.equal(income.entries[0]?.metric.value, 300);
  assert.equal(income.metric, "protocol_revenue_usd");
});

test("rank is deterministic under shuffled input and truncates rather than inventing rows", () => {
  const overview = normalOverview(1);
  const first = rankPlatforms(overview, "volume_usd", "all");
  overview.platforms.reverse();
  const second = rankPlatforms(overview, "volume_usd", "all");
  assert.deepEqual(second.entries, first.entries);
  assert.ok(second.entries.length <= 5);
  assert.equal(
    second.entries.every((entry) => entry.metric.value !== null),
    true,
  );
});

test("live and all scopes are distinct and missing data produces an empty result", () => {
  const overview = normalOverview(1);
  const pons = overview.platforms.find((row) => row.id === "pons");
  assert.ok(pons);
  pons.status = "tracked";
  assert.equal(rankPlatforms(overview, "volume_usd", "live").entries[0]?.name, "LetsCash");
  assert.equal(rankPlatforms(overview, "volume_usd", "all").entries[0]?.name, "Pons");

  for (const row of overview.platforms) row.metrics.fees_usd.value = null;
  const empty = rankPlatforms(overview, "fees_usd", "all");
  assert.deepEqual(empty.entries, []);
  assert.equal(empty.missingCount, 5);
});
