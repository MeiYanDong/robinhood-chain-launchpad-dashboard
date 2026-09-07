const CORE_METRICS = ["volume_usd", "fees_usd", "protocol_revenue_usd"];
const PAIR_METRICS = ["market_cap_usd", "liquidity_depth_usd", "volume_24h_usd", "holder_count"];
const METRIC_LABELS = {
  volume_usd: "成交量",
  fees_usd: "用户手续费",
  protocol_revenue_usd: "平台收入",
};
const PAIR_METRIC_LABELS = {
  market_cap_usd: "市值",
  liquidity_depth_usd: "流动性池深度",
  volume_24h_usd: "24H 交易量",
  holder_count: "持币地址",
};
const ECONOMICS_DEFINITION_LABELS = {
  source_market_cap: "来源市值",
  burn_adjusted_market_cap: "销毁调整市值",
  user_fees: "用户手续费",
  protocol_revenue: "协议收入",
  policy_buyback_budget: "理论回购预算",
  executed_buyback: "实际回购",
  net_profit: "净利润",
  pair_relative_valuation: "PAIR 相对估值",
  valuation_range: "7 日估值区间",
  valuation_deviation: "实际价格偏离",
  policy_scenario: "手续费分配情景",
  pair_flow_today_volume: "今日主池成交",
  pair_flow_market_acquired: "市场买入 PAIR",
  pair_flow_dead_locked: "死亡地址余额",
  pair_flow_pending_buyback: "政策待回购",
};
const EVIDENCE_LABELS = {
  official: "官方",
  onchain: "链上",
  third_party: "第三方",
  scope_mismatch: "范围不同",
  unknown: "未核验",
  not_applicable: "不适用",
};
const VALUATION_FORMULA_LABELS = {
  "PONS price × (PONS effective supply ÷ PAIR effective supply) × (PAIR common-day volume ÷ PONS common-day volume)":
    "PONS 价格 ×（PONS 有效供应量 ÷ PAIR 有效供应量）×（PAIR 7日平台量 ÷ PONS 7日平台量）",
};
const VALUATION_SOURCE_LABELS = {
  "gmgn.ponsTokenInfo": "GMGN",
  "pair.officialTokenApi": "PAIR 官方 API",
  "robinhood.rpc.tokenSupply": "Robinhood RPC",
  "pons.officialAnalytics.dailyVolume": "Pons 官方统计",
  "pair.officialStats.dailyVolume": "PAIR 官方统计",
};
const FLOW_TIER_LABELS = {
  confirmed: "已核验",
  policy_expected: "政策预期",
  unattributed: "未归因",
  unknown: "未知",
};
const PAIR_V2_STAGE_LABELS = {
  rejected: "排除",
  watch: "观察",
  attention: "活跃",
  emerging: "形成",
  forming: "形成",
  confirmed: "确认",
};
const PAIR_V2_QUALITY_LABELS = {
  unknown: "待补证",
  unqualified: "未通过",
  qualified: "已通过",
};
const PAIR_V2_HEAT_LABELS = {
  normal: "正常",
  hot: "偏热",
  overheated: "过热",
};
const PAIR_V2_RISK_LABELS = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "严重",
};
const PAIR_V2_EVENT_LABELS = {
  launch: "新发行",
  fee_collected: "费用归集",
  buyback_executed: "回购销毁",
  holder_claim: "持有人领取",
  upgrade: "合约升级",
};
const PAIR_ALPHA_ACTION_LABELS = {
  risk_halt: "风险停止",
  no_chase: "过热勿追",
  confirmed: "信号确认",
  probe_eligible: "可研究试探",
  retest_watch: "回踩观察",
  ignition_watch: "点火观察",
  evidence_wait: "等待证据",
  cold_watch: "冷启动观察",
};
const METRIC_SHORT = {
  volume_usd: "VOL",
  fees_usd: "FEE",
  protocol_revenue_usd: "收入",
};
const SCOPE_LABELS = {
  comparable: "可比",
  partial: "部分覆盖",
  scope_mismatch: "范围不同",
  suite_wide: "套件级",
  unknown: "待审核",
};
const STAT_ORDER = [
  "volume_rolling_24h_usd",
  "volume_rolling_24h_eth",
  "fees_rolling_24h_eth",
  "platform_revenue_rolling_24h_eth",
  "trades_rolling_24h",
  "active_tokens_rolling_24h",
  "volume_all_time_eth",
  "fees_all_time_eth",
  "platform_revenue_all_time_eth",
  "creator_revenue_all_time_eth",
  "trades_all_time",
  "traders_all_time",
  "tokens_launched_all_time",
];

const APP_PREFIX = (() => {
  const match = window.location.pathname.match(
    /^\/(leaders|launchpads|pair-flow|pair-v2|pair-alpha)(?:\/|$)/,
  );
  return match ? `/${match[1]}` : "";
})();
const INITIAL_DATASET = window.location.pathname.startsWith("/leaders")
  ? "intelligence"
  : window.location.pathname.startsWith("/pair-alpha")
    ? "pair_alpha"
    : window.location.pathname.startsWith("/pair-v2")
      ? "pair_v2"
      : window.location.pathname.startsWith("/pair-flow")
        ? "pair_flow"
        : "economics";

const state = {
  dataset: INITIAL_DATASET,
  intelligence: null,
  windowDays: 1,
  economics: null,
  pairFlow: null,
  pairV2: null,
  pairAlpha: null,
  devMonitor: null,
  pairTeamLaunches: null,
  pairTeamRowLimit: 20,
  pairV2Mode: "all",
  pairV2Lens: "all",
  pairV2RowLimit: 20,
  pairV2Event: "all",
  pairAlphaLane: "all",
  pairAlphaGeneration: "all",
  pairAlphaSearch: "",
  pairAlphaRowLimit: 25,
  pairEvents: null,
  pairFlowWindow: "today",
  valuationHistory: null,
  economicsSources: null,
  overview: null,
  coverage: null,
  sources: null,
  pairLive: null,
  pairDaily: null,
  pairSources: null,
  pairMode: "live",
  longLive: null,
  longDaily: null,
  longSources: null,
  longMode: "live",
  methodLoadedFor: null,
  search: "",
  platformScope: "mainstream",
  sortKey: "volume_usd",
  sortDirection: "desc",
  detail: null,
  detailMetric: "volume_usd",
  lastFocus: null,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function api(path, options = {}) {
  const response = await fetch(`${APP_PREFIX}${path}`, {
    ...options,
    headers: { accept: "application/json", ...(options.headers ?? {}) },
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (typeof body.error === "string") message = body.error;
    } catch {
      // Keep the HTTP status when the body is not JSON.
    }
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function formatUsd(value, compact = true) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const absolute = Math.abs(value);
  if (!compact || absolute < 1_000) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: absolute < 10 ? 2 : 0,
    }).format(value);
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: absolute >= 1_000_000 ? 2 : 1,
  }).format(value);
}

function formatTokenPrice(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const absolute = Math.abs(value);
  if (absolute > 0 && absolute < 0.00000001) return `$${value.toExponential(4)}`;
  const maximumFractionDigits =
    absolute >= 100 ? 2 : absolute >= 1 ? 4 : absolute >= 0.01 ? 6 : absolute >= 0.0001 ? 8 : 10;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits,
  }).format(value);
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatCount(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatTokenAmount(value, symbol = "") {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const absolute = Math.abs(value);
  const formatted = new Intl.NumberFormat("en-US", {
    notation: absolute >= 1_000_000 ? "compact" : "standard",
    compactDisplay: "short",
    maximumFractionDigits: absolute >= 1_000_000 ? 3 : absolute >= 1 ? 3 : 6,
  }).format(value);
  return symbol ? `${formatted} ${symbol}` : formatted;
}

function formatValuationQuantity(value, unit = "token") {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    ...(unit === "usd" ? { style: "currency", currency: "USD" } : {}),
    notation: Math.abs(value) >= 1_000 ? "compact" : "standard",
    compactDisplay: "short",
    maximumFractionDigits: 3,
  }).format(value);
}

function formatPercent(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)}%`;
}

function formatPairValue(metric, value) {
  return metric === "holder_count" ? formatCount(value) : formatUsd(value);
}

function formatStatValue(stat) {
  if (!Number.isFinite(stat?.value)) return "—";
  if (stat.unit === "USD") return formatUsd(stat.value);
  if (stat.unit === "count") {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(stat.value);
  }
  if (stat.unit === "token") {
    return new Intl.NumberFormat("en-US", {
      notation: Math.abs(stat.value) >= 1_000_000 ? "compact" : "standard",
      maximumFractionDigits: 2,
    }).format(stat.value);
  }
  if (stat.unit === "ETH") {
    const digits = Math.abs(stat.value) < 10 ? 4 : Math.abs(stat.value) < 1_000 ? 2 : 0;
    return `Ξ${new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(stat.value)}`;
  }
  return String(stat.value);
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function showNotices(messages = [], type = "warning") {
  const stack = $("#notice-stack");
  stack.replaceChildren();
  for (const message of messages.filter(Boolean)) {
    const normalized = String(message).trim();
    if (/^One or more source results require attention\.?$/i.test(normalized)) continue;
    stack.append(element("div", `notice${type === "error" ? " is-error" : ""}`, normalized));
  }
}

function renderRunState() {
  const runState = $("#run-state");
  const text = $("span", runState);
  runState.classList.remove("is-ok", "is-bad");
  if (state.dataset === "intelligence") {
    if (!state.intelligence || state.intelligence.status === "unavailable") {
      runState.classList.add("is-bad");
      text.textContent = "情报不可用";
    } else if (state.intelligence.status === "partial") {
      text.textContent = "部分来源可用";
    } else {
      runState.classList.add("is-ok");
      text.textContent = "情报已更新";
    }
    return;
  }
  if (state.dataset === "economics") {
    if (!state.economics) {
      runState.classList.add("is-bad");
      text.textContent = "暂无数据";
    } else if (state.economics.stale || state.economics.status === "partial") {
      text.textContent = state.economics.stale ? "数据过期" : "部分数据可用";
    } else {
      runState.classList.add("is-ok");
      text.textContent = "三强已对齐";
    }
    return;
  }
  if (state.dataset === "pair_alpha") {
    if (!state.pairAlpha) {
      runState.classList.add("is-bad");
      text.textContent = "Alpha 数据不可用";
    } else if (state.pairAlpha.stale || state.pairAlpha.status === "partial") {
      text.textContent = state.pairAlpha.stale ? "Alpha 数据过期" : "Alpha 部分来源可用";
    } else {
      runState.classList.add("is-ok");
      text.textContent = "Alpha 实时监控中";
    }
    return;
  }
  if (state.dataset === "pair_v2") {
    if (!state.pairV2) {
      runState.classList.add("is-bad");
      text.textContent = "V2 数据不可用";
    } else if (state.pairV2.stale || state.pairV2.status === "partial") {
      text.textContent = state.pairV2.stale ? "V2 数据过期" : "V2 部分来源可用";
    } else {
      runState.classList.add("is-ok");
      text.textContent = "V2 链上监控中";
    }
    return;
  }
  if (state.dataset === "pair_flow") {
    if (!state.pairFlow) {
      runState.classList.add("is-bad");
      text.textContent = "闭环数据不可用";
    } else if (state.pairFlow.stale || state.pairFlow.status === "partial") {
      text.textContent = state.pairFlow.stale ? "闭环数据过期" : "闭环部分可用";
    } else {
      runState.classList.add("is-ok");
      text.textContent = "逐笔账本已更新";
    }
    return;
  }
  if (["pair", "long"].includes(state.dataset)) {
    const response = currentTokenRadarResponse();
    if (!response?.snapshot) {
      runState.classList.add("is-bad");
      text.textContent = "暂无数据";
    } else if (response.snapshot.stale || response.snapshot.status === "partial") {
      text.textContent = response.snapshot.stale ? "数据过期" : "部分来源可用";
    } else {
      runState.classList.add("is-ok");
      text.textContent = "数据已更新";
    }
    return;
  }
  if (!state.overview) return;
  if (state.overview.runStatus === "failed") {
    runState.classList.add("is-bad");
    text.textContent = "刷新失败";
  } else if (state.overview.stale || state.overview.runStatus === "partial") {
    text.textContent = state.overview.stale ? "数据过期" : "部分来源可用";
  } else {
    runState.classList.add("is-ok");
    text.textContent = "数据已闭合";
  }
}

function metricMeta(metric) {
  if (metric.value === null) return "暂无观测";
  if (metric.windowDays === 1)
    return metric.latestDate ? `UTC ${metric.latestDate.slice(5)}` : "已观测";
  return `${metric.observedDays}/${metric.windowDays} 日`;
}

function metricCell(metric) {
  const cell = element("td", "metric-cell");
  const value = element(
    "span",
    `metric-value${metric.value === null ? " is-null" : ""}`,
    formatUsd(metric.value),
  );
  value.title = metric.value === null ? "来源未给出可验证观测" : formatUsd(metric.value, false);
  cell.append(value, element("span", "metric-meta", metricMeta(metric)));
  return cell;
}

function sortedFilteredPlatforms() {
  const query = state.search.trim().toLowerCase();
  const filtered = state.overview.platforms.filter((platform) => {
    const searchMatch = !query || platform.name.toLowerCase().includes(query);
    const scopeMatch = state.platformScope === "all" || platform.status === "live";
    return searchMatch && scopeMatch;
  });

  return filtered.sort((left, right) => {
    if (state.sortKey === "name") {
      const comparison = left.name.localeCompare(right.name);
      return state.sortDirection === "asc" ? comparison : -comparison;
    }
    const leftValue = left.metrics[state.sortKey]?.value;
    const rightValue = right.metrics[state.sortKey]?.value;
    if (leftValue === null && rightValue === null) return left.name.localeCompare(right.name);
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;
    return state.sortDirection === "asc" ? leftValue - rightValue : rightValue - leftValue;
  });
}

function platformWarning(platform) {
  if (platform.excludeFromTotals) return "不计入平台总计";
  if (platform.comparability !== "comparable") {
    return `${SCOPE_LABELS[platform.comparability] ?? platform.comparability}：${platform.scope}`;
  }
  return null;
}

function bindPlatformTrigger(node, platformId) {
  node.addEventListener("click", () => openDetail(platformId, node));
  node.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDetail(platformId, node);
    }
  });
}

function renderDesktopRow(platform, index) {
  const row = element("tr", platform.excludeFromTotals ? "excluded-row" : "");
  row.tabIndex = 0;
  row.setAttribute("role", "button");
  row.setAttribute("aria-label", `查看 ${platform.name} 详情`);
  row.dataset.platformId = platform.id;
  row.append(element("td", "rank-cell", String(index + 1).padStart(2, "0")));

  const platformCell = element("td", "platform-cell");
  const nameLine = element("span", "platform-name-line");
  nameLine.append(element("strong", "platform-name", platform.name));
  const warning = platformWarning(platform);
  if (warning) {
    const marker = element("i", "platform-warning", "!");
    marker.title = warning;
    marker.setAttribute("aria-label", warning);
    nameLine.append(marker);
  }
  platformCell.append(nameLine);
  row.append(platformCell);

  for (const metric of CORE_METRICS) row.append(metricCell(platform.metrics[metric]));

  const arrowCell = element("td", "open-column");
  arrowCell.append(element("span", "row-arrow", "↗"));
  row.append(arrowCell);
  bindPlatformTrigger(row, platform.id);
  return row;
}

function renderMobileCard(platform, index) {
  const card = element(
    "article",
    `platform-card${platform.excludeFromTotals ? " excluded-row" : ""}`,
  );
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `查看 ${platform.name} 详情`);
  card.dataset.platformId = platform.id;

  const head = element("div", "platform-card__head");
  const identity = element("div", "platform-card__identity");
  identity.append(element("span", "platform-card__rank", String(index + 1).padStart(2, "0")));
  const nameLine = element("span", "platform-name-line");
  nameLine.append(element("strong", "platform-card__name", platform.name));
  const warning = platformWarning(platform);
  if (warning) {
    const marker = element("i", "platform-warning", "!");
    marker.title = warning;
    marker.setAttribute("aria-label", warning);
    nameLine.append(marker);
  }
  identity.append(nameLine);
  head.append(identity, element("span", "row-arrow", "↗"));

  const metrics = element("div", "platform-card__metrics");
  for (const metric of CORE_METRICS) {
    const item = element("div", "platform-card__metric");
    item.append(
      element("span", "", METRIC_LABELS[metric]),
      element(
        "strong",
        platform.metrics[metric].value === null ? "is-null" : "",
        formatUsd(platform.metrics[metric].value),
      ),
    );
    metrics.append(item);
  }
  card.append(head, metrics);
  bindPlatformTrigger(card, platform.id);
  return card;
}

function renderLedger() {
  const body = $("#ledger-body");
  const mobile = $("#mobile-ledger");
  body.replaceChildren();
  mobile.replaceChildren();
  const platforms = sortedFilteredPlatforms();
  $("#empty-state").hidden = platforms.length > 0;

  platforms.forEach((platform, index) => {
    body.append(renderDesktopRow(platform, index));
    mobile.append(renderMobileCard(platform, index));
  });

  $$("[data-sort]").forEach((button) => {
    const indicator = $("i", button);
    if (!indicator) return;
    indicator.textContent =
      button.dataset.sort === state.sortKey ? (state.sortDirection === "desc" ? "↓" : "↑") : "↕";
  });
}

function renderOverview() {
  if (!state.overview) return;
  $("#header-date").textContent = state.overview.targetDate;
  renderRunState();
  renderLedger();
  showNotices(state.overview.warnings ?? []);
}

const HEAT_LABELS = {
  cooling: "降温",
  normal: "常态",
  warming: "升温",
  hot: "高热",
  overheated: "过热",
  unknown: "未知",
};
const DIMENSION_LABELS = {
  cooling: "回落",
  steady: "平稳",
  expanding: "扩张",
  extreme: "极端",
  unknown: "未知",
};
const RELATIVE_LABELS = {
  relative_discount: "相对折价",
  in_range: "区间内",
  relative_premium: "相对溢价",
  unknown: "未知",
};

function formatRatio(value) {
  return Number.isFinite(value) ? `${value.toFixed(value >= 10 ? 1 : 2)}×` : "—";
}

function intelligenceStateChip(value, labels = HEAT_LABELS) {
  return element(
    "span",
    `intelligence-state intelligence-state--${value ?? "unknown"}`,
    labels[value] ?? value ?? "未知",
  );
}

function renderCategoryLeaders() {
  const host = $("#category-leader-grid");
  host.replaceChildren();
  const categories = state.intelligence?.leader?.categories ?? [];
  for (const category of categories) {
    const card = element("article", "category-leader");
    const header = element("header");
    header.append(
      element("span", "", category.label),
      element("strong", "", category.leader?.symbol ? `#1 ${category.leader.symbol}` : "未知"),
    );
    const list = element("ol");
    for (const row of category.top3) {
      const item = element("li");
      item.append(
        element("span", "category-leader__rank", String(row.rank).padStart(2, "0")),
        element("strong", "", row.symbol),
        element("b", "", category.unit === "count" ? formatCount(row.value) : formatUsd(row.value)),
      );
      item.title = `${row.name} · ${row.address}`;
      list.append(item);
    }
    if (!category.top3.length) list.append(element("li", "is-empty", "暂无可比数据"));
    card.append(header, list, element("footer", "", category.scope));
    host.append(card);
  }
}

function renderHeatDimensions() {
  const host = $("#heat-dimensions");
  host.replaceChildren();
  for (const item of state.intelligence?.chainHeat?.dimensions ?? []) {
    const card = element("article", `heat-dimension heat-dimension--${item.state}`);
    const top = element("div");
    top.append(
      element("span", "", item.label),
      intelligenceStateChip(item.state, DIMENSION_LABELS),
    );
    const metrics = item.evidence
      .map((metric) => {
        if (Number.isFinite(metric.change7d))
          return `${metric.label} ${formatSignedPercent(metric.change7d * 100)}`;
        if (Number.isFinite(metric.ratioToBaseline))
          return `${metric.label} ${formatRatio(metric.ratioToBaseline)}`;
        return `${metric.label} —`;
      })
      .join(" · ");
    card.append(top, element("small", "", metrics));
    card.title = item.conclusion;
    host.append(card);
  }
}

function renderTokenHeat() {
  const body = $("#token-heat-body");
  body.replaceChildren();
  const rows = state.intelligence?.tokenHeat?.rows ?? [];
  for (const token of rows) {
    const row = element("tr");
    const identity = element("td", "intelligence-token-cell");
    identity.append(element("strong", "", token.symbol), element("small", "", token.name));
    identity.title = token.address;
    const heat = element("td");
    const heatChip = intelligenceStateChip(token.state);
    heatChip.title = [...(token.evidence ?? []), ...(token.missing ?? [])].join("\n");
    heat.append(heatChip);
    row.append(
      identity,
      heat,
      element("td", "", formatUsd(token.marketCapUsd)),
      element("td", "", formatUsd(token.liquidityUsd)),
      element("td", "", formatUsd(token.volume24hUsd)),
      element(
        "td",
        "",
        formatPercent(Number.isFinite(token.turnover24h) ? token.turnover24h * 100 : null),
      ),
      element("td", "", formatRatio(token.liquidityChurn24h)),
      element("td", "", formatRatio(token.acceleration5m)),
      element("td", "", formatSignedPercent(token.priceChange24hPercent)),
    );
    body.append(row);
  }
  if (!rows.length) {
    const row = element("tr");
    const cell = element("td", "intelligence-table-empty", "暂无代币压力数据");
    cell.colSpan = 9;
    row.append(cell);
    body.append(row);
  }
}

function renderPlatformTokenAnchor() {
  const valuation = state.intelligence?.relativeValuation?.platformToken;
  const status = $("#intelligence-pair-state");
  status.textContent = valuation?.state === "available" ? "可用" : "未知";
  status.className = valuation?.state === "available" ? "is-available" : "is-unavailable";
  status.title = valuation?.reason ?? "";
  $("#intelligence-pair-actual").textContent = formatTokenPrice(valuation?.pairActualPriceUsd);
  $("#intelligence-pair-implied").textContent = formatTokenPrice(valuation?.pairImpliedPriceUsd);
  $("#intelligence-pair-range").textContent = formatPriceRange(
    valuation?.rangeLowUsd,
    valuation?.rangeHighUsd,
  );
  $("#intelligence-pair-gap").textContent = formatSignedPercent(valuation?.actualDeviationPercent);
}

function renderCohorts() {
  const host = $("#cohort-grid");
  host.replaceChildren();
  for (const cohort of state.intelligence?.relativeValuation?.cohorts ?? []) {
    const panel = element("article", "cohort-panel");
    const header = element("header");
    const title = element("div");
    title.append(element("h3", "", cohort.label), element("small", "", cohort.scope));
    header.append(title, element("time", "", formatDateTime(cohort.observedAt)));
    const wrap = element("div", "intelligence-table-wrap");
    const table = element("table", "intelligence-table cohort-table");
    const thead = document.createElement("thead");
    const heading = document.createElement("tr");
    for (const label of ["代币", "判断", "当前市值", "相对中心", "四分位区间", "偏离", "锚点"]) {
      heading.append(element("th", "", label));
    }
    thead.append(heading);
    const tbody = document.createElement("tbody");
    for (const item of cohort.rows) {
      const row = document.createElement("tr");
      const identity = element("td", "intelligence-token-cell");
      identity.append(
        element("strong", "", item.symbol),
        element("small", "", formatTokenPrice(item.priceUsd)),
      );
      const relative = document.createElement("td");
      const chip = intelligenceStateChip(item.state, RELATIVE_LABELS);
      chip.title = item.reason;
      relative.append(chip);
      row.append(
        identity,
        relative,
        element("td", "", formatUsd(item.currentMarketCapUsd)),
        element("td", "", formatUsd(item.impliedMarketCapUsd)),
        element(
          "td",
          "",
          Number.isFinite(item.rangeLowMarketCapUsd) && Number.isFinite(item.rangeHighMarketCapUsd)
            ? `${formatUsd(item.rangeLowMarketCapUsd)}–${formatUsd(item.rangeHighMarketCapUsd)}`
            : "—",
        ),
        element("td", "", formatSignedPercent(item.relativeGapPercent)),
        element("td", "", `${item.metricsUsed.length} 类 / ${item.anchorCount}`),
      );
      tbody.append(row);
    }
    if (!cohort.rows.length) {
      const row = document.createElement("tr");
      const cell = element("td", "intelligence-table-empty", "当前没有可比样本");
      cell.colSpan = 7;
      row.append(cell);
      tbody.append(row);
    }
    table.append(thead, tbody);
    wrap.append(table);
    panel.append(header, wrap);
    host.append(panel);
  }
}

function renderIntelligence() {
  const intelligence = state.intelligence;
  if (!intelligence) return;
  $("#intelligence-empty-state").hidden = intelligence.status !== "unavailable";
  $("#intelligence-chain-state").textContent = intelligence.chainHeat.label;
  $("#intelligence-live-at").textContent = formatDateTime(intelligence.leader.observedAt);
  const chainSource = intelligence.sources.find((source) => source.id === "chain_radar");
  const chainDataDate = intelligence.chainHeat.dimensions
    .flatMap((dimension) => dimension.evidence)
    .find((metric) => metric.asOf)?.asOf;
  $("#intelligence-chain-at").textContent = chainDataDate?.slice(0, 10) ?? "—";
  $("#header-date").textContent =
    chainDataDate?.slice(0, 10) ?? chainSource?.observedAt?.slice(0, 10) ?? "—";

  const leader = intelligence.leader.structuralLeader;
  $("#structural-leader-symbol").textContent = leader.symbol ?? "—";
  $("#structural-leader-status").textContent =
    leader.state === "confirmed"
      ? "已确认"
      : leader.state === "provisional"
        ? "待确认"
        : leader.state === "none"
          ? "暂无"
          : "未知";
  $("#structural-leader-status").className = `leader-status leader-status--${leader.state}`;
  $("#structural-leader-reason").textContent = leader.reason;
  const cliff = intelligence.leader.cliffLeader;
  $("#cliff-leader-symbol").textContent =
    cliff.symbol ?? (cliff.state === "none" ? "尚未形成" : "未知");
  $("#cliff-leader-symbol").title = cliff.reason;
  $("#leader-universe-count").textContent = Number.isFinite(
    intelligence.leader.eligibleUniverseCount,
  )
    ? `可比样本 ${formatCount(intelligence.leader.eligibleUniverseCount)}`
    : "样本 —";

  const chainHeat = intelligence.chainHeat;
  $("#chain-heat-state").textContent = chainHeat.label;
  $("#chain-heat-state").className = `chain-heat-value chain-heat-value--${chainHeat.state}`;
  $("#chain-heat-confidence").textContent =
    `置信度 ${{ high: "高", medium: "中", low: "低" }[chainHeat.confidence] ?? "—"}`;
  $("#chain-heat-warning").textContent = chainHeat.warning;

  renderHeatDimensions();
  renderCategoryLeaders();
  renderTokenHeat();
  renderPlatformTokenAnchor();
  renderCohorts();
  renderRunState();
  showNotices(intelligence.warnings ?? []);
}

function evidenceBadge(evidence) {
  const quality = evidence?.quality ?? "unknown";
  const qualityLabel = EVIDENCE_LABELS[quality] ?? quality;
  const label =
    evidence?.validation === "suspect"
      ? "待核验"
      : evidence?.validation === "stale"
        ? "已过期"
        : evidence?.state === "derived"
          ? `派生 · ${qualityLabel}`
          : qualityLabel;
  const isQuiet = ["official", "onchain", "third_party"].includes(quality);
  const badge = element(
    "span",
    `evidence-badge evidence-badge--${quality}${isQuiet ? " evidence-badge--quiet" : ""}`,
    label,
  );
  badge.setAttribute("aria-label", label);
  badge.title = evidence?.note ?? label;
  return badge;
}

function evidenceCell(evidence, formatter = formatUsd, unknownLabel = "未知") {
  const cell = element("td", "economics-value-cell");
  const display =
    evidence?.state === "not_applicable"
      ? "N/A"
      : evidence?.value === null || evidence?.value === undefined
        ? unknownLabel
        : formatter(evidence.value);
  cell.append(element("strong", evidence?.value === null ? "is-null" : "", display));
  if (evidence) cell.append(evidenceBadge(evidence));
  if (evidence?.validation === "suspect" && evidence.rawValue !== undefined) {
    cell.append(
      element("small", "is-null", `来源原值 ${formatter(evidence.rawValue)} · 不参与计算`),
    );
  }
  if (evidence?.asOf)
    cell.title = `观测时间 ${evidence.asOf}${evidence.note ? ` · ${evidence.note}` : ""}`;
  return cell;
}

function tokenIdentityCell(token) {
  const cell = element("td", "economics-identity-cell");
  cell.append(element("span", "economics-platform-code", token.platformName));
  const safeUrl = safeExternalUrl(token.tokenUrl);
  const link = element(safeUrl ? "a" : "span", "economics-token-link");
  if (safeUrl) {
    link.href = safeUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
  }
  link.append(
    element("strong", "", token.symbol),
    element(
      "small",
      "",
      token.role === "dynamic_market_cap_leader" ? `${token.name} · 动态龙头` : token.name,
    ),
  );
  link.title = token.address || token.name;
  cell.append(link);
  return cell;
}

function renderTokenEconomics() {
  const body = $("#token-economics-body");
  body.replaceChildren();
  for (const token of state.economics.tokens) {
    const row = element("tr");
    row.dataset.platformId = token.platformId;
    row.append(
      tokenIdentityCell(token),
      evidenceCell(token.priceUsd, formatTokenPrice),
      evidenceCell(token.marketCapUsd),
      evidenceCell(token.burnAdjustedMarketCapUsd),
      evidenceCell(token.liquidityUsd),
      evidenceCell(token.volume24hUsd),
      evidenceCell(token.holderCount, formatCount),
    );
    const burnCell = element("td", "economics-burn-cell");
    if (token.burnedSupply.state === "not_applicable") {
      burnCell.append(element("strong", "is-null", "N/A"), evidenceBadge(token.burnedSupply));
    } else if (token.burnedSupply.value === null) {
      burnCell.append(element("strong", "is-null", "未知"), evidenceBadge(token.burnedSupply));
    } else {
      burnCell.append(
        element("strong", "", formatCount(token.burnedSupply.value)),
        element("small", "", formatPercent(token.burnedPercent.value)),
        evidenceBadge(token.burnedSupply),
      );
    }
    row.append(burnCell);
    body.append(row);
  }
}

function renderPlatformEconomics() {
  const body = $("#platform-economics-body");
  body.replaceChildren();
  for (const platform of state.economics.platforms) {
    const row = element("tr");
    row.dataset.platformId = platform.platformId;
    const name = element("td", "economics-platform-cell");
    name.append(element("strong", "", platform.platformName), element("small", "", platform.date));
    row.append(
      name,
      evidenceCell(platform.volumeUsd),
      evidenceCell(platform.threePlatformSharePercent, formatPercent, "未计算"),
      evidenceCell(platform.userFeesUsd),
      evidenceCell(platform.protocolRevenueAccruedUsd),
      evidenceCell(platform.protocolRevenueReceivedUsd),
      evidenceCell(platform.policyBuybackBudgetUsd),
      evidenceCell(
        platform.executedBuybackUsd,
        formatUsd,
        platform.buybackPolicy.applies ? "待逐笔核验" : "N/A",
      ),
      evidenceCell(platform.retainedAfterBuybackUsd),
      evidenceCell(platform.netProfitUsd),
    );
    body.append(row);
  }
}

function renderBuybacks() {
  const body = $("#buyback-body");
  body.replaceChildren();
  const labels = {
    transaction_verified: "逐笔已核验",
    policy_and_cumulative_burn_only: "仅政策 + 累计销毁",
    not_applicable: "不适用",
  };
  for (const buyback of state.economics.buybacks) {
    const row = element("tr");
    const name = element("td", "economics-platform-cell");
    name.append(element("strong", "", buyback.platformName));
    const rule = element("td", "buyback-rule-cell");
    if (buyback.policy.applies) {
      const safeUrl = safeExternalUrl(buyback.policy.sourceUrl);
      const anchor = element(safeUrl ? "a" : "span", "buyback-policy-link");
      if (safeUrl) {
        anchor.href = safeUrl;
        anchor.target = "_blank";
        anchor.rel = "noreferrer";
      }
      anchor.append(
        element("strong", "", formatPercent(buyback.policy.percentage)),
        element("small", "", buyback.policy.basis),
      );
      rule.append(anchor);
    } else {
      rule.append(element("strong", "is-null", "N/A"));
    }
    const cumulative = element("td", "economics-burn-cell");
    if (buyback.cumulativeBurnedTokens.value === null) {
      cumulative.append(
        element(
          "strong",
          "is-null",
          buyback.cumulativeBurnedTokens.state === "not_applicable" ? "N/A" : "未知",
        ),
      );
    } else {
      cumulative.append(
        element("strong", "", formatCount(buyback.cumulativeBurnedTokens.value)),
        element("small", "", formatPercent(buyback.cumulativeBurnedPercent.value)),
      );
    }
    const proof = element("td", "buyback-proof-cell");
    const proofBadge = element(
      "span",
      `proof-badge proof-badge--${buyback.proofStatus}`,
      labels[buyback.proofStatus] ?? buyback.proofStatus,
    );
    proofBadge.title = buyback.note;
    proof.append(proofBadge);
    row.append(
      name,
      rule,
      cumulative,
      evidenceCell(
        buyback.dailyExecutedSpendUsd,
        formatUsd,
        buyback.policy.applies ? "待逐笔核验" : "N/A",
      ),
      evidenceCell(
        buyback.dailyExecutedTokens,
        formatCount,
        buyback.policy.applies ? "待逐笔核验" : "N/A",
      ),
      proof,
    );
    body.append(row);
  }
}

function summaryEvidenceValue(evidence, formatter) {
  if (evidence?.state === "not_applicable") return "N/A";
  if (!Number.isFinite(evidence?.value)) return "未知";
  return formatter(evidence.value);
}

function summaryEvidenceState(evidence) {
  if (!Number.isFinite(evidence?.value)) return "unknown";
  return evidence?.quality === "scope_mismatch" ? "warning" : "available";
}

function setTriadValue(selector, value, stateName = "", title = "") {
  const target = $(selector);
  target.textContent = value;
  target.className = stateName ? `triad-value triad-value--${stateName}` : "triad-value";
  target.title = title;
}

function renderTriadSummary() {
  const proofLabels = {
    transaction_verified: "逐笔已核验",
    policy_and_cumulative_burn_only: "仅政策",
    not_applicable: "无机制",
  };

  for (const platformId of ["pons", "long", "pair"]) {
    const token = state.economics.tokens.find((item) => item.platformId === platformId);
    const platform = state.economics.platforms.find((item) => item.platformId === platformId);
    const buyback = state.economics.buybacks.find((item) => item.platformId === platformId);
    const symbol = token?.symbol ?? "—";
    $(`#triad-${platformId}-symbol`).textContent = symbol;

    setTriadValue(
      `#triad-${platformId}-price`,
      summaryEvidenceValue(token?.priceUsd, formatTokenPrice),
      summaryEvidenceState(token?.priceUsd),
      token?.priceUsd?.note ?? "",
    );
    setTriadValue(
      `#triad-${platformId}-market-cap`,
      summaryEvidenceValue(token?.marketCapUsd, formatUsd),
      summaryEvidenceState(token?.marketCapUsd),
      token?.marketCapUsd?.note ?? "",
    );
    setTriadValue(
      `#triad-${platformId}-share`,
      summaryEvidenceValue(platform?.threePlatformSharePercent, formatPercent),
      summaryEvidenceState(platform?.threePlatformSharePercent),
      platform?.threePlatformSharePercent?.note ?? "",
    );
    setTriadValue(
      `#triad-${platformId}-revenue`,
      summaryEvidenceValue(platform?.protocolRevenueAccruedUsd, formatUsd),
      summaryEvidenceState(platform?.protocolRevenueAccruedUsd),
      platform?.protocolRevenueAccruedUsd?.note ?? "",
    );

    const proofStatus = buyback?.proofStatus ?? "unknown";
    setTriadValue(
      `#triad-${platformId}-buyback`,
      proofLabels[proofStatus] ?? "未知",
      proofStatus === "transaction_verified"
        ? "verified"
        : proofStatus === "not_applicable"
          ? "neutral"
          : "warning",
      buyback?.note ?? buyback?.policy?.basis ?? "",
    );
  }
}

function formatPriceRange(low, high) {
  if (!Number.isFinite(low) || !Number.isFinite(high)) return "—";
  const lowLabel = formatTokenPrice(low);
  const highLabel = formatTokenPrice(high).replace(/^\$/, "");
  return `${lowLabel}–${highLabel}`;
}

function formatSignedPercent(value) {
  if (!Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${formatPercent(value)}`;
}

function valuationLinePath(points, key, x, y) {
  let drawing = false;
  return points
    .map((point) => {
      const value = point[key];
      if (!Number.isFinite(value)) {
        drawing = false;
        return "";
      }
      const command = drawing ? "L" : "M";
      drawing = true;
      return `${command}${x(point).toFixed(2)},${y(value).toFixed(2)}`;
    })
    .filter(Boolean)
    .join(" ");
}

function renderValuationHistory() {
  const svg = $("#valuation-history-chart");
  const empty = $("#valuation-chart-empty");
  svg.replaceChildren();
  const points = (state.valuationHistory?.points ?? [])
    .filter((point) => {
      const timestamp = Date.parse(point.observedAt);
      return (
        Number.isFinite(timestamp) &&
        [point.estimateUsd, point.actualPriceUsd].some((value) => Number.isFinite(value))
      );
    })
    .map((point) => ({ ...point, timestamp: Date.parse(point.observedAt) }));
  if (points.length === 0) {
    svg.hidden = true;
    empty.hidden = false;
    return;
  }
  svg.hidden = false;
  empty.hidden = true;

  const width = 720;
  const height = 180;
  const padding = { top: 18, right: 18, bottom: 26, left: 78 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const values = points.flatMap((point) =>
    [point.rangeLowUsd, point.rangeHighUsd, point.estimateUsd, point.actualPriceUsd].filter(
      (value) => Number.isFinite(value),
    ),
  );
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const priceSpan = rawMax - rawMin;
  const breathingRoom = priceSpan > 0 ? priceSpan * 0.12 : Math.max(rawMax * 0.08, 0.00000001);
  const minValue = Math.max(0, rawMin - breathingRoom);
  const maxValue = rawMax + breathingRoom;
  const minTime = points[0].timestamp;
  const maxTime = points.at(-1).timestamp;
  const x = (point) =>
    padding.left +
    (maxTime === minTime
      ? plotWidth / 2
      : ((point.timestamp - minTime) / (maxTime - minTime)) * plotWidth);
  const y = (value) =>
    padding.top + plotHeight - ((value - minValue) / (maxValue - minValue)) * plotHeight;

  for (const fraction of [0, 0.5, 1]) {
    const gridY = padding.top + plotHeight * fraction;
    svg.append(
      svgElement("line", {
        x1: padding.left,
        x2: width - padding.right,
        y1: gridY,
        y2: gridY,
        class: "valuation-chart-grid",
      }),
    );
  }

  const bandPoints = points.filter(
    (point) => Number.isFinite(point.rangeLowUsd) && Number.isFinite(point.rangeHighUsd),
  );
  if (bandPoints.length > 1) {
    const upper = bandPoints
      .map((point) => `${x(point).toFixed(2)},${y(point.rangeHighUsd).toFixed(2)}`)
      .join(" L");
    const lower = [...bandPoints]
      .reverse()
      .map((point) => `${x(point).toFixed(2)},${y(point.rangeLowUsd).toFixed(2)}`)
      .join(" L");
    svg.append(svgElement("path", { d: `M${upper} L${lower} Z`, class: "valuation-chart-band" }));
  }

  const estimatePath = valuationLinePath(points, "estimateUsd", x, y);
  const actualPath = valuationLinePath(points, "actualPriceUsd", x, y);
  if (estimatePath) {
    svg.append(svgElement("path", { d: estimatePath, class: "valuation-chart-line" }));
  }
  if (actualPath) {
    svg.append(svgElement("path", { d: actualPath, class: "valuation-chart-line is-actual" }));
  }

  const appendLastDot = (key, className) => {
    const point = [...points].reverse().find((candidate) => Number.isFinite(candidate[key]));
    if (!point) return;
    svg.append(
      svgElement("circle", {
        cx: x(point),
        cy: y(point[key]),
        r: 3.8,
        class: `valuation-chart-dot${className}`,
      }),
    );
  };
  appendLastDot("estimateUsd", "");
  appendLastDot("actualPriceUsd", " is-actual");

  const maxLabel = svgElement("text", { x: 8, y: padding.top + 4, class: "valuation-chart-label" });
  maxLabel.textContent = formatTokenPrice(rawMax);
  const minLabel = svgElement("text", {
    x: 8,
    y: padding.top + plotHeight + 4,
    class: "valuation-chart-label",
  });
  minLabel.textContent = formatTokenPrice(rawMin);
  const startLabel = svgElement("text", {
    x: padding.left,
    y: height - 7,
    class: "valuation-chart-label",
  });
  startLabel.textContent = formatDateTime(points[0].observedAt);
  const endLabel = svgElement("text", {
    x: width - padding.right,
    y: height - 7,
    class: "valuation-chart-label",
    "text-anchor": "end",
  });
  endLabel.textContent = formatDateTime(points.at(-1).observedAt);
  svg.append(maxLabel, minLabel, startLabel, endLabel);
}

function valuationFormulaLabel(formula) {
  if (!formula) return "—";
  return VALUATION_FORMULA_LABELS[formula] ?? formula;
}

function valuationSourceLabel(source) {
  if (!source) return "未注明来源";
  return source
    .split("+")
    .map((part) => VALUATION_SOURCE_LABELS[part] ?? part)
    .join(" + ");
}

function renderValuationInput(valueSelector, metaSelector, evidence, formatter) {
  const valueNode = $(valueSelector);
  const metaNode = $(metaSelector);
  const available = Number.isFinite(evidence?.value);
  valueNode.textContent = available ? formatter(evidence.value) : "—";
  valueNode.classList.toggle("is-unavailable", !available);
  metaNode.replaceChildren();

  if (!evidence) {
    metaNode.textContent = "未核验";
    return;
  }

  const source = element("span", "valuation-input-source", valuationSourceLabel(evidence.source));
  source.title = evidence.source ?? "未注明来源";
  metaNode.append(source, evidenceBadge(evidence));
  if (evidence.asOf) {
    const observedAt = element("time", "valuation-input-time", formatDateTime(evidence.asOf));
    observedAt.dateTime = evidence.asOf;
    metaNode.append(observedAt);
  }
  metaNode.title = evidence.note ?? "";
}

function latestClosedUtcDate(observedAt) {
  const observed = new Date(observedAt);
  if (Number.isNaN(observed.valueOf())) return null;
  const startOfObservedDay = Date.UTC(
    observed.getUTCFullYear(),
    observed.getUTCMonth(),
    observed.getUTCDate(),
  );
  return new Date(startOfObservedDay - 86_400_000).toISOString().slice(0, 10);
}

function closedDayLag(windowEnd, observedAt) {
  const latestClosed = latestClosedUtcDate(observedAt);
  if (!windowEnd || !latestClosed) return null;
  const windowTime = Date.parse(`${windowEnd}T00:00:00Z`);
  const latestTime = Date.parse(`${latestClosed}T00:00:00Z`);
  if (!Number.isFinite(windowTime) || !Number.isFinite(latestTime)) return null;
  return Math.max(0, Math.round((latestTime - windowTime) / 86_400_000));
}

function renderValuationWindow(valuation) {
  const target = $("#valuation-window-state");
  target.classList.remove("is-current", "is-delayed", "is-unavailable");
  if (!valuation?.platformWindowStart || !valuation?.platformWindowEnd) {
    const dayCount = Number.isFinite(valuation?.commonDayCount) ? valuation.commonDayCount : 0;
    const minimum = Number.isFinite(valuation?.minimumCommonDays) ? valuation.minimumCommonDays : 5;
    target.textContent = `共同窗口不可用 · ${dayCount}/${minimum} 日`;
    target.classList.add("is-unavailable");
    return;
  }

  const lag = closedDayLag(valuation.platformWindowEnd, valuation.observedAt);
  const history = Number.isFinite(valuation.totalCommonDayCount)
    ? ` · 可比历史 ${valuation.totalCommonDayCount} 日`
    : "";
  const lagLabel =
    lag === null ? "" : lag === 0 ? " · 已覆盖最近闭合日" : ` · 落后最近闭合日 ${lag} 日`;
  target.textContent = `共同窗口 ${valuation.platformWindowStart}—${valuation.platformWindowEnd} · ${valuation.commonDayCount} 日${history}${lagLabel}`;
  target.classList.add(lag === null ? "is-unavailable" : lag > 0 ? "is-delayed" : "is-current");
}

function renderValuationCalculation(valuation) {
  const inputs = valuation?.inputs;
  const formula = $("#valuation-formula-definition");
  formula.textContent = valuationFormulaLabel(valuation?.formula);
  formula.title = valuation?.formula ?? "等待模型数据";
  renderValuationWindow(valuation);

  renderValuationInput(
    "#valuation-input-pons-price",
    "#valuation-input-pons-price-meta",
    inputs?.ponsPriceUsd,
    formatTokenPrice,
  );
  renderValuationInput(
    "#valuation-input-pair-price",
    "#valuation-input-pair-price-meta",
    inputs?.pairActualPriceUsd,
    formatTokenPrice,
  );
  renderValuationInput(
    "#valuation-input-pons-supply",
    "#valuation-input-pons-supply-meta",
    inputs?.ponsEffectiveSupply,
    (value) => formatValuationQuantity(value),
  );
  renderValuationInput(
    "#valuation-input-pair-supply",
    "#valuation-input-pair-supply-meta",
    inputs?.pairEffectiveSupply,
    (value) => formatValuationQuantity(value),
  );
  renderValuationInput(
    "#valuation-input-pons-volume",
    "#valuation-input-pons-volume-meta",
    inputs?.ponsPlatformVolumeUsd,
    (value) => formatValuationQuantity(value, "usd"),
  );
  renderValuationInput(
    "#valuation-input-pair-volume",
    "#valuation-input-pair-volume-meta",
    inputs?.pairPlatformVolumeUsd,
    (value) => formatValuationQuantity(value, "usd"),
  );

  const substitution = [
    formatTokenPrice(inputs?.ponsPriceUsd?.value),
    `(${formatValuationQuantity(inputs?.ponsEffectiveSupply?.value)} ÷ ${formatValuationQuantity(inputs?.pairEffectiveSupply?.value)})`,
    `(${formatValuationQuantity(inputs?.pairPlatformVolumeUsd?.value, "usd")} ÷ ${formatValuationQuantity(inputs?.ponsPlatformVolumeUsd?.value, "usd")})`,
  ].join(" × ");
  $("#valuation-equation-substitution").textContent =
    `${substitution} = ${formatTokenPrice(valuation?.estimateUsd)}`;

  const ponsPolicy = valuation?.policyScenario?.ponsFeeAllocationPercent;
  const pairPolicy = valuation?.policyScenario?.pairFeeAllocationPercent;
  const policyEquation = $("#valuation-policy-equation");
  policyEquation.textContent =
    Number.isFinite(ponsPolicy) && Number.isFinite(pairPolicy)
      ? `${formatTokenPrice(valuation?.estimateUsd)} × (PAIR ${formatCount(pairPolicy)}% ÷ PONS ${formatCount(ponsPolicy)}%) = ${formatTokenPrice(valuation?.policyScenario?.estimateUsd)}`
      : "—";

  const reasons = $("#valuation-reasons");
  const reasonItems = valuation?.reasons ?? [];
  reasons.replaceChildren(
    ...reasonItems.map((item) =>
      element("li", item.severity === "blocking" ? "is-blocking" : "is-note", item.message),
    ),
  );
  reasons.hidden = reasonItems.length === 0;
}

function renderPairRelativeValuation() {
  const valuation = state.economics?.pairRelativeValuation;
  const confidenceLabels = { high: "高", medium: "中", low: "低", unavailable: "不可用" };
  const status = $("#pair-valuation-state");
  status.classList.remove("is-available", "is-unavailable");
  status.classList.add(valuation?.state === "available" ? "is-available" : "is-unavailable");
  status.textContent = valuation?.state === "available" ? "可用" : "不可用";
  status.title = valuation?.reasons?.map((item) => item.message).join("\n") ?? "等待估值数据";

  $("#valuation-actual-price").textContent = formatTokenPrice(valuation?.actualPriceUsd);
  $("#valuation-estimate-price").textContent = formatTokenPrice(valuation?.estimateUsd);
  $("#valuation-range").textContent = formatPriceRange(
    valuation?.rangeLowUsd,
    valuation?.rangeHighUsd,
  );
  const deviation = $("#valuation-deviation");
  deviation.textContent = formatSignedPercent(valuation?.actualDeviationPercent);
  deviation.classList.remove("is-premium", "is-discount", "is-unavailable");
  deviation.classList.add(
    !Number.isFinite(valuation?.actualDeviationPercent)
      ? "is-unavailable"
      : valuation.actualDeviationPercent >= 0
        ? "is-premium"
        : "is-discount",
  );
  deviation.title = Number.isFinite(valuation?.actualDeviationPercent)
    ? valuation.actualDeviationPercent >= 0
      ? "PAIR 实际价格高于相对估值中枢"
      : "PAIR 实际价格低于相对估值中枢"
    : "缺少可比结果";
  $("#valuation-policy-price").textContent = formatTokenPrice(
    valuation?.policyScenario?.estimateUsd,
  );
  const ponsPolicy = valuation?.policyScenario?.ponsFeeAllocationPercent;
  const pairPolicy = valuation?.policyScenario?.pairFeeAllocationPercent;
  $("#valuation-policy-label").textContent =
    Number.isFinite(ponsPolicy) && Number.isFinite(pairPolicy)
      ? `${formatCount(pairPolicy)}% / ${formatCount(ponsPolicy)}% 情景`
      : "费用分配情景";
  $("#valuation-confidence").textContent = confidenceLabels[valuation?.confidence] ?? "—";
  renderValuationCalculation(valuation);
  $("#valuation-meta").textContent = valuation
    ? `模型 ${valuation.modelVersion} · 快照 ${formatDateTime(valuation.observedAt)} · 价格有效期 ${formatCount(valuation.priceFreshnessMinutes)} 分钟`
    : "—";
  renderValuationHistory();
}

function pairFlowMetricText(metric, formatter) {
  return Number.isFinite(metric?.value) ? formatter(metric.value) : "—";
}

function setPairFlowMetric(selector, metric, formatter) {
  const target = $(selector);
  target.textContent = pairFlowMetricText(metric, formatter);
  const tier = metric?.tier ?? "unknown";
  target.classList.remove("is-confirmed", "is-policy-expected", "is-unattributed", "is-unknown");
  target.classList.add(`is-${tier.replaceAll("_", "-")}`);
  target.title = `${FLOW_TIER_LABELS[tier] ?? tier}${metric?.note ? ` · ${metric.note}` : ""}`;
}

function renderPairFlow() {
  const flow = state.pairFlow;
  const status = $("#pair-flow-state");
  status.classList.remove("is-ok", "is-partial", "is-missing");
  if (!flow) {
    status.textContent = "暂不可用";
    status.classList.add("is-missing");
    $("#pair-flow-observed-at").textContent = "—";
    $("#pair-flow-teaser-burn").textContent = "—";
    $("#pair-flow-teaser-pending").textContent = "—";
    return;
  }

  status.textContent = flow.stale ? "数据过期" : flow.status === "success" ? "已更新" : "部分可用";
  status.classList.add(flow.stale || flow.status !== "success" ? "is-partial" : "is-ok");
  $("#pair-flow-observed-at").textContent = formatDateTime(flow.observedAt);

  setPairFlowMetric("#pair-flow-main-today", flow.volume.mainPoolTodayUsd, formatUsd);
  setPairFlowMetric("#pair-flow-main-24h", flow.volume.mainPoolRolling24hUsd, formatUsd);
  setPairFlowMetric("#pair-flow-platform-24h", flow.volume.platformRolling24hUsd, formatUsd);
  setPairFlowMetric("#pair-flow-budget-24h", flow.volume.theoreticalPolicyBuyback24hUsd, formatUsd);
  const platformSource = flow.sources?.find(
    (source) => source.source === "pair.tokenRadar.universeAggregate",
  );
  const platformCoverageComplete = platformSource?.status === "ok";
  $("#pair-flow-platform-label").textContent = platformCoverageComplete
    ? "全平台 24H"
    : "全平台 24H（已观测）";
  $("#pair-flow-budget-label").textContent = platformCoverageComplete
    ? "24H 理论回购新增"
    : "24H 理论回购新增（下限）";
  $("#pair-flow-platform-coverage").textContent =
    platformSource?.message?.replace(/[。.]$/, "") ??
    (Number.isFinite(flow.volume.platformTokenCount?.value)
      ? `可见代币 ${formatCount(flow.volume.platformTokenCount.value)}`
      : "可见代币 —");

  setPairFlowMetric("#pair-flow-bought-total", flow.burn.cumulativeMarketAcquiredPair, (value) =>
    formatTokenAmount(value),
  );
  setPairFlowMetric(
    "#pair-flow-market-burned",
    flow.burn.cumulativeMarketAcquiredBurnedPair,
    (value) => formatTokenAmount(value),
  );
  setPairFlowMetric("#pair-flow-dead-total", flow.burn.deadLockedPair, (value) =>
    formatTokenAmount(value),
  );
  $("#pair-flow-dead-percent").textContent = Number.isFinite(flow.burn.deadLockedPercent?.value)
    ? `${formatPercent(flow.burn.deadLockedPercent.value)} 总供应量`
    : "—";
  $("#pair-flow-dead-percent").title = flow.burn.deadLockedPair?.note ?? "";
  setPairFlowMetric("#pair-flow-today-burn", flow.burn.todayBurnedPair, (value) =>
    formatTokenAmount(value, "PAIR"),
  );
  setPairFlowMetric("#pair-flow-direct-today", flow.burn.todayDirectFeeBurnedPair, (value) =>
    formatTokenAmount(value, "PAIR"),
  );
  setPairFlowMetric("#pair-flow-market-today", flow.burn.todayMarketAcquiredBurnedPair, (value) =>
    formatTokenAmount(value, "PAIR"),
  );
  setPairFlowMetric(
    "#pair-flow-bought-pending",
    flow.burn.walletMarketAcquiredPendingPair,
    (value) => formatTokenAmount(value, "PAIR"),
  );
  setPairFlowMetric("#pair-flow-wallet-pair", flow.burn.walletPendingPair, (value) =>
    formatTokenAmount(value, "PAIR"),
  );
  setPairFlowMetric("#pair-flow-locker-pair", flow.burn.lockerPendingDirectPair, (value) =>
    formatTokenAmount(value, "PAIR"),
  );

  $("#pair-flow-history-state").textContent = flow.attribution.complete
    ? "历史已对账"
    : "历史未完整";
  $("#pair-flow-history-state").className = flow.attribution.complete ? "is-ok" : "is-partial";

  setPairFlowMetric("#pair-flow-policy-usd", flow.buyback.policyExpectedUsd, formatUsd);
  const quoteAssetCount = flow.buyback.protocolQuoteAssetCount;
  const policySpy = flow.buyback.policyExpectedSpy;
  const policySpyText = Number.isFinite(policySpy?.value)
    ? ` · SPY 分项 ${formatTokenAmount(policySpy.value, "SPY")}`
    : "";
  $("#pair-flow-policy-spy").textContent = Number.isFinite(quoteAssetCount?.value)
    ? `${formatCount(quoteAssetCount.value)} 种报价资产${policySpyText}`
    : `报价资产${policySpyText}`;
  $("#pair-flow-policy-spy").title = policySpy?.note ?? "";
  setPairFlowMetric("#pair-flow-quote-assets-usd", flow.buyback.protocolQuoteAssetsUsd, formatUsd);
  setPairFlowMetric(
    "#pair-flow-quote-asset-count",
    quoteAssetCount,
    (value) => `${formatCount(value)} 种`,
  );
  setPairFlowMetric("#pair-flow-protocol-spy", flow.buyback.protocolClaimableSpy, (value) =>
    formatTokenAmount(value, "SPY"),
  );
  setPairFlowMetric("#pair-flow-main-unswept-spy", flow.buyback.mainPoolUnsweptSpy, (value) =>
    formatTokenAmount(value, "SPY"),
  );
  setPairFlowMetric("#pair-flow-treasury-spy", flow.buyback.protocolWalletSpy, (value) =>
    formatTokenAmount(value, "SPY"),
  );
  setPairFlowMetric("#pair-flow-creator-wallet-spy", flow.buyback.creatorWalletSpy, (value) =>
    formatTokenAmount(value, "SPY"),
  );

  const pressure = flow.pressure.policyPendingToLiquidityPercent;
  setPairFlowMetric("#pair-flow-pressure-value", pressure, formatPercent);
  const pressurePercent = Number.isFinite(pressure?.value) ? pressure.value : 0;
  $("#pair-flow-pressure-bar").style.width = `${Math.min(100, Math.max(0, pressurePercent * 25))}%`;
  const pressureLabels = {
    low: "当前体量较低 · 不是价格预测",
    moderate: "当前体量中等 · 不是价格预测",
    high: "相对流动性较高 · 注意执行冲击",
    unknown: "缺少可比数据",
  };
  $("#pair-flow-pressure-label").textContent = pressureLabels[flow.pressure.state] ?? "—";
  $("#pair-flow-pressure-label").className = `is-${flow.pressure.state}`;

  const usableSources = flow.sources.filter((source) => source.status === "ok").length;
  $("#pair-flow-evidence-summary").textContent =
    `${usableSources}/${flow.sources.length} 来源可用 · 北京时间 ${flow.window.calendarDate}`;
  $("#pair-flow-funding-note").textContent =
    flow.attribution.fundingLink === "closed"
      ? "手续费报价资产 → Swap → PAIR 已逐笔闭环"
      : "已归集资产可核验；其它池未归集额及逐笔回购资金关联仍未完全闭环";
  $("#pair-flow-teaser-burn").textContent = pairFlowMetricText(flow.burn.todayBurnedPair, (value) =>
    formatTokenAmount(value, "PAIR"),
  );
  $("#pair-flow-teaser-pending").textContent = pairFlowMetricText(
    flow.buyback.policyExpectedUsd,
    formatUsd,
  );
}

function compactHex(value, head = 6, tail = 4) {
  if (typeof value !== "string" || value.length <= head + tail + 1) return value ?? "—";
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function pairFlowActorLabel(event) {
  if (event.actorRole === "creator") return "官方创建者";
  if (event.actorRole === "protocol_treasury") return "协议金库";
  return "推断执行器";
}

function pairFlowCategoryLabel(event) {
  const labels = {
    direct_fee_burn: "直接手续费币",
    market_buy_burn: "回购币",
    mixed_burn: "混合批次",
    unattributed_burn: "来源未归因",
  };
  return labels[event.category] ?? "市场买入";
}

function pairFlowValuationLabel(event) {
  if (event.usdValuation === "settlement_observed") return "交易内稳定币结算";
  if (event.usdValuation === "indexed_price_estimate") return "浏览器索引价估算";
  return "美元额未知";
}

function pairFlowIdentityCell(event) {
  const cell = element("td");
  const identity = element("div", "flow-event-identity");
  const time = element("time", "", formatDateTime(event.timestamp));
  time.dateTime = event.timestamp;
  const role = element(
    "small",
    `flow-event-role${event.actorAttribution === "behavior_inferred" ? " is-inferred" : ""}`,
    `${pairFlowActorLabel(event)} · ${compactHex(event.actorAddress)}`,
  );
  role.title = event.actorAddress;
  identity.append(time, role);
  cell.append(identity);
  return cell;
}

function pairFlowValueCell(value, secondary = "") {
  const cell = element("td");
  const content = element("div", "flow-event-value");
  content.append(element("strong", "", value));
  if (secondary) content.append(element("small", "", secondary));
  cell.append(content);
  return cell;
}

function pairFlowProofCell(event, mode) {
  const cell = element("td");
  const proof = element(
    "div",
    `flow-event-proof${event.category === "unattributed_burn" ? " is-unattributed" : ""}`,
  );
  if (event.linkedTxHashes.length === 0) {
    proof.append(
      element("strong", "", mode === "buyback" ? "尚未关联" : "无关联买入"),
      element("small", "", mode === "buyback" ? "可能仍待销毁" : "直接手续费或未归因"),
    );
  } else {
    const first = event.linkedTxHashes[0];
    const link = element("a", "", `${event.linkedTxHashes.length} 笔 · ${compactHex(first)}`);
    link.href = `https://rh-scan.com/tx/${first}`;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.title = event.linkedTxHashes.join("\n");
    proof.append(
      link,
      element("small", "", mode === "buyback" ? "关联死亡地址转账" : "FIFO 关联市场买入"),
    );
  }
  cell.append(proof);
  return cell;
}

function pairFlowTransactionCell(event) {
  const cell = element("td");
  const link = element("a", "flow-tx-link", compactHex(event.txHash, 5, 4));
  const external = safeExternalUrl(event.explorerUrl);
  if (external) {
    link.href = external;
    link.target = "_blank";
    link.rel = "noreferrer";
  }
  link.title = `${event.txHash}\n状态：${event.transactionStatus}\n${event.note}`;
  cell.append(link);
  return cell;
}

function pairFlowBuybackRow(event) {
  const row = element("tr");
  row.title = event.note;
  const input = event.inputAssets.length
    ? event.inputAssets.map((asset) => formatTokenAmount(asset.amount, asset.symbol)).join(" + ")
    : "资金路径未还原";
  row.append(
    pairFlowIdentityCell(event),
    pairFlowValueCell(input, event.inputAssets.length ? "交易发起投入" : "保持未知"),
    pairFlowValueCell(formatTokenAmount(event.pairAmount, "PAIR"), "实际流入"),
    pairFlowValueCell(
      event.usdValue === null ? "—" : formatUsd(event.usdValue, false),
      pairFlowValuationLabel(event),
    ),
    pairFlowProofCell(event, "buyback"),
    pairFlowTransactionCell(event),
  );
  return row;
}

function pairFlowBurnAllocationText(event) {
  if (!event.allocations.length) return "未归因";
  const labels = { direct_fee: "直接费", market_acquired: "回购", unattributed: "未知" };
  return event.allocations
    .map(
      (allocation) => `${labels[allocation.category]} ${formatTokenAmount(allocation.pairAmount)}`,
    )
    .join(" + ");
}

function pairFlowBurnRow(event) {
  const row = element("tr");
  row.title = event.note;
  row.append(
    pairFlowIdentityCell(event),
    pairFlowValueCell(formatTokenAmount(event.pairAmount, "PAIR"), "已进入 0x…dEaD"),
    pairFlowValueCell(pairFlowCategoryLabel(event), pairFlowBurnAllocationText(event)),
    pairFlowValueCell(
      event.usdValue === null ? "—" : formatUsd(event.usdValue, false),
      pairFlowValuationLabel(event),
    ),
    pairFlowProofCell(event, "burn"),
    pairFlowTransactionCell(event),
  );
  return row;
}

function renderPairFlowEvents() {
  const response = state.pairEvents;
  const buybackBody = $("#pair-flow-buyback-body");
  const burnBody = $("#pair-flow-burn-body");
  buybackBody.replaceChildren();
  burnBody.replaceChildren();
  if (!response) {
    $("#pair-flow-buyback-count").textContent = "—";
    $("#pair-flow-burn-count").textContent = "—";
    $("#pair-flow-events-coverage").textContent = "等待数据";
    return;
  }
  const buybacks = response.items.filter((event) => event.type === "buyback");
  const burns = response.items.filter((event) => event.type === "burn");
  buybackBody.append(...buybacks.map(pairFlowBuybackRow));
  burnBody.append(...burns.map(pairFlowBurnRow));
  $("#pair-flow-buyback-empty").hidden = buybacks.length > 0;
  $("#pair-flow-burn-empty").hidden = burns.length > 0;
  $("#pair-flow-buyback-count").textContent = formatCount(response.counts.buyback);
  $("#pair-flow-burn-count").textContent = formatCount(response.counts.burn);
  $("#pair-flow-history-start").textContent = response.historyStartAt?.slice(0, 10) ?? "—";
  $("#pair-flow-events-coverage").textContent = response.complete ? "完整分页" : "部分覆盖";
  const shown = response.items.length;
  $("#pair-flow-events-note").textContent =
    `已加载 ${formatCount(shown)}/${formatCount(response.counts.matched)} 笔 · ` +
    "交易哈希来自 RH-scan；批次来源按 FIFO 重建，索引价估值不等于成交结算。";
  $("#pair-flow-load-more").hidden = shown >= response.counts.matched;
}

function pairV2Score(value, color) {
  const host = element("div", "pair-v2-score");
  host.append(element("strong", "", Number.isFinite(value) ? value.toFixed(1) : "—"));
  const track = element("i");
  track.style.setProperty("--score", Number.isFinite(value) ? String(Math.max(0, value)) : "0");
  track.style.setProperty("--score-color", color);
  host.append(track);
  return host;
}

function pairV2Alpha(token) {
  const legacy = token.alpha ?? {};
  const legacyHeat = Number.isFinite(legacy.heatScore) ? legacy.heatScore : 0;
  return {
    quality: legacy.quality ?? {
      score: null,
      state: "unknown",
      reasons: [],
      missing: legacy.missing ?? [],
    },
    signal: legacy.signal ?? {
      score: legacy.confirmationScore ?? null,
      state: legacy.stage ?? "watch",
      researchEligible: ["emerging", "confirmed"].includes(legacy.stage),
      reasons: legacy.reasons ?? [],
      missing: legacy.missing ?? [],
    },
    heat: legacy.heat ?? {
      score: legacyHeat,
      state: legacyHeat >= 80 ? "overheated" : legacyHeat >= 60 ? "hot" : "normal",
      reasons: [],
    },
    riskProfile: legacy.riskProfile ?? {
      platform: "high",
      token: legacy.risk ?? "high",
      tradeReady: false,
      platformReasons: [],
      tokenReasons: legacy.risks ?? [],
    },
    evidence: legacy.evidence ?? {
      confidence: legacy.confidence ?? "low",
      completenessPercent: legacy.confidenceScore ?? 0,
      available: [],
      missing: legacy.missing ?? [],
    },
    metrics: legacy.metrics ?? {},
    attentionScore: Number.isFinite(legacy.discoveryScore) ? legacy.discoveryScore : null,
    reasons: legacy.reasons ?? [],
    risks: legacy.risks ?? [],
    missing: legacy.missing ?? [],
  };
}

function pairV2Badge(kind, state, label) {
  return element("span", `pair-v2-badge pair-v2-badge--${kind}-${state}`, label);
}

function pairV2Age(value) {
  if (!value) return "上线时间未知";
  const launched = Date.parse(value);
  const observed = Date.parse(state.pairV2?.observedAt ?? "");
  if (!Number.isFinite(launched) || !Number.isFinite(observed) || observed < launched) {
    return "上线时间未知";
  }
  const minutes = Math.floor((observed - launched) / 60_000);
  if (minutes < 60) return `上线 ${String(Math.max(1, minutes))}m`;
  if (minutes < 1_440) return `上线 ${(minutes / 60).toFixed(minutes < 600 ? 1 : 0)}h`;
  return `上线 ${(minutes / 1_440).toFixed(minutes < 14_400 ? 1 : 0)}d`;
}

function pairV2Flow(buys, sells) {
  if (!Number.isFinite(buys) && !Number.isFinite(sells)) return "—";
  return `B ${formatCount(buys ?? 0)} / S ${formatCount(sells ?? 0)}`;
}

function pairV2ObservedSum(tokens, read) {
  const values = tokens.map(read).filter(Number.isFinite);
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) : null;
}

function pairQuoteAssets(value) {
  const direct = Array.isArray(value?.quoteAssets) ? value.quoteAssets : [];
  const pools = Array.isArray(value?.pools) ? value.pools : [];
  const canonicalPools = pools.filter((pool) => pool?.canonical !== false);
  const poolAssets = (canonicalPools.length > 0 ? canonicalPools : pools).map(
    (pool) => pool?.quote,
  );
  const source = direct.length > 0 ? direct : poolAssets;
  const byAddress = new Map();
  for (const asset of source) {
    if (!asset || typeof asset.address !== "string") continue;
    const address = asset.address.toLowerCase();
    if (byAddress.has(address)) continue;
    byAddress.set(address, {
      address,
      symbol:
        typeof asset.symbol === "string" && asset.symbol.trim()
          ? asset.symbol.trim()
          : compactHex(address, 4, 4),
    });
  }
  return [...byAddress.values()];
}

function pairQuoteAssetLabel(value) {
  const assets = pairQuoteAssets(value);
  return assets.length > 0
    ? `配对资产 · ${assets.map((asset) => asset.symbol).join(" + ")}`
    : "配对资产 · 未索引";
}

function pairQuoteAssetTitle(value) {
  const assets = pairQuoteAssets(value);
  return assets.length > 0
    ? assets.map((asset) => `${asset.symbol} · ${asset.address}`).join("\n")
    : "PAIR 官方接口当前未返回可核验的配对资产";
}

function pairV2TokenLink(token) {
  const link = element("a", "pair-v2-token");
  link.href = `https://pair.fund/tokens/${encodeURIComponent(token.address)}`;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.title = `${token.name}\n${token.address}\n${pairQuoteAssetTitle(token)}`;
  link.append(
    element("strong", "", token.symbol),
    element(
      "small",
      "",
      `${compactHex(token.address, 5, 4)} · ${formatCount(token.holderCount)} holders`,
    ),
    element("small", "pair-token-quote", pairQuoteAssetLabel(token)),
  );
  return link;
}

function pairV2BucketText(buckets) {
  if (!Array.isArray(buckets) || buckets.length === 0) return "—";
  const totals = new Map();
  for (const bucket of buckets) {
    const key = bucket.assetSymbol || compactHex(bucket.asset, 4, 4);
    totals.set(key, (totals.get(key) ?? 0) + (Number.isFinite(bucket.amount) ? bucket.amount : 0));
  }
  return [...totals.entries()]
    .map(([symbol, amount]) => formatTokenAmount(amount, symbol))
    .join(" + ");
}

function renderPairV2TokenRow(token) {
  const alpha = pairV2Alpha(token);
  const row = element("tr");
  row.dataset.v2Signal = alpha.signal.state;
  row.title = [
    ...alpha.quality.reasons,
    ...alpha.signal.reasons,
    ...alpha.heat.reasons,
    ...alpha.riskProfile.tokenReasons,
  ].join("\n");
  const identity = element("td");
  identity.append(pairV2TokenLink(token));

  const mode = element("td");
  const modeStack = element("div", "pair-v2-stack");
  modeStack.append(
    pairV2Badge("mode", String(token.modeId ?? "unknown"), token.modeLabel),
    element("small", "", pairV2Age(token.launchedAt)),
  );
  mode.append(modeStack);

  const valuation = element("td");
  const valuationStack = element("div", "pair-v2-stack");
  valuationStack.append(
    element("strong", "", formatTokenPrice(token.priceUsd)),
    element(
      "small",
      "",
      `${formatUsd(token.marketCapUsd)} · 15m ${formatSignedPercent(alpha.metrics.marketCapChange15mPct)}`,
    ),
  );
  valuation.append(valuationStack);

  const volume = element("td");
  const volumeStack = element("div", "pair-v2-stack");
  volumeStack.append(
    element("strong", "", formatUsd(alpha.metrics.volume5mUsd)),
    element("small", "", `1H ${formatUsd(alpha.metrics.volume1hUsd)}`),
  );
  volume.append(volumeStack);

  const flow = element("td");
  const flowStack = element("div", "pair-v2-stack pair-v2-flow-stack");
  flowStack.append(
    element("strong", "", pairV2Flow(alpha.metrics.buys5m, alpha.metrics.sells5m)),
    element("small", "", `1H ${pairV2Flow(alpha.metrics.buys1h, alpha.metrics.sells1h)}`),
  );
  flow.append(flowStack);

  const quality = element("td");
  const qualityStack = element("div", "pair-v2-stack");
  qualityStack.append(
    pairV2Score(alpha.quality.score, "var(--acid)"),
    pairV2Badge(
      "quality",
      alpha.quality.state,
      PAIR_V2_QUALITY_LABELS[alpha.quality.state] ?? alpha.quality.state,
    ),
  );
  quality.append(qualityStack);

  const signal = element("td");
  const signalStack = element("div", "pair-v2-stack");
  signalStack.append(
    pairV2Score(alpha.signal.score, "var(--cyan)"),
    pairV2Badge(
      "signal",
      alpha.signal.state,
      PAIR_V2_STAGE_LABELS[alpha.signal.state] ?? alpha.signal.state,
    ),
    element(
      "small",
      "",
      `关注 ${Number.isFinite(alpha.attentionScore) ? alpha.attentionScore.toFixed(0) : "—"}`,
    ),
  );
  signal.append(signalStack);

  const heat = element("td");
  const heatStack = element("div", "pair-v2-stack");
  heatStack.append(
    pairV2Score(alpha.heat.score, "var(--amber)"),
    pairV2Badge(
      "heat",
      alpha.heat.state,
      PAIR_V2_HEAT_LABELS[alpha.heat.state] ?? alpha.heat.state,
    ),
  );
  heat.append(heatStack);

  const risk = element("td");
  const riskStack = element("div", "pair-v2-stack");
  riskStack.append(
    pairV2Badge(
      "risk",
      alpha.riskProfile.token,
      `${PAIR_V2_RISK_LABELS[alpha.riskProfile.token] ?? alpha.riskProfile.token}风险`,
    ),
    pairV2Badge(
      "evidence",
      alpha.evidence.confidence,
      `${formatCount(alpha.evidence.completenessPercent)}% 证据`,
    ),
  );
  risk.append(riskStack);

  const missing = element("td", "pair-v2-missing");
  const missingItems = [...new Set([...alpha.quality.missing, ...alpha.signal.missing])];
  missing.textContent =
    missingItems.length > 0 ? missingItems.slice(0, 2).join(" / ") : "关键证据已齐";
  missing.title = missingItems.join("\n");

  row.append(identity, mode, valuation, volume, flow, quality, signal, heat, risk, missing);
  return row;
}

function pairV2MatchesLens(token) {
  const alpha = pairV2Alpha(token);
  if (state.pairV2Lens === "qualified") return alpha.quality.state === "qualified";
  if (state.pairV2Lens === "research") return alpha.signal.researchEligible;
  if (state.pairV2Lens === "overheated") return alpha.heat.state === "overheated";
  if (state.pairV2Lens === "unknown") {
    return alpha.quality.state === "unknown" || alpha.evidence.confidence === "low";
  }
  return true;
}

function renderPairV2Tokens() {
  const body = $("#pair-v2-token-body");
  body.replaceChildren();
  const tokens = (state.pairV2?.tokens ?? []).filter(
    (token) =>
      token.canonical &&
      (state.pairV2Mode === "all" || String(token.modeId) === state.pairV2Mode) &&
      pairV2MatchesLens(token),
  );
  const shown = tokens.slice(0, state.pairV2RowLimit);
  body.append(...shown.map(renderPairV2TokenRow));
  $("#pair-v2-token-empty").hidden = tokens.length > 0;
  $("#pair-v2-token-footer").hidden = tokens.length === 0;
  $("#pair-v2-token-count").textContent =
    `已显示 ${formatCount(shown.length)} / ${formatCount(tokens.length)} 个候选`;
  $("#pair-v2-load-more").hidden = shown.length >= tokens.length;
}

function pairTeamTokenLink(item) {
  const link = element("a", "pair-dev-token");
  link.href = `https://pair.fund/tokens/${encodeURIComponent(item.address)}`;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.title = `${item.name ?? item.symbol ?? "PAIR token"}\n${item.address}\n${pairQuoteAssetTitle(item)}`;
  const identity = element("span");
  identity.append(
    element("strong", "", item.symbol ?? compactHex(item.address, 6, 4)),
    item.modeLabel ? element("i", "", item.modeLabel) : element("i", "", "模式待确认"),
  );
  link.append(
    identity,
    element("small", "", `${item.name ?? "名称待索引"} · ${compactHex(item.address, 6, 4)}`),
    element("small", "pair-token-quote", pairQuoteAssetLabel(item)),
  );
  return link;
}

function pairTeamIssuerLink(item) {
  const link = element("a", "pair-dev-creator");
  link.href = `https://rh-scan.com/address/${encodeURIComponent(item.issuer)}`;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.title = `${item.issuerLabel}\n${item.issuer}`;
  link.append(
    element("strong", "", compactHex(item.issuer, 7, 5)),
    element("small", "", item.issuerLabel),
  );
  return link;
}

function renderPairTeamLaunchRow(item) {
  const row = element("tr");
  row.dataset.teamRelationship = item.relationship;

  const token = element("td");
  token.append(pairTeamTokenLink(item));

  const relationship = element("td");
  const relationshipStack = element("div", "pair-v2-stack pair-team-relationship");
  relationshipStack.append(
    element(
      "span",
      `pair-team-relation pair-team-relation--${item.officiallyConfirmed ? "official" : "issuer"}`,
      item.relationshipLabel,
    ),
    element(
      "small",
      "",
      item.officiallyConfirmed
        ? "官网、官方 API 与链上发行交易一致"
        : "发送钱包一致，尚未见独立官方公告",
    ),
  );
  relationship.append(relationshipStack);

  const issuer = element("td");
  issuer.append(pairTeamIssuerLink(item));

  const valuation = element("td");
  const valuationStack = element("div", "pair-v2-stack");
  valuationStack.append(
    element("strong", "", formatTokenPrice(item.priceUsd)),
    element("small", "", `市值 ${formatUsd(item.marketCapUsd)}`),
  );
  valuation.append(valuationStack);

  const launched = element("td");
  if (item.blockNumber !== null) {
    const launchedLink = element("a", "pair-dev-chain-link");
    launchedLink.href = `https://rh-scan.com/block/${encodeURIComponent(String(item.blockNumber))}`;
    launchedLink.target = "_blank";
    launchedLink.rel = "noreferrer";
    launchedLink.append(
      element("strong", "", formatDateTime(item.launchedAt)),
      element("small", "", `#${formatCount(item.blockNumber)}`),
    );
    launched.append(launchedLink);
  } else {
    launched.append(element("span", "", formatDateTime(item.launchedAt)));
  }

  const transaction = element("td");
  const transactionLink = element("a", "pair-dev-tx-link", compactHex(item.transactionHash, 6, 5));
  transactionLink.href = `https://rh-scan.com/tx/${encodeURIComponent(item.transactionHash)}`;
  transactionLink.target = "_blank";
  transactionLink.rel = "noreferrer";
  transactionLink.title = item.transactionHash;
  transaction.append(transactionLink);

  row.append(
    token,
    relationship,
    issuer,
    valuation,
    element("td", "", formatUsd(item.liquidityUsd)),
    element("td", "pair-dev-volume", formatUsd(item.volume24hUsd)),
    element("td", "", formatCount(item.holderCount)),
    launched,
    transaction,
  );
  return row;
}

function renderPairTeamLaunches() {
  const body = $("#pair-team-launch-body");
  if (!body) return;
  body.replaceChildren();
  const response = state.pairTeamLaunches;
  const items = response?.items ?? [];
  body.append(...items.map(renderPairTeamLaunchRow));

  const issuer = response?.issuer;
  const issuerLink = $("#pair-team-issuer");
  if (issuer && issuerLink) {
    issuerLink.href = `https://rh-scan.com/address/${encodeURIComponent(issuer.address)}`;
    issuerLink.textContent = compactHex(issuer.address, 6, 4);
    issuerLink.title = issuer.evidence.map((evidence) => evidence.note).join("\n");
  }
  $("#pair-team-count-all").textContent = formatCount(response?.total);
  $("#pair-team-count-official").textContent = formatCount(
    response?.counts?.officialProtocolTokens,
  );
  $("#pair-team-count-related").textContent = formatCount(
    response?.counts?.verifiedIssuerWalletLaunches,
  );
  $("#pair-team-observed").textContent = response
    ? `已确认 · ${formatDateTime(response.observedAt ?? response.generatedAt)}`
    : "项目方发币接口暂不可用";
  $("#pair-team-launch-empty").hidden = items.length > 0;
  $("#pair-team-launch-footer").hidden = !response || response.total === 0;
  $("#pair-team-launch-count").textContent = response
    ? `已显示 ${formatCount(items.length)} / ${formatCount(response.total)} 枚 · 只统计已核验项目方钱包`
    : "—";
  $("#pair-team-load-more").hidden =
    !response || items.length >= response.total || state.pairTeamRowLimit >= 500;
}

function pairV2EventAmount(event) {
  if (event.type === "buyback_executed") {
    return `${formatTokenAmount(event.amount, event.assetSymbol ?? "")} → ${formatTokenAmount(event.secondaryAmount, "项目币")}`;
  }
  if (["fee_collected", "holder_claim"].includes(event.type)) {
    return formatTokenAmount(event.amount, event.assetSymbol ?? "");
  }
  return "—";
}

function renderPairV2Events() {
  const body = $("#pair-v2-event-body");
  body.replaceChildren();
  const events = (state.pairV2?.events ?? [])
    .filter((event) => state.pairV2Event === "all" || event.type === state.pairV2Event)
    .slice(0, 30);
  for (const event of events) {
    const row = element("tr");
    const project = element("td", "", event.project ? compactHex(event.project, 5, 4) : "系统");
    project.title = event.project ?? "协议级事件";
    const chain = element("td");
    const link = element(
      "a",
      "pair-v2-event-link",
      `${formatCount(event.blockNumber)} · ${compactHex(event.transactionHash, 4, 4)}`,
    );
    link.href = `https://rh-scan.com/tx/${encodeURIComponent(event.transactionHash)}`;
    link.target = "_blank";
    link.rel = "noreferrer";
    chain.append(link);
    row.append(
      element("td", "", formatDateTime(event.timestamp)),
      element("td", "pair-v2-event-kind", PAIR_V2_EVENT_LABELS[event.type] ?? event.type),
      project,
      element("td", "", pairV2EventAmount(event)),
      chain,
    );
    body.append(row);
  }
  $("#pair-v2-event-empty").hidden = events.length > 0;
}

function renderPairV2Sources() {
  const host = $("#pair-v2-source-list");
  host.replaceChildren();
  for (const source of state.pairV2?.sources ?? []) {
    const row = element("article", "pair-v2-source-item");
    const top = element("div");
    top.append(
      element("strong", "", source.label),
      element("b", source.status === "ok" ? "" : `is-${source.status}`, source.status),
    );
    row.append(
      top,
      element("small", "", `${source.message} · ${formatDateTime(source.fetchedAt)}`),
    );
    host.append(row);
  }
}

function renderPairV2Funnel() {
  const tokens = (state.pairV2?.tokens ?? []).filter((token) => token.canonical);
  const counts = {
    all: tokens.length,
    qualified: tokens.filter((token) => pairV2Alpha(token).quality.state === "qualified").length,
    research: tokens.filter((token) => pairV2Alpha(token).signal.researchEligible).length,
    overheated: tokens.filter((token) => pairV2Alpha(token).heat.state === "overheated").length,
    unknown: tokens.filter((token) => {
      const alpha = pairV2Alpha(token);
      return alpha.quality.state === "unknown" || alpha.evidence.confidence === "low";
    }).length,
  };
  for (const [key, value] of Object.entries(counts)) {
    const target = $(`#pair-v2-funnel-${key}`);
    if (target) target.textContent = formatCount(value);
  }
  $$("[data-v2-lens]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.v2Lens === state.pairV2Lens);
  });
  return counts;
}

function renderPairV2Model() {
  const model = state.pairV2?.alphaModel;
  const stateNode = $("#pair-v2-model-state");
  const status = model?.validated ? "VALIDATED" : "SHADOW";
  stateNode.textContent = status;
  stateNode.dataset.status = status.toLowerCase();
  $("#pair-v2-model-version").textContent = model?.version ?? "等待新模型快照";
  $("#pair-v2-model-days").textContent = model ? `${model.observationDays.toFixed(1)}d` : "0d";
  $("#pair-v2-model-signals").textContent = formatCount(model?.firstSignalCount ?? 0);
  $("#pair-v2-model-matured").textContent = formatCount(model?.matured24hCount ?? 0);

  const dayProgress = model?.graduation?.dayProgressPercent ?? 0;
  const sampleProgress = model?.graduation?.sampleProgressPercent ?? 0;
  $("#pair-v2-model-day-label").textContent = model
    ? `${model.observationDays.toFixed(1)} / ${formatCount(model.graduation.minimumDays)} 天`
    : "0 / 14 天";
  $("#pair-v2-model-sample-label").textContent = model
    ? `${formatCount(model.matured24hCount)} / ${formatCount(model.graduation.minimumMaturedProjects)} 个`
    : "0 / 50 个";
  $("#pair-v2-model-day-progress").style.width = `${Math.max(0, Math.min(100, dayProgress))}%`;
  $("#pair-v2-model-sample-progress").style.width =
    `${Math.max(0, Math.min(100, sampleProgress))}%`;

  const host = $("#pair-v2-horizons");
  host.replaceChildren();
  const horizonLabels = {
    "5m": "5 分钟",
    "30m": "30 分钟",
    "2h": "2 小时",
    "6h": "6 小时",
    "24h": "24 小时",
  };
  const horizons =
    model?.horizons ??
    ["5m", "30m", "2h", "6h", "24h"].map((horizon) => ({
      horizon,
      observedCount: 0,
      medianFeeAdjustedReturnPct: null,
      positiveRatePercent: null,
      loss20RatePercent: null,
    }));
  for (const horizon of horizons) {
    const card = element("article", "pair-v2-horizon");
    const top = element("header");
    top.append(
      element("strong", "", horizonLabels[horizon.horizon] ?? horizon.horizon),
      element("small", "", `N=${formatCount(horizon.observedCount)}`),
    );
    const value = element(
      "b",
      Number.isFinite(horizon.medianFeeAdjustedReturnPct)
        ? horizon.medianFeeAdjustedReturnPct >= 0
          ? "is-positive"
          : "is-negative"
        : "",
      formatSignedPercent(horizon.medianFeeAdjustedReturnPct),
    );
    card.append(
      top,
      value,
      element("span", "", "扣费后中位收益"),
      element(
        "footer",
        "",
        `正收益 ${formatPercent(horizon.positiveRatePercent)} · 跌超 20% ${formatPercent(horizon.loss20RatePercent)}`,
      ),
    );
    host.append(card);
  }
}

function renderPairV2() {
  const payload = state.pairV2;
  if (!payload) return;
  $("#pair-v2-release").textContent = compactHex(payload.release.releaseId, 8, 6);
  $("#pair-v2-release").title = payload.release.releaseId;
  $("#pair-v2-block").textContent = formatCount(payload.overview.latestBlock);
  $("#pair-v2-coverage").textContent =
    `${formatPercent(payload.overview.marketCoveragePercent)} · ${formatCount(payload.overview.currentReleaseIndexedCount)}/${formatCount(payload.overview.currentReleaseLaunchCount)}`;
  $("#pair-v2-market-poll").textContent =
    `${formatCount(payload.monitoring?.marketPollSeconds ?? 60)}s`;
  $("#pair-v2-observed").textContent = formatDateTime(payload.observedAt);
  const visible = payload.tokens.filter(
    (token) => token.canonical && !token.hidden && !token.flagged,
  );
  const volume5m = pairV2ObservedSum(visible, (token) => pairV2Alpha(token).metrics.volume5mUsd);
  const volume1h = pairV2ObservedSum(visible, (token) => pairV2Alpha(token).metrics.volume1hUsd);
  const volume24h =
    payload.overview.officialPoolVolume24hUsd ??
    pairV2ObservedSum(visible, (token) => token.shortWindow?.volume24hUsd ?? null);
  const buys1h = pairV2ObservedSum(visible, (token) => pairV2Alpha(token).metrics.buys1h);
  const sells1h = pairV2ObservedSum(visible, (token) => pairV2Alpha(token).metrics.sells1h);
  $("#pair-v2-volume-5m").textContent = formatUsd(
    payload.overview.officialPoolVolume5mUsd ?? volume5m,
  );
  $("#pair-v2-volume-1h").textContent = formatUsd(
    payload.overview.officialPoolVolume1hUsd ?? volume1h,
  );
  $("#pair-v2-flow-1h").textContent = pairV2Flow(buys1h, sells1h);
  $("#pair-v2-volume").textContent = formatUsd(volume24h);
  const officialPoolTokenCount =
    payload.overview.officialPoolTokenCount ?? visible.filter((token) => token.shortWindow).length;
  $("#pair-v2-market-count").textContent =
    `${formatCount(officialPoolTokenCount)}/${formatCount(payload.overview.currentReleaseLaunchCount)} 枚匹配 · DexScreener 同口径`;
  $("#pair-v2-liquidity").textContent = formatUsd(
    payload.overview.officialPoolLiquidityUsd ??
      pairV2ObservedSum(
        visible.filter((token) => token.shortWindow),
        (token) => token.liquidityUsd,
      ),
  );
  const funnel = renderPairV2Funnel();
  $("#pair-v2-qualified-rate").textContent = formatPercent(
    funnel.all > 0 ? (funnel.qualified / funnel.all) * 100 : null,
  );
  const riskCount = visible.filter((token) => {
    const alpha = pairV2Alpha(token);
    return (
      ["high", "critical"].includes(alpha.riskProfile.token) || alpha.evidence.confidence === "low"
    );
  }).length;
  $("#pair-v2-risk-count").textContent =
    `${formatCount(riskCount)} / ${formatCount(visible.length)}`;
  $("#pair-v2-buyback-budget").textContent = formatUsd(payload.overview.buybackBudget24hUsd);
  $("#pair-v2-buyback-count").textContent = formatCount(payload.overview.buybackExecutedCount);
  $("#pair-v2-claim-count").textContent = formatCount(payload.overview.holderClaimCount);
  const buckets = payload.tokens.flatMap((token) =>
    token.canonical ? token.buyback.pendingBuckets : [],
  );
  const bucketText = pairV2BucketText(buckets);
  const bucketAssets = new Set(buckets.map((bucket) => bucket.asset));
  $("#pair-v2-pending-buckets").textContent =
    bucketAssets.size <= 1 ? bucketText : `${formatCount(bucketAssets.size)} 种资产`;
  $("#pair-v2-pending-assets").textContent =
    bucketText === "—" ? "未观测到非零 bucket" : bucketText;

  $("#pair-v2-mode-all").textContent = formatCount(payload.overview.currentReleaseLaunchCount);
  for (const mode of payload.modeCounts) {
    const target = $(`#pair-v2-mode-${String(mode.modeId)}`);
    if (target) target.textContent = formatCount(mode.count);
  }
  const alert = payload.alerts;
  $("#pair-v2-alert-state").textContent = alert.configured ? "服务端已启用" : "未配置";
  $("#pair-v2-alert-detail").textContent = alert.configured
    ? `待发送 ${formatCount(alert.pending)} · 失败 ${formatCount(alert.failed)} · 最近 ${formatDateTime(alert.lastSentAt)}`
    : "设置服务端 PAIR_V2_FEISHU_WEBHOOK_URL 后启用";
  const devMonitor = state.devMonitor;
  $("#dev-monitor-state").textContent = devMonitor?.enabled
    ? `${formatCount(devMonitor.counts.watched)} 个重点地址`
    : "未启用";
  $("#dev-monitor-detail").textContent = devMonitor?.enabled
    ? `已发现 ${formatCount(devMonitor.counts.projects)} 个项目 / ${formatCount(devMonitor.counts.candidates)} 个候选 DEV · 飞书${devMonitor.alerts.configured ? "已配置" : "未配置"} · 确认区块 ${formatCount(devMonitor.latestConfirmedBlock)}`
    : "服务端 DEV_MONITOR_ENABLED 尚未开启";
  $("#header-date").textContent = payload.observedAt.slice(0, 10);
  renderPairV2Model();
  renderPairTeamLaunches();
  renderPairV2Tokens();
  renderPairV2Events();
  renderPairV2Sources();
  renderRunState();
  const operationalWarnings = [];
  if (payload.stale) operationalWarnings.push("PAIR V2 监控数据已超过预期更新时间。");
  if (payload.sources.some((source) => source.status === "failed")) {
    operationalWarnings.push("PAIR V2 有采集来源不可用，缺失值保持未知。");
  }
  showNotices(operationalWarnings);
}

function pairAlphaActionState(token) {
  return token.alpha?.action?.state ?? "evidence_wait";
}

function pairAlphaMatches(token) {
  const action = pairAlphaActionState(token);
  const laneMatches =
    state.pairAlphaLane === "all" ||
    action === state.pairAlphaLane ||
    (state.pairAlphaLane === "research" && ["probe_eligible", "confirmed"].includes(action));
  const generationMatches =
    state.pairAlphaGeneration === "all" || token.identity?.generation === state.pairAlphaGeneration;
  const query = state.pairAlphaSearch.trim().toLowerCase();
  const searchMatches =
    !query ||
    token.symbol?.toLowerCase().includes(query) ||
    token.name?.toLowerCase().includes(query) ||
    token.address?.toLowerCase().includes(query);
  return laneMatches && generationMatches && searchMatches;
}

function pairAlphaActionBadge(token) {
  const action = pairAlphaActionState(token);
  return element(
    "span",
    `pair-alpha-action pair-alpha-action--${action}`,
    token.alpha?.action?.label ?? PAIR_ALPHA_ACTION_LABELS[action] ?? action,
  );
}

function pairAlphaTokenRow(token) {
  const row = element("tr");
  const action = pairAlphaActionState(token);
  row.dataset.alphaAction = action;
  row.title = [
    ...(token.alpha?.action?.reasons ?? []),
    ...(token.alpha?.riskProfile?.tokenReasons ?? []),
  ].join("\n");

  const identity = element("td");
  const link = pairV2TokenLink(token);
  const generation = element(
    "span",
    `pair-alpha-generation pair-alpha-generation--${token.identity?.generation ?? "unknown"}`,
    (token.identity?.generation ?? "unknown").toUpperCase(),
  );
  link.prepend(generation);
  identity.append(link);

  const actionCell = element("td");
  const actionStack = element("div", "pair-alpha-cell-stack");
  actionStack.append(
    pairAlphaActionBadge(token),
    element(
      "small",
      "",
      `关注 ${Number.isFinite(token.alpha?.discoveryScore) ? token.alpha.discoveryScore.toFixed(0) : "—"}`,
    ),
  );
  actionCell.append(actionStack);

  const valuation = element("td");
  const valuationStack = element("div", "pair-alpha-cell-stack");
  valuationStack.append(
    element("strong", "", formatTokenPrice(token.priceUsd)),
    element("small", "", formatUsd(token.marketCapUsd)),
  );
  valuation.append(valuationStack);

  const shortVolume = element("td");
  const shortVolumeStack = element("div", "pair-alpha-cell-stack");
  shortVolumeStack.append(
    element("strong", "", formatUsd(token.shortWindow?.volume5mUsd)),
    element("small", "", `1H ${formatUsd(token.shortWindow?.volume1hUsd)}`),
  );
  shortVolume.append(shortVolumeStack);

  const momentum = element("td");
  const momentumStack = element("div", "pair-alpha-cell-stack");
  momentumStack.append(
    element(
      "strong",
      (token.shortWindow?.priceChange1hPct ?? 0) >= 0 ? "is-positive" : "is-negative",
      formatSignedPercent(token.shortWindow?.priceChange1hPct),
    ),
    element("small", "", `6H ${formatSignedPercent(token.shortWindow?.priceChange6hPct)}`),
  );
  momentum.append(momentumStack);

  const volumeEvidence = element("td");
  const volumeEvidenceStack = element("div", "pair-alpha-cell-stack");
  volumeEvidenceStack.append(
    element("strong", "", formatUsd(token.volumeEvidence?.official24hUsd)),
    element("small", "", `池毛额 ${formatUsd(token.volumeEvidence?.canonicalGross24hUsd)}`),
  );
  volumeEvidence.append(volumeEvidenceStack);

  const liquidity = element("td");
  const liquidityStack = element("div", "pair-alpha-cell-stack");
  liquidityStack.append(
    element("strong", "", formatUsd(token.liquidityUsd)),
    element("small", "", `跨池 ${formatPercent(token.shortWindow?.crossPoolSpreadPct)}`),
  );
  liquidity.append(liquidityStack);

  const evidence = element("td");
  const evidenceStack = element("div", "pair-alpha-cell-stack");
  evidenceStack.append(
    pairV2Score(token.alpha?.quality?.score, "var(--acid)"),
    element(
      "small",
      "",
      `${formatCount(token.alpha?.evidence?.completenessPercent)}% · ${token.identity?.evidence === "current_release_event" ? "链上发行" : "官方目录"}`,
    ),
  );
  evidence.append(evidenceStack);

  const lifecycle = element("td");
  const lifecycleStack = element("div", "pair-alpha-cell-stack");
  lifecycleStack.append(
    element(
      "strong",
      "",
      token.lifecycle?.firstIgnitionAt ? formatDateTime(token.lifecycle.firstIgnitionAt) : "未点火",
    ),
    element("small", "", `首见 ${formatDateTime(token.lifecycle?.firstObservedAt)}`),
  );
  lifecycle.append(lifecycleStack);

  row.append(
    identity,
    actionCell,
    valuation,
    shortVolume,
    momentum,
    volumeEvidence,
    liquidity,
    evidence,
    lifecycle,
  );
  return row;
}

function renderPairAlphaTokens() {
  const body = $("#pair-alpha-token-body");
  const tokens = (state.pairAlpha?.tokens ?? []).filter(pairAlphaMatches);
  const shown = tokens.slice(0, state.pairAlphaRowLimit);
  body.replaceChildren(...shown.map(pairAlphaTokenRow));
  $("#pair-alpha-empty").hidden = tokens.length > 0;
  $("#pair-alpha-table-footer").hidden = tokens.length === 0;
  $("#pair-alpha-token-count").textContent =
    `已显示 ${formatCount(shown.length)} / ${formatCount(tokens.length)} 个候选`;
  $("#pair-alpha-load-more").hidden = shown.length >= tokens.length;
}

function pairAlphaAnomalyScore(token) {
  const volume = Math.max(0, token.shortWindow?.volume5mUsd ?? 0);
  const change = Math.abs(token.shortWindow?.priceChange1hPct ?? 0);
  return Math.log10(volume + 1) * 20 + Math.min(change, 500);
}

function renderPairAlphaLeader() {
  const candidates = (state.pairAlpha?.tokens ?? []).filter((token) => token.shortWindow);
  const leader = [...candidates].sort(
    (left, right) => pairAlphaAnomalyScore(right) - pairAlphaAnomalyScore(left),
  )[0];
  const host = $("#pair-alpha-leader");
  host.dataset.action = leader ? pairAlphaActionState(leader) : "none";
  $("#pair-alpha-leader-symbol").textContent = leader?.symbol ?? "—";
  $("#pair-alpha-leader-address").textContent = leader
    ? `${leader.identity?.generation?.toUpperCase() ?? "?"} · ${compactHex(leader.address, 7, 5)}`
    : "等待短周期行情";
  $("#pair-alpha-leader-action").textContent = leader
    ? (leader.alpha?.action?.label ?? PAIR_ALPHA_ACTION_LABELS[pairAlphaActionState(leader)])
    : "—";
  $("#pair-alpha-leader-volume").textContent = formatUsd(leader?.shortWindow?.volume5mUsd);
  $("#pair-alpha-leader-change").textContent = formatSignedPercent(
    leader?.shortWindow?.priceChange1hPct,
  );
}

function renderPairAlphaReplay() {
  const model = state.pairAlpha?.alphaModel;
  $("#pair-alpha-model-version").textContent = model?.version ?? "—";
  $("#pair-alpha-model-days").textContent = model ? `${model.observationDays.toFixed(1)}d` : "—";
  $("#pair-alpha-model-signals").textContent = formatCount(model?.firstSignalCount);
  $("#pair-alpha-model-matured").textContent = formatCount(model?.matured24hCount);
  const host = $("#pair-alpha-horizons");
  host.replaceChildren();
  const labels = { "5m": "5M", "30m": "30M", "2h": "2H", "6h": "6H", "24h": "24H" };
  for (const horizon of model?.horizons ?? []) {
    const card = element("article");
    card.append(
      element(
        "span",
        "",
        `${labels[horizon.horizon] ?? horizon.horizon} · N=${formatCount(horizon.observedCount)}`,
      ),
      element(
        "strong",
        (horizon.medianFeeAdjustedReturnPct ?? 0) >= 0 ? "is-positive" : "is-negative",
        formatSignedPercent(horizon.medianFeeAdjustedReturnPct),
      ),
      element("small", "", `正收益 ${formatPercent(horizon.positiveRatePercent)}`),
    );
    host.append(card);
  }
}

function renderPairAlphaSources() {
  const host = $("#pair-alpha-source-list");
  host.replaceChildren();
  for (const source of state.pairAlpha?.sources ?? []) {
    const row = element("div");
    row.append(
      element("span", "", source.label),
      element("strong", source.status === "ok" ? "" : `is-${source.status}`, source.status),
    );
    host.append(row);
  }
}

function renderPairAlpha() {
  const payload = state.pairAlpha;
  if (!payload) return;
  const overview = payload.overview;
  $("#pair-alpha-universe").textContent = formatCount(overview.officialUniverseCount);
  $("#pair-alpha-monitored").textContent = formatCount(overview.monitoredMarketCount);
  $("#pair-alpha-coverage").textContent =
    `${formatCount(overview.shortWindowObservedCount)}/${formatCount(overview.monitoredMarketCount)}`;
  $("#pair-alpha-hot-poll").textContent =
    `${formatCount(payload.monitoring.hotMarketPollSeconds)}s`;
  $("#pair-alpha-full-poll").textContent =
    `${formatCount(payload.monitoring.fullUniversePollSeconds)}s`;
  $("#pair-alpha-observed").textContent = formatDateTime(payload.observedAt);
  $("#pair-alpha-live-state").textContent = payload.stale ? "STALE" : "LIVE";
  $("#pair-alpha-live-state").classList.toggle("is-stale", payload.stale);
  $("#pair-alpha-model-state").textContent = payload.alphaModel?.validated ? "VALIDATED" : "SHADOW";
  $("#pair-alpha-ignition-count").textContent = formatCount(overview.ignitionCount);
  $("#pair-alpha-retest-count").textContent = formatCount(overview.retestCount);
  $("#pair-alpha-research-count").textContent = formatCount(overview.researchCount);
  $("#pair-alpha-no-chase-count").textContent = formatCount(overview.noChaseCount);
  $("#pair-alpha-risk-count").textContent = formatCount(overview.riskHaltCount);
  $("#pair-alpha-liquidity").textContent = formatUsd(overview.liquidityUsd);
  $("#pair-alpha-primary-volume").textContent = formatUsd(overview.primaryPoolVolume24hUsd);
  $("#pair-alpha-gross-volume").textContent = formatUsd(overview.canonicalGrossVolume24hUsd);
  $("#pair-alpha-gross-volume-5m").textContent = formatUsd(overview.canonicalGrossVolume5mUsd);
  $("#header-date").textContent = payload.observedAt.slice(0, 10);
  renderPairAlphaLeader();
  renderPairAlphaTokens();
  renderPairAlphaReplay();
  renderPairAlphaSources();
  renderRunState();
  const notices = [];
  if (payload.stale) notices.push("PAIR Alpha 数据已超过预期更新时间。");
  if (payload.sources.some((source) => source.status === "failed")) {
    notices.push("PAIR Alpha 有采集来源不可用，缺失值保持未知。");
  }
  showNotices(notices);
}

function renderEconomics() {
  if (!state.economics) return;
  $("#economics-empty-state").hidden = true;
  $("#economics-target-date").textContent = state.economics.targetDate;
  $("#economics-denominator").textContent = state.economics.shareReady
    ? formatUsd(state.economics.shareDenominatorUsd)
    : "未齐";
  $("#economics-observed-at").textContent = formatDateTime(state.economics.observedAt);
  $("#header-date").textContent = state.economics.targetDate;
  renderTriadSummary();
  renderPairFlow();
  renderPairRelativeValuation();
  renderTokenEconomics();
  renderPlatformEconomics();
  renderBuybacks();
  renderRunState();
  showNotices(state.economics.warnings ?? []);
}

function currentPairResponse() {
  return state.pairMode === "daily" ? state.pairDaily : state.pairLive;
}

function currentLongResponse() {
  return state.longMode === "daily" ? state.longDaily : state.longLive;
}

function currentTokenRadarResponse() {
  return state.dataset === "long" ? currentLongResponse() : currentPairResponse();
}

function pairRankChange(value) {
  if (!Number.isFinite(value)) return { label: "—", className: "" };
  if (value > 0) return { label: `↑${value}`, className: "is-up" };
  if (value < 0) return { label: `↓${Math.abs(value)}`, className: "is-down" };
  return { label: "—", className: "" };
}

function pairValueChange(value) {
  if (!Number.isFinite(value)) return "较上期 —";
  const sign = value > 0 ? "+" : "";
  return `较上期 ${sign}${value.toFixed(1)}%`;
}

function renderPairRanking(ranking) {
  const panel = element("article", "pair-ranking");
  const header = element("header", "pair-ranking__head");
  const heading = element("div");
  heading.append(
    element("span", "pair-ranking__code", ranking.metric.replaceAll("_", " / ").toUpperCase()),
    element("h2", "", PAIR_METRIC_LABELS[ranking.metric] ?? ranking.label),
  );
  header.append(
    heading,
    element("span", "pair-ranking__observed", `${formatCount(ranking.observedCount)} 枚有观测`),
  );
  panel.append(header);

  if (!ranking.entries.length) {
    panel.append(element("p", "pair-ranking__empty", "当前没有可排名数据。"));
    return panel;
  }

  const list = element("ol", "pair-ranking__list");
  for (const entry of ranking.entries) {
    const row = element("li", "pair-rank-row");
    row.append(element("span", "pair-rank-row__rank", String(entry.rank).padStart(2, "0")));

    const identity = element("div", "pair-rank-row__identity");
    const safeUrl = safeExternalUrl(entry.tokenUrl);
    const name = element(safeUrl ? "a" : "span", "pair-rank-row__name");
    if (safeUrl) {
      name.href = safeUrl;
      name.target = "_blank";
      name.rel = "noreferrer";
    }
    name.title = `${entry.name} · ${entry.address}`;
    name.append(
      element("strong", "", entry.symbol || entry.name),
      element("small", "", entry.name === entry.symbol ? entry.address.slice(0, 10) : entry.name),
    );
    const quote = element("small", "pair-rank-row__quote", pairQuoteAssetLabel(entry));
    quote.title = pairQuoteAssetTitle(entry);
    identity.append(name, quote);

    const value = element("div", "pair-rank-row__value");
    value.append(
      element("strong", "", formatPairValue(ranking.metric, entry.value)),
      element("small", "", pairValueChange(entry.valueChangePercent)),
    );

    const change = pairRankChange(entry.rankChange);
    row.append(
      identity,
      value,
      element("span", `pair-rank-row__change ${change.className}`.trim(), change.label),
    );
    list.append(row);
  }
  panel.append(list);
  return panel;
}

function renderTokenRadar(dataset) {
  const response = dataset === "long" ? currentLongResponse() : currentPairResponse();
  const mode = dataset === "long" ? state.longMode : state.pairMode;
  const grid = $(`#${dataset}-ranking-grid`);
  const empty = $(`#${dataset}-empty-state`);
  grid.replaceChildren();
  empty.hidden = Boolean(response?.snapshot);

  if (!response?.snapshot) {
    $(`#${dataset}-universe-count`).textContent = "—";
    $(`#${dataset}-eligible-count`).textContent = "—";
    $(`#${dataset}-updated-at`).textContent = "—";
    $(`#${dataset}-empty-message`).textContent =
      mode === "daily" ? "第一份 08:00 日报生成后会显示在这里。" : "等待下一次数据刷新。";
    $("#header-date").textContent = "—";
    renderRunState();
    showNotices(response?.warnings ?? []);
    return;
  }

  $(`#${dataset}-universe-count`).textContent = formatCount(response.snapshot.universeCount);
  $(`#${dataset}-eligible-count`).textContent = formatCount(response.snapshot.eligibleCount);
  $(`#${dataset}-updated-at`).textContent = formatDateTime(response.snapshot.observedAt);
  $("#header-date").textContent = response.reportDate ?? response.snapshot.observedAt.slice(0, 10);

  for (const metric of PAIR_METRICS) {
    grid.append(renderPairRanking(response.rankings[metric]));
  }
  renderRunState();
  showNotices(response.warnings ?? []);
}

function renderPair() {
  renderTokenRadar("pair");
}

function renderLong() {
  renderTokenRadar("long");
}

function coverageMark(metric) {
  const className =
    metric.observedDays === 0 ? "is-empty" : metric.coverage >= 1 ? "is-full" : "is-partial";
  const mark = element("span", `coverage-mark ${className}`);
  mark.textContent = metric.observedDays === 0 ? "—" : `${metric.observedDays}/30`;
  mark.title = `最近 ${metric.windowDays} 个闭合 UTC 日中有 ${metric.observedDays} 日观测`;
  return mark;
}

function renderIntelligenceMethod() {
  const intelligence = state.intelligence;
  if (!intelligence) return;
  $("#method-title").textContent = "龙头、热度与相对估值说明";
  $("#platform-coverage-disclosure").hidden = true;
  const definitions = $("#definition-list");
  definitions.replaceChildren();
  const models = [
    ["结构龙头", intelligence.leader.rules],
    ["代币热度", intelligence.tokenHeat.rules],
    ["相对估值", intelligence.relativeValuation.rules],
  ];
  for (const [label, rules] of models) {
    const row = element("article", "definition-row");
    row.append(element("strong", "", label), element("p", "", rules.join(" ")));
    definitions.append(row);
  }

  const sourceList = $("#source-list");
  sourceList.replaceChildren();
  for (const source of intelligence.sources) {
    const row = element("article", "source-row");
    const top = element("div", "source-row__top");
    top.append(
      element("strong", "", source.label),
      element("span", `health-pill health-pill--${source.status}`, source.status),
    );
    row.append(
      top,
      element("p", "", source.note),
      element(
        "small",
        "",
        `${source.temporalScope} · ${formatDateTime(source.observedAt)}${source.stale ? " · 已过期" : ""}`,
      ),
    );
    sourceList.append(row);
  }

  const caveats = $("#caveat-list");
  caveats.replaceChildren();
  for (const caveat of [intelligence.chainHeat.warning, ...intelligence.relativeValuation.rules]) {
    caveats.append(element("li", "", caveat));
  }
}

function renderPairFlowMethod() {
  const flow = state.pairFlow;
  if (!flow) return;
  $("#method-title").textContent = "PAIR 资金闭环数据说明";
  $("#platform-coverage-disclosure").hidden = true;
  const definitions = $("#definition-list");
  definitions.replaceChildren();
  const rows = [
    ["实际回购", "只记受监控地址从 PoolManager、已知路由或标记为 Swap 的交易中实际收到的 PAIR。"],
    ["实际销毁", "只记受监控地址把 PAIR 转入 0x0000…dEaD 的链上转账。"],
    [
      "批次归因",
      "按地址内 PAIR 的 FIFO 批次连接直接手续费币、市场买入币与后续销毁；不是会计审计结论。",
    ],
    [
      "美元成交额",
      "优先使用同一交易内进入 PoolManager 的稳定币结算额；否则仅展示浏览器索引价估算或未知。",
    ],
    [
      "政策待回购",
      "全平台已归集报价资产及主池待归集资产乘公开比例；这是政策口径，不是已成交回购。",
    ],
  ];
  for (const [label, description] of rows) {
    const row = element("article", "definition-row");
    row.append(element("strong", "", label), element("p", "", description));
    definitions.append(row);
  }
  const sourceList = $("#source-list");
  sourceList.replaceChildren();
  for (const source of flow.sources) {
    const row = element("article", "source-row");
    const top = element("div", "source-row__top");
    top.append(
      element("strong", "", source.label ?? source.source),
      element("span", `health-pill health-pill--${source.status}`, source.status),
    );
    row.append(
      top,
      element("p", "", source.message),
      element("small", "", `抓取 ${formatDateTime(source.fetchedAt)}`),
    );
    sourceList.append(row);
  }
  const caveats = $("#caveat-list");
  caveats.replaceChildren(
    element("li", "", "推断执行器不是官方声明地址，相关交易始终单独标注。"),
    element("li", "", "死亡地址余额证明转入，不自动证明资金一定来自协议手续费。"),
    element("li", "", "浏览器索引价格可能是当前估值，不等于历史成交结算价。"),
  );
}

function renderPairV2Method() {
  const payload = state.pairV2;
  if (!payload) return;
  $("#method-title").textContent = "PAIR V2 Alpha 观察口径";
  $("#platform-coverage-disclosure").hidden = true;
  const definitions = $("#definition-list");
  definitions.replaceChildren();
  const rows = [
    [
      "质量门槛",
      "流动性承接、同龄项目采用广度与资料可核验度分别计分。通过门槛只代表值得继续研究，不证明团队可靠。",
    ],
    [
      "关注与时机",
      "关注度看 5m/1H 成交分位、1H 换手和买卖笔数；早期时机看 15m 市值、持有人、流动性变化与 5m 成交加速度。",
    ],
    [
      "热度拦截",
      "1H 涨幅、5m 拥挤、1H 换手与薄流动性共同计算。过热项目即使其它分数高，也不进入研究信号。",
    ],
    [
      "风险与证据",
      "平台风险、单币风险、数据完整度三条线独立展示；机会分不能抵消高风险或缺失数据。",
    ],
    [
      "首次信号回放",
      "每个项目和模型版本只记录第一次形成信号，并回看 5m、30m、2H、6H、24H 结果；当前只扣双边平台费。",
    ],
    [
      "Shadow 状态",
      "至少观察 14 天且积累 50 个 24H 成熟样本后才进入人工复核；达到门槛也不会自动宣布模型有效或执行交易。",
    ],
    ["成交与费用", "短周期行情仅连接 PAIR 官方 poolId；1%、70%、30%仍是按公开费率计算的理论新增。"],
    [
      "回购桶",
      "直接读取每个回购 vault 的 buybackBucket(epoch, quote asset)，按资产分列，不跨资产相加为美元。",
    ],
    [
      "已执行回购",
      "只认当前 executor 的 BuybackExecuted 链上日志；输入资产与实际销毁项目币分开记录。",
    ],
  ];
  for (const [label, description] of rows) {
    const row = element("article", "definition-row");
    row.append(element("strong", "", label), element("p", "", description));
    definitions.append(row);
  }
  const sourceList = $("#source-list");
  sourceList.replaceChildren();
  for (const source of payload.sources) {
    const row = element("article", "source-row");
    const top = element("div", "source-row__top");
    top.append(
      element("strong", "", source.label),
      element("span", `health-pill health-pill--${source.status}`, source.status),
    );
    row.append(
      top,
      element("p", "", source.message),
      element("small", "", `抓取 ${formatDateTime(source.fetchedAt)} · ${source.latencyMs}ms`),
    );
    sourceList.append(row);
  }
  $("#caveat-list").replaceChildren(
    element("li", "", "当前生产合约图源码未完全验证，任何信号阶段都不会掩盖这一风险。"),
    element("li", "", "理论回购新增不等于 bucket，不等于已执行回购，也不等于美元买压。"),
    element("li", "", "回放尚未计入滑点、Gas 与真实可退出深度，不能视为可执行净收益。"),
    element("li", "", "面板只读；不会连接钱包、签名、广播或自动交易。"),
  );
}

function renderPairAlphaMethod() {
  const payload = state.pairAlpha;
  if (!payload) return;
  $("#method-title").textContent = "PAIR Alpha 雷达口径";
  $("#platform-coverage-disclosure").hidden = true;
  const definitions = $("#definition-list");
  definitions.replaceChildren();
  const rows = [
    [
      "覆盖",
      "PAIR 官方目录中的 V1、V2 与后续可识别代际统一入库；当前 release 事件作为更强身份锚点。",
    ],
    ["动作通道", "点火、回踩、研究候选、过热勿追与风险停止互斥；任何状态都只是 Shadow 研究输出。"],
    [
      "成交口径",
      "官方 24H、主池 24H 与 canonical 池毛额分列；没有地址级资金流证据时，净 Quote 流入保持 UNKNOWN。",
    ],
    [
      "首次信号",
      "首次发现、首次点火和每次状态迁移持久化；回放固定首个信号价格，不用事后高点改写入口。",
    ],
  ];
  for (const [label, description] of rows) {
    const row = element("article", "definition-row");
    row.append(element("strong", "", label), element("p", "", description));
    definitions.append(row);
  }
  const sourceList = $("#source-list");
  sourceList.replaceChildren();
  for (const source of payload.sources) {
    const row = element("article", "source-row");
    const top = element("div", "source-row__top");
    top.append(
      element("strong", "", source.label),
      element("span", `health-pill health-pill--${source.status}`, source.status),
    );
    row.append(
      top,
      element("p", "", source.message),
      element("small", "", `抓取 ${formatDateTime(source.fetchedAt)} · ${source.latencyMs}ms`),
    );
    sourceList.append(row);
  }
  $("#caveat-list").replaceChildren(
    element("li", "", "V1 官方目录身份不等于已回填历史 release 的链上发行凭证。"),
    element("li", "", "过热项目会告警但进入勿追通道，不能作为追涨信号。"),
    element("li", "", "回放未计入滑点、Gas 与真实退出深度，不是可执行收益。"),
    element("li", "", "页面只读，不连接钱包、不签名、不广播、不自动交易。"),
  );
}

function renderMethod() {
  if (state.dataset === "intelligence") {
    renderIntelligenceMethod();
    return;
  }
  if (state.dataset === "pair_flow") {
    renderPairFlowMethod();
    return;
  }
  if (state.dataset === "pair_v2") {
    renderPairV2Method();
    return;
  }
  if (state.dataset === "pair_alpha") {
    renderPairAlphaMethod();
    return;
  }
  const isTokenRadar = ["pair", "long"].includes(state.dataset);
  const isEconomics = state.dataset === "economics";
  const tokenSources = state.dataset === "long" ? state.longSources : state.pairSources;
  const economicsMethodSource = state.economicsSources
    ? {
        ...state.economicsSources,
        definitions: {
          ...state.economicsSources.definitions,
          pair_flow_today_volume:
            "PAIR/SPY 主池从北京时间 00:00 起的小时成交额合计；与滚动 24H 分开。",
          pair_flow_market_acquired:
            "只统计受监控团队地址从 PoolManager、已知路由或 Swap 收到的 PAIR，不统计所有用户买入。",
          pair_flow_dead_locked:
            "死亡地址当前 PAIR 余额；与 ERC-20 totalSupply 分列，不自动等同于回购。",
          pair_flow_pending_buyback:
            "Locker 中协议可领 SPY × 90%；余额链上可核验，但 90% 用途是政策预期，并非合约强制。",
        },
        caveats: [
          ...state.economicsSources.caveats,
          "团队钱包中的 PAIR、SPY 可能混同；未完成资金批次归因时不会计入已执行回购。",
        ],
      }
    : null;
  const economicsSourcePayload = economicsMethodSource
    ? {
        ...economicsMethodSource,
        sources: [
          ...economicsMethodSource.sources,
          ...(state.pairFlow?.sources ?? []).filter(
            (source) =>
              !economicsMethodSource.sources.some(
                (candidate) => candidate.source === source.source,
              ),
          ),
        ],
      }
    : null;
  const definitionSource = isEconomics
    ? economicsMethodSource
    : isTokenRadar
      ? tokenSources
      : state.coverage;
  const sourcePayload = isEconomics
    ? economicsSourcePayload
    : isTokenRadar
      ? tokenSources
      : state.sources;
  if (!definitionSource || !sourcePayload) return;

  $("#method-title").textContent = isEconomics
    ? "三强对比数据说明"
    : isTokenRadar
      ? `${state.dataset === "long" ? "Long" : "PAIR"} 数据说明`
      : "数据说明";
  $("#platform-coverage-disclosure").hidden = isTokenRadar || isEconomics;
  const metrics = isEconomics
    ? Object.keys(definitionSource.definitions)
    : isTokenRadar
      ? PAIR_METRICS
      : CORE_METRICS;
  const labels = isEconomics
    ? ECONOMICS_DEFINITION_LABELS
    : isTokenRadar
      ? PAIR_METRIC_LABELS
      : METRIC_LABELS;

  const definitions = $("#definition-list");
  definitions.replaceChildren();
  for (const metric of metrics) {
    const row = element("article", "definition-row");
    row.append(
      element("strong", "", labels[metric]),
      element("p", "", definitionSource.definitions[metric] ?? "—"),
    );
    definitions.append(row);
  }

  const sourceList = $("#source-list");
  sourceList.replaceChildren();
  for (const source of sourcePayload.sources) {
    const row = element("article", "source-row");
    const top = element("div", "source-row__top");
    top.append(
      element("strong", "", source.source),
      element("span", `health-pill health-pill--${source.status}`, source.status),
    );
    const latency = Number.isFinite(source.latencyMs) ? ` · ${source.latencyMs}ms` : "";
    const timestamp =
      isTokenRadar || isEconomics
        ? `抓取 ${formatDateTime(source.fetchedAt)}${latency}`
        : `数据 ${source.latestDataDate ?? "—"} · 抓取 ${formatDateTime(source.fetchedAt)}${latency}`;
    row.append(top, element("p", "", source.message), element("small", "", timestamp));
    sourceList.append(row);
  }

  const caveats = $("#caveat-list");
  caveats.replaceChildren();
  for (const caveat of definitionSource.caveats) caveats.append(element("li", "", caveat));

  if (isTokenRadar || isEconomics) return;

  const coverageBody = $("#coverage-body");
  coverageBody.replaceChildren();
  for (const platform of state.coverage.platforms) {
    const row = element("tr");
    row.append(element("td", "", platform.name));
    for (const metric of CORE_METRICS) {
      const cell = element("td");
      cell.append(coverageMark(platform.metrics[metric]));
      row.append(cell);
    }
    const scopeCell = element("td");
    const label = platform.excludeFromTotals
      ? "排除总计"
      : (SCOPE_LABELS[platform.comparability] ?? platform.comparability);
    const chip = element("span", `scope-chip scope-chip--${platform.comparability}`, label);
    chip.title = platform.scope;
    scopeCell.append(chip);
    row.append(scopeCell);
    coverageBody.append(row);
  }
}

async function loadMethod() {
  if (state.methodLoadedFor === state.dataset) {
    renderMethod();
    return;
  }
  $("#definition-list").replaceChildren(element("p", "panel-loading", "正在加载…"));
  $("#source-list").replaceChildren();
  if (state.dataset === "intelligence") {
    if (!state.intelligence) await loadIntelligence();
  } else if (state.dataset === "pair_alpha") {
    if (!state.pairAlpha) await loadPairAlpha();
  } else if (state.dataset === "pair_v2") {
    if (!state.pairV2) await loadPairV2();
  } else if (state.dataset === "pair_flow") {
    if (!state.pairFlow) await loadPairFlowPage();
  } else if (state.dataset === "economics") {
    state.economicsSources = await api("/api/economics/sources");
  } else if (["pair", "long"].includes(state.dataset)) {
    const sources = await api(`/api/${state.dataset}/sources`);
    if (state.dataset === "long") state.longSources = sources;
    else state.pairSources = sources;
  } else {
    const [coverage, sources] = await Promise.all([api("/api/coverage"), api("/api/sources")]);
    state.coverage = coverage;
    state.sources = sources;
  }
  state.methodLoadedFor = state.dataset;
  renderMethod();
}

function renderDrawerMetrics(detail) {
  const host = $("#drawer-metrics");
  host.replaceChildren();
  for (const metric of CORE_METRICS) {
    const data = detail.coverage[metric];
    const card = element("article", "drawer-metric");
    card.append(
      element("span", "", `64 日${METRIC_LABELS[metric]}`),
      element("strong", data.value === null ? "is-null" : "", formatUsd(data.value)),
      element("small", "", `${data.observedDays}/64 日有观测`),
    );
    host.append(card);
  }
}

function renderLiveStats(detail) {
  const section = $("#drawer-live-section");
  const host = $("#drawer-live-stats");
  const stats = Array.isArray(detail.stats) ? [...detail.stats] : [];
  host.replaceChildren();
  if (stats.length === 0) {
    section.hidden = true;
    return;
  }

  const order = new Map(STAT_ORDER.map((key, index) => [key, index]));
  stats.sort((left, right) => {
    const leftOrder = order.get(left.key) ?? 999;
    const rightOrder = order.get(right.key) ?? 999;
    return leftOrder - rightOrder || left.label.localeCompare(right.label);
  });
  section.hidden = false;
  const newest = stats.reduce(
    (latest, stat) => (!latest || stat.collectedAt > latest ? stat.collectedAt : latest),
    null,
  );
  $("#drawer-live-time").textContent = `抓取于 ${formatDateTime(newest)}`;

  for (const stat of stats) {
    const card = element("article", "drawer-live-stat");
    card.title = stat.derivation || stat.scope;
    card.append(element("span", "", stat.label), element("strong", "", formatStatValue(stat)));
    host.append(card);
  }
}

function renderChartTabs() {
  const host = $("#chart-tabs");
  host.replaceChildren();
  for (const metric of CORE_METRICS) {
    const button = element(
      "button",
      metric === state.detailMetric ? "is-active" : "",
      METRIC_SHORT[metric],
    );
    button.type = "button";
    button.title = METRIC_LABELS[metric];
    button.addEventListener("click", () => {
      state.detailMetric = metric;
      renderChartTabs();
      renderChart();
    });
    host.append(button);
  }
}

function svgElement(tag, attributes = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

function renderChart() {
  const svg = $("#history-chart");
  const empty = $("#chart-empty");
  svg.replaceChildren();
  const points = state.detail?.series?.[state.detailMetric] ?? [];
  $("#chart-title").textContent = `${METRIC_LABELS[state.detailMetric]}历史`;
  if (points.length === 0) {
    svg.hidden = true;
    empty.hidden = false;
    return;
  }
  svg.hidden = false;
  empty.hidden = true;

  const width = 720;
  const height = 260;
  const padding = { top: 28, right: 24, bottom: 34, left: 70 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const timestamps = points.map((point) => Date.parse(`${point.date}T00:00:00Z`));
  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(...timestamps);
  const rawMaxValue = Math.max(...points.map((point) => point.value));
  const maxValue = rawMaxValue > 0 ? rawMaxValue * 1.08 : 1;
  const x = (time) =>
    padding.left +
    (maxTime === minTime ? plotWidth / 2 : ((time - minTime) / (maxTime - minTime)) * plotWidth);
  const y = (value) => padding.top + plotHeight - (value / maxValue) * plotHeight;

  const defs = svgElement("defs");
  const gradient = svgElement("linearGradient", {
    id: "chart-gradient",
    x1: "0",
    y1: "0",
    x2: "0",
    y2: "1",
  });
  gradient.append(
    svgElement("stop", { offset: "0%", "stop-color": "#60e6e4", "stop-opacity": "0.35" }),
    svgElement("stop", { offset: "100%", "stop-color": "#60e6e4", "stop-opacity": "0" }),
  );
  defs.append(gradient);
  svg.append(defs);

  const coordinates = points.map((point, index) => [x(timestamps[index]), y(point.value)]);
  const linePath = coordinates
    .map(
      ([pointX, pointY], index) =>
        `${index === 0 ? "M" : "L"}${pointX.toFixed(2)},${pointY.toFixed(2)}`,
    )
    .join(" ");
  const firstX = coordinates[0][0];
  const lastX = coordinates.at(-1)[0];
  const baseline = padding.top + plotHeight;
  const areaPath = `${linePath} L${lastX.toFixed(2)},${baseline} L${firstX.toFixed(2)},${baseline} Z`;

  svg.append(svgElement("path", { d: areaPath, class: "chart-area" }));
  svg.append(svgElement("path", { d: linePath, class: "chart-line" }));
  const lastPoint = coordinates.at(-1);
  svg.append(
    svgElement("circle", { cx: lastPoint[0], cy: lastPoint[1], r: 4.5, class: "chart-dot" }),
  );

  const maxLabel = svgElement("text", { x: 12, y: padding.top + 4, class: "chart-label" });
  maxLabel.textContent = formatUsd(rawMaxValue);
  const zeroLabel = svgElement("text", { x: 12, y: baseline + 4, class: "chart-label" });
  zeroLabel.textContent = "$0";
  const startLabel = svgElement("text", { x: padding.left, y: height - 10, class: "chart-label" });
  startLabel.textContent = points[0].date;
  const endLabel = svgElement("text", {
    x: width - padding.right,
    y: height - 10,
    class: "chart-label",
    "text-anchor": "end",
  });
  endLabel.textContent = points.at(-1).date;
  svg.append(maxLabel, zeroLabel, startLabel, endLabel);
}

function renderDetail() {
  const detail = state.detail;
  if (!detail) return;
  $("#drawer-title").textContent = detail.platform.name;
  const scopeLabel = SCOPE_LABELS[detail.platform.comparability] ?? detail.platform.comparability;
  $("#drawer-status").textContent =
    detail.platform.comparability === "comparable"
      ? `截至 ${detail.targetDate}`
      : `${scopeLabel} · ${detail.targetDate}`;
  $("#drawer-scope").textContent = detail.platform.scope;
  renderDrawerMetrics(detail);
  renderLiveStats(detail);
  renderChartTabs();
  renderChart();

  const notes = $("#drawer-notes");
  notes.replaceChildren();
  const noteItems = detail.platform.notes.length ? detail.platform.notes : ["暂无额外说明。"];
  for (const note of noteItems) notes.append(element("li", "", note));

  const links = $("#drawer-links");
  links.replaceChildren();
  for (const source of detail.platform.sourceLinks) {
    const safeUrl = safeExternalUrl(source.url);
    if (!safeUrl) continue;
    const anchor = element("a", "source-link");
    anchor.href = safeUrl;
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
    anchor.append(element("span", "", source.label), element("span", "", "↗"));
    links.append(anchor);
  }
  if (!links.childElementCount) links.append(element("p", "panel-loading", "暂无来源链接。"));
}

function openPanel(drawerSelector, backdropSelector, trigger) {
  state.lastFocus = trigger;
  const drawer = $(drawerSelector);
  const backdrop = $(backdropSelector);
  backdrop.hidden = false;
  drawer.inert = false;
  drawer.setAttribute("aria-hidden", "false");
  document.body.classList.add("panel-open");
  requestAnimationFrame(() => {
    backdrop.classList.add("is-open");
    drawer.classList.add("is-open");
  });
}

function closePanel(drawerSelector, backdropSelector, restoreFocus = true) {
  const drawer = $(drawerSelector);
  const backdrop = $(backdropSelector);
  drawer.classList.remove("is-open");
  backdrop.classList.remove("is-open");
  drawer.inert = true;
  drawer.setAttribute("aria-hidden", "true");
  setTimeout(() => {
    backdrop.hidden = true;
    if (!$(".detail-drawer.is-open, .method-drawer.is-open"))
      document.body.classList.remove("panel-open");
    if (restoreFocus) state.lastFocus?.focus?.();
  }, 280);
}

async function openDetail(platformId, trigger) {
  openPanel("#detail-drawer", "#drawer-backdrop", trigger);
  $("#drawer-title").textContent = "正在加载…";
  $("#drawer-status").textContent = "平台详情";
  $("#drawer-metrics").replaceChildren();
  $("#drawer-live-section").hidden = true;
  $("#drawer-close").focus();

  try {
    state.detail = await api(`/api/platforms/${encodeURIComponent(platformId)}`);
    state.detailMetric =
      CORE_METRICS.find((metric) => state.detail.series[metric]?.length) ?? "volume_usd";
    renderDetail();
  } catch (error) {
    $("#drawer-title").textContent = "加载失败";
    $("#drawer-metrics").replaceChildren(element("p", "panel-error", error.message));
  }
}

function closeDetail() {
  closePanel("#detail-drawer", "#drawer-backdrop");
}

async function openMethod(trigger) {
  openPanel("#method-drawer", "#method-backdrop", trigger);
  $("#method-title").textContent =
    state.dataset === "intelligence"
      ? "龙头、热度与相对估值说明"
      : state.dataset === "pair_alpha"
        ? "PAIR Alpha 雷达说明"
        : state.dataset === "pair_v2"
          ? "PAIR V2 监控说明"
          : state.dataset === "economics"
            ? "三强对比数据说明"
            : ["pair", "long"].includes(state.dataset)
              ? `${state.dataset === "long" ? "Long" : "PAIR"} 数据说明`
              : "数据说明";
  $("#method-close").focus();
  try {
    await loadMethod();
  } catch (error) {
    $("#definition-list").replaceChildren(
      element("p", "panel-error", `数据说明加载失败：${error.message}`),
    );
  }
}

function closeMethod() {
  closePanel("#method-drawer", "#method-backdrop");
}

async function loadOverview() {
  state.overview = await api(`/api/overview?window=${state.windowDays}`);
  renderOverview();
}

async function loadIntelligence() {
  state.intelligence = await api("/api/intelligence");
  renderIntelligence();
}

async function loadPairV2() {
  const [pairV2, devMonitor, pairTeamLaunches] = await Promise.all([
    api("/api/pair/v2"),
    api("/api/dev-monitor/health").catch(() => null),
    api(
      `/api/dev-monitor/pair-team-launches?limit=${String(state.pairTeamRowLimit)}&offset=0`,
    ).catch(() => null),
  ]);
  state.pairV2 = pairV2;
  state.devMonitor = devMonitor;
  state.pairTeamLaunches = pairTeamLaunches;
  renderPairV2();
}

async function loadPairAlpha() {
  state.pairAlpha = await api("/api/pair/alpha");
  renderPairAlpha();
}

async function loadPairTeamLaunches() {
  state.pairTeamLaunches = await api(
    `/api/dev-monitor/pair-team-launches?limit=${String(state.pairTeamRowLimit)}&offset=0`,
  );
  renderPairTeamLaunches();
}

async function loadEconomics() {
  const [economics, valuationHistory, pairFlow] = await Promise.all([
    api("/api/economics"),
    api("/api/economics/valuation/history").catch(() => null),
    api("/api/pair/flow").catch(() => null),
  ]);
  state.economics = economics;
  state.valuationHistory = valuationHistory;
  if (pairFlow) state.pairFlow = pairFlow;
  renderEconomics();
}

async function loadPairFlowEvents(reset = true) {
  const offset = reset ? 0 : (state.pairEvents?.items.length ?? 0);
  const response = await api(
    `/api/pair/flow/events?type=all&window=${state.pairFlowWindow}&limit=200&offset=${offset}`,
  );
  if (reset || !state.pairEvents) {
    state.pairEvents = response;
  } else {
    const seen = new Set(state.pairEvents.items.map((event) => event.id));
    state.pairEvents = {
      ...response,
      items: [...state.pairEvents.items, ...response.items.filter((event) => !seen.has(event.id))],
    };
  }
  renderPairFlowEvents();
}

async function loadPairFlowPage() {
  const [flow, events] = await Promise.all([
    api("/api/pair/flow"),
    api(`/api/pair/flow/events?type=all&window=${state.pairFlowWindow}&limit=200&offset=0`),
  ]);
  state.pairFlow = flow;
  state.pairEvents = events;
  $("#header-date").textContent = flow.window?.calendarDate ?? "—";
  renderPairFlow();
  renderPairFlowEvents();
  renderRunState();
  showNotices([]);
}

async function loadPair() {
  const [live, daily] = await Promise.all([
    api("/api/pair/rankings"),
    api("/api/pair/reports/latest").catch((error) => {
      if (error.status === 404) return null;
      throw error;
    }),
  ]);
  state.pairLive = live;
  state.pairDaily = daily;
  renderPair();
}

async function loadLong() {
  const [live, daily] = await Promise.all([
    api("/api/long/rankings"),
    api("/api/long/reports/latest").catch((error) => {
      if (error.status === 404) return null;
      throw error;
    }),
  ]);
  state.longLive = live;
  state.longDaily = daily;
  renderLong();
}

async function switchDataset(dataset) {
  if (
    ![
      "intelligence",
      "economics",
      "platform",
      "pair",
      "long",
      "pair_flow",
      "pair_alpha",
      "pair_v2",
    ].includes(dataset) ||
    dataset === state.dataset
  )
    return;
  state.dataset = dataset;
  $$("[data-dataset]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.dataset === dataset);
  });
  $("#intelligence-view").hidden = dataset !== "intelligence";
  $("#pair-alpha-view").hidden = dataset !== "pair_alpha";
  $("#pair-v2-view").hidden = dataset !== "pair_v2";
  $("#economics-view").hidden = !["economics", "pair_flow"].includes(dataset);
  $("#platform-view").hidden = dataset !== "platform";
  $("#pair-view").hidden = dataset !== "pair";
  $("#long-view").hidden = dataset !== "long";
  showNotices([]);

  if (dataset === "intelligence") {
    if (state.intelligence) renderIntelligence();
    else await loadIntelligence();
  } else if (dataset === "pair_alpha") {
    if (state.pairAlpha) renderPairAlpha();
    else await loadPairAlpha();
  } else if (dataset === "pair_v2") {
    if (state.pairV2) renderPairV2();
    else await loadPairV2();
  } else if (dataset === "economics") {
    if (state.economics) renderEconomics();
    else await loadEconomics();
  } else if (dataset === "pair_flow") {
    if (state.pairFlow && state.pairEvents) {
      renderPairFlow();
      renderPairFlowEvents();
      renderRunState();
    } else await loadPairFlowPage();
  } else if (dataset === "pair") {
    if (state.pairLive) renderPair();
    else await loadPair();
  } else if (dataset === "long") {
    if (state.longLive) renderLong();
    else await loadLong();
  } else {
    if (state.overview) renderOverview();
    else await loadOverview();
  }

  if ($("#method-drawer").classList.contains("is-open")) await loadMethod();
}

async function refreshDashboard() {
  const button = $("#refresh-button");
  button.disabled = true;
  button.classList.add("is-spinning");
  showNotices(["正在刷新数据…"]);
  try {
    if (state.dataset === "intelligence") {
      state.intelligence = await api("/api/intelligence/refresh", { method: "POST" });
      renderIntelligence();
    } else if (state.dataset === "pair_alpha") {
      state.pairAlpha = await api("/api/pair/alpha/refresh", { method: "POST" });
      renderPairAlpha();
    } else if (state.dataset === "pair_v2") {
      state.pairV2 = await api("/api/pair/v2/refresh", { method: "POST" });
      renderPairV2();
    } else if (state.dataset === "economics") {
      await api("/api/economics/refresh", { method: "POST" });
      await api("/api/pair/flow/refresh", { method: "POST" }).catch(() => null);
      await loadEconomics();
    } else if (state.dataset === "pair_flow") {
      await api("/api/pair/flow/refresh", { method: "POST" });
      await loadPairFlowPage();
    } else if (state.dataset === "pair") {
      await api("/api/pair/refresh", { method: "POST" });
      await loadPair();
    } else if (state.dataset === "long") {
      await api("/api/long/refresh", { method: "POST" });
      await loadLong();
    } else {
      await api("/api/refresh", { method: "POST" });
      await loadOverview();
    }
    state.methodLoadedFor = null;
    if ($("#method-drawer").classList.contains("is-open")) await loadMethod();
  } catch (error) {
    showNotices([`刷新失败：${error.message}`], "error");
  } finally {
    button.disabled = false;
    button.classList.remove("is-spinning");
  }
}

function bindEvents() {
  $$("[data-dataset]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await switchDataset(button.dataset.dataset);
      } catch (error) {
        showNotices([`数据集切换失败：${error.message}`], "error");
        renderRunState();
      }
    });
  });

  $$("[data-alpha-lane]").forEach((button) => {
    button.addEventListener("click", () => {
      const lane = button.dataset.alphaLane;
      if (
        !["all", "ignition_watch", "retest_watch", "research", "no_chase", "risk_halt"].includes(
          lane,
        ) ||
        lane === state.pairAlphaLane
      ) {
        return;
      }
      state.pairAlphaLane = lane;
      state.pairAlphaRowLimit = 25;
      $$("[data-alpha-lane]").forEach((candidate) => {
        candidate.classList.toggle("is-active", candidate === button);
      });
      renderPairAlphaTokens();
    });
  });

  $$("[data-alpha-generation]").forEach((button) => {
    button.addEventListener("click", () => {
      const generation = button.dataset.alphaGeneration;
      if (!["all", "v1", "v2"].includes(generation) || generation === state.pairAlphaGeneration) {
        return;
      }
      state.pairAlphaGeneration = generation;
      state.pairAlphaRowLimit = 25;
      $$("[data-alpha-generation]").forEach((candidate) => {
        candidate.classList.toggle("is-active", candidate === button);
      });
      renderPairAlphaTokens();
    });
  });

  $("#pair-alpha-search")?.addEventListener("input", (event) => {
    state.pairAlphaSearch = event.target.value;
    state.pairAlphaRowLimit = 25;
    renderPairAlphaTokens();
  });

  $("#pair-alpha-load-more")?.addEventListener("click", () => {
    state.pairAlphaRowLimit += 25;
    renderPairAlphaTokens();
  });

  $$("[data-v2-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.v2Mode;
      if (!["all", "1", "2", "3"].includes(mode) || mode === state.pairV2Mode) return;
      state.pairV2Mode = mode;
      state.pairV2RowLimit = 20;
      $$("[data-v2-mode]").forEach((candidate) => {
        candidate.classList.toggle("is-active", candidate === button);
      });
      renderPairV2Tokens();
    });
  });

  $$("[data-v2-lens]").forEach((button) => {
    button.addEventListener("click", () => {
      const lens = button.dataset.v2Lens;
      if (
        !["all", "qualified", "research", "overheated", "unknown"].includes(lens) ||
        lens === state.pairV2Lens
      ) {
        return;
      }
      state.pairV2Lens = lens;
      state.pairV2RowLimit = 20;
      $$("[data-v2-lens]").forEach((candidate) => {
        candidate.classList.toggle("is-active", candidate === button);
      });
      renderPairV2Tokens();
    });
  });

  $("#pair-v2-load-more")?.addEventListener("click", () => {
    state.pairV2RowLimit += 20;
    renderPairV2Tokens();
  });

  $("#pair-team-load-more")?.addEventListener("click", async () => {
    state.pairTeamRowLimit = Math.min(500, state.pairTeamRowLimit + 20);
    try {
      await loadPairTeamLaunches();
    } catch (error) {
      showNotices([`PAIR 项目方发币加载失败：${error.message}`], "error");
    }
  });

  $$("[data-v2-event]").forEach((button) => {
    button.addEventListener("click", () => {
      const type = button.dataset.v2Event;
      if (
        !["all", "fee_collected", "buyback_executed", "holder_claim", "upgrade"].includes(type) ||
        type === state.pairV2Event
      ) {
        return;
      }
      state.pairV2Event = type;
      $$("[data-v2-event]").forEach((candidate) => {
        candidate.classList.toggle("is-active", candidate === button);
      });
      renderPairV2Events();
    });
  });

  $$("[data-pair-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.pairMode;
      if (!["live", "daily"].includes(mode) || mode === state.pairMode) return;
      state.pairMode = mode;
      $$("[data-pair-mode]").forEach((candidate) => {
        candidate.classList.toggle("is-active", candidate === button);
      });
      renderPair();
    });
  });

  $$("[data-long-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.longMode;
      if (!["live", "daily"].includes(mode) || mode === state.longMode) return;
      state.longMode = mode;
      $$("[data-long-mode]").forEach((candidate) => {
        candidate.classList.toggle("is-active", candidate === button);
      });
      renderLong();
    });
  });

  $$("[data-flow-window]").forEach((button) => {
    button.addEventListener("click", async () => {
      const windowName = button.dataset.flowWindow;
      if (!["today", "7d", "all"].includes(windowName) || windowName === state.pairFlowWindow) {
        return;
      }
      state.pairFlowWindow = windowName;
      $$("[data-flow-window]").forEach((candidate) => {
        candidate.classList.toggle("is-active", candidate === button);
      });
      try {
        await loadPairFlowEvents(true);
      } catch (error) {
        showNotices([`逐笔账本加载失败：${error.message}`], "error");
      }
    });
  });

  $("#pair-flow-load-more").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await loadPairFlowEvents(false);
    } catch (error) {
      showNotices([`更多交易加载失败：${error.message}`], "error");
    } finally {
      button.disabled = false;
    }
  });

  $$("[data-window]").forEach((button) => {
    button.addEventListener("click", async () => {
      const windowDays = Number(button.dataset.window);
      if (![1, 7, 30].includes(windowDays) || windowDays === state.windowDays) return;
      state.windowDays = windowDays;
      $$("[data-window]").forEach((candidate) => {
        candidate.classList.toggle("is-active", candidate === button);
      });
      try {
        await loadOverview();
      } catch (error) {
        showNotices([`窗口切换失败：${error.message}`], "error");
      }
    });
  });

  $$("[data-platform-scope]").forEach((button) => {
    button.addEventListener("click", () => {
      state.platformScope = button.dataset.platformScope;
      $$("[data-platform-scope]").forEach((candidate) => {
        candidate.classList.toggle("is-active", candidate === button);
      });
      renderLedger();
    });
  });

  $("#platform-search").addEventListener("input", (event) => {
    state.search = event.target.value;
    renderLedger();
  });

  $$("[data-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.sort;
      if (state.sortKey === key) {
        state.sortDirection = state.sortDirection === "desc" ? "asc" : "desc";
      } else {
        state.sortKey = key;
        state.sortDirection = key === "name" ? "asc" : "desc";
      }
      renderLedger();
    });
  });

  $("#refresh-button").addEventListener("click", refreshDashboard);
  $("#method-button").addEventListener("click", (event) => openMethod(event.currentTarget));
  $("#method-close").addEventListener("click", closeMethod);
  $("#method-backdrop").addEventListener("click", closeMethod);
  $("#drawer-close").addEventListener("click", closeDetail);
  $("#drawer-backdrop").addEventListener("click", closeDetail);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if ($("#detail-drawer").classList.contains("is-open")) closeDetail();
    else if ($("#method-drawer").classList.contains("is-open")) closeMethod();
  });
}

function syncInitialView() {
  const product =
    APP_PREFIX === "/leaders"
      ? "leaders"
      : APP_PREFIX === "/pair-alpha"
        ? "pair-alpha"
        : APP_PREFIX === "/pair-v2"
          ? "pair-v2"
          : APP_PREFIX === "/pair-flow"
            ? "pair-flow"
            : "launchpads";
  document.body.dataset.productContext = product;
  if (product === "pair-flow") {
    document.title = "PAIR 资金闭环｜Robinhood Chain";
    $("#economics-view").setAttribute("aria-label", "PAIR 资金闭环");
  } else if (product === "pair-alpha") {
    document.title = "PAIR Alpha Radar｜Robinhood Chain";
  } else if (product === "pair-v2") {
    document.title = "PAIR V2 监控｜Robinhood Chain";
  }
  $$("[data-dataset]").forEach((button) => {
    const belongsToProduct = button.dataset.productContext === product;
    button.hidden = !belongsToProduct;
    button.classList.toggle(
      "is-active",
      belongsToProduct && button.dataset.dataset === state.dataset,
    );
  });
  $("#intelligence-view").hidden = state.dataset !== "intelligence";
  $("#pair-alpha-view").hidden = state.dataset !== "pair_alpha";
  $("#pair-v2-view").hidden = state.dataset !== "pair_v2";
  $("#economics-view").hidden = !["economics", "pair_flow"].includes(state.dataset);
  $("#platform-view").hidden = state.dataset !== "platform";
  $("#pair-view").hidden = state.dataset !== "pair";
  $("#long-view").hidden = state.dataset !== "long";
  $$("[data-product]").forEach((link) => {
    link.classList.toggle("is-active", link.dataset.product === product);
  });
  const productNav = $(".product-nav");
  const activeProduct = productNav.querySelector("a.is-active");
  if (window.matchMedia("(max-width: 820px)").matches && activeProduct) {
    productNav.scrollLeft = Math.max(
      0,
      activeProduct.offsetLeft - (productNav.clientWidth - activeProduct.clientWidth) / 2,
    );
  }
}

syncInitialView();
bindEvents();

let economicsPollInFlight = false;
let intelligencePollInFlight = false;
let pairFlowPollInFlight = false;
let pairV2PollInFlight = false;
let pairAlphaPollInFlight = false;
async function pollEconomicsCache() {
  if (economicsPollInFlight || state.dataset !== "economics" || document.hidden) return;
  economicsPollInFlight = true;
  try {
    await loadEconomics();
  } catch {
    // Keep the last verified cache on screen; the manual refresh path reports actionable failures.
  } finally {
    economicsPollInFlight = false;
  }
}

async function pollIntelligenceCache() {
  if (intelligencePollInFlight || state.dataset !== "intelligence" || document.hidden) return;
  intelligencePollInFlight = true;
  try {
    await loadIntelligence();
  } catch {
    // Preserve the most recent usable intelligence snapshot on transient source failure.
  } finally {
    intelligencePollInFlight = false;
  }
}

async function pollPairFlowCache() {
  if (pairFlowPollInFlight || state.dataset !== "pair_flow" || document.hidden) return;
  pairFlowPollInFlight = true;
  try {
    await loadPairFlowPage();
  } catch {
    // Preserve the latest verified transaction ledger during a transient source failure.
  } finally {
    pairFlowPollInFlight = false;
  }
}

async function pollPairV2Cache() {
  if (pairV2PollInFlight || state.dataset !== "pair_v2" || document.hidden) return;
  pairV2PollInFlight = true;
  try {
    await loadPairV2();
  } catch {
    // Preserve the last canonical release snapshot while the server monitor retries.
  } finally {
    pairV2PollInFlight = false;
  }
}

async function pollPairAlphaCache() {
  if (pairAlphaPollInFlight || state.dataset !== "pair_alpha" || document.hidden) return;
  pairAlphaPollInFlight = true;
  try {
    await loadPairAlpha();
  } catch {
    // Preserve the latest server-side Alpha snapshot during a transient source failure.
  } finally {
    pairAlphaPollInFlight = false;
  }
}

window.setInterval(() => {
  void pollEconomicsCache();
  void pollIntelligenceCache();
  void pollPairFlowCache();
}, 60_000);
window.setInterval(() => {
  void pollPairV2Cache();
  void pollPairAlphaCache();
}, 8_000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    void pollEconomicsCache();
    void pollIntelligenceCache();
    void pollPairFlowCache();
    void pollPairV2Cache();
    void pollPairAlphaCache();
  }
});

try {
  if (state.dataset === "intelligence") await loadIntelligence();
  else if (state.dataset === "pair_alpha") await loadPairAlpha();
  else if (state.dataset === "pair_v2") await loadPairV2();
  else if (state.dataset === "pair_flow") await loadPairFlowPage();
  else await loadEconomics();
} catch (error) {
  showNotices([`数据加载失败：${error.message}`], "error");
  $("#run-state").classList.add("is-bad");
  $("span", $("#run-state")).textContent = "加载失败";
} finally {
  $("#loading-screen").classList.add("is-done");
}
