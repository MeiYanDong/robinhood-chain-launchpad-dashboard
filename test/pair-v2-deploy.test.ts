import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("PAIR V2 runs autonomous chain and market monitors inside the server service", async () => {
  const [service, server] = await Promise.all([
    readFile(new URL("../deploy/robinhood-chain-launchpad.service", import.meta.url), "utf8"),
    readFile(new URL("../src/server.ts", import.meta.url), "utf8"),
  ]);

  assert.match(service, /PAIR_V2_CHAIN_POLL_SECONDS=8/);
  assert.match(service, /PAIR_ALPHA_HOT_MARKET_POLL_SECONDS=15/);
  assert.match(service, /PAIR_V2_MARKET_POLL_SECONDS=60/);
  assert.match(service, /PAIR_V2_STALE_AFTER_SECONDS=150/);
  assert.match(service, /DEV_MONITOR_ENABLED=true/);
  assert.match(service, /DEV_MONITOR_POLL_SECONDS=11/);
  assert.match(service, /DEV_MONITOR_BOOTSTRAP_BLOCKS=250000/);
  assert.match(service, /DEV_MONITOR_BUY_CATCHUP_BLOCKS_PER_POLL=2000/);
  assert.match(service, /DEV_MONITOR_BUY_MAX_RECOVERABLE_LAG_BLOCKS=10000/);
  assert.match(service, /DEV_MONITOR_RPC_MIN_INTERVAL_MS=750/);
  assert.match(service, /PAIR_V2_GMGN_BIN=.*node_modules\/.bin\/gmgn-cli/);
  assert.doesNotMatch(service, /PAIR_V2_FEISHU_WEBHOOK_URL=/);
  assert.doesNotMatch(service, /DEV_MONITOR_FEISHU_WEBHOOK_URL=/);
  assert.match(server, /await refresh\("pair_v2", \(\) => pairV2\.ensureFresh\(\)\)/);
  assert.match(server, /pairV2\.start\(\)/);
  assert.match(server, /pairV2\.stop\(\)/);
  assert.match(server, /devMonitor\.start\(\)/);
  assert.match(server, /devMonitor\.stop\(\)/);
  assert.match(server, /new KeyedRequestPool<FetchedJson>\(4\)/);
  assert.match(server, /pairTokenPageRequests\.run\(url/);
});

test("PAIR V2 public route is read-only except for the rate-limited refresh endpoint", async () => {
  const [publicServer, locations] = await Promise.all([
    readFile(new URL("../deploy/nginx-robinhood-chain-launchpad.conf", import.meta.url), "utf8"),
    readFile(
      new URL("../deploy/nginx-robinhood-chain-intelligence-locations.conf", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(publicServer, /location = \/api\/pair\/v2\/refresh/);
  assert.match(publicServer, /location = \/api\/pair\/alpha\/refresh/);
  assert.match(publicServer, /location = \/pair-v2\/ \{\s*return 308 http:\/\/\$host\/pair-v2\/;/);
  assert.match(
    publicServer,
    /location = \/pair-alpha\/ \{\s*return 308 http:\/\/\$host\/pair-alpha\/;/,
  );
  assert.match(locations, /location = \/pair-v2\/api\/pair\/v2\/refresh/);
  assert.match(locations, /proxy_pass http:\/\/127\.0\.0\.1:4175\/api\/pair\/v2\/refresh/);
  assert.match(locations, /location \/pair-v2\/ \{\s*limit_except GET HEAD \{ deny all; \}/);
  assert.match(locations, /location = \/pair-alpha\/api\/pair\/alpha\/refresh/);
  assert.match(locations, /proxy_pass http:\/\/127\.0\.0\.1:4175\/api\/pair\/alpha\/refresh/);
  assert.match(locations, /location \/pair-alpha\/ \{\s*limit_except GET HEAD \{ deny all; \}/);
});
