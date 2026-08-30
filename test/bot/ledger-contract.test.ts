import assert from "node:assert/strict";
import test from "node:test";
import { BotError } from "../../src/bot/errors.js";
import { LedgerClient } from "../../src/bot/ledger/client.js";
import {
  validateCoverage,
  validateHealth,
  validateMeta,
  validateOverview,
  validatePlatform,
  validateSources,
} from "../../src/bot/ledger/contract.js";
import {
  fixtureFetcher,
  normalCoverage,
  normalHealth,
  normalMeta,
  normalOverview,
  normalPlatform,
  normalRoutes,
  normalSources,
} from "../fixtures/ledger/fixtures.js";

function rejectsWith(code: BotError["code"]): (error: unknown) => boolean {
  return (error) => error instanceof BotError && error.code === code;
}

test("all six allowed Ledger reads use fixed GET paths and validated payloads", async () => {
  const requests: string[] = [];
  const client = new LedgerClient({
    baseUrl: "http://127.0.0.1:4174",
    fetcher: fixtureFetcher(normalRoutes(), requests),
    cacheTtlMs: 0,
  });

  assert.equal((await client.getHealth()).ok, true);
  assert.equal((await client.getMeta()).apiContractVersion, 1);
  assert.equal((await client.getOverview(7)).windowDays, 7);
  assert.equal((await client.getPlatform("letscash")).platform.id, "letscash");
  assert.equal((await client.getCoverage()).platforms.length, 6);
  assert.equal((await client.getSources()).sources.length, 1);
  assert.deepEqual(requests, [
    "GET /healthz",
    "GET /api/meta",
    "GET /api/overview?window=7",
    "GET /api/platforms/letscash",
    "GET /api/coverage",
    "GET /api/sources",
  ]);
  assert.throws(() => client.getPlatform("../refresh"), rejectsWith("USER_INPUT_INVALID"));
});

test("runtime validators accept fixtures while preserving explicit zero and null", () => {
  assert.equal(validateHealth(normalHealth()).service, "rhc-launch-ledger");
  assert.equal(validateMeta(normalMeta()).coreMetrics.includes("protocol_revenue_usd"), true);
  const overview = validateOverview(normalOverview(1), 1);
  assert.equal(overview.platforms.find((row) => row.id === "bankr")?.metrics.volume_usd.value, 0);
  assert.equal(overview.platforms.find((row) => row.id === "long")?.metrics.fees_usd.value, null);
  assert.equal(
    validatePlatform(normalPlatform("letscash"), "letscash").coverage.volume_usd.windowDays,
    64,
  );
  assert.equal(validateCoverage(normalCoverage()).platforms.length, 6);
  assert.equal(validateSources(normalSources()).sources[0]?.status, "ok");
});

test("schema and contract-version errors fail closed before domain calculation", () => {
  assert.throws(
    () => validateMeta(normalMeta({ apiContractVersion: 2 })),
    rejectsWith("VERSION_NOT_AVAILABLE"),
  );
  assert.throws(
    () => validateMeta({ ...normalMeta(), supportedWindows: [1, 7, 14] }),
    rejectsWith("CONTRACT_INCOMPATIBLE"),
  );

  const badOverview = structuredClone(normalOverview(1)) as unknown as Record<string, unknown>;
  const platforms = badOverview.platforms as Array<Record<string, unknown>>;
  const metrics = platforms[0]?.metrics as Record<string, Record<string, unknown>>;
  if (metrics.volume_usd) metrics.volume_usd.coverage = 2;
  assert.throws(() => validateOverview(badOverview, 1), rejectsWith("CONTRACT_INCOMPATIBLE"));

  const badPlatform = structuredClone(normalPlatform("letscash"));
  if (badPlatform.stats[0]) badPlatform.stats[0].value = Number.NaN;
  assert.throws(
    () => validatePlatform(badPlatform, "letscash"),
    rejectsWith("CONTRACT_INCOMPATIBLE"),
  );

  const badCoverage = structuredClone(normalCoverage()) as unknown as Record<string, unknown>;
  const coveredPlatforms = badCoverage.platforms as Array<Record<string, unknown>>;
  const policies = coveredPlatforms[0]?.metricPolicies as Record<string, Record<string, unknown>>;
  if (policies.volume_usd) policies.volume_usd.quality = "invented";
  assert.throws(() => validateCoverage(badCoverage), rejectsWith("CONTRACT_INCOMPATIBLE"));
});

test("network and 5xx failures retry once while 4xx and schema errors do not", async () => {
  for (const scenario of ["network", "server"] as const) {
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) {
        if (scenario === "network") throw new TypeError("private upstream detail");
        return new Response("unavailable", { status: 503 });
      }
      return Response.json(normalHealth());
    };
    const client = new LedgerClient({ baseUrl: "http://ledger.test", fetcher, cacheTtlMs: 0 });
    assert.equal((await client.getHealth()).ok, true);
    assert.equal(calls, 2);
  }

  for (const response of [
    () => new Response("missing", { status: 404 }),
    () => Response.json({ ok: "yes" }),
  ]) {
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls += 1;
      return response();
    };
    const client = new LedgerClient({ baseUrl: "http://ledger.test", fetcher, cacheTtlMs: 0 });
    await assert.rejects(client.getHealth());
    assert.equal(calls, 1);
  }
});

test("timeouts are bounded, retried once, and mapped without exposing the URL", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (_input, init) => {
    calls += 1;
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("secret host timed out", "TimeoutError")),
        { once: true },
      );
    });
  };
  const client = new LedgerClient({
    baseUrl: "http://private-ledger.test",
    fetcher,
    timeoutMs: 5,
    cacheTtlMs: 0,
  });
  await assert.rejects(client.getHealth(), (error) => {
    assert.ok(error instanceof BotError);
    assert.equal(error.code, "LEDGER_TIMEOUT");
    assert.doesNotMatch(error.userMessage, /private-ledger|secret host/);
    return true;
  });
  assert.equal(calls, 2);
});

test("redirects are never followed and never retried", async () => {
  let calls = 0;
  let redirectMode: RequestRedirect | undefined;
  const fetcher: typeof fetch = async (_input, init) => {
    calls += 1;
    redirectMode = init?.redirect;
    return new Response(null, {
      status: 302,
      headers: { location: "https://attacker.example/steal" },
    });
  };
  const client = new LedgerClient({ baseUrl: "http://ledger.test", fetcher, cacheTtlMs: 0 });
  await assert.rejects(client.getMeta(), rejectsWith("LEDGER_HTTP_ERROR"));
  assert.equal(calls, 1);
  assert.equal(redirectMode, "manual");
});

test("identical concurrent requests share one in-flight Promise", async () => {
  let calls = 0;
  let release: (response: Response) => void = () => {
    throw new Error("release was not initialized");
  };
  const pending = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const fetcher: typeof fetch = async () => {
    calls += 1;
    return pending;
  };
  const client = new LedgerClient({ baseUrl: "http://ledger.test", fetcher, cacheTtlMs: 0 });
  const first = client.getOverview(7);
  const second = client.getOverview(7);
  assert.equal(calls, 1);
  release(Response.json(normalOverview(7)));
  assert.equal((await first).windowDays, 7);
  assert.equal(await second, await first);
});

test("successful responses cache for at most 15 seconds and expire deterministically", async () => {
  let now = 1_000;
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls += 1;
    return Response.json(normalOverview(1));
  };
  const client = new LedgerClient({
    baseUrl: "http://ledger.test",
    fetcher,
    cacheTtlMs: 15_000,
    now: () => now,
  });
  await client.getOverview(1);
  await client.getOverview(1);
  assert.equal(calls, 1);
  now += 15_001;
  await client.getOverview(1);
  assert.equal(calls, 2);
  assert.throws(
    () => new LedgerClient({ baseUrl: "http://ledger.test", cacheTtlMs: 15_001 }),
    rejectsWith("CONFIG_INVALID"),
  );
});

test("a meta target-date boundary clears cached endpoint data", async () => {
  let now = 0;
  let targetDate = "2026-08-29";
  let overviewCalls = 0;
  const fetcher: typeof fetch = async (input) => {
    const path = new URL(input instanceof Request ? input.url : input).pathname;
    if (path === "/api/meta") return Response.json(normalMeta({ targetDate }));
    overviewCalls += 1;
    return Response.json(normalOverview(1, { targetDate }));
  };
  const client = new LedgerClient({
    baseUrl: "http://ledger.test",
    fetcher,
    cacheTtlMs: 10,
    now: () => now,
  });
  await client.getMeta();
  assert.equal((await client.getOverview(1)).targetDate, "2026-08-29");
  targetDate = "2026-08-30";
  now = 11;
  await client.getMeta();
  assert.equal((await client.getOverview(1)).targetDate, "2026-08-30");
  assert.equal(overviewCalls, 2);
});
