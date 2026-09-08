# PAIR V2 监控合同

版本：0.15.0（本地实现）

范围：当前 canonical release 的只读监控、早期项目发现与状态跃迁告警。

## 产品边界

PAIR V2 与旧 PAIR 平台币资金闭环是两套对象：

- `/pair-flow/` 追踪 PAIR 平台币既有回购、销毁和待处理资金；
- `/pair-v2/` 追踪 V2 新发行项目自身的费用模式、项目币回购销毁和持有人领取；
- `/pair-alpha/` 横跨 PAIR V1/V2，负责发现机会、过热勿追与首次信号回放，不解释 V2 机制；
- V2 项目币的 70% mode share 不能解释为 `$PAIR` 的买压；
- 本模块不读取钱包、不签名、不广播，也不把 Alpha 分数转换为自动交易。

更完整的机制、权限与源码核验见
[`pair-v2-deep-dive-2026-09-05.md`](pair-v2-deep-dive-2026-09-05.md)。

## 数据流

```text
PAIR release attestation ── releaseId + manifest + active graph ┐
PAIR token API ──────────── market / official poolId / profile   ├─ join by project
DexScreener pair API ────── 5m / 1H / 6H volume, txns, liquidity │
Robinhood Chain RPC ─────── launch / fee / buyback / claim       │
GMGN ────────────────────── holder observation                    ┘
                                      │
                                      ▼
                              SQLite WAL ledger
                                      │
                       ┌──────────────┴──────────────┐
                       ▼                             ▼
                 read-only API               transition alerts
                       │                        optional Feishu
                       ▼
               `/pair-v2/` terminal
```

先验证 release，再接受其事件。项目必须命中当前 coordinator 的发行事件，不能只凭地址尾部
`5555` 或官网列表认定归属。历史 release 保留在数据库，但默认榜单只展示当前 release。

## 刷新层级

| 层级 | 默认频率 | 内容 | 失败行为 |
| --- | ---: | --- | --- |
| 链上快层 | 8 秒 | 确认区块、发行、归集、回购、领取、升级 | 保留最近可用快照并标记来源异常 |
| 热行情层 | 15 秒 | 最多 72 枚活跃候选的 canonical pool 短周期量价与买卖笔数 | 失败保留旧快照并明确标记，不阻塞链上轮询 |
| 市场完整层 | 60 秒 | release、token 全分页、行情候选重选、价格、市值、流动性、成交、持币地址、bucket | 不用旧值冒充本次成功；超过 150 秒标记 stale |

GMGN 是逐币进程调用，默认每个市场轮询最多补采 9 枚，并优先 5m 活跃项目；失败项目有冷却时间，
不会拖住全部短周期行情。完整 holder 覆盖是渐进式的，未覆盖项目保持未知。

链上读取落后链头 2 个区块，并重复扫描最近 12 个区块。事件表在重叠区间先删后重建；当前
release 的 launch 集合整体替换，因此短重组中的孤块记录不会长期残留。服务端定时器运行在主
Node 进程内，与浏览器是否打开无关。

## 指标口径

| 页面字段 | 口径 | 证据类型 |
| --- | --- | --- |
| 已观测官方池 5M / 1H / 24H 成交 | 仅对“PAIR 返回的官方 poolId”与 DexScreener 返回的链、poolId、base token 三项均匹配的池求和；三档时间窗使用同一覆盖集合 | observed，覆盖不足时 partial |
| 可观测池流动性 | 与上项相同的已验证官方池流动性之和 | observed，覆盖不足时 partial |
| 当前 release 24H 成交 | 当前 release 且官方市场 API 已索引、未隐藏/标记项目的成交额之和 | observed |
| 用户手续费 | 当前可见成交额 × 1% | calculated |
| 模式份额 | 当前可见成交额 × 1% × 70% | calculated |
| 协议份额 | 当前可见成交额 × 1% × 30% | calculated，不是净利润 |
| 回购模式理论新增 | 仅 mode 2 项目的可见成交额 × 0.7% | calculated，不是当前 bucket |
| 待执行回购桶 | 在确认区块调用项目 vault 的 `buybackBucket(epoch, asset)` | onchain pending |
| 已执行回购销毁 | `BuybackExecuted` 的投入资产与实际销毁项目币 | onchain executed |
| 持有人领取 | `HolderDistributionClaimed` | onchain executed |
| 协议升级 | launchpad 的 `Upgraded` | onchain risk event |

不同 quote asset 的 bucket 只分别展示数量，不在缺少同区块美元价格时相加成一个美元总额。
成交额估算永远不回填成实际回购；没有事件就是“未观测到执行”，不是“执行额等于理论值”。

## Alpha 判断

当前模型为 `pair-v2-alpha-v2.0.0`，状态固定为 **Shadow**。它不使用单一综合分，也不产生买入、
仓位或自动交易指令。五个输出承担不同职责：

1. **质量门槛**：流动性承接 45%、采用广度 35%、资料可核验度 20%。资料齐全只是可核验，不等于团队可靠。
2. **关注度**：同模式、同币龄项目中的 5m/1H 成交分位、1H 换手、买入笔数和买卖方向。
3. **早期时机**：15m 市值、持有人、流动性变化，叠加 5m/1H 买卖方向和成交加速度。
4. **热度**：1H 涨幅、5m 成交拥挤、1H 换手与薄流动性压力；过热会拦截研究信号。
5. **风险与证据**：平台风险、单币风险和数据完整度独立展示，机会信号不能抵消其中任何一项。

只有“质量已通过、时机分不低于 58、关注度不低于 65、未过热、单币风险低于 high”的项目
进入 `forming`；更高时机分、5m 买入占优且证据完整时才进入 `confirmed`。未命中当前 release、
被隐藏或被标记的项目直接 `rejected`。缺少短周期行情或流动性时，证据完整度最高为 69%。

比较组按 `modeId × 币龄（0–24h / 24–72h / 72h+）` 建立；组内少于 3 枚时退化到当前 release
全体。增长特征使用有界函数，任何分数均限制在 0–100。当前生产合约图风险仍单独显示 high，
但不伪装成单币质量结论。

### Shadow 回放

每个 `releaseId × project × modelVersion` 只冻结第一次 `forming/confirmed` 信号和当时价格，随后
在 5m、30m、2H、6H、24H 找目标时点后的首个有效快照。页面展示样本数、中位收益、正收益率和
跌超 20% 比例。手续费调整只扣双边 1% 平台费，尚未计入滑点、Gas 和真实可退出深度。

至少观察 14 天并获得 50 个 24H 成熟样本后，模型才进入人工复核门槛；达到门槛也不会自动
改为 validated。模型版本变化会使用新的首次信号账本，避免新旧阈值混算。

## 告警

默认不发送。只有服务器环境存在 `PAIR_V2_FEISHU_WEBHOOK_URL`，且 URL 属于官方
`open.feishu.cn` 或 `open.larksuite.com` HTTPS webhook 时启用。

告警只针对状态变化：

- releaseId 变化、implementation 升级：critical；
- 新发行：info；
- 新 `BuybackExecuted`：warning；
- 研究资格成立且项目首次进入 forming/confirmed：info/warning；
- 热度首次进入 overheated：warning；
- 单币风险从 low/medium 升至 high/critical：warning/critical。

首次建立基线不群发历史事件。每条消息有持久化 dedupe key；失败留在 outbox，下一轮最多重试
10 条。页面与 API 不返回 webhook 内容。

## 存储与 API

SQLite 使用 WAL，按 release、token、snapshot、launch、event、bucket、source health、run、
dashboard snapshot、首次 Alpha 信号、分时结果和 alert outbox 分表。每个快照绑定 observedAt 与
latest confirmed block。
分钟级 token 历史保留 72 小时，仪表盘快照保留最近 2,048 份；运行记录至少保留最近 8,192
次，并保留仍被市场历史或仪表盘引用的运行，避免 8 秒轮询让数据库无限增长。

| 路由 | 行为 |
| --- | --- |
| `GET /api/pair/v2` | 有缓存时立即返回并保留新鲜度标记；超过轮询周期后后台触发完整只读刷新。仅首次无快照时等待采集 |
| `GET /api/pair/v2/health` | 返回后台监控、区块、时效和告警队列状态 |
| `GET /api/pair/v2/events?limit=1..200` | 返回最近链上事件 |
| `GET /api/pair/v2/tokens/:address` | 返回当前快照中的单币详情 |
| `POST /api/pair/v2/refresh` | 手动完整刷新；公网 Nginx 单独限流 |

## 尚未解决的证据缺口

- active production graph 的完整 exact-match 源源码覆盖率；
- 与当前 implementation 对应的独立审计报告、范围、commit/hash 和修复记录；
- upgrade controller 是否迁移到 multisig/timelock；
- protocol 30% 最终去向、真实成本与净利润；
- archive RPC 下的全部历史 release 回填；
- 官方没有无参数返回当前 standard-route 的入口时，自动发现新 release 仍需额外公告/链上 registry 发现源；固定 attestation 不匹配会先失败关闭；
- bucket 到执行的延迟分布、失败原因和 keeper 在线率。

这些字段在证据闭环前保持风险提示或未知，不从公告措辞推断。
