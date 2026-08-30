# RH Launch Ledger｜部署目标决策

- 状态：`confirmed_decision`
- 决策日期：2026-08-31

## 决策

用户确认 RH Launch Ledger 首轮部署到 Robinhood Chain Launchpad 当前同一台服务器。

目标为阿里云 SWAS `robinhood-chain-radar`（`us-west-1`，实例 ID `ceff28ff463440c09d8666b0f081bc7f`）。当前身份、状态、资源和原服务健康已通过 `docs/evidence/rh-launch-ledger-server-preflight-2026-08-31.md` 只读核验。

## 隔离与安全条件

- 内部服务名保持 `rhc-launch-ledger-bot.service`，显示名称使用 `RH Launch Ledger`。
- 使用独立低权限用户、release 目录、state 目录和 Secret 文件。
- Bot 只能通过 HTTP GET 读取 localhost Ledger API，不能读取或写入 Launchpad SQLite，不能调用 refresh。
- Long Polling health 只绑定 localhost，不新增公网端口、Nginx、TLS 或防火墙规则。
- 真实 Secret 不进入公开仓库、聊天、日志、截图或部署包。

## 执行窗口与回滚

- 执行窗口：GATE-02 至 GATE-07 所需前置分别满足后即可安排；本次授权不允许用 fake/stub 代替真实接入并宣称上线。
- 生产合同前置：当前线上 `/api/meta` 为 404；在取得单独的 Launchpad 生产变更授权并完成该合同的公网/loopback 读回前，不启动 Bot 正式轮询。
- 回滚负责人：执行部署的 Codex 操作者；任何异常先停止并禁用新 Bot 服务。
- 回滚点：预检时 Bot service/user/path 均不存在，原 Launchpad release `20260830T035333Z`、service 和 timer 均健康；回滚不得切换或覆盖原 Launchpad release。
- 持续性风险：SWAS 控制面显示 2026-09-24 到期，续费和迁移不包含在本次部署授权中。
