# Fake DeBox fixtures

This directory contains the minimum, provider-independent events used by the Phase 1 local prototype.

- `events.ts` creates private text, group mention, group non-mention, and unsupported-message fixtures.
- Identifiers are deliberately obvious ephemeral test values and are never written to telemetry or structured logs.
- The cursor used by `FakeDeBoxTransport` is a replaceable test protocol. It is not evidence of DeBox's official offset or acknowledgement semantics.
- No fixture contains a real App Key, App Secret, account, group, user, or Bot identity.
