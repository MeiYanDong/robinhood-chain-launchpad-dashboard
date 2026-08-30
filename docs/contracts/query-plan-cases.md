# QueryPlan v1 校验样例

## 合法

```json
{"version":1,"action":"rank","windowDays":7,"metric":"fees_usd","platformId":null,"scope":"live","explainTopic":null,"language":"zh-CN","needsClarification":false,"clarificationReason":null}
```

预期：通过。

## 缺字段

去掉 language。预期：QUERY_PLAN_INVALID；不得补默认后继续查询。

## 未知字段

加入 url、method、sql、shell、filePath 或 tool 任一字段。预期：additionalProperties=false，QUERY_PLAN_INVALID。

## 注入

把 platformId 写成 `https://evil.example`、`../../refresh` 或 SQL 片段。预期：pattern/业务校验失败；不得访问网络或工具。

## 业务冲突

- rank + revenue_usd：拒绝；默认榜只允许三项核心指标。
- status 携带 platformId：拒绝。
- needsClarification=true 但 clarificationReason=null：运行时业务校验拒绝。
