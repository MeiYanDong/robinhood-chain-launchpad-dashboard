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

当前未获得生产部署授权；因此本文和脚本只是可重复的本地/发布后验证能力，不是生产已经执行或通过的证明。
