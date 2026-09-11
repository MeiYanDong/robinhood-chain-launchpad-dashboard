# RHC Launch Ledger 运行时只读验证

## 目的

发布后用固定 GET 请求确认服务、可用缓存、30 日概览和来源状态。脚本不会调用 `POST /api/refresh`，不会改数据库，也不会替代 systemd、Nginx 或真实发布回执。

## 本地执行

先启动待验证版本，再运行：

```bash
npm run build
RUNTIME_BASE_URL=http://127.0.0.1:4174 npm run verify:runtime
```

成功条件：进程退出码为 0，输出 `ok: true`，并列出 `/healthz`、`/api/overview?window=30` 和 `/api/sources` 三项检查。任何连接、HTTP 状态、JSON、合同或 readiness 错误都会以非零退出码失败关闭。

## 与 systemd 发布流程的关系

生产部署仍使用 `deploy/robinhood-chain-launchpad.service`、独立持久化目录和 Nginx 反向代理。获得 GATE-08 的生产授权后，发布流程必须依次保存版本与回滚点、切换不可变 release、回查 systemd/Nginx、运行本脚本，并另行验证原有链级雷达没有回归。

生产热库验收不得直接运行全量 `PRAGMA quick_check` 或 `PRAGMA integrity_check`。即使是只读扫描，
也可能在资源受限的 SWAS 上长期占用磁盘 IOPS，令 HTTP、TLS 和 Cloud Assistant 同时失去响应。
部署窗口只做固定端点合同、SQLite 只读打开与轻量 schema 查询；确需完整检查时，先制作一致性副本，
在隔离环境运行，或安排明确停机维护窗口。

是否执行生产部署以当前任务的明确授权为准；本文和脚本只是可重复的本地/发布后验证能力，
脚本存在本身不代表生产已经执行或通过。
