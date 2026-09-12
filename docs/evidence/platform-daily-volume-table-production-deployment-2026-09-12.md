# 平台逐日交易量表格生产部署证据（2026-09-12）

本文记录发布窗口内的只读回读。交易量、价格、来源状态和闭合日期会继续变化，不应把本文中的
点时数据当作当前值。

## 发布对象

- 应用版本：`0.25.0`。
- GitHub：[PR #49](https://github.com/MeiYanDong/robinhood-chain-launchpad-dashboard/pull/49)；
  生产代码提交 `d975fdbe0b4c7dbafce88a33c4a080ccfdc9c5e1`。
- release：`/opt/robinhood-chain-launchpad/releases/20260912T045237Z-d975fdb`。
- 直接回滚点：`/opt/robinhood-chain-launchpad/releases/20260911T164000Z-7cbda0e`，版本
  `0.24.2`。

## 产品与数据口径

- “平台交易量走势”曲线下方增加最近 7 个完整 UTC 日的逐日表格，日期最新在前；Pons、Long、
  PAIR 使用同一组日期，不把各平台不同日期的数据挤到同一行。
- 每个可用单元格显示完整美元金额和较前一日变化。日变化公式为
  `当天交易量 / 前一完整 UTC 日交易量 - 1`。
- 前一日缺失、可疑或为零时不计算变化率；不跨过缺口寻找更早日期作为分母。
- 缺失显示“当日无数据”，可疑值显示“可疑值未采用”，两者都不替换成零。
- 图表数据点、逐日表和 API 的 `changePercent` 来自同一套日度模型，避免图表与表格口径漂移。

## 校验

- 本地 `npm run verify` 通过格式、lint、类型、覆盖率门槛、构建和 `324/324` 项测试。
- GitHub CI 的 `verify`、`chain-daily`、`cashcat` 三项检查全部成功后，PR #49 才合并。
- 公网 `verify:runtime` 于 `2026-09-12T04:53:57.780Z` 完成 `23/23` 个只读合同检查，全部
  HTTP 200；`/api/meta` 回读 `appVersion=0.25.0`、`targetDate=2026-09-11`。
- 公网 `/api/platform-activity` 的三平台日度点均包含 `changePercent`。发布窗口内，
  `2026-09-11` 的 Pons 为 `$556,421,311.39`、日增 `12.45%`，Long 为
  `$40,915,386.96`、日增 `70.35%`；PAIR 当日缺失，保持 `valueUsd=null`、
  `changePercent=null`，没有伪装成零。
- 真实 Chromium 桌面回读显示 7 行逐日金额、涨跌颜色和缺失状态；390 px 手机视口回读
  `bodyScrollWidth=390`，表格在自身 346 px 容器内横向滚动到 660 px，没有把整页撑宽。

## 运行状态与发布边界

- collector 与 query 均为 `active/running`，`NRestarts=0`、`ExecMainStatus=0`；
  `robinhood-chain-pair-refresh.timer` 为 `active`。
- 系统盘发布后使用约 6.6 GB，使用率 `18%`，可用约 31 GB。
- 发布后最新采集状态为 `partial`，原因是最新闭合日的 PAIR 日交易量尚缺，不是进程或部署失败；
  页面和 API 均按缺失状态展示。
- 第一次发布尝试复用旧 release 的运行依赖，因其中不含 TypeScript 编译器而在切换前失败；保护
  脚本删除未完成 release，线上 `0.24.2` 未受影响。第二次按 lockfile 安装构建依赖、完成构建并
  裁掉开发依赖后才原子切换。
- 本次没有修改采集频率、飞书规则、Webhook、数据库或钱包权限；只增加日变化派生字段和前端展示。

若需要回滚，把 `current` 原子切回上述 `0.24.2` release，并重启 collector 与 query；旧 release
仍完整保留。
