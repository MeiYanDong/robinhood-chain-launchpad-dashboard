# 查询隔离与 PAIR 配对资产生产部署｜2026-09-07

- 证据等级：`verified_current`
- 版本：`0.15.0`
- release：`/opt/robinhood-chain-launchpad/releases/20260907T084119Z`
- 目标实例：`robinhood-chain-radar`（`47.251.99.37`）

## 本次上线内容

- PAIR 普通榜、PAIR V2、PAIR Alpha 与项目方发行列表显示官方池子的底层配对资产；同一资产按地址去重，地址只在详情提示中展示。
- 公网查询进程监听 `127.0.0.1:4175`，采集进程监听 `127.0.0.1:4176`，Nginx 继续只暴露既有 HTTPS 入口。
- PAIR V2、PAIR Alpha 与 DEV 高频表使用独立 `monitor.sqlite`；原始大型数据库保留，不做物理删除。
- 异常零成交量保留原始观测并标记待核验，不进入三平台份额或估值派生。
- 经济模块链上读取可使用既有的服务端私密 RPC 作为失败回退；凭证只存在 root 管理的 drop-in，不进入 release、日志或公开仓库。

## 验收读回

- 本地完整质量门禁：`260` tests passed；format、lint、typecheck、build 与 coverage 通过。
- 内网运行合同：`19/19` 通过。
- `robinhood-chain-launchpad.service` 与 `robinhood-chain-query.service` 均为 `active`，`NRestarts=0`。
- PAIR V2 健康接口持续返回 `200`、`stale=false`，后台监控状态为 `running`。
- 公网 `/pair-v2/` 与 `/launchpads/` 返回 `200`。
- 公网 PAIR 榜单已读回真实配对资产，例如 `PAIR → SPY`、`CINEMA → AMC`、`CHIPS → NVDA / AMD / INTC / MU`。
- PAIR V2 当前样本已读回 `牛来 → BULL`、`PEG → USDG`、`BALD → AAPL / AMZN / CRCL`、`asd → WETH / SPY`。
- 生产监控库约 `313 MiB`；原约 `6.7 GiB` 数据库保留作为历史与回滚证据。
- 经济模块备用 RPC 故障注入读回成功；09:17 UTC 后相对估值恢复。该读回证明回退链路可用，不等于所有上游来源均完整。

## 边界与回滚

- 本次没有创建节点、购买额度、启用超额计费、删除旧数据库或暴露新公网端口。
- 看板为只读研究工具，不读取钱包、不签名、不广播交易。
- 如需回滚，先停止唯一 writer；若新监控库已有新增游标或 outbox，必须使用 `scripts/restore-monitor-database.py` 合并运行状态后再切回旧 release。

