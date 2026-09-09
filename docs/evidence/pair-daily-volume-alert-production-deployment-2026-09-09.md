# PAIR 日交易量 10% 飞书告警生产部署证据

记录日期：2026-09-09；部署与最终回读发生在 04:46–04:50 UTC。

## 发布对象

- 版本：`0.20.1`。
- GitHub：PR #19；生产代码提交
  `98952d41aedc7c3d6e8074f4fc9878c5fc211afe`。
- release：`/opt/robinhood-chain-launchpad/releases/20260909T044433Z-98952d4`。
- 上一版回滚点：
  `/opt/robinhood-chain-launchpad/releases/20260909T040345Z-0364bd9`。
- 发布包 SHA-256：
  `2ed90e710fe9d4ce013893a14cde37a759bd065a01fdbfe07832f9a52c829445`。

## 告警口径

1. 只比较最近两个完整 UTC 日，公式为 `(最新日 - 前一日) / 前一日 × 100%`；
2. 涨跌绝对值达到 `10%` 都通知，当前未结束日和滚动 24H 不进入判断；
3. 只接受 `pair.officialStats.dailyVolume`，并要求来源健康为 `ok`、连续两日都有数据、
   前一日大于零；
4. 同一组日期用唯一键去重；状态写入 `platform_volume_alert_outbox`，失败最多重试 5 次；
5. 专用 Webhook 未配置时按顺序复用 PAIR V2、DEV 监控的服务器端 Webhook。公网接口和日志
   不返回 Webhook。

## 首次真实投递

部署后的现有完整日满足阈值，因此产生并投递了一条真实告警：

| 字段 | 读回值 |
| --- | ---: |
| 前一日 | `2026-09-07` |
| 前一日 PAIR 平台交易量 | `$5,381,262.43895861` |
| 最新日 | `2026-09-08` |
| 最新日 PAIR 平台交易量 | `$1,993,384.68866284` |
| 日变化 | `-62.95693229470884%` |
| 触发阈值 | `10%` |
| 来源 | `pair.officialStats.dailyVolume` |
| outbox 状态 | `sent` |
| 尝试次数 | `1` |
| 飞书接受时间 | `2026-09-09T04:46:23.820Z` |
| 最后错误 | `null` |

服务只在 Feishu/Lark 返回 HTTP 成功且业务码 `0` 后标记 `sent`。这证明 Webhook 接受了消息，
不等于证明用户已经阅读。

## 验证结果

- 本地 `npm run verify`：格式、lint、类型、292/292 测试、覆盖率门槛和构建全部通过；
- 全链服务 17/17 测试与构建通过；CashCat 36/36 测试通过；
- GitHub `verify`、`chain-daily`、`cashcat` 三条 CI 全部通过；
- 公网 `/api/meta` 返回 `appVersion=0.20.1`、`targetDate=2026-09-08`；
- 公网 `/api/platform-activity/alerts/health` 返回 `configured=true`、`thresholdPct=10`、
  `pending=0`、`failed=0` 和上述 `lastSentAt`；
- 公网运行验证 23/23 个只读合同通过；
- collector、query、CashCat 和 Nginx 均为 `active/running`，`NRestarts=0`；
- `robinhood-chain-launchpad-refresh.timer` 为 `enabled/active`，下一次北京时间 15:10 自动刷新；
- 新服务启动以来没有 `pair_daily_volume_alert_delivery_failed` 日志。

切换 release 时，旧 collector 在 20 秒停止期限内未退出，被 systemd 终止；新进程随后正常
启动并完成 SQLite 读写、告警去重和真实投递。当前服务无自动重启，未触发回滚。

## 数据与回滚边界

本次迁移只新增告警 outbox 表，没有改写或删除原始日度指标。服务器主 SQLite 当时约
`6.7 GiB`，磁盘仅余约 `4.0 GiB`，因此没有制造一个无法完整落盘的数据库副本；原数据库与
WAL 继续原位保留，代码回滚点也保留。若需回滚代码，将 `current` 原子指回上一 release，恢复
上一版 unit，并重启 collector/query；新增空闲表可留存，不影响旧版本读取。
