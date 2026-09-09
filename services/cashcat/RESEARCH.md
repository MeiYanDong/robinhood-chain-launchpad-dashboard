# Cash Cat 监控系统：同类产品与方法论调研

调研日期：2026-07-21。范围限定为官方文档、官方仓库与公开的一手方法论；商业宣传中的收益承诺不进入判断。

## 结论先行

没有一个现成产品能同时表达这三件事：

1. Robinhood Chain 是否仍在吸引相对更多的资金与注意力；
2. Cash Cat 是否仍在市值、流动性、多周期成交量、持币地址四个维度保持断崖领先；
3. 创始人支持、主流讨论度与外部新热点是否改变了离场前提。

成熟方案能复用的是调度、持久化、告警治理、网页变更、信息源归一化和通知，而不是这套领域判断本身。最优路径是薄领域服务，而不是完整复制低代码或量化交易平台。

## 17 个产品 / 项目 / 方法论

| # | 产品或方法论 | 可直接借鉴的能力 | 对本项目的决定 |
|---:|---|---|---|
| 1 | [Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/) | 去重、分组、路由、静默、抑制与恢复通知 | 借鉴状态迁移与只在变化时通知；MVP 不部署整套 Prometheus |
| 2 | [Grafana Alerting：No Data](https://grafana.com/docs/grafana/latest/alerting/guides/missing-data/) | 明确区分 `No Data`、查询错误与某条序列消失 | 缺失/过期单独进入 `UNKNOWN/STALE`，绝不映射为 `HOLD` |
| 3 | [Google SRE：Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/) | 短窗口负责快速检测，长窗口负责精度与抑制误报 | 分流条件同时看当前值、历史基线与连续轮次 |
| 4 | [APScheduler](https://apscheduler.readthedocs.io/en/master/userguide.html) | 周期任务、`max_instances`、coalesce、misfire、持久数据存储接口 | 直接复用稳定的 3.x 调度器，不手写 sleep-loop；明确避开仍为预发布的 4.x |
| 5 | [Apprise](https://github.com/caronc/apprise) | 用统一 URL 接入 Telegram、Discord、Slack、Gotify 等大量通知渠道 | 直接作为可选通知层，领域代码不绑定单一渠道 |
| 6 | [n8n](https://github.com/n8n-io/n8n) | 可视化工作流、丰富连接器、定时与 webhook | 功能强但本项目只有一个高度定制状态机；且为 fair-code / Sustainable Use License，不选为核心运行时 |
| 7 | [Huginn](https://github.com/huginn/huginn) | Agent 监听网页、产生事件、触发其他 Agent，MIT | 事件链模型值得借鉴，但 Ruby 应用栈对本地单用途监控过重 |
| 8 | [Windmill Schedules](https://www.windmill.dev/docs/core_concepts/scheduling) | 定时、运行历史、错误与恢复 handler、重试 | 适合团队内部工作流；单人本地 MVP 引入数据库与 worker 集群收益不高 |
| 9 | [changedetection.io](https://github.com/dgtlmoon/changedetection.io) | CSS/JSONPath/jq 选择、网页差异、条件触发、Playwright、通知 | 将来可作为创始人官网/公开页面变更适配器；不负责链上数值判断 |
| 10 | [RSSHub](https://github.com/DIYgod/RSSHub) | 把大量异构站点统一成 RSS | 将来用于媒体源标准化；Robinhood 创始人/X 仍需可靠原始来源或已批准媒体 Skill |
| 11 | [Dune Alerts](https://docs.dune.com/web-app/alerts) | 定时 SQL 查询后发邮件/webhook，结果可审计 | 借鉴“查询结果 + 可回看链接”；官方明确不适合时间敏感关键告警，因此不作为实时核心 |
| 12 | [Arkham Alerts](https://codex.arkm.com/the-platform/alerts) | 地址、实体、代币、金额、链的组合过滤，附交易直达链接 | 借鉴每条告警带证据链接与过滤条件预览；它偏交易流，不覆盖链叙事 |
| 13 | [DeFiLlama Chains](https://defillama.com/chains) | TVL、桥接 TVL、稳定币、市占、DEX 量、费用和活跃地址的链级比较 | 后续可作为链级资金第二数据源；MVP 以 GMGN 可用字段为主，不混入覆盖不一致的数据 |
| 14 | [DEX Screener API](https://docs.dexscreener.com/api/reference) | 交易对、流动性、成交量、价格变化、boost/广告等开放接口 | 可作为行情降级源；Robinhood Chain 覆盖需实时验证，不能先验假设 |
| 15 | [Freqtrade](https://docs.freqtrade.io/en/stable/lookahead-analysis/) | 回测、dry-run、前视偏差检测；官方要求先回测与模拟再实盘 | 借鉴“先观测、回放、再校准”，但本项目明确不接交易执行 |
| 16 | [Google Trends 数据解释](https://support.google.com/trends/answer/4365533?hl=en-GB) | 按地区/时间总搜索量归一化，并提醒单一尖峰不等于“获胜” | 注意力必须用相对份额与多来源确认，不能把绝对搜索数当结论 |
| 17 | [NIST EWMA](https://www.itl.nist.gov/div898/handbook/pmc/section3/pmc324.htm) / [CUSUM](https://www.itl.nist.gov/div898/handbook/pmc/section3/pmc323.htm) | 对缓慢漂移和小幅持续变化比单点阈值更敏感 | 历史积累后用 EWMA/CUSUM 校准基线；MVP 先保存原始快照并用中位基线，避免过早拟合 |

## GitHub 复用审查

2026-07-21 通过 GitHub 只读 API 核对了 Alertmanager、Grafana、n8n、Huginn、Windmill、changedetection.io、RSSHub、Apprise、APScheduler、Freqtrade 的默认分支、许可证、归档状态和最新 push。它们均未归档且仍有近期工程活动，但许可证不同：

- 可直接嵌入：APScheduler（MIT）、Apprise（BSD-2-Clause）。
- 可借鉴或独立部署：Alertmanager（Apache-2.0）、Huginn（MIT）、changedetection.io（Apache-2.0）。
- 需注意传播或使用条件：Grafana / RSSHub（AGPL-3.0）、Freqtrade（GPL-3.0）、n8n（Sustainable Use License / fair-code）、Windmill（仓库包含社区与商业边界，部署前需按实际版本复核）。

因此当前代码只把 APScheduler 和 Apprise作为库依赖；其余项目只借鉴公开机制或保留为后续独立适配器。

## 方案比较

| 路径 | 覆盖领域判断 | 可审计 | 运行复杂度 | 许可证风险 | 结论 |
|---|---:|---:|---:|---:|---|
| n8n / Windmill 全流程 | 中 | 中 | 高 | 中 | 不选；复杂状态机仍需自写代码 |
| Prometheus + Grafana + Alertmanager | 中 | 高 | 高 | 低至中 | 适合团队级生产扩容，不适合当前本地 MVP |
| Huginn + changedetection.io | 低至中 | 中 | 中 | 低 | 适合叙事网页监听，不能替代 GMGN 市场判断 |
| Dune / Arkham 商业产品 | 中 | 高 | 低 | 服务依赖 | 能补充证据，无法表达完整退出逻辑 |
| **薄 Python 服务 + 成熟库** | **高** | **高** | **低** | **低** | **最优；本轮执行** |

## 最终复用边界

```text
GMGN CLI（市场与代币事实）
    ↓
Cash Cat 领域状态机（本项目唯一自定义部分）
    ↓
SQLite（快照/事件） + APScheduler（调度）
    ↓
FastAPI（本地看板/API） + Apprise（可选通知）
```

媒体层不伪造 GMGN 能力。GMGN 当前 `track kol/smartmoney` 不支持 Robinhood Chain，因此最终实现复用了用户本机三个现有项目中已经运行过的 TwitterAPI.io 读取路径：`x-api-virtuals-base` 的请求与时间窗、`IntelOS` 的字段归一化、`42space` 的来源状态和垃圾内容处理。结果保留真实作者、时间、互动量与原帖链接；来源失败时明确降级，不使用模拟内容补位。
