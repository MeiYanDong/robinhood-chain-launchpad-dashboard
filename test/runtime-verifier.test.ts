import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeVerificationError, verifyRuntime } from "../src/ops/runtime-verifier.js";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("runtime verification performs only the three documented GET checks", async () => {
  const requests: Array<{ url: string; method: string; redirect: RequestRedirect }> = [];
  const responses: Record<string, unknown> = {
    "/healthz": { ok: true, service: "rhc-launch-ledger", targetDate: "2026-08-29" },
    "/api/overview?window=30": { targetDate: "2026-08-29", platforms: [{ id: "pons" }] },
    "/api/sources": { sources: [{ source: "fixture", status: "ok" }] },
  };
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    requests.push({
      url: url.pathname + url.search,
      method: init?.method ?? "GET",
      redirect: init?.redirect ?? "follow",
    });
    return jsonResponse(responses[url.pathname + url.search]);
  };

  const result = await verifyRuntime("http://127.0.0.1:4174", {
    fetcher,
    now: () => new Date("2026-08-30T12:00:00.000Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.checkedAt, "2026-08-30T12:00:00.000Z");
  assert.deepEqual(requests, [
    { url: "/healthz", method: "GET", redirect: "error" },
    { url: "/api/overview?window=30", method: "GET", redirect: "error" },
    { url: "/api/sources", method: "GET", redirect: "error" },
  ]);
  assert.equal(result.checks[1]?.itemCount, 1);
});

test("runtime verification fails closed on readiness and response contract errors", async () => {
  await assert.rejects(
    verifyRuntime("http://127.0.0.1:4174", {
      fetcher: async () => jsonResponse({ ok: false, service: "rhc-launch-ledger" }),
    }),
    (error: unknown) =>
      error instanceof RuntimeVerificationError && error.code === "RUNTIME_NOT_READY",
  );

  let requestNumber = 0;
  await assert.rejects(
    verifyRuntime("http://127.0.0.1:4174", {
      fetcher: async () => {
        requestNumber += 1;
        return requestNumber === 1
          ? jsonResponse({ ok: true, service: "rhc-launch-ledger" })
          : jsonResponse({ targetDate: "2026-08-29", platforms: "not-an-array" });
      },
    }),
    (error: unknown) =>
      error instanceof RuntimeVerificationError && error.code === "RUNTIME_CONTRACT_ERROR",
  );
});

test("runtime verification rejects embedded credentials and non-success responses", async () => {
  await assert.rejects(
    verifyRuntime("http://user:secret@127.0.0.1:4174"),
    (error: unknown) =>
      error instanceof RuntimeVerificationError && error.code === "INVALID_BASE_URL",
  );

  await assert.rejects(
    verifyRuntime("http://127.0.0.1:4174", {
      fetcher: async () => jsonResponse({ error: "unavailable" }, 503),
    }),
    (error: unknown) =>
      error instanceof RuntimeVerificationError && error.code === "RUNTIME_HTTP_ERROR",
  );
});
