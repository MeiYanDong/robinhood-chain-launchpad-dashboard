import type { PairFlowSettings } from "./config.js";
import type {
  PairAddressTransfer,
  PairFlowActorRole,
  PairFlowEvent,
  PairFlowEventAllocation,
  PairFlowEventAsset,
  PairTransactionDetail,
  PairTransactionTokenTransfer,
} from "./types.js";

type LotCategory = PairFlowEventAllocation["category"];

interface PairLot {
  category: LotCategory;
  amount: number;
  sourceTxHash: string | null;
}

interface ActorIdentity {
  role: PairFlowActorRole;
  attribution: "official" | "behavior_inferred";
}

function amount(rawValue: bigint, decimals: number): number | null {
  if (decimals < 0 || decimals > 36) return null;
  const divisor = 10n ** BigInt(decimals);
  const value = Number(rawValue / divisor) + Number(rawValue % divisor) / Number(divisor);
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

function actorMap(settings: PairFlowSettings): Map<string, ActorIdentity> {
  return new Map([
    [settings.creatorAddress.toLowerCase(), { role: "creator", attribution: "official" }],
    [
      settings.treasuryAddress.toLowerCase(),
      { role: "protocol_treasury", attribution: "official" },
    ],
    [
      settings.executorAddress.toLowerCase(),
      { role: "executor_inferred", attribution: "behavior_inferred" },
    ],
  ]);
}

function marketAddresses(settings: PairFlowSettings): Set<string> {
  return new Set([
    settings.poolManagerAddress.toLowerCase(),
    ...settings.swapAdapterAddresses.map((address) => address.toLowerCase()),
  ]);
}

function isMarketPairInflow(
  transfer: PairAddressTransfer,
  pair: string,
  tracked: Map<string, ActorIdentity>,
  market: Set<string>,
): boolean {
  return (
    transfer.token.toLowerCase() === pair &&
    tracked.has(transfer.to.toLowerCase()) &&
    (market.has(transfer.from.toLowerCase()) || transfer.method?.toLowerCase() === "swap")
  );
}

export function pairFlowCandidateTransactionHashes(
  transfers: PairAddressTransfer[],
  settings: PairFlowSettings,
): string[] {
  const pair = settings.pairTokenAddress.toLowerCase();
  const dead = settings.deadAddress.toLowerCase();
  const tracked = actorMap(settings);
  const market = marketAddresses(settings);
  return [
    ...new Set(
      uniqueTransfers(transfers)
        .filter(
          (transfer) =>
            isMarketPairInflow(transfer, pair, tracked, market) ||
            (transfer.token.toLowerCase() === pair &&
              tracked.has(transfer.from.toLowerCase()) &&
              transfer.to.toLowerCase() === dead),
        )
        .map((transfer) => transfer.hash),
    ),
  ];
}

function addLot(queues: Map<string, PairLot[]>, wallet: string, lot: PairLot): void {
  if (!(lot.amount > 0)) return;
  const queue = queues.get(wallet) ?? [];
  const last = queue.at(-1);
  if (last?.category === lot.category && last.sourceTxHash === lot.sourceTxHash) {
    last.amount += lot.amount;
  } else {
    queue.push({ ...lot });
  }
  queues.set(wallet, queue);
}

function consumeLots(queues: Map<string, PairLot[]>, wallet: string, requested: number): PairLot[] {
  const queue = queues.get(wallet) ?? [];
  const consumed: PairLot[] = [];
  let remaining = requested;
  while (remaining > 1e-12 && queue.length > 0) {
    const lot = queue[0];
    if (!lot) break;
    const taken = Math.min(remaining, lot.amount);
    consumed.push({ ...lot, amount: taken });
    lot.amount -= taken;
    remaining -= taken;
    if (lot.amount <= 1e-12) queue.shift();
  }
  if (remaining > 1e-12) {
    consumed.push({ category: "unattributed", amount: remaining, sourceTxHash: null });
  }
  queues.set(wallet, queue);
  return consumed;
}

function tokenTransferAmount(transfer: PairTransactionTokenTransfer): number | null {
  return amount(transfer.rawValue, transfer.decimals);
}

function stableSymbol(symbol: string | null): boolean {
  return Boolean(symbol && /^(USDG|USDC|USDT|DAI|USDE)$/i.test(symbol));
}

function indexedUsd(amountValue: number, price: number | null): number | null {
  return price !== null && Number.isFinite(price) ? amountValue * price : null;
}

function aggregateAssets(transfers: PairTransactionTokenTransfer[]): PairFlowEventAsset[] {
  const grouped = new Map<string, PairFlowEventAsset>();
  for (const transfer of transfers) {
    const tokenAmount = tokenTransferAmount(transfer);
    if (tokenAmount === null || tokenAmount === 0) continue;
    const key = transfer.token.toLowerCase();
    const usdValue = indexedUsd(tokenAmount, transfer.tokenPriceUsd);
    const existing = grouped.get(key);
    if (existing) {
      existing.amount += tokenAmount;
      existing.usdValue =
        existing.usdValue !== null && usdValue !== null ? existing.usdValue + usdValue : null;
      continue;
    }
    grouped.set(key, {
      token: key,
      symbol: transfer.symbol ?? "TOKEN",
      amount: tokenAmount,
      usdValue,
      valuation: usdValue === null ? "unknown" : "indexed_price_estimate",
    });
  }
  return [...grouped.values()];
}

function buybackEconomics(
  detail: PairTransactionDetail | undefined,
  actor: string,
  pairToken: string,
  poolManager: string,
  pairAmount: number,
): {
  inputAssets: PairFlowEventAsset[];
  usdValue: number | null;
  usdValuation: PairFlowEvent["usdValuation"];
} {
  if (!detail) return { inputAssets: [], usdValue: null, usdValuation: "unknown" };

  let inputAssets: PairFlowEventAsset[] = [];
  if (detail.from === actor && detail.rawNativeValue > 0n) {
    const nativeAmount = amount(detail.rawNativeValue, 18) ?? 0;
    const wrapped = detail.tokenTransfers.find((transfer) => transfer.symbol === "WETH");
    const usdValue = indexedUsd(nativeAmount, wrapped?.tokenPriceUsd ?? null);
    inputAssets = [
      {
        token: null,
        symbol: "ETH",
        amount: nativeAmount,
        usdValue,
        valuation: usdValue === null ? "unknown" : "indexed_price_estimate",
      },
    ];
  } else {
    inputAssets = aggregateAssets(
      detail.tokenTransfers.filter(
        (transfer) =>
          transfer.from === actor && transfer.token.toLowerCase() !== pairToken.toLowerCase(),
      ),
    );
  }

  const terminalInputs: PairTransactionTokenTransfer[] = [];
  let pendingPoolInput: PairTransactionTokenTransfer | null = null;
  for (const transfer of detail.tokenTransfers) {
    if (transfer.to === poolManager) pendingPoolInput = transfer;
    if (transfer.from !== poolManager) continue;
    if (transfer.token.toLowerCase() === pairToken.toLowerCase() && pendingPoolInput) {
      terminalInputs.push(pendingPoolInput);
    }
    pendingPoolInput = null;
  }
  const terminalValues = terminalInputs.map((transfer) => {
    const tokenAmount = tokenTransferAmount(transfer);
    if (tokenAmount === null) return null;
    return stableSymbol(transfer.symbol)
      ? tokenAmount
      : indexedUsd(tokenAmount, transfer.tokenPriceUsd);
  });
  if (terminalValues.length > 0 && terminalValues.every((value) => value !== null)) {
    return {
      inputAssets,
      usdValue: terminalValues.reduce((sum, value) => sum + (value ?? 0), 0),
      usdValuation: terminalInputs.every((transfer) => stableSymbol(transfer.symbol))
        ? "settlement_observed"
        : "indexed_price_estimate",
    };
  }

  const knownInputUsd = inputAssets.reduce(
    (sum, asset) => (asset.usdValue === null ? sum : sum + asset.usdValue),
    0,
  );
  if (knownInputUsd > 0) {
    return { inputAssets, usdValue: knownInputUsd, usdValuation: "indexed_price_estimate" };
  }
  const pairTransfer = detail.tokenTransfers.find(
    (transfer) => transfer.token.toLowerCase() === pairToken.toLowerCase(),
  );
  const pairUsd = indexedUsd(pairAmount, pairTransfer?.tokenPriceUsd ?? null);
  return {
    inputAssets,
    usdValue: pairUsd,
    usdValuation: pairUsd === null ? "unknown" : "indexed_price_estimate",
  };
}

function aggregateAllocations(lots: PairLot[]): PairFlowEventAllocation[] {
  const grouped = new Map<string, PairFlowEventAllocation>();
  for (const lot of lots) {
    const key = `${lot.category}:${lot.sourceTxHash ?? "unknown"}`;
    const existing = grouped.get(key);
    if (existing) existing.pairAmount += lot.amount;
    else {
      grouped.set(key, {
        category: lot.category,
        pairAmount: lot.amount,
        sourceTxHash: lot.sourceTxHash,
      });
    }
  }
  return [...grouped.values()];
}

function burnCategory(allocations: PairFlowEventAllocation[]): PairFlowEvent["category"] {
  const categories = new Set(allocations.map((allocation) => allocation.category));
  if (categories.size > 1) return "mixed_burn";
  if (categories.has("direct_fee")) return "direct_fee_burn";
  if (categories.has("market_acquired")) return "market_buy_burn";
  return "unattributed_burn";
}

export function buildPairFlowEvents(
  transfers: PairAddressTransfer[],
  transactionDetails: Map<string, PairTransactionDetail>,
  settings: PairFlowSettings,
): PairFlowEvent[] {
  const pair = settings.pairTokenAddress.toLowerCase();
  const dead = settings.deadAddress.toLowerCase();
  const locker = settings.lockerAddress.toLowerCase();
  const poolManager = settings.poolManagerAddress.toLowerCase();
  const tracked = actorMap(settings);
  const market = marketAddresses(settings);
  const queues = new Map<string, PairLot[]>();
  const buybacks = new Map<string, PairFlowEvent>();
  const burns = new Map<string, PairFlowEvent>();

  for (const transfer of uniqueTransfers(transfers)) {
    if (transfer.token.toLowerCase() !== pair || transfer.from === transfer.to) continue;
    const tokenAmount = amount(transfer.rawValue, transfer.decimals);
    if (tokenAmount === null || tokenAmount === 0) continue;
    const from = transfer.from.toLowerCase();
    const to = transfer.to.toLowerCase();
    const fromActor = tracked.get(from);
    const toActor = tracked.get(to);

    if (fromActor && toActor) {
      for (const lot of consumeLots(queues, from, tokenAmount)) addLot(queues, to, lot);
      continue;
    }

    if (toActor) {
      const category: LotCategory =
        from === locker
          ? "direct_fee"
          : isMarketPairInflow(transfer, pair, tracked, market)
            ? "market_acquired"
            : "unattributed";
      addLot(queues, to, {
        category,
        amount: tokenAmount,
        sourceTxHash: category === "market_acquired" ? transfer.hash : null,
      });
      if (category !== "market_acquired") continue;

      const existing = buybacks.get(transfer.hash);
      if (existing) {
        existing.pairAmount += tokenAmount;
        continue;
      }
      const detail = transactionDetails.get(transfer.hash);
      const economics = buybackEconomics(detail, to, pair, poolManager, tokenAmount);
      buybacks.set(transfer.hash, {
        id: `buyback:${transfer.hash}`,
        type: "buyback",
        category: "market_buy",
        timestamp: detail?.timestamp ?? transfer.timestamp,
        blockNumber: detail?.blockNumber ?? transfer.blockNumber,
        txHash: transfer.hash,
        actorAddress: to,
        actorRole: toActor.role,
        actorAttribution: toActor.attribution,
        pairAmount: tokenAmount,
        usdValue: economics.usdValue,
        usdValuation: economics.usdValuation,
        inputAssets: economics.inputAssets,
        allocations: [],
        linkedTxHashes: [],
        transactionStatus: detail?.status ?? "unknown",
        evidence: toActor.attribution === "official" ? "explorer_indexed" : "behavior_inferred",
        explorerUrl: `https://rh-scan.com/tx/${transfer.hash}`,
        note:
          economics.usdValuation === "settlement_observed"
            ? "交易内稳定币结算额；PAIR 输出由转账日志确认。"
            : economics.usdValuation === "indexed_price_estimate"
              ? "美元额按浏览器索引价格估算；PAIR 输出由转账日志确认。"
              : "PAIR 输出由转账日志确认；本笔美元投入尚未可靠还原。",
      });
      continue;
    }

    if (!fromActor) continue;
    const consumed = consumeLots(queues, from, tokenAmount);
    if (to !== dead) continue;
    const allocations = aggregateAllocations(consumed);
    const existing = burns.get(transfer.hash);
    if (existing) {
      existing.pairAmount += tokenAmount;
      existing.allocations = aggregateAllocations([
        ...existing.allocations.map((allocation) => ({
          category: allocation.category,
          amount: allocation.pairAmount,
          sourceTxHash: allocation.sourceTxHash,
        })),
        ...consumed,
      ]);
      existing.linkedTxHashes = [
        ...new Set(
          existing.allocations.flatMap((allocation) =>
            allocation.sourceTxHash ? [allocation.sourceTxHash] : [],
          ),
        ),
      ];
      existing.category = burnCategory(existing.allocations);
      continue;
    }
    const detail = transactionDetails.get(transfer.hash);
    const indexedPrice =
      detail?.tokenTransfers.find((candidate) => candidate.token.toLowerCase() === pair)
        ?.tokenPriceUsd ?? transfer.tokenPriceUsd;
    const usdValue = indexedUsd(tokenAmount, indexedPrice);
    burns.set(transfer.hash, {
      id: `burn:${transfer.hash}`,
      type: "burn",
      category: burnCategory(allocations),
      timestamp: detail?.timestamp ?? transfer.timestamp,
      blockNumber: detail?.blockNumber ?? transfer.blockNumber,
      txHash: transfer.hash,
      actorAddress: from,
      actorRole: fromActor.role,
      actorAttribution: fromActor.attribution,
      pairAmount: tokenAmount,
      usdValue,
      usdValuation: usdValue === null ? "unknown" : "indexed_price_estimate",
      inputAssets: [],
      allocations,
      linkedTxHashes: [
        ...new Set(
          allocations.flatMap((allocation) =>
            allocation.sourceTxHash ? [allocation.sourceTxHash] : [],
          ),
        ),
      ],
      transactionStatus: detail?.status ?? "unknown",
      evidence: fromActor.attribution === "official" ? "explorer_indexed" : "behavior_inferred",
      explorerUrl: `https://rh-scan.com/tx/${transfer.hash}`,
      note:
        usdValue === null
          ? "PAIR 已转入死亡地址；美元额未采用当前价格倒推。"
          : "PAIR 已转入死亡地址；美元额仅为浏览器索引价格估值。",
    });
  }

  const events = [...buybacks.values(), ...burns.values()];
  const burnHashesByBuyback = new Map<string, string[]>();
  for (const burn of burns.values()) {
    for (const sourceHash of burn.linkedTxHashes) {
      const hashes = burnHashesByBuyback.get(sourceHash) ?? [];
      hashes.push(burn.txHash);
      burnHashesByBuyback.set(sourceHash, hashes);
    }
  }
  for (const buyback of buybacks.values()) {
    buyback.linkedTxHashes = [...new Set(burnHashesByBuyback.get(buyback.txHash) ?? [])];
  }
  return events.sort(
    (left, right) =>
      Date.parse(right.timestamp) - Date.parse(left.timestamp) ||
      right.blockNumber - left.blockNumber ||
      left.id.localeCompare(right.id),
  );
}
