# Cash Cat Sentinel

独立、只读的 Robinhood Chain / Cash Cat 投资前提监控器。它不会读取签名私钥，没有买卖、下单、撤单或发币接口。

调研依据见 [RESEARCH.md](RESEARCH.md)，完整规则见 [METHODOLOGY.md](METHODOLOGY.md)，日报产品合同见 [DAILY_REPORT.md](DAILY_REPORT.md)。

## 已实现

- 用 GMGN 实时核对 Cash Cat 的市值、最大主池流动性、`5m/1h/6h/24h` 成交量与持币地址；
- 用 DEX Screener 同时核对同一主池、前 5 池与全部索引池流动性，避免把主池值误读成全市场总和；
- 从多榜并集构造可审计的 Robinhood Meme 同业集合，剔除低经济活动 holder 异常值；四项指标分别保留同口径前三名与 Cash Cat 的真实名次；
- 所有支持链的热搜按真实 `visiting_count` 本地重排，建立 Robinhood 自身历史基线；
- 复用本机已验证的 TwitterAPI.io 实盘接入，分六路采集公司与负责人、创始人 Meme 立场、官方生态伙伴、Cash Cat、Robinhood Chain 与外部 Meme 热点；
- 负责人范围覆盖公司公告、Crypto 负责人、CEO、联合创始人及欧洲官方；生态范围覆盖 Arbitrum、Uniswap、Alchemy、Chainlink 与 BitGo；
- 官方通报账号被盗时，自动隔离事发后内容，恢复确认前不把该账号新帖用于投资判断；
- 推文保留真实作者、发布时间、互动量和原帖链接，空投/拉群等噪音不进入判断；
- `HOLD / WATCH / EXIT_CANDIDATE / EXIT / UNKNOWN` 状态机与连续确认；
- 自动判断创始人支持、主流讨论度和外部热点，人工证据仅作为实盘未知时的补充；
- SQLite 快照/事件审计、APScheduler 后台任务、Apprise 可选通知；
- 本地 FastAPI 看板和 API；
- 每轮采集后自动重建“实时版日报”，首页和证据页用 2×2 排名面板展示四项同口径前三名，成交量可切换 `5m/1h/6h/24h`，中文分享卡提供紧凑版完整排名；
- 当前判断使用 9 类实盘证据完整度；每日 08:10 的历史版仍用 24 小时连续采样门槛；
- 过去 24 小时不连续时只限制趋势复盘，不再把证据齐全的当前判断错误改成“暂停”；
- GMGN 过去 24 小时 1 小时 K 线、价格区间与成交额进入审计回执；
- 正常、边界、缺失、冲突、极端值和连续状态测试。

## 启动

前置：`gmgn-cli config --check` 必须成功；`TWITTERAPI_IO_KEY` 可来自进程环境，或本机已有的 `~/.codex/secrets/twitterapi-io.env` / `~/.Codex/secrets/twitterapi-io.env`。

```bash
cd "/Users/myandong/Projects/gmgn agent/skillmarket-demos/cashcat-sentinel"
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
uvicorn app:app --host 127.0.0.1 --port 8010 --workers 1
```

打开 <http://127.0.0.1:8010>。启动后 APScheduler 会立即执行首轮，之后默认每 5 分钟执行一次。每轮成功后会原子更新 `live` 报告，最新日报位于 <http://127.0.0.1:8010/reports/latest>；历史版事实窗口为前一日 08:00 至当日 08:00，每日 08:10 生成。

页面只显示中文产品语言。链上与推特来源都会展示“实盘/异常/未接入”、采集时间和原始证据；项目没有 Mock 或演示数据回退，来源失败时只会显示数据不可用。

必须使用单 worker：调度器位于应用进程内，多 worker 会重复采集。本机已经提供 macOS LaunchAgent 配置，由 `KeepAlive` 负责异常拉起：

```bash
./scripts/install_launch_agent.sh
launchctl print "gui/$(id -u)/com.cashcat.sentinel"
```

应用内调度器负责周期和重入，launchd 负责登录自启与进程守护。

## Linux / SWAS 部署

生产部署使用独立的 `cashcat` 用户、版本化 `/opt/cashcat-sentinel/releases/`、持久化
`/var/lib/cashcat-sentinel/` 和 systemd 单 worker。服务只监听 `127.0.0.1:8010`；公网由
现有 Robinhood Chain Radar 的 Nginx 在 `/cashcat/` 子路径提供只读访问，所有 POST
接口继续限制在 loopback。

- systemd：`deploy/linux/cashcat-sentinel.service`
- Nginx 子路径：`deploy/linux/nginx-cashcat-location.conf`
- 环境变量示例：`deploy/linux/production.env.example`

GMGN 与 TwitterAPI.io 只读密钥必须放在服务器的
`/etc/cashcat-sentinel/production.env`，权限为 `600 root:root`；发布包不得包含 `.env`、
本机数据库、历史报告、日志、虚拟环境或钱包密钥。

### 当前生产实例（2026-08-25）

- 公网入口：<http://47.251.99.37/cashcat/>；原有 <http://47.251.99.37/> 继续由
  Robinhood Chain Radar 提供，不被 CashCat 发布替换。
- 阿里云 SWAS：`robinhood-chain-radar`，实例
  `ceff28ff463440c09d8666b0f081bc7f`，区域 `us-west-1`。
- 当前版本：`/opt/cashcat-sentinel/releases/20260825T021606Z`，由
  `/opt/cashcat-sentinel/current` 指向；发布包 SHA-256 为
  `d5a0c623fcc4cafb5e92b11e657f93460815b77cafab7634bae3f423dd71eb4d`。
- 运行服务：`cashcat-sentinel.service`，监听 `127.0.0.1:8010`，已启用开机自启；
  Nginx 只在现有 server block 内 include
  `/etc/nginx/snippets/cashcat-sentinel.conf`。
- 持久数据：`/var/lib/cashcat-sentinel/`；生产配置：
  `/etc/cashcat-sentinel/production.env`。这里只允许 GMGN 与 TwitterAPI.io 只读凭证，
  不得放入钱包私钥或交易授权。
- 公网只允许 `GET/HEAD`；`POST /cashcat/api/run` 的生产回读为 `403`。GMGN、DEX
  Screener、四项各自前三名、四个成交量周期排名、24 根小时 K 线和 PNG 卡片已通过实盘回读；
  生产桌面端、手机端、日报和分享卡均完成浏览器视觉验收。
- 当前 TwitterAPI.io 凭证可识别，但账户返回 HTTP 402 `Credits is not enough`；页面会
  明确显示 X 实盘异常，不以虚拟数据补位。充值后无需重新发布代码，下一轮采集会自动恢复。
- 云端连续快照从 2026-08-24 13:26（Asia/Shanghai）开始。2026-08-25 08:10 的历史版
  尚不具备完整 24 小时云端采样；在服务不中断的前提下，最早可完整覆盖的链上历史版是
  2026-08-26 08:10。X 证据是否完整仍取决于 TwitterAPI.io 恢复正常。

生产回读：

```bash
systemctl status cashcat-sentinel.service --no-pager
curl -fsS http://127.0.0.1:8010/api/health | jq
curl -fsS http://47.251.99.37/cashcat/api/reports/latest | jq '.coverage, .artifacts.png'
```

## 测试

```bash
cd "/Users/myandong/Projects/gmgn agent/skillmarket-demos/cashcat-sentinel"
PYTHONPATH=. python -m unittest discover -s tests -v
```

## 环境变量

| 变量 | 默认值 | 用途 |
|---|---:|---|
| `CASHCAT_POLL_SECONDS` | `300` | 采集间隔 |
| `CASHCAT_RANK_LIMIT` | `30` | 每个 GMGN 榜单候选数 |
| `CASHCAT_BASELINE_POINTS` | `12` | 启用跨链分流判断前的最少历史点 |
| `CASHCAT_PEER_EXCLUDED_ADDRESSES` | 空 | 经人工复核后排除的非 Meme 地址，逗号分隔 |
| `CASHCAT_MCAP_CLIFF` | `1.50` | 市值断崖倍数 |
| `CASHCAT_LIQ_CLIFF` | `1.50` | 流动性断崖倍数 |
| `CASHCAT_HOLDERS_CLIFF` | `1.50` | 持币地址断崖倍数 |
| `CASHCAT_VOLUME_CLIFF` | `1.30` | 多周期量几何领先倍数 |
| `CASHCAT_AUTOSTART` | `1` | 是否启动后台任务 |
| `CASHCAT_RETENTION_DAYS` | `30` | SQLite 快照与事件保留天数 |
| `CASHCAT_TWITTER_TIMEOUT_SECONDS` | `30` | 单次 Twitter 实盘查询超时 |
| `CASHCAT_TWITTER_MIN_REQUEST_INTERVAL_SECONDS` | `5.2` | TwitterAPI.io 请求最小间隔，兼容低 QPS 套餐 |
| `CASHCAT_LIQUIDITY_CROSSCHECK_TIMEOUT_SECONDS` | `20` | DEX Screener 多池流动性核对超时 |
| `CASHCAT_APPRISE_URLS` | 空 | Apprise URL；可用 JSON 数组或每行一个 URL |
| `CASHCAT_REPORT_TIMEZONE` | `Asia/Shanghai` | 日报时区 |
| `CASHCAT_REPORT_CUTOFF_HOUR` | `8` | 日报窗口结束小时 |
| `CASHCAT_REPORT_SCHEDULE_MINUTE` | `10` | 窗口结束后第几分钟生成 |
| `CASHCAT_REPORT_MINIMUM_COVERAGE` | `0.90` | 允许发布强结论的最小实盘覆盖率 |
| `CASHCAT_REPORT_EXPORT_PNG` | `1` | 是否用本机 Chrome 导出 1080×1350 分享图 |
| `CASHCAT_REPORT_BASE_URL` | `http://127.0.0.1:8010` | 证据页与 PNG 导出使用的服务地址 |
| `CASHCAT_CHROME_BIN` | 自动发现 | 可选的 Chrome 可执行文件路径 |

阈值均会通过 `/api/config` 显示，不是隐藏规则。

## API

- `GET /api/health`：运行、数据年龄、下一轮时间；
- `GET /api/status`：最新完整快照；
- `POST /api/run`：立即执行一次只读检查；
- `GET /api/history`：历史快照；
- `GET /api/events`：状态变化；
- `GET/POST /api/narrative`：读取/保存叙事证据；
- `GET /api/config`：公开运行参数与安全边界。
- `GET /reports/latest`：最新中文证据日报；
- `GET /reports/{report_id}/card`：1080×1350 分享卡；
- `GET /api/reports`、`GET /api/reports/latest`：日报归档与最新事实包；
- `POST /api/reports/generate?mode=live&export_png=true`：从最新实盘证据生成当前日报与 PNG；
- `POST /api/reports/generate?mode=daily&report_date=YYYY-MM-DD&export_png=true`：生成固定 08:00—08:00 历史日报。

## 当前明确边界

- GMGN 的 `track kol` / `track smartmoney` 不支持 Robinhood Chain，因此推特层复用本机现有 TwitterAPI.io 实盘路径，不伪造 GMGN 能力。
- 外部热点搜索容易混入空投和营销噪音；系统先过滤明显垃圾内容，再要求同一标的由多位作者重复出现，连续三轮才允许升级为已确认热点。
- TwitterAPI.io 或 GMGN 任一来源异常都会在首页显示；不会自动换成夹具、演示值或旧数据冒充当前实盘。
- GMGN 的流动性用于同链排名时固定采用最大主池口径；DEX Screener 多池合计用于解释钱包/聚合器展示差异，二者不会混算。
- 当前“链热度”硬判断来自 GMGN 跨链热门池份额及自身历史基线；Cash Cat 的链内热搜名次单独展示，不再反向改写整条链的热度状态。
