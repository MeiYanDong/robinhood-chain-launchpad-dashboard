# BotMetricView v1

Bot 领域层只接收经过 Ledger 合同校验的视图，不接收原始 JSON。

| 字段 | 类型 | 来源/规则 |
| --- | --- | --- |
| metric | 核心指标枚举 | overview.metrics 的 key |
| value | number 或 null | overview 请求窗口原值；不补猜 |
| observedDays | integer | overview 对应窗口 |
| windowDays | 1 / 7 / 30 | overview；不得用 detail 的 64 |
| coverage | 0～1 | overview 原值，并保留 observedDays/windowDays |
| latestDate | YYYY-MM-DD 或 null | overview 原值 |
| sources | string[] | overview 原值，排序去重只为稳定输出 |
| qualities | quality[] | overview 原值 |
| scope | string | 平台配置/coverage 合同 |
| comparability | comparable/partial/scope_mismatch/suite_wide/unknown | overview 平台行 |
| excludeFromTotals | boolean | overview 平台行 |

## 合并规则

1. 请求窗口核心指标只来自 `/api/overview?window=1|7|30`。
2. `/api/platforms/:id` 只补平台元数据、64 日 series 和明确标记为 rolling_24h/all_time/current 的 stats。
3. detail coverage 永不覆盖 requested window coverage。
4. `value=0` 保留；`value=null` 携带 unknown reason，不能进入数值排序。
5. `suite_wide` 可在 all 模式作为不可比观察项展示，不能进入平台榜。
6. source health 只解释可用性，不能把失败来源的旧值升级为当前值。
