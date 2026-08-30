# RHC Launch Ledger Bot 需求追踪矩阵

> 规则：Phase 1 只验收 AC-01 至 AC-14；AC-15 必须来自真实 DeBox，受阶段 2 外部停止门约束。

## 功能需求

| 需求 | 本地实现任务 | 自动化证据 | 真实证据 |
| --- | --- | --- | --- |
| FR-001 身份自检 | P1-119、P1-139；真实 adapter 为 P2-022 | fake readiness/integration | P2-044 |
| FR-002 Long Polling | P1-116～P1-120 | poller replay | P2-024、P2-047～053 |
| FR-003 幂等 | P1-121～P1-123 | duplicate/partial-send replay | P2-056、P2-061 |
| FR-004 start/help | P1-033、034、080 | parser/formatter/integration | P2-047 |
| FR-005 rank | P1-035、048～054、076 | parser/rank/integration | P2-049、050 |
| FR-006 platform | P1-037、055～059、077 | platform/integration | P2-051 |
| FR-007 why | P1-038、060～063 | explain/integration | P2-052 |
| FR-008 status | P1-039、064～066 | status/integration | P2-048 |
| FR-009 Intent Resolver | P1-040～047、086～094 | parser/query-plan/LLM stub | 模型启用后按 GATE-06 |
| FR-010 清洗与上下文 | P1-028～032、067～069 | parser/context | 封测抽样 |
| FR-011 只读客户端 | P1-015～025 | ledger client security tests | P2-API-001～004 |
| FR-012 合同与能力门 | P1-009～014、026、027 | meta/contract tests | P2-API-001～003 |
| FR-013 确定性回复 | P1-048～085 | domain/formatter snapshots | P2-049～052 对账 |
| FR-014 消息发送 | P1-113、124、125 | fake outbound/replay | P2-027～029 |
| FR-015 错误与降级 | P1-007、075、095、144 | fault matrix | P2-057、058 |
| FR-016 聚合遥测 | P1-130～134 | telemetry/privacy | 封测聚合读回 |
| FR-017 自愿问题上报 | P1-135（本地禁用默认路径） | privacy/consent tests | 后续单独授权 |
| FR-018 运行健康 | P1-136～140 | health/readiness tests | P2-045、046 |

## 非功能需求

| 需求 | 实现任务 | 证据 |
| --- | --- | --- |
| NFR-001 数据正确性 | P1-013、023～025、048～066 | contract/domain/integration 精确断言 |
| NFR-002 可用与降级 | P1-014、017～021、075、095、139 | timeout/retry/cache/fault tests |
| NFR-003 性能 | P1-020、021、126～129、143 | 合并、缓存、限流、延迟测试 |
| NFR-004 隐私 | P1-096～110、130～135 | allowlist、诱饵、Schema、文件扫描 |
| NFR-005 可维护性 | QUALITY-006～012、P1-004～008 | verify、CI、ADR、故事卡 |
| NFR-006 可观测性 | P1-130～140 | 聚合 telemetry 和分层 health |
| NFR-007 成本 | P1-086～095 | stub、预算熔断、LLM 关闭回归 |

## 验收标准

| AC | 实现/测试任务 | Phase 1 结论边界 |
| --- | --- | --- |
| AC-01 六指令明确 | P1-033～039、046、080、085 | 本地可完成 |
| AC-02 四类查询 | P1-141、142 | fixture only |
| AC-03 数字与 API 一致 | P1-023、024、141 | fixture 精确相等；生产待 P2 |
| AC-04 null/0/quality | P1-049、054、059、074 | 本地可完成 |
| AC-05 1d/rolling24h | P1-057、059 | 本地可完成 |
| AC-06 suite-wide 隔离 | P1-025、052、054 | 本地可完成 |
| AC-07 stale/失败提示 | P1-075、079、144 | 本地可完成 |
| AC-08 LLM 故障不阻塞命令 | P1-040、090、093、094 | stub 故障注入 |
| AC-09 不重复回复 | P1-121～123 | fake replay；真实待 P2 |
| AC-10 不 refresh/任意 URL | P1-015、016、019、043、045 | 安全负向测试 |
| AC-11 不落原文/稳定身份 | P1-096～110、130～135 | 文件/日志/Schema 测试 |
| AC-12 无 HTTPS 不发链接 | P1-082、085 | 本地可完成 |
| AC-13 Long 能力门 | P1-009～014、144 | 本地合同；线上待 P2-API |
| AC-14 Bot 故障隔离 | P1-141、144 | 本地进程/adapter 隔离 |
| AC-15 真实私聊与 @Bot | P2-047～063 | Phase 1 不得勾选 |

## 完整性检查

- FR-001～FR-018：18/18 有实现任务与测试/回执入口。
- NFR-001～NFR-007：7/7 有工程门禁或自动化证据。
- AC-01～AC-15：15/15 有证据路径；AC-15 明确隔离到真实接入阶段。
