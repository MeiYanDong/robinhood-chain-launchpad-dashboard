# Robinhood Chain Radar

一个面向社区的 Robinhood Chain 只读 PAIR 工作台。一级入口统一为“全链数据 / PAIR 经营 /
PAIR Alpha / PAIR V2 / 资金闭环”，共用同一套导航、视觉和“先结论、后数据、再证据”的阅读顺序。
全链数据保留，但不再作为割裂的独立模板；CashCat 不再是重点资产或一级页面。

仓库代码 `0.20.11` 将完整 UTC 日的全链基本面、发射台经营、Alpha 信号和 PAIR 链上资金流收进
同一个产品壳。完整日、实时快照与滚动 24H 仍严格分开，任何缺失值继续保持未知。全链与
CashCat 的可维护源码仍位于 [`services/`](services/README.md)，但生产进程、数据库、密钥和
发布周期保持隔离；CashCat 仅保留历史与兼容读接口。

既有深度页继续采用“先结论、再对象、后证据”的阅读顺序：首屏先给结论和前 5 个对象，模型、历史回放与链上证据按需展开；
移动端将高优先级表格改成无横向滚动的卡片。PONS 七日预测只有在相似样本与回测误差同时
过关时才展示结果，否则明确停用。独立 PAIR V2 与创建者监控之外仍保留跨代 PAIR Alpha 雷达：官方目录
全量发现 V1/V2，以 15 秒热候选、60 秒完整目录和 8 秒链上事件三层后台更新；点火、回踩、
研究候选、过热勿追和风险停止互斥展示。飞书链路只允许已核验的 PAIR 项目方主发行钱包，
其它项目创建者只入证据层，并采用精选、限频、过期封存；买入游标
分段追块且不补发历史队列；生产实际版本仍以 `/api/meta` 的部署后回读为准。完整规则见
[`docs/pair-alpha-radar.md`](docs/pair-alpha-radar.md) 与
[`docs/pair-v2-monitor.md`](docs/pair-v2-monitor.md)；现有“龙头 / 热度 / 估值”规则见
[`docs/market-intelligence.md`](docs/market-intelligence.md)。
PAIR 日交易量 10% 告警的完整日口径、来源门禁、去重和重试规则见
[`docs/pair-daily-volume-alert.md`](docs/pair-daily-volume-alert.md)。

服务端核心 DEV 创建者与买入监控见 [`docs/dev-monitor.md`](docs/dev-monitor.md)。PAIR V2 页面主入口
只展示已核验 PAIR 项目方主发行钱包发出的代币，并把“官方协议代币”与“同钱包发行但未确认背书”
分开；跨平台完整地址库、买入行为与通知 outbox 仍只留在服务端。

发射台的四个任务视图分别是：

- 今日概览：三个关键结果、三平台同日对比和最近 7 日交易量走势；
- 平台经营：相较各自历史常态、7 日 / 30 日 / 上线以来交易量，以及成交量、手续费、协议确认
  收入和实际回购；完整应计、实收、回购预算、留存与净利润在审计明细中展开；
- PAIR vs PONS：展示 PAIR 实际价、按 PONS 平台规模折算的 PAIR 参考价、溢价或折价、是否可参考、完整公式和逐项输入；
- 平台代币：PONS、PAIR 平台币与 Long 当前市值龙头的价格、市值、流动性、24H 成交和持币地址，
  再进入 PAIR / Long 四项独立排行并查看底层配对资产。

回购后留存和净利润缺少成本或实收证据时保持未知，Long 没有回购机制时显示“不适用”。

## 现在能看什么

默认展示最近一个已经完整结束的 UTC 日期（T-1），不会把当天尚未结束的部分数据混进日榜；
产品界面会直接写出具体日期。

| 指标 | 界面名称 | 含义 | 重要限制 |
| --- | --- | --- | --- |
| `volume_usd` | 成交量 | adapter 声明范围内的交易名义金额 | 不同平台可能是曲线交易、毕业后池子或更宽的产品范围 |
| `fees_usd` | 用户手续费 | 用户使用协议支付的全部手续费 | 不是平台最终拿到的钱 |
| `protocol_revenue_usd` | 平台收入 | 可明确归到协议/团队/金库的收入 | 并非所有 adapter 都提供；缺失保持 `null` |
| `revenue_usd` | Revenue | DefiLlama 定义下协议留存的 Revenue | 单独保留用于复核，不等于净利润 |
| 覆盖率 | `x/y` | 窗口内有明确观测的闭合 UTC 日或有数据的平台数 | 没有观测不自动等于 0 |

统一入口提供：

- 全链数据：四项直接判断、8 个核心指标、全部指标明细、使用/资本/经济/市场四层趋势与来源健康；
- PAIR 经营：PONS、LONG、PAIR 的平台交易量、活跃度、费用、收入、回购与相对估值；
- PAIR Alpha：跨 V1/V2 的新币筛选、过热拦截、风险停止与首次信号回放；
- PAIR V2：V2 发行、模式、候选、项目方发行、回购桶和链上事件；
- 资金闭环：逐笔区分实际回购、实际销毁、待回购资金与待销毁 PAIR；
- PAIR Alpha 跨代候选矩阵、动作通道、多池成交证据和首次信号 5m/30m/2H/6H/24H 回放；
- PAIR V2 当前 release 的三种模式分布、市场榜、逐笔链上动作、回购桶与来源健康；
- PAIR 各代币的官方底层配对资产（如 SPY、WETH、USDG 或股票代币），多池按资产地址去重；
- PAIR V2 的发现、确认、热度、风险、置信度保持独立，不计算综合分；
- 结构龙头与断崖龙头分列，链级流动性固定使用 GMGN 最大主池；
- 链活动、费用、成本和跨链注意力四维热度判断；
- PAIR 与 Long 发射代币的同角色相对市值区间；
- 24H、7D、30D 平台排名；
- 默认查看注册表中状态为 `live` 的主流平台，也可切换全部追踪平台；
- 按平台名搜索、按核心指标排序；
- 64 个闭合 UTC 日的平台详情与折线图；
- LetsCash 官方滚动 24H、累计成交量、手续费、平台收入、创作者收入和参与规模快照；
- Long 官方滚动 24H 成交量、交易笔数与活跃代币快照；
- 按需查看 30 日覆盖范围、采集器状态、平台 scope、已知限制和来源链接。

PAIR 代币页另行提供四张相互独立的 Top 5：

- 当前市值；
- PAIR 全部官方池的流动性深度合计；
- 滚动 24H 交易量；
- 持币地址数。

实时榜每 15 分钟更新市场数据，持币地址最多每小时更新一次；每日北京时间 08:10 固化一份
08:00 快照日报。四个指标不计算综合分，缺失值不进入对应排名。默认只纳入市值至少
`$10,000`、流动性深度至少 `$1,000` 且市场数据在 60 分钟内更新的代币。

Long 代币页沿用同一组四维 Top 5。它展示 GMGN 当前可见的 `longxyz` 活跃样本，并要求每个
新入榜候选在 LongLauncher 的 `LaunchCreated` 链上事件中完成归属核验。它不是 Long 历史发射
全量；实时榜每 15 分钟更新，北京时间 08:12 固化截至 08:00 的日报。

界面取舍记录见 [`docs/ui-principles.md`](docs/ui-principles.md)。

## 数据从哪里来

### 1. DefiLlama：大多数发射台的费用、收入和成交量

程序先使用 Robinhood Chain 的 `overview` 接口发现 `category = Launchpad` 的协议、规范名称与 slug：

```text
GET https://api.llama.fi/overview/fees/Robinhood%20Chain
    ?excludeTotalDataChart=true
    &excludeTotalDataChartBreakdown=false
    &dataType=dailyFees

GET .../overview/fees/Robinhood%20Chain?...&dataType=dailyRevenue
GET .../overview/fees/Robinhood%20Chain?...&dataType=dailyProtocolRevenue
GET .../overview/dexs/Robinhood%20Chain?...&dataType=dailyVolume
```

链级 `overview` 对长尾协议的 breakdown 并不完整，因此程序随后按 slug 读取协议级日序列，并只取 `Robinhood Chain` 分支：

```text
GET https://api.llama.fi/summary/fees/{slug}?dataType=dailyFees
GET https://api.llama.fi/summary/fees/{slug}?dataType=dailyRevenue
GET https://api.llama.fi/summary/fees/{slug}?dataType=dailyProtocolRevenue
GET https://api.llama.fi/summary/dexs/{slug}?dataType=dailyVolume
```

协议级序列成功时覆盖同平台同指标的 overview 序列；某个 summary 失败或没有任何观测时保留 overview 作为兜底。这样既能补回 Pools、NOXA Fun、Sentry 等长尾记录，也能保留来源明确给出的 `$0`，不会把“链级 breakdown 没列出来”误判成未知。LetsCash 在此之上还有优先级更高的官方源，DefiLlama 作为更早历史与故障兜底。

为什么不是直接抄网页排行榜：网页是展示层，可能隐藏 dimension-only 协议、合并子 adapter，或者显示跨链总量。程序读取协议级日 breakdown，才能统一切到 Robinhood Chain、固定 UTC 窗口并保留来源。合约地址、事件和计算方法可在 [DefiLlama dimension-adapters](https://github.com/DefiLlama/dimension-adapters) 复核。

`dailyProtocolRevenue` 目前实时可读，但并非所有平台都有这一维；采集失败或平台未报告时会降级为 `null`，不会用 Revenue 猜填。

DefiLlama 的定义是：Fees 为用户支付的全部费用；Revenue 是协议自己保留的 Fees 子集，不包含分给 LP 的部分。二者都不是审计后的净利润。参考 [DefiLlama Data Definitions](https://defillama.com/data-definitions)。

### 2. LetsCash：官方 Tokenomics 日序列与实时快照

```text
GET https://api.letscash.fun/api/tokenomics?surface=current
GET https://coins.llama.fi/chart/coingecko:ethereum?...
```

程序直接读取 LetsCash 官方索引器的 `daily[].volEth`、`daily[].feesEth`，只保留已经闭合的 UTC 日。官方日序列以 ETH 计价，因此跨平台 USD 排名使用该 UTC bucket 边界的 DefiLlama ETH/USD 参考价换算，并明确标为 `derived`；这不是逐笔交易发生时美元价重算。

同一平台、指标和日期发生冲突时，LetsCash 官方日序列优先，DefiLlama 协议级 summary 次之，链级 overview 最后；官方源失败或未覆盖更早日期时，低优先级源才补位，不会相加造成重复计算。

官方 API 还提供滚动 24H 与累计 ETH 指标。累计平台收入直接读取 `platformEth`；24H 平台收入因为 API 没有直接日字段，按官网披露的固定 `0.3%` 平台份额由滚动成交量推导。它们进入平台详情的独立快照，不与闭合日排行榜混用。

### 3. Bankr：官方 Robinhood Chain 日成交量

```text
GET https://api.bankr.bot/public/dashboard
```

程序读取 `dailyVolumeByChain[].robinhood`，并排除当前未闭合 UTC 日。Bankr 当前公开响应没有可复核的“Bankr 协议收入按 Robinhood Chain 日拆分”，因此 Bankr 的 Fees / Revenue / Protocol Revenue 保持未知，不用全局收入或其它链字段代替。

### 4. Long：官方小时成交量与滚动 24H 快照

```text
POST https://api.long.xyz/v1/graphql
```

程序读取 Long 官方 `PoolVolumeHour`，按闭合 UTC 日汇总，再用 `Asset` 中的 Robinhood Chain ID 与 Long integrator 地址核验每个资产确属 Long，避免把共享后端里的其它集成方算入。平台详情同时读取官方 `AuctionPool` 的滚动 24H 成交量、交易笔数和活跃代币数。

官方公开接口会拒绝普通服务端 HTTP 指纹，因此采集器使用低频、只读的浏览器兼容传输访问同一个官方 GraphQL 地址，不需要钱包或 API Key。生产出口遇到 Cloudflare 针对某一种浏览器指纹的挑战时，采集器会在 Firefox、Safari 与 Chrome 三种受控指纹之间自动切换；全部路径失败时该来源明确降级，不会用旧值或第三方榜单冒充当前值。独立的 Long 代币页继续使用下一节所述的 GMGN 活跃样本与官方 Launcher 链上归属，不拿它回填平台总量。

Long 的交易费在资产创建后可能经历动态费率，且平台受益人路由存在版本差异。当前不能从成交量准确反推出逐日用户手续费和平台收入，所以这两项保持未知，不显示为 `$0`。

### 5. Pons、Long、PAIR 三强对比

```text
GET https://www.ponsfamily.com/api/pons-analytics?v=dune-v2
GET https://pair.fund/api/stats/protocol
GET https://pair.fund/api/tokens/0x6b1d...66be
gmgn token info --chain robinhood --address 0x39db...4571 --raw
POST https://rpc.mainnet.chain.robinhood.com  eth_call
```

Pons 与 PAIR 的平台成交量优先读取各自官方 Dune-backed 日序列；Long 继续读取经过
integrator 归属核验的官方日成交量。市场份额只在三家同一个闭合 UTC 日都有成交量时计算，
分母固定为这三家之和，不把其它平台混入。

PONS 与 PAIR 的来源市值和“价格 ×（总供应量 − 销毁地址余额）”并列展示。销毁地址累计余额
只能证明销毁结果，不能自动证明资金来自协议手续费；实际回购必须有资金来源、Swap 和销毁或
锁仓的逐笔闭环证据。设计和口径见
[`docs/economics-comparison.md`](docs/economics-comparison.md)。

PAIR 资金闭环模块进一步把两条币流拆开：PAIR 从 Locker 直接进入团队地址后销毁，和协议
报价资产（包括 SPY）进入团队地址、经 Swap 换成 PAIR、再进入死亡地址。转账按区块与日志顺序建立 FIFO 批次账本，
并与当前链上钱包余额对账；因此“市场买入”“买入后销毁”“已买未销毁”不会由所有用户买入量
推算。全平台已归集报价资产读取官方金库可领取接口；PAIR/SPY 主池未归集增量来自只读 `eth_call`
收集模拟，不签名、不广播交易。公开的 90% 回购比例只作为政策预期；在报价资产来源、Swap 和
销毁三段未逐笔闭合前，已执行的手续费回购金额保持未知。其它池仍留在 LP 仓位内的未归集费用也
保持未知，不拿理论手续费倒推。
全平台 24H 成交额只汇总官方接口实际给出成交额的代币，缺失值不补 0，并在覆盖不完整时显示
“已观测下限”。

PAIR 相对估值中心采用：

```text
PONS 价格
×（PONS 有效供应量 ÷ PAIR 有效供应量）
×（PAIR 最新共同完整 UTC 日平台成交量 ÷ Pons 同日平台成交量）
```

它是“如果 PAIR 获得与 PONS 相同的平台成交量估值倍数”时的比较锚，不是价格预测。至少需要
1 个最新共同完整日，缺失日不补 0；最近 7 个共同完整日只生成平滑对照和逐日波动区间，不再
决定主参考价。PONS 价格超过 30 分钟时停止给出当前估值。PAIR 实际价格只计算偏离，公开的
手续费分配比例只进入折叠的研究情景，不出现在主判断区。页面每 60 秒读取一次
缓存，底层估值仍随现有 15 分钟经济快照重算，不额外触发上游请求。PONS 七日预测只有在
相似阶段样本不少于 5 个且滚动回测中位误差不高于 50% 时才展示；否则主界面明确写“暂无可靠
七日预测”，不把历史波动范围包装成预测。

### 6. PAIR：官方代币市场数据与 GMGN 持币地址

```text
GET https://pair.fund/api/tokens?page={page}&limit=50
gmgn token info --chain robinhood --address {token} --raw
```

程序遍历 PAIR 官方代币 API 的全部分页，在本地执行经济活跃门槛和确定性排序，不依赖远端
Top N。市值取 `marketCapUsd`，流动性取全部官方池的 `totalDepthUsd`，24H 交易量优先取
`combinedVolume24hUsd`。持币地址读取 GMGN 的 `holder_count`；它是地址数，不等于去重后的
真实人数。

持币来源失败时，程序只在 150 分钟以内使用上次已验证缓存并标为 `partial`；超过窗口后保持
未知。PAIR 官方 API 或完整分页校验失败时，本次采集失败，界面继续显示上次成功快照并明确
标记过期。详细设计与运行规则见 [`docs/pair-token-radar.md`](docs/pair-token-radar.md)。

### 7. Long 代币榜：GMGN 活跃样本与 LongLauncher 链上归属

```text
gmgn market trending --chain robinhood --interval 24h --limit 100 \
  --platform longxyz --order-by volume --direction desc --raw
POST https://rpc.mainnet.chain.robinhood.com  eth_getLogs
```

GMGN 返回当前活跃代币的 `market_cap`、`liquidity`、`volume` 与 `holder_count`，程序在本地对
四个指标独立排序。榜单候选随后必须命中官方 LongLauncher
`0x22e99278308b393ea1260859b181ad7e78f5eeed` 的 `LaunchCreated` 事件；核验失败时本轮不发布。
已确认的归属写入 SQLite，之后不重复查询不可变历史事件。

GMGN 的 `longxyz` 标签是市场发现源，不代表历史发射全量；LongLauncher 事件只负责归属核验，
不提供当前市值或持币人数。详细合同见
[`docs/long-token-radar.md`](docs/long-token-radar.md)。

### 8. PAIR V2：release 证明、市场全分页与链上事件

```text
GET https://pair.fund/api/v5-v2/standard-route/consumer-live?releaseId=...&manifestSha256=...&fresh=1
GET https://pair.fund/api/tokens?page={page}&limit=50
POST https://rpc.mainnet.chain.robinhood.com  eth_getLogs / eth_call
gmgn token info --chain robinhood --address {token} --raw
```

程序首先校验官方 release attestation 的 `releaseId`、manifest hash 与 ready 状态，然后从部署
区块开始索引当前 coordinator、vault、buyback executor 与 launchpad 的事件。市场数据完整翻页，
再与当前 release 的 `ProjectLaunched` 事件按项目地址连接；只出现在旧 release 或仅出现在市场 API
里的代币不会伪装成当前 release 项目。

页面将以下口径分开：

- 24H 用户手续费、模式份额和协议份额是由官方市场成交额按公开费率计算的估算值；
- `NativeFeesCollected`、`BuybackExecuted`、`HolderDistributionClaimed`、`Upgraded` 是逐笔链上事实；
- 回购 bucket 是在确认区块读取的待执行资产余额，按资产分别展示，不能跨资产直接相加成美元；
- 没有 `BuybackExecuted` 事件时，理论预算不等于已回购；缺失市场、持有人或历史字段保持未知。

服务进程内部每 8 秒回扫带 12 区块重组重叠的链上事件，每 60 秒刷新 release、市场、持有人和
回购 bucket；不依赖本地 Codex 自动任务。详细数据合同、Alpha 分层和告警规则见
[`docs/pair-v2-monitor.md`](docs/pair-v2-monitor.md)。

### 9. Robinhood Chain RPC：当前只做已声明模块的只读索引

当前版本用官方 RPC 核验 Long 榜单候选的发射归属，并索引 PAIR V2 当前 release 的已知事件。
若要加入全链每日发币数、活跃交易者、交易笔数或跨 release 历史总量，仍需要 archive RPC 和
独立回填作业。

Robinhood 官方说明公共 RPC 有速率限制且不适合生产；历史索引建议使用 archive provider。参考 [Connecting to Robinhood Chain](https://docs.robinhood.com/chain/connecting/)。

## 原截图来自哪里

用户提供的截图来自 DefiLlama 的全局 **Launchpad Rankings** 页面：

<https://defillama.com/protocols/launchpad>

判断依据是页面标题、搜索框、列名（Fees 7d / Revenue 7d / Fees 24h / Revenue 24h）以及同一组全局排名条目：pump.fun、Pons、Flap、StonkBrokers、Binance Alpha、LetsCash。它不是只筛 Robinhood Chain 的页面；Robinhood Chain 专页是：

<https://defillama.com/protocols/launchpad/robinhood-chain>

网页数字会随时间更新，本项目不会把截图中的历史数值当作当前事实。

## 已固化的数据口径

- `Pons`：合并 Pons V1 + V2，避免两行与重复计数；但成交量主要来自 V2 curve，费用/收入可能覆盖 V1 + V2，标为 `scope_mismatch`。
- `LetsCash`：官方 ETH 日序列优先；USD 排名使用 UTC bucket 边界 ETH/USD 参考价，平台日收入按 `0.3%` 推导，均标为 `derived`。DefiLlama adapter 只作历史/故障兜底。
- `Flap`：curve volume 与 fee Safe inflow 范围不同，标为 `scope_mismatch`。
- `StonkBrokers`：adapter 混合 launchpad、NFT AMM、loan、locker、swap desk 等产品，标为 `suite_wide`，展示但从 tracked totals 排除。
- `Bankr`：只使用官方 chain-split volume；收入保持未知。
- `Long`：只使用官方小时成交量并以 Long integrator 归属资产；动态手续费与版本化收入路由未完成逐笔归因前保持未知。
- 其它从 DefiLlama 动态发现但尚未逐 adapter 审核的平台标为 `unknown`，不会伪装成“完全可比”。
- 所有缺失观测保持 `null`；只有来源明确给出 0 时才显示 `$0`。

平台覆盖与特殊规则集中在 [`src/config/platforms.ts`](src/config/platforms.ts)。

## 运行

要求 Node.js 22.5+（使用 Node 内置 SQLite）。

```bash
cd "/Users/myandong/Projects/Robinhood chain/launchpad-dashboard"
npm install
npm run build
npm start
```

打开 <http://127.0.0.1:4174>。

开发模式：

```bash
npm run dev
```

## 当前服务器部署

截至 2026-09-09，生产实例是阿里云轻量应用服务器 `robinhood-chain-radar`
（`us-west-1`，实例 ID `ceff28ff463440c09d8666b0f081bc7f`）：

- HTTPS 公网入口：<https://47.251.99.37/>，使用统一 PAIR 工作台；一级任务为
  <https://47.251.99.37/chain/>（全链数据）、
  <https://47.251.99.37/launchpads/>（PAIR 经营）、<https://47.251.99.37/pair-alpha/>、
  <https://47.251.99.37/pair-v2/> 和 <https://47.251.99.37/pair-flow/>；
- <https://47.251.99.37/leaders/> 作为全链数据中的“龙头与热度”下钻页继续可用，但不占一级导航；
- CashCat 不再作为重点资产或一级页面展示；旧 `/market/`、`/alpha/`、`/assets/cashcat/`
  和 `/cashcat/` 入口会跳转到对应的新工作台。`/cashcat/api/*` 与 `/cashcat/reports/*`
  仍由独立 CashCat 服务提供，历史数据没有删除；兼容端口 API 继续可用；
- 当前生产应用版本与 release 以 `/api/meta` 及部署证据回读为准；
- `0.14.7` 的 `/pair-alpha/` 跨代 Alpha 雷达已部署；公网读回覆盖 V1/V2、单币详情、
  动作分流与服务器自治更新，当前完整目录、行情与持币覆盖仍按来源状态分别标注；
- `/pair-v2/` 已由服务内 8 秒链上、60 秒市场双频自治监控，不依赖浏览器或本地 Codex 定时任务；
- DEV 雷达同样常驻主服务：生产每 11 秒增量追踪 PAIR V2、pons v1/v2、Long 的发行事件和重点
  创建者买入，5 分钟补充项目市场画像；PAIR V2 页面另设“PAIR 项目方发币”，只列已核验
  主发行钱包的代币，跨平台完整地址与行为账本不通过公网接口公开；
- Nginx 监听公网 `80`、`443` 和兼容端口 `4174`，反向代理到只监听
  `127.0.0.1:4175` 的 Node 服务；
- systemd 主服务：`robinhood-chain-launchpad.service`；
- 每日刷新定时器：`robinhood-chain-launchpad-refresh.timer`，北京时间 15:10 执行；
- PAIR 日交易量告警复用每日刷新结果：比较最近两个完整 UTC 日，涨跌绝对值达到 `10%`
  才发送飞书；同一组日期只发送一次，来源降级、缺日或前一日为零时不发送；
- PAIR 实时榜定时器：`robinhood-chain-pair-refresh.timer`，每 15 分钟执行；
- PAIR 资金闭环定时器：`robinhood-chain-pair-flow-refresh.timer`，每 5 分钟执行；
- PAIR 日报定时器：`robinhood-chain-pair-daily.timer`，北京时间 08:10 执行；
- Long 实时榜定时器：`robinhood-chain-long-refresh.timer`，每 15 分钟执行；
- Long 日报定时器：`robinhood-chain-long-daily.timer`，北京时间 08:12 执行；
- 三强对比快照定时器：`robinhood-chain-economics-refresh.timer`，在 PAIR、Long 榜单刷新后
  错峰每 15 分钟执行；内部直连 loopback collector，临时 5xx 或网络错误每 30 秒有界重试，
  不受公网查询网关并发上限影响；
- 龙头情报聚合缓存 5 分钟，只读访问同机 `4173` 的全链日度雷达与 `8010` 的 CashCat
  行情状态，不读取其它服务数据库；
- 发布目录：`/opt/robinhood-chain-launchpad/current`；
- 持久化 SQLite：`/var/lib/robinhood-chain-launchpad/launchpad-dashboard.sqlite`；
- SWAS 与 UFW 允许公网 `80/TCP`、`443/TCP` 和兼容端口 `4174/TCP`；
- 当前是无需登录的只读 HTTPS 看板；公网 IP 证书由 Let's Encrypt 签发，
  `robinhood-chain-certbot-renew.timer` 每天两次检查短期证书续期；公网手动刷新按 IP 限制为平均每分钟 1 次，
  允许 1 次瞬时突发，同一时刻的刷新由服务端合并。

本次 PAIR 上线的公网回读、四维榜首、定时器和回滚证据见
[`docs/evidence/pair-production-deployment-2026-09-01.md`](docs/evidence/pair-production-deployment-2026-09-01.md)。
Long 代币页的公网回读、Launcher 核验、浏览器验收和回滚证据见
[`docs/evidence/long-production-deployment-2026-09-01.md`](docs/evidence/long-production-deployment-2026-09-01.md)。
三强对比、定时刷新、公网压缩传输和当前来源缺口的部署证据见
[`docs/evidence/economics-production-deployment-2026-09-03.md`](docs/evidence/economics-production-deployment-2026-09-03.md)。
代表币当前价格、SQLite 增量迁移和 0.7.1 公网回读证据见
[`docs/evidence/token-price-production-deployment-2026-09-03.md`](docs/evidence/token-price-production-deployment-2026-09-03.md)。
统一入口、四个独立判断模型、三服务 release、公网浏览器与运行时回读证据见
[`docs/evidence/market-intelligence-production-deployment-2026-09-04.md`](docs/evidence/market-intelligence-production-deployment-2026-09-04.md)。
PAIR 资金闭环逐笔账本、后台自动刷新与 0.10.0 公网回读证据见
[`docs/evidence/pair-flow-production-deployment-2026-09-05.md`](docs/evidence/pair-flow-production-deployment-2026-09-05.md)。
PAIR V2 Alpha 观察台、Shadow 回放、服务内自治监控与 0.11.0 公网回读证据见
[`docs/evidence/pair-v2-production-deployment-2026-09-06.md`](docs/evidence/pair-v2-production-deployment-2026-09-06.md)。
DEV 创建者发现、重点地址、服务器自治追块、通知测试与 0.12.1 公网回读证据见
[`docs/evidence/dev-monitor-production-deployment-2026-09-06.md`](docs/evidence/dev-monitor-production-deployment-2026-09-06.md)。
PAIR V1/V2 跨代发现、`Titties` 单币回读、自治更新、回滚点与 GitHub 边界见
[`docs/evidence/pair-alpha-production-deployment-2026-09-06.md`](docs/evidence/pair-alpha-production-deployment-2026-09-06.md)。
DEV 通知根因、1,401 条历史队列封存、飞书业务码 `0`、限频策略与 `0.14.1` 回读见
[`docs/evidence/dev-monitor-attention-production-deployment-2026-09-07.md`](docs/evidence/dev-monitor-attention-production-deployment-2026-09-07.md)。
最终 1,539 条历史噪声封存、实时追块恢复、SQLite 止血、飞书真实投递与 `0.14.7` 回读见
[`docs/evidence/dev-monitor-attention-production-deployment-2026-09-07-v2.md`](docs/evidence/dev-monitor-attention-production-deployment-2026-09-07-v2.md)。
发射台具体日期、指标解释、平台颜色、线性图表和 `0.18.1` 公网回读见
[`docs/evidence/launchpad-language-production-deployment-2026-09-08.md`](docs/evidence/launchpad-language-production-deployment-2026-09-08.md)。
龙头、PAIR Alpha、PAIR V2、资金闭环的统一视觉重构、查询空窗修正和 `0.19.3` 公网回读见
[`docs/evidence/workbench-ui-production-deployment-2026-09-09.md`](docs/evidence/workbench-ui-production-deployment-2026-09-09.md)。
全链、发射台、Alpha 与 CashCat 融合为一个产品、生产路由补丁、22 项合同和真实浏览器回读见
[`docs/evidence/unified-product-production-deployment-2026-09-09.md`](docs/evidence/unified-product-production-deployment-2026-09-09.md)。
PAIR 日交易量 10% 告警的首次真实投递、去重队列、23 项合同与回滚证据见
[`docs/evidence/pair-daily-volume-alert-production-deployment-2026-09-09.md`](docs/evidence/pair-daily-volume-alert-production-deployment-2026-09-09.md)。

全链数据融入 PAIR 工作台、五入口统一导航、生产路由、自动更新与数据质量回读见
[`docs/evidence/chain-pair-workbench-production-deployment-2026-09-09.md`](docs/evidence/chain-pair-workbench-production-deployment-2026-09-09.md)。

PAIR 官方目录并发协调、V2 完整快照恢复、认证 503 降级边界与最终生产回读见
[`docs/evidence/pair-refresh-resilience-production-deployment-2026-09-09.md`](docs/evidence/pair-refresh-resilience-production-deployment-2026-09-09.md)。

部署配置固化在 [`deploy/`](deploy/)；新版本应使用不可变 release 目录并原子切换
`current` 软链接，保留上一版用于回滚。发布后必须同时验证公网首页、`/healthz`、
`/api/overview?window=30`、`/api/platform-activity`、`/api/platform-activity/alerts/health`、
`/api/sources`、`/api/pair/health`、`/api/pair/rankings`、
`/api/long/health`、`/api/long/rankings`、`/api/economics/health`、`/api/economics`，
`/api/intelligence/health`、`/api/intelligence`，以及公网 `/chain/`、`/leaders/`、`/launchpads/`、
`/pair-flow/`、`/pair-flow/api/pair/flow/events`、`/pair-v2/`、`/pair-v2/api/pair/v2/health`、
`/pair-v2/api/pair/v2`、`/pair-v2/api/dev-monitor/health`、
`/pair-v2/api/dev-monitor/pair-team-launches?limit=20&offset=0`、
`/pair-v2/api/dev-monitor/pair-launches?tier=all&limit=20&offset=0`、`/cashcat/` 和原
`https://47.251.99.37/api/latest` 仍返回 `200`，不能只以 systemd 或 Nginx 配置检查作为
上线成功证据。部署 `0.14.7` 时还必须增加 `/pair-alpha/`、`/pair-alpha/api/pair/alpha` 与
`/pair-alpha/api/pair/alpha/health` 的公网回读。

生产 unit 从 root 管理的 `/etc/robinhood-chain-launchpad.env` 读取密钥；该文件应为 `0600`，
至少配置 `GMGN_API_KEY`。只复制 GMGN 的只读 API Key，不要把钱包或交易私钥部署到看板服务器。

可选环境变量：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `PORT` | `4174` | HTTP 端口 |
| `HOST` | `127.0.0.1` | 监听地址 |
| `DATA_DIR` | `./data` | SQLite 缓存目录 |
| `CACHE_TTL_MINUTES` | `15` | 自动刷新 TTL |
| `PAIR_ACTIVE_MCAP_FLOOR_USD` | `10000` | PAIR 入榜最低市值 |
| `PAIR_ACTIVE_DEPTH_FLOOR_USD` | `1000` | PAIR 入榜最低流动性深度 |
| `PAIR_MARKET_FRESHNESS_MINUTES` | `60` | PAIR 市场数据最大允许年龄 |
| `PAIR_REFRESH_TTL_MINUTES` | `15` | PAIR 实时榜自动刷新 TTL |
| `PAIR_HOLDER_TTL_MINUTES` | `60` | 持币地址刷新间隔 |
| `PAIR_HOLDER_MAX_STALE_MINUTES` | `150` | 失败时可使用的持币地址缓存上限 |
| `PAIR_GMGN_BIN` | `gmgn-cli` | GMGN CLI 可执行文件路径；生产 unit 指向项目内固定版本 |
| `PAIR_FLOW_REFRESH_TTL_MINUTES` | `5` | PAIR 资金闭环快照与逐笔事件最短刷新间隔 |
| `PAIR_FLOW_STALE_AFTER_MINUTES` | `20` | PAIR 资金闭环快照过期阈值 |
| `PAIR_V2_RPC_URL` | Robinhood Chain 官方 RPC | PAIR V2 只读事件与 bucket 查询；可由 `PAIR_FLOW_RPC_URL` 兜底 |
| `PAIR_V2_CHAIN_POLL_SECONDS` | `8` | 服务进程内链上确认事件轮询间隔 |
| `PAIR_ALPHA_HOT_MARKET_POLL_SECONDS` | `15` | PAIR Alpha 活跃候选的短周期池行情更新间隔 |
| `PAIR_V2_MARKET_POLL_SECONDS` | `60` | release、市场、持有人与 bucket 完整刷新间隔 |
| `PAIR_V2_DEXSCREENER_API_BASE_URL` | `https://api.dexscreener.com/latest/dex` | 按 PAIR 官方 poolId 读取 5m/1H/6H 行情与流动性 |
| `PAIR_V2_STALE_AFTER_SECONDS` | `150` | PAIR V2 快照过期阈值 |
| `PAIR_V2_HOLDER_BATCH_SIZE` | `9` | 每轮最多补采的 GMGN 持币地址项目数，避免阻塞分钟行情 |
| `PAIR_ALPHA_LEGACY_CANDIDATE_LIMIT` | `240` | 每轮纳入短周期行情的 V1 活跃候选上限 |
| `PAIR_ALPHA_HOT_CANDIDATE_LIMIT` | `72` | 15 秒热行情通道的候选上限 |
| `PAIR_ALPHA_RECENT_HOURS` | `72` | 新发行代币自动进入行情候选的时间窗 |
| `PAIR_ALPHA_MIN_VOLUME_24H_USD` | `250` | 历史代币进入行情候选的最低官方 24H 成交额 |
| `PAIR_ALPHA_MIN_MARKET_CAP_USD` | `8000` | 历史代币进入行情候选的最低官方市值 |
| `PAIR_V2_GMGN_BIN` | `gmgn-cli` | V2 持币地址读取所用固定 CLI 路径 |
| `PAIR_V2_FEISHU_WEBHOOK_URL` | 无，默认关闭 | 仅接受官方 HTTPS Feishu/Lark webhook；只在服务端环境文件配置 |
| `PAIR_DAILY_VOLUME_FEISHU_WEBHOOK_URL` | 依次回退到 PAIR V2、DEV 监控 Webhook | PAIR 日交易量告警专用 Webhook；只保存在服务器环境文件中 |
| `PAIR_DAILY_VOLUME_ALERT_THRESHOLD_PCT` | `10` | 最近两个完整 UTC 日的交易量涨跌绝对值达到该百分比时告警 |
| `PAIR_DAILY_VOLUME_ALERT_RETRY_SECONDS` | `300` | 失败 outbox 的后台重试检查间隔；单条最多尝试 5 次并指数退避 |
| `PAIR_DAILY_VOLUME_ALERT_DETAIL_URL` | `https://47.251.99.37/launchpads/?view=platforms` | 飞书消息中的只读看板入口，只接受无凭据 HTTPS URL |
| `DEV_MONITOR_ENABLED` | `false` | 启用服务端 DEV 发行与买入监听；生产 unit 显式设为 `true` |
| `DEV_MONITOR_RPC_URL` | Robinhood Chain 官方 RPC | DEV 雷达只读日志、交易与 receipt 来源；可由 `PAIR_V2_RPC_URL` 兜底 |
| `DEV_MONITOR_POLL_SECONDS` | `8` | 确认后链上发行与重点地址买入轮询间隔 |
| `DEV_MONITOR_RPC_MIN_INTERVAL_MS` | `750` | DEV 公共 RPC 请求的最小间隔，降低 429 与来源争抢 |
| `DEV_MONITOR_MARKET_POLL_SECONDS` | `300` | DexScreener 项目画像补充间隔 |
| `DEV_MONITOR_CONFIRMATIONS` | `2` | 事件和买入至少等待的确认数 |
| `DEV_MONITOR_BOOTSTRAP_BLOCKS` | `250000` | pons / Long 首次近期创建者发现窗口；不代表平台全历史 |
| `DEV_MONITOR_BUY_CATCHUP_BLOCKS_PER_POLL` | `2000` | 买入游标落后时每轮最多追赶区块数；未追到链头前不推送历史买入 |
| `DEV_MONITOR_BUY_MAX_RECOVERABLE_LAG_BLOCKS` | `10000` | 超过该落后量时记录覆盖缺口并恢复实时游标，历史区间不进入通知 |
| `DEV_MONITOR_FEISHU_WEBHOOK_URL` | 无，默认关闭 | DEV 告警专用官方 HTTPS Webhook；只保存在服务器环境文件中 |
| `LONG_ACTIVE_MCAP_FLOOR_USD` | `10000` | Long 入榜最低市值 |
| `LONG_ACTIVE_DEPTH_FLOOR_USD` | `1000` | Long 入榜最低流动性 |
| `LONG_REFRESH_TTL_MINUTES` | `15` | Long 实时榜自动刷新 TTL |
| `LONG_GMGN_BIN` | `gmgn-cli` | Long 活跃样本使用的固定 GMGN CLI 路径 |
| `LONG_RPC_URL` | Robinhood Chain 官方 RPC | LongLauncher 归属核验 RPC |
| `ECONOMICS_GMGN_BIN` | `gmgn-cli` | PONS 市场数据使用的固定 GMGN CLI 路径 |
| `ECONOMICS_RPC_URL` | Robinhood Chain 官方 RPC | PONS/PAIR 供应量与累计销毁余额读取 |
| `ECONOMICS_REFRESH_TTL_MINUTES` | `15` | 三强对比快照刷新 TTL |
| `ECONOMICS_STALE_AFTER_MINUTES` | `45` | 三强对比快照过期阈值 |
| `GMGN_API_KEY` | 无，生产必填 | GMGN 只读代币信息 API Key；通过受保护的 systemd 环境文件注入 |

## API

| 路由 | 用途 |
| --- | --- |
| `GET /healthz` | 服务与可用缓存状态 |
| `GET /api/overview?window=1\|7\|30` | 汇总和平台排名 |
| `GET /api/platform-activity` | Pons、Long、PAIR 日度成交历史、7/30 日活跃倍数与窗口交易量 |
| `GET /api/platform-activity/alerts/health` | PAIR 日交易量 10% 飞书告警配置、队列与最近投递状态；不返回 Webhook |
| `GET /api/platforms/:id` | 单平台 64 日序列、scope、来源 |
| `GET /api/coverage` | 指标定义、警告、30 日覆盖矩阵 |
| `GET /api/sources` | 采集运行与来源健康 |
| `POST /api/refresh` | 手动触发只读刷新 |
| `GET /api/pair/health` | PAIR 模块及最近快照状态 |
| `GET /api/pair/rankings` | PAIR 四项实时 Top 5 |
| `GET /api/pair/reports/latest` | 最近一份 08:00 日报 |
| `GET /api/pair/sources` | PAIR 指标定义与来源状态 |
| `POST /api/pair/refresh` | 手动触发 PAIR 只读刷新 |
| `POST /api/pair/reports/generate` | 内网定时任务固化日报；Nginx 不对公网开放 |
| `GET /api/pair/flow` | PAIR/SPY 成交、回购、销毁、待处理余额与证据等级 |
| `GET /api/pair/flow/health` | PAIR 资金闭环模块及最近快照状态 |
| `POST /api/pair/flow/refresh` | 手动刷新资金闭环的只读链上与索引来源 |
| `GET /api/pair/v2` | PAIR V2 当前 canonical release 的聚合快照 |
| `GET /api/pair/v2/health` | 后台监控、最近区块、过期状态与告警队列 |
| `GET /api/pair/v2/events?limit=100` | 当前 release 最近逐笔链上事件 |
| `GET /api/pair/v2/tokens/:address` | 单个 V2 项目的市场、模式、资金与 Alpha 分层 |
| `POST /api/pair/v2/refresh` | 受限手动触发完整只读刷新；日常更新不依赖它 |
| `GET /api/pair/alpha` | PAIR V1/V2 跨代候选、互斥动作、成交证据与 Shadow 回放 |
| `GET /api/pair/alpha/health` | 复用同一自治采集器的健康、热行情与完整目录轮询状态 |
| `GET /api/pair/alpha/tokens/:address` | 单币身份、生命周期、动作原因和多池成交证据 |
| `POST /api/pair/alpha/refresh` | 受限手动触发完整只读刷新；日常更新不依赖它 |
| `GET /api/dev-monitor/health` | DEV 雷达聚合健康、确认区块、来源状态与通知队列；不返回地址明细 |
| `GET /api/long/health` | Long 模块及最近快照状态 |
| `GET /api/long/rankings` | Long 四项实时 Top 5 |
| `GET /api/long/reports/latest` | 最近一份 Long 08:00 日报 |
| `GET /api/long/sources` | Long 指标定义与来源状态 |
| `POST /api/long/refresh` | 手动触发 Long 只读刷新 |
| `POST /api/long/reports/generate` | 内网定时任务固化 Long 日报；Nginx 不对公网开放 |
| `GET /api/economics/health` | 三强对比模块及最近快照状态 |
| `GET /api/economics` | Pons、Long、PAIR 代币价值、平台经营与回购核验 |
| `GET /api/economics/sources` | 口径定义、限制与来源状态 |
| `POST /api/economics/refresh` | 刷新平台、代币与链上来源后重建三强对比 |

刷新失败但 SQLite 中存在上次成功数据时，服务会明确显示 stale/degraded 并继续提供旧缓存；不会把失败当成功。采集器并发运行，但同键冲突由中央优先级表确定，结果不依赖采集器数组顺序。

## 验证

```bash
npm run check
npm test
npm run build
npm run verify:live
```

测试覆盖 Pons 合并、协议级 summary 的 Robinhood Chain 筛选、UTC 当前日排除、`null ≠ 0`、Bankr 官方 volume、LetsCash 官方日序列/实时快照、Long integrator 归属与闭合日筛选、确定性来源优先级、StonkBrokers 不进入 tracked totals，以及 PAIR 全分页发现、Long 活跃样本与 Launcher 核验、经济活跃门槛、四榜独立排序、同日市场份额、回购证据状态、缓存降级和 08:00 日报对比。PAIR V2/Alpha 另覆盖 release 校验、V1/V2 身份分层、canonical 多池聚合、ABI 解码、短重组替换、估算与链上事实分离、过热勿追、首次信号回放、状态跃迁告警和公开路由权限。DEV 雷达覆盖各平台事件字段、来源独立游标、质量分层、receipt 买入核验、首次基线抑制、通知去重与失败重试。PAIR 日交易量告警另覆盖完整 UTC 日、10% 边界、官方来源门禁、去重和失败重试。`verify:runtime` 当前检查 23 个运行合同；因此只能在服务器完成同版本部署后作为上线回执。

## 安全边界

这是只读研究工具：不读取钱包、不保存私钥、不签名、不广播交易。当前版本也不声称提供可执行交易优势或完整链上审计总量。

## 查询隔离与数据质量（0.15.0）

生产部署采用独立 query 进程（4175）与 collector（4176），高频监控库单独存放。
逐指标质量、过期策略、迁移和回滚流程见 [运行手册](docs/runbooks/query-isolation.md)。
Long 官方平台量无法访问时仍保持未知；本版本不承诺补齐上游未提供的数据。
