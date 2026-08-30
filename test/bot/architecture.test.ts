import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function typescriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? typescriptFiles(path) : entry.name.endsWith(".ts") ? [path] : [];
  });
}

function source(path: string): string {
  return readFileSync(path, "utf8");
}

test("Bot source cannot import collectors, DashboardDatabase, or the Ledger write service", () => {
  const files = typescriptFiles("src/bot");
  for (const file of files) {
    const text = source(file);
    assert.doesNotMatch(text, /from ["'][^"']*collectors(?:\/|["'])/, file);
    assert.doesNotMatch(text, /from ["'][^"']*storage\/database/, file);
    assert.doesNotMatch(text, /DashboardDatabase|DashboardService/, file);
  }
  assert.match(source("src/bot/telemetry/store.ts"), /node:sqlite/);
  assert.doesNotMatch(source("src/bot/telemetry/store.ts"), /launchpad-dashboard\.sqlite/);
});

test("Bot Ledger boundary has no refresh, arbitrary method, redirect-follow, or user URL path", () => {
  const files = typescriptFiles("src/bot");
  const allBotSource = files.map(source).join("\n");
  const client = source("src/bot/ledger/client.ts");
  assert.doesNotMatch(allBotSource, /\/api\/refresh/);
  assert.match(client, /method: "GET"/);
  assert.match(client, /redirect: "manual"/);
  assert.doesNotMatch(client, /method:\s*[a-zA-Z_$]/);
  assert.doesNotMatch(client, /fetch\(.*user|fetch\(.*text|fetch\(.*plan/i);
  assert.match(client, /\/api\/overview\?window=/);
  assert.match(client, /\/api\/platforms\//);
});

test("dashboard default process remains independent from the optional Bot process", () => {
  const packageJson = JSON.parse(source("package.json")) as {
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
  };
  assert.equal(packageJson.scripts.start, "node dist/server.js");
  assert.equal(packageJson.scripts.dev, "tsx watch src/server.ts");
  assert.equal(packageJson.scripts["bot:fake"], "tsx scripts/run-bot-fake.ts");
  assert.doesNotMatch(source("src/server.ts"), /bot\//);
  assert.doesNotMatch(source("src/bot/index.ts"), /server\.js|collectors|storage\/database/);
  assert.deepEqual(Object.keys(packageJson.dependencies), ["wreq-js"]);
});

test("persistent Bot state schema cannot express messages, stable identity, retention, or revisit", () => {
  const telemetry = source("src/bot/telemetry/aggregate.ts");
  const store = source("src/bot/telemetry/store.ts");
  for (const forbidden of [
    "message_text",
    "user_id",
    "chat_id",
    "update_id",
    "wallet_address",
    "unique_user",
    "retention_rate",
    "revisit",
    "fingerprint",
  ]) {
    assert.doesNotMatch(`${telemetry}\n${store}`, new RegExp(forbidden, "i"));
  }
});

test("local fake runner is fixture-only and does not start a real adapter or health listener", () => {
  const runner = source("scripts/run-bot-fake.ts");
  assert.match(runner, /fixtureFetcher\(normalRoutes\(\)/);
  assert.match(runner, /externalNetworkUsed: false/);
  assert.match(runner, /realCredentialsUsed: false/);
  assert.doesNotMatch(runner, /AppSecret|Authorization|startBotHealthServer|process\.env/);
});
