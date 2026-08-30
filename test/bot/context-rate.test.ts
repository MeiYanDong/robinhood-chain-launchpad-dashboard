import assert from "node:assert/strict";
import test from "node:test";
import { ChatRateLimiter, TrySemaphore } from "../../src/bot/rate/limiter.js";
import { contextSessionKey, ConversationContextStore } from "../../src/bot/intent/context.js";
import { basePlan } from "../../src/bot/intent/query-plan.js";
import { BotError } from "../../src/bot/errors.js";

test("conversation context keeps three plans in memory and expires at 15 minutes", () => {
  let now = 0;
  const store = new ConversationContextStore(15 * 60_000, 3, () => now);
  for (const days of [1, 7, 30, 1] as const) {
    const plan = basePlan("platform");
    plan.platformId = "long";
    plan.windowDays = days;
    store.add("private:chat-a", plan);
  }
  assert.deepEqual(
    store.recent("private:chat-a").map((plan) => plan.windowDays),
    [7, 30, 1],
  );
  assert.equal(store.latest("private:chat-a")?.platformId, "long");
  now = 15 * 60_000;
  assert.equal(store.latest("private:chat-a"), null);
});

test("private and group contexts are isolated even for the same ephemeral target", () => {
  const store = new ConversationContextStore();
  const plan = basePlan("rank");
  plan.windowDays = 7;
  plan.metric = "fees_usd";
  plan.scope = "live";
  store.add(contextSessionKey("private", "same"), plan);
  assert.equal(store.latest(contextSessionKey("private", "same"))?.windowDays, 7);
  assert.equal(store.latest(contextSessionKey("group", "same")), null);
});

test("chat rate limiter allows burst five, refills one per ten seconds, and isolates chats", () => {
  let now = 0;
  const limiter = new ChatRateLimiter(5, 10_000, () => now);
  assert.deepEqual(
    Array.from({ length: 6 }, () => limiter.allow("private:a")),
    [true, true, true, true, true, false],
  );
  assert.equal(limiter.allow("group:a"), true);
  now = 9_999;
  assert.equal(limiter.allow("private:a"), false);
  now = 10_000;
  assert.equal(limiter.allow("private:a"), true);
  assert.equal(new ChatRateLimiter().allow("private:a"), true);
});

test("try-semaphore rejects excess work immediately and releases capacity", async () => {
  const semaphore = new TrySemaphore(1, "LLM_BUSY");
  let release: () => void = () => {
    throw new Error("release was not initialized");
  };
  const first = semaphore.run(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  assert.equal(semaphore.activeCount(), 1);
  await assert.rejects(
    semaphore.run(async () => undefined),
    (error) => error instanceof BotError && error.code === "LLM_BUSY",
  );
  release();
  await first;
  await semaphore.run(async () => undefined);
  assert.equal(semaphore.activeCount(), 0);
});
