# L-05 /start 与 /help Lab

## 三案

### A｜能力 + 四个动作 + 边界（推荐）

先一句定位，列 rank/platform/why/status 与自然语言例子，最后说明只读和完整日。收益是首次用户一次看懂；代价约 500 字符；适合 start/help 共用。

### B｜只列命令

收益是最短；代价是用户不知道 unknown、完整日和非交易边界；适合二次快捷帮助，不作为默认。

### C｜产品故事

收益是品牌感；代价是操作入口靠后；适合发布页，不适合 Bot。

## 决定

confirmed_decision: A。静态生成，不访问 Ledger/LLM；英文帮助后续按 language 用同一结构。

## 最终文本

```text
我是 RHC Launch Ledger，只读查询 Robinhood Chain Launchpad 数据，不连接钱包、不交易。

/rank [1d|7d|30d] [volume|fees|income] [live|all]
/platform <平台> [1d|7d|30d]
/why <指标或平台>
/status

也可以问：最近 7 天哪个平台手续费最高？
排名使用最后闭合 UTC 日；未知不等于 0。数据异常时我会显示截止日和警告。
```

长度远低于 1500 字符。
