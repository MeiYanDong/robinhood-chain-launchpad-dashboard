import assert from "node:assert/strict";
import test from "node:test";
import { KeyedRequestPool } from "../src/utils/keyed-request-pool.js";

test("keyed request pool caps aggregate concurrency", async () => {
  const pool = new KeyedRequestPool<number>(2);
  let active = 0;
  let maximum = 0;
  const results = await Promise.all(
    [1, 2, 3, 4, 5].map((value) =>
      pool.run(String(value), async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return value;
      }),
    ),
  );
  assert.deepEqual(results, [1, 2, 3, 4, 5]);
  assert.equal(maximum, 2);
});

test("keyed request pool coalesces identical in-flight work and releases failures", async () => {
  const pool = new KeyedRequestPool<number>(1);
  let calls = 0;
  const first = pool.run("same", async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return 7;
  });
  const second = pool.run("same", async () => {
    calls += 1;
    return 8;
  });
  assert.equal(first, second);
  assert.deepEqual(await Promise.all([first, second]), [7, 7]);
  assert.equal(calls, 1);

  await assert.rejects(
    pool.run("failure", async () => {
      throw new Error("fixture failure");
    }),
    /fixture failure/,
  );
  assert.equal(await pool.run("failure", async () => 9), 9);
});

test("keyed request pool rejects invalid concurrency", () => {
  assert.throws(() => new KeyedRequestPool(0), /positive integer/);
});
