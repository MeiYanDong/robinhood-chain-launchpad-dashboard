import assert from "node:assert/strict";
import test from "node:test";
import { explainEvidence } from "../../src/bot/domain/explain.js";
import { basePlan, type QueryPlan } from "../../src/bot/intent/query-plan.js";
import { normalCoverage, normalSources } from "../fixtures/ledger/fixtures.js";

function explanation(overrides: Partial<QueryPlan>) {
  return explainEvidence(
    { ...basePlan("explain"), explainTopic: "platform", ...overrides },
    normalCoverage(),
    normalSources().sources,
  );
}

test("Bankr explanation states known scope and unknown income without inventing zero", () => {
  const result = explanation({ platformId: "bankr", metric: "protocol_revenue_usd" });
  assert.match(result.title, /Bankr/);
  assert.match(result.lines.join("\n"), /未知不等于 \$0/);
  assert.match(result.lines.join("\n"), /Robinhood Chain/);
  assert.equal(result.degraded, true);
});

test("platform explanations are grounded in Ledger policies for all MVP platforms", () => {
  for (const platformId of ["long", "letscash", "stonkbrokers", "pons", "flap"]) {
    const result = explanation({ platformId, metric: "volume_usd" });
    assert.match(
      result.title.toLowerCase(),
      new RegExp(platformId === "stonkbrokers" ? "stonk" : platformId),
    );
    assert.ok(result.lines.length >= 2);
  }
  assert.match(explanation({ platformId: "stonkbrokers" }).lines.join("\n"), /不进入/);
});

test("metric, quality, coverage, and source explanations use fixed evidence templates", () => {
  const metric = explanation({ platformId: null, metric: "fees_usd", explainTopic: "metric" });
  assert.deepEqual(metric.lines, [normalCoverage().definitions.fees_usd]);

  const quality = explanation({ platformId: null, explainTopic: "quality" });
  assert.match(quality.lines.join("\n"), /reported.*derived.*partial/);

  const coverage = explanation({ platformId: null, explainTopic: "coverage" });
  assert.match(coverage.lines.join("\n"), /64 日 coverage.*不能冒充/);

  const sources = explainEvidence(
    { ...basePlan("explain"), explainTopic: "sources" },
    normalCoverage(),
    normalSources("failed").sources,
  );
  assert.match(sources.lines[0] ?? "", /失败 1/);
  assert.equal(sources.degraded, true);
});

test("unknown explanation topic returns a bounded degraded answer", () => {
  const result = explanation({ platformId: null, metric: null, explainTopic: "platform" });
  assert.equal(result.degraded, true);
  assert.match(result.lines[0] ?? "", /请指定/);
});
