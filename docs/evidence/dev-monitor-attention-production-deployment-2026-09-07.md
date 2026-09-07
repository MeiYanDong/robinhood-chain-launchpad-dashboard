# DEV 通知降噪与飞书恢复部署证据 — 2026-09-07

证据级别：部署时 `verified_current`。链上区块、项目数量和未来通知状态会继续变化。

## 根因

1. 旧 Webhook 在 2026-09-06 的飞书业务回读中返回 `19001`，因此被从生产环境安全移除，
   并未冒充“已配置”。本次使用用户再次提供的同一入口，从生产服务器直接发送一条明确标注的
   连接测试，当前返回 HTTP `200`、业务码 `0`。
2. 通知器未配置时虽然不会发送，但旧服务仍把每个候选动作写入 outbox。生产游标正常前进，
   积压行的 `attempts` 全部为 `0`，证明问题不是重试风暴，而是“无通道仍造待办”。
3. 旧策略把 `repeat` / `proven` 创建者的新发币，以及所有高置信买入都视为可通知事件；其中
   大量 Pons v2 / Long 批量发币地址和未归属到已核验发射台的买入占据队列。这是注意力策略
   过宽，不是 1,401 个都同等重要。

## 上线策略

- 未配置 Webhook 时不再写入通知 outbox；项目、创建者和交易事实仍进入独立链上证据表。
- 通知层只接受通过反垃圾门槛的 `proven` 创建者；买入还必须指向已核验发射台代币。
- 同一 DEV 的同类动作默认 60 分钟冷却。
- 信号超过 15 分钟即封存为不可投递，不在 Webhook 恢复后补发。
- 每小时最多投递 6 条信号；每次最多 3 条合并成一条飞书消息。
- 发送失败仍最多重试 5 次并指数退避；飞书业务错误只记录错误码，不记录 Webhook。

## 发布与回滚点

- 生产实例：`robinhood-chain-radar`，实例
  `ceff28ff463440c09d8666b0f081bc7f`，公网 IP `47.251.99.37`。
- 当前 release：`/opt/robinhood-chain-launchpad/releases/20260906T162359Z`，版本 `0.14.1`。
- 上一 release：`/opt/robinhood-chain-launchpad/releases/20260906T155316Z`，版本 `0.14.0`。
- 归档 SHA-256：`270d994b6da0f5ad3eb3bb6fe795b2c34179644d5879363a3ae4abc38b1ee0eb`。
- SQLite 一致性备份：
  `/var/lib/robinhood-chain-launchpad/backups/launchpad-dashboard-20260906T162359Z-attention-r2.sqlite`；
  Node SQLite backup 完成且 `PRAGMA integrity_check` 返回 `ok`。
- 配置备份：
  `/opt/robinhood-chain-launchpad/deploy-backups/20260906T162359Z-attention-r2`。
- 第一次切换中新服务已经监听，但部署守卫误读 `/api/meta` 的 `.version`；实际字段是
  `.appVersion`。守卫按设计自动恢复旧 release、旧 SQLite 和旧环境文件。修正守卫后重新生成
  独立备份并完成第二次切换。

## 队列处理与密钥边界

- 切换时 1,401 条历史未发送记录全部原地标记为 `deliverable=0`，原因
  `pre_attention_policy_backlog`；没有删除 outbox 行，也没有删除项目或交易事实。
- 部署后数据库回读：outbox 总数 `1,401`、封存 `1,401`、当前待发送 `0`、失败 `0`、已发送
  `0`。本次唯一的连接测试不经过生产 outbox，因此不会伪装成真实 Alpha 告警。
- Webhook 仅写入 `/etc/robinhood-chain-launchpad.env`；该文件保持 `root:root`、`0600`，公网
  接口、Git、日志和本证据文件均不包含其值。

## 验收

- 本地 `npm run verify` 通过：格式、Lint、类型检查、构建、`248/248` 测试和覆盖率门槛均
  通过；总行覆盖率 `82.92%`、分支覆盖率 `73.71%`。
- 服务回读：`active/running`、`ExecMainStatus=0`、`NRestarts=0`，`/api/meta` 返回
  `appVersion=0.14.1`。
- `/pair-alpha/`、PAIR Alpha API、DEV 健康 API、`/pair-v2/`、`/pair-flow/`、
  `/launchpads/`、`/leaders/`、`/cashcat/` 和原 `/api/latest` 均返回 HTTP `200`。
- 完整运行时核验通过全部 19 个只读 GET 检查。
- 两次服务器回读从确认区块 `56,122,297` 前进到 `56,122,531`，`observedAt` 同步前进；
  队列仍为待发送 `0`、失败 `0`，证明自治轮询继续运行且旧积压没有反弹。
- 七个 launchpad 数据 timer 全部为 `active`；部署后没有 warning 级主服务日志。

## GitHub 边界

本次生产发布来自当前本地脏工作树。部署时本地 `HEAD` 与已记录的 `origin/main` 都是
`a696cf86015b1e0cfe976068b51c3ff95fc53e81`；本次更改尚未 commit 或 push，生产上线不能当作
GitHub 已同步的证据。
