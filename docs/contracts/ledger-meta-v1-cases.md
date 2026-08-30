# Ledger meta v1 样例判定

- compatible：ledger-meta-v1.example.json，预期通过并开放表内平台。
- incompatible：把 apiContractVersion 改为 2，预期 VERSION_NOT_AVAILABLE；rank/platform/why fail closed，help 与受限 status 可用。
- missing：移除 coreMetrics 或 platforms，预期 CONTRACT_INCOMPATIBLE。
- extra：增加未知顶层字段，v1 validator 可忽略但不能据此开启新能力；关键字段仍严格校验。
