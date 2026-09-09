import assert from "node:assert/strict";
import test from "node:test";
import { collectWithDeadline } from "../src/collectors/index.js";
import type { CollectionBatch } from "../src/domain/types.js";

const emptyBatch: CollectionBatch = {
  platforms: [],
  metrics: [],
  stats: [],
  sourceHealth: [],
  raw: [],
  warnings: [],
};

test("collector deadlines settle the orchestration without duplicating a hung source", async () => {
  let calls = 0;
  let release: (batch: CollectionBatch) => void = () => {
    throw new Error("collector release was not initialized");
  };
  const pending = new Promise<CollectionBatch>((resolve) => {
    release = resolve;
  });
  const collect = async () => {
    calls += 1;
    return pending;
  };

  const first = collectWithDeadline("fixture.hung", "2026-09-08", collect, 10);
  const second = collectWithDeadline("fixture.hung", "2026-09-08", collect, 10);
  await Promise.all([
    assert.rejects(first, /collector deadline/),
    assert.rejects(second, /collector deadline/),
  ]);
  assert.equal(calls, 1);

  release(emptyBatch);
  await pending;
  await new Promise((resolve) => setTimeout(resolve, 0));

  const recovered = await collectWithDeadline(
    "fixture.hung",
    "2026-09-08",
    async () => {
      calls += 1;
      return emptyBatch;
    },
    10,
  );
  assert.equal(recovered, emptyBatch);
  assert.equal(calls, 2);
});

test("collector deadlines reject invalid bounds and cross-date reuse", async () => {
  await assert.rejects(
    collectWithDeadline("fixture.invalid", "2026-09-08", async () => emptyBatch, 0),
    /positive integer/,
  );

  let release: (batch: CollectionBatch) => void = () => {
    throw new Error("collector release was not initialized");
  };
  const pending = new Promise<CollectionBatch>((resolve) => {
    release = resolve;
  });
  const first = collectWithDeadline("fixture.cross-date", "2026-09-08", () => pending, 20);
  await assert.rejects(
    collectWithDeadline("fixture.cross-date", "2026-09-09", async () => emptyBatch, 20),
    /earlier target date/,
  );
  release(emptyBatch);
  await first;
});
