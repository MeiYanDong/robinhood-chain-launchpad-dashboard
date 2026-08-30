import assert from "node:assert/strict";
import test from "node:test";
import { BotDomainService } from "../../src/bot/domain/service.js";
import { rankPlatforms } from "../../src/bot/domain/rank.js";
import type { BotAnswer } from "../../src/bot/domain/types.js";
import {
  HELP_TEXT,
  formatDomainResult,
  renderAnswer,
  unsupportedAnswer,
} from "../../src/bot/format/text.js";
import { buildDetailUrl } from "../../src/bot/format/url.js";
import { coverageLabel, qualitySummary, sourceHealthLabel } from "../../src/bot/format/labels.js";
import { formatCount, formatUsd, formatUtcDate } from "../../src/bot/format/numbers.js";
import { sortWarnings, warning } from "../../src/bot/format/warnings.js";
import { basePlan } from "../../src/bot/intent/query-plan.js";
import { LedgerClient } from "../../src/bot/ledger/client.js";
import {
  fixtureFetcher,
  normalOverview,
  normalRoutes,
  normalSources,
} from "../fixtures/ledger/fixtures.js";

function service(): BotDomainService {
  return new BotDomainService(
    new LedgerClient({
      baseUrl: "http://ledger.test",
      fetcher: fixtureFetcher(normalRoutes()),
      cacheTtlMs: 0,
    }),
  );
}

test("number and UTC-date formatting keeps null, zero, small values, and units distinct", () => {
  assert.equal(formatUsd(null), "未知");
  assert.equal(formatUsd(0), "$0");
  assert.equal(formatUsd(0.001), "<$0.01");
  assert.equal(formatUsd(-0.001), ">-$0.01");
  assert.equal(formatUsd(999.5), "$999.50");
  assert.equal(formatUsd(1_500), "$1.50K");
  assert.equal(formatUsd(2_500_000), "$2.50M");
  assert.equal(formatCount(null), "未知");
  assert.equal(formatCount(0), "0");
  assert.equal(formatCount(1_234), "1,234");
  assert.equal(formatUtcDate("2026-08-29"), "2026-08-29 UTC");
  assert.equal(formatUtcDate(null), "未知日期");
});

test("quality, coverage, and source labels are understandable and deterministic", () => {
  assert.equal(qualitySummary(["reported", "partial", "reported"]), "来源直接报告、部分覆盖");
  assert.equal(coverageLabel(5, 7), "5/7 天");
  const healthy = normalSources().sources[0];
  const degraded = normalSources("degraded").sources[0];
  const failed = normalSources("failed").sources[0];
  assert.ok(healthy && degraded && failed);
  assert.equal(sourceHealthLabel(healthy), "正常");
  assert.equal(sourceHealthLabel(degraded), "降级");
  assert.equal(sourceHealthLabel(failed), "失败");
});

test("warning priority is stable and duplicates are removed", () => {
  const ordered = sortWarnings([
    warning("DERIVED"),
    warning("STALE"),
    warning("NO_AVAILABLE_DATA"),
    warning("SOURCE_FAILED"),
    warning("CONTRACT_INCOMPATIBLE"),
    warning("STALE"),
  ]);
  assert.deepEqual(
    ordered.map((item) => item.code),
    ["NO_AVAILABLE_DATA", "CONTRACT_INCOMPATIBLE", "STALE", "SOURCE_FAILED", "DERIVED"],
  );
});

test("rank answer snapshot is grounded in fixture numbers and exposes suite-wide separately", async () => {
  const plan = basePlan("rank");
  plan.windowDays = 1;
  plan.metric = "volume_usd";
  plan.scope = "live";
  const answer = formatDomainResult(await service().execute(plan), { detailBaseUrl: null });

  assert.equal(answer.title, "最近 1 个完整 UTC 日｜成交量 Top 4");
  assert.deepEqual(answer.bodyLines, [
    "1. Pons — $5.00K（口径范围不同）",
    "2. LetsCash — $3.00K（推导值）",
    "3. Long — $3.00K（来源直接报告）",
    "4. Bankr — $0（来源直接报告）",
    "不可比观察项：StonkBrokers",
    "1 个平台当前无可比数据。",
  ]);
  assert.deepEqual(
    answer.warnings.map((item) => item.code),
    ["SCOPE_MISMATCH", "DERIVED"],
  );
  assert.equal(answer.evidence?.targetDate, "2026-08-29");
});

test("platform answer snapshot separates requested window from rolling 24H", async () => {
  const plan = basePlan("platform");
  plan.platformId = "letscash";
  plan.windowDays = 30;
  const answer = formatDomainResult(await service().execute(plan), {
    detailBaseUrl: "https://ledger.example",
  });

  assert.equal(answer.title, "LetsCash｜最近 30 个完整 UTC 日");
  assert.deepEqual(answer.bodyLines, [
    "成交量：$3.00K（推导值）",
    "用户手续费：$350.00（推导值）",
    "平台收入：$36.00（推导值）",
    "滚动 24H 快照（不等于完整日 1d）：",
    "滚动 24H 成交量：$900.00",
    "覆盖：30/30 天",
  ]);
  assert.equal(answer.detailUrl, "https://ledger.example/platforms/letscash");
  assert.deepEqual(
    answer.warnings.map((item) => item.code),
    ["DERIVED"],
  );
});

test("help, unsupported, and unknown answers stay bounded and never imply a transaction", async () => {
  const help = formatDomainResult(await service().execute(basePlan("help")), {
    detailBaseUrl: null,
  });
  assert.equal(help.bodyLines.join("\n"), HELP_TEXT);
  assert.ok(renderAnswer(help).every((segment) => segment.length <= 1_500));
  const unsupported = unsupportedAnswer();
  assert.equal(unsupported.status, "unsupported");
  assert.match(unsupported.bodyLines.join("\n"), /不能交易、签名、连接钱包/);
});

test("no rankable data renders an explicit unavailable answer instead of an empty success", () => {
  const overview = normalOverview(1);
  for (const platform of overview.platforms) platform.metrics.volume_usd.value = null;
  const answer = formatDomainResult(
    {
      kind: "rank",
      overview,
      result: rankPlatforms(overview, "volume_usd", "live"),
    },
    { detailBaseUrl: null },
  );
  assert.equal(answer.status, "unavailable");
  assert.equal(answer.warnings[0]?.code, "NO_AVAILABLE_DATA");
  assert.match(answer.bodyLines.join("\n"), /平台当前无可比数据/);
});

test("detail links accept only a configured HTTPS base and controlled platform path", () => {
  assert.equal(buildDetailUrl(null, "/platforms/letscash"), null);
  assert.equal(
    buildDetailUrl("https://ledger.example/base", "/platforms/letscash"),
    "https://ledger.example/platforms/letscash",
  );
  assert.throws(() => buildDetailUrl("http://ledger.example", "/platforms/letscash"));
  assert.throws(() => buildDetailUrl("javascript:alert(1)", "/platforms/letscash"));
  assert.throws(() => buildDetailUrl("https://ledger.example", "/platforms/../secret"));
});

test("semantic rendering preserves warning-main-evidence-suggestion order and 5000 hard limit", () => {
  const answer: BotAnswer = {
    status: "degraded",
    title: "压力测试",
    bodyLines: [Array.from({ length: 2_000 }, () => "安全说明").join(" ")],
    warnings: [warning("STALE")],
    suggestedCommands: ["/status"],
    detailUrl: null,
    evidence: {
      targetDate: "2026-08-29",
      generatedAt: "2026-08-30T01:00:00.000Z",
      runStatus: "partial",
      stale: true,
    },
  };
  const segments = renderAnswer(answer);
  assert.ok(segments.length > 1);
  assert.ok(segments.every((segment) => segment.length <= 5_000));
  const rendered = segments.join("\n");
  assert.ok(rendered.indexOf("⚠") < rendered.indexOf("压力测试"));
  assert.ok(rendered.indexOf("压力测试") < rendered.indexOf("截止："));
  assert.ok(rendered.indexOf("截止：") < rendered.indexOf("可继续："));
});
