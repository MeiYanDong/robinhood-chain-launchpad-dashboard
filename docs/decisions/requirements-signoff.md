# Phase 0 需求评审记录

- 日期：2026-08-30
- 状态：Approved for local credential-free prototype
- 授权来源：用户确认公开 public 项目并要求按 todo 依次执行

## 冻结范围

- MVP 只读、按需查询；六个指令入口，四类数据任务。
- Ledger HTTP API 是唯一事实；Bot 不采集、不直读数据库、不 refresh。
- 内部统一 `protocol_revenue_usd`；income 只是输入别名。
- 1d 是完整 UTC 日，rolling24h 独立。
- QueryPlan v1、BotAnswer v1、BotMetricView v1、Ledger Contract v1 已形成可测试规格。
- Dialogue Lab L-01～L-05 按推荐默认方案 A 落定；这是用户授权的低风险默认细节，不改变产品边界。

## 实现授权

允许：本地质量基线、Phase 0 文档、Phase 1 fixture/fake/stub 代码、测试、公开仓库与 CI。

不允许：安装真实 DeBox/模型 SDK、创建真实 Bot、读取或配置 Secret、连接真实 DeBox、生产部署、权限申请、审核提交或 Grant。

## 评审结论

- FR-001～FR-018、NFR-001～NFR-007、AC-01～AC-15 均有追踪路径。
- AC-15 只能由阶段 2 真实渠道证明；Phase 1 只验 AC-01～AC-14。
- 外部停止门 GATE-02～GATE-12 继续关闭。
- 可以进入 Phase 1 本地无凭证原型；若实现发现需要改变范围、数据、成本或不可逆行为，必须暂停并重新决策。
