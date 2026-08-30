# RHC Launch Ledger Bot 术语表

| 术语 | 唯一含义 | 禁止混用 |
| --- | --- | --- |
| Ledger | 现有 RHC Launch Ledger HTTP API，是 Bot 唯一数字事实 | Bot 自建采集、直读 SQLite、网页抄数 |
| targetDate | 本次回答使用的最后闭合 UTC 日，格式 YYYY-MM-DD | 当前本地日期、消息日期 |
| requested window | 用户请求的 1/7/30 个闭合 UTC 日窗口 | detail 固定 64 日 coverage |
| 1d | targetDate 当天这一个完整 UTC 日 | 从当前时刻回滚 24 小时 |
| rolling24h | 平台官方的滚动 24 小时快照，period=rolling_24h | 1d 排名、完整日数据 |
| quality | reported、derived、partial、scope_mismatch、suite_wide、unknown | 准确率或审计保证 |
| coverage | observedDays/windowDays 或已知平台/候选平台 | 把无观测补成 0 |
| source health | ok、degraded、failed 的来源运行状态 | 指标质量或平台状态 |
| suite-wide | 同一数值混合 Launchpad 外的多个产品范围 | 单平台可比指标 |
| live | 平台注册状态为 live，且通过能力合同 | 今天有交易的主观判断 |
| all | 允许展示受支持的非 live 平台；仍隔离不可比项 | 无条件收进排行榜 |
| stale | 可用缓存超过配置的新鲜度阈值 | 数据一定错误 |
| partial | 只有部分时间/范围/来源覆盖 | 0 或 unknown |
| unknown | 证据不足、不可比或当前未报告；带明确原因 | 0 |
| volume_usd | 来源范围内的 USD 名义成交量 | 收入或利润 |
| fees_usd | 用户支付的全部费用 | 平台收入 |
| protocol_revenue_usd | 可归协议、团队或金库的平台收入；income 是输入别名 | protocol_income_usd、净利润 |
| revenue_usd | DefiLlama 较宽 Revenue 维度，仅按需解释/明确平台查询 | 默认 income 排名 |

## 两个必须澄清的反例

- 用户说今天数据：完整日口径无法包含尚未闭合的今天。Bot 应问是否查看最近完整日 1d。
- 用户说过去 24 小时：排名不把它静默改成 1d；单平台只有合同确有 rolling24h 时才可单独展示。

## unknown 原因

| 枚举 | 大白话解释 | 不能写成 0 的原因 |
| --- | --- | --- |
| NO_OBSERVATION | 这个窗口里没有明确观测 | 没看到不代表没有发生 |
| SOURCE_NOT_REPORTING | 当前来源没有提供该指标 | 来源缺字段不等于数值为零 |
| SOURCE_FAILED | 负责该数据的来源本次失败 | 请求失败不能推出业务为零 |
| STALE_WITHOUT_CURRENT_VALUE | 只有旧值，没有当前窗口值 | 旧值不能冒充当前值 |
| SCOPE_NOT_COMPARABLE | 口径与目标榜单不可比 | 不可比不是没有活动 |
| VERSION_NOT_AVAILABLE | 当前 Ledger 版本没有该能力 | 版本缺能力不是数值零 |
| PLATFORM_NOT_SUPPORTED | Bot 当前能力表未开放该平台 | 未支持不代表平台为零 |
| CONTRACT_INCOMPATIBLE | API 结构或主版本不兼容 | 无法安全读数时必须失败关闭 |
