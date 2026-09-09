import assert from "node:assert/strict";
import test from "node:test";
import { ChainDailyService } from "../src/chain-daily/service.js";

const snapshot = {
  targetDate: "2026-09-07",
  generatedAt: "2026-09-08T07:00:00.000Z",
  metrics: [{ id: "transactions", value: 9_709_759 }],
};

test("chain daily service coalesces reads, honors its TTL, and retains the last verified snapshot", async () => {
  let now = new Date("2026-09-08T07:00:00.000Z");
  let calls = 0;
  let available = true;
  const service = new ChainDailyService(
    {
      url: "http://127.0.0.1:4173/api/latest",
      requestTimeoutMs: 100,
      refreshTtlMinutes: 5,
    },
    {
      now: () => now,
      fetcher: async () => {
        calls += 1;
        if (!available) throw new Error("private upstream detail");
        await Promise.resolve();
        return Response.json(snapshot);
      },
    },
  );

  const [first, concurrent] = await Promise.all([service.latest(), service.latest()]);
  assert.equal(first, concurrent);
  assert.deepEqual(first, snapshot);
  assert.equal(calls, 1);
  assert.equal(await service.latest(), first);
  assert.equal(calls, 1);

  now = new Date("2026-09-08T07:06:00.000Z");
  available = false;
  assert.equal(await service.latest(), first);
  assert.equal(calls, 2);
});

test("chain daily service rejects malformed first snapshots", async () => {
  const service = new ChainDailyService(
    {
      url: "http://127.0.0.1:4173/api/latest",
      requestTimeoutMs: 100,
      refreshTtlMinutes: 5,
    },
    { fetcher: async () => Response.json({ targetDate: "2026-09-07" }) },
  );

  await assert.rejects(service.latest(), /invalid snapshot/);
});
