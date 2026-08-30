import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const htmlUrl = new URL("../public/index.html", import.meta.url);
const appUrl = new URL("../public/app.js", import.meta.url);

test("default dashboard stays focused on the three decision metrics", async () => {
  const html = await readFile(htmlUrl, "utf8");

  assert.match(html, />成交量 </);
  assert.match(html, />用户手续费 </);
  assert.match(html, />平台收入 </);
  assert.doesNotMatch(html, />Revenue</);
  assert.doesNotMatch(
    html,
    /COVERAGE BEFORE|先看覆盖|数字先上桌|Launchpad ledger|ACCOUNTING NOTES|SOURCE ROUTES/,
  );
});

test("coverage and source audit stay on demand", async () => {
  const html = await readFile(htmlUrl, "utf8");

  assert.match(html, /id="method-button"/);
  assert.match(html, /id="method-drawer"[^>]*aria-hidden="true"[^>]*inert/);
  assert.doesNotMatch(html, /id="coverage-view"/);
});

test("mainstream view is stable and registry-driven", async () => {
  const app = await readFile(appUrl, "utf8");

  assert.match(app, /platformScope: "mainstream"/);
  assert.match(app, /platform\.status === "live"/);
  assert.match(app, /const CORE_METRICS = \["volume_usd", "fees_usd", "protocol_revenue_usd"\]/);
});
