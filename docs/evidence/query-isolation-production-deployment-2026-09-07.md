# 三平台数据可靠性与查询隔离上线记录

记录日期：2026-09-07。最后运行复核：09:25 UTC / 17:25 北京时间。

## 已发布

- 版本：0.15.0；release：`/opt/robinhood-chain-launchpad/releases/20260907T084119Z`。
- 前一 release：`20260907T083805Z`；恢复材料：`/opt/robinhood-chain-launchpad/deploy-backups/20260907T084119Z-isolation`。
- 发布包 SHA-256：`29beb56e9865213c3a4da8358f1d2d99c87a154b46ec371f5f48b6defeac42f2`。
- 本地工作树包含既有未提交修改及并行任务的 PAIR 计价资产展示改动；发布使用文件哈希清单，未声称 Git 提交或远端同步完成。
- 正式访问入口：<https://47.251.99.37/launchpads/>。

## 改动与数据保护

1. 独立 query 进程监听 4175，collector 改为 4176。查询服务不读取来源凭证或数据库；缓存过期、超时和容量不足明确返回 503。
2. 高频 PAIR V2/Alpha/DEV 表迁入 monitor.sqlite。迁移时复制 1,043,635 条数值历史记录，校验逐表行数、外键及完整性。活动库最初约 313 MB；历史 payload 改为 `{}`，回放数值字段、事件、信号及完整当前状态保留。
3. 原库约 6.7 GB 保留，核心模块仍使用它。没有删除旧的完整历史 JSON；这不是磁盘空间回收。最终磁盘使用率约 82%，可用约 6.8 GB。
4. Pons 大额成交后骤降为零的值进入待核验状态，保留原值但不参与计算。过期市场值标记未知，Long 样本不代替平台总量。
5. 经济供应量采集增加现有 Chainstack 节点备用通道，仅在主通道失败时使用，并核验链 ID 与固定区块。无新增节点、订阅或 PAYG 开通；使用既有配额，未据此断言没有边际费用。
6. 通知状态与游标迁移；恢复脚本会合并新写入，避免简单切回旧游标造成遗漏或重复通知。操作步骤见 ../runbooks/query-isolation.md。

备用环境文件为 `/etc/robinhood-chain-economics-rpc.env`，root 0600，通过 collector 的 `25-economics-rpc.conf` drop-in 读取。私有 URL 不进入源码、浏览器或本文。公开 RPC 仍为主通道；备用限于经济供应量采集。

## 验证证据

- `npm run verify`：格式、lint、类型检查、260/260 测试、覆盖率和构建通过；`git diff --check` 通过。
- 首次上线 08:42 UTC：内部查询入口 19/19 运行合同通过。
- 配置备用通道后 09:25 UTC：内部查询入口再次 19/19 通过；此次探针允许 15 秒，实际各接口响应头耗时 2–612 ms。它验证接口合同，不等于三个平台的数据完整。
- Cloud Assistant 运行复核收据：`t-usw6wc2u2v8an7k`，退出码 0。
- 真实备用故障注入收据：`t-usw6wc27vgjmry8`。仅注入主通道失败，真实备用完成 8 次请求，约 480 ms，固定区块 `0x3617e63`；两项供应量可读。
- HTTPS 公开经济健康接口：HTTP 200，`snapshotFresh=true`、`valuationReady=true`、`platformDataComplete=false`。
- 公开 DEV 健康接口：09:25:11 UTC 观测，HTTP 200，`status=success`，确认区块 56725149，pending=0、failed=0；相比 09:22 的 56723287 游标继续前进。
- 浏览器实际确认 Pons 展示“未知 / 待核验 / 来源原值 $0.00 · 不参与计算”；检查时无浏览器 error/warn。
- monitor 当前看板检查点仅 1 行，最新历史 payload 长度 2。collector、query 均 active，检查时无自动重启。

## 尚未消除的限制

- 三平台同日数据仍为 partial：Pons 异常零值待上游核验；Long 官方平台总量请求遭拒；PAIR 最新完整日迟到。版本升级不制造缺失数据。
- 本轮 09:18–09:24 UTC 期间两次观察到 DEV 查询 503，另一次默认 5 秒运行探针超时；之后恢复。主机同时出现 Chrome 工作负载、进程 I/O 等待及约 31% 瞬时 iowait。资源争用是线索，未证明是唯一根因，不声明已根治偶发超时。
- query 与 collector 已分进程，但仍共享主机；collector 各采集模块仍共享进程。缓存超过 20 秒即失败，短期隔离不能替代独立主机的故障域。
- 旧 HTTP 4174 路径曾有未压缩响应截断/超时；已验证 HTTPS 正式入口返回完整 JSON。标准运行脚本按 origin 构造路径，不能直接将带 `/launchpads/` 的 URL 当作完整前缀验证；本记录未将错误路径探针算作公开 19 项通过。

本版已完成发布和有限窗口运行核验，不是长期可用性证明。新增付费资源、历史数据物理清理不在本次执行范围。
