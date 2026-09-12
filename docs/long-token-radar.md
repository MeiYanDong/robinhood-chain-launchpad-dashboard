# Long 代币雷达

## 用户可见结果

Long 页面与 PAIR 页面使用同一组四维 Top 5：

- 市值；
- 流动性池深度；
- 滚动 24H 交易量；
- 持币地址数。

四张榜独立排序，不计算综合分。页面上的“活跃样本”不是 Long 历史发射总量。

## 数据合同

市场与持币数据由固定版本的 `gmgn-cli` 读取：

```text
gmgn market trending --chain robinhood --interval 24h --limit 100 \
  --platform longxyz --order-by volume --direction desc --raw
```

只接受 `launchpad_platform = longxyz` 且地址格式有效的行。字段映射为：

| 展示指标 | 输入字段 |
| --- | --- |
| 市值 | `market_cap` |
| 流动性池深度 | `liquidity` |
| 24H 交易量 | `volume` |
| 持币地址 | `holder_count` |

默认经济活跃门槛为市值至少 `$10,000`、流动性至少 `$1,000`。缺失值保持未知。

## Long 归属核验

GMGN 标签负责发现活跃样本，但不能单独充当官方发射归属证明。采集器会把本轮全部地址提交给
Long 官方 GraphQL `Asset` 索引，并同时限定：

- `chain_id = 4663`；
- `integrator_address = 0x92d435c96e63c43e12d6d0ab28f6b0b04072f765`；
- `asset_address` 必须等于候选代币地址。

只有官方索引返回的地址才进入本地四榜。GMGN 错标或尚未被官方索引确认的行会被跳过；官方 GraphQL
本身不可用时，本轮失败并继续提供上次成功快照。该口径不绑定单一 Launcher 合约，因此 Long 更换
发射路由后不会把新版本代币误判成非 Long，也不再用大区间 `eth_getLogs` 触发公共 RPC 限流。

官方 GraphQL 同时是平台日交易量用于核验 Long 资产归属的来源；代币榜与平台经营因此共用同一
integrator 边界，但市场价格、市值、流动性和持币地址仍来自 GMGN，二者不会混写。

## 调度与失败语义

- `robinhood-chain-long-refresh.timer`：每小时第 05、20、35、50 分钟更新实时榜；
- `robinhood-chain-long-daily.timer`：每天 `00:12 UTC` 固化截至北京时间 08:00 的日报；
- GMGN 返回异常、榜单为空、地址重复或官方归属源失败时，本轮标为 `failed`；
- 公网允许限速后的只读手动刷新，但日报生成路由仅供本机 systemd 调用。
