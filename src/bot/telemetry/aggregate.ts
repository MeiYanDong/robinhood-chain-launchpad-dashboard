import { BotError } from "../errors.js";
import type { QueryAction } from "../intent/query-plan.js";

export type TelemetryAction = QueryAction | "unsupported";
export type TelemetryChannel = "private" | "group";
export type TelemetryOutcome =
  | "ok"
  | "clarification"
  | "degraded"
  | "unavailable"
  | "unsupported"
  | "failed";
export type LatencyBucket = "lt_250ms" | "lt_1s" | "lt_3s" | "lt_10s" | "gte_10s";

export interface TelemetryBucket {
  date: string;
  action: TelemetryAction;
  channel: TelemetryChannel;
  outcome: TelemetryOutcome;
  latencyBucket: LatencyBucket;
  usedLlm: boolean;
  stale: boolean;
  qualityCount: number;
  sourceFailed: number;
  sourceCount: number;
  count: number;
}

const KEYS = new Set([
  "date",
  "action",
  "channel",
  "outcome",
  "latencyBucket",
  "usedLlm",
  "stale",
  "qualityCount",
  "sourceFailed",
  "sourceCount",
  "count",
]);
const ACTIONS = new Set<TelemetryAction>([
  "rank",
  "platform",
  "explain",
  "status",
  "help",
  "unsupported",
]);
const OUTCOMES = new Set<TelemetryOutcome>([
  "ok",
  "clarification",
  "degraded",
  "unavailable",
  "unsupported",
  "failed",
]);
const LATENCIES = new Set<LatencyBucket>(["lt_250ms", "lt_1s", "lt_3s", "lt_10s", "gte_10s"]);

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

export function validateTelemetryBucket(value: unknown): TelemetryBucket {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new BotError("USER_INPUT_INVALID");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !KEYS.has(key)) || Object.keys(record).length !== KEYS.size)
    throw new BotError("USER_INPUT_INVALID");
  if (
    typeof record.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(record.date) ||
    !ACTIONS.has(record.action as TelemetryAction) ||
    (record.channel !== "private" && record.channel !== "group") ||
    !OUTCOMES.has(record.outcome as TelemetryOutcome) ||
    !LATENCIES.has(record.latencyBucket as LatencyBucket) ||
    typeof record.usedLlm !== "boolean" ||
    typeof record.stale !== "boolean" ||
    !nonNegativeInteger(record.qualityCount) ||
    !nonNegativeInteger(record.sourceFailed) ||
    !nonNegativeInteger(record.sourceCount) ||
    !Number.isInteger(record.count) ||
    (record.count as number) < 1
  )
    throw new BotError("USER_INPUT_INVALID");
  return record as unknown as TelemetryBucket;
}

export function latencyBucket(milliseconds: number): LatencyBucket {
  if (milliseconds < 250) return "lt_250ms";
  if (milliseconds < 1_000) return "lt_1s";
  if (milliseconds < 3_000) return "lt_3s";
  if (milliseconds < 10_000) return "lt_10s";
  return "gte_10s";
}
