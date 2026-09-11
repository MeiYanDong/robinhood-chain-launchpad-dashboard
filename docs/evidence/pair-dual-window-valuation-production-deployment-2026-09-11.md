# PAIR 双窗口相对估值生产部署证据

记录日期：2026-09-11。价格和平台量是部署验收时点的只读回读，后续会继续变化。

## 发布对象

- 应用版本：`0.22.0`。
- GitHub：[PR #39](https://github.com/MeiYanDong/robinhood-chain-launchpad-dashboard/pull/39)；
  生产提交 `b1b5d055ead2c84741eb8c038d0eb2632cf7173f`。
- release：`/opt/robinhood-chain-launchpad/releases/20260911T092021Z-b1b5d05`。
- 直接回滚点：`/opt/robinhood-chain-launchpad/releases/20260911T082327Z-e189889`（`0.21.0`）。

## 模型与页面

- 模型升级为 `pons-dual-window-parity-v3`。
- 七日主参考使用双方最近 7 个共同完整 UTC 日的交易量合计；至少缺 1 天时，主判断失败关闭。
- 最新单日参考使用双方最近 1 个共同完整 UTC 日，只表示短期升温或降温。
- 两个结果独立展示，不加权、不合并。PAIR 实际价格不参与参考价计算，只分别计算相对折价或溢价。
- PONS 七日预测换算 PAIR 时，也同时输出七日和最新单日两条结果。
- 历史读取保留兼容：V1 的 `estimateUsd` 映射为七日结果；V2 的 `sevenDayEstimateUsd`
  映射为七日结果、`estimateUsd` 映射为最新单日结果；V3 使用显式字段。
- 页面按“七日主参考 → 当前价 → 最新单日参考 → 两组偏离”的顺序展示，并公开两个公式、逐项代入、
  输入来源、三条历史线和每日明细。图表日期固定使用 UTC，不再受浏览器本地时区偏移。

## 生产数据回读

浏览器验收快照约为 `2026-09-11T09:36Z`，共同完整日为 `2026-09-10`，七日窗口为
`2026-09-04` 至 `2026-09-10`：

- PONS 当前价：`$0.643889`；PAIR 当前价：`$0.005564`。
- PONS 七日平台量：`$4,868,284,750.70`；PAIR 七日平台量：`$77,780,971.84`。
- 七日主参考：`$0.00804203`；PAIR 当前价相对七日主参考折价约 `30.81%`。
- PONS 最新完整日平台量：`$494,832,344.32`；PAIR 最新完整日平台量：`$1,110,831.12`。
- 最新单日参考：`$0.00112995`；PAIR 当前价相对最新单日参考溢价约 `392.41%`。
- 最新单日参考比七日主参考低约 `85.95%`，表示 PAIR 平台的最新完整日成交相对七日常态明显降温，
  不是单独的价格目标或买卖信号。
- 情报接口同步返回 V3，`pairAdjustedAnchor` 同时存在 `sevenDay` 与 `latestDay`。

## 验证

- 本地 `npm run verify`：格式、lint、类型、覆盖率门槛、构建和 `313/313` 项测试通过。
- GitHub `verify`、`chain-daily`、`cashcat` 三项检查全部通过后才合并 PR。
- 重启后的最终公网 `verify:runtime` 于 `2026-09-11T09:55:15.457Z` 通过 `23/23` 个只读合同。
- 真实 Chromium 公网页面验收通过；页面版本、V3 字段、公式、输入来源、历史图和每日表均可见，
  控制台为 `0` 错误、`0` 警告。
- 重启后 collector、query、Nginx 均为 `active/running`，`NRestarts=0`、`ExecMainStatus=0`，
  当前启动周期没有 warning 日志。
- 七个 launchpad 定时器均为 `active/enabled`。PAIR 日交易量飞书告警仍为 `configured=true`、
  阈值 `10%`、`pending=0`、`failed=0`。
- `launchpad-dashboard.sqlite` 与 `monitor.sqlite` 均能以只读方式打开并读取 schema；这只是轻量可读性核验，
  不等同于完整 SQLite integrity check。

## 发布异常与恢复

- 前三次切换均由自动回滚守卫撤销。原因是部署命令手写了错误的窗口枚举值；应用真实合同是
  `latest_7_common_closed_utc_days` 和 `latest_common_closed_utc_day`。模型和生产数据当时已经正常生成
  V3，但错误守卫将其误判为失败。最终发布按源码合同修正后通过。
- 最终切换中，一次有在途后台任务的 collector 没能在 systemd 的 `TimeoutStopSec=20` 内退出，
  systemd 对旧进程执行了 SIGKILL。新进程随后正常启动并完成首次 `23/23` 验收。
- 为补查上述强制终止，我错误地在生产热库运行了全量 `PRAGMA quick_check`。该只读扫描虽不改数据，
  但产生持续高磁盘读 IOPS，使 TCP 仍可连接而 HTTP/TLS 不再响应；Cloud Assistant 命令也出现排队。
  全量检查在 180 秒上限内未完成，不能声称完整性检查通过。
- 按 SWAS 运行时故障恢复流程重启实例；控制面经历较长的 `Stopping` 后恢复 `Running`。
  重启后不存在 `quick_check` 进程，公网 `23/23` 合同再次通过，并完成连续一分钟读请求观察。
- 运维手册已增加约束：生产热库不得直接运行全量 SQLite 完整性扫描；需要时应使用一致性副本或维护窗口。

## 当前边界

- 发布后系统盘使用率约 `95%`，剩余约 `2.0 GiB`；本次没有删除旧 release、数据库或历史记录。
- `robinhood-chain-long-daily.service` 仍保留部署前 `2026-09-11 08:12:08 CST` 的既有失败状态
  （exit `22`）；Long 健康与榜单合同返回 200，相关 timer 为 `active/enabled`。本次未清除或掩盖该状态。
