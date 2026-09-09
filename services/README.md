# Independent data services

This repository is the canonical source for the public Robinhood Chain Radar product and its three
read-only data planes. They share product contracts and CI, but they do not share processes,
databases, credentials, or release lifecycles.

| Directory | Responsibility | Production loopback | Public use |
| --- | --- | --- | --- |
| repository root | Launchpad, leader, PAIR and unified product read model | `127.0.0.1:4175/4176` | Product UI and `/api/product/*` |
| `chain-daily/` | Closed UTC-day chain fundamentals | `127.0.0.1:4173` | `/api/latest`, `/api/history`, `/api/snapshot` |
| `cashcat/` | Live CashCat thesis receipts and daily evidence | `127.0.0.1:8010` | `/cashcat/api/*`, `/cashcat/reports/*` |

The unified UI reads a bounded projection from each service. A missing source remains unavailable;
it is never filled with zero. CashCat live snapshots and closed UTC-day chain metrics remain visibly
separate even when they appear on the same page.

## Local verification

```bash
# Main product
npm ci
npm run verify

# Closed-day chain service
npm --prefix services/chain-daily ci
npm --prefix services/chain-daily run check
npm --prefix services/chain-daily test

# CashCat service
python3 -m venv /tmp/rhc-cashcat-venv
/tmp/rhc-cashcat-venv/bin/pip install -r services/cashcat/requirements.txt
PYTHONPATH=services/cashcat /tmp/rhc-cashcat-venv/bin/python -m unittest discover \
  -s services/cashcat/tests -p 'test_*.py'
```

Production state is intentionally absent from Git. Do not commit `.env` files, API keys, SQLite
databases, generated reports, Playwright captures, or downloaded market data.
