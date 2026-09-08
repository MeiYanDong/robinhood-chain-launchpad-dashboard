# 发射台指标语言与图表修正上线记录

记录日期：2026-09-08。上线复核：15:13 UTC / 23:13 北京时间。

## 已发布

- 版本：`0.18.1`；发布时提交：`52ef3ae`；release：
  `/opt/robinhood-chain-launchpad/releases/20260908T150113Z-52ef3ae`。
- 回滚 release：`/opt/robinhood-chain-launchpad/releases/20260908T130636Z-c70c302`，版本
  `0.18.0`。
- 正式入口：<https://47.251.99.37/launchpads/>；GitHub 变更：PR #14。

## 用户界面结果

1. 日度交易量不再显示“闭合日”，而是直接写出具体 UTC 日期；7 日、30 日和上线以来窗口也直接展示日期范围与覆盖天数。
2. 平台活跃度统一表述为“相较自身历史常态”，问号说明明确给出分子、分母、最多 90 个历史窗口和至少 30 个样本的门槛；计算方法未改变。
3. PAIR 对比结果统一显示“溢价 / 折价”，并将比较值明确命名为“按 PONS 平台规模折算的 PAIR 参考价”，避免误读成 PONS 币价或未来价格预测。
4. Pons、Long、PAIR 在卡片、表格、图例、曲线和数据点中分别固定为绿、黄、蓝。首页 7 日绝对交易量改为线性坐标，并在曲线末端直接标注平台名和金额。
5. 手机比较卡使用运行时日期生成字段名；修复估值页宽表把页面撑宽以及滚动后问号说明立即关闭的问题。

## 验证证据

- `npm run verify`：格式、lint、类型、275/275 测试、覆盖率门槛和构建全部通过。
- 本地 Chromium：四个发射台任务视图的桌面与 375px 手机流程 7/7 通过；页面级横向溢出为 0。
- 公网 Chromium 使用相同用例复跑 7/7 通过；具体日期、溢价/折价、帮助说明、线性曲线高度与平台颜色均按页面实际 DOM 和计算样式核验。
- 兼容端口 `http://47.251.99.37:4174` 上的固定 20 项只读运行时检查全部返回 200；公网 `/launchpads/` 前缀和其 API 同时返回 200。统一域名根路径的 `/healthz`、`/api/overview` 属于另一产品路由，不作为发射台验证地址。
- 公网 `/`、`/leaders/`、`/launchpads/` 四视图、`/pair-alpha/`、`/pair-flow/`、`/pair-v2/`、`/cashcat/` 与各自关键 API，以及全链 `/api/latest` 共 20 个入口全部返回 200。
- `/launchpads/api/meta` 回读 `appVersion=0.18.1`、`targetDate=2026-09-07`；经济快照 `observedAt=2026-09-08T15:10:21.052Z`，包含 Pons、Long、PAIR，PAIR 对比状态为 `available`。
- collector 与 query 服务均为 `active/running`、`NRestarts=0`、`ExecMainStatus=0`；七个刷新定时器全部 active；切换后 warning 级日志为 0。
- 本地与线上 `package.json`、HTML、JS、CSS、collector 和 query 构建文件的 SHA-256 逐项一致。

## 边界与回滚

- 本次只调整前端信息架构、语言、颜色和图表坐标，不改变交易量、活跃度或 PAIR 相对估值的计算口径，不写历史数据。
- 首次把验证器指向统一 HTTPS 根路径时得到 404；逐项回查确认这是产品前缀边界，不是服务故障。随后按正式 `/launchpads/` 前缀和兼容端口完成全部验证。
- 发布使用原子 `current` 软链接切换和失败自动回滚保护。若后续出现版本级问题，将 `current` 恢复到上述 `0.18.0` release，再重启 collector 与 query；本次未触发回滚。

