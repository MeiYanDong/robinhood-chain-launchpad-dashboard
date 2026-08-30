import type { MetricQuality, OverviewResponse, SourceHealth } from "../../domain/types.js";
import type { BotWarning, BotWarningCode } from "../domain/types.js";

const PRIORITY: Record<BotWarningCode, number> = {
  NO_AVAILABLE_DATA: 1,
  CONTRACT_INCOMPATIBLE: 2,
  LATEST_REFRESH_FAILED: 3,
  STALE: 4,
  SOURCE_FAILED: 5,
  SOURCE_DEGRADED: 5,
  PARTIAL: 6,
  SCOPE_MISMATCH: 6,
  SUITE_WIDE: 6,
  DERIVED: 7,
  INFO: 8,
};

const MESSAGES: Record<BotWarningCode, string> = {
  NO_AVAILABLE_DATA: "当前没有可安全使用的数据。",
  CONTRACT_INCOMPATIBLE: "Ledger API 合同不兼容，核心数据查询已暂停。",
  LATEST_REFRESH_FAILED: "最近一次刷新失败；下面可能是上次可用缓存。",
  STALE: "数据已超过新鲜度阈值，请留意截止日期。",
  SOURCE_FAILED: "一个或多个来源暂时不可用。",
  SOURCE_DEGRADED: "一个或多个来源只返回了部分数据。",
  PARTIAL: "部分数据只覆盖有限范围或天数。",
  SCOPE_MISMATCH: "部分指标口径范围不同，比较时要谨慎。",
  SUITE_WIDE: "混合多产品口径已与可比榜隔离。",
  DERIVED: "部分数值由公开规则推导，不是来源直接报告。",
  INFO: "请结合数据日期和覆盖范围阅读。",
};

export function warning(code: BotWarningCode): BotWarning {
  return { code, message: MESSAGES[code], priority: PRIORITY[code] };
}

export function sortWarnings(warnings: BotWarning[]): BotWarning[] {
  const unique = new Map(warnings.map((item) => [item.code, item]));
  return [...unique.values()].sort(
    (left, right) => left.priority - right.priority || left.code.localeCompare(right.code),
  );
}

export function overviewWarnings(
  overview: Pick<OverviewResponse, "warnings" | "stale">,
  sources: SourceHealth[],
  qualities: MetricQuality[] = [],
): BotWarning[] {
  const warnings: BotWarning[] = [];
  if (overview.warnings.some((message) => /refresh failed/i.test(message)))
    warnings.push(warning("LATEST_REFRESH_FAILED"));
  if (overview.stale) warnings.push(warning("STALE"));
  if (sources.some((source) => source.status === "failed")) warnings.push(warning("SOURCE_FAILED"));
  if (sources.some((source) => source.status === "degraded"))
    warnings.push(warning("SOURCE_DEGRADED"));
  if (qualities.includes("partial")) warnings.push(warning("PARTIAL"));
  if (qualities.includes("scope_mismatch")) warnings.push(warning("SCOPE_MISMATCH"));
  if (qualities.includes("suite_wide")) warnings.push(warning("SUITE_WIDE"));
  if (qualities.includes("derived")) warnings.push(warning("DERIVED"));
  return sortWarnings(warnings);
}
