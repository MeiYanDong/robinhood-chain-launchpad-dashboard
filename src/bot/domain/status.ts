import type { OverviewResponse } from "../../domain/types.js";
import type { LedgerHealthResponse, LedgerSourcesResponse } from "../ledger/contract.js";
import type { LedgerMetaResponse } from "../../domain/types.js";

export interface StatusResult {
  ready: boolean;
  ledgerReachable: boolean;
  contractCompatible: boolean;
  contractVersion: number | null;
  targetDate: string | null;
  stale: boolean;
  latestRunStatus: string;
  sourceCounts: { ok: number; degraded: number; failed: number };
}

export function buildStatusResult(input: {
  health: LedgerHealthResponse | null;
  meta: LedgerMetaResponse | null;
  sources: LedgerSourcesResponse | null;
  overview: OverviewResponse | null;
  contractCompatible: boolean;
}): StatusResult {
  const sourceCounts = { ok: 0, degraded: 0, failed: 0 };
  for (const source of input.sources?.sources ?? []) sourceCounts[source.status] += 1;
  const ledgerReachable =
    input.health !== null ||
    input.meta !== null ||
    input.sources !== null ||
    input.overview !== null;
  return {
    ready: input.health?.ok === true && input.contractCompatible,
    ledgerReachable,
    contractCompatible: input.contractCompatible,
    contractVersion: input.meta?.apiContractVersion ?? null,
    targetDate:
      input.overview?.targetDate ?? input.health?.targetDate ?? input.meta?.targetDate ?? null,
    stale: input.overview?.stale ?? true,
    latestRunStatus:
      input.sources?.latestRun?.status ?? input.health?.latestRunStatus ?? "unavailable",
    sourceCounts,
  };
}
