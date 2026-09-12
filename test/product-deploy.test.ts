import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("public gateway serves the PAIR workbench while preserving independent read contracts", async () => {
  const [tls, http, cashcat] = await Promise.all([
    readFile(new URL("../deploy/nginx-robinhood-chain-radar-tls.conf", import.meta.url), "utf8"),
    readFile(new URL("../deploy/nginx-robinhood-chain-radar.conf", import.meta.url), "utf8"),
    readFile(new URL("../deploy/nginx-cashcat-sentinel.conf", import.meta.url), "utf8"),
  ]);

  for (const server of [tls, http]) {
    assert.match(server, /location \/ \{[\s\S]*proxy_pass http:\/\/127\.0\.0\.1:4175;/);
    for (const path of ["latest", "history", "snapshot"]) {
      assert.match(
        server,
        new RegExp(`location = /api/${path} \\{[\\s\\S]*proxy_pass http://127\\.0\\.0\\.1:4173;`),
      );
    }
  }

  assert.match(cashcat, /location = \/cashcat \{\s*return 308 \/leaders\/;/);
  assert.match(cashcat, /location = \/cashcat\/ \{\s*return 308 \/leaders\/;/);
  assert.match(cashcat, /location \^~ \/cashcat\/api\//);
  assert.match(cashcat, /proxy_pass http:\/\/127\.0\.0\.1:8010\/api\//);
  assert.match(cashcat, /location \^~ \/cashcat\/reports\//);
  assert.match(cashcat, /limit_except GET HEAD/);
});

test("full-chain daily refresh bypasses the public query cache", async () => {
  const service = await readFile(
    new URL("../deploy/robinhood-chain-launchpad-refresh.service", import.meta.url),
    "utf8",
  );
  assert.match(service, /POST http:\/\/127\.0\.0\.1:4176\/api\/refresh\/catch-up/);
  assert.match(service, /--retry 12 --retry-connrefused --retry-delay 2 --retry-max-time 60/);
  assert.doesNotMatch(service, /127\.0\.0\.1:4175\/api\/refresh/);
});

test("closed-day refresh retries are bounded and become no-ops once every platform catches up", async () => {
  const timer = await readFile(
    new URL("../deploy/robinhood-chain-launchpad-refresh.timer", import.meta.url),
    "utf8",
  );
  assert.equal(timer.match(/^OnCalendar=/gm)?.length, 6);
  for (const hour of ["07", "09", "12", "15", "18", "21"]) {
    assert.match(timer, new RegExp(`OnCalendar=\\*-\\*-\\* ${hour}:10:00 UTC`));
  }
});
