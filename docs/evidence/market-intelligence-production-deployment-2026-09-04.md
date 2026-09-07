# Market intelligence production deployment — 2026-09-04

Evidence level: `verified_current` at deployment time. Market values and classifications are live
observations and will change.

## Release and rollback

- Target: Alibaba Cloud SWAS `robinhood-chain-radar`, instance
  `ceff28ff463440c09d8666b0f081bc7f`, public IP `47.251.99.37`, state `Running`.
- Launchpad intelligence release: `/opt/robinhood-chain-launchpad/releases/20260904T034142Z`,
  package `0.9.0`.
- Launchpad rollback: `/opt/robinhood-chain-launchpad/releases/20260904T004712Z`, package `0.8.0`.
- Chain-radar navigation release: `/opt/robinhood-chain-radar/releases/20260904T034142Z`; rollback:
  `/opt/robinhood-chain-radar/releases/20260824T043250Z`.
- CashCat navigation release: `/opt/cashcat-sentinel/releases/20260904T034142Z`; rollback:
  `/opt/cashcat-sentinel/releases/20260825T021606Z`.
- Launchpad configuration and consistent SQLite backup:
  `/opt/robinhood-chain-launchpad/deploy-backups/20260904T034142Z`.
- Final runtime artifact SHA-256: `48779c13b1cde4560f8d87727e33e061bc8f0e13302218ed38aff8c042627ed7`.

All three `current` symlinks were switched atomically. The prior releases remain intact. The CashCat
release received a fresh Python virtual environment, so its executable shebang resolves to the new
release rather than depending on the rollback release.

## Product and data boundaries

- `/` remains the closed-day chain-fundamentals radar.
- `/leaders/` combines structural leader, cliff leader, chain heat, token trading pressure and
  same-role relative valuation. These are separate models and are not averaged into one score.
- `/launchpads/` remains the Pons/Long/PAIR operating comparison and token leaderboards.
- `/cashcat/` remains the CashCat position-thesis report.
- The intelligence service reads the chain radar and CashCat through loopback read-only APIs. It does
  not access either service's database.
- Missing or stale observations remain `UNKNOWN`. Relative discount/premium is not an absolute value
  judgment or target price, and chain transaction overheating is not a price-top claim.

## Verification

- Launchpad `npm run verify`: formatting, lint, typecheck, production build, coverage thresholds and
  `179/179` tests passed.
- Chain radar: typecheck, production build and `17/17` tests passed.
- CashCat: `36/36` unit tests passed.
- Public runtime verifier: all 13 documented GET contracts passed, including intelligence health and
  snapshot.
- Services `robinhood-chain-launchpad`, `robinhood-chain-radar` and `cashcat-sentinel` were active with
  `NRestarts=0` after switching.
- All six launchpad/PAIR/Long/economics timers were restored to `active` after the consistent database
  backup and release switch.
- Nginx configuration passed `nginx -t` before every reload. Public JSON compression was added after
  a real external read showed that a 19.5 KB uncompressed response stalled on the network path; the
  compressed 4.4 KB response then completed normally.

| Readback | Result |
| --- | --- |
| `http://47.251.99.37/` and `/api/latest` | `200`, unified navigation present |
| `http://47.251.99.37/leaders/` | `200`, intelligence view rendered in a real browser |
| `http://47.251.99.37/leaders/api/intelligence` | `200`, five source states and four model versions |
| `http://47.251.99.37/launchpads/` | `200`, economics view rendered in a real browser |
| `http://47.251.99.37/launchpads/api/economics` | `200`, three platform rows |
| `http://47.251.99.37/cashcat/` | `200`, unified navigation present |
| `http://47.251.99.37:4174/` | `308` to canonical `/launchpads/`; legacy API remains compatible |
| `http://47.251.99.37:4174/api/meta` | `200`, `appVersion=0.9.0` |

The real-browser production pass reported zero console warnings/errors. Its network log showed `200`
for `/leaders/api/intelligence`, `/launchpads/api/economics` and valuation history.

## Deployment-time live snapshot

- Structural leader: `PONS`, state `provisional`; it led market cap but did not yet lead at least three
  of the four retained volume windows.
- Cliff leader: none.
- Chain heat: `overheated`, confidence `high`; the model describes transaction and cost congestion,
  not an asset-price top.
- Economics source remained `degraded` because known platform-level fields are unavailable. Chain,
  CashCat on-chain market data, PAIR token radar and Long token radar were usable.

## Rollback

Rollback consists of restoring the three recorded `current` symlinks, the backed-up launchpad systemd
unit and Nginx files, then running `systemctl daemon-reload`, restarting the three services, validating
`nginx -t`, reloading Nginx and repeating the public runtime checks. Restore the SQLite backup only if a
data migration or post-switch write corrupts the current database; no such restoration was required in
this deployment.
