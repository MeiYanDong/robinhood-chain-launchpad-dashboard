# RHC Launch Ledger

Robinhood Chain 发射台数据看板。首页直接展示平台、成交量、用户手续费与平台收入；口径、来源和覆盖信息按需查看。

## 现在能看什么

默认展示最后一个已经闭合的 UTC 日（T-1），不会把今天尚未结束的部分数据混进日榜。

| 指标 | 界面名称 | 含义 | 重要限制 |
| --- | --- | --- | --- |
| `volume_usd` | 成交量 | adapter 声明范围内的交易名义金额 | 不同平台可能是曲线交易、毕业后池子或更宽的产品范围 |
| `fees_usd` | 用户手续费 | 用户使用协议支付的全部手续费 | 不是平台最终拿到的钱 |
| `protocol_revenue_usd` | 平台收入 | 可明确归到协议/团队/金库的收入 | 并非所有 adapter 都提供；缺失保持 `null` |
| `revenue_usd` | Revenue | DefiLlama 定义下协议留存的 Revenue | 单独保留用于复核，不等于净利润 |
| 覆盖率 | `x/y` | 窗口内有明确观测的闭合 UTC 日或有数据的平台数 | 没有观测不自动等于 0 |

界面提供：

- 24H、7D、30D 平台排名；
- 默认查看注册表中状态为 `live` 的主流平台，也可切换全部追踪平台；
- 按平台名搜索、按核心指标排序；
- 64 个闭合 UTC 日的平台详情与折线图；
- LetsCash 官方滚动 24H、累计成交量、手续费、平台收入、创作者收入和参与规模快照；
- Long 官方滚动 24H 成交量、交易笔数与活跃代币快照；
- 按需查看 30 日覆盖范围、采集器状态、平台 scope、已知限制和来源链接。

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

官方公开接口会拒绝普通服务端 HTTP 指纹，因此采集器使用低频、只读的浏览器兼容传输访问同一个官方 GraphQL 地址，不需要钱包或 API Key。采集失败时该来源明确降级，不会用旧值冒充当前值。当前阿里云生产出口 `47.251.99.37` 仍被 Long 的 Cloudflare 规则拦截，`0.4.0` 候选版尚未切换为生产版本。

Long 的交易费在资产创建后可能经历动态费率，且平台受益人路由存在版本差异。当前不能从成交量准确反推出逐日用户手续费和平台收入，所以这两项保持未知，不显示为 `$0`。

### 5. Robinhood Chain RPC：下一阶段，而非本版数字来源

当前版本不依赖 RPC。后续若要加每日发币数、活跃交易者、交易笔数、毕业数，需要已核验的 factory/router/curve 合约地址、事件 ABI 和 archive RPC，再逐平台建立事件级索引。

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

截至 2026-08-30，生产实例是阿里云轻量应用服务器 `robinhood-chain-radar`
（`us-west-1`，实例 ID `ceff28ff463440c09d8666b0f081bc7f`）：

- 公网看板：<http://47.251.99.37:4174/>；
- 当前生产应用版本：`0.3.0`，release `20260830T035333Z`；`0.4.0` Long 候选版尚未切换；
- Nginx 监听公网 `4174`，反向代理到只监听 `127.0.0.1:4175` 的 Node 服务；
- systemd 主服务：`robinhood-chain-launchpad.service`；
- 每日刷新定时器：`robinhood-chain-launchpad-refresh.timer`，北京时间 15:10 执行；
- 发布目录：`/opt/robinhood-chain-launchpad/current`；
- 持久化 SQLite：`/var/lib/robinhood-chain-launchpad/launchpad-dashboard.sqlite`；
- SWAS 与 UFW 均仅新增 `4174/TCP`，原公网 `80` 的链级日度雷达保持不变；
- 当前是无需登录的只读 HTTP 看板，没有 TLS；公网手动刷新按 IP 限制为平均每分钟 1 次，
  允许 1 次瞬时突发，同一时刻的刷新由服务端合并。

部署配置固化在 [`deploy/`](deploy/)；新版本应使用不可变 release 目录并原子切换
`current` 软链接，保留上一版用于回滚。发布后必须同时验证公网首页、`/healthz`、
`/api/overview?window=30`、`/api/sources`，以及原 `http://47.251.99.37/api/latest`
仍返回 `200`，不能只以 systemd 或 Nginx 配置检查作为上线成功证据。

可选环境变量：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `PORT` | `4174` | HTTP 端口 |
| `HOST` | `127.0.0.1` | 监听地址 |
| `DATA_DIR` | `./data` | SQLite 缓存目录 |
| `CACHE_TTL_MINUTES` | `15` | 自动刷新 TTL |

## API

| 路由 | 用途 |
| --- | --- |
| `GET /healthz` | 服务与可用缓存状态 |
| `GET /api/overview?window=1\|7\|30` | 汇总和平台排名 |
| `GET /api/platforms/:id` | 单平台 64 日序列、scope、来源 |
| `GET /api/coverage` | 指标定义、警告、30 日覆盖矩阵 |
| `GET /api/sources` | 采集运行与来源健康 |
| `POST /api/refresh` | 手动触发只读刷新 |

刷新失败但 SQLite 中存在上次成功数据时，服务会明确显示 stale/degraded 并继续提供旧缓存；不会把失败当成功。采集器并发运行，但同键冲突由中央优先级表确定，结果不依赖采集器数组顺序。

## 验证

```bash
npm run check
npm test
npm run build
npm run verify:live
```

测试覆盖 Pons 合并、协议级 summary 的 Robinhood Chain 筛选、UTC 当前日排除、`null ≠ 0`、Bankr 官方 volume、LetsCash 官方日序列/实时快照、Long integrator 归属与闭合日筛选、确定性来源优先级，以及 StonkBrokers 不进入 tracked totals。`verify:live` 会读取实时 DefiLlama overview、协议级 summary、Bankr、LetsCash 和 Long 官方响应，检查关键字段与预期主流平台是否仍存在。

## 安全边界

这是只读研究工具：不读取钱包、不保存私钥、不签名、不广播交易。当前版本也不声称提供可执行交易优势或完整链上审计总量。
