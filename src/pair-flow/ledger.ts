import type { PairAddressTransfer } from "./types.js";

type PairLotCategory = "direct_fee" | "market_acquired" | "unattributed";

interface PairLot {
  category: PairLotCategory;
  amount: number;
}

export interface PairFlowLedgerSummary {
  cumulativeDirectFeePair: number;
  cumulativeMarketAcquiredPair: number;
  cumulativeUnattributedPair: number;
  burnedDirectFeePair: number;
  burnedMarketAcquiredPair: number;
  burnedUnattributedPair: number;
  todayBurnedPair: number;
  todayDirectFeeBurnedPair: number;
  todayMarketAcquiredBurnedPair: number;
  todayUnattributedBurnedPair: number;
  pendingDirectFeePair: number;
  pendingMarketAcquiredPair: number;
  pendingUnattributedPair: number;
  observedFeeSpyReceived: number;
  observedSpySwapSpend: number;
  reconstructedPairBalance: number;
}

interface LedgerSettings {
  pairTokenAddress: string;
  spyTokenAddress: string;
  lockerAddress: string;
  poolManagerAddress: string;
  swapAdapterAddresses: string[];
  deadAddress: string;
  trackedWallets: string[];
  calendarStartAt: string;
}

function tokenAmount(transfer: PairAddressTransfer): number | null {
  if (transfer.decimals < 0 || transfer.decimals > 36) return null;
  const divisor = 10n ** BigInt(transfer.decimals);
  const whole = transfer.rawValue / divisor;
  const fraction = transfer.rawValue % divisor;
  const value = Number(whole) + Number(fraction) / Number(divisor);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function transferKey(transfer: PairAddressTransfer): string {
  return [
    transfer.hash,
    transfer.logIndex ?? "?",
    transfer.token,
    transfer.from,
    transfer.to,
    transfer.rawValue.toString(),
  ].join(":");
}

function uniqueTransfers(transfers: PairAddressTransfer[]): PairAddressTransfer[] {
  const seen = new Set<string>();
  return transfers
    .filter((transfer) => {
      const key = transferKey(transfer);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(
      (left, right) =>
        left.blockNumber - right.blockNumber ||
        (left.logIndex ?? 0) - (right.logIndex ?? 0) ||
        left.hash.localeCompare(right.hash),
    );
}

function addLot(queues: Map<string, PairLot[]>, wallet: string, lot: PairLot): void {
  if (!(lot.amount > 0)) return;
  const queue = queues.get(wallet) ?? [];
  const last = queue.at(-1);
  if (last?.category === lot.category) last.amount += lot.amount;
  else queue.push({ ...lot });
  queues.set(wallet, queue);
}

function consumeLots(queues: Map<string, PairLot[]>, wallet: string, amount: number): PairLot[] {
  const queue = queues.get(wallet) ?? [];
  const consumed: PairLot[] = [];
  let remaining = amount;
  while (remaining > 1e-12 && queue.length > 0) {
    const lot = queue[0];
    if (!lot) break;
    const taken = Math.min(remaining, lot.amount);
    consumed.push({ category: lot.category, amount: taken });
    lot.amount -= taken;
    remaining -= taken;
    if (lot.amount <= 1e-12) queue.shift();
  }
  if (remaining > 1e-12) consumed.push({ category: "unattributed", amount: remaining });
  queues.set(wallet, queue);
  return consumed;
}

function sumCategory(lots: PairLot[], category: PairLotCategory): number {
  return lots.filter((lot) => lot.category === category).reduce((sum, lot) => sum + lot.amount, 0);
}

export function buildPairFlowLedger(
  transfers: PairAddressTransfer[],
  settings: LedgerSettings,
): PairFlowLedgerSummary {
  const pair = settings.pairTokenAddress.toLowerCase();
  const spy = settings.spyTokenAddress.toLowerCase();
  const locker = settings.lockerAddress.toLowerCase();
  const dead = settings.deadAddress.toLowerCase();
  const marketAddresses = new Set([
    settings.poolManagerAddress.toLowerCase(),
    ...settings.swapAdapterAddresses.map((address) => address.toLowerCase()),
  ]);
  const tracked = new Set(settings.trackedWallets.map((address) => address.toLowerCase()));
  const queues = new Map<string, PairLot[]>();
  const summary: PairFlowLedgerSummary = {
    cumulativeDirectFeePair: 0,
    cumulativeMarketAcquiredPair: 0,
    cumulativeUnattributedPair: 0,
    burnedDirectFeePair: 0,
    burnedMarketAcquiredPair: 0,
    burnedUnattributedPair: 0,
    todayBurnedPair: 0,
    todayDirectFeeBurnedPair: 0,
    todayMarketAcquiredBurnedPair: 0,
    todayUnattributedBurnedPair: 0,
    pendingDirectFeePair: 0,
    pendingMarketAcquiredPair: 0,
    pendingUnattributedPair: 0,
    observedFeeSpyReceived: 0,
    observedSpySwapSpend: 0,
    reconstructedPairBalance: 0,
  };
  const calendarStart = Date.parse(settings.calendarStartAt);

  for (const transfer of uniqueTransfers(transfers)) {
    const amount = tokenAmount(transfer);
    if (amount === null || amount === 0) continue;
    const from = transfer.from.toLowerCase();
    const to = transfer.to.toLowerCase();
    const token = transfer.token.toLowerCase();
    const fromTracked = tracked.has(from);
    const toTracked = tracked.has(to);

    if (token === spy) {
      if (toTracked && from === locker) summary.observedFeeSpyReceived += amount;
      if (fromTracked && (transfer.method?.toLowerCase() === "swap" || marketAddresses.has(to))) {
        summary.observedSpySwapSpend += amount;
      }
      continue;
    }
    if (token !== pair || from === to) continue;

    if (fromTracked && toTracked) {
      for (const lot of consumeLots(queues, from, amount)) addLot(queues, to, lot);
      continue;
    }

    if (toTracked) {
      const category: PairLotCategory =
        from === locker
          ? "direct_fee"
          : marketAddresses.has(from) || transfer.method?.toLowerCase() === "swap"
            ? "market_acquired"
            : "unattributed";
      addLot(queues, to, { category, amount });
      if (category === "direct_fee") summary.cumulativeDirectFeePair += amount;
      else if (category === "market_acquired") summary.cumulativeMarketAcquiredPair += amount;
      else summary.cumulativeUnattributedPair += amount;
      continue;
    }

    if (fromTracked) {
      const consumed = consumeLots(queues, from, amount);
      if (to !== dead) continue;
      const direct = sumCategory(consumed, "direct_fee");
      const market = sumCategory(consumed, "market_acquired");
      const unattributed = sumCategory(consumed, "unattributed");
      summary.burnedDirectFeePair += direct;
      summary.burnedMarketAcquiredPair += market;
      summary.burnedUnattributedPair += unattributed;
      const timestamp = Date.parse(transfer.timestamp);
      if (Number.isFinite(timestamp) && timestamp >= calendarStart) {
        summary.todayBurnedPair += amount;
        summary.todayDirectFeeBurnedPair += direct;
        summary.todayMarketAcquiredBurnedPair += market;
        summary.todayUnattributedBurnedPair += unattributed;
      }
    }
  }

  for (const queue of queues.values()) {
    summary.pendingDirectFeePair += sumCategory(queue, "direct_fee");
    summary.pendingMarketAcquiredPair += sumCategory(queue, "market_acquired");
    summary.pendingUnattributedPair += sumCategory(queue, "unattributed");
  }
  summary.reconstructedPairBalance =
    summary.pendingDirectFeePair +
    summary.pendingMarketAcquiredPair +
    summary.pendingUnattributedPair;
  return summary;
}
