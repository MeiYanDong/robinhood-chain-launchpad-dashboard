# Long 日交易量恢复与生产部署证据

记录日期：2026-09-10。以下数值是部署验收时点的只读回读；后续完整 UTC 日会继续更新。

## 用户可见故障

- 全链目标日、Pons 与 PAIR 已更新到 `2026-09-09`，但三平台经营对比仍停在
  `2026-09-07`。
- 经营对比只接受三个平台都存在数据的同一个完整 UTC 日，因此问题不是整站停止，而是 Long
  日交易量缺少 `2026-09-08`、`2026-09-09` 后把共同日期拖住。

## 根因

- systemd 定时器、collector、query 与数据库写入均正常运行。
- Long 官方 GraphQL 的同一只读查询，在生产服务器原有 Chrome/macOS 传输指纹下返回
  `403 Forbidden`，响应明确带 `cf-mitigated: challenge`；本机出口仍返回 `200`。
- 在同一台生产服务器、同一个官方 URL 上，Firefox/Linux 与 Safari/macOS 指纹返回 `200`。
  因此根因是 Long 的 Cloudflare 浏览器指纹挑战变化，不是日期算法、公式或整个服务器停机。
- 当天已经存在一条 `partial` 采集记录，启动时的新鲜度保护不会擅自重复打上游；修复上线后仍需
  显式重采当天并补回前一天缺口。

## 修复

- 版本：`0.20.12`；生产提交：`8455176`；GitHub PR：
  [#33](https://github.com/MeiYanDong/robinhood-chain-launchpad-dashboard/pull/33)。
- Long 的日度采集与历史补采现在共用受控的 Firefox、Safari、Chrome 指纹回退链。
- 三种官方访问路径全部失败时仍明确降级；没有使用滚动 24H、代币榜单或第三方估算回填平台完整日。
- 验收时另发现 Long 代币榜单的 15 分钟 systemd 任务仍经只读 query 网关转发并返回 `503`；
  该内部写任务已改为直连只监听本机的 collector `127.0.0.1:4176`。它不改变公网写权限。
  主机重启后、依赖尚未稳定的第一轮直连刷新失败；随后同一条 systemd 任务在
  `2026-09-10T08:42:23.195Z` 成功刷新，健康状态恢复为 `latestRunStatus=success`。其活跃
  代币样本仍不用于代替本次恢复的 Long 平台完整日交易量。
- 发布 release：`/opt/robinhood-chain-launchpad/releases/20260910T075229Z-8455176`。
- 直接回滚 release：`/opt/robinhood-chain-launchpad/releases/20260909T083109Z-c24eba4`。

## 数据修复与生产回读

- Long `2026-09-08`：`$24,456,964.61255846`，由同一个官方小时成交源历史补采。
- Long `2026-09-09`：`$30,875,058.21475836`，共 `86,222` 笔成交、`1,273` 个活跃
  Long 资产，由发布后生产强制刷新取得。
- Long 两个官方来源的最新健康状态均为 `ok`；小时交易量最新数据日为 `2026-09-09`。
- `/api/economics` 与 `/api/economics/health` 的目标日均推进到 `2026-09-09`；
  最终回读为 `status=success`、`platformDataComplete=true`、`valuationReady=true`。

## 验证

- 本地 `npm run verify`：格式、lint、类型、构建、覆盖率门槛与 `310/310` 测试全部通过。
- GitHub `verify`、`chain-daily`、`cashcat` 三条 CI 全部通过后合并。
- 最终配置下发前，主机管理代理与 HTTP 服务停止响应；明确实例执行了一次正常重启，没有使用
  强制关机。实例于 `2026-09-10T08:33Z` 恢复 `Running/Normal`，数据库补采记录与 release
  均原位保留。
- 公网 `verify:runtime` 在重启后于 `2026-09-10T08:38:02.988Z` 通过 `23/23` 个只读运行合同；
  `/api/platform-activity`、`/api/economics`、`/api/economics/valuation` 的目标日均为
  `2026-09-09`。
- collector 与 query 均为 `active/running`、`NRestarts=0`；七条 launchpad 相关定时器恢复为
  `active`，Long 代币榜单任务完成一次真实直连刷新。PAIR 日交易量告警仍为
  `configured=true`、阈值 `10%`、`pending=0`、
  `failed=0`。阿里云助手已恢复心跳；其安装脚本留下的一次性 `cloud-final` 失败状态在核验代理
  正常后已清除，最终没有 failed systemd unit。

本次没有修改数据库结构、删除历史记录或用零填充缺失日。生产数据库继续原位保留，代码回滚点
也仍可用。
