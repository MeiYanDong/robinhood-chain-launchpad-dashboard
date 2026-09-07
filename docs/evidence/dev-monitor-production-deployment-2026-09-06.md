# DEV monitor production deployment evidence — 2026-09-06

Evidence level: `verified_current` at deployment time. Project counts, market values, source status and
confirmed block numbers are point-in-time observations and will drift.

## Release and rollback

- Instance: Alibaba Cloud SWAS `robinhood-chain-radar`, `us-west-1`, instance
  `ceff28ff463440c09d8666b0f081bc7f`.
- Active release: `/opt/robinhood-chain-launchpad/releases/20260906T114217Z`, package `0.13.2`.
- Rollback release: `/opt/robinhood-chain-launchpad/releases/20260906T110502Z`, package `0.13.1`.
- Deployment backups: `/opt/robinhood-chain-launchpad/deploy-backups/20260906T101700Z` and
  `/opt/robinhood-chain-launchpad/deploy-backups/20260906T102600Z`; the final static-asset release uses
  `/opt/robinhood-chain-launchpad/deploy-backups/20260906T103200Z`.
- Main service was active with `NRestarts=0`; all seven existing data timers were active after cutover.
- The environment file remained root-owned with mode `0600`. The Webhook value is intentionally not
  recorded here or in Git.
- The `0.13.2` cutover backup is
  `/var/lib/robinhood-chain-launchpad/backups/launchpad-dashboard-20260906T114217Z.sqlite`; it was
  created through Node's SQLite backup API and passed `PRAGMA integrity_check` before cutover.

The first two release attempts stopped before cutover: the first used a Bash-only `pipefail` option on
the server's POSIX shell, and the second found that the old release contained runtime dependencies but
not the TypeScript compiler. Production remained on `0.11.0` in both cases. The final release was built
in an isolated directory before writers were stopped, then SQLite was backed up and `current` was
switched atomically. No rollback was required.

Release `0.12.1` is a presentation-only evidence-boundary hotfix: it changes the DEV footer from
“Feishu connected” to “Feishu configured”. A configured URL is not treated as proof of successful
delivery. It was built in a separate release directory and switched atomically after the same health
and timer gates passed.

## Runtime readback

At `2026-09-06T10:21:32Z`, the public aggregate endpoint reported:

- `enabled=true`, `baselineComplete=true`, status `success`;
- latest confirmed block `55,902,103`, using two confirmations and an eight-second poll interval;
- 5,889 canonical launch projects, 3,835 candidate creators and four `proven` creators;
- all PAIR V2, pons v1 active/legacy, pons v2, Long and DEV-buy sources were `ok`;
- zero pending or failed application outbox rows.

The earlier baseline snapshot was at block `55,899,290` with 5,616 projects. The later readback advanced
2,813 blocks and incorporated delayed Pons/Long source retries without any browser request or local
Codex schedule. This is the autonomy proof; a configured timer alone is not used as proof.

At `2026-09-06T10:34:32Z`, after the final static-asset release, the service had advanced again to block
`55,909,831`: 6,050 projects, 3,939 candidates, five `proven` creators, one `repeat` creator and six
watched addresses. All launch and buy sources were still `ok` with no warning. This later snapshot also
contained three preserved notification rows waiting for a replacement Webhook.

The server-side `npm run verify:runtime` passed all 17 route and semantic checks. Public readback also
returned HTTP `200` for `/pair-v2/`, `/pair-v2/api/dev-monitor/health`, `/api/latest` and `/cashcat/`.

## Initial high-signal creators

The first market-enriched baseline produced these `proven` profiles. A profile means the creator has at
least one project through the configured market/liquidity/volume gate; it is not an endorsement to buy.

| Creator | Platform | Project | Market cap | Liquidity | 24H volume |
| --- | --- | --- | ---: | ---: | ---: |
| `0xa15e4ad0dbc8df1715a7b254526252cd93bb1102` | PAIR V2 | `asd` (`0x5422663e07d6fc217b0af4532fb1a6c9c7de5555`) | $846,180 | $102,938.21 | $1,111,116.81 |
| `0x0baa09ac417810e6950dced2c658796ed39b9a35` | PAIR V2 | `5555` (`0x06137eb8bb1eac934ecf4f13864653367ca35555`) | $219,356 | $50,155.01 | $244,580.38 |
| `0xe15be94b10d84482c890f0885d9f00bbea3d805a` | PAIR V2 | `BETS` (`0x23aa3c1339434788f154a30ba04d4ffba27c5555`) | $46,925 | $21,942.52 | $43,495.00 |
| `0xff0df9223c75ef9375c4bac86d4bb7a2bd4fd0a6` | Pons v2 | `HODI` (`0xeac7cd0f9234660c22f27464660de9538e975dc1`) | $55,431 | $22,453.30 | $16,550.63 |

Market values above were read from DexScreener during the baseline and can change or disappear. PAIR
and Pons creator attribution uses indexed canonical launch-event fields. Long launch attribution is
kept at medium confidence because it uses the transaction sender and can be a relayer.

The live incremental monitor subsequently promoted Long sender
`0xb8c70e8a52d215d1aeb8064821bbb8c97e2d0292` to `repeat`: 66 observed Long launches, of which two met
the economic-activity gate. It then detected a new launch at block `55,903,133`, project
`0x2abf436983815ecbc6e0fd5884f9f5b423f4edff`, transaction
`0xa4dcd9ab0face3385e0f15daa3dc8e5a7c1701876aacbf1de837db446005123e`. This is medium-confidence
creator attribution, not proof that the same human directly controlled every launch.

Pons v2 creator `0x5767d7bb8bd1eb0bdb4a9f838c046c9a33d9f65d` also entered `proven` through TAMPONS
(`0xa3a273b2b389e718c0c490a4baee9347cd4a007b`) after the baseline market refresh.

## Feishu delivery boundary

The supplied Webhook was stored only in the protected server environment file and a clearly labelled
connection test was attempted. Feishu returned business code `19001`, which means the incoming Webhook
access token is invalid. Therefore notification delivery is **not verified** and must not be described
as working. A fresh Webhook copied from an enabled custom bot is required; after replacement, repeat the
connection test and require business code `0` before closing this item.

The chain monitor remains active independently of Feishu. New alerts are written to the deduplicated
SQLite outbox and retry at most five times with exponential backoff; the public health endpoint exposes
only aggregate queue counts.

Before deactivation, the invalid URL had consumed four attempts on each of two rows. The active setting
was therefore removed, those rows were reset to pending with zero attempts, and a third later promotion
was also queued. Final readback was `configured=false`, `pending=3`, `failed=0`; no captured alert was
dropped or falsely marked sent.

## PAIR DEV public launch feed — 0.13.1

Release `20260906T105518Z` adds a scoped public read model and the visible “PAIR DEV 新币流” board.
It exposes only PAIR V2 project and creator addresses already present in canonical public launch events,
plus public market enrichment. Cross-platform profiles, buy activities, notification outbox rows and
server configuration remain private. The UI explicitly states that a project creator is not necessarily
a PAIR team wallet.

The local release passed `npm run verify`: formatting, lint, typecheck, all 240 tests with coverage gates,
and the production TypeScript build. Before cutover, the server verified the uploaded archive SHA-256 as
`fa4ec1405aac293b8496dc83491c5c88a51ef9430eea06776ab1bb715e9e1617`. The prior release was copied into
an immutable new directory and built before any writer stopped. SQLite was backed up to
`/var/lib/robinhood-chain-launchpad/backups/launchpad-dashboard-20260906T105518Z.sqlite`, then `current`
was switched atomically. No rollback was required.

At `2026-09-06T10:59:44.796Z`, public readback from
`/pair-v2/api/dev-monitor/pair-launches?tier=all&limit=20&offset=0` returned:

- scope `pair_v2_public_launches`;
- 135 PAIR V2 launches: 131 candidate rows, zero repeat rows and four strong-sample (`proven`) rows;
- 20 newest rows in descending confirmed-block order;
- newest launch `MEME`, project `0x55938e3070e5497f30a36ded4c8086dcd8b65555`, creator
  `0x7cb94113fc2a10f2f3f4378eb567765f2c864f90`, block `55,924,033`.

The `watched` filter returned the four current PAIR V2 strong-sample projects: `BETS`, `asd`, `MEW` and
`5555`. These are behavioral/market thresholds, not identity verification or endorsement. Browser
readback confirmed the four filters, populated creator links, token links, prices, market caps,
liquidity, 24H volume, blocks and transaction links. Release `20260906T110502Z` (`0.13.1`) then applied
a presentation-only semantic hotfix: filter counts are labelled as launch/token row counts, and creator
history is explicitly labelled as a cross-chain launch count. Public HTML referenced the `0.13.1`
JavaScript and CSS cache keys. The main service was `active/running` with `NRestarts=0`, and all seven
data timers were active after cutover.

Feishu delivery remains unconfigured because the previously supplied Webhook failed canonical Feishu
readback. This release does not change that boundary; server-side monitoring and the public launch feed
continue updating independently of notification delivery.

## PAIR project-team issuance correction — 0.13.2

The prior “PAIR DEV” board answered the wrong identity question: it ranked creators that met behavioral
and market thresholds. Release `0.13.2` replaces that visible board with “PAIR 项目方发币”, scoped to the
verified PAIR primary issuer wallet `0xa15e4ad0dbc8df1715a7b254526252cd93bb1102`. The former public route
remains available as a compatibility and creator-analysis endpoint, but it no longer powers this board.

The issuer identity is backed by two independent links: the PAIR official token API records the wallet
as the creator of `$PAIR`, and the canonical `$PAIR` launch transaction was sent from that wallet to the
official Launchpad. The strict endpoint is
`/api/dev-monitor/pair-team-launches?limit=20&offset=0`; its response keeps these relationships separate:

- `$PAIR` (`0x6b1d42927b1a84ec28fa88d4fc6fa7af404966be`) is `official_protocol_token` because the
  official website/API identity and the launch transaction agree.
- `asd` (`0x5422663e07d6fc217b0af4532fb1a6c9c7de5555`) is
  `verified_issuer_wallet_launch`: the same verified wallet launched it, but no independent official
  announcement was found. The UI therefore states “同一钱包发行 ≠ PAIR 官方背书”.

Local `npm run verify` passed formatting, lint, typecheck, all 241 tests, coverage gates and the
production build. Desktop and 390 px mobile Playwright checks confirmed the relationship labels,
evidence links and responsive layout. The runtime archive SHA-256 was
`6d8414a2035762a879dbe658e6b863f441216348d3578a0a10287532fcc09e7c`.

The first guarded deployment attempt stopped before changing `current` because the host does not have
the `sqlite3` CLI. The old release and all seven data timers were restored immediately. A second guarded
attempt created and integrity-checked the backup with Node's SQLite API, then automatically rolled back
after an overly strict post-switch gate. Direct execution of the new read model against that production
backup returned both expected rows, and the staged release ownership was normalized to `root:root`.
The final atomic switch then succeeded without a database migration.

Post-cutover loopback and public HTTPS readback reported package `0.13.2`, scope
`pair_official_team_launches`, two rows, one official protocol token and one same-wallet unconfirmed
launch. The main service was `active` with `NRestarts=0`, and all seven data timers were active. A
browser-level production readback confirmed the populated board at `/pair-v2/`.

Server autonomy was verified across a complete polling window. The DEV monitor advanced from confirmed
block `55,959,588` at `2026-09-06T11:58:08.246Z` to `55,960,243` at
`2026-09-06T11:59:15.825Z`; canonical projects increased from 7,465 to 7,490 and watched addresses from
23 to 24. PAIR V2, both Pons v1 sources, Pons v2, Long and DEV-buy sources were all `ok`, with no warning.
This is server-process readback, not a browser-triggered refresh or a local Codex schedule.
