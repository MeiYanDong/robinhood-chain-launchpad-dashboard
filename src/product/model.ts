import type { IntelligenceResponse } from "../intelligence/types.js";
import type {
  CashcatDimension,
  ProductCashcatSnapshot,
  ProductChainSnapshot,
  ProductDecisionState,
  ProductMetric,
  ProductSource,
  ProductSourceStatus,
  ProductWorkbenchResponse,
} from "./types.js";

export interface ProductExternalInput {
  payload: unknown;
  status: "ok" | "failed";
}

export interface ProductModelInput {
  now: Date;
  chain: ProductExternalInput;
  cashcat: ProductExternalInput;
  intelligence: IntelligenceResponse | null;
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function nested(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const segment of path) current = record(current)[segment];
  return current;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function nullableText(value: unknown): string | null {
  const result = text(value);
  return result || null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function integer(value: unknown): number | null {
  const result = number(value);
  return result !== null && Number.isInteger(result) ? result : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function iso(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function isStale(now: Date, observedAt: string | null, maxAgeMs: number): boolean {
  if (!observedAt) return true;
  const age = now.valueOf() - Date.parse(observedAt);
  return age > maxAgeMs || age < -5 * 60_000;
}

function lastClosedUtcDate(now: Date): string {
  const closed = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  return closed.toISOString().slice(0, 10);
}

function metric(value: unknown): ProductMetric | null {
  const item = record(value);
  const id = text(item.id);
  const label = text(item.label);
  if (!id || !label) return null;
  const unit = text(item.unit);
  const freshness = text(item.freshness);
  return {
    id,
    label,
    shortLabel: text(item.shortLabel, label),
    unit: ["usd", "number", "percent", "seconds"].includes(unit)
      ? (unit as ProductMetric["unit"])
      : "number",
    value: number(item.value),
    change7d: number(item.change7d),
    change30d: number(item.change30d),
    dataDate: nullableText(item.dataDate),
    freshness: ["ok", "stale", "unavailable", "live"].includes(freshness)
      ? (freshness as ProductMetric["freshness"])
      : "unavailable",
    definition: text(item.definition, "该指标的来源定义暂不可得。"),
  };
}

function chainSnapshot(payload: unknown): ProductChainSnapshot {
  const assessment = record(nested(payload, "assessment"));
  const dimension = (id: string) => {
    const value = record(assessment[id]);
    return {
      label: text(value.label, "数据不足"),
      evidence: text(value.evidence, "当前没有足够证据。"),
    };
  };
  const quality = record(nested(payload, "quality"));
  const stockTokens = record(nested(payload, "stockTokens"));
  return {
    temporalScope: "closed_utc_day",
    targetDate: nullableText(nested(payload, "targetDate")),
    generatedAt: iso(nested(payload, "generatedAt")),
    headline: text(assessment.headline, "全链数据尚未形成可用判断。"),
    overallState: text(assessment.overallState, "unknown"),
    position: dimension("position"),
    momentum: dimension("momentum"),
    quality: dimension("quality"),
    confidence: dimension("confidence"),
    metrics: list(nested(payload, "metrics"))
      .map(metric)
      .filter((item) => item !== null),
    stockTokens: {
      activeAssets: integer(stockTokens.activeAssets),
      estimatedValueUsd: number(stockTokens.estimatedValueUsd),
      coveragePercent: number(stockTokens.coveragePercent),
    },
    failedSourceCount: integer(quality.failedSources) ?? 0,
  };
}

const REASON_LABELS: Record<string, string> = {
  all_required_premises_confirmed: "龙头、链热度与叙事三层前提均已确认",
  cashcat_leader_status_lost: "CashCat 已失去多数核心指标的领先位置",
  attention_state_weakening: "Robinhood Chain 的实时注意力低于自身历史基准",
  attention_state_diversion_candidate: "跨链资金与注意力正在向其他链加速",
  attention_state_warming_up: "链热度基线仍在积累",
  attention_state_unknown: "链热度数据不足",
  narrative_premise_not_fully_confirmed: "叙事证据尚未完整确认",
  founder_support_negative: "负责人公开立场转为负面",
  mainstream_attention_gone: "主流讨论度已经消失",
  external_hotspot_confirmed: "外部新热点已经连续确认",
};

function reasonLabel(code: unknown): string {
  const key = text(code).toLowerCase();
  if (!key) return "存在一项尚未说明的观察条件";
  if (REASON_LABELS[key]) return REASON_LABELS[key];
  if (key.startsWith("leader_state_")) return "CashCat 的龙头位置尚未得到完整确认";
  return "存在尚未满足的观察条件";
}

function decision(actionValue: unknown, reasonsValue: unknown): ProductCashcatSnapshot["decision"] {
  const action = text(actionValue, "UNKNOWN").toUpperCase();
  let state: ProductDecisionState = "unknown";
  let label = "数据不足";
  let summary = "当前证据不足，暂不判断投资前提是否成立。";
  if (action === "HOLD") {
    state = "premise_confirmed";
    label = "核心前提成立";
    summary = "龙头、链热度与叙事条件仍支持原观察逻辑。";
  } else if (action === "WATCH") {
    state = "watch";
    label = "需要观察";
    summary = "部分条件正在承压，先核对变化，不把单次异动当成结论。";
  } else if (action === "EXIT_CANDIDATE") {
    state = "watch";
    label = "前提明显承压";
    summary = "关键条件接近失效，需要等待连续确认。";
  } else if (action === "EXIT") {
    state = "premise_invalidated";
    label = "核心前提失效";
    summary = "至少一项明确的失效条件已经得到新鲜证据确认。";
  }
  return {
    state,
    label,
    summary,
    reasons: [...new Set(list(reasonsValue).map(reasonLabel))].slice(0, 4),
  };
}

function standardDimension(
  id: CashcatDimension["id"],
  label: string,
  source: unknown,
): CashcatDimension {
  const item = record(source);
  const peer = record(item.peer);
  return {
    id,
    label,
    state: text(item.state, "UNKNOWN"),
    targetValue: number(item.target_value),
    ratioToLeader: number(item.ratio),
    rank: integer(item.rank),
    leaderSymbol: nullableText(peer.symbol),
    leaderValue: number(peer.value),
  };
}

function cashcatDimensions(payload: unknown): CashcatDimension[] {
  const dimensions = record(nested(payload, "latest", "analysis", "leader", "dimensions"));
  const volume = record(dimensions.multi_window_volume);
  const volume24h = record(nested(volume, "windows", "24h"));
  const volumePeer = record(volume24h.peer);
  return [
    standardDimension("market_cap", "市值", dimensions.market_cap),
    standardDimension("liquidity", "主池流动性", dimensions.liquidity),
    {
      id: "volume",
      label: "多周期成交量",
      state: text(volume.state, "UNKNOWN"),
      targetValue: number(volume24h.target_value),
      ratioToLeader: number(volume.geometric_ratio),
      rank: integer(volume24h.rank),
      leaderSymbol: nullableText(volumePeer.symbol),
      leaderValue: number(volumePeer.value),
    },
    standardDimension("holders", "持币地址", dimensions.holder_count),
  ];
}

function cashcatSnapshot(
  payload: unknown,
  sourceStatus: ProductSourceStatus,
): ProductCashcatSnapshot {
  const latest = nested(payload, "latest");
  const target = record(nested(latest, "collection", "target"));
  const volumes = record(target.volumes);
  const scope = record(target.liquidity_scope);
  const crosscheck = record(target.liquidity_crosscheck);
  const analysis = record(nested(latest, "analysis"));
  const leader = record(analysis.leader);
  const attention = record(analysis.attention);
  const robinhoodShare = record(nested(attention, "chain_shares", "robinhood"));
  const narrative = record(analysis.narrative);
  const evidence = record(narrative.evidence);
  const priceHistory = record(nested(latest, "collection", "price_history_24h"));
  const candles = list(priceHistory.candles)
    .map((value) => {
      const candle = record(value);
      const observedAt = iso(candle.observed_at);
      const closeUsd = number(candle.close);
      return observedAt && closeUsd !== null
        ? { observedAt, closeUsd, volumeUsd: number(candle.volume_usd) }
        : null;
    })
    .filter((value) => value !== null);
  const sourceHealth = record(nested(payload, "health", "data_sources"));
  return {
    temporalScope: "live_snapshot",
    observedAt: iso(nested(latest, "observed_at")),
    decision: decision(analysis.action, analysis.reasons),
    token: {
      address: nullableText(target.address),
      symbol: text(target.symbol, "CASHCAT"),
      name: text(target.name, "Cash Cat"),
      priceUsd: number(target.price),
      marketCapUsd: number(target.market_cap),
      mainPoolLiquidityUsd: number(target.liquidity),
      indexedLiquidityUsd: number(crosscheck.all_pools_liquidity_usd),
      holderCount: integer(target.holder_count),
      volumes: {
        m5: number(volumes["5m"]),
        h1: number(volumes["1h"]),
        h6: number(volumes["6h"]),
        h24: number(volumes["24h"]),
      },
      primaryPair: nullableText(scope.pair),
      primaryVenue: nullableText(scope.venue),
      indexedPoolCount: integer(crosscheck.pool_count),
    },
    leader: {
      state: text(leader.state, "UNKNOWN"),
      eligiblePeerCount: integer(leader.eligible_peer_count),
      dimensions: cashcatDimensions(payload),
    },
    attention: {
      state: text(attention.state, "UNKNOWN"),
      robinhoodAttentionShare: number(robinhoodShare.attention),
      robinhoodActivityShare: number(robinhoodShare.activity),
      attentionToBaseline: number(attention.robinhood_attention_vs_baseline),
      activityToBaseline: number(attention.robinhood_activity_vs_baseline),
      targetHotRank: integer(attention.target_hot_rank),
    },
    narrative: {
      state: text(narrative.state, "UNKNOWN"),
      founderSupport: text(nested(evidence, "founder_support", "state"), "unknown"),
      mainstreamAttention: text(nested(evidence, "mainstream_attention", "state"), "unknown"),
      externalHotspot: text(nested(evidence, "external_hotspot", "state"), "unknown"),
    },
    priceHistory24h: {
      changePercent: number(priceHistory.change_percent),
      highUsd: number(priceHistory.high),
      lowUsd: number(priceHistory.low),
      totalVolumeUsd: number(priceHistory.total_volume_usd),
      candles,
    },
    evidenceStatus: text(
      nested(payload, "health", "daily_report", "live_evidence_status"),
      "UNKNOWN",
    ),
    dataHealth: sourceStatus,
    sourceHealth: Object.entries(sourceHealth).map(([id, value]) => {
      const source = record(value);
      return {
        id,
        label: text(source.name, id),
        status: text(source.status, "UNKNOWN"),
        observedAt: iso(source.observed_at),
      };
    }),
    evidenceReportUrl: "/cashcat/reports/latest",
  };
}

function chainSource(now: Date, input: ProductExternalInput): ProductSource {
  const observedAt = iso(nested(input.payload, "generatedAt"));
  const targetDate = nullableText(nested(input.payload, "targetDate"));
  const expectedDate = lastClosedUtcDate(now);
  const failedSources = integer(nested(input.payload, "quality", "failedSources")) ?? 0;
  const dateStale =
    !targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || targetDate < expectedDate;
  const stale =
    input.status === "failed" || dateStale || isStale(now, observedAt, 36 * 60 * 60_000);
  return {
    id: "chain_daily",
    label: "全链完整日",
    status: input.status === "failed" ? "failed" : failedSources > 0 || stale ? "degraded" : "ok",
    temporalScope: "closed_utc_day",
    observedAt,
    stale,
    note:
      input.status === "failed"
        ? "全链完整日数据暂不可用。"
        : dateStale
          ? `数据止于 ${targetDate ?? "未知日期"}，最近完整 UTC 日应为 ${expectedDate}。`
          : failedSources > 0
            ? `${failedSources} 个来源失败；已观测指标仍保留。`
            : "最近完整 UTC 日已就绪。",
  };
}

function cashcatSource(now: Date, input: ProductExternalInput): ProductSource {
  const observedAt = iso(nested(input.payload, "latest", "observed_at"));
  const health = text(nested(input.payload, "health", "status"), "UNKNOWN").toUpperCase();
  const status: ProductSourceStatus =
    input.status === "failed" || health === "ERROR"
      ? "failed"
      : health === "OK"
        ? "ok"
        : "degraded";
  const stale = input.status === "failed" || isStale(now, observedAt, 15 * 60_000);
  return {
    id: "cashcat_live",
    label: "CashCat 实时观察",
    status: stale && status === "ok" ? "degraded" : status,
    temporalScope: "live_snapshot",
    observedAt,
    stale,
    note:
      input.status === "failed"
        ? "CashCat 实时数据暂不可用。"
        : stale
          ? "CashCat 实时快照已超过 15 分钟。"
          : health === "OK"
            ? "行情、流动性与叙事来源均正常。"
            : "部分来源异常；不完整证据不会被补成利好。",
  };
}

function intelligenceSource(input: ProductModelInput): ProductSource {
  const observedAt = input.intelligence?.generatedAt ?? null;
  const stale = !input.intelligence || isStale(input.now, observedAt, 15 * 60_000);
  const baseStatus: ProductSourceStatus = !input.intelligence
    ? "failed"
    : input.intelligence.status === "success"
      ? "ok"
      : "degraded";
  const status = stale && baseStatus === "ok" ? "degraded" : baseStatus;
  return {
    id: "market_intelligence",
    label: "龙头与热度",
    status,
    temporalScope: "mixed_read_model",
    observedAt,
    stale,
    note: !input.intelligence
      ? "龙头与热度模型暂不可用。"
      : stale
        ? "龙头与热度结果已超过 15 分钟。"
        : "只组合可比口径，不生成黑盒综合分。",
  };
}

export function buildProductWorkbench(input: ProductModelInput): ProductWorkbenchResponse {
  const sources = [
    chainSource(input.now, input.chain),
    cashcatSource(input.now, input.cashcat),
    intelligenceSource(input),
  ];
  const available = sources.filter((source) => source.status !== "failed").length;
  const status =
    available === 0
      ? "unavailable"
      : sources.every((source) => source.status === "ok")
        ? "success"
        : "partial";
  const warnings = [
    ...sources.filter((source) => source.status !== "ok").map((source) => source.note),
    ...(input.intelligence?.warnings ?? []),
  ];
  return {
    service: "rhc-product-workbench",
    schemaVersion: 1,
    generatedAt: input.now.toISOString(),
    status,
    chain: chainSnapshot(input.chain.payload),
    cashcat: cashcatSnapshot(
      input.cashcat.payload,
      sources.find((source) => source.id === "cashcat_live")?.status ?? "failed",
    ),
    intelligence: input.intelligence,
    sources,
    warnings: [...new Set(warnings)],
  };
}
