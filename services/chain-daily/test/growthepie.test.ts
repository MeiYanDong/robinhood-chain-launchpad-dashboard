import assert from "node:assert/strict";
import test from "node:test";
import { buildGrowthepieMetrics, parseFundamentals } from "../src/growthepie.js";

const master = {
  chains: {
    robinhood: { name: "Robinhood Chain", launch_date: "2026-07-01" },
    base: { name: "Base", launch_date: "2023-08-09" },
    arbitrum: { name: "Arbitrum", launch_date: "2021-08-31" },
    ethereum: { name: "Ethereum" },
    all_l2s: { name: "All L2s" },
  },
};

test("parses only complete numeric fundamental rows", () => {
  const rows = parseFundamentals([
    { metric_key: "txcount", origin_key: "robinhood", date: "2026-08-22", value: 10 },
    { metric_key: "txcount", origin_key: "robinhood", date: "bad", value: 20 },
    { metric_key: "txcount", origin_key: "robinhood", date: "2026-08-22", value: "30" },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[1]?.value, 30);
});

test("uses Robinhood data date for same-day ranks and reports source lag", () => {
  const data = [
    { metric_key: "txcount", origin_key: "robinhood", date: "2026-08-15", value: 100 },
    { metric_key: "txcount", origin_key: "robinhood", date: "2026-08-22", value: 200 },
    { metric_key: "txcount", origin_key: "base", date: "2026-08-22", value: 300 },
    { metric_key: "txcount", origin_key: "arbitrum", date: "2026-08-22", value: 50 },
    { metric_key: "txcount", origin_key: "base", date: "2026-08-23", value: 999 },
  ];
  const metric = buildGrowthepieMetrics(data, master, "2026-08-23").find((item) => item.id === "transactions");
  assert.ok(metric);
  assert.equal(metric.value, 200);
  assert.equal(metric.dataDate, "2026-08-22");
  assert.equal(metric.lagDays, 1);
  assert.equal(metric.freshness, "ok");
  assert.equal(metric.change7d, 1);
  assert.equal(metric.peerRank, 2);
  assert.equal(metric.peerTotal, 3);
  assert.equal(metric.trackedRank, 2);
  assert.equal(metric.trackedTotal, 3);
  assert.equal(metric.percentile, 50);
  assert.equal(metric.peers.find((peer) => peer.id === "base")?.value, 300);
});

test("missing source values remain unavailable rather than zero", () => {
  const metric = buildGrowthepieMetrics([], master, "2026-08-23").find((item) => item.id === "transactions");
  assert.ok(metric);
  assert.equal(metric.value, null);
  assert.equal(metric.freshness, "unavailable");
});
