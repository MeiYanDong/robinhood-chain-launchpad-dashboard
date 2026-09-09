import assert from "node:assert/strict";
import test from "node:test";
import type { IntelligenceSettings } from "../src/intelligence/config.js";
import { ProductService } from "../src/product/service.js";

const settings: IntelligenceSettings = {
  chainRadarUrl: "http://127.0.0.1:4173/api/latest",
  cashcatStatusUrl: "http://127.0.0.1:8010/api/status",
  requestTimeoutMs: 100,
  refreshTtlMinutes: 5,
};

test("product service coalesces upstreams and honors the shared read TTL", async () => {
  let now = new Date("2026-08-30T12:00:00.000Z");
  let fetchCount = 0;
  let intelligenceCount = 0;
  const service = new ProductService(settings, {
    now: () => now,
    fetcher: async (input) => {
      fetchCount += 1;
      const url = new URL(input instanceof Request ? input.url : input);
      return url.port === "4173"
        ? Response.json({
            targetDate: "2026-08-29",
            generatedAt: "2026-08-30T11:59:00.000Z",
            assessment: {},
            quality: { failedSources: 0 },
            metrics: [],
          })
        : Response.json({
            health: { status: "OK", data_sources: {} },
            latest: { observed_at: "2026-08-30T11:59:00.000Z" },
          });
    },
    intelligence: {
      async ensureFresh() {
        intelligenceCount += 1;
        return null;
      },
    },
  });

  const [first, concurrent] = await Promise.all([service.ensureFresh(), service.ensureFresh()]);
  assert.equal(first, concurrent);
  assert.equal(first.status, "partial");
  assert.equal(fetchCount, 2);
  assert.equal(intelligenceCount, 1);
  assert.equal(service.health().ok, true);
  assert.equal(await service.ensureFresh(), first);
  assert.equal(fetchCount, 2);

  now = new Date("2026-08-30T12:06:00.000Z");
  const refreshed = await service.ensureFresh();
  assert.notEqual(refreshed, first);
  assert.equal(fetchCount, 4);
  assert.equal(intelligenceCount, 2);
});

test("product service returns an unavailable read model when every source fails", async () => {
  const warnings: Array<{ event: string; context: Record<string, unknown> }> = [];
  const service = new ProductService(settings, {
    now: () => new Date("2026-08-30T12:00:00.000Z"),
    fetcher: async () => {
      throw new Error("secret upstream detail");
    },
    intelligence: {
      async ensureFresh() {
        throw new Error("secret model detail");
      },
    },
    warn: (event, context) => warnings.push({ event, context }),
  });

  const result = await service.ensureFresh();
  assert.equal(result.status, "unavailable");
  assert.equal(result.cashcat.token.priceUsd, null);
  assert.equal(warnings.length, 0);
  assert.doesNotMatch(JSON.stringify(result), /secret/);
});
