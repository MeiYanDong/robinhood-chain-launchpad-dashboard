import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("market intelligence deployment keeps source services private and exposes product-prefixed views", async () => {
  const [service, publicServer, locations] = await Promise.all([
    readFile(new URL("../deploy/robinhood-chain-launchpad.service", import.meta.url), "utf8"),
    readFile(new URL("../deploy/nginx-robinhood-chain-launchpad.conf", import.meta.url), "utf8"),
    readFile(
      new URL("../deploy/nginx-robinhood-chain-intelligence-locations.conf", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(service, /INTELLIGENCE_CHAIN_RADAR_URL=http:\/\/127\.0\.0\.1:4173\/api\/latest/);
  assert.match(service, /INTELLIGENCE_CASHCAT_STATUS_URL=http:\/\/127\.0\.0\.1:8010\/api\/status/);
  assert.doesNotMatch(service, /47\.251\.99\.37/);
  assert.match(publicServer, /location = \/api\/intelligence\/refresh/);
  assert.match(publicServer, /location = \/ \{\s*return 308 http:\/\/\$host\/launchpads\/;/);
  assert.match(publicServer, /location = \/cashcat\/ \{\s*return 308 http:\/\/\$host\/cashcat\/;/);
  assert.match(locations, /location \/leaders\//);
  assert.match(locations, /location \/launchpads\//);
  assert.match(locations, /location \/pair-flow\//);
  assert.match(locations, /location \/pair-alpha\//);
  assert.match(locations, /location = \/pair-flow\/api\/pair\/flow\/refresh/);
  assert.match(locations, /limit_except GET HEAD \{ deny all; \}/);
});
