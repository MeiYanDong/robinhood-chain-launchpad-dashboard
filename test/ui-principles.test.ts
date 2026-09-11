import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const htmlUrl = new URL("../public/index.html", import.meta.url);
const appUrl = new URL("../public/app.js", import.meta.url);
const stylesV2Url = new URL("../public/styles-v2.css", import.meta.url);
const packageUrl = new URL("../package.json", import.meta.url);

test("current frontend assets use the package version as their cache key", async () => {
  const [html, packageText] = await Promise.all([
    readFile(htmlUrl, "utf8"),
    readFile(packageUrl, "utf8"),
  ]);
  const version = (JSON.parse(packageText) as { version: string }).version;

  assert.match(html, new RegExp(`styles-v2\\.css\\?v=${version.replaceAll(".", "\\.")}`));
  assert.match(html, new RegExp(`workbench\\.css\\?v=${version.replaceAll(".", "\\.")}`));
  assert.match(html, new RegExp(`app\\.js\\?v=${version.replaceAll(".", "\\.")}`));
});

test("primary navigation unifies full-chain and PAIR workbenches without promoting CashCat", async () => {
  const html = await readFile(htmlUrl, "utf8");

  assert.match(html, /href="\/chain\/" data-product="chain"[^>]*>全链数据/);
  assert.match(html, /href="\/launchpads\/" data-product="launchpads"[^>]*>PAIR 经营/);
  assert.match(html, /href="\/pair-alpha\/" data-product="pair-alpha"[^>]*>PAIR Alpha/);
  assert.match(html, /href="\/pair-v2\/" data-product="pair-v2"[^>]*>PAIR V2/);
  assert.match(html, /href="\/pair-flow\/" data-product="pair-flow"[^>]*>资金闭环/);
  assert.equal((html.match(/data-product="[^"]+"/g) ?? []).length, 5);
  assert.doesNotMatch(html, /CashCat 日报|href="\/assets\/cashcat\/"/);
});

test("full-chain data uses the PAIR workbench hierarchy and keeps evidence states explicit", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(htmlUrl, "utf8"),
    readFile(appUrl, "utf8"),
    readFile(new URL("../public/workbench.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /id="chain-view"[^>]*aria-label="Robinhood Chain 全链数据"/);
  assert.match(html, /全链最近怎么样/);
  assert.match(html, /id="chain-answer-title"/);
  assert.match(html, /id="chain-primary-metrics"/);
  assert.match(html, /id="chain-metric-body"/);
  assert.match(html, /id="chain-pillar-list"/);
  assert.match(html, /id="chain-insight-list"/);
  assert.match(html, /id="chain-stock-coverage"/);
  assert.match(html, /href="\/leaders\/"[^>]*>[\s\S]*看龙头与热度/);
  assert.match(app, /CHAIN_PRIMARY_METRICS/);
  assert.match(app, /rootApi\("\/api\/latest"\)/);
  assert.match(app, /api\("\/api\/product\/today"\)/);
  assert.match(app, /`落后 \$\{formatCount\(lagDays\)\} 天`/);
  assert.match(html, /缺失数据保持未知/);
  assert.match(styles, /body\[data-product-context="chain"\]/);
  assert.doesNotMatch(html, /CashCat/);
});

test("launchpad dashboard is split into four task views and defaults to a concise overview", async () => {
  const html = await readFile(htmlUrl, "utf8");

  assert.match(html, /href="\/launchpads\/" data-launchpad-view="overview">今日概览/);
  assert.match(html, /href="\/launchpads\/\?view=platforms"[^>]*>平台经营/);
  assert.match(html, /href="\/launchpads\/\?view=valuation"[^>]*>PAIR vs PONS/);
  assert.match(html, /href="\/launchpads\/\?view=tokens"[^>]*>平台代币/);
  assert.match(html, /id="launchpad-overview"/);
  assert.match(html, /id="overview-volume-leader"/);
  assert.match(html, /id="overview-activity-leader"/);
  assert.match(html, /id="overview-valuation-gap"/);
  assert.match(html, /id="overview-platform-body"/);
  assert.match(html, /id="overview-insight-list"/);
  assert.match(html, /id="overview-trend-chart"/);
  assert.match(html, /id="overview-volume-date-heading"/);
  assert.match(html, /id="overview-valuation-label"/);
  assert.match(html, /id="valuation-deviation-label"/);
  assert.match(html, /id="metric-help-popover"[^>]*role="tooltip"[^>]*hidden/);
  assert.match(html, /data-help-title="什么是相较自身历史常态？"/);
  assert.match(html, /data-help-title="为什么这是 PAIR 的参考价？"/);
  assert.match(html, /id="platform-activity-cards"/);
  assert.match(html, /data-activity-window="7"/);
  assert.match(html, /data-activity-window="30"/);
  assert.match(html, /data-volume-window="lifetime"/);
  assert.match(html, /id="platform-activity-chart"/);
  assert.match(html, /id="platform-operation-body"/);
  assert.match(html, />PAIR vs PONS</);
  assert.match(html, />资金闭环</);
  assert.match(html, /id="pair-flow-main-today"/);
  assert.match(html, /id="pair-flow-bought-total"/);
  assert.match(html, /id="pair-flow-policy-usd"/);
  assert.match(html, /id="pair-flow-locker-pair"/);
  assert.match(html, /id="valuation-estimate-price"/);
  assert.match(html, /id="valuation-seven-day-estimate"/);
  assert.match(html, /按最新完整日平台量折算的 PAIR 参考价/);
  assert.match(html, /7 日平滑对照/);
  assert.match(html, /id="valuation-formula-definition"/);
  assert.match(html, /PONS 价格 ×（PONS 有效供应量 ÷ PAIR 有效供应量）/);
  assert.match(html, /id="valuation-equation-substitution"/);
  assert.match(html, /id="valuation-window-state"/);
  assert.match(html, /id="valuation-input-pons-price"/);
  assert.match(html, /id="valuation-input-pair-supply"/);
  assert.match(html, /id="valuation-input-pons-volume"/);
  assert.match(html, /id="valuation-input-pair-volume"/);
  assert.match(html, /id="valuation-volume-heading"/);
  assert.match(html, /id="valuation-policy-equation"/);
  assert.match(html, /id="valuation-reasons"/);
  assert.match(html, /id="valuation-history-chart"/);
  assert.match(html, /id="pons-forecast-midpoint"/);
  assert.match(html, /id="pons-forecast-upside-label"/);
  assert.match(html, /id="pair-adjusted-anchor"/);
  assert.match(html, /id="pair-holder-signal"/);
  assert.match(html, /id="valuation-daily-body"/);
  assert.match(html, />当前价格</);
  assert.match(html, />平台经营</);
  assert.match(html, />回购核验</);
  assert.match(html, />数据源市值</);
  assert.match(html, />扣除销毁后市值</);
  assert.match(html, /协议收入<br \/>应计/);
  assert.match(html, /协议收入<br \/>实收/);
  assert.match(html, />成交量 </);
  assert.match(html, />用户手续费 </);
  assert.match(html, />平台收入 </);
  assert.doesNotMatch(html, />Revenue</);
  assert.doesNotMatch(html, /PRIA/);
  assert.match(html, /<details[\s\S]*id="platform-economics-disclosure"/);
  assert.match(html, /<details[\s\S]*id="buyback-disclosure"/);
  assert.match(html, /七日预测实验（样本不足时自动停用）/);
  assert.doesNotMatch(html, /日估值中间 50%|独立七日上涨占比|90% \/ 80% 情景|三强快照/);
  assert.doesNotMatch(html, /闭合日|相对平时|PONS 规模参考价|现价 PONS 锚|现价锚/);
  assert.doesNotMatch(
    html,
    /COVERAGE BEFORE|先看覆盖|数字先上桌|Launchpad ledger|ACCOUNTING NOTES|SOURCE ROUTES|TOKEN VALUE|PLATFORM ECONOMICS|PLATFORM ACTIVITY|BUYBACK PROOF/,
  );
});

test("economics client keeps unknown, not-applicable, and refresh routes distinct", async () => {
  const app = await readFile(appUrl, "utf8");

  assert.match(app, /api\("\/api\/economics"\)/);
  assert.match(app, /api\("\/api\/platform-activity"\)/);
  assert.match(app, /api\("\/api\/economics\/valuation\/history"\)/);
  assert.match(app, /api\("\/api\/pair\/flow"\)/);
  assert.match(app, /api\("\/api\/pair\/flow\/refresh", \{ method: "POST" \}\)/);
  assert.match(app, /api\("\/api\/economics\/refresh", \{ method: "POST" \}\)/);
  assert.match(app, /window\.setInterval\([\s\S]*60_000/);
  assert.match(app, /pollEconomicsCache[\s\S]*await loadEconomics\(\)/);
  assert.doesNotMatch(
    app.match(/async function pollEconomicsCache[\s\S]*?\n\}/)?.[0] ?? "",
    /method: "POST"/,
  );
  assert.match(app, /not_applicable/);
  assert.match(app, /派生 · \$\{qualityLabel\}/);
  assert.match(app, /evidence-badge--quiet/);
  assert.match(app, /One or more source results require attention/);
  assert.match(app, /renderLaunchpadOverview\(\)/);
  assert.match(app, /renderPlatformOperations\(\)/);
  assert.match(app, /renderPlatformActivity\(\)/);
  assert.match(app, /renderPairFlow\(\)/);
  assert.match(app, /未知/);
  assert.match(app, /不适用/);
  assert.match(app, /formatTokenPrice/);
  assert.match(app, /evidenceCell\(token\.priceUsd, formatTokenPrice\)/);
  assert.match(app, /renderValuationCalculation\(valuation\)/);
  assert.match(app, /renderPonsForecast\(\)/);
  assert.match(app, /reliableForecast[\s\S]*暂无可靠七日预测/);
  assert.match(app, /matchedSampleCount[\s\S]*backtestMedianAbsoluteErrorPercent/);
  assert.match(app, /state\.valuationHistory\?\.daily/);
  assert.match(app, /PAIR 持币地址.*尚未进入当前公式/);
  assert.match(app, /LAUNCHPAD_VIEW/);
  assert.match(app, /URLSearchParams\(window\.location\.search\)/);
  assert.match(app, /valuation\?\.formula/);
  assert.match(app, /valuation\?\.inputs/);
  assert.match(app, /ponsEffectiveSupply/);
  assert.match(app, /pairEffectiveSupply/);
  assert.match(app, /ponsPlatformVolumeUsd/);
  assert.match(app, /pairPlatformVolumeUsd/);
  assert.match(app, /距最新可统计日期/);
  assert.doesNotMatch(app, /PRIA/);
});

test("launchpad wording, chart scale, and platform colors share one semantic contract", async () => {
  const [app, styles] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(stylesV2Url, "utf8"),
  ]);
  const overviewChart = app.match(
    /function renderOverviewTrendChart\(\) \{[\s\S]*?\n\}\n\nfunction renderLaunchpadOverview/,
  )?.[0];

  assert.ok(overviewChart);
  assert.match(overviewChart, /chartMax = rawMax > 0 \? rawMax \* 1\.08 : 1/);
  assert.match(overviewChart, /Math\.max\(0, value\) \/ Math\.max\(1, chartMax\)/);
  assert.match(overviewChart, /overview-trend-end--\$\{endpoint\.platform\.platformId\}/);
  assert.doesNotMatch(overviewChart, /Math\.log|logMin|logMax/);
  assert.match(app, /`\$\{dayLabel\}交易量`/);
  assert.match(app, /dataset\.label = "三平台交易量占比"/);
  assert.match(app, /gapDirection[\s\S]*"溢价"[\s\S]*"折价"/);
  assert.match(app, /bindMetricHelp\(\)/);
  assert.doesNotMatch(app, /闭合日|相对平时|PONS 规模参考价|现价 PONS 锚|现价锚/);

  assert.match(styles, /--platform-pons: var\(--acid\)/);
  assert.match(styles, /--platform-long: var\(--amber\)/);
  assert.match(styles, /--platform-pair: var\(--cyan\)/);
  assert.match(
    styles,
    /activity-legend \[data-platform-id="long"\][\s\S]*background: var\(--platform-long\)/,
  );
  assert.match(
    styles,
    /activity-legend \[data-platform-id="pair"\][\s\S]*background: var\(--platform-pair\)/,
  );
  assert.match(styles, /overview-trend-line--long[\s\S]*stroke: var\(--platform-long\)/);
  assert.match(styles, /overview-trend-line--pair[\s\S]*stroke: var\(--platform-pair\)/);
  assert.match(styles, /content: attr\(data-label\)/);
});

test("coverage and source audit stay on demand", async () => {
  const html = await readFile(htmlUrl, "utf8");

  assert.match(html, /id="method-button"/);
  assert.match(html, /id="method-drawer"[^>]*aria-hidden="true"[^>]*inert/);
  assert.doesNotMatch(html, /id="coverage-view"/);
});

test("PAIR capital loop has a standalone route and transaction-level ledgers", async () => {
  const [html, app] = await Promise.all([readFile(htmlUrl, "utf8"), readFile(appUrl, "utf8")]);

  assert.match(html, /class="pair-flow-teaser"[^>]*href="\/pair-flow\/"/);
  assert.match(html, /class="pair-flow-panel pair-flow-panel--standalone"/);
  assert.match(html, /id="pair-flow-buyback-body"/);
  assert.match(html, /id="pair-flow-burn-body"/);
  assert.match(html, /data-flow-window="all"/);
  assert.match(app, /leaders\|launchpads\|pair-flow/);
  assert.match(app, /api\/pair\/flow\/events\?type=all/);
  assert.match(app, /renderPairFlowEvents/);
});

test("PAIR V2 separates quality, timing, heat, risk, and shadow outcomes", async () => {
  const [html, app] = await Promise.all([readFile(htmlUrl, "utf8"), readFile(appUrl, "utf8")]);

  assert.match(html, /data-dataset="pair_v2"[^>]*data-product-context="pair-v2"/);
  assert.match(html, /id="pair-v2-view"/);
  assert.match(html, /id="pair-v2-token-body"/);
  assert.match(html, /id="pair-team-launch-body"/);
  assert.match(html, /PAIR 项目方新发行/);
  assert.match(html, /已核验主发行钱包/);
  assert.match(html, /官方明确确认/);
  assert.match(html, /同钱包、未确认背书/);
  assert.match(html, /同一钱包发行 ≠ PAIR 官方背书/);
  assert.match(html, /id="pair-v2-event-body"/);
  assert.match(html, /id="pair-v2-pending-buckets"/);
  assert.match(html, /项目方发了什么，哪些新币值得看/);
  assert.match(html, /data-v2-lens="research"/);
  assert.match(html, /id="pair-v2-model-day-progress"/);
  assert.match(html, /id="pair-v2-horizons"/);
  assert.match(html, /成交 × 1% × 70% · 计算值/);
  assert.match(html, /链上回购事件/);
  assert.doesNotMatch(html, /CANONICAL RELEASE|DISCOVERY → CONFIRMATION|ONCHAIN LEDGER|DATA PLANE/);
  assert.match(app, /api\("\/api\/pair\/v2"\)/);
  assert.match(app, /api\/dev-monitor\/pair-team-launches/);
  assert.match(app, /renderPairTeamLaunches/);
  assert.match(app, /pollPairV2Cache[\s\S]*await loadPairV2\(\)/);
  assert.match(app, /window\.setInterval\(\(\) => \{[\s\S]*pollPairV2Cache\(\)[\s\S]*8_000/);
  assert.doesNotMatch(
    app.match(/async function pollPairV2Cache[\s\S]*?\n\}/)?.[0] ?? "",
    /method: "POST"/,
  );
  assert.match(app, /quality\.state/);
  assert.match(app, /signal\.researchEligible/);
  assert.match(app, /heat\.state/);
  assert.match(app, /riskProfile\.token/);
  assert.match(app, /evidence\.confidence/);
  assert.match(app, /function pairQuoteAssetLabel/);
  assert.match(app, /配对资产 ·/);
  assert.doesNotMatch(app, /compositeScore|综合分/);
});

test("PAIR Alpha is a standalone all-generation signal terminal with explicit no-chase", async () => {
  const [html, app] = await Promise.all([readFile(htmlUrl, "utf8"), readFile(appUrl, "utf8")]);

  assert.match(html, /data-dataset="pair_alpha"[^>]*data-product-context="pair-alpha"/);
  assert.match(html, /id="pair-alpha-view"/);
  assert.match(html, /id="pair-alpha-token-body"/);
  assert.match(html, /data-alpha-lane="ignition_watch"/);
  assert.match(html, /data-alpha-lane="retest_watch"/);
  assert.match(html, /data-alpha-lane="no_chase"/);
  assert.match(html, /净流入<\/dt><dd>暂不可得/);
  assert.match(html, /id="pair-alpha-horizons"/);
  assert.match(app, /api\("\/api\/pair\/alpha"\)/);
  assert.match(app, /pollPairAlphaCache[\s\S]*await loadPairAlpha\(\)/);
  assert.match(app, /pairAlphaActionState/);
  assert.doesNotMatch(app, /compositeScore|综合分/);
});

test("mobile PAIR navigation keeps the five primary workbench tasks reachable", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(htmlUrl, "utf8"),
    readFile(appUrl, "utf8"),
    readFile(stylesV2Url, "utf8"),
  ]);

  assert.equal((html.match(/data-product="[^"]+"/g) ?? []).length, 5);
  assert.match(styles, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(styles, /overflow-x: auto/);
  assert.match(app, /activeProduct\.offsetLeft/);
});

test("mainstream view is stable and registry-driven", async () => {
  const app = await readFile(appUrl, "utf8");

  assert.match(app, /platformScope: "mainstream"/);
  assert.match(app, /platform\.status === "live"/);
  assert.match(app, /const CORE_METRICS = \["volume_usd", "fees_usd", "protocol_revenue_usd"\]/);
});

test("PAIR token radar is an explicit data view with four independent rankings", async () => {
  const [html, app] = await Promise.all([readFile(htmlUrl, "utf8"), readFile(appUrl, "utf8")]);

  assert.match(html, /data-dataset="pair"[^>]*data-product-context="launchpads"[\s\S]*PAIR 代币/);
  assert.match(html, /data-pair-mode="live">实时榜</);
  assert.match(html, /data-pair-mode="daily">08:00 日报</);
  assert.match(html, /data-dataset="long"[^>]*data-product-context="launchpads"[\s\S]*Long 代币/);
  assert.match(html, /data-long-mode="live">实时榜</);
  assert.match(html, /data-long-mode="daily">08:00 日报</);
  assert.match(html, /活跃样本<strong id="long-universe-count">/);
  assert.match(app, /"market_cap_usd"/);
  assert.match(app, /"liquidity_depth_usd"/);
  assert.match(app, /"volume_24h_usd"/);
  assert.match(app, /"holder_count"/);
  assert.match(app, /pair-rank-row__quote/);
  assert.doesNotMatch(app, /compositeScore|综合分/);
});

test("PAIR-style intelligence entry keeps leader, heat, and valuation as separate models", async () => {
  const [html, app] = await Promise.all([readFile(htmlUrl, "utf8"), readFile(appUrl, "utf8")]);

  assert.match(html, /href="\/chain\/"[^>]*data-product="chain"/);
  assert.match(html, /href="\/leaders\/"/);
  assert.match(html, /href="\/pair-alpha\/"[^>]*data-product="pair-alpha"/);
  assert.match(html, /href="\/pair-flow\/"[^>]*data-product="pair-flow"/);
  assert.match(
    html,
    /data-dataset="intelligence"[^>]*data-product-context="leaders"[\s\S]*龙头 \/ 热度 \/ 估值/,
  );
  assert.match(html, /data-launchpad-view="overview"/);
  assert.match(html, /id="structural-leader-symbol"/);
  assert.match(html, /id="chain-heat-state"/);
  assert.match(html, /id="token-heat-body"/);
  assert.match(html, /id="cohort-grid"/);
  assert.match(app, /INITIAL_DATASET[\s\S]*"intelligence"/);
  assert.match(app, /document\.body\.dataset\.productContext = product/);
  assert.match(app, /document\.body\.dataset\.launchpadView/);
  assert.match(app, /api\("\/api\/intelligence"\)/);
  assert.match(app, /api\("\/api\/intelligence\/refresh", \{ method: "POST" \}\)/);
  assert.doesNotMatch(app, /compositeScore|综合分/);
});
