# BotAnswer v1 合同

## 字段

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| status | ok / clarification / degraded / unavailable / unsupported | 唯一顶层状态 |
| title | string | 不含原始异常、ID 或 Secret |
| bodyLines | string[] | 确定性领域结果，不接受 LLM 自由数字 |
| warnings | BotWarning[] | 按优先级稳定排序 |
| suggestedCommands | string[] | 只能是命令表中的受控命令 |
| detailUrl | HTTPS URL 或 null | 只能来自配置的允许基地址和受控路径 |
| evidence | object 或 null | 数据回答必须存在 |

evidence 固定包含：targetDate、generatedAt、runStatus、stale。help、clarification 和 unsupported 可为 null。

## unknown 原因枚举

NO_OBSERVATION、SOURCE_NOT_REPORTING、SOURCE_FAILED、STALE_WITHOUT_CURRENT_VALUE、SCOPE_NOT_COMPARABLE、VERSION_NOT_AVAILABLE、PLATFORM_NOT_SUPPORTED、CONTRACT_INCOMPATIBLE。中文解释以 docs/bot-glossary.md 为准；任何一种都不得格式化为 0。

## 警告优先级

1. NO_AVAILABLE_DATA
2. CONTRACT_INCOMPATIBLE
3. LATEST_REFRESH_FAILED
4. STALE
5. SOURCE_FAILED / SOURCE_DEGRADED
6. PARTIAL / SCOPE_MISMATCH / SUITE_WIDE
7. DERIVED
8. INFO

同级按 code 字典序，保证快照稳定。

## 完整样例

### rank

```json
{
  "status": "ok",
  "title": "最近 7 个完整 UTC 日｜用户手续费 Top 2",
  "bodyLines": ["1. Pons — $1.25K", "2. LetsCash — $800.00（推导值）"],
  "warnings": [],
  "suggestedCommands": ["/platform pons 7d", "/why fees"],
  "detailUrl": null,
  "evidence": {"targetDate":"2026-08-29","generatedAt":"2026-08-30T01:00:00.000Z","runStatus":"success","stale":false}
}
```

### platform

```json
{
  "status": "degraded",
  "title": "LetsCash｜最近 30 个完整 UTC 日",
  "bodyLines": ["成交量：$12.50K", "用户手续费：未知（当前来源未报告）", "平台收入：$37.50（推导值）"],
  "warnings": [{"code":"SOURCE_DEGRADED","message":"一个来源只返回了部分数据。","priority":5}],
  "suggestedCommands": ["/why LetsCash income", "/status"],
  "detailUrl": "https://ledger.example/platforms/letscash",
  "evidence": {"targetDate":"2026-08-29","generatedAt":"2026-08-30T01:00:00.000Z","runStatus":"partial","stale":false}
}
```

### why

```json
{
  "status": "ok",
  "title": "为什么 Bankr 平台收入是未知？",
  "bodyLines": ["Ledger 只有 Bankr 的 Robinhood Chain 日成交量，没有可复核的链级日收入拆分。", "未知原因：SOURCE_NOT_REPORTING。未知不等于 $0。"],
  "warnings": [],
  "suggestedCommands": ["/platform Bankr 1d"],
  "detailUrl": null,
  "evidence": {"targetDate":"2026-08-29","generatedAt":"2026-08-30T01:00:00.000Z","runStatus":"success","stale":false}
}
```

### status

```json
{
  "status": "degraded",
  "title": "数据可用，但一个来源失败",
  "bodyLines": ["数据截止：2026-08-29 UTC", "来源：3 正常 / 0 降级 / 1 失败", "Ledger 合同：v1（兼容）"],
  "warnings": [{"code":"SOURCE_FAILED","message":"一个来源暂时不可用。","priority":5}],
  "suggestedCommands": ["/rank", "/status"],
  "detailUrl": null,
  "evidence": {"targetDate":"2026-08-29","generatedAt":"2026-08-30T01:00:00.000Z","runStatus":"partial","stale":false}
}
```

### no_data

```json
{
  "status": "unavailable",
  "title": "当前没有可安全使用的数据",
  "bodyLines": ["没有返回排名数字。请稍后用 /status 查看数据恢复情况。"],
  "warnings": [{"code":"NO_AVAILABLE_DATA","message":"Ledger 没有可用缓存。","priority":1}],
  "suggestedCommands": ["/status", "/help"],
  "detailUrl": null,
  "evidence": {"targetDate":null,"generatedAt":"2026-08-30T01:00:00.000Z","runStatus":"empty","stale":true}
}
```
