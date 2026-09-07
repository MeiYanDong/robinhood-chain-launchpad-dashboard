# PAIR capital-flow production deployment — 2026-09-05

Evidence level: `verified_current` at deployment time. On-chain values are point-in-time observations
and will change.

## Release and rollback

- Target: Alibaba Cloud SWAS `robinhood-chain-radar`, instance
  `ceff28ff463440c09d8666b0f081bc7f`, public IP `47.251.99.37`, observed `Running` before deployment.
- Active release: `/opt/robinhood-chain-launchpad/releases/20260905T042046Z`, package `0.10.0`.
- Rollback release: `/opt/robinhood-chain-launchpad/releases/20260904T034142Z`, package `0.9.0`.
- Configuration and consistent SQLite backup:
  `/opt/robinhood-chain-launchpad/deploy-backups/20260905T042046Z`.
- Uploaded artifact SHA-256:
  `3d23f794f622cf482b85353a5e42b4206e9fe718d8592a611831e59d66fedea7`.

The launchpad timers were stopped before the application, the SQLite database and deployment files
were backed up, and the `current` symlink was switched atomically. The chain radar and CashCat
releases were not changed.

## Automatic refresh proof

- `robinhood-chain-pair-flow-refresh.timer` is enabled and active.
- Schedule: every five minutes at minutes `02,07,12,17,22,27,32,37,42,47,52,57`.
- First unattended timer run started at `2026-09-05 12:27:03 CST` and exited successfully at
  `12:27:09 CST`, with `Result=success` and `ExecMainStatus=0`.
- Before that automatic run, the production snapshot had `observedAt=2026-09-05T04:23:11.832Z`.
- After the automatic run, it had `observedAt=2026-09-05T04:27:03.331Z`.
- The event ledger remained at 152 entries because no new matching chain event appeared in that
  interval; the advancing source observation time proves that the collector ran rather than serving
  the old cache.
- The page separately polls its read-only APIs every 60 seconds. Therefore server collection no longer
  depends on keeping a browser open, while an open page normally displays the next stored snapshot
  within one minute.

## Verification

- Local release gate: format, lint, typecheck, production build, coverage thresholds, and `198/198`
  tests passed.
- Public runtime verifier: all 14 documented API contracts returned `200`, including
  `/api/pair/flow`.
- Public `/pair-flow/`, its JavaScript asset, health API, snapshot API, and transaction-events API all
  returned `200`.
- Public `/`, `/api/latest`, `/leaders/`, `/launchpads/`, and `/cashcat/` still returned `200`.
- Legacy `http://47.251.99.37:4174/` returned `308` to `/launchpads/`; its `/api/meta` returned
  `appVersion=0.10.0`.
- `robinhood-chain-launchpad`, `robinhood-chain-radar`, `cashcat-sentinel`, and Nginx were active after
  deployment. The launchpad service had `NRestarts=0`, and systemd reported no failed units.
- Nginx configuration passed `nginx -t` before reload.

## Deployment-time data state

- Transfer history was completely paginated from the configured start date.
- Event ledger: 152 transactions, split into 78 observed market buys and 74 burns.
- Snapshot health was `ok=true`, `stale=false`, and business status was `partial`.
- `partial` is an evidence boundary, not a runtime failure: the official treasury-claimable API was
  unavailable and the all-token 24-hour platform volume remained an observed lower bound. The funding
  link between each fee receipt and each swap was also not claimed as complete.

## Rollback

Restore the recorded `current` symlink and the backed-up launchpad systemd and Nginx files, disable the
new PAIR capital-flow timer if required, then run `systemctl daemon-reload`, restart the launchpad
service, validate `nginx -t`, reload Nginx, and repeat the public runtime checks. Restore the SQLite
backup only if the additive migration or post-switch writes are proven corrupt; no such issue was
observed.
