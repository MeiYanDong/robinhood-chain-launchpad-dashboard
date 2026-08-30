import assert from "node:assert/strict";
import test from "node:test";
import { DeBoxTransportError } from "../../src/bot/debox/errors.js";
import { FakeDeBoxTransport } from "../../src/bot/debox/fake.js";
import { InMemoryIdempotencyStore } from "../../src/bot/debox/idempotency.js";
import { sendSegments } from "../../src/bot/debox/outbound.js";
import { BoundedBackoff, LongPollingController } from "../../src/bot/debox/poller.js";
import type { DeBoxInboundEvent } from "../../src/bot/debox/types.js";

function event(updateToken: string): DeBoxInboundEvent {
  return {
    updateToken,
    chatTarget: "ephemeral-chat",
    chatType: "private",
    messageType: "text",
    text: "/status",
    explicitlyMentionsCurrentBot: false,
  };
}

async function waitUntil(predicate: () => boolean, attempts = 100): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("condition was not reached");
}

test("poller replays batches in supplied order, advances fake cursor, and handles empty batches", async () => {
  const transport = new FakeDeBoxTransport();
  transport.enqueue([event("u-2"), event("u-1")]);
  transport.enqueue([]);
  const processed: string[] = [];
  const poller = new LongPollingController(transport, async (update) => {
    processed.push(update.updateToken);
  });

  assert.equal(await poller.runOnce(), 2);
  assert.deepEqual(processed, ["u-2", "u-1"]);
  assert.equal(poller.currentCursor(), "fake-cursor-1");
  assert.equal(await poller.runOnce(), 0);
  assert.equal(poller.currentCursor(), "fake-cursor-2");
  assert.deepEqual(transport.pollCursors, [null, "fake-cursor-1"]);
});

test("bounded exponential backoff applies jitter bounds, caps, and resets", () => {
  const backoff = new BoundedBackoff({ baseMs: 100, maximumMs: 400, random: () => 0 });
  assert.deepEqual(
    [backoff.next(), backoff.next(), backoff.next(), backoff.next()],
    [50, 100, 200, 200],
  );
  backoff.reset();
  assert.equal(backoff.next(), 50);
});

test("poll loop backs off after network/429-style failures and resets after success", async () => {
  const transport = new FakeDeBoxTransport();
  transport.failNextPoll(new DeBoxTransportError("DEBOX_RATE_LIMITED", 25));
  transport.enqueue([event("after-retry")]);
  const originalPoll = transport.poll.bind(transport);
  let pollCalls = 0;
  transport.poll = async (cursor, timeoutSeconds, signal) => {
    pollCalls += 1;
    if (pollCalls <= 2) return originalPoll(cursor, timeoutSeconds, signal);
    return new Promise((_resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => reject(new DeBoxTransportError("DEBOX_NETWORK_ERROR")),
        { once: true },
      );
    });
  };
  const states: string[] = [];
  const errors: string[] = [];
  const sleeps: number[] = [];
  const processed: string[] = [];
  const poller = new LongPollingController(
    transport,
    async (update) => {
      processed.push(update.updateToken);
    },
    {
      backoff: new BoundedBackoff({ baseMs: 100, maximumMs: 200, random: () => 0 }),
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
      onState: (state) => states.push(state),
      onError: (code) => errors.push(code),
    },
  );
  poller.start();
  await waitUntil(() => processed.length === 1);
  await poller.stop();
  assert.deepEqual(sleeps, [50]);
  assert.ok(states.includes("backoff"));
  assert.ok(states.includes("polling"));
  assert.deepEqual(errors, ["DEBOX_RATE_LIMITED"]);
  assert.equal(states.at(-1), "stopped");
});

test("authentication failure opens the poller circuit instead of retrying forever", async () => {
  const transport = new FakeDeBoxTransport();
  transport.failNextPoll(new DeBoxTransportError("DEBOX_AUTH_ERROR"));
  const states: string[] = [];
  const errors: string[] = [];
  const poller = new LongPollingController(transport, async () => undefined, {
    onState: (state) => states.push(state),
    onError: (code) => errors.push(code),
  });
  poller.start();
  await waitUntil(() => states.includes("stopped"));
  assert.deepEqual(states, ["polling", "auth_failed", "stopped"]);
  assert.deepEqual(errors, ["DEBOX_AUTH_ERROR"]);
  assert.equal(transport.pollCursors.length, 1);
});

test("stop aborts an outstanding fake poll and returns within its bound", async () => {
  let aborted = false;
  const transport = new FakeDeBoxTransport();
  transport.poll = async (_cursor, _timeout, signal) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => {
          aborted = true;
          reject(new DeBoxTransportError("DEBOX_NETWORK_ERROR"));
        },
        { once: true },
      );
    });
  const poller = new LongPollingController(transport, async () => undefined);
  poller.start();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await poller.stop(100);
  assert.equal(aborted, true);
});

test("outbound retries retryable faults, respects capped wait, and locks the event target", async () => {
  const transport = new FakeDeBoxTransport();
  transport.failNextSend(new DeBoxTransportError("DEBOX_RATE_LIMITED", 9_000));
  const idempotency = new InMemoryIdempotencyStore();
  assert.equal(idempotency.reserve("u-1"), "new");
  idempotency.setSegments("u-1", ["answer"]);
  const waits: number[] = [];
  await sendSegments(transport, event("u-1"), idempotency, {
    maximumRetryDelayMs: 5_000,
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
    },
  });
  assert.deepEqual(waits, [5_000]);
  assert.equal(transport.sent[0]?.chatTarget, "ephemeral-chat");
  assert.equal(transport.sent[0]?.parseMode, "text");
  assert.equal(idempotency.reserve("u-1"), "sent");
});

test("partial segmented send resumes only unsent segments and preserves ordering", async () => {
  const transport = new FakeDeBoxTransport();
  transport.allowNextSend();
  transport.failNextSend(new DeBoxTransportError("DEBOX_NETWORK_ERROR"));
  transport.failNextSend(new DeBoxTransportError("DEBOX_NETWORK_ERROR"));
  const idempotency = new InMemoryIdempotencyStore();
  assert.equal(idempotency.reserve("u-partial"), "new");
  idempotency.setSegments("u-partial", ["first", "second"]);

  await assert.rejects(
    sendSegments(transport, event("u-partial"), idempotency, { sleep: async () => undefined }),
  );
  assert.deepEqual(
    transport.sent.map((message) => message.text),
    ["first"],
  );
  assert.equal(idempotency.delivery("u-partial").sentSegments, 1);
  assert.equal(idempotency.reserve("u-partial"), "resume_send");

  await sendSegments(transport, event("u-partial"), idempotency, {
    sleep: async () => undefined,
  });
  assert.deepEqual(
    transport.sent.map((message) => message.text),
    ["first", "second"],
  );
  assert.deepEqual(
    transport.sent.map((message) => message.segmentIndex),
    [0, 1],
  );
  assert.equal(idempotency.reserve("u-partial"), "sent");
});

test("authentication send failures are not retried", async () => {
  const transport = new FakeDeBoxTransport();
  transport.failNextSend(new DeBoxTransportError("DEBOX_AUTH_ERROR"));
  const idempotency = new InMemoryIdempotencyStore();
  idempotency.reserve("u-auth");
  idempotency.setSegments("u-auth", ["answer"]);
  let sleeps = 0;
  await assert.rejects(
    sendSegments(transport, event("u-auth"), idempotency, {
      sleep: async () => {
        sleeps += 1;
      },
    }),
    (error) => error instanceof DeBoxTransportError && error.code === "DEBOX_AUTH_ERROR",
  );
  assert.equal(sleeps, 0);
  assert.equal(idempotency.reserve("u-auth"), "resume_send");
});
