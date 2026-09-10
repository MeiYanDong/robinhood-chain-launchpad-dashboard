import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = join(import.meta.dirname, "..");
const deploymentFile = (name: string) => readFileSync(join(root, "deploy", name), "utf8");

test("Long production jobs refresh separately and keep report generation private", () => {
  const refreshTimer = deploymentFile("robinhood-chain-long-refresh.timer");
  const refreshService = deploymentFile("robinhood-chain-long-refresh.service");
  const dailyTimer = deploymentFile("robinhood-chain-long-daily.timer");
  const dailyService = deploymentFile("robinhood-chain-long-daily.service");
  const nginx = deploymentFile("nginx-robinhood-chain-launchpad.conf");

  assert.match(refreshTimer, /\*:05,20,35,50:00 UTC/);
  assert.match(refreshService, /POST http:\/\/127\.0\.0\.1:4176\/api\/long\/refresh/);
  assert.match(dailyTimer, /00:12:00 UTC/);
  assert.match(dailyService, /POST http:\/\/127\.0\.0\.1:4175\/api\/long\/reports\/generate/);
  assert.match(nginx, /location = \/api\/long\/refresh[\s\S]*limit_req/);
  assert.match(nginx, /location = \/api\/long\/reports\/generate \{\s*return 403;/);
});
