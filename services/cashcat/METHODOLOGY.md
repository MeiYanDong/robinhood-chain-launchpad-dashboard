# Cash Cat Thesis Sentinel 方法论 v0.2

## 1. 决策问题

唯一问题：**Cash Cat 的持有前提是否仍然成立？**

输出只允许：

- `HOLD`：全部必要前提已被新鲜证据确认；
- `WATCH`：前提未被推翻，但有缺口、弱化或龙头挑战；
- `EXIT_CANDIDATE`：自动数据发现可能的跨链分流，等待连续确认；
- `EXIT`：任一用户定义的离场条件已被新鲜证据确认；
- `UNKNOWN`：关键数据错误、缺失或过期。

盈利比例、买入价、浮盈浮亏不进入任何字段。

## 2. 四层模型，不做总分

### A. 数据健康门

`data_health = GMGN 必要命令均成功，observed_at 未超过 2.5 × poll_interval。`

- 来源：`gmgn-cli config --check`、命令返回码、业务码、采集时间；
- 缺失规则：立即 `UNKNOWN`；
- 不能用最近一次好数据伪装成当前数据。最近一次好数据只用于界面回看。

### B. 龙头层

先构造“可比 Meme 同业集合”，再分别比较：

1. `market_cap_ratio = CashCat 市值 / 最强合格同业市值`
2. `liquidity_ratio = CashCat GMGN 最大主池流动性 / 最强合格同业 GMGN 最大主池流动性`
3. `volume_ratio_w = CashCat(w) / 最强合格同业(w)`，`w ∈ {5m,1h,6h,24h}`
4. `holder_ratio = CashCat 持币地址 / 最强合格同业持币地址`

同业资格门：

```text
peer.market_cap >= max($250k, CashCat.market_cap × 1%)
AND
peer.liquidity >= max($25k, CashCat.liquidity × 1%)
```

同时排除名称明确以 `• Robinhood Token` 结尾的股票代币化包装，因为它们不是 Meme 同业；可用 `CASHCAT_PEER_EXCLUDED_ADDRESSES` 追加人工审计后的地址排除。其他在通用池或非专属 launchpad 上交易的代币不会仅凭平台名被排除，避免误删 StonkBroker、The Index 等 Meme。此步骤用于剔除非同类资产，以及“几乎没有经济活动但 holder_count 异常高”的垃圾/空投地址，不是把不利竞争者删掉。每个排除项及理由、原始同业数与合格同业数都必须展示。

断崖初始阈值：市值、流动性、持币地址为 `1.5×`；多周期成交量需要至少 3/4 窗口排名第一，且四窗口领先倍数几何均值不低于 `1.3×`。阈值是 MVP 初始值，积累 7–30 天数据后再根据历史分布校准。

流动性必须同时披露两种口径，但不能混算：

```text
同链龙头比较 = GMGN 最大主池流动性
钱包/聚合器差异核对 = DEX Screener 同一主池、前 5 池、全部索引池合计
```

GMGN 与 DEX Screener 即使指向同一池，估值也可能因价格、集中流动性计算和快照时点不同而不一致。页面必须写明来源、池数和观测时间，不能只放一个没有口径说明的“流动性”数字。

龙头层只产生 `FOUR_CLIFFS / LEADER_NOT_CLIFF / CHALLENGED / LOST / UNKNOWN`。它是诊断层，不擅自增加用户未定义的离场条件；`LOST` 先进入 `WATCH`。

### C. 链热度与外部热点层

当前采集所有支持链的 GMGN `hot-searches`，每条链按 `visiting_count` 本地重排，取 Top 10：

```text
attention_share(chain) = Top10 visiting_count(chain) / 全链 Top10 visiting_count 总和
activity_share(chain) = Top10 24h volume(chain) / 全链 Top10 24h volume 总和
```

GMGN 返回的 `rank` 曾与 `visiting_count` 不一致，所以不能直接信任 `rank`。

分流不是“其他链绝对比 Robinhood 大”，而是同时满足：

```text
Robinhood attention_share < 自身历史中位数 × 0.60
AND Robinhood activity_share < 自身历史中位数 × 0.60
AND 某外部链 attention_share > 该链历史中位数 × 1.25
```

至少积累 `12` 个历史点才开始判断，之前为 `WARMING_UP`。这避免系统启动第一分钟就把任何大链误判成“新热点”。

链热度与 Cash Cat 自身热度严格分开：

```text
Robinhood Chain 热度状态
  = 链的注意力份额相对自身历史
  + 链的成交活跃份额相对自身历史
  + 外部链是否同步加速

Cash Cat 链内热度
  = Cash Cat 在 Robinhood 热搜 Top 10 的名次与份额
```

Cash Cat 从链内第 1 降到第 7 可以触发“代币自身关注下降”的观察，但不能单独把整条 Robinhood Chain 标成转弱。

### D. 叙事硬门

三个字段分别保存，不能合成情绪分：

```text
founder_support = supportive / neutral / negative / unknown
mainstream_attention = mainstream / fading / gone / unknown
external_hotspot = none / emerging / confirmed / unknown
```

自动证据来自 TwitterAPI.io 实盘推文，保留原帖链接、观测时间、判断说明和互动数据。检索拆成六路：

1. Robinhood 公司官方、传播安全、欧洲官方、CEO、Crypto 负责人和联合创始人；
2. Vlad Tenev 关于 Robinhood Chain 与 Meme 的窄查询，防止关键原帖被大号高互动内容挤出；
3. Arbitrum、Uniswap、Alchemy、Chainlink、BitGo 等官方生态伙伴；
4. Cash Cat 24 小时最新讨论；
5. Robinhood Chain 24 小时最新讨论；
6. 其他链 Meme 热点。

创始人立场有效期 30 天；主流讨论和外部热点每轮重查，1 小时后过期。`negative`、`gone`、`confirmed` 任一新鲜证据出现，立即输出 `EXIT` 建议。未知或过期只能输出 `WATCH`，不能输出 `HOLD`。人工证据只在实盘状态为 `unknown` 时补位，不能覆盖已经抓到的实盘原帖。

公司安全公告是更高优先级的可信度门。如果 Robinhood 官方确认某负责人账号被盗：

```text
事发前原帖 = 可继续作为历史证据
事发后至恢复公告之间的帖子 = 自动隔离
官方确认恢复后的帖子 = 重新进入判断
```

负责人和生态伙伴的推进动态用于回答“团队是否仍在建设、外部基础设施是否仍在跟进”，属于重要佐证；它们不能替代用户定义的创始人反对、主流讨论消失和新热点分流三条硬门。

## 3. 状态机与抗抖动

```text
数据失败 ───────────────────────────→ UNKNOWN
直接叙事硬门命中 ───────────────────→ EXIT
跨链自动分流单次命中 ───────────────→ EXIT_CANDIDATE
跨链自动分流连续 3 次命中 ──────────→ EXIT
龙头挑战 / 热度弱化 / 叙事缺口 ─────→ WATCH
全部前提新鲜且确认 ─────────────────→ HOLD
EXIT 后恢复需连续 3 次 HOLD 候选 ───→ HOLD
```

通知只在稳定状态变化时发送，避免每轮重复轰炸。`EXIT` 是建议，不是链上操作。

## 4. 数据源与缺口

| 领域 | 当前来源 | 当前状态 |
|---|---|---|
| Cash Cat 市值/最大主池/holders/多周期量 | GMGN `token info` | 自动 |
| Cash Cat 多池流动性 | DEX Screener token pairs | 自动交叉核对，不参与同链排名 |
| Robinhood 同业榜 | GMGN `market trending` | 自动 |
| 跨链搜索热度/活跃量 | GMGN `market hot-searches` | 自动 |
| Token 安全辅助告警 | GMGN `token security` | 自动，但不改写用户的两条离场硬门 |
| Robinhood KOL/聪明钱流 | GMGN `track` | 不支持 Robinhood，明确缺失 |
| 创始人立场 | TwitterAPI.io：Vlad Tenev 窄查询 + Robinhood 官方安全公告 | 自动、实盘、带账号隔离 |
| 公司负责人/生态推进 | TwitterAPI.io：Johann Kerbrat、公司账号、联合创始人及 5 个生态伙伴 | 自动、实盘、作为佐证 |
| Cash Cat / Robinhood Chain 讨论度 | TwitterAPI.io 24h 最新推文 | 自动、实盘、过滤空投噪音 |
| 外部 Meme 新热点 | TwitterAPI.io 24h Top 推文 | 自动、实盘、多作者 + 连续三轮确认 |

## 5. 必测反例

- 正常：四项均断崖、链热稳定、叙事完整；
- 强正：所有领先倍数显著升高；
- 强负：创始人直接负面表态；
- 边界：领先倍数恰好 1.5×；
- 缺失：任一 GMGN 必要命令失败；
- 过期：叙事证据超过 freshness；
- 冲突：市值/流动性领先但短周期量被 PONS 反超；
- 极端值：低市值、低流动性币 holder_count 异常巨大；
- 反转：连续分流后恢复；
- 冷启动：历史基线不足 12 个点。

每次调阈值必须记录：失败案例、字段/函数/门的根因、修改、预期副作用、回放结果。
