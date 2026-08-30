import type { MetricName, WindowDays } from "../../domain/types.js";
import { BotError } from "../errors.js";

export const QUERY_ACTIONS = ["rank", "platform", "explain", "status", "help"] as const;
export type QueryAction = (typeof QUERY_ACTIONS)[number];
export type QueryScope = "live" | "all";
export type ExplainTopic = "metric" | "platform" | "quality" | "coverage" | "sources";
export type QueryLanguage = "zh-CN" | "en";

export interface QueryPlan {
  version: 1;
  action: QueryAction;
  windowDays: WindowDays | null;
  metric: MetricName | null;
  platformId: string | null;
  scope: QueryScope | null;
  explainTopic: ExplainTopic | null;
  language: QueryLanguage;
  needsClarification: boolean;
  clarificationReason: string | null;
}

const KEYS = new Set([
  "version",
  "action",
  "windowDays",
  "metric",
  "platformId",
  "scope",
  "explainTopic",
  "language",
  "needsClarification",
  "clarificationReason",
]);
const METRICS = new Set<MetricName>([
  "volume_usd",
  "fees_usd",
  "protocol_revenue_usd",
  "revenue_usd",
]);
const RANK_METRICS = new Set<MetricName>(["volume_usd", "fees_usd", "protocol_revenue_usd"]);
const FORBIDDEN_TEXT =
  /(https?:\/\/|file:|javascript:|data:|\.\.|\b(select|insert|update|delete|drop|curl|wget|shell|tool|refresh)\b)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(): never {
  throw new BotError("QUERY_PLAN_INVALID");
}

export function validateQueryPlan(
  value: unknown,
  supportedPlatforms: ReadonlySet<string>,
): QueryPlan {
  if (!isRecord(value) || Object.keys(value).some((key) => !KEYS.has(key))) fail();
  if (value.version !== 1 || !QUERY_ACTIONS.includes(value.action as QueryAction)) fail();
  if (![1, 7, 30, null].includes(value.windowDays as WindowDays | null)) fail();
  if (value.metric !== null && !METRICS.has(value.metric as MetricName)) fail();
  if (value.scope !== null && value.scope !== "live" && value.scope !== "all") fail();
  if (
    value.explainTopic !== null &&
    !["metric", "platform", "quality", "coverage", "sources"].includes(value.explainTopic as string)
  )
    fail();
  if (value.language !== "zh-CN" && value.language !== "en") fail();
  if (typeof value.needsClarification !== "boolean") fail();
  if (value.clarificationReason !== null && typeof value.clarificationReason !== "string") fail();

  if (value.platformId !== null) {
    if (
      typeof value.platformId !== "string" ||
      !/^[a-z0-9-]{1,64}$/.test(value.platformId) ||
      !supportedPlatforms.has(value.platformId)
    )
      fail();
  }
  for (const candidate of [value.platformId, value.clarificationReason]) {
    if (typeof candidate === "string" && FORBIDDEN_TEXT.test(candidate)) fail();
  }
  if (
    (value.needsClarification &&
      (typeof value.clarificationReason !== "string" ||
        value.clarificationReason.trim() === "" ||
        value.clarificationReason.length > 200)) ||
    (!value.needsClarification && value.clarificationReason !== null)
  )
    fail();

  const action = value.action as QueryAction;
  if (action === "rank") {
    if (
      !RANK_METRICS.has(value.metric as MetricName) ||
      ![1, 7, 30].includes(value.windowDays as number) ||
      value.platformId !== null ||
      (value.scope !== "live" && value.scope !== "all") ||
      value.explainTopic !== null
    )
      fail();
  } else if (action === "platform") {
    if (
      ![1, 7, 30].includes(value.windowDays as number) ||
      (!value.needsClarification && value.platformId === null) ||
      value.scope !== null ||
      value.explainTopic !== null
    )
      fail();
  } else if (action === "explain") {
    if (value.explainTopic === null || value.scope !== null) fail();
  } else if (
    value.windowDays !== null ||
    value.metric !== null ||
    value.platformId !== null ||
    value.scope !== null ||
    value.explainTopic !== null
  ) {
    fail();
  }

  return value as unknown as QueryPlan;
}

export function basePlan(action: QueryAction, language: QueryLanguage = "zh-CN"): QueryPlan {
  return {
    version: 1,
    action,
    windowDays: null,
    metric: null,
    platformId: null,
    scope: null,
    explainTopic: null,
    language,
    needsClarification: false,
    clarificationReason: null,
  };
}
