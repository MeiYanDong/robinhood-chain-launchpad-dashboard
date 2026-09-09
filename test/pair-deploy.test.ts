import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function deploymentFile(name: string): Promise<string> {
  return readFile(new URL(`../deploy/${name}`, import.meta.url), "utf8");
}

test("PAIR deployment schedules live snapshots and daily reports on separate timers", async () => {
  const [refreshTimer, refreshService, dailyTimer, dailyService] = await Promise.all([
    deploymentFile("robinhood-chain-pair-refresh.timer"),
    deploymentFile("robinhood-chain-pair-refresh.service"),
    deploymentFile("robinhood-chain-pair-daily.timer"),
    deploymentFile("robinhood-chain-pair-daily.service"),
  ]);

  assert.match(refreshTimer, /OnCalendar=\*-\*-\* \*:00,15,30,45:00 UTC/);
  assert.match(refreshService, /POST http:\/\/127\.0\.0\.1:4176\/api\/pair\/refresh/);
  assert.match(dailyTimer, /OnCalendar=\*-\*-\* 00:10:00 UTC/);
  assert.match(dailyService, /POST http:\/\/127\.0\.0\.1:4176\/api\/pair\/reports\/generate/);
  assert.match(dailyService, /Restart=on-failure/);
  assert.match(dailyService, /RestartSec=120/);
});

test("PAIR capital-flow ledger refreshes in the background every five minutes", async () => {
  const [refreshTimer, refreshService, applicationService] = await Promise.all([
    deploymentFile("robinhood-chain-pair-flow-refresh.timer"),
    deploymentFile("robinhood-chain-pair-flow-refresh.service"),
    deploymentFile("robinhood-chain-launchpad.service"),
  ]);

  assert.match(refreshTimer, /OnCalendar=\*-\*-\* \*:02,07,12,17,22,27,32,37,42,47,52,57:00 UTC/);
  assert.match(refreshTimer, /Persistent=true/);
  assert.match(refreshService, /POST http:\/\/127\.0\.0\.1:4175\/api\/pair\/flow\/refresh/);
  assert.match(applicationService, /PAIR_FLOW_REFRESH_TTL_MINUTES=5/);
  assert.match(applicationService, /PAIR_FLOW_STALE_AFTER_MINUTES=20/);
});

test("PAIR production config pins the holder CLI and keeps report generation private", async () => {
  const [applicationService, nginx] = await Promise.all([
    deploymentFile("robinhood-chain-launchpad.service"),
    deploymentFile("nginx-robinhood-chain-launchpad.conf"),
  ]);

  assert.match(
    applicationService,
    /PAIR_GMGN_BIN=\/opt\/robinhood-chain-launchpad\/current\/node_modules\/\.bin\/gmgn-cli/,
  );
  assert.match(applicationService, /PAIR_API_TIMEOUT_MS=10000/);
  assert.match(applicationService, /PAIR_SNAPSHOT_ATTEMPTS=3/);
  assert.match(applicationService, /PAIR_GMGN_TIMEOUT_MS=8000/);
  assert.match(applicationService, /EnvironmentFile=\/etc\/robinhood-chain-launchpad\.env/);
  assert.match(nginx, /location = \/api\/pair\/refresh[\s\S]*limit_req/);
  assert.match(nginx, /location = \/api\/pair\/reports\/generate \{\s*return 403;/);
});
