import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function deploymentFile(name: string): Promise<string> {
  return readFile(new URL(`../deploy/${name}`, import.meta.url), "utf8");
}

test("economics production config pins the market CLI and separates public from resilient scheduled refreshes", async () => {
  const [applicationService, refreshService, refreshTimer, nginx] = await Promise.all([
    deploymentFile("robinhood-chain-launchpad.service"),
    deploymentFile("robinhood-chain-economics-refresh.service"),
    deploymentFile("robinhood-chain-economics-refresh.timer"),
    deploymentFile("nginx-robinhood-chain-launchpad.conf"),
  ]);

  assert.match(
    applicationService,
    /ECONOMICS_GMGN_BIN=\/opt\/robinhood-chain-launchpad\/current\/node_modules\/\.bin\/gmgn-cli/,
  );
  assert.match(nginx, /location = \/api\/economics\/refresh[\s\S]*limit_req/);
  assert.match(nginx, /location = \/api\/economics\/refresh[\s\S]*proxy_read_timeout 180s/);
  assert.match(nginx, /location = \/api\/economics\/rebuild[\s\S]*return 403/);
  assert.match(nginx, /gzip_types application\/json/);
  assert.match(refreshService, /--retry 5/);
  assert.match(refreshService, /--retry-delay 30/);
  assert.match(refreshService, /--retry-max-time 210/);
  assert.match(refreshService, /--retry-all-errors/);
  assert.match(refreshService, /--output \/dev\/null/);
  assert.match(refreshService, /POST http:\/\/127\.0\.0\.1:4176\/api\/economics\/rebuild/);
  assert.match(refreshTimer, /OnCalendar=\*-\*-\* \*:10,25,40,55:00 UTC/);
});
