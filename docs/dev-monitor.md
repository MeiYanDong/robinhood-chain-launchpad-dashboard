# DEV 地址监控

## 监控目标

服务端自动发现 PAIR V2、pons v1、pons v2 与 Long 的代币创建者，持续检查两类动作：

- 已进入重点监听的创建者再次通过上述发射台创建代币；
- 重点创建者地址买入 ERC-20 代币。

它只做只读观察和通知，不连接钱包，不签名，也不发送链上交易。

## 地址归属

| 平台 | 归属证据 | 创建者字段 | 置信度 |
| --- | --- | --- | --- |
| PAIR V2 | 当前 canonical coordinator 的 `CanonicalProjectLaunched` | indexed creator | 高 |
| pons v1 | 官方 factory 的 `TokenLaunched` | indexed deployer | 高 |
| pons v2 | 官方 factory 的 `TokenLaunched` | indexed deployer | 高 |
| Long | LongLauncher 的发行事件（第 3 个 topic 为发行币，第 4 个为配对资产）+ 同笔交易发送者 | transaction sender | 中 |

Long 的事件能证明代币由 LongLauncher 发射，但交易发送者可能是上游路由或代发合约，所以不能与
PAIR / pons 的 indexed creator 视为同等证据。不同平台的事件解码器彼此独立，不能共用位置假设。
PAIR 快照带有已核验的发行时间；pons / Long 的 RPC 日志本身没有时间戳，因此账本保留区块号与交易
哈希，发行时间保持未知，不为历史事件逐条请求区块或伪造近似时间。

首次启用时从当前 PAIR V2 完整快照建立基线，并对 pons / Long 默认回看最近 250,000 个区块。
这个窗口用于找到最近仍在活跃的创建者，不冒充平台全历史覆盖；之后由服务持续增量积累。买入游标
只从当前确认区块开始，不补发历史飞书消息。每个来源分别建立基线，即使某个来源晚于服务启动才
恢复，也不会把其历史发行一次性推送到飞书。

## 哪些地址进入重点监听

所有被官方发行事件确认的创建者都会进入候选账本，但只有 `proven` 创建者才可能进入通知层。
为了排除批量发币工厂，通知层还要求其发行数不超过 5 个，或至少 2 个项目成功且成功率不低于
15%，或至少 2 个 PAIR V2 项目通过质量门槛。其余地址与事件仍完整保留在数据层，但不争夺通知注意力。

画像层的分级条件如下：

- `proven`：至少一个项目同时达到市值 25,000 美元、流动性 10,000 美元；或同时达到
  24H 成交 25,000 美元、流动性 5,000 美元；
- `repeat`：至少两个项目达到经济活跃门槛；或至少两个 PAIR V2 项目通过质量门槛且最高
  24H 成交不低于 1,000 美元。

重复发币本身不构成重点 DEV，因为它会把批量测试地址和垃圾币工厂排到前面。市场数据来自
DexScreener；缺失时保持未知，不能按 0 参与通过判断。

## 买入判定

候选交易先由 `Transfer(to = DEV)` 日志发现，再读取完整交易与 receipt。只有同时满足以下条件才会发飞书：

1. receipt 成功；
2. 已达到配置的确认区块数；
3. DEV 对目标 ERC-20 的同笔交易净变化为流入；
4. DEV 对另一 ERC-20 的同笔交易净变化为流出，或 DEV 是交易发送者且发送了原生 ETH；
5. DEV 本身是交易发送者，达到高置信度。

铸币、空投、普通收款、只有一条转入腿的交易不会当作买入。智能钱包由第三方地址触发但发生了
资产净流出的交易会留在证据账本中，置信度为中，不发送通知。原生 ETH 无法仅靠 receipt 还原
内部退款，所以消息显示“交易发送上限”，不是精确净支付；如需精确值要增加 trace 来源。

同一笔创建并初始买入会记录为 `initial_buy`，但只发送“新发币”消息，避免重复提醒。

## 调度与失败语义

- 默认链上轮询：8 秒；
- 默认确认数：2；
- 默认重叠回扫：12 个区块；
- 项目市场画像：5 分钟；
- 市场画像按 30 个地址分批并节流；部分批次失败时保留成功结果，失败项目继续保持未知；
- RPC 批量读取限制为每批 50 个请求，降低公共节点限流风险；
- 每个平台有独立游标；单一来源失败时该游标不前移；
- 未配置飞书时只保留项目与交易事实，不再创建“待发送”记录；
- 只通知 `proven` 且通过反垃圾门槛的创建者新发币，以及其买入已核验发射台代币；画像晋级
  只留在面板，不发飞书；
- 同一 DEV 的同类动作默认 6 小时冷却；信号超过 45 分钟即封存，不补发过期消息；
- 普通发行信号至少间隔 20 分钟聚合投递；高置信买入可立即突破该聚合窗口；
- 每小时最多投递 3 条信号，每次最多 3 条合并为一条飞书消息；
- 飞书 outbox 使用唯一键去重，失败最多重试 5 次并指数退避；原始项目和交易事实独立保存；
- Webhook 只允许官方 Feishu / Lark HTTPS 域名，只保存在服务器环境变量中。

公网健康接口 `/api/dev-monitor/health` 只返回项目数、候选数、重点监听数、确认区块、来源状态和
通知状态。`/api/dev-monitor/pair-launches` 只公开 PAIR V2 官方发行事件中本来已经公开的项目币、
creator、交易哈希、区块以及相应公开市场画像，供页面展示“创建者 → 新币”关系；它不返回 pons、
Long 地址库、买入行为、私有标签、通知 outbox 或服务端配置。

`/api/dev-monitor/pair-team-launches` 是另一个严格收窄的公开读模型，只收录已核验 PAIR 主发行
钱包 `0xa15e4ad0dbc8df1715a7b254526252cd93bb1102` 发出的代币。该钱包归属由两条证据共同约束：PAIR
官方 token API 将它列为 `$PAIR` creator，且 `$PAIR` 发行交易由它发送到官方 Launchpad。页面只消费
这个收窄接口，不再把 `repeat` / `proven` 的核心创建者榜冒充成 PAIR 项目方。

读模型继续把身份层级拆开：`$PAIR` 是官方文档和官方 API 明确确认的协议代币；同一钱包后续发行
的代币只标为“项目方钱包发行”，没有独立公告时明确写“未见官方确认”。同钱包关系不能自动升级为
品牌背书、安全审计或买入建议。原 `/api/dev-monitor/pair-launches` 保留给内部排查与兼容读取，
但不再作为 PAIR V2 页面的项目方发币入口。

## 配置

```text
DEV_MONITOR_ENABLED=true
DEV_MONITOR_FEISHU_WEBHOOK_URL=<server-side secret>
DEV_MONITOR_POLL_SECONDS=11
DEV_MONITOR_CONFIRMATIONS=2
DEV_MONITOR_MARKET_POLL_SECONDS=300
DEV_MONITOR_BUY_CATCHUP_BLOCKS_PER_POLL=2000
DEV_MONITOR_BUY_MAX_RECOVERABLE_LAG_BLOCKS=10000
DEV_MONITOR_RPC_MIN_INTERVAL_MS=750
DEV_MONITOR_ALERT_MAX_AGE_MINUTES=45
DEV_MONITOR_ALERT_HOURLY_LIMIT=3
DEV_MONITOR_ALERT_BATCH_SIZE=3
DEV_MONITOR_ALERT_DEVELOPER_COOLDOWN_MINUTES=360
DEV_MONITOR_ALERT_DELIVERY_COOLDOWN_MINUTES=20
```

Webhook 不得写入 Git、浏览器代码、公开 API 或部署证据文件。

买入游标如果因 RPC 故障落后，会每轮最多追赶 2,000 个区块并在每段成功后立即保存游标。
追赶完成前，历史活动只进入证据账本，不进入飞书 outbox；追至当前确认区块后才恢复实时买入提醒。
如果热点区间仍触发公共 RPC 限流，扫描范围会自动缩小并退避，最多降到 125 块；限流造成的
元数据失败不会缓存成永久未知。
实时发现优先于历史补齐：落后超过 10,000 块时，服务把未覆盖区间写入状态账本并直接恢复
当前确认区块监听。该区间保持明确未知，可由独立离线任务回补，但不会进入飞书队列。
