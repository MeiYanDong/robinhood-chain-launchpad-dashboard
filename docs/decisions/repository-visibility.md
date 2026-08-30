# Repository Visibility Decision

Status: confirmed_decision  
Date: 2026-08-30  
Decision owner: user

## Decision

RHC Launch Ledger and its DeBox Bot will be maintained as a public GitHub project.

The canonical repository name is:

MeiYanDong/robinhood-chain-launchpad-dashboard

## Consequences

- Source code, tests, public architecture documents, ADRs, CI definitions and deployment templates may be published.
- App Key, App Secret, model credentials, server credentials, signed URLs, private messages, DeBox user/group/update identifiers and stable identity hashes must never enter the repository.
- Environment templates may contain variable names and explanations only.
- Local databases, raw runtime logs, Playwright session artifacts, coverage output and generated build output remain ignored.
- Creating the public repository and pushing the reviewed initial history is authorized by the user.
- Production deployment, real DeBox Bot creation, credentials, permission applications and Grant submission remain separately gated.

## Verification

Before every public push:

1. Run the repository Secret/privacy scan.
2. Run the complete quality gate.
3. Review the staged file list.
4. Confirm generated/runtime artifacts are excluded.

