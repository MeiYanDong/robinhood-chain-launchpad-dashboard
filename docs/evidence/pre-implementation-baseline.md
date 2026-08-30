# Pre-implementation Engineering Baseline

Evidence date: 2026-08-30  
Evidence level: verified_current for local commands; repository_record for deployment files; planned for Bot requirements.

## Repository state

- Working directory: /Users/myandong/Projects/Robinhood chain/launchpad-dashboard
- Initial Git state: not a Git repository.
- GitHub inventory: authenticated read succeeded for MeiYanDong; no matching repository was found.
- GitHub code search for rhc-launch-ledger under MeiYanDong returned no result.
- Bot implementation directory src/bot did not exist.
- GET /api/meta and apiContractVersion were not implemented.

## Runtime and package state

- Local Node used for this baseline: v25.9.0.
- Declared minimum Node version: 22.5.
- Package version: 0.4.0.
- Production state in README is historical repository evidence only: version 0.3.0 was recorded as deployed and 0.4.0 as not switched.

## Commands and results

### TypeScript

Command: npm run check

Result:

- Exit code: 0
- Scope caveat: tsconfig.json included src files only, so tests were not part of this type-check.

### Tests

Command: npm test

Result:

- Exit code: 0
- Tests: 19
- Passed: 19
- Failed: 0
- Skipped: 0

### Diagnostic coverage

Command: node --import tsx --test --experimental-test-coverage test/**/*.test.ts

Result:

- Exit code: 0
- Imported-file line coverage: 70.35%
- Imported-file branch coverage: 69.36%
- Imported-file function coverage: 76.85%
- Important limitation: src/server.ts, src/services/dashboard.ts, src/storage/database.ts and src/live-check.ts were not imported by tests and were absent from the report. These percentages are not whole-source coverage and are not accepted as a merge gate.

## Existing strengths

- Exact business assertions cover null versus zero, suite-wide exclusion, Pons canonical grouping, closed UTC-day filtering, first-party source priority, Bankr, LetsCash and Long extraction.
- TypeScript strictness includes strict, noUncheckedIndexedAccess and exactOptionalPropertyTypes.
- Collection, configuration, domain, storage and service responsibilities are separated.
- systemd, timer and Nginx deployment definitions exist.
- README records an immutable-release and runtime-readback procedure.

## High-priority gaps

- No Git revision history, remote repository, PR flow or active CI.
- No lint, formatter or whole-source coverage gate.
- Test TypeScript was not covered by npm run check.
- Server, DashboardService, SQLite and HTTP routes had no automated tests.
- The top-level HTTP error handler returned raw exception messages to clients.
- Deployment files were definitions only; no current runtime readback was performed in this baseline.
- No ADR, changelog or PR-sized story map existed.

## Modification boundary

No build, live-source verification, production access, daemon start, deployment or credential operation was performed during this baseline audit.

## Public repository scan

The pre-push scan checked:

- filenames commonly used for environment files, credentials, private keys and keystores;
- private-key block signatures;
- common GitHub, OpenAI, AWS and Slack live-token signatures;
- assignments to API key, App Secret, password, private key and access-token fields.

Result: zero candidate files or token signatures in the publishable source set.

Runtime-only material was present locally and is intentionally ignored:

- data/launchpad-dashboard.sqlite;
- output/;
- .playwright-cli/;
- dist/;
- coverage and log output.
