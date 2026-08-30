# RHC Launch Ledger Bot 威胁模型 v1

| 威胁 | 预防 | 检测 | 失败方式 | 测试 |
| --- | --- | --- | --- | --- |
| 提示词注入 | 命令优先、LLM 仅 QueryPlan、Schema additionalProperties=false | invalid-plan 计数 | 澄清/拒绝，不调用领域工具 | query-plan、integration |
| SSRF/任意 URL | 固定 base、受控 path、拒绝绝对 URL/重定向 | ledger 拒绝类别 | LEDGER_INPUT_INVALID | ledger security |
| refresh 放大 | 客户端没有 refresh 方法、仅 GET allowlist | 方法/路径断言 | 本地拒绝 | ledger security、architecture |
| Secret 泄露 | 无默认 Secret、环境/secret store、日志 allowlist | staged scan、诱饵 scan | 熔断并轮换，不回显 | privacy/config |
| 重复 update | reserve/process/commit、TTL 去重 | duplicate_count | 已完成不再发；发送不确定时安全停 | replay |
| 数字幻觉 | LLM 不接触/生成数字；领域确定性 | fixture 精确对账 | 合同失败则不答数 | integration |
| 旧数据冒充最新 | targetDate/stale/runStatus 必填、警告置顶 | stale_count | 有缓存 degraded，无缓存 unavailable | status/fault |
| null→0 | 领域和 formatter 使用 null union | unknown_count | 显示 unknown reason | rank/platform/formatter |
| 错误排名 | 只排序可比非 null 平台、tie 规范名 | fixture shuffle | no-data 或稳定榜 | rank |
| 隐私日志 | 字段 allowlist；不传原文/ID/URL query | 日志/状态文件诱饵扫描 | 丢弃敏感字段 | privacy/telemetry |
| SDK 供应链 | 阶段 1 无 SDK；阶段 2 官方来源、版本/commit、许可证/漏洞审查 | lock diff、audit | GATE-02 前不安装 | supply-chain review |
| 模型成本 | 默认关闭/stub；硬预算、并发/超时、确定性降级 | calls/cost/budget state | 达限关闭 LLM，命令可用 | llm budget |
| 合同漂移 | /api/meta 主版本、严格关键字段校验 | contract_error_count | rank/platform/why fail closed | contract |
| DeBox 认证/429 | 认证熔断、429 有界退避、无无限循环 | health/poller counters | not_ready 或稍后重试 | fake fault，真实 adapter replay |
| 消息过长/注入链接 | 1500目标、5000硬限、语义分段、HTTPS allowlist | outbound failure count | 压缩/分段或拒绝链接 | formatter/outbound |
| Bot 影响 Dashboard | 独立进程、HTTP GET、独立 state | 双 health | Bot 停止，Ledger继续 | integration、阶段2回查 |

## 信任边界

不可信：DeBox 消息、LLM 输出、Ledger HTTP JSON、上游错误文本、用户 URL。可信但仍校验：本地静态平台别名、配置 Schema、锁定 fixture。高敏感：DeBox/模型 Secret，只能在阶段 2 经授权进入 secret store。

## 不在 Phase 1 的风险接受

真实 DeBox offset/ack、平台权限、Bot 不可删除性、真实模型数据保留和生产网络配置尚无本地代码能证明，全部保留到对应 GATE 与阶段 2 证据。
