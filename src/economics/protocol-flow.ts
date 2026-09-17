import type { EconomicsSettings } from "./config.js";
import type {
  ProtocolBurnCoverage,
  ProtocolBurnDay,
  ProtocolBurnHistoryObservation,
  ProtocolBurnTransfer,
} from "./types.js";
import { fetchJsonBrowser, finiteNumber, isRecord } from "../utils/http.js";

const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;
const TX_PATTERN = /^0x[0-9a-f]{64}$/;

function scaledTokenAmount(rawValue: string, decimals: number): number | null {
  if (!/^\d+$/.test(rawValue) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    return null;
  }
  const raw = BigInt(rawValue);
  const divisor = 10n ** BigInt(decimals);
  const value = Number(raw / divisor) + Number(raw % divisor) / Number(divisor);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function parseProtocolBurnTransfers(
  payload: unknown,
  tokenAddress: string,
  deadAddress: string,
  buybackWallets: Iterable<string>,
): ProtocolBurnTransfer[] {
  if (!ADDRESS_PATTERN.test(tokenAddress) || !ADDRESS_PATTERN.test(deadAddress)) {
    throw new Error("Protocol burn address configuration is invalid");
  }
  if (!isRecord(payload)) throw new Error("Blockscout burn payload is not an object");
  const rawRows = payload.result;
  if (payload.status === "0" && typeof rawRows === "string" && /no transactions/i.test(rawRows)) {
    return [];
  }
  if (!Array.isArray(rawRows)) throw new Error("Blockscout burn payload has no result array");
  const token = tokenAddress.toLowerCase();
  const dead = deadAddress.toLowerCase();
  const actors = new Set([...buybackWallets].map((address) => address.toLowerCase()));
  const dedupe = new Set<string>();
  const transfers: ProtocolBurnTransfer[] = [];
  for (const row of rawRows) {
    if (!isRecord(row)) continue;
    const contract =
      typeof row.contractAddress === "string" ? row.contractAddress.toLowerCase() : "";
    const from = typeof row.from === "string" ? row.from.toLowerCase() : "";
    const to = typeof row.to === "string" ? row.to.toLowerCase() : "";
    const txHash = typeof row.hash === "string" ? row.hash.toLowerCase() : "";
    const blockNumber = finiteNumber(row.blockNumber);
    const timestampSeconds = finiteNumber(row.timeStamp);
    const decimals = finiteNumber(row.tokenDecimal);
    const amountTokens =
      typeof row.value === "string" && decimals !== null
        ? scaledTokenAmount(row.value, decimals)
        : null;
    if (
      contract !== token ||
      to !== dead ||
      !ADDRESS_PATTERN.test(from) ||
      !TX_PATTERN.test(txHash) ||
      blockNumber === null ||
      !Number.isInteger(blockNumber) ||
      timestampSeconds === null ||
      !Number.isInteger(timestampSeconds) ||
      amountTokens === null
    ) {
      continue;
    }
    const identity = `${txHash}:${from}:${row.value}`;
    if (dedupe.has(identity)) continue;
    dedupe.add(identity);
    transfers.push({
      tokenAddress: token,
      txHash,
      blockNumber,
      timestamp: new Date(timestampSeconds * 1_000).toISOString(),
      from,
      amountTokens,
      inferredBuyback: actors.has(from),
    });
  }
  return transfers.sort(
    (left, right) =>
      Date.parse(left.timestamp) - Date.parse(right.timestamp) ||
      left.blockNumber - right.blockNumber ||
      left.txHash.localeCompare(right.txHash),
  );
}

function utcDates(startDate: string, endDate: string): string[] {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return [];
  const dates: string[] = [];
  for (let cursor = start; cursor <= end; cursor += 86_400_000) {
    dates.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return dates;
}

export function aggregateProtocolBurnDays(input: {
  tokenAddress: string;
  transfers: ProtocolBurnTransfer[];
  observedAt: string;
  completeHistory: boolean;
}): ProtocolBurnDay[] {
  if (input.transfers.length === 0) return [];
  const coverageStartAt = input.transfers[0]?.timestamp;
  if (!coverageStartAt) return [];
  const firstDate = coverageStartAt.slice(0, 10);
  const lastDate = input.observedAt.slice(0, 10);
  const byDate = new Map<string, ProtocolBurnDay>();
  for (const date of utcDates(firstDate, lastDate)) {
    byDate.set(date, {
      tokenAddress: input.tokenAddress.toLowerCase(),
      date,
      burnedTokens: 0,
      inferredBuybackTokens: 0,
      burnEventCount: 0,
      inferredBuybackEventCount: 0,
      complete: input.completeHistory || date > firstDate,
      observedAt: input.observedAt,
      source: "blockscout.account.tokentx",
    });
  }
  for (const transfer of input.transfers) {
    const day = byDate.get(transfer.timestamp.slice(0, 10));
    if (!day) continue;
    day.burnedTokens += transfer.amountTokens;
    day.burnEventCount += 1;
    if (transfer.inferredBuyback) {
      day.inferredBuybackTokens += transfer.amountTokens;
      day.inferredBuybackEventCount += 1;
    }
  }
  return [...byDate.values()];
}

async function fetchTokenBurns(
  settings: EconomicsSettings,
  tokenAddress: string,
  buybackWallets: string[],
): Promise<{ days: ProtocolBurnDay[]; coverage: ProtocolBurnCoverage }> {
  const url = new URL(settings.blockscoutApiUrl);
  url.searchParams.set("module", "account");
  url.searchParams.set("action", "tokentx");
  url.searchParams.set("address", settings.deadAddress);
  url.searchParams.set("contractaddress", tokenAddress);
  url.searchParams.set("page", "1");
  url.searchParams.set("offset", String(Math.trunc(settings.burnHistoryLimit)));
  url.searchParams.set("sort", "desc");
  const fetched = await fetchJsonBrowser(url.toString(), {
    timeoutMs: settings.requestTimeoutMs,
    retries: 1,
  });
  const transfersDescending = parseProtocolBurnTransfers(
    fetched.payload,
    tokenAddress,
    settings.deadAddress,
    buybackWallets,
  );
  const transfers = transfersDescending.sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp),
  );
  const rowCount =
    isRecord(fetched.payload) && Array.isArray(fetched.payload.result)
      ? fetched.payload.result.length
      : 0;
  const completeHistory = rowCount < settings.burnHistoryLimit;
  return {
    days: aggregateProtocolBurnDays({
      tokenAddress,
      transfers,
      observedAt: fetched.fetchedAt,
      completeHistory,
    }),
    coverage: {
      tokenAddress: tokenAddress.toLowerCase(),
      observedAt: fetched.fetchedAt,
      coverageStartAt: transfers[0]?.timestamp ?? null,
      rowCount,
      completeHistory,
      source: "blockscout.account.tokentx",
    },
  };
}

export async function collectProtocolBurnHistory(
  settings: EconomicsSettings,
): Promise<ProtocolBurnHistoryObservation> {
  const successful: Array<{ days: ProtocolBurnDay[]; coverage: ProtocolBurnCoverage }> = [];
  const failedTokenAddresses: string[] = [];
  try {
    successful.push(
      await fetchTokenBurns(settings, settings.ponsTokenAddress, [settings.ponsBuybackWallet]),
    );
  } catch {
    failedTokenAddresses.push(settings.ponsTokenAddress);
  }
  // The public explorer is shared infrastructure. Keep the second request
  // deliberately serial and spaced rather than spending paid RPC quota.
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  try {
    successful.push(await fetchTokenBurns(settings, settings.pairTokenAddress, []));
  } catch {
    failedTokenAddresses.push(settings.pairTokenAddress);
  }
  if (successful.length === 0) throw new Error("Public burn history sources are unavailable");
  const observedAt =
    successful
      .map((result) => result.coverage.observedAt)
      .sort()
      .at(-1) ?? new Date().toISOString();
  return {
    observedAt,
    days: successful.flatMap((result) => result.days),
    coverage: successful.map((result) => result.coverage),
    failedTokenAddresses,
  };
}
