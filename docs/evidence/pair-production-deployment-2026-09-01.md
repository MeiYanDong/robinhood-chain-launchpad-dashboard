# PAIR production deployment — 2026-09-01

Evidence level: `verified_current` at deployment time. Market values are point-in-time observations and will drift.

## Release and rollback

- Target: Alibaba Cloud SWAS `robinhood-chain-radar`, instance `ceff28ff463440c09d8666b0f081bc7f`, public IP `47.251.99.37`.
- Active release: `/opt/robinhood-chain-launchpad/releases/20260901T113542Z`, package `0.5.0`.
- Artifact SHA-256: `8ffc8aa1febddcaedc5402b7d1ab47c699f74d5dce847270c4affd2131f30f5b`.
- Previous release and rollback target: `/opt/robinhood-chain-launchpad/releases/20260830T035333Z`.
- Deployment backup: `/opt/robinhood-chain-launchpad/deploy-backups/20260901T113542Z`.
- The GMGN read-only API key is injected through `/etc/robinhood-chain-launchpad.env` with mode `0600`. No wallet or GMGN private key was copied.

## PAIR readback

The scheduled refresh unit was executed once after the switch and returned `Result=success`, `ExecMainStatus=0`.
Public `GET /api/pair/rankings` then returned run `2`, observed at `2026-09-01T11:40:21.570Z`:

- official token universe: `1,381`;
- eligible active tokens: `10`;
- PAIR official API: `ok`;
- GMGN holder source: `ok`;
- market cap, liquidity depth, rolling 24H volume and holder rankings: `5` entries each.

Point-in-time leaders:

| Metric | Leader | Address | Value |
| --- | --- | --- | ---: |
| Market cap | PAIR | `0x6b1d42927b1a84ec28fa88d4fc6fa7af404966be` | `$3,956,970` |
| Liquidity depth | PAIR | `0x6b1d42927b1a84ec28fa88d4fc6fa7af404966be` | `$120,579.29296941` |
| Rolling 24H volume | CINEMA | `0x9936403a9cc72cf306063e3496ea387428a3aecd` | `$8,099,838.62` |
| Holder addresses | CINEMA | `0x9936403a9cc72cf306063e3496ea387428a3aecd` | `3,996` |

Browser readback confirmed that the `PAIR 代币` view renders all four Top 5 cards. The first daily report remains unavailable until the next scheduled cutoff run; it was not backfilled with a post-cutoff snapshot.

## Runtime and regression checks

| Check | Result |
| --- | --- |
| `http://47.251.99.37:4174/` | `200` |
| `/healthz` | `200` |
| `/api/meta` | `200`, `appVersion=0.5.0` |
| `/api/overview?window=30` | `200` |
| `/api/sources` | `200` |
| `/api/pair/health` | `200`, `ok=true` |
| `/api/pair/rankings` | `200` |
| `/api/pair/sources` | `200` |
| public `POST /api/pair/reports/generate` | `403` |
| original `http://47.251.99.37/api/latest` | `200` |
| original `http://47.251.99.37/cashcat/` | `200` |

`robinhood-chain-launchpad.service` was `active/running` with `NRestarts=0` and no warning-level journal entries after the switch. The existing launchpad timer stayed active. PAIR refresh is scheduled every 15 minutes; the daily report is scheduled for 08:10 Asia/Shanghai.
