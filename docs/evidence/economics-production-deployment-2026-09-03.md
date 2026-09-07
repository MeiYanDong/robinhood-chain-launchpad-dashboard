# Economics comparison production deployment — 2026-09-03

Evidence level: `verified_current` at deployment time. Market values and source health are point-in-time
observations and will drift.

## Release and rollback

- Target: Alibaba Cloud SWAS `robinhood-chain-radar`, instance
  `ceff28ff463440c09d8666b0f081bc7f`, public IP `47.251.99.37`.
- Active release: `/opt/robinhood-chain-launchpad/releases/20260902T170709Z`, package `0.7.0`.
- Artifact SHA-256: `a2f76acdd90159654933823b96771721e4ee921fbbaa5b44b12d9a7ab2dd1734`.
- Previous release and rollback target:
  `/opt/robinhood-chain-launchpad/releases/20260901T154456Z`, package `0.6.0`.
- Configuration backup: `/opt/robinhood-chain-launchpad/deploy-backups/20260902T170709Z`.
- The protected environment file was reused unchanged. No wallet key, signing material or transaction
  capability was added.

## Runtime result

The deployment added the Pons / Long / PAIR economics comparison and an internal snapshot rebuild timer.
The timer runs every 15 minutes at minutes `10,25,40,55`, after the existing PAIR and Long ranking jobs.
Its internal `POST /api/economics/rebuild` route is blocked by public Nginx with HTTP `403`.

The first public economics response exposed a transport-specific failure: Nginx completed a 16,599-byte
response, but the external path stopped near 9.9 KB. JSON gzip was enabled for clients that advertise it.
The decoded payload remains 16,599 bytes while the observed wire payload became 3,554 bytes; the fixed
runtime verifier then parsed the complete response successfully.

A one-time internal full refresh after release produced this source state for closed UTC day `2026-09-01`:

| Source | Result |
| --- | --- |
| PAIR official token API | `ok` |
| PONS GMGN token market | `ok` |
| Robinhood RPC supply and burn | `ok` |
| Pons official daily volume | `ok` |
| PAIR official daily volume | `ok` |
| Long platform closed-day volume | `degraded` |

The comparison therefore remains honestly `partial`: Long token rankings and its dynamic market-cap leader
are usable, but the production host still lacks Long platform-level closed-day volume, so the three-platform
daily volume share is not calculated.

Point-in-time representative tokens read back from production:

| Platform | Token | Address |
| --- | --- | --- |
| Pons | PONS | `0x39dbed3a2bd333467115de45665cc57f813c4571` |
| Long | AI | `0x2e8c31162b855a2ffa90f6f8634643ad6f111e18` |
| PAIR | PAIR | `0x6b1d42927b1a84ec28fa88d4fc6fa7af404966be` |

## Public and service readback

| Check | Result |
| --- | --- |
| `/healthz` | `200` |
| `/api/overview?window=30` | `200`, 49 platforms |
| `/api/sources` | `200`, 14 sources |
| `/api/pair/health` and `/api/pair/rankings` | `200`, 10 eligible tokens |
| `/api/long/health` and `/api/long/rankings` | `200`, 75 eligible samples |
| `/api/economics/health` and `/api/economics` | `200`, 3 platforms |
| public `POST /api/economics/rebuild` | `403` |
| original `http://47.251.99.37/api/latest` | `200` |
| original `http://47.251.99.37/cashcat/` | `200` |

`robinhood-chain-launchpad.service` was `active/running` with `NRestarts=0`, `ExecMainStatus=0` and no
warning-level journal entries after the switch. `robinhood-chain-economics-refresh.service` completed with
`Result=success`; its timer was `active/waiting`.

Browser readback at a 365-pixel viewport confirmed the default comparison, all three representative-token
rows, all three platform rows, all three buyback rows, PAIR and Long tab switching, no page-level horizontal
overflow and no console warning or error.
