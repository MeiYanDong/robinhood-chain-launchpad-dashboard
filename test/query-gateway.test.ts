import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import {
  createQueryGateway,
  QUERY_CACHE_MAX_AGE_MS,
  QUERY_CACHE_PATHS,
  QUERY_CACHE_STALE_IF_ERROR_MS,
  QUERY_UPSTREAM_TIMEOUT_MS,
} from "../src/http/query-gateway.js";

test("query prewarm covers every decision page without caching mutations", () => {
  const decisionPaths = [
    "/api/overview?window=30",
    "/api/product/today",
    "/api/intelligence",
    "/api/pair/alpha",
    "/api/pair/v2",
    "/api/dev-monitor/pair-launches?tier=all&limit=20&offset=0",
    "/api/dev-monitor/pair-team-launches?limit=5&offset=0",
    "/api/dev-monitor/pair-team-launches?limit=20&offset=0",
    "/api/pair/flow",
    "/api/pair/flow/events?type=all&window=today&limit=50&offset=0",
    "/api/economics/valuation/history",
  ];
  const cachedPaths = new Set<string>(QUERY_CACHE_PATHS);
  for (const path of decisionPaths) assert.ok(cachedPaths.has(path));
  assert.equal(new Set(QUERY_CACHE_PATHS).size, QUERY_CACHE_PATHS.length);
  assert.ok(QUERY_CACHE_PATHS.every((path) => !path.includes("refresh")));
  assert.equal(QUERY_UPSTREAM_TIMEOUT_MS, 15_000);
  assert.equal(QUERY_CACHE_MAX_AGE_MS, 60_000);
  assert.equal(QUERY_CACHE_STALE_IF_ERROR_MS, 300_000);
});

test("query cache serves during collector failure then fails closed at expiry; static remains available", async () => {
  let now = 0;
  let fail = false;
  const fetcher: typeof fetch = async () => {
    if (fail) throw new Error("private upstream details");
    return Response.json({ status: "partial", padding: "测试".repeat(7000) });
  };
  const gateway = createQueryGateway({
    upstream: "http://127.0.0.1:4176",
    fetcher,
    now: () => now,
    cacheMaxAgeMs: 1000,
    staleIfErrorMs: 2000,
    staticHandler: (_req, res) => {
      res.end("static");
    },
  });
  await gateway.refresh();
  const server = createServer(gateway.handler).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  try {
    fail = true;
    for (const encoding of ["gzip", "identity"]) {
      const result = await fetch(`${url}/api/economics`, {
        headers: { "accept-encoding": encoding },
      });
      assert.equal(result.status, 200);
      assert.equal((await result.json()).padding.length, 14000);
    }
    now = 1001;
    const stale = await fetch(`${url}/api/economics`);
    assert.equal(stale.status, 200);
    assert.equal(stale.headers.get("x-ledger-query-stale"), "true");
    assert.equal((await stale.json()).padding.length, 14000);
    now = 2001;
    const expired = await fetch(`${url}/api/economics`);
    assert.equal(expired.status, 503);
    assert.equal((await expired.json()).code, "COLLECTOR_UNAVAILABLE");
    assert.equal(await (await fetch(url)).text(), "static");
    assert.equal((await fetch(`${url}/api/unknown`, { method: "POST" })).status, 404);
    assert.equal((await fetch(`${url}/api/refresh/catch-up`, { method: "POST" })).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("gateway refuses remote origins", () => {
  assert.throws(
    () => createQueryGateway({ upstream: "https://example.com", staticHandler: () => {} }),
    /loopback/,
  );
});
