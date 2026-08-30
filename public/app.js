const CORE_METRICS = ["volume_usd", "fees_usd", "protocol_revenue_usd"];
const METRIC_LABELS = {
  volume_usd: "成交量",
  fees_usd: "用户手续费",
  protocol_revenue_usd: "平台收入",
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

const state = {
  windowDays: 1,
  overview: null,
  coverage: null,
  sources: null,
  methodLoaded: false,
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
  const response = await fetch(path, {
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
    throw new Error(message);
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
    stack.append(element("div", `notice${type === "error" ? " is-error" : ""}`, message));
  }
}

function renderRunState() {
  if (!state.overview) return;
  const runState = $("#run-state");
  const text = $("span", runState);
  runState.classList.remove("is-ok", "is-bad");
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
  if (metric.windowDays === 1) return metric.latestDate ? `UTC ${metric.latestDate.slice(5)}` : "已观测";
  return `${metric.observedDays}/${metric.windowDays} 日`;
}

function metricCell(metric) {
  const cell = element("td", "metric-cell");
  const value = element("span", `metric-value${metric.value === null ? " is-null" : ""}`, formatUsd(metric.value));
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
  const card = element("article", `platform-card${platform.excludeFromTotals ? " excluded-row" : ""}`);
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
      element("strong", platform.metrics[metric].value === null ? "is-null" : "", formatUsd(platform.metrics[metric].value)),
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

  $$('[data-sort]').forEach((button) => {
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

function coverageMark(metric) {
  const className = metric.observedDays === 0 ? "is-empty" : metric.coverage >= 1 ? "is-full" : "is-partial";
  const mark = element("span", `coverage-mark ${className}`);
  mark.textContent = metric.observedDays === 0 ? "—" : `${metric.observedDays}/30`;
  mark.title = `最近 ${metric.windowDays} 个闭合 UTC 日中有 ${metric.observedDays} 日观测`;
  return mark;
}

function renderMethod() {
  if (!state.coverage || !state.sources) return;

  const definitions = $("#definition-list");
  definitions.replaceChildren();
  for (const metric of CORE_METRICS) {
    const row = element("article", "definition-row");
    row.append(
      element("strong", "", METRIC_LABELS[metric]),
      element("p", "", state.coverage.definitions[metric] ?? "—"),
    );
    definitions.append(row);
  }

  const sourceList = $("#source-list");
  sourceList.replaceChildren();
  for (const source of state.sources.sources) {
    const row = element("article", "source-row");
    const top = element("div", "source-row__top");
    top.append(
      element("strong", "", source.source),
      element("span", `health-pill health-pill--${source.status}`, source.status),
    );
    const latency = Number.isFinite(source.latencyMs) ? ` · ${source.latencyMs}ms` : "";
    row.append(
      top,
      element("p", "", source.message),
      element("small", "", `数据 ${source.latestDataDate ?? "—"} · 抓取 ${formatDateTime(source.fetchedAt)}${latency}`),
    );
    sourceList.append(row);
  }

  const caveats = $("#caveat-list");
  caveats.replaceChildren();
  for (const caveat of state.coverage.caveats) caveats.append(element("li", "", caveat));

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
      : SCOPE_LABELS[platform.comparability] ?? platform.comparability;
    const chip = element("span", `scope-chip scope-chip--${platform.comparability}`, label);
    chip.title = platform.scope;
    scopeCell.append(chip);
    row.append(scopeCell);
    coverageBody.append(row);
  }
}

async function loadMethod() {
  if (state.methodLoaded) return;
  $("#definition-list").replaceChildren(element("p", "panel-loading", "正在加载…"));
  $("#source-list").replaceChildren();
  const [coverage, sources] = await Promise.all([api("/api/coverage"), api("/api/sources")]);
  state.coverage = coverage;
  state.sources = sources;
  state.methodLoaded = true;
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
    card.append(
      element("span", "", stat.label),
      element("strong", "", formatStatValue(stat)),
    );
    host.append(card);
  }
}

function renderChartTabs() {
  const host = $("#chart-tabs");
  host.replaceChildren();
  for (const metric of CORE_METRICS) {
    const button = element("button", metric === state.detailMetric ? "is-active" : "", METRIC_SHORT[metric]);
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
    padding.left + (maxTime === minTime ? plotWidth / 2 : ((time - minTime) / (maxTime - minTime)) * plotWidth);
  const y = (value) => padding.top + plotHeight - (value / maxValue) * plotHeight;

  const defs = svgElement("defs");
  const gradient = svgElement("linearGradient", { id: "chart-gradient", x1: "0", y1: "0", x2: "0", y2: "1" });
  gradient.append(
    svgElement("stop", { offset: "0%", "stop-color": "#60e6e4", "stop-opacity": "0.35" }),
    svgElement("stop", { offset: "100%", "stop-color": "#60e6e4", "stop-opacity": "0" }),
  );
  defs.append(gradient);
  svg.append(defs);

  const coordinates = points.map((point, index) => [x(timestamps[index]), y(point.value)]);
  const linePath = coordinates
    .map(([pointX, pointY], index) => `${index === 0 ? "M" : "L"}${pointX.toFixed(2)},${pointY.toFixed(2)}`)
    .join(" ");
  const firstX = coordinates[0][0];
  const lastX = coordinates.at(-1)[0];
  const baseline = padding.top + plotHeight;
  const areaPath = `${linePath} L${lastX.toFixed(2)},${baseline} L${firstX.toFixed(2)},${baseline} Z`;

  svg.append(svgElement("path", { d: areaPath, class: "chart-area" }));
  svg.append(svgElement("path", { d: linePath, class: "chart-line" }));
  const lastPoint = coordinates.at(-1);
  svg.append(svgElement("circle", { cx: lastPoint[0], cy: lastPoint[1], r: 4.5, class: "chart-dot" }));

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
    if (!$(".detail-drawer.is-open, .method-drawer.is-open")) document.body.classList.remove("panel-open");
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
    state.detailMetric = CORE_METRICS.find((metric) => state.detail.series[metric]?.length) ?? "volume_usd";
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
  $("#method-close").focus();
  try {
    await loadMethod();
  } catch (error) {
    $("#definition-list").replaceChildren(element("p", "panel-error", `数据说明加载失败：${error.message}`));
  }
}

function closeMethod() {
  closePanel("#method-drawer", "#method-backdrop");
}

async function loadOverview() {
  state.overview = await api(`/api/overview?window=${state.windowDays}`);
  renderOverview();
}

async function refreshDashboard() {
  const button = $("#refresh-button");
  button.disabled = true;
  button.classList.add("is-spinning");
  showNotices(["正在刷新数据…"]);
  try {
    await api("/api/refresh", { method: "POST" });
    state.methodLoaded = false;
    await loadOverview();
    if ($("#method-drawer").classList.contains("is-open")) await loadMethod();
  } catch (error) {
    showNotices([`刷新失败：${error.message}`], "error");
  } finally {
    button.disabled = false;
    button.classList.remove("is-spinning");
  }
}

function bindEvents() {
  $$('[data-window]').forEach((button) => {
    button.addEventListener("click", async () => {
      const windowDays = Number(button.dataset.window);
      if (![1, 7, 30].includes(windowDays) || windowDays === state.windowDays) return;
      state.windowDays = windowDays;
      $$('[data-window]').forEach((candidate) => candidate.classList.toggle("is-active", candidate === button));
      try {
        await loadOverview();
      } catch (error) {
        showNotices([`窗口切换失败：${error.message}`], "error");
      }
    });
  });

  $$('[data-platform-scope]').forEach((button) => {
    button.addEventListener("click", () => {
      state.platformScope = button.dataset.platformScope;
      $$('[data-platform-scope]').forEach((candidate) => candidate.classList.toggle("is-active", candidate === button));
      renderLedger();
    });
  });

  $("#platform-search").addEventListener("input", (event) => {
    state.search = event.target.value;
    renderLedger();
  });

  $$('[data-sort]').forEach((button) => {
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

bindEvents();

try {
  await loadOverview();
} catch (error) {
  showNotices([`数据加载失败：${error.message}`], "error");
  $("#run-state").classList.add("is-bad");
  $("span", $("#run-state")).textContent = "加载失败";
} finally {
  $("#loading-screen").classList.add("is-done");
}
