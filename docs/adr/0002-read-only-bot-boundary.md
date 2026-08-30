# ADR-0002：Bot 只通过 Ledger GET 合同读取数据

- 状态：Accepted
- 日期：2026-08-30

## 背景

Dashboard 已经负责采集、来源优先级、SQLite 与窗口聚合。如果 Bot 再写采集器、读取数据库或触发 refresh，会形成第二套事实、放大外部请求，并把聊天流量变成生产写入风险。

## 决策

Bot 是独立进程，只能通过固定 base URL 调用白名单 GET endpoint：healthz、meta、overview、platform detail、coverage、sources。Bot 不导入 DashboardDatabase，不读取 Ledger SQLite，不调用 POST /api/refresh，不接受用户提供的 URL，不跟随跨源重定向。

自然语言或可选 LLM 只能生成受 Schema 约束的 QueryPlan。数值选择、排序、质量判断和回答格式均由确定性代码完成。

## 后果

- Ledger API 合同版本成为 Bot readiness 的硬门。
- Ledger 不可用或合同不兼容时 fail closed；help 仍可用，数据回答降级。
- Bot 崩溃或停止不能影响 Dashboard 和定时采集。
- 新数据能力先进入 Ledger，再由版本化合同开放给 Bot。

## 验证

- 阶段 1 的允许清单、SSRF、重定向、合同与集成测试。
- 阶段 2 的生产 API 只读回查和 Bot 停止独立性验证。
