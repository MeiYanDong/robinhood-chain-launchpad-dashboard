# Phase 1 本地无凭证原型｜小型故事卡

## 统一完成定义

每张卡只有在代码/文档存在、针对性测试通过、全量 npm run verify 通过、todo 证据回写后才完成。fixture 或 fake 的结果只能标为本地验证，不得写成真实 DeBox、真实模型或生产回执。每张卡都可通过回退该卡对应提交撤销；不得顺带改变 Dashboard 数据口径。

## S1｜项目骨架与配置

- 范围：Bot 目录、配置 Schema、统一错误、专用脚本。
- 验收：无真实 Secret 默认值；非法 URL、TTL、预算与轮询配置 fail closed；既有 dashboard 启动脚本不变。
- 验证：config/error 单测、类型检查、全量回归。
- 回滚：删除 Bot 骨架与专用 scripts，不影响 src/server.ts。

## S2｜Ledger meta 合同

- 范围：只读 GET /api/meta、整数合同主版本、平台能力表。
- 验收：无副作用，不触发 refresh；字段和既有 API 回归均有测试。
- 验证：HTTP 合同测试。
- 回滚：移除 meta route/method，不改已有响应。

## S3｜GET-only Ledger 客户端

- 范围：固定 base URL、endpoint 允许清单、运行时 Schema、版本门、超时、一次重试、拒绝重定向、请求合并与 15 秒内缓存。
- 验收：无法构造任意 URL 或 POST；错误不缓存；并发相同请求只发一次。
- 验证：fixture server 的允许/拒绝/超时/重试/重定向/缓存测试。
- 回滚：Bot 回到静态 help，不影响 Ledger。

## S4｜输入与 QueryPlan

- 范围：长度、mention、规范化、命令、自然语言确定性规则、QueryPlan Schema、越界识别。
- 验收：明确命令不进 LLM；URL、SQL、shell、工具字段与未知字段被拒绝；歧义只问一个澄清问题。
- 验证：command-parser 与 query-plan 测试。
- 回滚：保留静态 help，其余输入返回 unsupported。

## S5｜排名领域逻辑

- 范围：live/all 过滤、null/0、确定性排序、Top 5、quality、suite-wide 隔离、no-data。
- 验收：同一 fixture 任意输入顺序产生同一榜单；0 可排名，null 不参加。
- 验证：rank 单测与快照。
- 回滚：关闭 rank action。

## S6｜平台查询与解释

- 范围：overview 指定窗口与 detail 合并、rolling24h 分栏、平台/指标/质量/coverage/source 固定解释。
- 验收：64 日 detail coverage 不冒充请求窗口；解释只使用 Ledger 证据。
- 验证：platform 与 explain 单测。
- 回滚：关闭 platform/why action。

## S7｜状态与短期上下文

- 范围：status 编排、信息净化、内存上下文、15 分钟 TTL、最多 3 个 QueryPlan、私聊/群聊隔离。
- 验收：过期或跨会话不补猜；状态不输出内部 URL、路径或异常。
- 验证：时钟推进与容量测试。
- 回滚：禁用上下文，所有省略请求要求澄清。

## S8｜确定性文本格式化

- 范围：数字、日期、人话标签、警告顺序、五类回答、HTTPS detailUrl、1500 目标/5000 硬上限与语义分段。
- 验收：null 与 0 不混淆；链接只能来自配置；任何段不超 5000 字符。
- 验证：formatter 单测与 Dialogue Lab 快照。
- 回滚：使用最小纯文本模板。

## S9｜供应商无关 LLM stub

- 范围：最小输入、结构化输出、Schema gate、超时/预算/降级；本阶段仅 stub。
- 验收：LLM 不接触 Ledger 数值、原始 DeBox 对象或 Secret；失败回到命令/澄清路径。
- 验证：stub 成功、幻觉字段、超时和预算测试。
- 回滚：关闭 LLM 开关，核心命令继续可用。

## S10｜Fake DeBox adapter 与轮询

- 范围：最小事件模型、私聊/明确 mention、Long Polling fake、幂等、发送分段、重试和认证熔断。
- 验收：非 mention 群消息和变体消息不处理；重复 update 不重复回复。
- 验证：replay 与 fault-injection 测试。
- 回滚：停止 fake poller，不影响领域和 Ledger。

## S11｜隐私、遥测与健康

- 范围：日志 allowlist、诱饵脱敏、纯聚合计数、保留清理、localhost health/readiness。
- 验收：不落原文、稳定 ID、钱包、URL query、Secret；readiness 分层报告但不泄密。
- 验证：隐私扫描、遥测与 health 测试。
- 回滚：关闭遥测和 health，不影响核心查询。

## S12｜端到端 fixture 验收

- 范围：fake update 到分段回复的 UC-01 至 UC-12、故障矩阵、并发、全量回归和本地验收报告。
- 验收：AC-01 至 AC-14 有自动化证据；无网络请求到真实 DeBox/模型/生产。
- 验证：integration、replay、npm run verify 和 docs/evidence/local-acceptance.md。
- 回滚：整体关闭 Bot 入口，Dashboard 完整保留。
