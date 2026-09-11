# 生产存储与保留策略

## 目标

生产机只保留运行所需的热数据，不把十几 GB 的旧发布包、浏览器临时目录或重复数据库
备份长期堆在系统盘。代码由 GitHub 恢复，整盘事故由云厂商快照恢复；SQLite 迁移必须使用
经校验的新副本，不能直接在在线文件中删表。

## 当前边界

- CashCat 后台采集已退役；服务仅保留历史报告与兼容只读 API。
- `launchpad-dashboard.sqlite` 保存经营、日度与产品数据。
- `monitor.sqlite` 保存当前 PAIR V2、Alpha 与项目方监控数据。
- 旧主库中的 `pair_v2_*`、`pair_alpha_*`、`dev_monitor_*` 是拆库前的重复历史，只有在
  云端恢复点已完成、writer 已停止时，才可从新副本中移除。
- 自动维护服务对 `/var/lib/robinhood-chain-launchpad` 设置 `InaccessiblePaths`，因此无权
  接触任何 SQLite 文件。

## 自动保留

`robinhood-chain-storage-maintenance.timer` 每天北京时间约 03:40 执行（另有最多 10 分钟
随机延迟）：

- 发布目录保留当前 release 与两个最近回滚点；
- 部署配置备份保留最近 3 份；
- 失败的预发布目录保留 7 天；
- CashCat 的 `scoped_dir*` 浏览器临时目录保留 24 小时；Chrome 正在运行时整项跳过；
- 根分区达到 75% 写 warning，达到 85% 令任务失败并进入 systemd 告警状态。

脚本默认 dry-run，只有显式传入 `--apply` 才删除。删除范围由固定根目录和类型检查约束。

## 数据库瘦身流程

1. 创建并确认云端整盘快照处于 `accomplished`。
2. 停止所有写入定时器与 `robinhood-chain-launchpad.service`，保留 query 缓存短暂服务。
3. 运行 `compact-main-database.py SOURCE DESTINATION`。脚本先用 SQLite backup API 生成
   一致副本，只在副本中移除旧监控表，再执行 `VACUUM`、`quick_check`、
   `foreign_key_check` 和保留表逐表行数核验。
4. 运行 `compact-sqlite-database.py` 为 `monitor.sqlite` 生成完整压缩副本；不得删监控表。
5. 保存原文件名，原子切换两个新副本，修复 owner/mode 后启动服务。
6. 核验公网 API、游标推进、通知队列、所有 timer 与 SQLite 完整性。
7. 只有核验全部通过后，才删除服务器上的旧大文件；恢复依赖本次云端整盘快照。

脚本从不覆盖 source。若 destination 已存在或没有发现待移除的旧监控表，操作会失败关闭。

## 本地开发机

不得把生产全量数据库或整盘快照下载到 Mac。开发机只保留代码、fixture 和确有必要的单份
本地缓存；生产故障恢复材料放在云端快照，不在项目目录复制十几 GB 备份。
