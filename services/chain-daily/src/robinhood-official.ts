import { CHAIN, DEFAULT_RPC, ENDPOINTS } from "./config.js";
import type { NetworkHealth, RawBundle, SourceReceipt, StockTokenSnapshot } from "./types.js";
import { asNumber, asString, fetchSource, isRecord, round } from "./utils.js";

interface Asset {
  address: string;
  decimals: number;
  multiplier: number;
  status: string;
}

interface Quote {
  address: string;
  midpoint: number;
  generatedAt: string | null;
}

function parseAssets(data: unknown): Asset[] {
  if (!isRecord(data) || !Array.isArray(data.assets)) return [];
  const assets: Asset[] = [];
  for (const item of data.assets) {
    if (!isRecord(item) || !Array.isArray(item.deployments)) continue;
    const deployment = item.deployments.find(
      (candidate) => isRecord(candidate) && asNumber(candidate.chainId) === CHAIN.chainId,
    );
    if (!isRecord(deployment)) continue;
    const address = asString(deployment.contractAddress);
    const decimals = asNumber(item.tokenDecimals);
    const multiplier = asNumber(item.currentMultiplier);
    const status = asString(item.status);
    if (!address || decimals === null || multiplier === null || !status) continue;
    assets.push({ address: address.toLowerCase(), decimals, multiplier, status });
  }
  return assets;
}

function parseQuotes(data: unknown): Quote[] {
  if (!isRecord(data) || !Array.isArray(data.quotes)) return [];
  const quotes: Quote[] = [];
  for (const item of data.quotes) {
    if (!isRecord(item) || !Array.isArray(item.deployments)) continue;
    const deployment = item.deployments.find(
      (candidate) => isRecord(candidate) && asNumber(candidate.chainId) === CHAIN.chainId,
    );
    if (!isRecord(deployment)) continue;
    const address = asString(deployment.contractAddress);
    const bid = asNumber(item.bid);
    const ask = asNumber(item.ask);
    if (!address || bid === null || ask === null) continue;
    quotes.push({
      address: address.toLowerCase(),
      midpoint: (bid + ask) / 2,
      generatedAt: asString(item.generatedAt),
    });
  }
  return quotes;
}

function jsonRpcBody(method: string, params: unknown[], id: number): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

function rpcResult(data: unknown): string | null {
  return isRecord(data) ? asString(data.result) : null;
}

function semanticFailure(receipt: SourceReceipt, message: string): void {
  receipt.ok = false;
  receipt.error = message;
}

export function estimateTokenValue(
  rawSupply: bigint,
  decimals: number,
  midpointUsd: number,
  multiplier: number,
): number | null {
  const value = (Number(rawSupply) / 10 ** decimals) * midpointUsd * multiplier;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

async function readSupplies(
  rpcUrl: string,
  assets: Asset[],
  receipts: SourceReceipt[],
  raw: RawBundle,
): Promise<Map<string, bigint> | null> {
  const chainCheck = await fetchSource("robinhood_rpc_chain", "Robinhood 官方 RPC · chainId", rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: jsonRpcBody("eth_chainId", [], 1),
  });
  receipts.push(chainCheck.receipt);
  raw[chainCheck.receipt.id] = chainCheck.data;
  const chainIdHex = rpcResult(chainCheck.data);
  if (chainIdHex === null || Number.parseInt(chainIdHex, 16) !== CHAIN.chainId) {
    semanticFailure(chainCheck.receipt, `RPC chainId mismatch; expected ${CHAIN.chainId}`);
    return null;
  }

  const supplies = new Map<string, bigint>();
  const batchSize = 50;
  for (let offset = 0; offset < assets.length; offset += batchSize) {
    const batch = assets.slice(offset, offset + batchSize).map((asset, index) => ({
      jsonrpc: "2.0",
      id: offset + index + 1,
      method: "eth_call",
      params: [{ to: asset.address, data: "0x18160ddd" }, "latest"],
    }));
    const sourceId = `robinhood_rpc_supply_${Math.floor(offset / batchSize) + 1}`;
    const fetched = await fetchSource(sourceId, `Robinhood 官方 RPC · totalSupply 批次 ${Math.floor(offset / batchSize) + 1}`, rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(batch),
    });
    receipts.push(fetched.receipt);
    raw[fetched.receipt.id] = fetched.data;
    if (!Array.isArray(fetched.data)) continue;
    const byId = new Map<number, unknown>();
    for (const response of fetched.data) {
      if (isRecord(response)) {
        const id = asNumber(response.id);
        if (id !== null) byId.set(id, response.result);
      }
    }
    for (let index = 0; index < batch.length; index += 1) {
      const asset = assets[offset + index];
      const result = asString(byId.get(offset + index + 1));
      if (!asset || !result || !/^0x[0-9a-f]+$/i.test(result)) continue;
      try {
        supplies.set(asset.address, BigInt(result));
      } catch {
        // Invalid supply remains absent and is reflected in coverage.
      }
    }
  }
  return supplies;
}

function parseBlockscout(data: unknown): NetworkHealth["blockscout"] | null {
  if (!isRecord(data)) return null;
  const totalTransactions = asNumber(data.total_transactions);
  const totalAddresses = asNumber(data.total_addresses);
  const averageBlockTimeMs = asNumber(data.average_block_time);
  if (totalTransactions === null && totalAddresses === null && averageBlockTimeMs === null) return null;
  return { totalTransactions, totalAddresses, averageBlockTimeMs };
}

export async function collectRobinhoodOfficial(): Promise<{
  stockTokens: StockTokenSnapshot;
  health: NetworkHealth;
  receipts: SourceReceipt[];
  raw: RawBundle;
}> {
  const receipts: SourceReceipt[] = [];
  const raw: RawBundle = {};
  const [assetsResult, pricesResult, statusResult, blockscoutResult] = await Promise.all([
    fetchSource("robinhood_assets", "Robinhood 官方 · 股票代币资产", ENDPOINTS.robinhoodAssets),
    fetchSource("robinhood_prices", "Robinhood 官方 · 股票代币报价", ENDPOINTS.robinhoodPrices),
    fetchSource("robinhood_status", "Robinhood Chain 官方状态页", ENDPOINTS.robinhoodStatus),
    fetchSource("blockscout_stats", "Robinhood Chain Blockscout 统计", ENDPOINTS.blockscoutStats),
  ]);

  for (const result of [assetsResult, pricesResult, statusResult, blockscoutResult]) {
    receipts.push(result.receipt);
    raw[result.receipt.id] = result.data;
  }

  const assets = parseAssets(assetsResult.data).filter((asset) => asset.status === "ASSET_STATUS_ACTIVE");
  const quotes = parseQuotes(pricesResult.data);
  const quoteMap = new Map(quotes.map((quote) => [quote.address, quote]));
  const rpcUrl = process.env.ROBINHOOD_RPC_URL || DEFAULT_RPC;
  const supplies = assets.length > 0 ? await readSupplies(rpcUrl, assets, receipts, raw) : null;

  let estimatedValue = 0;
  let valuedAssets = 0;
  let pricedAssets = 0;
  for (const asset of assets) {
    const quote = quoteMap.get(asset.address);
    if (quote) pricedAssets += 1;
    const supply = supplies?.get(asset.address);
    if (!quote || supply === undefined) continue;
    const value = estimateTokenValue(supply, asset.decimals, quote.midpoint, asset.multiplier);
    if (value === null) continue;
    estimatedValue += value;
    valuedAssets += 1;
  }

  const quoteGeneratedAt = quotes
    .map((quote) => quote.generatedAt)
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1) ?? null;

  const statusPage = isRecord(statusResult.data) && isRecord(statusResult.data.page) ? statusResult.data.page : null;
  const officialStatus = statusPage ? asString(statusPage.status) : null;
  const blockscout = parseBlockscout(blockscoutResult.data);
  if (blockscout === null && blockscoutResult.receipt.ok) {
    semanticFailure(blockscoutResult.receipt, "Blockscout response did not contain parseable stats");
  }

  const rpcReceipt = receipts.find((receipt) => receipt.id === "robinhood_rpc_chain");
  const activeAssets = assetsResult.receipt.ok ? assets.length : null;
  const stockTokens: StockTokenSnapshot = {
    activeAssets,
    pricedAssets: pricesResult.receipt.ok ? pricedAssets : null,
    valuedAssets: supplies === null ? null : valuedAssets,
    estimatedValueUsd: supplies === null || valuedAssets === 0 ? null : round(estimatedValue, 2),
    coveragePercent:
      supplies === null || activeAssets === null || activeAssets === 0 ? null : round((valuedAssets / activeAssets) * 100, 1),
    quoteGeneratedAt,
    chainId: CHAIN.chainId,
    method: "totalSupply / 10^decimals × bid/ask midpoint × currentMultiplier",
  };

  const health: NetworkHealth = {
    chainId: CHAIN.chainId,
    rpcOk: rpcReceipt ? rpcReceipt.ok : null,
    officialStatus,
    blockscout: blockscout ?? { totalTransactions: null, totalAddresses: null, averageBlockTimeMs: null },
  };

  return { stockTokens, health, receipts, raw };
}
