# Long token radar production deployment — 2026-09-01

Evidence level: `verified_current` at deployment time. Market values below are point-in-time observations.

## Release and rollback

- Target: Alibaba Cloud SWAS `robinhood-chain-radar`, instance
  `ceff28ff463440c09d8666b0f081bc7f`, public IP `47.251.99.37`.
- Active release: `/opt/robinhood-chain-launchpad/releases/20260901T154456Z`, package `0.6.0`.
- Artifact SHA-256: `ef62629dbf8ccd646daf0195dbfc37b894d8fa9f09dcf5d0cbd51632c20d60d1`.
- Previous release and rollback target:
  `/opt/robinhood-chain-launchpad/releases/20260901T113542Z`, package `0.5.0`.
- Configuration backup: `/opt/robinhood-chain-launchpad/deploy-backups/20260901T154456Z`.
- The existing protected `GMGN_API_KEY` environment file was reused unchanged. No wallet key or transaction
  capability was added.

## Live data readback

The first startup collection did not form a usable Long snapshot; its precise upstream cause remains unknown.
The release was not accepted at that point. A bounded second refresh succeeded, and the next scheduled refresh
also completed with `Result=success`.

Public `GET /api/long/rankings` then returned run `3`, observed at
`2026-09-01T15:50:06.695Z`:

- GMGN `longxyz` active sample: `44` tokens;
- economically eligible sample: `44` tokens;
- GMGN market and holder source: `ok`;
- LongLauncher attribution source: `ok`;
- market cap, liquidity, rolling 24H volume and holder rankings: `5` entries each;
- public warnings: none.

Point-in-time leaders:

| Metric | Leader | Address | Value |
| --- | --- | --- | ---: |
| Market cap | AI / Artificial Inu | `0x2e8c31162b855a2ffa90f6f8634643ad6f111e18` | `$163,566,000` |
| Liquidity | AI / Artificial Inu | `0x2e8c31162b855a2ffa90f6f8634643ad6f111e18` | `$3,633,530` |
| Rolling 24H volume | AI / Artificial Inu | `0x2e8c31162b855a2ffa90f6f8634643ad6f111e18` | `$38,075,700` |
| Holder addresses | AI / Artificial Inu | `0x2e8c31162b855a2ffa90f6f8634643ad6f111e18` | `29,051` |

Browser readback confirmed the `Long 代币` tab, active-sample metadata and all four Top 5 cards are visible.
The first daily report was intentionally not backfilled from a post-cutoff snapshot.

## Runtime and regression checks

| Check | Result |
| --- | --- |
| `http://47.251.99.37:4174/` | `200`, Long tab visible |
| `/healthz` | `200` |
| `/api/meta` | `200`, `appVersion=0.6.0` |
| `/api/overview?window=30` | `200`, 48 platforms |
| `/api/sources` | `200`, 11 sources |
| `/api/pair/health` | `200` |
| `/api/pair/rankings` | `200`, 10 eligible tokens |
| `/api/long/health` | `200`, `ok=true` |
| `/api/long/rankings` | `200`, 44 eligible active samples |
| `/api/long/sources` | `200`, both sources `ok` |
| public `POST /api/long/reports/generate` | `403` |
| original `http://47.251.99.37/api/latest` | `200` |
| original `http://47.251.99.37/cashcat/` | `200` |

`robinhood-chain-launchpad.service` was `active/running`, `NRestarts=0`, `ExecMainStatus=0`.
PAIR and legacy refresh timers remained active. Long refresh runs every 15 minutes at minutes
`05,20,35,50`; the daily report runs at 08:12 Asia/Shanghai for the 08:00 cutoff.
