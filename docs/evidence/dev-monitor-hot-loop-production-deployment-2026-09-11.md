# DEV 监控热循环修复生产部署证据

记录日期：2026-09-11。链上项目数、价格与运行资源会继续变化；本文只记录发布窗口内的回读。

## 发布对象

- 应用版本：`0.22.1`。
- GitHub：[PR #41](https://github.com/MeiYanDong/robinhood-chain-launchpad-dashboard/pull/41)；
  生产提交 `d62cfe2e221dc199a6ac40910fc6d3a180bfa628`。
- release：`/opt/robinhood-chain-launchpad/releases/20260911T101629Z-d62cfe2`。
- 直接回滚点：`/opt/robinhood-chain-launchpad/releases/20260911T092021Z-b1b5d05`（`0.22.0`）。

## 问题与修复

旧版 DEV 监控每 11 秒都从 `monitor.sqlite` 重新读取并解析约 14.3 万个项目、重新生成约
8.9 万个创建者画像，再把全部画像写回 SQLite。即使只有 `observedAt` 变化，也会重复写项目行。
这使 2 vCPU / 2 GiB 的 SWAS 长期处于高磁盘读取和 I/O 等待，并拖慢同机查询与运维代理。

`0.22.1` 将项目与画像工作集保留在唯一 collector 进程内：

- `observedAt` 单独变化不再当成经济证据变化，也不再重写项目行；
- 只有发行归属、区块证据、价格、市值、流动性、成交或质量状态实际变化时，才重新计算画像；
- 只有画像结果实际变化时才写回该画像，不再整表重写；
- 没有可通知的新发行或买入时，不再构建完整告警比较映射；
- PAIR 项目公开查询复用 collector 内存工作集，不再为每次 GET 重新扫描 SQLite。

通知仍只允许 PAIR 项目方主发行钱包；游标、确认数、经济门槛和飞书去重策略没有改变。

## 验证

- 本地 `npm run verify`：格式、lint、类型、覆盖率门槛、构建和 `314/314` 项测试通过。
- 新增回归测试确认：相同项目仅更新时间不会再次写项目或画像；真实 24H 成交变化仍会更新两者。
- GitHub `verify`、`chain-daily`、`cashcat` 三项检查全部通过后才合并。
- 公网 `verify:runtime` 于 `2026-09-11T10:41:36.543Z` 通过 `23/23` 个只读合同。
- 真实 Chromium 公网页面显示七日主参考、最新完整日短期参考、两个公式、来源输入、三条历史线
  与每日明细；控制台 `0` 错误、`0` 警告。
- 冷加载结束后的 60 秒采样中，collector 读取量依次为约 `36.9 MiB/10s`、`7.1 MiB/10s`、
  `0.12 MiB/10s`，随后各窗口约 `0.004–0.106 MiB/10s`；另一最终窗口约
  `0.23 MiB/10s`，未再出现旧版持续整表扫描。
- 最终回读：collector、query 均为 `active/running`，`NRestarts=0`、`ExecMainStatus=0`；
  当前启动周期 collector warning 为 `0`。七个 launchpad timer 均为 `enabled/active`。
- PAIR 日交易量飞书告警仍为 `configured=true`、阈值 `10%`、`pending=0`、`failed=0`。

## 发布异常与恢复

最初在旧 collector 仍持续扫描热库时旁路执行服务器 TypeScript 构建。编译与旧热循环竞争磁盘和内存，
导致 HTTPS 与 Cloud Assistant 同时失去响应；编译 invocation 最终返回 `Timeout / ClientNotRunning`。
该时点 `current` 仍指向 `0.22.0`，没有发生半切换，也没有执行数据库迁移或完整性扫描。

按 SWAS 故障恢复流程重启实例。控制面恢复 `Running` 后，先停止七个定时器和旧 collector，确认
回滚点未变化，再在低负载下完成构建、裁剪开发依赖并原子切换。新 collector 就绪后才重新启动 query
和定时器；自动回滚守卫未触发。

重启初期 `robinhood-chain-long-refresh.service` 曾在 collector 监听 4176 前执行一次，因连接拒绝留下
瞬时失败记录；collector 随后的内置 Long 刷新成功，公开 Long health 返回 `ok=true`、`stale=false`。

## 当前边界

- 运行盘约 `95%` 使用、剩余约 `2.0 GiB`；本次只移除失败的临时 staging 内容，没有删除数据库、
  历史证据或既有回滚 release。
- 内存缓存消除了重复 SQLite 扫描，但新进程冷启动仍需一次性读取现有项目和画像；这段加载不能描述为
  零成本。继续扩容项目历史时，应另行评估增量画像和独立 collector 主机，而不是依赖当前 2 GiB 主机
  无限增长。
- 本次仍未在生产热库运行 `PRAGMA quick_check` 或 `PRAGMA integrity_check`；轻量可读与运行合同通过
  不等于完整 SQLite integrity check。
