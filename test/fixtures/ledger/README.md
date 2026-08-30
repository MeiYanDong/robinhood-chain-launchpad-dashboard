# Ledger fixture 目录规格

> Phase 0 设计稿。Phase 1 将每个场景落为 JSON；所有数值均为人工 fixture，不是生产数据。

## Endpoint 文件

每个场景目录固定包含：healthz.json、meta.json、overview-1.json、overview-7.json、overview-30.json、platform-letscash.json、coverage.json、sources.json。需要平台差异时增加 platform-{id}.json，不增加任意 endpoint。

## S-01 normal

- targetDate=2026-08-29，stale=false，runStatus=success，合同 v1。
- 五个可比 live 平台的 1d volume：Pons 5000、LetsCash 3000、Long 3000、Bankr 0、Flap null。
- tie 由规范名称排序：LetsCash 在 Long 前。
- 7d fees：Pons 700、LetsCash 350、Long null、Bankr null、Flap 70。
- LetsCash 30d：volume 12000、fees 600、protocol_revenue 36；detail 另含 rolling24h volume 900，不得替换 30d。
- 唯一期望：默认榜 Pons、LetsCash、Long、Bankr；Flap 是缺数摘要，不补第五名。

## S-02 zero-null-suite

- Bankr volume=0 且 observedDays=1，必须进入排名。
- Flap fees=null + SOURCE_NOT_REPORTING，不进入数值排序。
- StonkBrokers volume=9000、comparability=suite_wide、excludeFromTotals=true；live 榜排除，all 模式放入不可比观察项。

## S-03 partial

- runStatus=partial；LetsCash quality=derived，Pons=scope_mismatch；一个 source=degraded。
- 预期回答 status=degraded，数值可展示但警告顺序固定。

## S-04 stale-with-cache

- health.ok=true，overview.stale=true，targetDate 落后；latestRun=failed、usableRun=success。
- 预期先提示最近刷新失败，再提示 stale；保留缓存数字和准确 targetDate。

## S-05 no-current-value

- 只有旧 detail series，overview 请求窗口 value=null。
- 原因 STALE_WITHOUT_CURRENT_VALUE；不得拿旧 series 补当前窗口。

## S-06 no-cache

- health.ok=false、latestRun=failed、无 usableRun。
- rank/platform/why 返回 unavailable 且无数字；help 可用，status 受限可用。

## S-07 version-incompatible

- meta.apiContractVersion=2。
- 预期 VERSION_NOT_AVAILABLE；除 help/受限 status 外均失败关闭。

## S-08 schema-drift

- 变体 A 缺 coreMetrics；B 把 platforms 变为对象；C 增加未知字段。
- A/B 为 CONTRACT_INCOMPATIBLE；C 可忽略但不得开启能力。

## S-09 rolling-conflict

- 用户请求 24h rank：不请求 overview，不静默变 1d，只澄清。
- 用户请求 LetsCash 24h：仅在 detail 有 rolling_24h 时单独展示，并标明不能与完整日榜混比。

## S-10 source-failed

- 某来源 message 含内部 URL/诱饵 Secret；公开回答只能显示稳定来源失败文案。

## 用例映射

| 用例 | 场景 |
| --- | --- |
| UC-01 | 静态 help，无 Ledger |
| UC-02/03 | S-01、S-02 |
| UC-04 | S-09 |
| UC-05 | S-01、S-03 |
| UC-06 | S-02、S-05 |
| UC-07 | S-01 + fake clock/context |
| UC-08 | S-04 |
| UC-09 | S-06 |
| UC-10/11 | 输入安全 fixture，不访问 Ledger |
| UC-12 | DeBox replay fixture + S-01 |
