# RHC Launch Ledger Bot local prototype runbook

## Scope

This runbook verifies the Phase 1 credential-free prototype only. It does not create or connect a real DeBox Bot, read a Secret, call a paid model, deploy a service, modify the dashboard process, or prove production behavior.

## Prerequisites

- Node.js 22.5 or newer;
- locked dependencies installed with `npm ci`;
- no DeBox or model credentials are required.

## Commands

```bash
npm run typecheck:bot
npm run test:bot
npm run test:bot:integration
npm run fixture:replay
npm run bot:fake
npm run benchmark:bot
npm run verify
```

Expected boundaries:

- `bot:fake` prints `mode: fixture-only`, `externalNetworkUsed: false`, and `realCredentialsUsed: false`;
- Ledger requests are limited to the documented GET allowlist;
- no request may contain `/api/refresh` or a non-GET method;
- fake replies are pure text and preserve the fixture cutoff date and warnings;
- `benchmark:bot` exits non-zero if its local thresholds fail;
- `verify` runs formatting, lint, test-aware type checking, whole-source coverage, all tests, and build.

## Runtime health contract

The independent Bot health handler binds only to `127.0.0.1` and exposes:

- `/livez`: process responds, independent of readiness;
- `/readyz`: configuration, identity/fake readiness, active/backoff polling, Ledger reachability, and API contract compatibility are all acceptable;
- `/healthz`: current combined snapshot.

The payload contains no message, user, group, update, credential, internal URL, or raw exception value.

## Stop boundary

Do not install an SDK, configure credentials, create a Bot, start a production daemon, change Nginx/TLS/firewall settings, or submit a Grant from this runbook. Those actions begin at GATE-02 and require explicit user decisions.
