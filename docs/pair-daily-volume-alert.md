# PAIR 日交易量飞书告警

## 用户口径

告警比较 PAIR 最近两个已经完整结束的 UTC 日。设前一日交易量为 `V₀`、最新日交易量为
`V₁`：

```text
日变化百分比 = (V₁ - V₀) / V₀ × 100%
```

当 `|日变化百分比| >= 10%` 时发送飞书。上涨和下跌都通知；消息同时写明两个具体日期、
两日金额、变化方向和百分比。它不是滚动 24H，也不会用当天尚未结束的数据。

## 数据门禁

只在下列条件全部成立时判断：

1. `pair.officialStats` 来源状态为 `ok`，且最新数据日期等于目标完整日；
2. 两个自然日连续，并且都来自 `pair.officialStats.dailyVolume`；
3. 前一日交易量大于 `0`，两日数值都是有限数；
4. 服务端存在有效的官方 Feishu/Lark HTTPS Webhook。

任一条件不成立时不发消息，也不把缺失数据当作 `0`。

## 去重与重试

- 唯一键为 `pair-daily-volume:<前一日>:<最新日>`；同一组日期只发送一次；
- 发送记录持久化在主 SQLite 的 `platform_volume_alert_outbox`，服务重启不会重放已发送记录；
- 失败最多尝试 5 次，以 5、10、20、40、60 分钟退避；后台每 5 分钟检查到期记录；
- 通知失败不改变日度采集结果，采集与通知分别保留状态。

## 运行与核验

日度采集由 `robinhood-chain-launchpad-refresh.timer` 在北京时间 15:10 触发。服务冷启动时也会
核对最新完整日，因此部署当天若最新两日已跨过阈值，会补发这一组日期的一条消息。

公开只读健康接口：

```text
GET /api/platform-activity/alerts/health
```

接口只返回是否配置、阈值、待发送/失败数量和最近成功时间，绝不返回 Webhook。

`PAIR_DAILY_VOLUME_FEISHU_WEBHOOK_URL` 可独立指定；未指定时依次复用已有的
`PAIR_V2_FEISHU_WEBHOOK_URL`、`DEV_MONITOR_FEISHU_WEBHOOK_URL`。密钥只保存在
`/etc/robinhood-chain-launchpad.env`。
