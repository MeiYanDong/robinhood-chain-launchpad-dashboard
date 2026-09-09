# 全链数据融入 PAIR 工作台生产部署证据

记录日期：2026-09-09；生产切换与最终回读发生在 06:02–06:10 UTC。

## 发布对象

- 版本：`0.20.3`。
- GitHub：PR #22；生产代码提交
  `575adb8cd47a24236ca900ca37dda60882ab36e2`。
- release：`/opt/robinhood-chain-launchpad/releases/20260909T060043Z-575adb8`。
- 直接回滚点：
  `/opt/robinhood-chain-launchpad/releases/20260909T044433Z-98952d4`（`0.20.1`）。
- 发布源码包 SHA-256：
  `63b684b32f1e08859a17ec9bf9f8494a69a1f7c3cf6b0b89ba5c61758fafdbcc`。
- 构建产物包 SHA-256：
  `4f3c807987d3ee74b6630bd0d04ea4d0a6707d1580695e2afcc95b2539890712`。

## 产品结果

1. 全链数据保留为一级入口，并与 `PAIR 经营 / PAIR Alpha / PAIR V2 / 资金闭环` 使用同一套
   PAIR 工作台导航、视觉语言和移动端底栏；根路径默认打开全链数据。
2. CashCat 不再作为一级产品或导航入口。旧 `/cashcat/` 页面重定向到龙头下钻页，历史只读
   API 继续保留，避免破坏既有数据链路。
3. 全链首屏先回答数据日期、更新延迟、来源状态和当前判断，再展示 8 个核心数；其余 14 项
   明细按需展开。来源失败、延迟和 `UNKNOWN` 不会被补零或隐藏。
4. `/leaders/` 保留为全链下钻入口；平台经营、机会发现、V2 监控和资金闭环各自仍显示原有
   决策内容，不复用错误模板。
5. 浏览器每 5 分钟轮询一次全链快照；服务器上的采集、查询、日报和刷新 timer 继续独立运行，
   不依赖本地 Codex 定时任务。

## 验证结果

- 本地 `npm run verify`：格式、lint、类型、测试覆盖率门槛和生产构建全部通过；全链服务
  17/17 测试与构建通过；CashCat 兼容层 36/36 测试通过。
- GitHub PR #22 的 `verify`、`chain-daily`、`cashcat` 三条 CI 全部通过后才合并。
- 公网 `verify:runtime` 的 23/23 个只读运行合同全部返回成功；`/api/meta` 回读
  `appVersion=0.20.3`、`targetDate=2026-09-08`。
- `/`、`/chain/`、`/launchpads/`、`/pair-alpha/`、`/pair-v2/`、`/pair-flow/`、
  `/leaders/` 全部返回 200；`/cashcat/` 返回 308 并跳转至 `/leaders/`，
  `/cashcat/api/status` 仍返回 200。
- 全新 Chromium 手机会话逐路由验收：每个入口只显示对应页面标题，7 条路由页面级横向溢出
  均为 0，控制台 0 error / 0 warning。全链页另通过 1440px 桌面和 390px 手机视觉复核。
- collector、query 和 Nginx 均为 `active`；collector/query 的 `NRestarts=0`、
  `ExecMainStatus=0`。全链、PAIR、Long、经济面和资金闭环相关 timer 均为 `active`。

## 数据状态与自动更新回执

- 部署时全链最新快照为 `targetDate=2026-09-07`、
  `generatedAt=2026-09-08T07:00:04.394Z`，相对最新完整 UTC 日落后 1 天，且有 5 个来源失败；
  页面按原值显示“落后 1 天”和“5 个来源失败”，没有把旧快照标成实时。
- 当日 08:10 CST 的 PAIR 日报曾因本机查询请求超过 30 秒而失败。发布后在查询服务稳定状态下
  手动重跑成功，最新日报回读 `reportDate=2026-09-09`、`snapshot.status=success`；日报仍提示
  代币榜快照超过预期更新时间，因此没有把 stale 状态隐去。
- PAIR 日交易量告警仍为 `configured=true`、阈值 `10%`、`pending=0`、`failed=0`；部署和日报
  重跑后 `lastSentAt` 仍为 `2026-09-09T04:46:23.820Z`，没有产生重复飞书通知。

## 回滚与边界

发布采用不可变 release、Nginx 配置预检和 `current` 原子切换。新配置在 `nginx -t` 通过后才
重启服务；若切换阶段失败，流程会恢复上一 release 与备份配置。生产数据库、Webhook 和历史
release 均未删除或覆写。

本次证明页面、接口、服务和定时任务已运行，不代表所有上游来源已恢复。全链快照的 1 天延迟与
5 个失败来源仍是当前数据质量事实，后续应由服务器上的日采集任务继续刷新并据实展示。
