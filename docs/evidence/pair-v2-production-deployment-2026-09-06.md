# PAIR V2 Alpha monitor production deployment — 2026-09-06

Evidence level: `verified_current` at deployment time. Market observations and project counts are
point-in-time values and will change.

## Release and rollback

- Target: Alibaba Cloud SWAS `robinhood-chain-radar`, instance
  `ceff28ff463440c09d8666b0f081bc7f`, region `us-west-1`, public IP `47.251.99.37`. The control plane
  returned `Running`, `BusinessStatus=Normal` before deployment.
- Active release: `/opt/robinhood-chain-launchpad/releases/20260906T073950Z`, package `0.11.0`.
- Rollback release: `/opt/robinhood-chain-launchpad/releases/20260905T042046Z`, package `0.10.0`.
- Configuration and consistent SQLite backup:
  `/opt/robinhood-chain-launchpad/deploy-backups/20260906T073950Z`.
- Uploaded artifact SHA-256:
  `22adc5302166aab77f3aad487d84d1473fc40c2c182e67b7855d29099a7859be`.

The seven launchpad-owned timers were stopped before the service, deployment files and SQLite state
were backed up, and `current` was switched atomically. Nginx passed `nginx -t` before reload. The
chain-level radar, CashCat service, their releases and the existing production environment file were
not changed. No wallet key, signing material or transaction credential was deployed.

## Public and runtime verification

- Local release gate passed formatting, lint, typecheck, production build, coverage thresholds and
  `227/227` tests.
- The public runtime verifier passed all `16/16` documented API contracts against port `4174`.
- Public `/`, `/leaders/`, `/launchpads/`, `/pair-flow/`, `/pair-v2/`, `/cashcat/` and the original
  `/api/latest` returned `200`.
- `/pair-v2/api/pair/v2/health` returned `ok=true`, `stale=false`,
  `backgroundMonitor=true`, with 8-second chain and 60-second market polling.
- A real Chromium pass rendered `/pair-v2/` at 1440px and 390px. Both used the production API,
  reported zero console warnings/errors, and the mobile document width matched its 390px viewport.
- `robinhood-chain-launchpad.service` remained `active` with `NRestarts=0`; all seven paused timers
  returned to `active`.

## Autonomous monitoring proof

Two external health reads were taken without invoking refresh or a local scheduler:

- first: `observedAt=2026-09-06T07:45:09.089Z`, block `55,809,067`, run kind `full`;
- 12 seconds later: `observedAt=2026-09-06T07:45:25.089Z`, block `55,809,221`, run kind `chain`.

The advancing server timestamp and confirmed block show that collection continues inside the
production service rather than depending on a browser or local Codex automation.

## HTTPS public-access remediation

At 16:08 CST, public diagnostics showed that port 80 returned `200` from Los Angeles, Falkenstein,
Singapore, Tokyo and Sydney, while port 443 refused connections from all five locations. Nginx access
logs also showed no request from the user's other devices reaching `/pair-v2/`. The application was
healthy; the missing HTTPS listener was the public-access failure boundary.

- Certbot `5.8.0` obtained a production Let's Encrypt IP-address certificate for `47.251.99.37`
  through HTTP-01. Its SAN is `IP Address:47.251.99.37`, and this first certificate expires on
  2026-09-12 at 23:06:22 UTC.
- Nginx now serves the same read-only application on ports 80 and 443. The TLS listener supports
  TLS 1.2 and TLS 1.3; the application CSP and sandbox boundaries were not relaxed.
- Five independent HTTPS probes returned `200`. A real Chromium session loaded live V2 data at
  desktop and 390px mobile widths with zero console warnings or errors and no horizontal overflow.
- `robinhood-chain-certbot-renew.timer` is enabled and checks renewal twice daily. A manual service
  run exited successfully, and Certbot's production-certificate dry run completed successfully.
- TLS configuration backup:
  `/opt/robinhood-chain-launchpad/deploy-backups/20260906T080245Z/tls`.

Globalping's Node-based probe metadata still labels the new IP SAN as `ERR_TLS_CERT_ALTNAME_INVALID`,
even though each probe completed the HTTPS request with `200`. Certificate trust and hostname
matching were therefore verified independently with strict cURL validation and real Chromium rather
than inferred from that metadata field.

## Deployment-time evidence state

- Current release projects: `102`; verified official-pool matches: `89`.
- Release attestation, Pair token API and Robinhood RPC were `ok`.
- DexScreener pool coverage and GMGN holder coverage were `degraded`, so business status correctly
  remained `partial` rather than fabricating complete coverage.
- The model remained `shadow`, `validated=false`; it had no mature 24-hour outcome sample at
  deployment time. This is an observation system, not a buy instruction or proven Alpha model.
- Feishu alerts were not configured. Public availability does not silently enable external
  notifications.

## Rollback

Restore `current` to `/opt/robinhood-chain-launchpad/releases/20260905T042046Z`, restore the backed-up
systemd and Nginx files, run `systemctl daemon-reload`, restart the launchpad service, validate
`nginx -t`, reload Nginx, restore the seven launchpad timers and repeat all public readbacks. Restore
the SQLite backup only if the additive V2 schema or post-switch writes are proven corrupt.

To roll back only the HTTPS change, disable `robinhood-chain-certbot-renew.timer`, remove the
`robinhood-chain-radar-tls` enabled-site symlink, restore the port-80 Nginx file from the TLS backup,
validate with `nginx -t`, and reload Nginx. Certificate files may remain in place because they are not
loaded after the TLS site is disabled.
