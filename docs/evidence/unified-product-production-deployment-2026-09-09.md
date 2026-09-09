# 统一产品生产上线记录

记录日期：2026-09-09。最终公网复核：2026-09-09 04:06–04:08 UTC。

## 已发布

- 版本：`0.20.0`。
- 功能合并：PR #16，主分支提交 `61dfd169af4ba6e2625254214a87cba8396b8092`。
- 路由补丁：PR #17，最终生产提交 `0364bd913678df115e7281cc50c75f8f0279b7ea`。
- 当前 release：`/opt/robinhood-chain-launchpad/releases/20260909T040345Z-0364bd9`。
- 统一入口：<https://47.251.99.37/>；一级任务为 `/market/`、`/alpha/`、
  `/assets/cashcat/`。
- 原 `/leaders/`、`/launchpads/`、`/pair-alpha/`、`/pair-v2/`、`/pair-flow/`
  深度页继续可用。

功能发布包 SHA-256 为
`a88fd99e1cea069925b10eb516ee4908abd0a6c9a36c105df71ded228b7ed3bd`；最终路由补丁包
SHA-256 为 `3395778d8d52062a65dc8615caeaa3e88be5bd73a438184c71980e9822729b56`。

## 产品与工程边界

1. 首页依次回答全链状态、结构龙头和 CashCat 核心前提；市场、Alpha、资产页分别展开
   证据，不再把两个独立站点并排链接当作“整合”。
2. `/api/product/today` 是公开只读组合合同。全链完整 UTC 日、CashCat 实时快照和龙头热度
   混合读模型保留各自日期、状态和 stale 标记；缺失值不补成 `0`。
3. 全链与 CashCat 的可维护源码已进入同一 GitHub 仓库和 CI，但生产服务、数据库、凭证、
   调度与故障域继续独立。本次没有合并或删除任何生产数据库，也没有改写两套采集器。
4. 原 CashCat 首页重定向到统一资产页；`/cashcat/api/*` 和 `/cashcat/reports/*` 仍直达独立
   CashCat 服务，保留原始日报与健康证据。

## 验证证据

- 主项目 `npm run verify`：格式、lint、类型、285/285 测试、覆盖率门槛和构建全部通过。
- 全链独立服务：类型检查、17/17 测试和构建通过；CashCat：36/36 测试通过。
- PR #16 和 #17 的 `verify`、`chain-daily`、`cashcat` 三条 GitHub CI 均通过。
- 最终 release 在服务器内部通过 22/22 个固定只读运行合同；公网再次通过同一套 22/22
  合同，`/api/meta` 回读 `appVersion=0.20.0`。
- 公网根页、三个一级任务、五个旧深度页、CashCat API/日报证据、全链 latest/history 和带
  日期的 snapshot 均返回 HTTP 200。`/api/snapshot` 本来就要求 `date=YYYY-MM-DD`；裸路径
  返回参数错误，不计为回归。
- 全新 Chromium 会话实际打开今日、市场、Alpha、CashCat 与旧发射台页，页面标题和任务内容
  正确，控制台 error/warning 为 0。375px 下首页与资产页的 `scrollWidth` 均等于 375。
- collector、query、CashCat 与 Nginx 均为 `active/running`、`NRestarts=0`；七个业务 timer
  全部恢复 active；query 预热缓存 28 个固定 GET 路径。

首次公网矩阵如实暴露过一个入口回归：Nginx 将旧前缀改写为 `/` 后，服务误把旧深度页当成
新首页。该版没有被记为完成；新增 `X-Forwarded-Prefix` 回归测试、通过 PR #17 并重新发布后，
五个旧深度页恢复，才完成最终验收。

## 当前数据状态与限制

- 上线时统一合同为 `partial`，不是全数据成功。全链独立服务止于 `2026-09-07`，落后于最近
  完整 UTC 日 `2026-09-08`，且有 5 个来源失败，因此首页明确显示“暂不下结论”。
- CashCat 调度器继续在服务器运行，但最终回读的服务状态为 `ERROR`、实时证据为 `PARTIAL`；统一资产页
  不会在此状态下制造价格、排名或持币地址结论。
- 主机仍约 1.6 GiB 内存、无 swap；collector 约 859 MB，query 约 59 MB，CashCat 约
  260 MB。功能整合没有合并运行进程，不能把统一导航理解为完整故障隔离。
- 磁盘使用率约 90%，剩余约 4.0 GiB。本次只增加两个小型不可变 release，没有删除任何旧
  release、数据库或证据文件。

## 回滚

- Nginx 回滚副本：
  `/opt/robinhood-chain-launchpad/deploy-backups/20260909T035154Z-61dfd16-unified-product`。
- 路由补丁前的 release：
  `/opt/robinhood-chain-launchpad/releases/20260909T035154Z-61dfd16`。
- 完整撤销统一产品时回到 `0.19.3`：
  `/opt/robinhood-chain-launchpad/releases/20260908T204706Z-6214e29`，并恢复上述 Nginx
  副本后执行 `nginx -t` 与 reload。

当前未触发回滚。
