# PAIR cross-generation Alpha radar production deployment — 2026-09-06

Evidence level: `verified_current` at deployment time. Prices, volume, coverage, block numbers and
alert queue counts are point-in-time observations and will drift.

## Release and source boundary

- Target: Alibaba Cloud SWAS `robinhood-chain-radar`, instance
  `ceff28ff463440c09d8666b0f081bc7f`, region `us-west-1`, public IP `47.251.99.37`. The control plane
  returned `Running` and `BusinessStatus=Normal` before deployment.
- Active release: `/opt/robinhood-chain-launchpad/releases/20260906T155316Z`, package `0.14.0`.
- Rollback release: `/opt/robinhood-chain-launchpad/releases/20260906T114217Z`, package `0.13.2`.
- Configuration backup: `/opt/robinhood-chain-launchpad/deploy-backups/20260906T155625Z`.
- Consistent SQLite backup:
  `/var/lib/robinhood-chain-launchpad/backups/launchpad-dashboard-20260906T155625Z.sqlite`; Node's
  SQLite backup API completed and `PRAGMA integrity_check` returned `ok` before cutover.
- Runtime archive SHA-256:
  `f8d461fce0c4d837b3561e8a53f91f6177c3d9221940a42a3fd197fc76479cd5`.
- The release was built from the current dirty local worktree. GitHub `main`, local `HEAD` and
  `origin/main` all still pointed to `a696cf86015b1e0cfe976068b51c3ff95fc53e81`; the 0.14.0 worktree
  changes were not committed or pushed. Production deployment is therefore not evidence of GitHub
  synchronization.

The local gate passed formatting, lint, type checking, the production build, all `245/245` tests and
the configured coverage thresholds. The uploaded minimal artifact contained only package manifests,
compiled runtime files, public assets and the two deployment configuration files. The protected
production environment file remained `root:root` mode `0600`; no wallet key, signing material or
transaction credential was added.

## Guarded cutover

The first cutover attempt used an immediate loopback readiness check. The process needed about one
second to bind port `4175`, so the check ran too early and the guard automatically restored release
`0.13.2`, its systemd/Nginx files and all seven launchpad timers. The old service returned with
`NRestarts=0`; no partial deployment was left active.

The second attempt used a bounded readiness retry. It stopped only the seven launchpad-owned timers
and their one-shot writers, backed up SQLite, atomically switched `current`, installed the new systemd
unit and Nginx snippet, passed `nginx -t`, then restored every timer. The chain-level radar, CashCat
service, TLS certificate and their release directories were not changed.

## Public and runtime readback

After the cold full-universe refresh completed:

- HTTPS `/pair-alpha/`, `/pair-alpha/api/pair/alpha/health`,
  `/pair-alpha/api/pair/alpha`, `/pair-v2/`, `/pair-flow/`, `/launchpads/`, `/leaders/`, `/cashcat/`
  and the original `/api/latest` all returned HTTP `200`.
- The Alpha response reported 2,142 official PAIR tokens: 1,944 V1 and 198 V2. The monitored market
  cohort contained 451 tokens, of which 318 had current short-window observations.
- Direct public lookup of `0x350cadde605e083f58d286e8b3a6b086685fa1ec` returned `Titties`, V1,
  action `no_chase` / `过热勿追`, point-in-time price `$0.000908`, market cap `$926,278` and official
  24-hour volume `$1,620,756.65`.
- The main service was `active/running`, `ExecMainStatus=0`, `NRestarts=0`; all seven launchpad-owned
  data timers were active. No warning-or-higher journal entry appeared after the successful switch.

The initial post-switch response temporarily reused an earlier 196-token snapshot while a full
refresh was running. It was not reported as final coverage. The next completed refresh matched the
official 2,142-token pagination and restored the target V1 token. This is why deployment success is
based on the settled readback rather than the first process response.

Source status remained `partial`: holder observations covered 81 of 438 requested candidates and
DexScreener short-window observations covered 318 of 435 expected candidates at the recorded read.
Those gaps remain visible and were not filled with zeros or estimates.

## Server autonomy and notification boundary

Two external health reads, without a refresh request or local scheduler, advanced from
`observedAt=2026-09-06T16:01:41.838Z`, confirmed block `56,104,642`, to
`observedAt=2026-09-06T16:03:18.127Z`, confirmed block `56,105,500`. Both returned `stale=false` and
`backgroundMonitor=true`. This is direct evidence that the server process continues updating the
radar.

The complete legacy runtime verifier still returned `RUNTIME_NOT_READY` because it currently requires
`dev-monitor.alerts.configured=true`, while the invalid historical Feishu Webhook remains removed.
All dashboard health endpoints themselves returned `200`; notification delivery is not configured and
must not be described as working. At the recorded read, the DEV outbox contained historical pending
rows and no failed rows. No notification was sent during this deployment. Reconnecting Feishu requires
a valid replacement Webhook and a separate backlog-handling decision before delivery is enabled.

## Rollback

Restore `current` atomically to
`/opt/robinhood-chain-launchpad/releases/20260906T114217Z`, restore the systemd unit and Nginx snippet
from `/opt/robinhood-chain-launchpad/deploy-backups/20260906T155625Z`, run `systemctl daemon-reload`,
validate `nginx -t`, restart the launchpad service, reload Nginx, restore the seven launchpad timers and
repeat the public readbacks. Restore the SQLite backup only if the additive schema or post-switch writes
are proven corrupt.
