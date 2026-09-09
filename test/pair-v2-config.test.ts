import assert from "node:assert/strict";
import test from "node:test";
import { pairV2SettingsFromEnv } from "../src/pair-v2/config.js";

test("PAIR V2 config keeps Feishu disabled without a server-side webhook", () => {
  const settings = pairV2SettingsFromEnv({});
  assert.equal(settings.snapshotAttempts, 3);
  assert.equal(settings.feishuWebhookUrl, null);
  assert.equal(settings.chainPollSeconds, 8);
  assert.equal(settings.hotMarketPollSeconds, 15);
  assert.equal(settings.marketPollSeconds, 60);
  assert.equal(settings.holderBatchSize, 9);
  assert.equal(settings.alphaHotCandidateLimit, 72);
});

test("PAIR V2 config only accepts official HTTPS Feishu or Lark webhook hosts", () => {
  assert.throws(
    () => pairV2SettingsFromEnv({ PAIR_V2_FEISHU_WEBHOOK_URL: "http://open.feishu.cn/hook" }),
    /official HTTPS/,
  );
  assert.throws(
    () => pairV2SettingsFromEnv({ PAIR_V2_FEISHU_WEBHOOK_URL: "https://example.com/hook" }),
    /official HTTPS/,
  );
  assert.equal(
    pairV2SettingsFromEnv({
      PAIR_V2_FEISHU_WEBHOOK_URL: "https://open.feishu.cn/open-apis/bot/v2/hook/test",
    }).feishuWebhookUrl,
    "https://open.feishu.cn/open-apis/bot/v2/hook/test",
  );
});
