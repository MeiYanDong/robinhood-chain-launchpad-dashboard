# RHC Launch Ledger DeBox Bot｜分阶段执行清单

> 依据：docs/plan.md v1.0 与 docs/debox-bot-prd-v0.1.md  
> 当前状态：需求拆解完成，尚未获得“开始写业务代码”授权  
> 最近更新：2026-08-30  
> 范围：RHC Launch Ledger 的 DeBox 查询 Bot；先做只读、按需查询、封闭试用，再决定公开发布与 Grant

## 0. 使用规则

- [x] **BASE-001｜确认需求来源文件存在。**
  - 产物：docs/debox-bot-prd-v0.1.md、docs/plan.md。
  - 完成证据：两个文件均已读取；todo 只从已确认需求拆解，不以旧聊天印象代替项目文档。

- [x] **BASE-002｜确认六项产品基线已经写入 plan.md。**
  - 已确认：MVP 只做按需查询；Ledger 是唯一数据真相源；封闭试用采用私聊和群内明确 @Bot 的普通文本；AI 只解析 QueryPlan；只保存聚合遥测；先拿真实试用证据，再决定公开与 Grant。
  - 完成证据：plan.md 中 D-01 至 D-06。

- [x] **BASE-003｜创建本执行清单。**
  - 产物：docs/todo.md。
  - 完成证据：本文档包含阶段、依赖、产物、验收证据、停止门和需求追踪关系。

- [x] **BASE-004｜每次开始工作前，先确认当前所在阶段和它的前置停止门。**
  - 规则：未通过上一阶段退出条件，不进入下一阶段。
  - 规则：一个任务只有在产物存在、测试通过且证据可回查后才能勾选；“写过代码”“本地看起来能跑”不算完成。
  - 本次证据：2026-08-30 从“工程质量基线”开始；GATE-01 已通过，GATE-02 至 GATE-12 仍关闭；未触发真实 DeBox、密钥、部署、权限或 Grant 外部操作。

- [ ] **BASE-005｜每次结束工作时更新本文档。**
  - 更新内容：勾选真实完成项；在任务下补充证据路径、命令结果或运行回执；记录阻塞原因；不提前勾选外部操作。

- [ ] **BASE-006｜保持 MVP 硬边界。**
  - 禁止：交易、签名、钱包连接、自动执行、主动推送、被动监听全部群消息、重复采集链上数据、直接读取 Ledger SQLite、调用 POST /api/refresh。
  - 禁止：保存原始消息、DeBox 用户 ID、群 ID、稳定哈希 ID，或宣称无法真实测量的留存/复访数据。
  - 完成证据：架构检查、静态测试和集成测试均没有上述路径。

### 状态约定

- 状态符号：空框表示尚未完成；勾选框表示已有证据证明完成。
- 带 **GATE** 的项目是停止门，只能在得到用户明确授权并记录授权内容后勾选。
- 带 **条件项** 的项目不能因为“以后可能需要”而提前实施。
- 涉及账号、不可删除 Bot、密钥、付费模型、生产部署、权限申请、对外提交的任务，不得用默认值代替用户决策。

## 1. 全局停止门登记

- [x] **GATE-01｜用户明确授权开始编写业务代码。**
  - 影响：是否允许修改 src、test、package.json 等实现文件。
  - 未通过时：只允许完善文档、对话样例、Schema、fixture 设计和验收矩阵。
  - 证据：用户于 2026-08-30 确认公开 Public 项目并要求按计划依次执行；授权覆盖本地质量基线、Phase 0 和 Phase 1，不包含真实 Bot、Secret、服务器、权限或 Grant。

- [ ] **GATE-02｜用户批准安装并锁定第三方 SDK 或模型依赖。**
  - 影响：供应链、包体积、兼容性、后续升级成本。
  - 未通过时：只使用本地接口、假适配器和 stub，不安装 DeBox SDK 或真实模型 SDK。
  - 证据：批准的包名、版本或 commit、许可证和安全审查记录。

- [ ] **GATE-03｜用户确认专用 DeBox 项目账号。**
  - 影响：Bot 归属、五个 Bot 配额、后续运营和权限。
  - 未通过时：不得创建真实 Bot。
  - 证据：只记录账号归属与负责人，不在仓库记录登录凭证。

- [ ] **GATE-04｜用户确认 Bot 名称、头像、简介和支持入口。**
  - 影响：不可逆资源占用、公开品牌、一致性。
  - 未通过时：不得创建真实 Bot 或提交审核。
  - 证据：docs/decisions/debox-bot-identity.md。

- [ ] **GATE-05｜用户明确授权创建不可删除的 DeBox Bot。**
  - 影响：永久占用账号 Bot 配额，属于不可逆外部写入。
  - 未通过时：不得点击创建、调用创建接口或生成真实 App Key/Secret。
  - 证据：授权记录、创建时间、Bot 显示名；Secret 不进入证据文件。

- [ ] **GATE-06｜用户确认真实 AI 模型供应商、预算上限和停机策略。**
  - 影响：成本、隐私、稳定性和供应商绑定。
  - 可选结果：关闭真实 LLM 仅用确定性解析；启用指定供应商并设置日预算；自托管模型。
  - 证据：docs/decisions/llm-provider-and-budget.md。

- [ ] **GATE-07｜用户授权配置真实 App Key、App Secret 和模型密钥。**
  - 影响：访问权限和泄露风险。
  - 未通过时：不得把真实凭证写入本机服务、服务器或 CI。
  - 证据：仅记录“已在指定 Secret 管理位置配置”和轮换负责人，绝不抄录密钥值。

- [ ] **GATE-08｜用户授权部署独立 Bot 服务到生产或试用服务器。**
  - 影响：服务器状态、持续费用、线上可用性和回滚责任。
  - 未通过时：只运行本地 fake/stub 测试。
  - 证据：目标主机、服务名、版本、部署窗口、回滚点。

- [ ] **GATE-09｜用户批准新增域名、TLS、Nginx 或防火墙配置。**
  - 影响：公开攻击面、基础设施和持续维护。
  - 默认：Long Polling MVP 不开放公网入口，因此本门默认不需要通过。
  - 证据：只在决定迁移 Webhook 或公开网页时记录。

- [ ] **GATE-10｜用户批准申请 DeBox 高级权限。**
  - 影响：群消息监听、主动推送、订阅、图片能力及平台审核。
  - 默认：MVP 不申请“监听群消息”，不读取群内非 @ 普通消息和群内变体消息。
  - 证据：权限清单、用途、数据边界、审核状态。

- [ ] **GATE-11｜用户批准向 DeBox 审核群发送使用说明和证明文件。**
  - 影响：对外披露、发布流程和审核承诺。
  - 未通过时：只在封闭试用中使用。
  - 证据：最终文件快照、发送时间和审核回执。

- [ ] **GATE-12｜用户批准提交 Grant 或公开发布申请。**
  - 影响：公开承诺、项目叙事、数据披露和不可撤回的外部提交。
  - 未通过时：只准备草稿，不发送表单、PR、消息或申请。
  - 证据：最终提交副本、时间、渠道和回执。

---

# 工程质量基线｜进入阶段 0 前完成

- [x] **QUALITY-001｜完成修改前代码库审查与基线取证。**
  - 产物：docs/evidence/pre-implementation-baseline.md。
  - 证据：Git/远端、测试、类型检查、覆盖率、CI/CD、文档和高风险边界均已逐项核对。

- [x] **QUALITY-002｜确认仓库公开可见性与 Secret 边界。**
  - 产物：docs/decisions/repository-visibility.md。
  - 决策：创建公开仓库 MeiYanDong/robinhood-chain-launchpad-dashboard。

- [x] **QUALITY-003｜完成公开仓库文件与 Secret/隐私扫描。**
  - 范围：源码、文档、deploy、测试、package lock 和拟提交文件。
  - 完成证据：docs/evidence/pre-implementation-baseline.md；发布源集合中未发现候选凭证，运行数据库、浏览器会话、输出、构建和日志均已加入 ignore。

- [x] **QUALITY-004｜初始化本地 Git 并创建清晰的初始提交。**
  - 完成证据：main；cac44170b6fce3ab8b086e0107e2935c632ef0f6；chore: establish launch ledger baseline；提交后 clean。

- [x] **QUALITY-005｜创建公开 GitHub 仓库并推送初始历史。**
  - 完成证据：https://github.com/MeiYanDong/robinhood-chain-launchpad-dashboard；visibility=PUBLIC；default branch=main；远端 SHA=cac44170b6fce3ab8b086e0107e2935c632ef0f6。

- [x] **QUALITY-006｜建立统一 lint 与格式化工具。**
  - 默认：Biome；不并行引入 ESLint 与 Prettier。
  - 完成证据：@biomejs/biome 2.5.11 已精确锁定；npm run format:check 与 npm run lint 均退出 0；范围覆盖 TypeScript、测试、public/app.js 与 JSON 配置。

- [x] **QUALITY-007｜建立源码与测试类型检查、全源码覆盖率和统一 verify 命令。**
  - 完成证据：typecheck、test:coverage、build、verify 全部通过。
  - 完成证据：`npm run verify` 退出 0；31/31 测试通过；全源码 statements/lines 70.43%、branches 73.84%、functions 77.11%，且门槛已写入 `test:coverage`。

- [x] **QUALITY-008｜建立 GitHub Actions CI。**
  - 要求：Node 22、npm ci、格式、lint、类型、覆盖率、测试、build。
  - 完成证据：workflow 文件、Actions 成功 run；未成功运行前只能标 defined。
  - 完成证据：.github/workflows/ci.yml；Actions run 33318710005 成功；checkout v7.0.1 与 setup-node v7.0.0 按完整 commit SHA 锁定；main 强制要求 `verify`、管理员同样受约束，并禁用 force-push/删除。

- [x] **QUALITY-009｜补齐 HTTP、DashboardService 与 SQLite 关键路径测试。**
  - 覆盖：API、静态文件安全、refresh 合并、stale/partial/no-cache、事务和错误边界。
  - 完成证据：test/http-app.test.ts、test/dashboard-service.test.ts、test/database.test.ts；`npm test` 31/31 通过；关键模块语句覆盖率分别为 HTTP 95.38%、DashboardService 88.32%、SQLite 97.64%。

- [x] **QUALITY-010｜修复原始异常向客户端泄露并锁定测试。**
  - 完成证据：用户只看到稳定错误码/安全文案，内部日志保留脱敏分类。
  - 完成证据：src/http/app.ts 返回 `INTERNAL_ERROR`；DashboardService 对 run/source/warning 脱敏；测试用私有 URL、凭证样式 marker 断言响应和公开状态均不含原文。

- [x] **QUALITY-011｜建立与现有 systemd 发布方式匹配的只读运行验证。**
  - 完成证据：本地可测试脚本与 runbook；生产执行仍受 GATE-08 控制。
  - 完成证据：src/ops/runtime-verifier.ts、scripts/verify-runtime.ts、test/runtime-verifier.test.ts、docs/runbooks/runtime-verification.md；只发 3 个固定 GET，34/34 全量测试通过；未在生产执行。

- [x] **QUALITY-012｜补齐 ADR、CHANGELOG 与 Phase 1 小型故事卡。**
  - 完成证据：重要决策、变更记录、每张故事卡的范围/验收/命令/回滚齐全。
  - 完成证据：docs/adr/0001-public-repository-and-secret-boundary.md、docs/adr/0002-read-only-bot-boundary.md、CHANGELOG.md、docs/stories/phase-1.md。

- [x] **QUALITY-EXIT-01｜确认质量基线全部通过后再进入阶段 0。**
  - 完成证据：QUALITY-001 至 QUALITY-012 全部有本地或远端回执；后续改动使用 feat/debox-bot-local-prototype 分支并经 PR 门禁合并。

---

# 阶段 0｜需求冻结与 Dialogue Lab

目标：不写业务代码，先把语言、数据合同、回答样式、验收方法和外部停止门变成可执行规格。

## 0.1 文档与术语冻结

- [x] **P0-001｜创建需求追踪矩阵。**
  - 依赖：BASE-001。
  - 执行：把 FR-001 至 FR-018、NFR-001 至 NFR-007、AC-01 至 AC-15 映射到本文具体任务与测试。
  - 产物：docs/requirements-traceability.md。
  - 完成证据：不存在“有需求、无实现任务、无测试任务”的孤立条目。

- [x] **P0-002｜建立唯一术语表。**
  - 执行：定义 Ledger、targetDate、requested window、rolling24h、quality、coverage、source health、suite-wide、live、all、stale、partial、unknown。
  - 产物：docs/bot-glossary.md。
  - 完成证据：命令文案、QueryPlan、类型名、测试 fixture 使用相同含义。

- [x] **P0-003｜冻结协议收入字段命名。**
  - 规则：内部唯一字段名为 protocol_revenue_usd；income 只作为用户输入别名；禁止新增 protocol_income_usd。
  - 产物：术语表、QueryPlan Schema 和 fixture 字段说明。
  - 完成证据：全文检索不存在新建的 protocol_income_usd 实现或测试。
  - 关联：FR-005、FR-006、AC-03。

- [x] **P0-004｜冻结“1d”和“24h”的区别。**
  - 规则：1d 是 Ledger 的日窗口；rolling24h 是独立口径，不能冒充 1d。
  - 产物：docs/bot-glossary.md 中的例子和用户提示词。
  - 完成证据：至少包含“今天数据”和“过去 24 小时”两个反例。
  - 关联：FR-006、AC-05。

- [x] **P0-005｜冻结 unknown 原因枚举。**
  - 枚举：NO_OBSERVATION、SOURCE_NOT_REPORTING、SOURCE_FAILED、STALE_WITHOUT_CURRENT_VALUE、SCOPE_NOT_COMPARABLE、VERSION_NOT_AVAILABLE、PLATFORM_NOT_SUPPORTED、CONTRACT_INCOMPATIBLE。
  - 产物：docs/contracts/bot-answer.md。
  - 完成证据：每个枚举都有用户可理解的中文解释和禁止误写为 0 的例子。
  - 关联：FR-005、FR-006、FR-008、AC-04、AC-09。

- [x] **P0-006｜冻结回答状态枚举与警告优先级。**
  - 状态：ok、clarification、degraded、unavailable、unsupported。
  - 警告顺序：无可用数据 → API 合同不兼容 → 最近刷新失败且使用旧缓存 → stale → 单来源 failed/degraded → partial/scope_mismatch/suite_wide → derived → 普通提示。
  - 产物：docs/contracts/bot-answer.md。
  - 完成证据：同一回答出现多种问题时有唯一、可测试的排列规则。
  - 关联：FR-013、FR-015。

- [x] **P0-007｜建立“不能说什么”清单。**
  - 内容：不能把 null 说成 0；不能把旧数据说成当前；不能把 range 总量排成 platform 榜；不能把 64 天详情覆盖冒充请求窗口；不能声称测得真实留存；不能给交易指令。
  - 产物：docs/bot-response-guardrails.md。
  - 完成证据：每条禁令至少映射一个自动化测试。

## 0.2 QueryPlan 与回答合同设计

- [x] **P0-008｜写出 QueryPlan v1 的 JSON Schema 草案。**
  - 字段：version、action、windowDays、metric、platformId、scope、explainTopic、language、needsClarification、clarificationReason。
  - 约束：拒绝 URL、HTTP method、SQL、shell、文件路径和任意工具名字段。
  - 产物：docs/contracts/query-plan.schema.json。
  - 完成证据：合法样例、缺字段样例、未知字段样例、注入样例均有预期结果。
  - 关联：FR-009、AC-08、AC-10。

- [x] **P0-009｜写出 BotAnswer v1 合同。**
  - 字段：status、title、bodyLines[]、warnings[]、suggestedCommands[]、detailUrl、evidence。
  - evidence 字段：targetDate、generatedAt、runStatus、stale。
  - 约束：detailUrl 只能来自配置允许的 HTTPS 基地址；body 不包含内部异常或密钥。
  - 产物：docs/contracts/bot-answer.md。
  - 完成证据：rank、platform、why、status、no_data 各有一个完整样例。
  - 关联：FR-013、FR-014、AC-12。

- [x] **P0-010｜写出 BotMetricView 合同。**
  - 字段：metric、value、observedDays、windowDays、coverage、latestDate、sources[]、qualities[]、scope、comparability、excludeFromTotals。
  - 产物：docs/contracts/bot-metric-view.md。
  - 完成证据：字段来源能追溯到 /api/overview、/api/platforms/:id、/api/coverage、/api/sources 或计划中的 /api/meta。

- [x] **P0-011｜写出 Ledger Contract v1 草案。**
  - 内容：固定允许的 GET endpoint、query 参数、contract version、超时、重试、缓存、错误映射。
  - 禁止：POST /api/refresh、任意 URL、重定向、直接数据库访问。
  - 产物：docs/contracts/ledger-bot-contract-v1.md。
  - 完成证据：允许清单和拒绝清单都可直接转成测试。
  - 关联：FR-011、FR-012、AC-10。

- [x] **P0-012｜设计 /api/meta 响应。**
  - 字段：service、appVersion、apiContractVersion、targetDate、supportedWindows、coreMetrics、platforms。
  - platforms 子字段：id、status、supportedMetrics、hasRollingStats。
  - 决策：apiContractVersion 使用整数主版本，Bot 只接受明确兼容版本。
  - 产物：docs/contracts/ledger-meta-v1.example.json。
  - 完成证据：兼容、不兼容、缺字段三个样例齐全。
  - 关联：FR-012、AC-13。

## 0.3 Ledger fixture 目录设计

- [x] **P0-013｜建立 endpoint fixture 清单。**
  - 范围：healthz、overview 1/7/30、platform detail、coverage、sources、meta。
  - 产物：test/fixtures/ledger/README.md 或等价设计稿；此阶段不要求实现代码。
  - 完成证据：每个 Bot 用例知道需要哪些响应组合。

- [x] **P0-014｜准备正常数据 fixture 规格。**
  - 覆盖：多个平台、volume、fees、protocol_revenue_usd、0 值、不同 targetDate、quality 和 coverage。
  - 完成证据：能计算默认 Top 5、7d fees 榜和单平台 30d 查询的唯一预期答案。

- [x] **P0-015｜准备 null 与不可比较 fixture 规格。**
  - 覆盖：null、NO_OBSERVATION、SOURCE_NOT_REPORTING、SCOPE_NOT_COMPARABLE、suite-wide 数值。
  - 完成证据：预期答案明确区分“0”“未知”“全平台口径，不参与单平台排名”。

- [x] **P0-016｜准备 stale 与 partial fixture 规格。**
  - 覆盖：targetDate 落后、部分来源失败、数据存在但质量下降、当前值不存在只有旧值。
  - 完成证据：每个样例定义回答状态、警告文案和是否允许展示数值。

- [x] **P0-017｜准备版本不兼容和 Schema 漂移 fixture 规格。**
  - 覆盖：apiContractVersion 不受支持、字段缺失、字段类型错误、未知额外字段。
  - 完成证据：明确哪些情况 fail closed，哪些情况可忽略额外字段。

- [x] **P0-018｜准备滚动 24 小时与日窗口冲突 fixture 规格。**
  - 完成证据：用户说“24h”时不会静默返回 1d；只能澄清或展示被明确标注的 rolling24h。
  - 关联：AC-05。

## 0.4 Dialogue Lab

- [x] **P0-019｜为 L-01 排行榜回答制作三种文本方案。**
  - 变量：标题、窗口、指标、Top 5 行格式、质量标签、targetDate、推荐命令。
  - 产物：docs/dialogue-lab/L-01-rank.md。
  - 完成证据：三案都不超过目标 1500 字符，并且同一 fixture 数字完全一致。

- [x] **P0-020｜记录并确认 L-01 最终方案。**
  - 记录：选中方案、选择理由、吸收的其他方案元素、拒绝的反模式、对 formatter 的约束。
  - 依赖：P0-019、用户选择。
  - 完成证据：文档中有 confirmed_decision 标记。

- [x] **P0-021｜为 L-02 单平台回答制作三种文本方案。**
  - 变量：核心三指标、收入按需展示、质量/覆盖、requested window 与 rolling24h 的区分、详情链接。
  - 产物：docs/dialogue-lab/L-02-platform.md。

- [x] **P0-022｜记录并确认 L-02 最终方案。**
  - 依赖：P0-021、用户选择。
  - 完成证据：文档中有 confirmed_decision 标记和 formatter 规则。

- [x] **P0-023｜为 L-03 unknown/no-data 回答制作三种文本方案。**
  - 变量：未知原因、人话解释、是否给旧值、下一步建议。
  - 产物：docs/dialogue-lab/L-03-unknown.md。

- [x] **P0-024｜记录并确认 L-03 最终方案。**
  - 依赖：P0-023、用户选择。
  - 完成证据：0、null、无当前值三类不会混淆。

- [x] **P0-025｜为 L-04 stale/partial 回答制作三种文本方案。**
  - 变量：警告位置、targetDate、失败来源摘要、是否保留可用数值。
  - 产物：docs/dialogue-lab/L-04-stale.md。

- [x] **P0-026｜记录并确认 L-04 最终方案。**
  - 依赖：P0-025、用户选择。
  - 完成证据：警告优先级和 formatter 规则被固定。

- [x] **P0-027｜为 L-05 /start 与 /help 制作三种文本方案。**
  - 变量：Bot 定位、四类命令、自然语言例子、不能交易的边界、数据时效提示。
  - 产物：docs/dialogue-lab/L-05-help.md。

- [x] **P0-028｜记录并确认 L-05 最终方案。**
  - 依赖：P0-027、用户选择。
  - 完成证据：静态文案无需 Ledger 或 LLM，长度不超过 1500 字符。

- [x] **P0-029｜为 L-06 越界请求制作三种拒绝方案。**
  - 场景：买卖建议、签名/交易、访问任意 URL、提示词注入、索取内部配置。
  - 产物：docs/dialogue-lab/L-06-out-of-scope.md。

- [x] **P0-030｜记录 L-06 推荐方案；如不影响核心实现可按推荐方案继续。**
  - 完成证据：拒绝简短、说明能力边界、提供可执行的只读查询替代。

## 0.5 阶段 0 验收

- [x] **P0-031｜完成命令语法表。**
  - 命令：/start、/help、/rank、/platform、/why、/status。
  - 内容：参数、默认值、别名、非法输入、歧义提示和示例。
  - 产物：docs/contracts/commands-v1.md。

- [x] **P0-032｜完成十二个用例的输入—处理—输出规格。**
  - 范围：UC-01 至 UC-12。
  - 产物：docs/use-cases.md。
  - 完成证据：每个用例映射到至少一个 fixture 和一个验收测试。

- [x] **P0-033｜完成安全威胁清单。**
  - 范围：提示词注入、SSRF、refresh 放大、密钥泄露、重复更新、幻觉、旧数据、null、错误排名、隐私日志、SDK 供应链、模型成本。
  - 产物：docs/threat-model.md。
  - 完成证据：每项有预防、检测、失败方式和测试编号。

- [x] **P0-034｜完成阶段 0 需求评审。**
  - 参与：用户与实现者。
  - 核对：范围、术语、QueryPlan、回答合同、Dialogue Lab、验收矩阵、外部停止门。
  - 完成证据：docs/decisions/requirements-signoff.md。

- [x] **P0-EXIT-01｜确认 L-01 至 L-05 已有最终方案。**
- [x] **P0-EXIT-02｜确认 FR、NFR、AC 均已映射到任务与测试。**
- [x] **P0-EXIT-03｜确认所有未决外部动作仍停在对应 GATE 前。**
- [x] **P0-EXIT-04｜通过 GATE-01 后再进入阶段 1。**

阶段 0 验证证据：合同 JSON 均可解析；L-01 至 L-05 共 5 个 `confirmed_decision: A`；追踪矩阵唯一计数为 FR 18、NFR 7、AC 15；GATE-02 至 GATE-12 保持未通过。

---

# 阶段 1｜本地无凭证原型

目标：只使用 fixture、fake DeBox 和 stub LLM，实现完整只读链路；不得连接真实 DeBox、不得配置真实密钥、不得部署生产。

前置：P0-EXIT-01 至 P0-EXIT-04；其中 GATE-01 必须已经有书面授权。

## 1.1 开发基线与目录

- [ ] **P1-001｜记录改动前工作区基线。**
  - 执行：记录 Node/npm 版本、package.json scripts、现有测试结果、关键文件清单和已有未提交/未归档改动。
  - 注意：当前目录不是 Git 仓库时，使用可回查的文件清单与备份点，不伪造 commit 证据。
  - 产物：docs/evidence/pre-implementation-baseline.md。

- [ ] **P1-002｜运行现有测试并保存原始结果。**
  - 完成标准：现有测试全部通过；若失败，先记录为基线问题，未经授权不顺手修改无关代码。
  - 证据：命令、退出码、测试数量、失败详情。

- [ ] **P1-003｜确认运行时兼容 Node 22.5+。**
  - 执行：核对 TypeScript、测试框架、Node SQLite 和模块系统。
  - 完成证据：本机版本与 CI/部署目标写入运行说明。

- [ ] **P1-004｜建立 Bot 目录骨架。**
  - 目录：src/bot/debox、intent、ledger、domain、format、privacy、telemetry、health。
  - 约束：只创建模块边界和必要入口，不复制现有 Ledger 采集逻辑。

- [ ] **P1-005｜建立 Bot 测试目录。**
  - 目录：test/bot 与 test/fixtures/ledger、test/fixtures/debox。
  - 完成证据：测试发现规则能识别新目录，但不破坏现有测试。

- [ ] **P1-006｜定义 Bot 配置 Schema。**
  - 范围：Ledger base URL、允许的详情 HTTPS 基地址、轮询 timeout、缓存 TTL、上下文 TTL、遥测保留天数、LLM 开关和预算参数。
  - 约束：无默认真实 Secret；配置错误时 fail closed。
  - 产物：src/bot/config.ts 及配置测试。

- [ ] **P1-007｜定义统一错误类型。**
  - 类型：配置错误、合同不兼容、Ledger 超时/不可用、DeBox 认证/限流、QueryPlan 无效、发送失败、用户输入错误。
  - 完成证据：每类错误都有内部分类和不泄露细节的用户态映射。

- [ ] **P1-008｜增加 Bot 专用 package scripts。**
  - 目标：类型检查、Bot 单测、Bot 集成测试、fixture replay、本地 fake 启动。
  - 约束：不更改现有 dashboard 默认启动行为。

## 1.2 Ledger /api/meta 与合同

- [ ] **P1-009｜实现 GET /api/meta。**
  - 返回：service、appVersion、apiContractVersion、targetDate、supportedWindows、coreMetrics、platforms。
  - 约束：只读、无副作用、不得触发 refresh。
  - 关联：FR-012。

- [ ] **P1-010｜为 /api/meta 增加稳定合同测试。**
  - 覆盖：字段存在、类型正确、apiContractVersion 为整数主版本、窗口只有支持值、coreMetrics 使用 protocol_revenue_usd。

- [ ] **P1-011｜验证新增 /api/meta 不改变既有 API。**
  - 范围：/healthz、/api/overview、/api/platforms/:id、/api/coverage、/api/sources、/api/refresh。
  - 完成证据：现有测试无回归；Bot 仍无权调用 refresh。

- [ ] **P1-012｜实现 Ledger 合同 TypeScript 类型。**
  - 文件：src/bot/ledger/contract.ts。
  - 完成证据：类型覆盖 meta、overview、platform、coverage、sources 和 BotMetricView。

- [ ] **P1-013｜实现 Ledger 响应运行时校验。**
  - 规则：任何外部 JSON 在进入领域层前先校验；缺少关键字段或类型错误时不继续计算。
  - 完成证据：错误 fixture 均返回 CONTRACT_INCOMPATIBLE 或 VERSION_NOT_AVAILABLE。

- [ ] **P1-014｜实现合同版本兼容检查。**
  - 行为：不兼容时只允许 /help 与受限 /status；禁止 rank/platform/why 返回看似正常的数据。
  - 关联：FR-012、AC-13。

- [ ] **P1-015｜固化 Ledger endpoint 允许清单。**
  - 允许：GET /healthz、/api/meta、/api/overview、/api/platforms/:id、/api/coverage、/api/sources。
  - 禁止：POST、/api/refresh、任意绝对 URL、重定向后的新主机。
  - 完成证据：负向测试覆盖所有禁止项。

- [ ] **P1-016｜实现固定 base URL 与路径构造。**
  - 规则：调用者只能传受控参数，不能传完整 URL。
  - 安全目标：消除 SSRF 和路径穿越。

- [ ] **P1-017｜实现 Ledger 请求超时。**
  - 默认：3 秒。
  - 行为：超时映射为暂时不可用，不把堆栈或内部 URL发给用户。

- [ ] **P1-018｜实现有限重试。**
  - 规则：连接失败或 5xx 最多重试一次；4xx、Schema 错误和版本不兼容不重试。
  - 完成证据：fake server 记录的请求次数符合规则。

- [ ] **P1-019｜禁止 HTTP 重定向跨越允许边界。**
  - 行为：关闭自动跟随，或对每次跳转重新做同源校验并默认拒绝。
  - 完成证据：302 到外部主机测试被拒绝。

- [ ] **P1-020｜实现请求合并。**
  - 行为：同一进程内同时请求同一 endpoint 与参数时，共享一个进行中的 Promise。
  - 完成证据：并发测试中 Ledger 只收到一次请求。

- [ ] **P1-021｜实现最多 15 秒的短缓存。**
  - 规则：缓存键包含 endpoint 与全部受控参数；不得越过 targetDate/apiContractVersion 边界；必须原样继承 stale/warnings；错误响应不长期缓存。
  - 完成证据：缓存命中测试和过期测试通过。

- [ ] **P1-022｜实现 Ledger 客户端。**
  - 文件：src/bot/ledger/client.ts。
  - 完成证据：只能通过合同允许的方法读取 fixture server，且能返回经过校验的对象。

- [ ] **P1-023｜把 Ledger 响应转换为 BotMetricView。**
  - 规则：保留 null、0、quality、coverage、source health、targetDate 和 scope；不在转换时“补猜”数据。

- [ ] **P1-024｜实现 overview 与 platform detail 的正确合并。**
  - 规则：overview 提供请求窗口指标；detail 只补平台元数据和适用的附加统计。
  - 禁止：把 detail 的 64 天 coverage 当作请求的 1/7/30 天窗口。
  - 关联：FR-006、AC-03。

- [ ] **P1-025｜实现 suite-wide 值隔离。**
  - 行为：全平台口径可单独展示，但不进入单平台排名和单平台核心指标。
  - 关联：AC-06。

- [ ] **P1-026｜完成 Ledger 合同 fixture。**
  - 范围：P0-013 至 P0-018 设计的正常、0、null、partial、stale、no-data、rolling24h、suite-wide、版本错误和 Schema 错误。

- [ ] **P1-027｜完成 Ledger 合同测试。**
  - 文件：test/bot/ledger-contract.test.ts。
  - 完成标准：所有允许、拒绝、超时、重试、重定向、缓存、合并和版本路径有断言。

## 1.3 输入清洗、命令解析与 QueryPlan

- [ ] **P1-028｜实现输入长度上限。**
  - 规则：清洗后最多处理 1000 字符；超长内容返回简短错误，不送入 LLM。

- [ ] **P1-029｜实现 @Bot mention 清理。**
  - 行为：只移除事件确认属于当前 Bot 的 mention；不做模糊替换，不吞掉平台名。

- [ ] **P1-030｜实现文本规范化。**
  - 范围：首尾空格、连续空白、大小写、全角/半角命令分隔符、中文数字窗口常见写法。
  - 约束：不访问输入中的 URL、附件、卡片或合约地址。

- [ ] **P1-031｜建立平台别名表。**
  - 文件：src/bot/intent/aliases.ts。
  - 完成证据：每个当前支持平台有 canonical id、显示名和不冲突别名。

- [ ] **P1-032｜处理平台别名歧义。**
  - 行为：多个平台匹配时返回候选并要求澄清，不静默选择。

- [ ] **P1-033｜实现 /start 解析。**
  - 行为：返回静态帮助，不访问 Ledger，不调用 LLM。

- [ ] **P1-034｜实现 /help 解析。**
  - 行为：返回静态帮助，不访问 Ledger，不调用 LLM。

- [ ] **P1-035｜实现 /rank 命令语法。**
  - 参数：[1d|7d|30d] [volume|fees|income] [live|all]。
  - 默认：1d、volume、live。
  - 映射：income → protocol_revenue_usd。

- [ ] **P1-036｜实现 /rank 非法参数反馈。**
  - 行为：指出具体错误并给最接近的合法示例；不得用错误参数查询。

- [ ] **P1-037｜实现 /platform 命令语法。**
  - 参数：平台名或别名、可选 1d/7d/30d；缺平台名时要求补充。

- [ ] **P1-038｜实现 /why 命令语法。**
  - 范围：指标口径、指定平台、数据质量、coverage 和 source health。

- [ ] **P1-039｜实现 /status 命令语法。**
  - 行为：不接受任意 URL、主机名或内部诊断参数。

- [ ] **P1-040｜定义命令优先的解析管线。**
  - 顺序：明确命令 → 本地确定性自然语言规则 → 可选 LLM → 澄清或拒绝。
  - 完成证据：明确命令永远不会进入 LLM。

- [ ] **P1-041｜实现确定性自然语言规则。**
  - 覆盖：排行榜、平台查询、解释、状态、1/7/30 天、volume/fees/income 常见中英文说法。
  - 行为：只有唯一可解释时才生成 QueryPlan。

- [ ] **P1-042｜实现 QueryPlan v1 类型。**
  - 文件：src/bot/intent/query-plan.ts。
  - 完成证据：字段与 P0-008 Schema 一致。

- [ ] **P1-043｜实现 QueryPlan 运行时验证。**
  - 规则：拒绝未知字段、未知 action、非法窗口、非法 metric、任意 URL/SQL/shell/tool 指令。
  - 业务约束：rank 只允许 volume_usd、fees_usd、protocol_revenue_usd；revenue_usd 只允许 explain 或用户明确点名 Revenue 的单平台查询；status/help 不得携带平台和指标。

- [ ] **P1-044｜实现 needsClarification 分支。**
  - 行为：缺少关键参数或存在多义时给一个具体问题；不猜平台、口径或窗口。

- [ ] **P1-045｜实现越界请求识别。**
  - 场景：交易、签名、钱包连接、价格承诺、主动监控、任意网站访问、密钥/系统提示索取。
  - 行为：拒绝并建议可用的只读查询。

- [ ] **P1-046｜完成命令解析单元测试。**
  - 文件：test/bot/command-parser.test.ts。
  - 覆盖：全部命令、默认值、别名、非法输入、中文空格、超长输入、mention。

- [ ] **P1-047｜完成 QueryPlan Schema 测试。**
  - 文件：test/bot/query-plan.test.ts。
  - 覆盖：合法、缺字段、未知字段、注入、URL、SQL、shell、非法 metric 和非法窗口。

## 1.4 领域查询逻辑

- [ ] **P1-048｜实现 rank 数据候选过滤。**
  - 默认 live：只包含当前 live、未 excluded、目标指标非 null 且口径可比较的平台。
  - all：按规格包含允许展示的非 live 项，同时保留状态标签。

- [ ] **P1-049｜实现 0 与 null 的严格区分。**
  - 规则：0 是合法值并可参与排名；null 不参与数值排序，同时统计并显示缺少该指标的平台数量和已知原因。
  - 关联：FR-005、AC-04。

- [ ] **P1-050｜实现确定性排名。**
  - 排序：指标降序；完全相同时按平台规范名称升序，保证相同输入产生相同顺序。
  - 完成证据：打乱输入顺序后输出不变。

- [ ] **P1-051｜实现 Top 5 截断。**
  - 行为：默认只返回前五名；不足五名如实返回；不以虚构平台补齐。

- [ ] **P1-052｜实现排名质量标记。**
  - 行为：回答顶部显示 targetDate、窗口和 stale；partial、scope_mismatch 紧邻平台名；suite_wide 在 all 模式下进入单独“不可比观察项”，不混入榜单。

- [ ] **P1-053｜实现无可排名数据分支。**
  - 行为：说明窗口、指标和原因；给出 /status 或其他窗口建议；不返回空榜伪装成功。

- [ ] **P1-054｜完成 rank 单元测试。**
  - 文件：test/bot/rank.test.ts。
  - 覆盖：默认值、7d fees、income 别名、live/all、0、null、ties、partial、suite-wide、no-data。

- [ ] **P1-055｜实现 platform 查询编排。**
  - 行为：规范化平台 → 请求 overview 指定窗口 → 请求 platform detail → 合并 → 加 coverage/source health。

- [ ] **P1-056｜实现 platform 核心三指标。**
  - 默认展示：volume_usd、fees_usd、protocol_revenue_usd。
  - 限制：revenue_usd 只在用户明确问 Revenue 或 /why 时展示。
  - 完成证据：不会用 null 填 0，不会把不同 scope 混在同一行。

- [ ] **P1-057｜实现 requested window 与 rolling24h 分栏。**
  - 行为：两者同时存在时明确标注；只有 rolling24h 时不能声称是 1d。

- [ ] **P1-058｜实现平台不存在与不支持分支。**
  - 行为：区分别名未识别、平台存在但当前 Bot 不支持、请求指标不支持。

- [ ] **P1-059｜完成 platform 单元测试。**
  - 文件：test/bot/platform.test.ts 或等价文件。
  - 覆盖：LetsCash 30d、别名、歧义、不存在、null、partial、rolling24h 和 detail 64d 误用防护。

- [ ] **P1-060｜实现 /why 固定证据模板。**
  - 数据源：metricPolicies、scope/notes/comparability/exclude、quality、sources、coverage。
  - 约束：模板是确定性的，不能让 LLM 自由编造指标口径。

- [ ] **P1-061｜实现 Bankr 收入口径解释。**
  - 完成证据：明确收入定义、可比性、缺失原因和来源，不把 income 别名写成内部字段。

- [ ] **P1-062｜实现 Long、LetsCash、StonkBrokers、Pons、Flap 特定解释。**
  - 完成证据：每个平台只讲 Ledger 已知规则；缺证据时标为 unknown。

- [ ] **P1-063｜完成 why 单元测试。**
  - 文件：test/bot/explain.test.ts。
  - 覆盖：指标、平台、quality、coverage、source failure 和未知解释主题。

- [ ] **P1-064｜实现 /status 查询编排。**
  - 数据：healthz、sources、必要时 overview 1d、meta。
  - 输出：targetDate、最新可用运行、stale、可用/失败来源数量与原因、contract version。

- [ ] **P1-065｜实现 /status 内部信息净化。**
  - 禁止输出：内部主机名、端口、文件路径、异常堆栈、Secret、原始请求 ID。

- [ ] **P1-066｜完成 status 单元测试。**
  - 覆盖：全健康、部分失败、Ledger 不可用、stale、合同不兼容、缺 meta。

- [ ] **P1-067｜实现短期对话上下文。**
  - 存储：仅进程内存。
  - 限制：TTL 15 分钟，每个上下文最多保留最近 3 个 QueryPlan。
  - 隔离：私聊与群聊上下文分开，不能交叉引用。

- [ ] **P1-068｜实现上下文过期与容量淘汰。**
  - 完成证据：时间推进和第四个计划写入测试可复现。

- [ ] **P1-069｜实现“15 分钟后再问 Long”上下文用例。**
  - 行为：有效期内可补全明确省略；过期后要求澄清。
  - 关联：UC-07。

- [ ] **P1-070｜实现领域层统一入口。**
  - 文件：src/bot/domain 下的编排入口。
  - 约束：领域层只接收已验证 QueryPlan 和合同对象，不接收原始消息。

## 1.5 文本格式化

- [ ] **P1-071｜实现美元数字格式化。**
  - 规则：null 显示未知；0 显示 $0；绝对值小于 $0.01 使用明确小额格式；普通值保留两位并加千分位；大数使用一致 K/M。

- [ ] **P1-072｜实现非美元数量格式化。**
  - 规则：交易数、用户数等只在合同支持时显示；0 与 null 仍严格区分。

- [ ] **P1-073｜实现 UTC 日期格式化。**
  - 规则：所有 targetDate 以 UTC 日期明确展示，不使用模糊的“今天”替代证据日期。

- [ ] **P1-074｜实现 quality、coverage 和 source health 人话标签。**
  - 目标：普通用户能理解 reported、derived、partial、scope_mismatch、suite_wide、unknown 和来源健康。
  - coverage：显示 observedDays/windowDays；百分比只能作为辅助。

- [ ] **P1-075｜实现警告优先级。**
  - 顺序：无可用数据 → API 合同不兼容 → 最近刷新失败且使用旧缓存 → stale → 单来源 failed/degraded → partial/scope_mismatch/suite_wide → derived → 普通提示。
  - 完成证据：多警告快照测试稳定。

- [ ] **P1-076｜实现 rank 文本模板。**
  - 依赖：P0-020。
  - 目标：标题、窗口、指标、Top 5、警告、targetDate、建议命令均来自结构化数据。

- [ ] **P1-077｜实现 platform 文本模板。**
  - 依赖：P0-022。

- [ ] **P1-078｜实现 unknown/no-data 文本模板。**
  - 依赖：P0-024。

- [ ] **P1-079｜实现 stale/partial 文本模板。**
  - 依赖：P0-026。

- [ ] **P1-080｜实现 /start 与 /help 静态文本。**
  - 依赖：P0-028。
  - 约束：无需 Ledger、无需 LLM、目标不超过 1500 字符。

- [ ] **P1-081｜实现越界请求拒绝模板。**
  - 依赖：P0-030。

- [ ] **P1-082｜实现 detailUrl HTTPS 允许清单。**
  - 规则：只拼接预配置 HTTPS 基地址和受控路径；HTTP、javascript、data 和用户提供 URL 均拒绝。
  - 关联：AC-12。

- [ ] **P1-083｜实现目标 1500、硬上限 5000 字符控制。**
  - 行为：先压缩非关键说明，再按语义块拆分；不得在数字或链接中间截断。

- [ ] **P1-084｜实现语义分段。**
  - 顺序：警告 → 主答案 → 数据日期/质量 → 建议命令。
  - 完成证据：多段消息可按序发送且单段不超过平台上限。

- [ ] **P1-085｜完成 formatter 单元与快照测试。**
  - 文件：test/bot/formatter.test.ts。
  - 覆盖：数值边界、中文文案、长度边界、语义分段、HTTPS、警告排序和全部 Dialogue Lab 最终样式。

## 1.6 AI QueryPlan 解析层

- [ ] **P1-086｜定义供应商无关的 LLM Resolver 接口。**
  - 输入：最小化后的文本、允许的 action/metric/window/platform 列表、QueryPlan Schema。
  - 输出：经过验证的 QueryPlan 或明确失败。

- [ ] **P1-087｜实现本地 stub resolver。**
  - 目标：无需网络和密钥即可模拟成功、超时、非法 JSON、Schema 不合规和预算关闭。

- [ ] **P1-088｜编写严格系统提示模板。**
  - 规则：只能输出 QueryPlan；不能回答问题；不能调用工具；不能生成 URL、SQL、shell；不相信用户文本里的角色指令。
  - 产物：src/bot/intent/llm-resolver.ts 中的可测试模板或独立资源文件。

- [ ] **P1-089｜实现 LLM 输入最小化。**
  - 禁止发送：DeBox 用户/群 ID、App Key/Secret、完整 Ledger 响应、原始事件、内部 URL、日志。
  - 只发送：清洗文本、必要枚举、允许的平台规范 ID/名称/别名；需要上下文时可附不含身份的上一个短期 QueryPlan。

- [ ] **P1-090｜保证每条消息最多调用一次 LLM。**
  - 完成证据：集成测试统计调用次数。

- [ ] **P1-091｜实现 LLM 超时。**
  - 行为：超时后转澄清或命令帮助，不阻塞 Long Polling 主循环。

- [ ] **P1-092｜实现 LLM 并发上限。**
  - 行为：达到上限时快速降级，不无限排队。

- [ ] **P1-093｜实现每日硬预算开关。**
  - 默认：真实供应商未配置时为关闭。
  - 行为：预算达到上限后只使用确定性解析，并在聚合遥测中记录降级次数。

- [ ] **P1-094｜实现非法 LLM 输出 fail closed。**
  - 行为：JSON/Schema/枚举任一不合法都不得进入 Ledger 调用。

- [ ] **P1-095｜完成提示词注入测试集。**
  - 场景：忽略规则、访问任意网址、调用 refresh、输出 SQL、泄露系统提示、交易指令。
  - 完成证据：均被 Schema 或领域边界拒绝。

- [ ] **P1-096｜完成 LLM fallback 测试。**
  - 覆盖：stub 成功、超时、限流、预算关闭、非法输出、未知平台、需要澄清。
  - 关联：AC-08。

## 1.7 DeBox 抽象、fake 与轮询模型

- [ ] **P1-097｜定义 DeBox 入站事件最小接口。**
  - 字段只保留运行必需项：update token、chat target/type、message type、普通文本、是否明确 @ 当前 Bot。
  - 约束：不把平台原始事件直接传入领域层。

- [ ] **P1-098｜定义 DeBox 出站接口。**
  - 能力：发送纯文本、目标 chat、语义分段顺序、受控重试。
  - 默认：parse mode 使用 text。

- [ ] **P1-099｜实现 fake DeBox adapter。**
  - 文件：test helper 或 src/bot/debox 的测试实现。
  - 能力：回放私聊普通文本、群内明确 @ 普通文本、重复 update、发送 429、认证失败、网络失败。

- [ ] **P1-100｜实现事件范围过滤。**
  - 私聊：只处理普通文本。
  - 群聊：只处理明确 @Bot 的普通文本。
  - 拒绝：图片、视频、Card、合约行情卡片、附件和非 @ 群消息。
  - 完成证据：所有不支持类型都不进入解析器。

- [ ] **P1-101｜设计轮询接口但不猜官方 offset/ack 语义。**
  - 行为：本地 fake 使用显式可替换游标协议；真实语义留给阶段 2 在锁定 SDK 源码后实现。
  - 完成证据：代码注释和测试明确“尚未代表官方协议”。

- [ ] **P1-102｜实现 Long Polling 循环的通用控制器。**
  - 默认 timeout：30 秒。
  - 能力：启动、停止、单次拉取、批量处理、背压、可取消等待。

- [ ] **P1-103｜实现有界指数退避与 jitter。**
  - 场景：连接失败、5xx、429。
  - 约束：有最大等待；成功后重置；认证错误触发熔断而非无限重试。

- [ ] **P1-104｜实现优雅停止。**
  - 行为：停止接收新更新，等待有界时间处理当前任务，持久化必要的非个人状态，再退出。

- [ ] **P1-105｜设计幂等键接口。**
  - 首选：官方 update id/token。
  - fallback：仅在内存中生成短期派生键。
  - 禁止：在日志或遥测中保存 update id、chat id、user id 或其稳定哈希。

- [ ] **P1-106｜区分“已处理”和“发送失败”。**
  - 目标：避免重复计算，同时允许按明确策略重发同一答案。
  - 完成证据：测试定义崩溃发生在取数后、发送前、部分分段发送后的行为。

- [ ] **P1-107｜实现出站重试策略。**
  - 429：尊重等待并有上限；网络失败有限重试；认证失败熔断；用户错误不重试。

- [ ] **P1-108｜实现分段发送幂等。**
  - 目标：多段消息在重试时不乱序、不无限重复。

- [ ] **P1-109｜完成 poller replay 测试。**
  - 文件：test/bot/poller-replay.test.ts。
  - 覆盖：正常批次、空批次、重复 update、乱序、429、5xx、认证失败、停止、部分发送失败。

## 1.8 隐私、遥测与健康检查

- [ ] **P1-110｜实现日志脱敏。**
  - 移除：App Key/Secret、Authorization、原始消息、用户/群/update ID、内部 URL 查询参数、完整异常响应。
  - 完成证据：privacy 测试使用诱饵 Secret 和 ID，输出中均不可搜索到。

- [ ] **P1-111｜定义允许记录的聚合遥测 Schema。**
  - 字段：date、action、channel、outcome、latency bucket、used_llm、stale、quality count、source fail/count。
  - 禁止：message、user id、chat id、update id、稳定指纹、自由文本。

- [ ] **P1-112｜实现聚合遥测存储。**
  - 存储：Bot 独立 state，不写 Ledger 主数据库。
  - 行为：同一日期和聚合维度累加计数。

- [ ] **P1-113｜实现可配置 180 天保留。**
  - 行为：只删除 Bot 聚合桶；默认 180 天；不影响 Ledger 数据。

- [ ] **P1-114｜禁止伪造 unique user、retention 和 revisit 指标。**
  - 完成证据：Schema 无法表达稳定用户标识；报告模板明确写“不可测”。

- [ ] **P1-115｜实现可选自愿样本报告的 feature flag 外壳。**
  - 默认：关闭。
  - 约束：阶段 1 不实现上报、不发送外部数据。
  - 关联：FR-017，P2。

- [ ] **P1-116｜实现本地 health server。**
  - 绑定：localhost。
  - 字段：ok、Bot identity verified、polling status、Ledger reachable、apiContractVersion compatible、last successful poll、last successful reply、LLM enabled/budget fuse、process startedAt、appVersion。
  - 禁止：Secret、消息内容、用户/群 ID。

- [ ] **P1-117｜实现 readiness 与 liveness 区分。**
  - liveness：进程可响应。
  - readiness：配置有效、身份已验证或 fake 就绪、合同兼容、poller 可工作。

- [ ] **P1-118｜完成 privacy 测试。**
  - 文件：test/bot/privacy.test.ts。
  - 覆盖：正常日志、异常、429、认证失败、Ledger Schema 错误、LLM 错误和 health 输出。

- [ ] **P1-119｜完成遥测 Schema 负向测试。**
  - 完成证据：尝试写入 message、user id、chat id、自由文本时被拒绝。

## 1.9 应用编排与进程隔离

- [ ] **P1-120｜实现 Bot 依赖注入入口。**
  - 文件：src/bot/index.ts。
  - 组件：config、poller、inbound、parser、resolver、Ledger client、domain、formatter、outbound、telemetry、health。

- [ ] **P1-121｜固定单条消息处理流水线。**
  - 顺序：事件范围过滤 → 清洗 → 幂等检查 → 解析 QueryPlan → 合同检查 → 只读取数 → 领域计算 → 确定性格式化 → 发送 → 聚合遥测。

- [ ] **P1-122｜实现失败隔离。**
  - 目标：单条消息失败不退出 poller；Bot 进程退出不影响 dashboard/API/timer；Ledger 失败不产生伪数据。

- [ ] **P1-123｜实现有界并发与背压。**
  - 完成证据：突发 fake updates 不会无限创建 Promise 或耗尽内存。

- [ ] **P1-124｜禁止 Bot 导入采集器和主数据库写入模块。**
  - 完成证据：静态依赖测试或架构测试阻止相关 import。

- [ ] **P1-125｜禁止 Bot 调用 /api/refresh。**
  - 完成证据：代码搜索、allowlist 测试和 fake server 请求记录三重验证。

- [ ] **P1-126｜实现本地 fake 启动模式。**
  - 行为：fixture Ledger + fake DeBox + stub LLM 一条命令运行，不需要外部账号或 Secret。

## 1.10 限流、可观测性与统一降级

- [ ] **P1-RATE-001｜实现单聊天内存限流器。**
  - 初始默认：短时突发最多 5 条查询；持续速率最多每 10 秒 1 条。
  - 约束：参数可配置；限流状态只在内存中存在，不落盘、不进入日志或遥测。

- [ ] **P1-RATE-002｜实现全局并发保护。**
  - 范围：消息处理、Ledger 请求、LLM 请求和 DeBox 发送分别有有界并发。
  - 行为：达到上限时明确降级，不无限排队。

- [ ] **P1-RATE-003｜验证 /help 和参数错误不调用 Ledger 或 LLM。**
  - 完成证据：fake 调用计数为 0；仍能返回本地静态说明。

- [ ] **P1-RATE-004｜完成限流测试。**
  - 覆盖：突发第 1～5 条、持续速率、窗口恢复、私聊/群聊隔离、进程重启清空、无身份落盘。

- [ ] **P1-OBS-001｜实现结构化运行日志。**
  - 最小字段：时间、事件阶段、结果类别、延迟、稳定错误码。
  - 禁止字段：原始文本、外部原始错误字符串、用户/群/update ID、钱包、Secret。

- [ ] **P1-OBS-002｜实现分层故障定位。**
  - 层级：polling、DeBox send、Ledger、LLM、formatter。
  - 完成证据：每层故障都有稳定错误码和聚合计数，不依赖保存原始消息。

- [ ] **P1-ERR-001｜实现用户可见错误矩阵。**
  - 覆盖：指令参数错误、平台歧义、超出范围、LLM 不可用、Ledger 无可用缓存、Ledger stale、最近刷新失败、单来源失败、DeBox 发送失败、版本不兼容。
  - 规则：有旧缓存时带日期与警告；无 usable run 时不输出任何旧数字。

- [ ] **P1-OUT-001｜锁死回复目标来源。**
  - 规则：chat_type 与 chat_id 只能来自当前已验证入站事件，用户文本和 LLM 输出不能覆盖。
  - 完成证据：恶意文本尝试指定其他聊天时仍只回复原会话。

## 1.11 本地验收与质量门

- [ ] **P1-127｜完成端到端集成测试。**
  - 文件：test/bot/integration.test.ts。
  - 路径：fake event → QueryPlan → fixture Ledger → BotAnswer → fake outbound。

- [ ] **P1-128｜验证 AC-01：六个命令均可用。**
  - 证据：/start、/help、/rank、/platform、/why、/status 的集成测试结果。

- [ ] **P1-129｜验证 AC-02：核心查询用例可用。**
  - 证据：默认 rank、7d fees、LetsCash 30d、Bankr income explain、status。

- [ ] **P1-130｜验证 AC-03：Bot 数字与同一 fixture Ledger 响应精确一致。**
  - 规则：只允许格式化，不允许重算出不同业务口径。

- [ ] **P1-131｜验证 AC-04：0、null、quality、coverage 被正确区分。**

- [ ] **P1-132｜验证 AC-05：1d 与 rolling24h 不混淆。**

- [ ] **P1-133｜验证 AC-06：suite-wide 值不参加单平台排名。**

- [ ] **P1-134｜验证 AC-07：stale 和 partial 醒目标注。**

- [ ] **P1-135｜验证 AC-08：LLM 只做 QueryPlan 且故障可降级。**

- [ ] **P1-136｜验证 AC-09：重复 update 不重复产生业务副作用。**

- [ ] **P1-137｜验证 AC-10：无 refresh、任意 URL、任意 HTTP method 路径。**

- [ ] **P1-138｜验证 AC-11：日志和遥测无原始消息与稳定 ID。**

- [ ] **P1-139｜验证 AC-12：出站详情链接只有 HTTPS allowlist。**

- [ ] **P1-140｜验证 AC-13：合同不兼容时只保留 help/status 降级能力。**

- [ ] **P1-141｜验证 AC-14：Bot 故障不影响 dashboard 与 Ledger 定时任务。**
  - 本地方法：单独终止 Bot，确认 dashboard 测试/API fake 和既有进程模型不受影响。

- [ ] **P1-142｜运行性能基准。**
  - 目标：确定性命令 p95 ≤ 3 秒；AI 路径 p95 ≤ 10 秒；Ledger 单次 timeout 3 秒；常规回答目标 ≤ 1500 字符。
  - 证据：固定 fixture、样本量、机器信息、p50/p95/max。

- [ ] **P1-143｜运行资源压力测试。**
  - 范围：突发更新、慢 Ledger、慢 LLM、429、发送失败。
  - 目标：内存、队列和并发保持有界。

- [ ] **P1-144｜运行安全回归测试。**
  - 范围：SSRF、路径穿越、prompt injection、Secret 诱饵、日志注入、Schema 绕过、超长文本。

- [ ] **P1-145｜运行完整现有测试与 Bot 测试。**
  - 证据：命令、退出码、通过/失败数量。
  - 规则：不能只报 Bot 新测试通过而忽略原项目回归。

- [ ] **P1-146｜生成本地验收报告。**
  - 产物：docs/evidence/local-acceptance.md。
  - 内容：AC-01 至 AC-14 逐条证据、未通过项、已知限制、测试环境。

- [ ] **P1-EXIT-01｜确认 AC-01 至 AC-14 全部有自动化证据。**
- [ ] **P1-EXIT-02｜确认没有读取真实 Secret、连接真实 DeBox 或修改服务器。**
- [ ] **P1-EXIT-03｜确认 dashboard 既有测试无回归。**
- [ ] **P1-EXIT-04｜确认本地验收报告没有把 fixture 结果写成线上证明。**

---

# 阶段 2｜真实 DeBox 封闭试用

目标：在专用账号上创建并接入真实 Bot，只验证私聊普通文本与群内明确 @Bot 的普通文本；不公开发布、不申请被动群监听、不主动推送。

前置：阶段 1 全部退出条件；GATE-02 至 GATE-08 按任务顺序分别通过。

## 2.1 当前官方信息复核与供应链审查

- [ ] **P2-001｜重新核对 DeBox 官方 Bot Guide。**
  - 原因：平台规则会变化，不能仅依赖 plan.md 的 2026-08-30 快照。
  - 核对：Bot 配额、不可删除性、Long Polling/Webhook 互斥、消息类型、权限、文本长度、链接协议、审核流程。
  - 证据：docs/evidence/debox-official-refresh.md，附官方 URL 和核对日期。

- [ ] **P2-002｜重新核对 DeBox One Page API、Node SDK、FAQ 和 Grant 页面。**
  - 完成证据：记录与 plan.md 相同、变化和无法确认的项目；不把第三方文章当官方规则。

- [ ] **P2-003｜确认 Long Polling 仍适合封闭试用。**
  - 条件：Webhook 为空；无需公网入站；私聊普通文本和群内明确 @ 普通文本可到达。
  - 若条件变化：暂停并回到产品决策，不自行改成 Webhook。

- [ ] **P2-004｜审查候选 DeBox SDK。**
  - 核对：官方仓库、维护状态、许可证、依赖树、已知漏洞、网络访问、日志行为、类型质量。
  - 产物：docs/evidence/debox-sdk-review.md。

- [ ] **P2-005｜通过 GATE-02 后锁定 SDK 版本或 commit。**
  - 规则：package lock 必须可复现；禁止浮动 latest。

- [ ] **P2-006｜阅读锁定版本的轮询源码。**
  - 核对：getUpdates 参数、timeout、offset/ack、批次顺序、失败重试、重复投递、Webhook 冲突、返回类型。
  - 完成证据：源码文件、行号/commit 和结论写入 SDK 审查记录。

- [ ] **P2-007｜把官方 offset/ack 语义替换进 adapter。**
  - 约束：只按源码和真实 replay 证据实现，不沿用阶段 1 fake 的猜测。

- [ ] **P2-008｜增加官方语义 replay fixture。**
  - 覆盖：批次确认、崩溃重启、重复 update、部分发送失败、空批次和超时。

- [ ] **P2-009｜安装依赖后运行完整供应链与回归检查。**
  - 证据：lockfile diff、许可证、漏洞扫描、类型检查、全部测试。

## 2.2 账号、Bot 身份与模型决策

- [ ] **P2-010｜通过 GATE-03，确认专用项目账号与负责人。**
  - 规则：不使用个人长期主账号作为默认项目资产。

- [ ] **P2-011｜拟定 2 至 4 套 Bot 身份方案。**
  - 每套包含：名称、头像、简介、支持入口、与 RHC Launch Ledger 的关系说明。
  - 产物：docs/decisions/debox-bot-identity.md。

- [ ] **P2-012｜通过 GATE-04，锁定最终 Bot 身份。**
  - 完成证据：用户选择、理由和最终素材文件路径。

- [ ] **P2-013｜记录 Bot 创建前不可逆检查。**
  - 核对：账号正确、配额足够、名称无误、头像/简介无误、用户已知 Bot 不可删除。

- [ ] **P2-014｜通过 GATE-05 后创建真实 Bot。**
  - 完成证据：创建回执、显示名和创建时间。
  - 禁止：在截图、日志或文档中暴露 App Secret。

- [ ] **P2-015｜安全接收并保存 App Key/Secret。**
  - 存储：本地或服务器 Secret 管理位置；最小权限；文件权限收紧。
  - 禁止：源码、docs、聊天回显、Git、测试 fixture。

- [ ] **P2-016｜设计真实 LLM 的三案决策。**
  - 互斥方案：关闭真实 LLM；托管 API + 日预算；自托管模型。
  - 对比：解析质量、成本、隐私、延迟、维护和降级。
  - 产物：docs/decisions/llm-provider-and-budget.md。

- [ ] **P2-017｜通过 GATE-06，锁定模型、预算和熔断策略。**
  - 必须明确：单次超时、并发、每日硬预算、超预算行为、是否发送用户文本、数据保留政策。

- [ ] **P2-018｜如选择真实模型，审查并锁定模型 SDK。**
  - 依赖：GATE-02、GATE-06。
  - 证据：版本、许可证、依赖和隐私设置。

- [ ] **P2-019｜实现选定的真实 LLM adapter。**
  - 约束：仍只输出 QueryPlan；关闭日志留存能力时应显式配置；任何失败回到确定性路径。

- [ ] **P2-020｜通过 GATE-07 后配置真实 Secret。**
  - 范围：DeBox App Key/Secret；若启用则含模型密钥。
  - 完成证据：只记录配置位置和读取权限测试。

## 2.3 真实 DeBox adapter 与身份自检

- [ ] **P2-021｜实现官方 DeBox client wrapper。**
  - 文件：src/bot/debox/client.ts。
  - 约束：把 SDK 隔离在 adapter 内，领域层不依赖平台对象。

- [ ] **P2-022｜实现 getMe 启动自检。**
  - 行为：开始轮询前验证当前凭证对应的 Bot 身份。
  - 失败：readiness = not_ready，停止轮询和发消息。
  - 隐私：health/log 只报告类别，不输出完整身份和 Secret。
  - 关联：FR-001。

- [ ] **P2-023｜验证 Webhook 为空。**
  - 规则：Long Polling 和 Webhook 不能同时运行。
  - 完成证据：官方接口或控制台只读回查；记录结果，不记录凭证。

- [ ] **P2-API-001｜读取线上 /api/meta 并验证能力合同。**
  - 核对：service、appVersion、apiContractVersion、targetDate、supportedWindows、coreMetrics、platforms。
  - 规则：不能用本地 package.json 或平台名称存在来推断线上能力。
  - 完成证据：脱敏的当前响应快照、读取时间和 Schema 校验结果。

- [ ] **P2-API-002｜读取线上代表性 Ledger 响应。**
  - 范围：overview 1/7/30、至少一个 platform detail、coverage、sources。
  - 完成证据：当前响应通过相同运行时 Schema；targetDate、stale 和 warnings 均被保留。

- [ ] **P2-API-003｜按线上能力生成 Bot 平台允许列表。**
  - 规则：平台必须同时出现在 meta 能力表并有代表性响应验证；不从本地注册表单方面开启。
  - 特别门：Long 只有线上 meta 和代表性响应都验证通过时才进入 Bot 平台列表。

- [ ] **P2-API-004｜保存生产只读回查报告。**
  - 产物：docs/evidence/ledger-production-contract-readback.md。
  - 约束：不包含内部鉴权信息、完整主机信息或不必要原始数据。

- [ ] **P2-024｜实现真实 Long Polling。**
  - timeout：30 秒。
  - 语义：严格使用 P2-006 已核实的 offset/ack 规则。

- [ ] **P2-025｜实现真实入站事件规范化。**
  - 只提取最小字段；普通文本以外的 payload 不进入业务处理。

- [ ] **P2-026｜实现真实群内明确 @Bot 判断。**
  - 完成证据：真实事件 fixture 或封闭测试证明只有明确 mention 被处理。

- [ ] **P2-027｜实现真实 sendMessage 文本发送。**
  - parse mode：text。
  - 限制：目标 ≤1500，硬上限 ≤5000，按语义分段。

- [ ] **P2-028｜实现真实 429、5xx、网络失败和认证错误处理。**
  - 认证错误：熔断并 not_ready。
  - 429：有界退避。
  - 其他：遵守阶段 1 重试规则。

- [ ] **P2-029｜在真实 adapter 上重跑去重和部分发送测试。**
  - 完成证据：SDK 层行为与通用幂等策略没有冲突。

- [ ] **P2-030｜确认不支持的消息类型不会触发业务查询。**
  - 私聊和群聊分别验证图片、视频、Card、合约行情卡片、附件。
  - 群内变体消息属于 MVP 外且可能需要“监听群消息”权限。

## 2.4 部署准备

- [ ] **P2-031｜编写 Bot 部署运行手册。**
  - 产物：docs/runbooks/debox-bot-deploy.md。
  - 内容：前置检查、构建、配置、启动、验证、日志、轮换、停止和回滚。

- [ ] **P2-032｜编写 systemd 服务文件。**
  - 产物：deploy/rhc-launch-ledger-bot.service。
  - 目标：独立服务、独立重启策略、After/Wants 依赖、最小权限和安全加固。

- [ ] **P2-033｜规划独立低权限系统用户。**
  - 权限：只能读取运行包与 Secret，写 Bot 自己的 state/log；不能写 Ledger 主数据库或采集目录。

- [ ] **P2-034｜规划独立状态目录。**
  - 路径：/var/lib/rhc-launch-ledger-bot/bot-state.sqlite。
  - 约束：只保存幂等/聚合遥测等允许状态，不保存消息和稳定 ID。

- [ ] **P2-035｜确认 Long Polling 部署不需要公网入站。**
  - 行为：health 仅绑定 localhost；不新增 Nginx、域名和防火墙端口。
  - 若出现公网需求：暂停并走 GATE-09。

- [ ] **P2-036｜准备 Secret 配置模板。**
  - 模板只含变量名和说明，不含真实值。
  - 完成证据：仓库扫描无真实 Secret。

- [ ] **P2-037｜准备部署前回滚点。**
  - 内容：当前 dashboard/service 状态、包版本、配置备份位置、Bot 服务尚未启用的证据。

- [ ] **P2-038｜执行服务器只读预检。**
  - 核对：Node 版本、磁盘、内存、服务管理、Ledger API 本机可达、时钟、日志目录权限。
  - 约束：此步不修改服务器。

- [ ] **P2-039｜通过 GATE-08，确认部署主机、窗口和回滚负责人。**

## 2.5 部署与封闭试用验收

- [ ] **P2-040｜部署独立 Bot 运行包。**
  - 证据：构建版本、文件校验、目标路径。

- [ ] **P2-041｜创建低权限用户和独立状态目录。**
  - 依赖：P2-033、P2-034、GATE-08。
  - 完成证据：owner、mode 和不可写 Ledger 主数据的权限测试。

- [ ] **P2-042｜安装并启用 rhc-launch-ledger-bot.service。**
  - 完成证据：service 文件 checksum、daemon reload、enabled 状态。

- [ ] **P2-043｜配置真实 Secret 并收紧权限。**
  - 依赖：GATE-07、GATE-08。
  - 完成证据：服务用户可读、其他非授权用户不可读；输出中不显示值。

- [ ] **P2-044｜启动 Bot 并验证 getMe。**
  - 完成证据：readiness 就绪、身份匹配；日志中无 Secret/完整身份。

- [ ] **P2-045｜验证本地 health。**
  - 核对：liveness、readiness、poller、Ledger contract、last success、LLM budget state。
  - 约束：仅 localhost 可访问。

- [ ] **P2-046｜验证 dashboard 与原有定时任务仍健康。**
  - 完成证据：原服务、health/API、timer 的当前回查，不以部署成功代替。

- [ ] **P2-047｜执行真实私聊 /start 与 /help。**
  - 完成证据：DeBox 端可见回复、服务端聚合计数变化、无原始消息日志。

- [ ] **P2-048｜执行真实私聊 /status。**
  - 完成证据：targetDate、contract version、source 状态与同一时刻 Ledger API 一致。

- [ ] **P2-049｜执行真实私聊默认 /rank。**
  - 完成证据：逐项对比同一时刻 /api/overview?window=1，数字、顺序、quality、targetDate 一致。

- [ ] **P2-050｜执行真实私聊 /rank 7d fees。**
  - 完成证据：与 /api/overview?window=7 一致。

- [ ] **P2-051｜执行真实私聊 /platform LetsCash 30d。**
  - 完成证据：overview 30d 与平台详情的职责没有混淆。

- [ ] **P2-052｜执行真实私聊 /why Bankr income。**
  - 完成证据：解释来自 Ledger metricPolicies 与质量证据，不由 LLM自由生成。

- [ ] **P2-053｜执行真实群内明确 @Bot 普通文本查询。**
  - 完成证据：只有明确 mention 触发；回复发送到正确群聊。

- [ ] **P2-054｜验证群内非 @ 普通文本不触发。**
  - 约束：不申请监听权限来绕过此测试。

- [ ] **P2-055｜验证不支持的群消息变体不触发。**
  - 范围：图片、视频、Card、合约行情卡片。

- [ ] **P2-056｜验证重复真实 update 不重复回复。**
  - 方法：使用官方支持的安全 replay/测试环境；不伪造线上成功证据。

- [ ] **P2-057｜验证 429 和短时网络故障恢复。**
  - 约束：不得通过攻击或高频请求制造真实平台压力；优先使用 adapter/fault injection。

- [ ] **P2-058｜验证认证失败熔断。**
  - 方法：优先在隔离环境或 mock 层验证；不得泄露或故意作废生产 Secret。

- [ ] **P2-059｜检查运行日志隐私。**
  - 搜索：测试消息文本、用户 ID、群 ID、update ID、App Key、Secret 诱饵。
  - 完成标准：均不存在；只保留允许的聚合字段和错误类别。

- [ ] **P2-060｜验证 Bot 停止不影响 dashboard。**
  - 执行：停止 Bot 服务；回查 dashboard/API/timer；再启动 Bot。
  - 关联：AC-14。

- [ ] **P2-061｜验证 Bot 重启后轮询与幂等行为。**
  - 完成证据：无消息风暴、无无限 replay、readiness 恢复。

- [ ] **P2-062｜完成 AC-15 真实渠道验收。**
  - 条件：私聊普通文本和群内明确 @ 普通文本的核心命令均真实通过。
  - 证据：时间、Bot 版本、Ledger targetDate、用例、脱敏截图/文本回执。

- [ ] **P2-063｜生成封闭试用上线回执。**
  - 产物：docs/evidence/closed-pilot-launch.md。
  - 内容：service、health、getMe、私聊、群 @、精确数字、日志隐私、dashboard 独立性、回滚。

- [ ] **P2-EXIT-01｜确认 AC-01 至 AC-15 全部有当前证据。**
- [ ] **P2-EXIT-02｜确认没有申请监听群消息、主动推送或订阅权限。**
- [ ] **P2-EXIT-03｜确认没有公网入站端口、Webhook、HTTP 链接或主数据库写入。**
- [ ] **P2-EXIT-04｜确认真实运行证据与 fixture/本地测试证据分开标记。**

---

# 阶段 3｜封闭试用、证据积累与继续/停止决策

目标：用低风险真实使用证明 Bot 是否有用、是否稳定、成本是否可控；不追踪个人，不虚构留存。

## 3.1 试用设计

- [ ] **P3-001｜定义封闭试用范围。**
  - 决策：试用时长、受控群数量、参与者范围、负责人、允许命令。
  - 约束：不因试用自动扩大到公开用户。
  - 产物：docs/pilot/pilot-protocol.md。

- [ ] **P3-002｜定义试用成功指标。**
  - 建议：命令成功率、正确回答率、p95 延迟、stale/partial 透明度、重复回复次数、人工报告的有用性、LLM 调用率和日成本。
  - 禁止：unique user、retention、revisit，除非未来另行批准稳定身份数据。

- [ ] **P3-003｜定义错误分级与暂停阈值。**
  - P0：泄密、错误交易能力、越权写入、无限重复回复。
  - P1：错误数字、旧数据未标记、合同不兼容却继续回答。
  - P2：格式、别名和低影响体验问题。
  - 完成证据：每级有立即动作、负责人和恢复条件。

- [ ] **P3-004｜准备固定日常验收脚本。**
  - 覆盖：status、默认 rank、7d fees、一个 platform、一个 why、非 @ 消息、重复消息、stale 模拟。

- [ ] **P3-005｜准备人工正确性抽查模板。**
  - 记录：查询时间、命令、Bot 数字、同一时刻 Ledger API 数字、差异、解释。
  - 禁止记录：用户/群 ID 和原始私人消息。

- [ ] **P3-006｜准备试用反馈表。**
  - 只收：场景、是否解决问题、回答哪里不懂、期望命令。
  - 避免：钱包地址、密钥、私人群内容和不必要身份信息。

## 3.2 运行与巡检

- [ ] **P3-007｜每日检查 Bot readiness 与 poller 状态。**
  - 证据：日期、版本、targetDate、last successful poll、合同兼容性。

- [ ] **P3-008｜每日检查 Ledger source health 和 stale 状态。**
  - 原则：数据源失败时验证 Bot 是否如实降级，不把 source failure 当 Bot 成功。

- [ ] **P3-009｜每日执行固定查询抽样。**
  - 完成证据：Bot 与 Ledger 当前 API 的数字对账。

- [ ] **P3-010｜每日检查重复回复和发送失败。**
  - 数据：只使用聚合计数与受控测试回执。

- [ ] **P3-011｜每日检查日志隐私。**
  - 规则：发现消息内容或稳定 ID 立即按 P0 事件暂停服务。

- [ ] **P3-012｜每日检查 LLM 成本与降级。**
  - 若启用：记录调用量、预算使用、超时、Schema 失败；达到硬上限后验证确定性路径继续工作。
  - 若未启用：明确记录 used_llm = false，不把 stub 写成真实模型。

- [ ] **P3-013｜每周执行故障演练。**
  - 场景：Ledger 超时、meta 不兼容、source partial、DeBox 429、认证错误、Bot 重启。

- [ ] **P3-014｜每周确认 dashboard 与 timer 独立健康。**
  - 目标：Bot 运维没有侵入数据生产主链路。

- [ ] **P3-015｜按事件等级修复问题。**
  - 规则：先补可复现测试，再修复；不顺手扩范围；修复后重跑相关 AC 与全量回归。

- [ ] **P3-016｜记录每次线上变更回执。**
  - 内容：原因、版本、测试、部署、健康回查、回滚点。

## 3.3 试用退出与产品决策

- [ ] **P3-017｜汇总聚合试用数据。**
  - 只含允许字段和总体计数；不反推个人轨迹。

- [ ] **P3-018｜汇总人工反馈。**
  - 方法：去标识、归类为查询价值、准确性、理解成本、缺失功能和可靠性。

- [ ] **P3-019｜核对真实成本。**
  - 范围：模型、服务器增量、运维时间；DeBox/Grant 不确定收益单独列为未知。

- [ ] **P3-020｜完成安全与隐私复盘。**
  - 核对：Secret、日志、遥测、权限、依赖、事件处理和回滚。

- [ ] **P3-021｜生成封闭试用报告。**
  - 产物：docs/pilot/pilot-report.md。
  - 内容：证据等级、成功/失败用例、正确率、延迟、成本、反馈、已知限制、未解决风险。

- [ ] **P3-022｜给出继续、调整或停止三案。**
  - 继续：满足正确性、安全、使用价值和成本门槛。
  - 调整：核心有价值但存在可修复阻塞。
  - 停止：错误数字、隐私风险、低使用价值或成本不可控。

- [ ] **P3-023｜由用户决定是否进入公开发布/Grant 阶段。**
  - 这是新的产品与外部提交决策，不因阶段 2 成功自动进入。
  - 完成证据：docs/decisions/post-pilot-go-no-go.md。

- [ ] **P3-EXIT-01｜确认试用报告只使用真实可核验证据。**
- [ ] **P3-EXIT-02｜确认未声称 unique/retention/revisit。**
- [ ] **P3-EXIT-03｜确认用户明确选择继续、调整或停止。**

---

# 阶段 4｜公开发布与 Grant（条件阶段）

目标：只有用户在 P3-023 选择继续，并分别通过相关 GATE 后，才准备和执行公开动作。

## 4.1 发布范围重新决策

- [ ] **P4-001｜重新评估 Long Polling 与 Webhook。**
  - 方案 A：继续 Long Polling，无公网入站。
  - 方案 B：迁移 Webhook，需要 HTTPS、公网入口和更高运维要求。
  - 约束：二者互斥，不能同时启用。

- [ ] **P4-002｜重新评估公开发布所需权限。**
  - 分开决策：发布、监听群消息、主动推送、订阅、图片/Lv2。
  - 原则：每项权限单独证明必要性，不打包申请。

- [ ] **P4-003｜重新评估是否需要处理群消息变体。**
  - 若需要：说明业务价值、数据范围、审核要求、隐私变化和新增测试。
  - 若不需要：继续只支持普通文本。

- [ ] **P4-004｜重新评估是否需要稳定身份数据。**
  - 默认：不需要，不测留存。
  - 若需要：先设计最小化方案、保留期、告知/同意、删除和访问控制，再单独请用户决策。

- [ ] **P4-005｜更新 threat model 和 privacy 说明。**
  - 依赖：P4-001 至 P4-004 的最终选择。

## 4.2 条件基础设施

- [ ] **P4-006｜如选择 Webhook，通过 GATE-09。**
  - 决策：域名、TLS、Nginx、防火墙、健康检查、DDoS/限流和回滚。

- [ ] **P4-007｜如选择 Webhook，实现签名/来源校验。**
  - 完成证据：伪造请求、重放、超长 body 和错误 content type 被拒绝。

- [ ] **P4-008｜如选择 Webhook，实现 Long Polling 停用迁移。**
  - 顺序：停止 poller → 验证无并发消费 → 配置 Webhook → 回查平台状态 → 单通道验收。

- [ ] **P4-009｜如继续 Long Polling，确认无公网基础设施变更。**

- [ ] **P4-010｜如需要公开详情链接，验证所有页面 HTTPS 可用。**
  - 完成证据：证书、跳转、移动端、404 和 allowlist。

## 4.3 权限与公开材料

- [ ] **P4-011｜为每项高级权限编写最小必要性说明。**
  - 内容：用户价值、触发方式、数据处理、保留、拒绝行为和测试证据。

- [ ] **P4-012｜通过 GATE-10 后逐项申请权限。**
  - 规则：未批准的权限保持关闭；审核失败不绕过。

- [ ] **P4-013｜对获批权限增加 feature flag。**
  - 默认关闭；只有配置和平台权限同时满足才启用。

- [ ] **P4-014｜为新增权限补单元、集成、隐私和回滚测试。**

- [ ] **P4-015｜准备公开版 Bot 使用说明。**
  - 内容：能做什么、不能做什么、命令例子、数据来源、targetDate/stale、隐私、支持入口。

- [ ] **P4-016｜准备 DeBox 审核使用文件。**
  - 证据：真实 Bot、真实命令、真实数据对账、隐私边界、错误降级、路线图。
  - 禁止：把 fixture 截图当线上使用证明。

- [ ] **P4-017｜审校公开文案。**
  - 核对：不承诺交易收益、不夸大实时性、不虚构用户量/留存、不隐瞒数据覆盖限制。

- [ ] **P4-018｜通过 GATE-11 后发送审核材料。**
  - 完成证据：最终文件 checksum、发送时间、渠道、回执和后续问题。

- [ ] **P4-019｜跟踪审核结果并逐条回应。**
  - 规则：任何新增权限或范围要求都回到决策，不自动接受。

## 4.4 Grant 准备与提交

- [ ] **P4-020｜重新核对 Grant 当前规则和表单状态。**
  - 原因：开放状态、字段和门槛会变化。
  - 证据：官方页面、核对日期、当前要求。

- [ ] **P4-021｜建立 Grant 证据包目录。**
  - 内容：产品问题、DeBox 原生集成、架构、真实 Demo、试用证据、聚合指标、路线图、预算用途、安全与隐私。

- [ ] **P4-022｜写 Grant 项目叙事草稿。**
  - 核心：让 DeBox 用户用一句话查询 Robinhood Chain 项目活动、费用、协议收入和数据质量。
  - 边界：只读分析助手，不是交易 Bot。

- [ ] **P4-023｜写 Grant 里程碑与预算草稿。**
  - 每个里程碑：交付物、验收证据、时间、成本、风险。
  - 禁止：以未验证的用户增长或收入作保证。

- [ ] **P4-024｜写 Grant 路线图草稿。**
  - 区分：已完成、封闭试用、待审核、条件功能、长期设想。

- [ ] **P4-025｜核对所有数据陈述。**
  - 规则：聚合命令量可以报告；unique、retention、revisit 必须写不可测；真实调用与内部测试分开。

- [ ] **P4-026｜准备 Demo 和可复现说明。**
  - 内容：Bot 版本、Ledger contract、targetDate、命令、期望输出、失败降级。

- [ ] **P4-027｜完成 Grant 安全审查。**
  - 核对：文档、截图、视频、日志和压缩包中无 Secret、用户/群 ID、私人消息和内部主机信息。

- [ ] **P4-028｜完成 Grant 最终评审。**
  - 输出：提交版、内部完整版、删减说明和风险清单。

- [ ] **P4-029｜通过 GATE-12 后提交 Grant。**
  - 完成证据：最终提交副本、时间、渠道和平台回执。

- [ ] **P4-030｜记录 Grant 结果与后续承诺。**
  - 规则：获批不代表可自动扩大产品权限；新增承诺必须写回 plan/todo。

- [ ] **P4-EXIT-01｜确认所有公开声明有证据。**
- [ ] **P4-EXIT-02｜确认公开版仍无交易、签名和钱包权限。**
- [ ] **P4-EXIT-03｜确认新增权限都有独立开关、测试和回滚。**
- [ ] **P4-EXIT-04｜确认对外提交已有不可变副本和回执。**

---

# 阶段 5｜交付、运维与可复用资产

## 5.1 项目文档

- [ ] **P5-001｜更新项目 README。**
  - 内容：Bot 定位、架构、MVP 边界、命令、开发、测试、配置、部署和当前证据等级。

- [ ] **P5-002｜编写架构说明。**
  - 产物：docs/architecture/debox-bot.md。
  - 内容：单一 Ledger 真相源、GET-only、QueryPlan、确定性领域层、进程隔离、隐私遥测。

- [ ] **P5-003｜编写数据字典。**
  - 产物：docs/data-dictionary.md。
  - 内容：metric、scope、quality、coverage、unknown reason、targetDate、rolling24h 和 protocol_revenue_usd。

- [ ] **P5-004｜编写日常运维手册。**
  - 产物：docs/runbooks/debox-bot-operations.md。
  - 内容：健康检查、日志、遥测、预算、重启、依赖服务和正常降级。

- [ ] **P5-005｜编写故障排查手册。**
  - 场景：getMe 失败、Webhook 冲突、无更新、重复回复、429、Ledger 超时、合同不兼容、stale、LLM 超预算。

- [ ] **P5-006｜编写 Secret 轮换手册。**
  - 原则：不显示旧值或新值；轮换后验证 getMe/readiness；保留回滚边界。

- [ ] **P5-007｜编写回滚手册。**
  - 内容：停止 Bot、恢复上一版本、保留/迁移 state、验证 dashboard/timer、恢复服务、记录回执。

- [ ] **P5-008｜编写隐私与数据保留说明。**
  - 内容：保存什么、不保存什么、180 天聚合保留、无法测量的指标、删除方法。

- [ ] **P5-009｜编写发布记录模板。**
  - 字段：版本、范围、测试、部署、健康、证据、已知限制、回滚点。

## 5.2 最终验证

- [ ] **P5-010｜执行全量类型检查、单测、集成测试和安全测试。**

- [ ] **P5-011｜执行全部 AC-01 至 AC-15 回归。**
  - 规则：本地 fixture 证据和真实 DeBox 证据分别标记。

- [ ] **P5-012｜执行生产/试用环境当前状态回查。**
  - 核对：Bot service、health、getMe、Ledger、dashboard、timer、Secret 权限、聚合遥测和预算。

- [ ] **P5-013｜执行依赖与许可证复核。**
  - 核对：锁定版本、已知漏洞、未使用依赖和更新策略。

- [ ] **P5-014｜执行最终 Secret 与隐私扫描。**
  - 范围：源码、docs、fixtures、日志、构建包、截图和提交材料。

- [ ] **P5-015｜执行灾难恢复演练。**
  - 场景：Bot 进程崩溃、state 损坏、Secret 轮换、Ledger 不可用、部署回滚。

- [ ] **P5-016｜生成最终交付报告。**
  - 产物：docs/evidence/final-handoff.md。
  - 内容：完成范围、未完成范围、测试、真实运行、风险、权限、成本、回滚和下一步。

- [ ] **P5-017｜逐项核对本文所有勾选状态。**
  - 规则：没有证据的项目恢复为未勾选；条件未触发的项目标为“未进入”，不能伪装完成。

- [ ] **P5-018｜由用户确认最终交付。**
  - 完成证据：用户确认当前版本满足约定范围，或列出新的修订任务。

---

# 条件 Backlog｜不属于 MVP，不自动执行

- [ ] **BACKLOG-001｜被动监听全部群消息。**
  - 前置：独立产品价值证明、GATE-10、隐私重评、权限审核和新增测试。

- [ ] **BACKLOG-002｜主动推送日报、异常或排名变化。**
  - 前置：频率、订阅/退订、时区、噪音、来源失败、成本和平台推送权限决策。

- [ ] **BACKLOG-003｜按钮、Callback 或 Card 交互。**
  - 前置：平台能力、消息类型权限、签名/重放安全、无障碍与降级方案。

- [ ] **BACKLOG-004｜图片回答或图表。**
  - 前置：Bot Lv2、图片上传能力、生成成本、视觉 QA 和文本替代。

- [ ] **BACKLOG-005｜公开 Webhook 架构。**
  - 前置：GATE-09、TLS、签名、限流、监控、Long Polling 互斥迁移与回滚。

- [ ] **BACKLOG-006｜用户级个性化、收藏或历史。**
  - 前置：稳定身份数据的必要性、用户告知/同意、保留/删除、访问控制和隐私评审。

- [ ] **BACKLOG-007｜任何交易、签名、钱包连接或自动执行。**
  - 状态：明确排除；如未来提出，必须建立全新项目范围与安全模型，不能在本 Bot 上顺手增加。

- [ ] **BACKLOG-008｜复制 Ledger 采集器或建立第二套业务数据库。**
  - 状态：明确排除；Bot 必须继续使用 Ledger API 作为唯一数据真相源。

- [ ] **BACKLOG-009｜自愿上报无法识别的问题样本。**
  - 前置：单独的数据保留与删除方案、用户主动确认、确定性去除用户/群/钱包/URL/mention、向用户展示脱敏结果并再次确认。
  - 默认：关闭；不得借聚合遥测顺便保存原始问题。

---

# 需求—任务追踪索引

| 需求 | 主要实现任务 | 主要验收任务 |
|---|---|---|
| FR-001 身份自检 | P2-021～P2-023 | P2-044～P2-045 |
| FR-002 Long Polling | P1-101～P1-104、P2-024 | P1-109、P2-061 |
| FR-003 幂等 | P1-105～P1-108 | P1-136、P2-056 |
| FR-004 start/help | P1-033～P1-034、P1-080 | P1-128、P2-047 |
| FR-005 rank | P1-035～P1-036、P1-048～P1-054 | P1-129～P1-134、P2-049～P2-050 |
| FR-006 platform | P1-037、P1-055～P1-059 | P1-129～P1-132、P2-051 |
| FR-007 why | P1-038、P1-060～P1-063 | P1-129、P2-052 |
| FR-008 status | P1-039、P1-064～P1-066 | P1-128、P2-048 |
| FR-009 自然语言 QueryPlan | P1-040～P1-047、P1-086～P1-096 | P1-135 |
| FR-010 清洗与上下文 | P1-028～P1-032、P1-067～P1-069 | P1-127、P1-144 |
| FR-011 GET-only Ledger | P1-015～P1-027 | P1-137 |
| FR-012 /api/meta 合同 | P1-009～P1-014、P2-API-001～P2-API-004 | P1-140 |
| FR-013 确定性格式化 | P1-071～P1-085 | P1-130～P1-134 |
| FR-014 DeBox 发送 | P1-098、P1-107～P1-108、P1-OUT-001、P2-027～P2-029 | P1-139、P2-057 |
| FR-015 错误与降级 | P1-006～P1-007、P1-052～P1-053、P1-122、P1-ERR-001 | P1-134、P1-140 |
| FR-016 聚合遥测 | P1-111～P1-114 | P1-138、P3-017 |
| FR-017 自愿样本报告 | P1-115、BACKLOG-009 | 条件项，默认关闭 |
| FR-018 localhost health | P1-116～P1-117 | P2-045 |
| NFR-001 正确性 | P1-012～P1-085 | P1-128～P1-141 |
| NFR-002 降级 | P1-014、P1-053、P1-094、P1-122 | P1-134～P1-140 |
| NFR-003 性能 | P1-017～P1-021、P1-083、P1-091～P1-093、P1-RATE-001～P1-RATE-004 | P1-142～P1-143 |
| NFR-004 隐私 | P1-089、P1-110～P1-119 | P1-138、P2-059 |
| NFR-005 可维护性 | P1-004～P1-008、P1-120～P1-126 | P5-001～P5-009 |
| NFR-006 可观测性 | P1-111～P1-117、P1-OBS-001～P1-OBS-002 | P2-045、P3-007～P3-012 |
| NFR-007 成本 | P1-091～P1-093、P2-016～P2-019 | P3-012、P3-019 |

# 最终完成定义

- [ ] **DONE-001｜功能完成。**
  - 六个命令和批准的自然语言查询在真实 DeBox 私聊与群内明确 @ 普通文本中工作。

- [ ] **DONE-002｜数字可信。**
  - Bot 数字、targetDate、quality、coverage、source health 与同一时刻 Ledger API 一致。

- [ ] **DONE-003｜边界可信。**
  - 不交易、不签名、不连接钱包、不主动推送、不监听未授权群消息、不调用 refresh、不建第二套采集。

- [ ] **DONE-004｜隐私可信。**
  - 无原始消息、稳定 ID、Secret；聚合遥测无法重建用户轨迹。

- [ ] **DONE-005｜运行可信。**
  - 合同不兼容、数据 stale、source failure、DeBox 429、模型故障均能诚实降级。

- [ ] **DONE-006｜隔离可信。**
  - Bot 的停止、崩溃、升级和回滚不影响 dashboard、Ledger API 和现有定时任务。

- [ ] **DONE-007｜证据完整。**
  - AC-01 至 AC-15、部署回执、隐私扫描、回滚演练和真实试用报告可回查。

- [ ] **DONE-008｜外部动作合规。**
  - Bot 创建、Secret、部署、权限、审核文件和 Grant 均只在对应 GATE 获得授权后执行。

- [ ] **DONE-009｜用户完成最终验收。**
  - 用户确认交付范围，所有未完成/条件功能清楚保留在 Backlog。
