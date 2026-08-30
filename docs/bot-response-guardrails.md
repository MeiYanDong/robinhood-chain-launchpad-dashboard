# Bot 回答红线

| 禁令 | 正确行为 | 自动化测试 |
| --- | --- | --- |
| 不把 null 说成 0 | 显示未知原因；显式 0 才显示 $0 | rank/platform/formatter |
| 不把旧数据说成当前 | 回答顶部显示 stale 和 targetDate | status/fault/integration |
| 不把 range 总量排成 platform 榜 | 只排序平台行的请求窗口值 | rank |
| 不把 64 日详情 coverage 冒充请求窗口 | 核心指标来自 overview；detail 只补元数据/快照 | platform |
| 不把 rolling24h 写成 1d | 独立分栏并标明不可直接比较 | platform/formatter |
| 不把 suite-wide 混入可比榜 | 放到不可比观察项或排除 | rank |
| 不声称真实留存/复访 | 只报告聚合查询与错误计数 | telemetry/privacy |
| 不自由编造口径 | why 只读合同与平台策略 | explain |
| 不输出内部异常、URL、路径、Secret | 稳定错误码与用户态文案 | privacy/status/fault |
| 不给买卖、签名或收益指令 | 简短拒绝并给只读查询替代 | parser/formatter |
| 不访问用户给出的 URL | QueryPlan 与 Ledger client 双层拒绝 | query-plan/ledger security |
| 不由 LLM 计算/改写数字 | LLM 只返回 QueryPlan；formatter 使用领域对象 | llm/integration |
