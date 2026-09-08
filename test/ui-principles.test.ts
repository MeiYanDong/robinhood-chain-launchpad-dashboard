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
  assert.match(html, new RegExp(`app\\.js\\?v=${version.replaceAll(".", "\\.")}`));
});

test("default dashboard leads with the three-platform economics comparison", async () => {
  const html = await readFile(htmlUrl, "utf8");

  assert.match(html, /class="is-active"[^>]*data-dataset="economics"/);
  assert.match(html, />代币价值</);
  assert.match(html, />三强快照</);
  assert.match(html, /id="triad-pons-price"/);
  assert.match(html, /id="triad-long-share"/);
  assert.match(html, /id="triad-pair-buyback"/);
  assert.match(html, /id="platform-activity-cards"/);
  assert.match(html, /data-activity-window="7"/);
  assert.match(html, /data-activity-window="30"/);
  assert.match(html, /data-volume-window="lifetime"/);
  assert.match(html, /id="platform-activity-chart"/);
  assert.match(html, />PAIR 相对估值</);
  assert.match(html, />资金闭环</);
  assert.match(html, /id="pair-flow-main-today"/);
  assert.match(html, /id="pair-flow-bought-total"/);
  assert.match(html, /id="pair-flow-policy-usd"/);
  assert.match(html, /id="pair-flow-locker-pair"/);
  assert.match(html, /id="valuation-estimate-price"/);
  assert.match(html, /id="valuation-formula-definition"/);
  assert.match(html, /PONS 价格 ×（PONS 有效供应量 ÷ PAIR 有效供应量）/);
  assert.match(html, /id="valuation-equation-substitution"/);
  assert.match(html, /id="valuation-window-state"/);
  assert.match(html, /id="valuation-input-pons-price"/);
  assert.match(html, /id="valuation-input-pair-supply"/);
  assert.match(html, /id="valuation-input-pons-volume"/);
  assert.match(html, /id="valuation-input-pair-volume"/);
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
  assert.match(html, />来源市值</);
  assert.match(html, />销毁调整市值</);
  assert.match(html, /协议收入<br \/>应计/);
  assert.match(html, /协议收入<br \/>实收/);
  assert.match(html, />成交量 </);
  assert.match(html, />用户手续费 </);
  assert.match(html, />平台收入 </);
  assert.doesNotMatch(html, />Revenue</);
  assert.doesNotMatch(html, /PRIA/);
  assert.match(html, /<details[\s\S]*id="platform-economics-disclosure"/);
  assert.match(html, /<details[\s\S]*id="buyback-disclosure"/);
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
  assert.match(app, /renderTriadSummary\(\)/);
  assert.match(app, /renderPlatformActivity\(\)/);
  assert.match(app, /renderPairFlow\(\)/);
  assert.match(app, /未知/);
  assert.match(app, /不适用/);
  assert.match(app, /formatTokenPrice/);
  assert.match(app, /evidenceCell\(token\.priceUsd, formatTokenPrice\)/);
  assert.match(app, /renderValuationCalculation\(valuation\)/);
  assert.match(app, /renderPonsForecast\(\)/);
  assert.match(app, /matchedRegime[\s\S]*独立七日上涨占比/);
  assert.match(app, /matchedRegime[\s\S]*历史基线/);
  assert.match(app, /state\.valuationHistory\?\.daily/);
  assert.match(app, /PAIR 持币地址.*模型权重 0/);
  assert.match(app, /valuation\?\.formula/);
  assert.match(app, /valuation\?\.inputs/);
  assert.match(app, /ponsEffectiveSupply/);
  assert.match(app, /pairEffectiveSupply/);
  assert.match(app, /ponsPlatformVolumeUsd/);
  assert.match(app, /pairPlatformVolumeUsd/);
  assert.match(app, /落后最近闭合日/);
  assert.doesNotMatch(app, /PRIA/);
});

test("coverage and source audit stay on demand", async () => {
  const html = await readFile(htmlUrl, "utf8");

  assert.match(html, /id="method-button"/);
  assert.match(html, /id="method-drawer"[^>]*aria-hidden="true"[^>]*inert/);
  assert.doesNotMatch(html, /id="coverage-view"/);
});

test("PAIR capital loop has a standalone route and transaction-level ledgers", async () => {
  const [html, app] = await Promise.all([readFile(htmlUrl, "utf8"), readFile(appUrl, "utf8")]);

  assert.match(html, /href="\/pair-flow\/"[^>]*data-product="pair-flow"/);
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

  assert.match(html, /href="\/pair-v2\/"[^>]*data-product="pair-v2"/);
  assert.match(html, /data-dataset="pair_v2"[^>]*data-product-context="pair-v2"/);
  assert.match(html, /id="pair-v2-view"/);
  assert.match(html, /id="pair-v2-token-body"/);
  assert.match(html, /id="pair-team-launch-body"/);
  assert.match(html, /PAIR 项目方发币/);
  assert.match(html, /已核验主发行钱包/);
  assert.match(html, /官方明确确认/);
  assert.match(html, /同钱包、未确认背书/);
  assert.match(html, /同一钱包发行 ≠ PAIR 官方背书/);
  assert.match(html, /id="pair-v2-event-body"/);
  assert.match(html, /id="pair-v2-pending-buckets"/);
  assert.match(html, /早期 Alpha 观察台/);
  assert.match(html, /data-v2-lens="research"/);
  assert.match(html, /id="pair-v2-model-day-progress"/);
  assert.match(html, /id="pair-v2-horizons"/);
  assert.match(html, /成交 × 1% × 70% · 计算值/);
  assert.match(html, /BuybackExecuted · 链上/);
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

  assert.match(html, /href="\/pair-alpha\/"[^>]*data-product="pair-alpha"/);
  assert.match(html, /data-dataset="pair_alpha"[^>]*data-product-context="pair-alpha"/);
  assert.match(html, /id="pair-alpha-view"/);
  assert.match(html, /id="pair-alpha-token-body"/);
  assert.match(html, /data-alpha-lane="ignition_watch"/);
  assert.match(html, /data-alpha-lane="retest_watch"/);
  assert.match(html, /data-alpha-lane="no_chase"/);
  assert.match(html, /净 Quote 流入<\/dt><dd>UNKNOWN/);
  assert.match(html, /id="pair-alpha-horizons"/);
  assert.match(app, /api\("\/api\/pair\/alpha"\)/);
  assert.match(app, /pollPairAlphaCache[\s\S]*await loadPairAlpha\(\)/);
  assert.match(app, /pairAlphaActionState/);
  assert.doesNotMatch(app, /compositeScore|综合分/);
});

test("mobile product navigation keeps all seven product entries reachable", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(htmlUrl, "utf8"),
    readFile(appUrl, "utf8"),
    readFile(stylesV2Url, "utf8"),
  ]);

  assert.equal((html.match(/data-product="[^"]+"/g) ?? []).length, 7);
  assert.match(styles, /grid-template-columns: repeat\(7, minmax\(72px, 1fr\)\)/);
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

test("unified intelligence entry keeps leader, heat, and valuation as separate models", async () => {
  const [html, app] = await Promise.all([readFile(htmlUrl, "utf8"), readFile(appUrl, "utf8")]);

  assert.match(html, /href="\/leaders\/"[^>]*data-product="leaders"/);
  assert.match(html, /href="\/launchpads\/"[^>]*data-product="launchpads"/);
  assert.match(html, /href="\/cashcat\/"[^>]*data-product="cashcat"/);
  assert.match(
    html,
    /data-dataset="intelligence"[^>]*data-product-context="leaders"[\s\S]*龙头 \/ 热度 \/ 估值/,
  );
  assert.match(html, /data-dataset="economics"[^>]*data-product-context="launchpads"/);
  assert.match(html, /id="structural-leader-symbol"/);
  assert.match(html, /id="chain-heat-state"/);
  assert.match(html, /id="token-heat-body"/);
  assert.match(html, /id="cohort-grid"/);
  assert.match(app, /INITIAL_DATASET[\s\S]*"intelligence"/);
  assert.match(app, /document\.body\.dataset\.productContext = product/);
  assert.match(app, /api\("\/api\/intelligence"\)/);
  assert.match(app, /api\("\/api\/intelligence\/refresh", \{ method: "POST" \}\)/);
  assert.doesNotMatch(app, /compositeScore|综合分/);
});
