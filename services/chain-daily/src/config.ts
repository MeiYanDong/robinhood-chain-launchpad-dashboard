import type { Unit } from "./types.js";

export const CHAIN = {
  id: "robinhood",
  name: "Robinhood Chain",
  chainId: 4663,
  launchDate: "2026-07-01",
} as const;

export const PEERS = [
  { id: "robinhood", name: "Robinhood", growthepie: "robinhood", defillama: "Robinhood Chain" },
  { id: "base", name: "Base", growthepie: "base", defillama: "Base" },
  { id: "arbitrum", name: "Arbitrum", growthepie: "arbitrum", defillama: "Arbitrum" },
  { id: "optimism", name: "Optimism", growthepie: "optimism", defillama: "Optimism" },
  { id: "worldchain", name: "World Chain", growthepie: "worldchain", defillama: "World Chain" },
  { id: "plume", name: "Plume", growthepie: "plume", defillama: "Plume Mainnet" },
] as const;

export interface MetricDefinition {
  id: string;
  sourceKey: string;
  label: string;
  shortLabel: string;
  unit: Unit;
  definition: string;
  caveat: string | null;
  rankDirection: "asc" | "desc";
  pillar: "usage" | "capital" | "economics";
}

export const GROWTHEPIE_METRICS: MetricDefinition[] = [
  {
    id: "transactions",
    sourceKey: "txcount",
    label: "日交易数",
    shortLabel: "交易",
    unit: "number",
    definition: "Robinhood Chain 在该 UTC 自然日处理的交易数。",
    caveat: null,
    rankDirection: "desc",
    pillar: "usage",
  },
  {
    id: "active_addresses",
    sourceKey: "daa",
    label: "日活地址",
    shortLabel: "日活",
    unit: "number",
    definition: "该 UTC 自然日内至少发起一笔交易的不同地址数。",
    caveat: "地址不等于独立用户。",
    rankDirection: "desc",
    pillar: "usage",
  },
  {
    id: "throughput",
    sourceKey: "gas_per_second",
    label: "吞吐量",
    shortLabel: "Gas/s",
    unit: "number",
    definition: "日均每秒消耗的 Gas，用于观察链上计算吞吐。",
    caveat: "Gas/s 会受交易类型影响，不等同于 TPS。",
    rankDirection: "desc",
    pillar: "usage",
  },
  {
    id: "median_tx_cost",
    sourceKey: "txcosts_median_usd",
    label: "中位交易成本",
    shortLabel: "交易成本",
    unit: "usd",
    definition: "该日普通交易实际支付成本的中位数，折算美元。",
    caveat: "此项排名按成本从低到高；低成本不自动代表更高需求。",
    rankDirection: "asc",
    pillar: "usage",
  },
  {
    id: "stablecoin_supply",
    sourceKey: "stables_mcap",
    label: "稳定币供应",
    shortLabel: "稳定币",
    unit: "usd",
    definition: "链上已发行稳定币的美元市值。",
    caveat: null,
    rankDirection: "desc",
    pillar: "capital",
  },
  {
    id: "tvs",
    sourceKey: "tvl",
    label: "Total Value Secured",
    shortLabel: "TVS",
    unit: "usd",
    definition: "Growthepie/L2Beat 口径的 Total Value Secured。",
    caveat: "TVS 不是 DeFi 协议 TVL；两者分开展示。",
    rankDirection: "desc",
    pillar: "capital",
  },
  {
    id: "chain_fees",
    sourceKey: "fees_paid_usd",
    label: "用户支付 Gas",
    shortLabel: "链手续费",
    unit: "usd",
    definition: "用户为链上交易支付的 Gas 费用，折算美元。",
    caveat: "Growthepie 页面称其为 Revenue；本项目用更保守的链手续费表述。",
    rankDirection: "desc",
    pillar: "economics",
  },
  {
    id: "l1_costs",
    sourceKey: "costs_total_usd",
    label: "L1 / DA 成本",
    shortLabel: "链成本",
    unit: "usd",
    definition: "结算与数据可用性等链级成本之和，折算美元。",
    caveat: "成本规模排名不代表经营优劣。",
    rankDirection: "desc",
    pillar: "economics",
  },
  {
    id: "onchain_profit",
    sourceKey: "profit_usd",
    label: "链上利润",
    shortLabel: "利润",
    unit: "usd",
    definition: "用户支付 Gas 减去 Growthepie 统计的链级成本。",
    caveat: "不包含 Robinhood 公司全部收入或成本。",
    rankDirection: "desc",
    pillar: "economics",
  },
  {
    id: "app_revenue",
    sourceKey: "app_fees_usd",
    label: "应用收入",
    shortLabel: "App 收入",
    unit: "usd",
    definition: "Growthepie 聚合的链上应用收入。",
    caveat: "覆盖范围取决于上游适配器，并非链上所有应用的审计总收入。",
    rankDirection: "desc",
    pillar: "economics",
  },
];

export const ENDPOINTS = {
  growthepieMaster: "https://api.growthepie.com/v1/master.json",
  growthepieFundamentals: "https://api.growthepie.com/v1/fundamentals.json",
  defillamaChains: "https://api.llama.fi/v2/chains",
  robinhoodAssets: "https://api.robinhood.com/rhj/assets",
  robinhoodPrices: "https://api.robinhood.com/rhj/prices",
  robinhoodStatus: "https://status.robinhoodchain.offchain.io/summary.json",
  blockscoutStats: "https://robinhoodchain.blockscout.com/api/v2/stats",
} as const;

export const DEFAULT_RPC = "https://rpc.mainnet.chain.robinhood.com";
