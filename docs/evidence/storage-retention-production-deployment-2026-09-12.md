# 生产存储收敛与 CashCat 停采证据（2026-09-12）

## 结果

- 实例：阿里云 SWAS `ceff28ff463440c09d8666b0f081bc7f`，系统盘 40 GB。
- 操作前：已用约 36 GB，使用率 96%，可用约 1.8 GB。
- 操作后：已用约 6.0 GB，使用率 17%，可用约 32 GB。
- 本次没有把生产数据库或整盘快照下载到本地 Mac。

## 恢复点

- 变更前创建云端整盘快照 `s-rj96nu431xjhdwwn2rh2`，名称
  `rhc-before-storage-20260911`；控制面回读 `Status=accomplished`、`Progress=100%`。
- 数据库切换后另保留一套文件级紧凑备份：
  - `backups/launchpad-dashboard-20260912-compact.sqlite`：78,499,840 bytes；
  - `backups/monitor-20260912-compact.sqlite`：509,693,952 bytes。
- 两份文件级备份都通过 SQLite backup、`VACUUM`、`quick_check`、
  `foreign_key_check` 和逐表行数核验。

## 清理与瘦身

- CashCat 自动调度关闭；`/api/health` 回读 `scheduler_running=false`、
  `next_run_at=null`。服务和历史报告继续只读可用。
- 删除 5,289 + 954 个无进程引用的 Chrome `scoped_dir*` 临时目录；仅此一步将系统盘
  从 96% 降到 77%。
- 删除云快照已经覆盖的旧全量数据库备份约 13 GB；删除前逐文件列出大小，活动库不在
  `backups/` 目录内。
- 发布目录只保留当前版本和两个直接回滚版本；部署配置备份只保留最近 3 份；失败预发布
  目录清零。
- 主库从 7,176,384,512 bytes 降到 78,438,400 bytes。新副本移除了拆库前遗留的
  `pair_v2_*`、`pair_alpha_*`、`dev_monitor_*` 重复表；30 个经营与日度表的行数逐表一致。
- monitor 库从 891,854,848 bytes 降到 508,743,680 bytes；21 个监控表全部保留，
  切换时 `pair_v2_runs=8208`，服务恢复后新 run 与清理策略继续推进。
- 新库完成公网验证后，服务器上的两个 `precompact` 大文件才被删除；历史完整状态仍可由
  上述整盘快照恢复。

## 运行时读回

- 首次部署 release：`/opt/robinhood-chain-launchpad/releases/20260911T162000Z-9ba132b`，
  GitHub 合并提交 `9ba132bfd509d710e49690e035d00a413fce5d47`，应用版本 `0.24.1`。
- `robinhood-chain-launchpad.service`、`robinhood-chain-query.service`、
  `cashcat-sentinel.service` 均为 `active`。
- 8 个业务/维护 timer 均恢复为 `active`；
  `robinhood-chain-storage-maintenance.service` 首次执行 `Result=success`、
  `ExecMainStatus=0`。
- 公网 `https://47.251.99.37` 的运行时验证覆盖 23 个只读合同，全部 HTTP 200；PAIR V2、
  项目方监控、资金闭环、Long、经营对比、估值和统一产品接口均通过。

## 删除的恢复边界

删除内容包括可再生 Chrome 缓存、旧发布包、旧配置副本、旧数据库备份和已验证切换后的
`precompact` 数据库。代码由 GitHub 与保留的两个 release 恢复；当前数据库由文件级备份
恢复；需要完整历史时使用云端整盘快照。没有删除当前数据库、CashCat 历史报告、生产配置
或通知凭证。
