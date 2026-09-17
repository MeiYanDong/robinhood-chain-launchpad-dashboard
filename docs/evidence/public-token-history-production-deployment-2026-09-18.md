# PAIR / PONS 平台币历史与销毁账本生产部署证据（2026-09-18）

本文记录发布窗口内的只读回读。价格、成交额、销毁和回购数据会继续变化，不能把文中的点时值
当作未来值或交易承诺。

## 发布对象

- 应用版本：`0.26.0`。
- GitHub：[PR #53](https://github.com/MeiYanDong/robinhood-chain-launchpad-dashboard/pull/53)；
  生产代码提交 `40d57e1631fccf36a695845fb0b240b78099f571`。
- release：`/opt/robinhood-chain-launchpad/releases/20260917T170245Z-40d57e1`。
- 直接回滚点：`/opt/robinhood-chain-launchpad/releases/20260912T162413Z-597e040`，版本
  `0.25.2`。
- 目标实例：`robinhood-chain-radar`，`us-west-1`，实例 ID
  `ceff28ff463440c09d8666b0f081bc7f`，公网 IP `47.251.99.37`。

## 数据边界

- PAIR 与 PONS 平台币日成交额来自 GMGN 日线。PAIR 平台币自身成交额没有冒充 PAIR 发射台
  全部项目的总成交额；后者仍按原平台来源独立展示，缺失时保持未知。
- 供应量读取只使用 Robinhood Chain 官方公共 RPC
  `https://rpc.mainnet.chain.robinhood.com`。经济历史与资金闭环配置不再继承付费 RPC 环境变量。
- 销毁按转入 `0x000000000000000000000000000000000000dEaD` 的公开 ERC-20 转账统计，
  来源为公共 Blockscout API。
- PONS 回购是已识别钱包行为归因；PAIR 回购来自资金闭环逐笔链上账本。回购结果估值等于
  `回购代币数量 × 当日收盘价`，不是实际花费。
- Blockscout、GMGN 或公共 RPC 失败时继续使用有时间戳的已保存数据；没有覆盖的日期保持
  `null`，不补零，也不切换到付费 RPC。

## 发布窗口数据回读

- GMGN PONS 日线：`67` 个点，状态 `ok`。
- GMGN PAIR 日线：`20` 个点，状态 `ok`。
- 官方公共 RPC 供应量：状态 `ok`。
- Blockscout 销毁历史：状态 `ok`，保存 `33` 个代币日记录。
- 最近完整 UTC 日为 `2026-09-16`：PAIR 平台币成交额 `$892,733.32768998`，收盘价
  `$0.004204756`；最近 7 个完整 UTC 日成交额合计 `$9,490,873.041654525`。
- 同日 PAIR 销毁 `1,715,598.5857035783` 枚，累计销毁
  `115,390,848.57816993` 枚；PONS 销毁 `804,918.9200569588` 枚，累计销毁
  `312,793,918.6729093` 枚。
- PAIR 同日可归因回购 `570,353.1102179748` 枚；按当日收盘价计算的结果估值约
  `$2,398.20`，该值不代表链上实际支付金额。
- PAIR 销毁历史返回 `127` 条转账并覆盖完整历史。PONS 达到公共接口单次上限 `10,000`
  条，最早覆盖到 `2026-09-04`；本页 7 日窗口完整，但更早日期不会被宣称为完整历史。

## 验收与运行状态

- 本地 `npm run verify` 通过格式、lint、类型、覆盖率门槛、生产构建与 `328/328` 项测试。
- GitHub CI 的 `verify`、`chain-daily`、`cashcat` 三项检查全部通过后，PR #53 以 squash
  方式合并。
- 公网 `verify:runtime` 于 `2026-09-17T17:11:03.012Z` 完成 `23/23` 个只读合同检查，
  全部 HTTP 200；`/api/meta` 回读 `appVersion=0.26.0`、`targetDate=2026-09-16`。
- 真实 Chromium 回读了 7/30 日、销毁/归因回购、数量/比例/结果估值切换；控制台为
  `0 errors`。390px 视口中 `bodyScrollWidth=390`，宽表只在自身 342px 容器内滚动。
- 主服务和查询服务均为 `active/running`、`NRestarts=0`、`ExecMainStatus=0`；七个采集
  定时器与存储维护定时器均为 `active`。
- 发布后根分区使用率 `24%`，约 `29 GB` 可用。

## 发布与回滚边界

部署通过 Cloud Assistant 完成独立 staging、生产构建、原子 `current` 软链接切换和失败自动
回滚保护。数据库、`/etc/robinhood-chain-launchpad.env`、Webhook 与钱包权限均未改动。
若发生版本级故障，将 `current` 原子切回上述 `0.25.2` release，恢复已备份的 systemd unit，
再重启主服务和查询服务；旧 release 仍完整保留。
