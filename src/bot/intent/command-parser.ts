import type { MetricName, WindowDays } from "../../domain/types.js";
import { BotError } from "../errors.js";
import {
  normalizeAlias,
  platformCatalog,
  resolvePlatformAlias,
  type PlatformAliasEntry,
} from "./aliases.js";
import { basePlan, type QueryPlan, validateQueryPlan } from "./query-plan.js";

export type ParseResult =
  | { kind: "plan"; plan: QueryPlan; cleanedText: string }
  | { kind: "clarification"; question: string; cleanedText: string }
  | { kind: "unsupported"; reason: string; cleanedText: string }
  | { kind: "needs_llm"; cleanedText: string };

export interface InputContext {
  confirmedCurrentBotMention?: boolean;
  currentBotMentionText?: string;
  catalog?: PlatformAliasEntry[];
}

const WINDOW_TOKENS = new Map<string, WindowDays>([
  ["1d", 1],
  ["1day", 1],
  ["1天", 1],
  ["一天", 1],
  ["7d", 7],
  ["7days", 7],
  ["7天", 7],
  ["一周", 7],
  ["30d", 30],
  ["30days", 30],
  ["30天", 30],
  ["一个月", 30],
]);
const METRIC_TOKENS = new Map<string, MetricName>([
  ["volume", "volume_usd"],
  ["volume_usd", "volume_usd"],
  ["交易量", "volume_usd"],
  ["成交量", "volume_usd"],
  ["fees", "fees_usd"],
  ["fee", "fees_usd"],
  ["fees_usd", "fees_usd"],
  ["手续费", "fees_usd"],
  ["用户费用", "fees_usd"],
  ["income", "protocol_revenue_usd"],
  ["platformincome", "protocol_revenue_usd"],
  ["平台收入", "protocol_revenue_usd"],
  ["协议收入", "protocol_revenue_usd"],
  ["revenue", "revenue_usd"],
  ["revenue_usd", "revenue_usd"],
]);
const OUT_OF_SCOPE =
  /(https?:\/\/|忽略.{0,8}(规则|提示)|系统提示|secret|app\s*key|私钥|助记词|连接钱包|签名|广播|帮我买|帮我卖|自动交易|收益保证|调用.{0,8}refresh|\bcurl\b|\bsql\b)/i;

export function cleanInput(text: string, context: InputContext = {}): string {
  let cleaned = text.normalize("NFKC");
  if (context.confirmedCurrentBotMention && context.currentBotMentionText) {
    cleaned = cleaned.split(context.currentBotMentionText).join(" ");
  }
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  if (cleaned.length === 0 || cleaned.length > 1_000) {
    throw new BotError("USER_INPUT_INVALID");
  }
  return cleaned;
}

function supportedSet(catalog: PlatformAliasEntry[]): Set<string> {
  return new Set(catalog.map((entry) => entry.id));
}

function tokenWindow(token: string): WindowDays | null {
  return WINDOW_TOKENS.get(normalizeAlias(token)) ?? null;
}

function tokenMetric(token: string): MetricName | null {
  return METRIC_TOKENS.get(normalizeAlias(token)) ?? null;
}

function parseRank(
  args: string[],
  cleanedText: string,
  catalog: PlatformAliasEntry[],
): ParseResult {
  let windowDays: WindowDays = 1;
  let metric: MetricName = "volume_usd";
  let scope: "live" | "all" = "live";
  let seenWindow = false;
  let seenMetric = false;
  let seenScope = false;

  for (const rawToken of args) {
    const token = normalizeAlias(rawToken);
    if (token === "24h" || token === "过去24小时" || token === "最近24小时") {
      return {
        kind: "clarification",
        question: "排行榜只支持完整 UTC 日。要改看最近完整日 1d 吗？",
        cleanedText,
      };
    }
    const parsedWindow = tokenWindow(token);
    if (parsedWindow) {
      if (seenWindow) return invalid("只能选择一个时间窗口。例：/rank 7d fees", cleanedText);
      seenWindow = true;
      windowDays = parsedWindow;
      continue;
    }
    const parsedMetric = tokenMetric(token);
    if (parsedMetric) {
      if (parsedMetric === "revenue_usd")
        return invalid("排行榜不支持 Revenue；可用 volume、fees 或 income。", cleanedText);
      if (seenMetric) return invalid("只能选择一个排名指标。例：/rank 7d fees", cleanedText);
      seenMetric = true;
      metric = parsedMetric;
      continue;
    }
    if (token === "live" || token === "all") {
      if (seenScope) return invalid("只能选择 live 或 all 其中一个。", cleanedText);
      seenScope = true;
      scope = token;
      continue;
    }
    return invalid(`无法识别参数 “${rawToken}”。例：/rank 7d fees live`, cleanedText);
  }

  const plan = basePlan("rank");
  plan.windowDays = windowDays;
  plan.metric = metric;
  plan.scope = scope;
  return { kind: "plan", plan: validateQueryPlan(plan, supportedSet(catalog)), cleanedText };
}

function invalid(question: string, cleanedText: string): ParseResult {
  return { kind: "clarification", question, cleanedText };
}

function parsePlatform(
  args: string[],
  cleanedText: string,
  catalog: PlatformAliasEntry[],
): ParseResult {
  let windowDays: WindowDays = 1;
  const platformParts: string[] = [];
  for (const token of args) {
    const normalized = normalizeAlias(token);
    if (normalized === "24h") {
      return invalid("你是要看该平台的滚动 24H 快照，还是最近完整日 1d？", cleanedText);
    }
    const parsedWindow = tokenWindow(token);
    if (parsedWindow) {
      windowDays = parsedWindow;
      continue;
    }
    platformParts.push(token);
  }
  if (platformParts.length === 0) return invalid("你想查哪个平台？", cleanedText);
  const resolution = resolvePlatformAlias(platformParts.join(" "), catalog);
  if (resolution.kind === "missing")
    return invalid("没有识别到这个平台，请输入 /help 查看示例。", cleanedText);
  if (resolution.kind === "ambiguous")
    return invalid(`平台名有歧义，请选择：${resolution.platformIds.join("、")}`, cleanedText);

  const plan = basePlan("platform");
  plan.windowDays = windowDays;
  plan.platformId = resolution.platformId;
  return { kind: "plan", plan: validateQueryPlan(plan, supportedSet(catalog)), cleanedText };
}

function findPlatformInText(text: string, catalog: PlatformAliasEntry[]) {
  const normalizedText = normalizeAlias(text);
  const matches = catalog.filter((entry) =>
    entry.aliases.some((alias) => normalizedText.includes(normalizeAlias(alias))),
  );
  const ids = [...new Set(matches.map((entry) => entry.id))].sort();
  if (ids.length === 1) return { kind: "found" as const, platformId: ids[0] as string };
  if (ids.length > 1) return { kind: "ambiguous" as const, platformIds: ids };
  return { kind: "missing" as const };
}

function detectWindow(text: string): WindowDays | "rolling" | null {
  const normalized = normalizeAlias(text);
  if (/(24h|过去24小时|最近24小时)/i.test(normalized)) return "rolling";
  for (const [token, windowDays] of WINDOW_TOKENS) {
    if (normalized.includes(token)) return windowDays;
  }
  return null;
}

function detectMetric(text: string): MetricName | null {
  const normalized = normalizeAlias(text);
  const ordered = [...METRIC_TOKENS.entries()].sort(
    (left, right) => right[0].length - left[0].length,
  );
  for (const [token, metric] of ordered) {
    if (normalized.includes(token)) return metric;
  }
  return null;
}

function parseWhy(args: string[], cleanedText: string, catalog: PlatformAliasEntry[]): ParseResult {
  if (args.length === 0) return invalid("你想解释指标、平台、质量、覆盖率还是来源？", cleanedText);
  const text = args.join(" ");
  const plan = basePlan("explain");
  const metric = detectMetric(text);
  const platform = findPlatformInText(text, catalog);
  plan.metric = metric;
  if (platform.kind === "ambiguous")
    return invalid(`平台名有歧义，请选择：${platform.platformIds.join("、")}`, cleanedText);
  if (platform.kind === "found") plan.platformId = platform.platformId;
  const normalized = normalizeAlias(text);
  if (metric) plan.explainTopic = "metric";
  else if (platform.kind === "found") plan.explainTopic = "platform";
  else if (/质量|quality/.test(normalized)) plan.explainTopic = "quality";
  else if (/覆盖|coverage/.test(normalized)) plan.explainTopic = "coverage";
  else if (/来源|source/.test(normalized)) plan.explainTopic = "sources";
  else return invalid("暂时只能解释指标、平台、质量、覆盖率或来源。", cleanedText);
  return { kind: "plan", plan: validateQueryPlan(plan, supportedSet(catalog)), cleanedText };
}

function parseNatural(text: string, catalog: PlatformAliasEntry[]): ParseResult {
  const normalized = normalizeAlias(text);
  if (/状态|健康|status|数据日期/.test(normalized)) {
    return {
      kind: "plan",
      plan: validateQueryPlan(basePlan("status"), supportedSet(catalog)),
      cleanedText: text,
    };
  }
  if (/为什么|为何|解释|why/.test(normalized)) {
    return parseWhy([text], text, catalog);
  }
  if (/排名|排行|最高|top/.test(normalized)) {
    const window = detectWindow(text);
    if (window === "rolling")
      return invalid("排行榜只支持完整 UTC 日。要查看最近完整日 1d 吗？", text);
    const metric = detectMetric(text);
    if (metric === "revenue_usd")
      return invalid("排行榜不支持 Revenue；可问成交量、手续费或平台收入。", text);
    const plan = basePlan("rank");
    plan.windowDays = window ?? 1;
    plan.metric = metric ?? "volume_usd";
    plan.scope = /全部|all/.test(normalized) ? "all" : "live";
    return {
      kind: "plan",
      plan: validateQueryPlan(plan, supportedSet(catalog)),
      cleanedText: text,
    };
  }
  const platform = findPlatformInText(text, catalog);
  if (platform.kind === "ambiguous")
    return invalid(`平台名有歧义，请选择：${platform.platformIds.join("、")}`, text);
  if (platform.kind === "found") {
    const window = detectWindow(text);
    if (window === "rolling") return invalid("你要看滚动 24H 快照，还是最近完整日 1d？", text);
    const plan = basePlan("platform");
    plan.windowDays = window ?? 1;
    plan.platformId = platform.platformId;
    plan.metric = detectMetric(text);
    return {
      kind: "plan",
      plan: validateQueryPlan(plan, supportedSet(catalog)),
      cleanedText: text,
    };
  }
  return { kind: "needs_llm", cleanedText: text };
}

export function parseInput(text: string, context: InputContext = {}): ParseResult {
  const cleanedText = cleanInput(text, context);
  const catalog = context.catalog ?? platformCatalog();
  if (OUT_OF_SCOPE.test(cleanedText)) {
    return { kind: "unsupported", reason: "OUT_OF_SCOPE", cleanedText };
  }

  const [first = "", ...args] = cleanedText.split(" ");
  if (first.startsWith("/")) {
    const command = first.toLowerCase();
    if (command === "/start" || command === "/help") {
      if (args.length > 0) return invalid("这个命令不需要参数。", cleanedText);
      const plan = basePlan("help");
      return { kind: "plan", plan: validateQueryPlan(plan, supportedSet(catalog)), cleanedText };
    }
    if (command === "/rank") return parseRank(args, cleanedText, catalog);
    if (command === "/platform") return parsePlatform(args, cleanedText, catalog);
    if (command === "/why") return parseWhy(args, cleanedText, catalog);
    if (command === "/status") {
      if (args.length > 0) return invalid("/status 不接受参数。", cleanedText);
      return {
        kind: "plan",
        plan: validateQueryPlan(basePlan("status"), supportedSet(catalog)),
        cleanedText,
      };
    }
    return invalid("不支持这个命令，请查看 /help。", cleanedText);
  }
  return parseNatural(cleanedText, catalog);
}
