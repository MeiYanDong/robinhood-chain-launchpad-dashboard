# PAIR 最新单日交易量估值生产部署证据

记录日期：2026-09-11。以下数值是部署验收时点的只读回读，价格会继续变化。

## 模型调整

- 主参考价由最近 7 个共同完整 UTC 日的交易量合计，改为 PONS 与 PAIR 最新一个共同完整
  UTC 日的交易量。
- 最近 7 日合计仍保留为“7 日平滑对照”，不再参与主参考价；近 7 个共同完整日的逐日结果
  继续用于展示历史参考区间。
- 公式为：`PONS 当前价 × PONS/PAIR 有效供应量比 × PAIR/PONS 最新完整日平台交易量比`。
- 缺少共同完整日、PONS 价格过期或来源口径不可比时继续失败关闭，不使用滚动 24H 或补零。
- 模型版本升级为 `pons-latest-day-volume-parity-v2`。单日口径响应更快，也更容易受短期噪声
  影响，因此当前第三方 PONS 价格条件下置信度明确为 `low`。

## 发布对象

- 应用版本：`0.21.0`。
- GitHub：[PR #37](https://github.com/MeiYanDong/robinhood-chain-launchpad-dashboard/pull/37)；
  生产代码提交 `e189889dfc540feb8c68df3f5e64490c10e5ae51`。
- release：`/opt/robinhood-chain-launchpad/releases/20260911T082327Z-e189889`。
- 直接回滚点：`/opt/robinhood-chain-launchpad/releases/20260910T075229Z-8455176`。
- 发布后主动重建经济快照，并刷新、重启 query 进程，避免旧七日模型留在查询缓存。

## 生产数据回读

验收快照 `observedAt=2026-09-11T08:27:19.828Z`，平台日期为 `2026-09-10`：

- PONS 当前价：`$0.64209484`；PONS 有效供应量：`695,433,691.4491558`。
- PAIR 有效供应量：`889,556,947.5503154`。
- PONS 最新完整日平台交易量：`$494,832,344.31965125`。
- PAIR 最新完整日平台交易量：`$1,110,831.11887261`。
- 单日主参考价：`$0.0011268629741450235`。
- 7 日平滑对照：`$0.008020077102786573`；单日主参考比七日结果低 `85.9495%`。
- PAIR 实际价格：`$0.005529`；相对单日主参考价溢价 `390.6542%`。

PAIR 调整锚也已刷新到相同单日换算因子 `0.0017549790217049922`，不再读取旧的七日
换算因子。该结果是经营规模相对估值，不是保证会到达的未来价格。

## 验证

- 本地 `npm run verify`：格式、lint、类型、覆盖率门槛、构建和 `311/311` 项测试全部通过。
- GitHub `verify`、`chain-daily`、`cashcat` 三条检查全部通过后，PR #37 才合并。
- 公网 `verify:runtime` 于 `2026-09-11T08:31:24.578Z` 通过 `23/23` 个只读运行合同。
- `/api/meta` 回读 `appVersion=0.21.0`、`targetDate=2026-09-10`；经济健康状态为
  `success`、`platformDataComplete=true`、`valuationReady=true`。
- 公网页面已返回 `app.js?v=0.21.0`，并包含“按最新完整日平台量折算”和“7 日平滑对照”。
- collector、query 与 Nginx 均为 `active`；collector/query 的 `NRestarts=0`、
  `ExecMainStatus=0`、`NeedDaemonReload=no`。七条 launchpad 定时器均为 `active`。
- PAIR 日交易量飞书告警仍为 `configured=true`、阈值 `10%`、`pending=0`、`failed=0`，
  本次部署没有制造重复通知。

## 边界

- 生产盘在发布后使用率为 `96%`，剩余约 `1.7 GiB`；本次未删除任何旧 release、数据库或
  历史记录。
- `robinhood-chain-long-daily.service` 在本次发布前已经保留一条失败状态；Long 健康与榜单的
  公网合同仍返回 200，七条定时器均正常启用。该既有日报失败与本次 PAIR 估值模型无关，
  本次没有掩盖或擅自清除它。

