# Bot telemetry measurement boundary

The Phase 1 Bot records anonymous aggregate buckets only. Each bucket contains:

- UTC date;
- action and private/group channel class;
- outcome and latency bucket;
- whether the optional resolver was used;
- stale flag;
- quality-warning count;
- failed-source count and source count;
- aggregate count.

The schema cannot store raw messages, free text, user IDs, chat IDs, update IDs, wallets, stable hashes, fingerprints, or other identity-bearing values. State lives in a Bot-specific SQLite file and is pruned to a configurable retention window, defaulting to 180 days. It never writes the Launch Ledger database.

Consequently, Phase 1 cannot truthfully measure or claim:

- unique users;
- user retention;
- revisit/return rate;
- per-user funnels;
- wallet conversion;
- message transcripts or qualitative feedback.

An optional voluntary-sample-report feature flag exists only as a disabled/not-implemented shell. It performs no upload in Phase 1. Any future identity-bearing or external reporting design requires a separate privacy decision and implementation gate.
