const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const PRODUCT_PAGE = (() => {
  const path = window.location.pathname;
  if (path.startsWith("/market")) return "market";
  if (path.startsWith("/alpha")) return "alpha";
  if (path.startsWith("/assets")) return "assets";
  return "today";
})();

const PAGE_TITLES = {
  today: "今日｜Robinhood Chain",
  market: "市场｜Robinhood Chain",
  alpha: "Alpha｜Robinhood Chain",
  assets: "CashCat｜Robinhood Chain",
};

const HEAT_LABELS = {
  cooling: "降温",
  normal: "正常",
  warming: "升温",
  hot: "偏热",
  overheated: "过热",
  unknown: "数据不足",
};

const SOURCE_LABELS = {
  OK: "正常",
  DEGRADED: "部分可用",
  ERROR: "不可用",
  FAILED: "不可用",
  UNKNOWN: "未知",
  LEAD: "领先",
  CHALLENGED: "接近领先",
  LOST: "未领先",
  WATCH: "需要观察",
};

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value ?? "—";
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function compactNumber(value, maximumFractionDigits = 1) {
  if (!finite(value)) return "—";
  return new Intl.NumberFormat("zh-CN", {
    notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits,
  }).format(value);
}

function usd(value) {
  if (!finite(value)) return "—";
  const absolute = Math.abs(value);
  if (absolute > 0 && absolute < 0.01) {
    return `$${value.toLocaleString("en-US", { maximumSignificantDigits: 6 })}`;
  }
  return `$${new Intl.NumberFormat("en-US", {
    notation: absolute >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: absolute >= 1_000 ? 1 : 2,
  }).format(value)}`;
}

function percentRatio(value, digits = 1) {
  if (!finite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

function percentValue(value, digits = 1) {
  if (!finite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

function metricValue(metric) {
  if (!metric || !finite(metric.value)) return "—";
  if (metric.unit === "usd") return usd(metric.value);
  if (metric.unit === "percent") return percentRatio(metric.value);
  if (metric.unit === "seconds") return `${compactNumber(metric.value, 2)} 秒`;
  return compactNumber(metric.value);
}

function dateLabel(value, includeTime = false) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return String(value);
  const options = includeTime
    ? { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }
    : { year: "numeric", month: "2-digit", day: "2-digit" };
  return new Intl.DateTimeFormat("zh-CN", options).format(parsed);
}

function changeClass(value) {
  if (!finite(value) || value === 0) return "";
  return value > 0 ? "is-positive" : "is-negative";
}

function metricById(chain, id) {
  return chain?.metrics?.find((metric) => metric.id === id) ?? null;
}

function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}

function renderGlobal(data) {
  const status = data?.status ?? "unavailable";
  $("#product-status-dot").dataset.status = status;
  setText(
    "#product-status",
    status === "success" ? "数据正常" : status === "partial" ? "部分来源异常" : "数据不可用",
  );
  setText("#product-updated", `更新 ${dateLabel(data?.generatedAt, true)}`);

  const warning = $("#product-warning");
  const affected = data?.sources?.filter((source) => source.status !== "ok") ?? [];
  if (affected.length) {
    const failed = affected.filter((source) => source.status === "failed").length;
    const degraded = affected.length - failed;
    const parts = [
      failed ? `${failed} 个数据模块不可用` : "",
      degraded ? `${degraded} 个数据模块部分可用` : "",
    ].filter(Boolean);
    warning.textContent = `${parts.join("、")}；相关判断已暂停或降级，详情见各页数据状态。`;
    warning.hidden = false;
  } else {
    warning.hidden = true;
  }
}

function chainTone(chain) {
  if (chain?.confidence?.label === "低" || chain?.overallState === "unknown") return "watch";
  if (["leading", "expanding", "strong"].includes(chain?.overallState)) return "positive";
  if (["weakening", "contracting", "lagging"].includes(chain?.overallState)) return "negative";
  return "watch";
}

function renderToday(data) {
  const { chain, cashcat, intelligence } = data;
  setText("#today-date", chain.targetDate ?? "—");
  setText("#today-headline", chain.headline);
  setText("#today-signal-label", chain.overallState === "unknown" ? "暂不下结论" : chain.position.label);
  setText("#today-signal-evidence", chain.confidence.evidence);
  $("#today-signal").dataset.tone = chainTone(chain);

  const chainConclusionUnavailable = chain.overallState === "unknown";
  setText(
    "#today-chain-label",
    chainConclusionUnavailable ? "暂不下结论" : `${chain.position.label} · ${chain.momentum.label}`,
  );
  setText(
    "#today-chain-note",
    chainConclusionUnavailable ? chain.confidence.evidence : chain.quality.evidence,
  );
  const structural = intelligence?.leader?.structuralLeader;
  setText("#today-leader-symbol", structural?.symbol ?? "尚未确认");
  setText("#today-leader-note", structural?.reason ?? "当前没有足够的四维可比数据。");
  setText("#today-cashcat-state", cashcat.decision.label);
  setText("#today-cashcat-note", cashcat.decision.summary);

  const selected = [
    metricById(chain, "transactions"),
    metricById(chain, "active_addresses"),
    metricById(chain, "stablecoin_supply"),
    metricById(chain, "dex_volume"),
    metricById(chain, "app_revenue"),
  ].filter(Boolean);
  const container = $("#today-metrics");
  container.replaceChildren();
  for (const metric of selected) {
    const card = element("article");
    card.append(element("span", "", metric.shortLabel || metric.label));
    card.append(element("strong", "", metricValue(metric)));
    const change = element(
      "small",
      changeClass(metric.change7d),
      finite(metric.change7d) ? `7 日 ${percentRatio(metric.change7d)}` : "7 日变化暂无",
    );
    card.append(change);
    container.append(card);
  }
  if (!selected.length) container.append(element("p", "empty-state", "完整日指标暂不可用。"));

  setText("#today-cashcat-symbol", cashcat.token.symbol);
  setText("#today-cashcat-price", usd(cashcat.token.priceUsd));
  setText("#today-cashcat-volume", usd(cashcat.token.volumes.h24));
  setText("#today-cashcat-holders", compactNumber(cashcat.token.holderCount));
  setText("#today-cashcat-summary", cashcat.decision.summary);
  setText("#today-cashcat-pill", cashcat.decision.label);
  $("#today-cashcat-pill").dataset.state = cashcat.decision.state;
}

function renderMarket(data) {
  const { chain } = data;
  setText("#market-headline", chain.headline);
  setText("#market-date", chain.targetDate ? `${chain.targetDate} 数据` : "日期未知");
  for (const [key, dimension] of [
    ["position", chain.position],
    ["momentum", chain.momentum],
    ["quality", chain.quality],
    ["confidence", chain.confidence],
  ]) {
    setText(`#market-${key}`, dimension.label);
    setText(`#market-${key}-note`, dimension.evidence);
  }

  const body = $("#market-metric-body");
  body.replaceChildren();
  for (const metric of chain.metrics ?? []) {
    const row = document.createElement("tr");
    row.title = metric.definition;
    row.append(element("td", "", metric.label));
    row.append(element("td", "", metricValue(metric)));
    row.append(
      element(
        "td",
        changeClass(metric.change7d),
        finite(metric.change7d) ? percentRatio(metric.change7d) : "—",
      ),
    );
    row.append(
      element(
        "td",
        changeClass(metric.change30d),
        finite(metric.change30d) ? percentRatio(metric.change30d) : "—",
      ),
    );
    row.append(element("td", "", metric.dataDate ?? "—"));
    body.append(row);
  }
  if (!chain.metrics?.length) {
    const row = document.createElement("tr");
    const cell = element("td", "", "全链指标暂不可用。");
    cell.colSpan = 5;
    row.append(cell);
    body.append(row);
  }
  renderSources("#market-sources", data.sources);
}

function renderSources(selector, sources) {
  const container = $(selector);
  container.replaceChildren();
  for (const source of sources ?? []) {
    const row = element("div", "source-row");
    row.append(element("strong", "", source.label));
    const state = element(
      "span",
      "source-state",
      source.status === "ok" ? "正常" : source.status === "degraded" ? "部分可用" : "不可用",
    );
    state.dataset.status = source.status;
    row.append(state);
    row.append(element("p", "", source.note));
    row.append(element("time", "", dateLabel(source.observedAt, true)));
    container.append(row);
  }
  if (!sources?.length) container.append(element("p", "empty-state", "来源状态暂不可用。"));
}

function renderAlpha(data) {
  const { intelligence } = data;
  const heat = intelligence?.chainHeat;
  setText("#alpha-chain-heat", heat?.label ?? "数据不足");
  setText("#alpha-chain-note", heat?.warning ?? "等待链活动与市场广度形成可比结果。");
  const leader = intelligence?.leader?.structuralLeader;
  setText("#alpha-leader", leader?.symbol ?? "—");
  setText("#alpha-leader-note", leader?.reason ?? "当前没有足够证据确认结构龙头。");

  const container = $("#alpha-token-list");
  container.replaceChildren();
  const rows = (intelligence?.tokenHeat?.rows ?? []).slice(0, 8);
  rows.forEach((token, index) => {
    const row = element("article", "alpha-row");
    row.append(element("span", "alpha-row__index", String(index + 1).padStart(2, "0")));
    const identity = element("div", "alpha-row__token");
    identity.append(element("strong", "", token.symbol || token.name || "未知代币"));
    identity.append(element("small", "", token.name || token.address.slice(0, 10)));
    row.append(identity);
    for (const [label, value] of [
      ["市值", usd(token.marketCapUsd)],
      ["24H 成交", usd(token.volume24hUsd)],
      ["换手", percentRatio(token.turnover24h)],
    ]) {
      const metric = element("div", "alpha-row__metric");
      metric.append(element("strong", "", value));
      metric.append(element("span", "", label));
      row.append(metric);
    }
    const state = element("span", "heat-label", HEAT_LABELS[token.state] ?? "数据不足");
    state.dataset.state = token.state ?? "unknown";
    row.append(state);
    container.append(row);
  });
  if (!rows.length) container.append(element("p", "empty-state", "代币温度暂不可用。"));
}

function dimensionNarrative(item) {
  if (!finite(item.ratioToLeader)) return "当前没有可比基准。";
  if (item.ratioToLeader >= 1) {
    return item.leaderSymbol
      ? `约为 ${item.leaderSymbol} 的 ${item.ratioToLeader.toFixed(2)} 倍。`
      : "当前处于该维度第一位。";
  }
  return item.leaderSymbol
    ? `约为 ${item.leaderSymbol} 的 ${percentRatio(item.ratioToLeader)}。`
    : "当前可比对象信息不足。";
}

function renderChart(history) {
  const host = $("#asset-chart");
  host.replaceChildren();
  const candles = history?.candles?.filter((item) => finite(item.closeUsd)) ?? [];
  if (candles.length < 2) {
    host.append(element("p", "empty-state", "24 小时价格序列暂不可用。"));
    return;
  }
  const values = candles.map((item) => item.closeUsd);
  let minimum = Math.min(...values);
  let maximum = Math.max(...values);
  if (minimum === maximum) {
    minimum *= 0.99;
    maximum *= 1.01;
  }
  const width = 900;
  const height = 210;
  const padding = 6;
  const points = values.map((value, index) => {
    const x = padding + (index / (values.length - 1)) * (width - padding * 2);
    const y = padding + ((maximum - value) / (maximum - minimum)) * (height - padding * 2);
    return [x, y];
  });
  const path = points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${path} L${points.at(-1)[0].toFixed(2)},${height} L${points[0][0].toFixed(2)},${height} Z`;
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "CashCat 24 小时价格曲线");
  for (const ratio of [0.25, 0.5, 0.75]) {
    const line = document.createElementNS(namespace, "line");
    line.setAttribute("x1", "0");
    line.setAttribute("x2", String(width));
    line.setAttribute("y1", String(height * ratio));
    line.setAttribute("y2", String(height * ratio));
    line.setAttribute("class", "chart-grid-line");
    svg.append(line);
  }
  const areaPath = document.createElementNS(namespace, "path");
  areaPath.setAttribute("d", area);
  areaPath.setAttribute("class", "chart-area");
  svg.append(areaPath);
  const linePath = document.createElementNS(namespace, "path");
  linePath.setAttribute("d", path);
  linePath.setAttribute("class", "chart-line");
  svg.append(linePath);
  host.append(svg);
}

function renderAsset(data) {
  const { cashcat } = data;
  const token = cashcat.token;
  setText("#asset-name", token.name);
  setText("#asset-address", token.address);
  setText("#asset-decision-label", cashcat.decision.label);
  setText("#asset-decision-summary", cashcat.decision.summary);
  $("#asset-decision").dataset.state = cashcat.decision.state;
  setText("#asset-price", usd(token.priceUsd));
  setText("#asset-observed", `实时快照 · ${dateLabel(cashcat.observedAt, true)}`);
  setText("#asset-market-cap", usd(token.marketCapUsd));
  setText("#asset-liquidity", usd(token.mainPoolLiquidityUsd));
  setText("#asset-volume", usd(token.volumes.h24));
  setText("#asset-holders", compactNumber(token.holderCount));

  const reasons = $("#asset-reasons");
  reasons.replaceChildren();
  const items = cashcat.decision.reasons?.length
    ? cashcat.decision.reasons
    : ["当前没有足够的新鲜证据形成判断。"];
  for (const reason of items) reasons.append(element("li", "", reason));

  setText("#asset-price-change", percentValue(cashcat.priceHistory24h.changePercent));
  setText("#asset-low", usd(cashcat.priceHistory24h.lowUsd));
  setText("#asset-high", usd(cashcat.priceHistory24h.highUsd));
  renderChart(cashcat.priceHistory24h);

  const dimensions = $("#asset-dimensions");
  dimensions.replaceChildren();
  for (const item of cashcat.leader.dimensions ?? []) {
    const card = element("article", "dimension-card");
    card.append(element("span", "", item.label));
    card.append(element("strong", "", item.rank ? `第 ${item.rank}` : "暂无排名"));
    card.append(element("small", "", SOURCE_LABELS[item.state] ?? item.state ?? "未知"));
    const track = element("div", "ratio-track");
    const fill = document.createElement("i");
    fill.style.width = `${Math.min(100, Math.max(0, (item.ratioToLeader ?? 0) * 100))}%`;
    track.append(fill);
    card.append(track);
    card.append(element("p", "", dimensionNarrative(item)));
    dimensions.append(card);
  }
  if (!cashcat.leader.dimensions?.length) {
    dimensions.append(element("p", "empty-state", "四维排名暂不可用。"));
  }

  setText("#asset-attention-share", percentRatio(cashcat.attention.robinhoodAttentionShare));
  setText("#asset-attention-baseline", `${compactNumber(cashcat.attention.attentionToBaseline, 2)} 倍`);
  setText("#asset-activity-baseline", `${compactNumber(cashcat.attention.activityToBaseline, 2)} 倍`);
  setText("#asset-founder", SOURCE_LABELS[cashcat.narrative.founderSupport.toUpperCase()] ?? "证据不足");
  setText("#asset-mainstream", SOURCE_LABELS[cashcat.narrative.mainstreamAttention.toUpperCase()] ?? "证据不足");
  setText("#asset-hotspot", SOURCE_LABELS[cashcat.narrative.externalHotspot.toUpperCase()] ?? "证据不足");

  renderSources(
    "#asset-sources",
    (cashcat.sourceHealth ?? []).map((source) => ({
      label: source.label,
      status: source.status === "OK" ? "ok" : source.status === "ERROR" ? "failed" : "degraded",
      note: source.status === "OK" ? "该来源最近一次读取正常。" : "该来源当前需要核对。",
      observedAt: source.observedAt,
    })),
  );
}

function render(data) {
  renderGlobal(data);
  renderToday(data);
  renderMarket(data);
  renderAlpha(data);
  renderAsset(data);
}

async function load() {
  try {
    const response = await fetch("/api/product/today", {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    render(data);
  } catch {
    $("#product-status-dot").dataset.status = "unavailable";
    setText("#product-status", "暂时无法连接数据");
    const warning = $("#product-warning");
    warning.textContent = "读取失败。页面不会用旧数字或 0 代替，请稍后重试。";
    warning.hidden = false;
  }
}

function initialize() {
  document.title = PAGE_TITLES[PRODUCT_PAGE];
  $$(`[data-page]`).forEach((page) => {
    page.hidden = page.dataset.page !== PRODUCT_PAGE;
  });
  $$(`[data-nav]`).forEach((link) => {
    link.classList.toggle("is-active", link.dataset.nav === PRODUCT_PAGE);
    if (link.dataset.nav === PRODUCT_PAGE) link.setAttribute("aria-current", "page");
  });
  void load();
  window.setInterval(() => {
    if (!document.hidden) void load();
  }, 60_000);
}

initialize();
