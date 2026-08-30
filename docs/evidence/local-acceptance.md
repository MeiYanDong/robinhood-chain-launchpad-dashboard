# Phase 1 local acceptance report

Evidence date: 2026-08-30  
Branch at execution: `feat/debox-bot-local-prototype`  
Starting commit: `e2a7217e340a78deb255de6ecd499aae44404885`  
Evidence class: `local_verified`, fixture-only

## Scope and non-claims

This report covers the credential-free RHC Launch Ledger Bot prototype using typed Ledger fixtures, `FakeDeBoxTransport`, and `StubLlmProvider`. It proves local behavior and merge readiness only.

It does not prove a real DeBox SDK contract, Bot identity, App Key/Secret, real message delivery, production uptime, server deployment, public release, user adoption, Grant eligibility, or Grant submission. No real DeBox account, Secret, paid model, wallet, server, domain, TLS, Nginx, firewall, permission, review group, or Grant form was accessed or changed.

## Environment

- macOS Darwin arm64, Apple M5, 10 logical CPUs, 16 GiB memory.
- Local Node `v25.9.0`; npm `11.12.1`.
- Declared minimum Node `>=22.5`; GitHub Actions target Node 22.
- Package `0.4.0`; API contract v1.

## Merge-grade command evidence

| Command | Result |
| --- | --- |
| `npm run verify` | exit 0; format, lint, typecheck, coverage, 122/122 tests, and build passed |
| `npm run test:bot` | exit 0; 88/88 Bot tests passed |
| `npm run fixture:replay` | exit 0; 20/20 integration and polling replay tests passed |
| `npm run bot:fake` | exit 0; 3 fixture events produced controlled replies; no external network or credentials |
| `npm run benchmark:bot` | exit 0; local thresholds passed |
| `npm audit --audit-level=high` | exit 0; 0 vulnerabilities |

Whole-source coverage from the final `verify` run:

- statements/lines: 82.52%;
- branches: 83.39%;
- functions: 91.03%;
- configured gates: statements/lines 70%, branches 70%, functions 75%.

## Acceptance criteria

| AC | Result | Automated evidence |
| --- | --- | --- |
| AC-01 six commands | PASS | `test/bot/integration.test.ts`: `/start`, `/help`, `/rank`, `/platform`, `/why`, `/status` |
| AC-02 core queries | PASS | default rank, 7d fees, LetsCash 30d, Bankr income explanation, status |
| AC-03 Ledger-number equality | PASS | typed fixture values remain `$5.00K`, `$3.00K`, `$0`, `$350.00`, `$36.00`; no model calculation |
| AC-04 zero/null/quality/coverage | PASS | rank, platform, formatter, and Ledger-contract tests distinguish every field |
| AC-05 1d versus rolling24h | PASS | platform result and snapshot explicitly say rolling 24H is not complete-day 1d |
| AC-06 suite-wide isolation | PASS | StonkBrokers `$9.00K` is an incomparable observation and never a ranked row |
| AC-07 stale/partial visibility | PASS | refresh failure, stale date, failed source, partial/scope/derived warnings remain above results |
| AC-08 LLM only creates QueryPlan | PASS | minimal input, strict prompt, one-call cap, timeout/budget/busy/invalid-output fail-closed tests |
| AC-09 duplicate update idempotency | PASS | duplicate events do not send a second reply; partial segment retry resumes only unsent segments |
| AC-10 GET-only boundary | PASS | fixed allowlist, redirect manual, SSRF/path/method/refresh negatives, architecture import checks |
| AC-11 privacy | PASS | structured logs and telemetry reject raw text and stable identity; 180-day aggregate pruning tested |
| AC-12 HTTPS detail URL | PASS | configured HTTPS base plus controlled platform slug only; HTTP/javascript/data/traversal rejected |
| AC-13 incompatible contract | PASS | rank stops; local help and restricted status remain; readiness retains incompatible state |
| AC-14 process isolation | PASS | dashboard default `start`/`dev` remain unchanged; server has no Bot import; message failures do not exit the Bot loop |

## Performance and pressure

`npm run benchmark:bot` used fixed local fixtures:

| Path | Samples | p50 | p95 | Max | Target |
| --- | ---: | ---: | ---: | ---: | ---: |
| deterministic `/rank` | 200 | 0.036 ms | 0.118 ms | 40.720 ms | p95 ≤ 3000 ms |
| stub-AI QueryPlan path | 100 | 0.095 ms | 0.163 ms | 7.655 ms | p95 ≤ 10000 ms |

- Maximum normal reply segment: 252 characters; target ≤1500, hard limit 5000.
- Configured Ledger timeout: 3000 ms; configured benchmark LLM timeout: 5000 ms.
- 200 simultaneous fake updates: 4 sent through the domain path, 196 failed fast with an explicit rate-limit reply, maximum domain concurrency 4 against configured limit 4.
- The benchmark observed a non-positive heap delta after the pressure sample; the automated pressure regression additionally asserts heap growth below 64 MiB. This is a bounded local stress signal, not a production capacity claim.

## Security regression

Automated tests cover SSRF and arbitrary URL rejection, path traversal, redirect refusal, fixed GET method, prompt injection, unknown QueryPlan fields, SQL/shell/tool/refresh tokens, oversized text, unsafe detail schemes, Secret/ID/log-injection bait, telemetry extra fields, source/schema corruption, and raw-exception sanitization.

## Defects found and corrected during Phase 1

1. The original shell glob could silently run only `test/bot` after that directory appeared. Scripts now enumerate root and nested test patterns, and the final suite includes both dashboard and Bot tests.
2. Poller shutdown left a resolved 5-second timeout alive, delaying process exit. The timer is now cleared when the loop ends first.
3. A restricted successful `/status` reply after contract incompatibility incorrectly reset health compatibility to true. Reachability and contract compatibility now propagate independently.
4. Runtime logging previously spread the provided object and could retain extra fields if types were bypassed. The logger now reconstructs the five-field safe event explicitly.

## Remaining gates

Phase 1 exits are satisfied locally. Phase 2 cannot start until the applicable GATE-02 through GATE-08 decisions are explicitly approved: locked SDK/dependency, dedicated DeBox account, Bot identity, irreversible Bot creation, model/budget choice, Secret configuration, and trial-server deployment. GATE-09 through GATE-12 remain closed unless later scope requires them.
