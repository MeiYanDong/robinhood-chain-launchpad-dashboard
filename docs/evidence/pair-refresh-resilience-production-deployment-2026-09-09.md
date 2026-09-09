# PAIR 工作台与自动刷新韧性生产部署证据

记录日期：2026-09-09；以下状态均为发布时点回读，市场数值会继续变化。

## 最终发布对象

- 版本：`0.20.11`；生产代码提交：`c24eba4`。
- GitHub 修复链：PR #24–#31；最终两项修复分别为 PR #30 和 PR #31。
- release：`/opt/robinhood-chain-launchpad/releases/20260909T083109Z-c24eba4`。
- 直接回滚点：
  `/opt/robinhood-chain-launchpad/releases/20260909T082026Z-a0d7786`（`0.20.10`）。
- 发布源码包 SHA-256：
  `30a92c97a60e9d771e94899812a103841b3ca6754bfe2f167d4421ede87f5a05`。
- 构建产物包 SHA-256：
  `c869082e925f4ac52fd91d565ebc99ed212654242e61b1d9f26abfeff21c901e`。

## 产品结果

全链数据没有删除，而是与 PAIR 工作台使用同一套一级导航、视觉层级和证据表达：

1. 全链数据；
2. PAIR 经营；
3. PAIR Alpha；
4. PAIR V2；
5. 资金闭环。

CashCat 不再占一级导航，也不再作为当前龙头资产叙事。旧链接与只读历史 API 继续兼容，
本次没有删除 CashCat 历史数据。

## 故障链与最终原因

修复不是一次扩大超时，而是逐层把失败边界拆开：

- PR #24 将可选 GMGN 持币查询收紧为 8 秒，并让服务器 timer 直连本机 collector。
- PR #25 曾尝试把分页提高到 100；随后核验官方合同每页上限为 50，未把该假设保留到最终版。
- PR #26 恢复 `limit=50`，增加首页复核、完整条数、重复地址和三次整批快照校验。
- PR #27 为全链各采集器增加 120 秒截止，并在进程重启时收口遗留 `running` run。
- PR #28 为 PAIR 15 分钟任务增加 120 秒退避，15 分钟内最多启动 3 次。
- PR #29 让 PAIR 经营与 PAIR V2 的官方代币目录共用一个总并发为 4 的请求池；相同在途页合并。
- PR #30 把三次整批快照重试与首尾页一致性检查补到 PAIR V2。
- PR #31 处理最终阻塞点：官方 `consumer-live` 实时认证返回 503、错误码
  `standard_route_consumer_attestation_unavailable`，但 `/api/tokens` 仍为 200。系统现在只在数据库
  已存在完全匹配 releaseId、manifest 且曾认证为 canonical 的记录时降级复用身份；首次认证、
  返回了不匹配身份或非 canonical 状态时仍失败关闭。

因此，版本身份、代币目录、DexScreener、持币地址和 RPC 已成为独立来源；一个辅助来源故障不再
把全部市场数据拖成旧快照，也不会把缺失补成零。

## 生产刷新回读

`0.20.11` 上线后，PAIR V2 完整 run `19197` 成功以 `partial` 落库：

- 官方代币目录：`2421/2421`，状态 `ok`；
- 版本认证：复用上次已核验 release，状态 `degraded`；
- DexScreener：`143/408`，状态 `degraded`；
- GMGN 持币：`9/433`，状态 `degraded`；
- Robinhood Chain RPC：状态 `ok`；
- 持久化完整快照由旧 run `7267` 更新为 run `19197`。

随后主动让两条刷新在同一时点启动，验证共享容量：

- PAIR 经营 run `776`：`2026-09-09T08:36:07.031Z` 开始，
  `2026-09-09T08:37:47.617Z` 完成；状态 `success`，全量 `2421`、活跃样本 `20`；
- PAIR V2 run `19202`：`2026-09-09T08:36:06.887Z` 开始，
  `2026-09-09T08:38:53.918Z` 完成；状态 `partial`，官方目录仍为 `2421/2421`；
- 两条 run 没有再因聚合 8 并发互相挤压，PAIR systemd 任务本轮 `NRestarts=0`。

下一次服务器自然 timer 在 `2026-09-09T08:45:03.657Z` 启动 run `777`。首轮因官方上游
波动以 `pair_upstream_fetch_failed` 结束，systemd 没有依赖本地 Codex，在 120 秒退避窗口内
自动启动第二轮 run `778`；该轮于 `2026-09-09T08:49:52.258Z` 成功完成，完整目录增至
`2422`、活跃样本仍为 `20`，任务最终 `NRestarts=1`、下一次 timer 为 09:00 UTC。
失败期间 `/api/pair/health` 继续保留可用快照；成功后回读
`observedAt=2026-09-09T08:49:16.370Z`、`latestRunStatus=success`、`stale=false`。

PAIR 日交易量飞书告警保持 `configured=true`、阈值 `10%`、`pending=0`、`failed=0`；
`lastSentAt=2026-09-09T04:46:23.820Z`，本次发布和手动验收没有重复通知。

## 全链与公网回读

- 全链最新 run `33` 已终结为 `partial`，目标完整 UTC 日为 `2026-09-08`；14 个来源中
  13 个 `ok`、Long 官方小时交易量 1 个 `failed`。页面继续明确显示低置信度，不把来源失败
  伪装成全链恢复。
- 公网 `verify:runtime` 在 `2026-09-09T08:39:43.045Z` 完成 23/23 个只读合同，全部返回 200。
- `390 × 844` 移动端真实浏览器回读覆盖 `/`、`/launchpads/`、`/pair-alpha/`、
  `/pair-v2/`、`/pair-flow/`：5 页均无横向溢出、无 console error，并显示同一套五入口导航。
- collector 与 query 服务均为 `active/running`、`NRestarts=0`、`ExecMainStatus=0`。

## 验证与边界

- 本地 `npm run verify`：格式、lint、类型、309/309 测试、覆盖率门槛和构建全部通过。
- PR #30、#31 的 `verify`、`chain-daily`、`cashcat` 三条 GitHub CI 均全部通过后合并。
- systemd 配置在切换前通过 `systemd-analyze verify`；release 使用原子软链接切换并保留上一版。
- 经济对比快照当前目标日仍为 `2026-09-07`，估值历史目标日为 `2026-09-08`；二者没有混写。
- PAIR V2 当前仍是 `partial`：DexScreener 与 GMGN 覆盖不完整，Alpha 继续只是 Shadow 研究输出。
- 本次没有删除或压缩任何生产数据库；历史库清理需要独立备份、恢复验证与明确授权。
