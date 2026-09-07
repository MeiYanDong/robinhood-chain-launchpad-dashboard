# Representative-token price production deployment — 2026-09-03

Evidence level: `verified_current` at deployment time. Prices are point-in-time observations and will
change.

## Release and rollback

- Target: Alibaba Cloud SWAS `robinhood-chain-radar`, instance
  `ceff28ff463440c09d8666b0f081bc7f`, public IP `47.251.99.37`.
- Active release: `/opt/robinhood-chain-launchpad/releases/20260903T061515Z`, package `0.7.1`.
- Artifact SHA-256: `6a015d29d4aa1151df5dbff32db42dab5ce4a3f3c4e14d81dffa5a9355ce356c`.
- Previous release and rollback target:
  `/opt/robinhood-chain-launchpad/releases/20260902T170709Z`, package `0.7.0`.
- Configuration and pre-migration SQLite backup:
  `/opt/robinhood-chain-launchpad/deploy-backups/20260903T061515Z`.
- The protected environment file and Nginx configuration were reused unchanged.

## Data path

The representative-token table now exposes `priceUsd` as its own evidence value. PONS and PAIR use the
direct price already collected by the economics sources. Long persists the GMGN `price` field in the
token snapshot and carries it through the ranking entry used to select the verified dynamic leader. No
price is inferred from market cap or supply.

The shared PAIR/Long snapshot database adds nullable `price_usd` with an idempotent migration. A clean
service stop preceded the SQLite backup and release switch. The regression suite verifies that a legacy
table keeps its existing market-cap row while the new price column starts as `NULL`.

## Point-in-time public readback

| Platform | Representative token | Price | Evidence |
| --- | --- | ---: | --- |
| Pons | PONS | `$0.48365454` | `gmgn.ponsTokenInfo` |
| Long | AI | `$0.308436` | `gmgn.marketRank.longxyz+long.launcherEvents` |
| PAIR | PAIR | `$0.006161` | `pair.officialTokenApi` |

The economics response remained `partial` because the known Long platform-level closed-day volume gap is
independent of token-price availability.

## Verification

- `npm run verify`: passed formatting, lint, typecheck, 164 tests, coverage thresholds and production
  build.
- Public runtime verifier: all nine documented GET contracts passed.
- `/api/meta`: `appVersion=0.7.1`, `apiContractVersion=1`.
- `/api/economics`: three representative-token rows each contained a direct `priceUsd` evidence object.
- Public HTML and JavaScript contained the `当前价格` column and dedicated small-price formatter.
- A 1600×1000 real-browser screenshot showed the three prices without clipping or layout regression.

During the first Long refresh, a release permission normalization removed the executable bit from the
pinned `gmgn-cli` entrypoint. The service stayed online and its prior Long snapshot remained available.
The exact entrypoint permission was restored to `0755`; the subsequent Long refresh completed with
`status=success`, 60 eligible tokens, AI as leader and no warnings. Future release steps must preserve
dependency executable bits rather than applying a blanket file-mode rewrite.
