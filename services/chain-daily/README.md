# Robinhood Chain 日度雷达

一个独立、只读的 Robinhood Chain 综合数据监控器。它每天读取最后一个已结束的 UTC
自然日，对比 Base、Arbitrum、Optimism、World Chain、Plume，并生成：

- 中文私有看板；
- Markdown 日报；
- 可审计的标准快照、原始响应和来源回执。

它没有钱包、签名、交易构造、广播或发币路径，也不会读取旧 Bankr API Key。

## 看什么

- 使用：日交易数、日活地址、Gas/s、中位交易成本；
- 资本：稳定币供应、TVS、DeFi TVL；
- 经济：用户支付 Gas、L1/DA 成本、链上利润、应用收入；
- 市场：DEX 成交量、协议费用、协议收入；
- RWA：活跃股票代币数、基于报价与 `totalSupply()` 的估算代币化价值；
- 健康：官方状态、RPC chain ID、Blockscout 统计。

看板不制造单一综合分，而是分别回答四件事：市场位置、自身趋势、增长质量和数据可信度。
每张指标卡都带实际数据日、新鲜度、7/30 日变化、同日同行排名、全部 L2 分位和来源。
“强”只表示生态基本面在横向位置与自身趋势上得到共同确认，不是代币估值或投资信号。

## 数据来源

| 来源 | 用途 |
|---|---|
| [Growthepie](https://www.growthepie.com/) | 链级日度基本面、固定同屏和已跟踪扩容链分位 |
| [DefiLlama](https://defillama.com/) | DeFi TVL、DEX 量、协议费用和协议收入 |
| [Robinhood Stock Token API](https://docs.robinhood.com/crypto/robinhood-chain/stock-token-api) | 官方股票代币资产与报价 |
| [Robinhood Chain RPC](https://rpc.mainnet.chain.robinhood.com) | chain ID 和股票代币 `totalSupply()` 只读调用 |
| [Robinhood Chain Status](https://status.robinhoodchain.offchain.io/) | 官方可用状态 |
| [Blockscout](https://robinhoodchain.blockscout.com/) | 链级统计核验 |

完整定义、区别与限制见 [docs/data-methodology.md](docs/data-methodology.md)。

## 快速开始

要求 Node.js 22 或更新版本。

```bash
npm install
npm run daily
npm run serve
```

然后打开 [http://127.0.0.1:4173](http://127.0.0.1:4173)。服务默认只监听本机，
不会自动暴露到局域网或公网。

## 当前云端部署

截至 2026-08-24，生产实例是阿里云轻量应用服务器
`robinhood-chain-radar`（`us-west-1`，实例 ID
`ceff28ff463440c09d8666b0f081bc7f`）：

- 公网看板：[http://47.251.99.37/](http://47.251.99.37/)；
- Nginx 监听公网 `80`，反向代理到只监听 `127.0.0.1:4173` 的 Node 服务；
- 按用户决定，看板无需登录；当前使用 HTTP，没有 TLS；
- `robinhood-chain-radar.service` 运行看板；
- `robinhood-chain-radar-daily.timer` 每天北京时间 15:00 触发采集；
- 发布目录是 `/opt/robinhood-chain-radar/current`，持久化数据在
  `/var/lib/robinhood-chain-radar/`。
- 同一实例上的发射台看板独立运行在
  [http://47.251.99.37:4174/](http://47.251.99.37:4174/)，使用
  `robinhood-chain-launchpad.service` 与
  `robinhood-chain-launchpad-refresh.timer`，不会占用原 `4173` 后端；部署口径见
  [`launchpad-dashboard/README.md`](launchpad-dashboard/README.md)。

发布后必须同时验证公网首页和 `/api/latest` 返回 `200`，不能只以 Nginx 配置检查或
服务器内网回读作为上线成功证据。

## 命令

```bash
npm run collect                         # 只采集 T-1
npm run report                          # 从最新快照重建日报
npm run daily                           # 采集 + 日报
npm run serve                           # 本地看板
npm run collect -- --date 2026-08-23   # 指定目标日
npm run serve -- --port 4174            # 指定端口
npm run check
npm test
npm run build
```

推荐每天北京时间 15:00 执行 `npm run daily`，让上游有时间完成 T-1 回填。

## 输出

```text
data/
  latest.json                 最新标准快照
  snapshots/YYYY-MM-DD.json   目标日快照
  raw/<run-id>/*.json.gz      本次原始 API / RPC 响应（gzip）
reports/
  latest.md                   最新中文日报
  YYYY-MM-DD.md               目标日日报
```

这些运行产物默认不提交。文件通过临时文件 + 原子替换写入；上游失败会留下失败回执并把
对应指标标为 `UNKNOWN`，不会用旧值假装当天采集成功。

## 可选配置

程序不会加载 `.env` 文件，只读取启动进程显式提供的环境变量：

```text
ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com
RADAR_HOST=127.0.0.1
RADAR_PORT=4173
```

如果 RPC URL 包含凭证，持久化错误和来源链接会清洗凭证。不要把真实密钥写进仓库。

## 旧项目证据

旧发射器的源码、测试、构建产物和 npm 命令已移除。`runs/`、旧 CSV / JSON 输入、图片和
本机 `.env` 暂时保留为历史证据，新程序不会读取它们。边界见
[docs/legacy-launcher-artifacts.md](docs/legacy-launcher-artifacts.md)。
