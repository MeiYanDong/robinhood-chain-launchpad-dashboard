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

GMGN 标签负责发现活跃样本，但不能单独充当官方发射归属证明。每次四榜 Top 5 的地址并集必须在
Robinhood Chain 官方 RPC 中命中 LongLauncher 的 `LaunchCreated` 事件：

- LongLauncher：`0x22e99278308b393ea1260859b181ad7e78f5eeed`；
- 起始区块：`8636038`；
- `LaunchCreated` topic0：
  `0xadc6f1f726f7c710f77ec06adc75f3bb964e5be19581b072c67f7b9b4039267b`；
- token 地址位于 `topics[2]`。

任一新入榜候选无法完成核验时，本轮失败并继续提供上次成功快照，不发布未经核验的新榜。已核验归属是
不可变事实，结果写入独立 SQLite 表；后续刷新不重复请求，降低公共 RPC 限流风险。

LongLauncher 合约源码与事件可在
[Robinhood Chain Blockscout](https://robinhoodchain.blockscout.com/address/0x22e99278308B393ea1260859B181AD7E78f5eeED?tab=contract)
复核；官方 RPC 连接信息见
[Robinhood Chain 文档](https://docs.robinhood.com/chain/connecting/)。

## 调度与失败语义

- `robinhood-chain-long-refresh.timer`：每小时第 05、20、35、50 分钟更新实时榜；
- `robinhood-chain-long-daily.timer`：每天 `00:12 UTC` 固化截至北京时间 08:00 的日报；
- GMGN 返回异常、榜单为空、地址重复或候选链上核验失败时，本轮标为 `failed`；
- 公网允许限速后的只读手动刷新，但日报生成路由仅供本机 systemd 调用。
