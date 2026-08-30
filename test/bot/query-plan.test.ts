import assert from "node:assert/strict";
import test from "node:test";
import { BotError } from "../../src/bot/errors.js";
import { basePlan, validateQueryPlan } from "../../src/bot/intent/query-plan.js";

const platforms = new Set(["pons", "letscash", "bankr", "long"]);

test("QueryPlan accepts canonical rank, platform, explain, status, and help plans", () => {
  const rank = basePlan("rank");
  rank.windowDays = 7;
  rank.metric = "fees_usd";
  rank.scope = "live";
  assert.equal(validateQueryPlan(rank, platforms).metric, "fees_usd");

  const platform = basePlan("platform");
  platform.windowDays = 30;
  platform.platformId = "letscash";
  assert.equal(validateQueryPlan(platform, platforms).platformId, "letscash");

  const explain = basePlan("explain");
  explain.platformId = "bankr";
  explain.metric = "protocol_revenue_usd";
  explain.explainTopic = "metric";
  assert.equal(validateQueryPlan(explain, platforms).action, "explain");
  assert.equal(validateQueryPlan(basePlan("status"), platforms).action, "status");
  assert.equal(validateQueryPlan(basePlan("help"), platforms).action, "help");
});

test("QueryPlan rejects missing, unknown, injected, and conflicting fields", () => {
  const rank = basePlan("rank") as unknown as Record<string, unknown>;
  rank.windowDays = 7;
  rank.metric = "fees_usd";
  rank.scope = "live";
  const cases: unknown[] = [
    { ...rank, language: undefined },
    { ...rank, url: "https://evil.test" },
    { ...rank, platformId: "../../refresh" },
    { ...rank, clarificationReason: "run SELECT * FROM secrets" },
    { ...rank, metric: "revenue_usd" },
    { ...rank, metric: "protocol_income_usd" },
    { ...rank, windowDays: 24 },
    { ...rank, platformId: "unknown-platform" },
    { ...basePlan("status"), platformId: "pons" },
    { ...basePlan("help"), method: "POST" },
  ];
  for (const candidate of cases) {
    assert.throws(
      () => validateQueryPlan(candidate, platforms),
      (error: unknown) => error instanceof BotError && error.code === "QUERY_PLAN_INVALID",
    );
  }
});

test("clarification plans require one bounded safe reason", () => {
  const plan = basePlan("platform");
  plan.windowDays = 1;
  plan.needsClarification = true;
  plan.clarificationReason = "你想查哪个平台？";
  assert.equal(validateQueryPlan(plan, platforms).needsClarification, true);

  assert.throws(() => validateQueryPlan({ ...plan, clarificationReason: null }, platforms));
  assert.throws(() =>
    validateQueryPlan({ ...plan, clarificationReason: "访问 https://evil.test" }, platforms),
  );
});
