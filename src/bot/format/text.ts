import type { MetricName, PlatformStat } from "../../domain/types.js";
import type { BotAnswer, BotMetricView, BotWarning } from "../domain/types.js";
import type { DomainResult } from "../domain/service.js";
import { buildDetailUrl } from "./url.js";
import { METRIC_LABELS, coverageLabel, qualitySummary } from "./labels.js";
import { formatCount, formatUsd, formatUtcDate } from "./numbers.js";
import { overviewWarnings, sortWarnings, warning } from "./warnings.js";

export const HELP_TEXT = [
  "我是 RHC Launch Ledger，只读查询 Robinhood Chain Launchpad 数据，不连接钱包、不交易。",
  "",
  "/rank [1d|7d|30d] [volume|fees|income] [live|all]",
  "/platform <平台> [1d|7d|30d]",
  "/why <指标或平台>",
  "/status",
  "",
  "也可以问：最近 7 天哪个平台手续费最高？",
  "排名使用最后闭合 UTC 日；未知不等于 0。数据异常时我会显示截止日和警告。",
].join("\n");

export interface FormatOptions {
  detailBaseUrl: string | null;
}

function evidence(input: {
  targetDate: string | null;
  generatedAt: string;
  runStatus: string;
  stale: boolean;
}) {
  return { ...input };
}

function metricLine(
  name: string,
  metric: Pick<BotMetricView, "value" | "qualities" | "unknownReason">,
): string {
  if (metric.value === null) {
    return `${name}：未知（${String(metric.unknownReason ?? "NO_OBSERVATION")}，不等于 $0）`;
  }
  const quality = qualitySummary(metric.qualities);
  return `${name}：${formatUsd(metric.value)}${quality ? `（${quality}）` : ""}`;
}

function rankAnswer(result: Extract<DomainResult, { kind: "rank" }>): BotAnswer {
  const qualities = result.result.entries.flatMap((entry) => entry.metric.qualities);
  const warnings = overviewWarnings(result.overview, result.result.sources, qualities);
  if (result.result.entries.length === 0) warnings.unshift(warning("NO_AVAILABLE_DATA"));
  const bodyLines = result.result.entries.map((entry, index) => {
    const quality = qualitySummary(entry.metric.qualities);
    return (
      String(index + 1) +
      ". " +
      entry.name +
      " — " +
      formatUsd(entry.metric.value) +
      (quality ? `（${quality}）` : "")
    );
  });
  if (result.result.incomparable.length > 0) {
    bodyLines.push(
      `不可比观察项：${result.result.incomparable.map((entry) => entry.name).join("、")}`,
    );
  }
  if (result.result.missingCount > 0)
    bodyLines.push(`${String(result.result.missingCount)} 个平台当前无可比数据。`);
  return {
    status:
      result.result.entries.length === 0 ? "unavailable" : warnings.length > 0 ? "degraded" : "ok",
    title:
      "最近 " +
      String(result.overview.windowDays) +
      " 个完整 UTC 日｜" +
      METRIC_LABELS[result.result.metric] +
      " Top " +
      String(result.result.entries.length),
    bodyLines,
    warnings: sortWarnings(warnings),
    suggestedCommands: ["/status", `/why ${result.result.metric}`],
    detailUrl: null,
    evidence: evidence({
      targetDate: result.overview.targetDate,
      generatedAt: result.overview.generatedAt,
      runStatus: result.overview.runStatus,
      stale: result.overview.stale,
    }),
  };
}

function statLine(stat: PlatformStat): string {
  const value =
    stat.unit === "USD" ? formatUsd(stat.value) : `${formatCount(stat.value)} ${stat.unit}`;
  return `${stat.label}：${value}`;
}

function platformAnswer(
  result: Extract<DomainResult, { kind: "platform" }>,
  options: FormatOptions,
): BotAnswer {
  const core: MetricName[] = ["volume_usd", "fees_usd", "protocol_revenue_usd"];
  const bodyLines = core.map((metric) =>
    metricLine(METRIC_LABELS[metric], result.result.platform.metrics[metric]),
  );
  const rolling = result.result.platform.stats.filter((stat) => stat.period === "rolling_24h");
  if (rolling.length > 0) {
    bodyLines.push("滚动 24H 快照（不等于完整日 1d）：", ...rolling.map(statLine));
  }
  bodyLines.push(
    "覆盖：" +
      coverageLabel(
        result.result.platform.metrics.volume_usd.observedDays,
        result.result.requestedWindowDays,
      ),
  );
  const qualities = core.flatMap((metric) => result.result.platform.metrics[metric].qualities);
  const warnings = overviewWarnings(
    { warnings: result.result.warnings, stale: result.result.stale },
    result.result.sources,
    qualities,
  );
  return {
    status: warnings.length > 0 ? "degraded" : "ok",
    title:
      result.result.platform.name +
      "｜最近 " +
      String(result.result.requestedWindowDays) +
      " 个完整 UTC 日",
    bodyLines,
    warnings,
    suggestedCommands: [`/why ${result.result.platform.id}`, "/status"],
    detailUrl: buildDetailUrl(options.detailBaseUrl, `/platforms/${result.result.platform.id}`),
    evidence: evidence({
      targetDate: result.result.targetDate,
      generatedAt: result.result.generatedAt,
      runStatus: result.result.runStatus,
      stale: result.result.stale,
    }),
  };
}

function statusAnswer(result: Extract<DomainResult, { kind: "status" }>): BotAnswer {
  const warnings: BotWarning[] = [];
  if (!result.result.contractCompatible) warnings.push(warning("CONTRACT_INCOMPATIBLE"));
  if (result.result.stale) warnings.push(warning("STALE"));
  if (result.result.sourceCounts.failed > 0) warnings.push(warning("SOURCE_FAILED"));
  if (result.result.sourceCounts.degraded > 0) warnings.push(warning("SOURCE_DEGRADED"));
  return {
    status: result.result.ready ? (warnings.length > 0 ? "degraded" : "ok") : "unavailable",
    title: result.result.ready ? "数据服务已就绪" : "数据服务尚未就绪",
    bodyLines: [
      `数据截止：${formatUtcDate(result.result.targetDate)}`,
      `最近运行：${result.result.latestRunStatus}`,
      "来源：" +
        String(result.result.sourceCounts.ok) +
        " 正常 / " +
        String(result.result.sourceCounts.degraded) +
        " 降级 / " +
        String(result.result.sourceCounts.failed) +
        " 失败",
      "Ledger 合同：" +
        (result.result.contractCompatible
          ? `v${String(result.result.contractVersion)}（兼容）`
          : "不兼容"),
    ],
    warnings: sortWarnings(warnings),
    suggestedCommands: ["/rank", "/help"],
    detailUrl: null,
    evidence: evidence({
      targetDate: result.result.targetDate,
      generatedAt: result.generatedAt,
      runStatus: result.result.latestRunStatus,
      stale: result.result.stale,
    }),
  };
}

export function formatDomainResult(result: DomainResult, options: FormatOptions): BotAnswer {
  if (result.kind === "help") {
    return {
      status: "ok",
      title: "RHC Launch Ledger 使用说明",
      bodyLines: HELP_TEXT.split("\n"),
      warnings: [],
      suggestedCommands: ["/rank", "/status"],
      detailUrl: null,
      evidence: null,
    };
  }
  if (result.kind === "rank") return rankAnswer(result);
  if (result.kind === "platform") return platformAnswer(result, options);
  if (result.kind === "status") return statusAnswer(result);
  return {
    status: result.result.degraded || result.stale ? "degraded" : "ok",
    title: result.result.title,
    bodyLines: result.result.lines,
    warnings: result.stale ? [warning("STALE")] : [],
    suggestedCommands: ["/status", "/help"],
    detailUrl: null,
    evidence: evidence({
      targetDate: result.targetDate,
      generatedAt: result.generatedAt,
      runStatus: result.runStatus,
      stale: result.stale,
    }),
  };
}

export function clarificationAnswer(question: string): BotAnswer {
  return {
    status: "clarification",
    title: "需要确认一下",
    bodyLines: [question],
    warnings: [],
    suggestedCommands: ["/help"],
    detailUrl: null,
    evidence: null,
  };
}

export function unsupportedAnswer(): BotAnswer {
  return {
    status: "unsupported",
    title: "这个请求超出只读数据范围",
    bodyLines: [
      "我不能交易、签名、连接钱包、访问你给的网址或展示内部配置。",
      "可以改问：/rank 7d volume、/platform LetsCash 30d 或 /status。",
    ],
    warnings: [],
    suggestedCommands: ["/rank 7d volume", "/status"],
    detailUrl: null,
    evidence: null,
  };
}

export function errorAnswer(message: string): BotAnswer {
  return {
    status: "unavailable",
    title: "暂时无法完成查询",
    bodyLines: [message],
    warnings: [],
    suggestedCommands: ["/status", "/help"],
    detailUrl: null,
    evidence: null,
  };
}

function splitLongText(value: string, hardLimit: number): string[] {
  if (value.length <= hardLimit) return [value];
  const tokens = value.split(/(\s+)/).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const token of tokens) {
    if (token.length > hardLimit && /^(https?:\/\/|[-+]?\d+(\.\d+)?)$/.test(token)) {
      throw new Error("Controlled answer contains an unsafe oversized token");
    }
    if ((current + token).length > hardLimit && current) {
      chunks.push(current.trim());
      current = "";
    }
    if (token.length > hardLimit) {
      for (let index = 0; index < token.length; index += hardLimit) {
        chunks.push(token.slice(index, index + hardLimit));
      }
    } else {
      current += token;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export function renderAnswer(answer: BotAnswer, targetLength = 1_500, hardLimit = 5_000): string[] {
  const sections = [
    answer.warnings.map((item) => `⚠ ${item.message}`).join("\n"),
    [answer.title, ...answer.bodyLines].filter(Boolean).join("\n"),
    answer.evidence
      ? "截止：" +
        formatUtcDate(answer.evidence.targetDate) +
        (answer.evidence.stale ? "（stale）" : "")
      : "",
    answer.suggestedCommands.length > 0 ? `可继续：${answer.suggestedCommands.join(" · ")}` : "",
  ].filter((section) => section !== "");
  const messages: string[] = [];
  let current = "";
  for (const section of sections.flatMap((value) => splitLongText(value, hardLimit))) {
    const candidate = current ? `${current}\n\n${section}` : section;
    if (candidate.length <= targetLength || current === "") current = candidate;
    else {
      messages.push(current);
      current = section;
    }
  }
  if (current) messages.push(current);
  return messages.flatMap((message) => splitLongText(message, hardLimit));
}
