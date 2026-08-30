# Bot 命令语法 v1

## 共同规则

- 清洗后上限 1000 字符；命令名不区分大小写，参数规范化后解析。
- 群聊只处理事件明确标记为当前 Bot mention 的普通文本；私聊不要求 mention。
- 支持半角/全角空格和常见中文窗口写法；不打开消息中的 URL、附件或卡片。
- 歧义只问一个具体问题，不猜平台、窗口或口径。

## /start 与 /help

语法：`/start`、`/help`，不允许额外参数。静态返回能力、边界和例子，不访问 Ledger/LLM。额外参数返回 INPUT_INVALID 并给 `/help`。

## /rank

语法：`/rank [1d|7d|30d] [volume|fees|income] [live|all]`；三类参数可交换顺序，每类最多一个。

默认：1d、volume、live。

别名：1天/一天→1d，7天/一周→7d，30天/一个月→30d；交易量/成交量→volume；手续费/用户费用→fees；平台收入/协议收入→income；income 内部映射 `protocol_revenue_usd`。

非法：24h 不静默改为 1d；revenue 不是默认榜指标；重复窗口、未知 token、平台名都返回具体错误和合法例子。

## /platform

语法：`/platform <平台名或别名> [1d|7d|30d]`，默认 1d。平台名缺失时问“你想查哪个平台？”；多个别名命中时列候选；24h 只在平台合同有 rolling stats 时作为独立意图，否则澄清。

## /why

语法：`/why <metric|platform|quality|coverage|sources>`，可同时带一个平台和一个明确指标。例如 `/why Bankr income`、`/why coverage`。未知主题返回可解释主题清单，不让 LLM自由回答。

## /status

语法：`/status`，不接受 URL、host、端口、路径、调试或 refresh 参数。额外参数一律 INPUT_INVALID。

## 自然语言

确定性规则覆盖排行榜、平台、解释、状态和 1/7/30 天常见中英文。只有 action 与必要参数唯一时生成 QueryPlan；否则交给启用且预算允许的 LLM resolver，仍需 Schema 校验；再失败就澄清。

## 错误示例

| 输入 | 结果 |
| --- | --- |
| `/rank` | rank, 1d, volume, live |
| `/rank 7d fees all` | rank, 7d, fees, all |
| `/rank 24h` | clarification：完整日 1d 还是单平台滚动 24H？ |
| `/platform` | clarification：你想查哪个平台？ |
| `/status http://host` | INPUT_INVALID；不访问 URL |
| `/rank 7d volume fees` | INPUT_INVALID；只能选一个指标 |
| `帮我买最强的平台币` | unsupported；给只读命令替代 |
