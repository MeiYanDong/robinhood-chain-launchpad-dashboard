# RH Launch Ledger 同机服务器只读预检｜2026-08-31

- 证据等级：`verified_current`
- 目标：确认 RH Launch Ledger Bot 是否可以与 Robinhood Chain Launchpad 同机隔离部署
- 边界：只读控制面、Cloud Assistant 与 HTTP 检查；没有上传文件、创建用户、写配置、安装服务、重启服务或读取 Secret

## 目标身份

- 产品名称：`RH Launch Ledger`
- SWAS 实例：`robinhood-chain-radar`
- Region：`us-west-1`
- Instance ID：`ceff28ff463440c09d8666b0f081bc7f`
- 公网 IP：`47.251.99.37`
- 控制面状态：`Running`、`BusinessStatus=Normal`、Cloud Assistant `Status=true`
- 规格：2 vCPU、2 GiB RAM、40 GiB ESSD、200 Mbps 峰值带宽
- 计费：预付费；控制面显示到期时间 `2026-09-24T16:00:00Z`

到期日属于持续运行风险。封闭试用可以使用此机，但若要跨过到期日继续运行，必须由用户处理续费或另行决定迁移；本次没有执行购买或续费。

## 远端只读预检

Cloud Assistant invocation：`t-usw6vkiq1vo7uv4`，状态 `Success`，退出码 0。

| 项目 | 当前结果 |
| --- | --- |
| Node.js | `v22.23.2` |
| 根盘 | 40G 总量、5.3G 已用、32G 可用、15% 使用率 |
| 内存 | 1613 MiB 总量、852 MiB 已用、760 MiB available |
| Launchpad service | `active` |
| Refresh timer | `active` |
| 当前 release | `/opt/robinhood-chain-launchpad/releases/20260830T035333Z` |
| Loopback `/healthz` | HTTP 200 |
| Bot service | 不存在 |
| Bot system user | 不存在 |
| Bot app path | 不存在 |

当前监听保持为原有边界：loopback `4173`、`4175`，公网 `80`、`4174`。没有为 Bot 新增端口。

第二次只读 invocation `t-usw6vkj1q9p105c` 同样为 `Success`、退出码 0：

- systemd 255；
- NTP 时间同步为 `yes`；
- journald 为 `active`；
- `/opt`、`/var/lib`、`/etc` 均为 `755 root:root`，计划目录尚不存在，实际部署时必须显式创建并验证最小权限；
- Ledger 固定路由返回：overview 1/7/30、coverage 30、sources 均为 HTTP 200；
- `/api/meta` 返回 HTTP 404。

## 公网无回归读回

以下四项均返回 HTTP 200：

- `http://47.251.99.37:4174/healthz`
- `http://47.251.99.37:4174/api/overview?window=30`
- `http://47.251.99.37:4174/api/sources`
- `http://47.251.99.37/api/latest`

## 部署判断

- 目标主机身份与 README 记录一致，现有服务健康。
- 磁盘余量充足；760 MiB 可用内存支持先试运行一个受限的文本 Long Polling Node 进程，但必须设置资源上限并观察峰值，不能据此承诺长期容量。
- 当前线上 Ledger `0.3.0` 缺少 Bot 的启动合同 `/api/meta`。按既定 fail-closed 设计，Bot 会保持 `not_ready`，因此不能在这个版本上宣称成功部署。
- 计划继续使用独立 `rhc-launch-ledger-bot.service`、低权限用户、独立 state 目录和 localhost-only health；不新增 Nginx、TLS 或防火墙端口。
- 回滚基线是“Bot service/user/path 均不存在”。若新服务部署失败，停止并禁用新服务、撤销新 release/current 和独立 Bot 状态，不修改或回滚原 Launchpad release。

## 尚未部署的原因

真实运行包仍缺以下前置：

- 专用 DeBox 账号与实际 Bot；
- 完整身份确认（头像、简介、支持入口）；
- 不可删除 Bot 的创建授权与配额检查；
- DeBox SDK/OpenAPI 路线锁定；
- 真实 App Key/Secret 的安全配置授权；
- 真实 LLM 关闭或启用的明确选择。
- 上线 Ledger 必须先提供并通过 `/api/meta` 生产读回；是否升级现有 Launchpad 属于另一项生产变更，不能从 Bot 部署授权中自动推断。

因此本次完成的是目标确认和 P2-038 只读预检，不是 Bot 部署或上线回执。
