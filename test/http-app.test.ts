import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createDashboardRequestHandler, type DashboardHttpApi } from "../src/http/app.js";

interface TestContext {
  baseUrl: string;
  port: number;
  events: Array<{ event: string; context: Record<string, unknown> }>;
}

function fakeDashboard(overrides: Partial<DashboardHttpApi> = {}): DashboardHttpApi {
  return {
    health: () => ({ ok: true, service: "fixture" }),
    overview: (windowDays) => ({ route: "overview", windowDays }),
    platformDetail: (platformId) =>
      platformId === "pons" ? { route: "platform", platformId } : null,
    coverage: () => ({ route: "coverage" }),
    sources: () => ({ route: "sources" }),
    refresh: async () => ({ route: "refresh" }),
    ...overrides,
  };
}

async function withServer(
  run: (context: TestContext) => Promise<void>,
  dashboard = fakeDashboard(),
): Promise<void> {
  const publicDirectory = mkdtempSync(join(tmpdir(), "rhc-http-"));
  writeFileSync(join(publicDirectory, "index.html"), "<h1>ledger</h1>");
  writeFileSync(join(publicDirectory, "app.js"), "console.log('ledger');");
  const events: TestContext["events"] = [];
  const server = createServer(
    createDashboardRequestHandler({
      dashboard,
      publicDirectory,
      logger: {
        error(event, context) {
          events.push({ event, context });
        },
      },
    }),
  );

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = (address as AddressInfo).port;

  try {
    await run({ baseUrl: `http://127.0.0.1:${String(port)}`, port, events });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    rmSync(publicDirectory, { recursive: true, force: true });
  }
}

async function rawGet(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: "127.0.0.1", port, path, method: "GET" }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        resolve({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    request.on("error", reject);
    request.end();
  });
}

test("HTTP API routes return their business results", async () => {
  await withServer(async ({ baseUrl }) => {
    const health = await fetch(`${baseUrl}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, service: "fixture" });

    const overview = await fetch(`${baseUrl}/api/overview?window=7`);
    assert.equal(overview.status, 200);
    assert.deepEqual(await overview.json(), { route: "overview", windowDays: 7 });

    const platform = await fetch(`${baseUrl}/api/platforms/pons`);
    assert.equal(platform.status, 200);
    assert.deepEqual(await platform.json(), { route: "platform", platformId: "pons" });

    assert.deepEqual(await (await fetch(`${baseUrl}/api/coverage`)).json(), {
      route: "coverage",
    });
    assert.deepEqual(await (await fetch(`${baseUrl}/api/sources`)).json(), {
      route: "sources",
    });
    assert.deepEqual(await (await fetch(`${baseUrl}/api/refresh`, { method: "POST" })).json(), {
      route: "refresh",
    });
  });
});

test("HTTP API rejects invalid inputs with stable error codes", async () => {
  await withServer(async ({ baseUrl, port }) => {
    const invalidWindow = await fetch(`${baseUrl}/api/overview?window=2`);
    assert.equal(invalidWindow.status, 400);
    assert.deepEqual(await invalidWindow.json(), {
      error: "window must be 1, 7, or 30",
      code: "INVALID_WINDOW",
    });

    const invalidPlatform = await fetch(`${baseUrl}/api/platforms/NOT_VALID`);
    assert.equal(invalidPlatform.status, 400);
    assert.equal((await invalidPlatform.json()).code, "INVALID_PLATFORM_ID");

    const missingPlatform = await fetch(`${baseUrl}/api/platforms/missing`);
    assert.equal(missingPlatform.status, 404);
    assert.equal((await missingPlatform.json()).code, "PLATFORM_NOT_FOUND");

    const invalidPath = await rawGet(port, "/%E0%A4%A");
    assert.equal(invalidPath.status, 400);
    assert.equal(JSON.parse(invalidPath.body).code, "INVALID_PATH");
  });
});

test("static files enforce containment, content policy, and HEAD semantics", async () => {
  await withServer(async ({ baseUrl, port }) => {
    const index = await fetch(`${baseUrl}/`);
    assert.equal(index.status, 200);
    assert.equal(await index.text(), "<h1>ledger</h1>");
    assert.equal(index.headers.get("cache-control"), "no-cache");
    assert.match(index.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);

    const asset = await fetch(`${baseUrl}/app.js`, { method: "HEAD" });
    assert.equal(asset.status, 200);
    assert.equal(await asset.text(), "");
    assert.equal(asset.headers.get("cache-control"), "public, max-age=300");

    const traversal = await rawGet(port, "/..%2Fpackage.json");
    assert.equal(traversal.status, 403);
    assert.equal(JSON.parse(traversal.body).code, "FORBIDDEN");

    const missing = await fetch(`${baseUrl}/missing.html`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).code, "NOT_FOUND");
  });
});

test("internal exceptions are logged by class but never returned to the client", async () => {
  const secretMarker = "postgres://internal-user:secret@private-host/db";
  await withServer(
    async ({ baseUrl, events }) => {
      const response = await fetch(`${baseUrl}/api/overview`);
      assert.equal(response.status, 500);
      const body = await response.text();
      assert.doesNotMatch(body, /internal-user|private-host|secret/);
      assert.deepEqual(JSON.parse(body), {
        error: "Internal server error",
        code: "INTERNAL_ERROR",
      });
      assert.deepEqual(events, [
        {
          event: "dashboard_request_failed",
          context: { method: "GET", pathname: "/api/overview", errorName: "Error" },
        },
      ]);
    },
    fakeDashboard({
      overview() {
        throw new Error(secretMarker);
      },
    }),
  );
});

test("health endpoint reports unavailable service with HTTP 503", async () => {
  await withServer(
    async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/healthz`);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { ok: false, service: "fixture" });
    },
    fakeDashboard({ health: () => ({ ok: false, service: "fixture" }) }),
  );
});
