# L-04 stale / partial 回答 Lab

## 三案

### A｜警告置顶，保留可用数字（推荐）

先显示刷新失败/stale，再给带 targetDate 的缓存数字。收益是可用与透明兼顾；代价是回答更醒目、更长；适合有 usable cache。

### B｜任何降级都不显示数字

收益是最保守；代价是 partial 仍有可信数据时损失价值；只适合无缓存、合同不兼容或当前值缺失。

### C｜警告放末尾

收益是阅读顺畅；风险是用户转发时截掉警告；不采用。

## 决定

confirmed_decision: A；但 NO_AVAILABLE_DATA/CONTRACT_INCOMPATIBLE 使用 B 的失败关闭。

## 最终模板

```text
⚠ 最近一次刷新失败；下面是上次可用缓存，可能已过期。
最近 1 个完整 UTC 日｜成交量
1. Pons — $5.00K
截止：2026-08-27 UTC（stale）
可继续：/status
```
