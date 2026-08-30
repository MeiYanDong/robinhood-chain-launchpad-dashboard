# ADR-0001：公开仓库与 Secret 边界

- 状态：Accepted
- 日期：2026-08-30
- 决策者：项目所有者

## 背景

RHC Launch Ledger 需要可审查的公开代码库，为后续 DeBox Bot 演示、协作与 Grant 材料提供可核验证据。公开仓库同时扩大了凭证、运行数据和个人信息误提交的风险。

## 决策

项目使用公开仓库 https://github.com/MeiYanDong/robinhood-chain-launchpad-dashboard 。源码、公开技术文档、匿名 fixture、部署模板和锁文件允许提交；真实 Secret、环境文件、SQLite、日志、浏览器会话、覆盖率、构建产物和运行输出不得提交。

真实 DeBox App Key/Secret、模型密钥与生产配置的接收和配置仍受 GATE-07、GATE-08 约束。公开项目不等于授权创建 Bot、部署或对外提交。

## 后果

- 每次推送前必须检查暂存文件和候选凭证。
- fixture 必须是人工构造或充分匿名的数据。
- 文档只能记录 Secret 所在位置、负责人和轮换状态，不能记录值。
- 若发生泄露，删除 Git 文件不等于完成处置；必须先撤销/轮换，再清理历史并记录事件。

## 验证

- docs/evidence/pre-implementation-baseline.md 保存首次扫描范围与结果。
- .gitignore 固化本地运行产物边界。
- GitHub visibility 读回为 PUBLIC。
