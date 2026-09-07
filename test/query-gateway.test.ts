import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { createQueryGateway } from "../src/http/query-gateway.js";

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
    const expired = await fetch(`${url}/api/economics`);
    assert.equal(expired.status, 503);
    assert.equal((await expired.json()).code, "COLLECTOR_UNAVAILABLE");
    assert.equal(await (await fetch(url)).text(), "static");
    assert.equal((await fetch(`${url}/api/unknown`, { method: "POST" })).status, 404);
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
