# Changelog

本项目按 Keep a Changelog 的结构记录用户可见行为和重要工程变化。版本号沿用 package.json。

## Unreleased

### Added

- 公开 GitHub 仓库、Biome 格式/lint、全源码覆盖率门槛与 GitHub Actions CI 定义。
- HTTP、DashboardService、SQLite 和只读运行验证的关键路径测试。
- 可测试的只读运行验证器与发布后 runbook。
- DeBox Bot 的详细 plan、todo、技术决策和 Phase 1 故事卡。

### Changed

- HTTP 路由从进程入口拆为可测试 handler；server.ts 只负责组合与生命周期。
- DashboardService 支持 collector、clock 和安全日志依赖注入。

### Security

- 公共错误使用稳定错误码，不再返回原始异常消息。
- 公开 source/run/warning 信息经过脱敏；失败详情只保留内部错误类别。

## 0.4.0

- 增加 Long 官方只读数据候选与 LetsCash 官方日序列优先级。
- 当前 README 记录该版本尚未部署到既有生产实例。
