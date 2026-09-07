import type { MetricName, MetricPolicy, PlatformConfig } from "../domain/types.js";

const LLAMA_METHOD = "https://defillama.com/docs/defi/fees-and-revenue";
const LLAMA_FEES = "https://defillama.com/fees/chain/Robinhood%20Chain";
const LLAMA_DEXS = "https://defillama.com/dexs/chain/Robinhood%20Chain";

const reported = (scope: string, note?: string): MetricPolicy => ({
  quality: "reported",
  scope,
  ...(note ? { note } : {}),
});

const partial = (scope: string, note: string): MetricPolicy => ({
  quality: "partial",
  scope,
  note,
});

const mismatch = (scope: string, note: string): MetricPolicy => ({
  quality: "scope_mismatch",
  scope,
  note,
});

const suiteWide = (scope: string, note: string): MetricPolicy => ({
  quality: "suite_wide",
  scope,
  note,
});

const defaultLinks = [
  { label: "DefiLlama Fees", url: LLAMA_FEES, kind: "adapter" as const },
  { label: "DefiLlama DEXs", url: LLAMA_DEXS, kind: "adapter" as const },
  { label: "Metric definitions", url: LLAMA_METHOD, kind: "methodology" as const },
];

export const PLATFORM_REGISTRY: PlatformConfig[] = [
  {
    id: "pons",
    name: "Pons",
    aliases: ["Pons", "Pons V1", "Pons V2", "pons-v1", "pons-v2"],
    website: "https://www.ponsfamily.com/analytics",
    status: "live",
    comparability: "scope_mismatch",
    excludeFromTotals: false,
    scope: "Canonical group combining Pons V1 and Pons V2 adapters.",
    notes: [
      "V1 and V2 are grouped to prevent duplicate platform rows.",
      "Official Dune-backed analytics is canonical for daily platform volume.",
      "Fees and revenue can still cover a different V1/V2 mix and remain scope-mismatched.",
    ],
    sourceLinks: [
      {
        label: "Pons Analytics",
        url: "https://www.ponsfamily.com/analytics",
        kind: "official",
      },
      {
        label: "Pons Docs",
        url: "https://docs.ponsfamily.com/",
        kind: "official",
      },
      ...defaultLinks,
    ],
    metricPolicies: {
      volume_usd: reported(
        "Pons official Dune-backed closed UTC-day launchpad volume",
        "Volume is comparable by day; grouped fee and revenue adapters remain separate scopes.",
      ),
      fees_usd: mismatch("Pons V1 + V2 user-paid fees", "Grouped across two adapter generations."),
      revenue_usd: mismatch(
        "Pons V1 + V2 retained revenue",
        "Grouped across two adapter generations.",
      ),
      protocol_revenue_usd: mismatch(
        "Pons V1 + V2 protocol revenue",
        "Grouped across two adapter generations.",
      ),
    },
  },
  {
    id: "pair",
    name: "PAIR",
    aliases: ["PAIR", "Pair", "Pair Fund", "pair.fund", "pair-fund"],
    website: "https://pair.fund/stats",
    status: "live",
    comparability: "partial",
    excludeFromTotals: false,
    scope: "PAIR Dune-backed daily activity across supported Robinhood Chain markets.",
    notes: [
      "Official protocol stats is canonical for closed UTC-day volume.",
      "User fees and protocol revenue can come from a different adapter scope and remain separately labeled.",
      "PAIR token buyback policy, cumulative burn, and verified executed buybacks are separate facts.",
    ],
    sourceLinks: [
      { label: "PAIR Stats", url: "https://pair.fund/stats", kind: "official" },
      { label: "PAIR Docs", url: "https://pair.fund/docs", kind: "official" },
      {
        label: "PAIR Dune query",
        url: "https://dune.com/queries/8520127",
        kind: "methodology",
      },
      ...defaultLinks,
    ],
    metricPolicies: {
      volume_usd: reported("PAIR official Dune-backed closed UTC-day volume"),
      fees_usd: partial(
        "PAIR user-paid fees reported by the configured fee adapter",
        "The fee adapter scope must not be inferred from official volume.",
      ),
      revenue_usd: partial(
        "PAIR retained revenue reported by the configured revenue adapter",
        "Revenue is not audited net profit.",
      ),
      protocol_revenue_usd: partial(
        "PAIR protocol-attributed revenue reported by the configured adapter",
        "Accrued allocation and treasury receipts are not yet separated by the upstream source.",
      ),
    },
  },
  {
    id: "letscash",
    name: "LetsCash",
    aliases: ["LetsCash", "Lets Cash"],
    website: "https://www.letscash.fun",
    status: "live",
    comparability: "partial",
    excludeFromTotals: false,
    scope:
      "Official LetsCash indexed curve activity, with DefiLlama used for USD conversion and fallback.",
    notes: [
      "The first-party API is canonical for overlapping LetsCash daily volume and fee observations.",
      "Official daily rows are ETH-denominated; USD values use the DefiLlama ETH/USD reference at the UTC bucket boundary and are therefore derived.",
      "Daily platform income is estimated as volume × 0.3%; cumulative platform income is reported directly by LetsCash.",
      "DefiLlama remains a lower-priority fallback and an independent scope cross-check.",
    ],
    sourceLinks: [
      {
        label: "LetsCash Tokenomics",
        url: "https://www.letscash.fun/tokenomics",
        kind: "official",
      },
      {
        label: "LetsCash Tokenomics API",
        url: "https://api.letscash.fun/api/tokenomics?surface=current",
        kind: "official",
      },
      {
        label: "DefiLlama price API docs",
        url: "https://github.com/DefiLlama/api-sdk#prices",
        kind: "methodology",
      },
      ...defaultLinks,
    ],
    metricPolicies: {
      volume_usd: {
        quality: "derived",
        scope: "Official indexed curve volume converted from ETH to USD",
        note: "First-party ETH rows are preferred; DefiLlama adapter rows remain the fallback.",
      },
      fees_usd: {
        quality: "derived",
        scope: "Official indexed user fees converted from ETH to USD",
        note: "USD conversion uses a daily ETH/USD reference price.",
      },
      revenue_usd: reported("Retained launchpad revenue"),
      protocol_revenue_usd: {
        quality: "derived",
        scope: "Platform-retained 0.3% trade fee",
        note: "Daily value is derived from official volume because the API exposes only cumulative platform income directly.",
      },
    },
  },
  {
    id: "flap",
    name: "Flap",
    aliases: ["Flap", "Flap.sh"],
    website: "https://flap.sh",
    status: "live",
    comparability: "scope_mismatch",
    excludeFromTotals: false,
    scope: "Pre-graduation curve volume versus wider fee-safe inflows.",
    notes: ["Fee inflows can include quote-token transfers beyond matching curve trades."],
    sourceLinks: defaultLinks,
    metricPolicies: {
      volume_usd: mismatch("Pre-graduation bonding-curve volume", "Stops at graduation."),
      fees_usd: mismatch("Quote-token inflows to fee Safe", "Can include non-trade transfers."),
      revenue_usd: mismatch(
        "Fee Safe inflows retained by protocol",
        "Scope does not match curve volume.",
      ),
      protocol_revenue_usd: mismatch(
        "Fee Safe protocol inflows",
        "Scope does not match curve volume.",
      ),
    },
  },
  {
    id: "stonkbrokers",
    name: "StonkBrokers",
    aliases: ["StonkBrokers", "Stonk Brokers", "StonkBrokers V2"],
    website: "https://stonkbrokers.com",
    status: "live",
    comparability: "suite_wide",
    excludeFromTotals: true,
    scope: "Multi-product suite, not a launchpad-only accounting boundary.",
    notes: [
      "Adapter mixes launchpad, NFT AMM, loans, Broker Box, lockers and swap-desk activity.",
      "Shown for discovery but excluded from launchpad-comparable totals.",
    ],
    sourceLinks: defaultLinks,
    metricPolicies: Object.fromEntries(
      (["volume_usd", "fees_usd", "revenue_usd", "protocol_revenue_usd"] as MetricName[]).map(
        (metric) => [metric, suiteWide("StonkBrokers multi-product suite", "Not launchpad-only.")],
      ),
    ),
  },
  {
    id: "bankr",
    name: "Bankr",
    aliases: ["Bankr", "Bankr Launches"],
    website: "https://bankr.bot",
    status: "live",
    comparability: "partial",
    excludeFromTotals: false,
    scope: "Official Bankr dashboard volume attributed to Robinhood Chain.",
    notes: [
      "Official dashboard supplies chain-split volume.",
      "No public daily Robinhood Chain split for Bankr protocol revenue; revenue remains unknown.",
    ],
    sourceLinks: [
      {
        label: "Bankr public dashboard API",
        url: "https://api.bankr.bot/public/dashboard",
        kind: "official",
      },
      { label: "Bankr", url: "https://bankr.bot", kind: "official" },
    ],
    metricPolicies: {
      volume_usd: reported("Bankr Robinhood Chain daily volume"),
    },
  },
  {
    id: "long",
    name: "Long",
    aliases: ["Long", "Long.xyz", "LONG"],
    website: "https://app.long.xyz",
    status: "live",
    comparability: "partial",
    excludeFromTotals: false,
    scope:
      "Official Long hourly USD volume for Robinhood Chain assets attributed by integrator address.",
    notes: [
      "Closed UTC-day volume includes Long assets anchored to Robinhood stock tokens or other Long assets.",
      "Daily user fees and platform revenue remain unknown until versioned dynamic-fee and beneficiary routing can be attributed exactly.",
    ],
    sourceLinks: [
      { label: "Long", url: "https://app.long.xyz", kind: "official" },
      { label: "Long token explorer", url: "https://app.long.xyz/tokens", kind: "official" },
      {
        label: "Artificial Inu on Long",
        url: "https://app.long.xyz/tokens/0x2e8c31162b855a2ffa90f6f8634643ad6f111e18",
        kind: "official",
      },
    ],
    metricPolicies: {
      volume_usd: reported("Long integrator-matched hourly USD pool volume"),
    },
  },
  {
    id: "frontier",
    name: "Frontier",
    aliases: ["Frontier", "Frontier Launchpad"],
    status: "tracked",
    comparability: "comparable",
    excludeFromTotals: false,
    scope: "Launchpad adapter activity on Robinhood Chain.",
    notes: [],
    sourceLinks: defaultLinks,
    metricPolicies: {
      volume_usd: reported("Launchpad trading volume"),
      fees_usd: reported("Launchpad user-paid fees"),
      revenue_usd: reported("Retained launchpad revenue"),
      protocol_revenue_usd: reported("Protocol-retained launchpad revenue"),
    },
  },
  {
    id: "merryforge",
    name: "MerryForge",
    aliases: ["MerryForge", "Merry Forge"],
    status: "tracked",
    comparability: "comparable",
    excludeFromTotals: false,
    scope: "Launchpad adapter activity on Robinhood Chain.",
    notes: [],
    sourceLinks: defaultLinks,
    metricPolicies: {},
  },
  {
    id: "hoodmint",
    name: "HoodMint",
    aliases: ["HoodMint", "Hood Mint"],
    status: "tracked",
    comparability: "comparable",
    excludeFromTotals: false,
    scope: "Launchpad adapter activity on Robinhood Chain.",
    notes: [],
    sourceLinks: defaultLinks,
    metricPolicies: {},
  },
  {
    id: "based-alpha",
    name: "Based Alpha",
    aliases: ["Based Alpha", "BasedAlpha"],
    status: "tracked",
    comparability: "comparable",
    excludeFromTotals: false,
    scope: "Launchpad adapter activity on Robinhood Chain.",
    notes: [],
    sourceLinks: defaultLinks,
    metricPolicies: {},
  },
  {
    id: "pools",
    name: "Pools",
    aliases: ["Pools", "Pools Finance"],
    status: "tracked",
    comparability: "partial",
    excludeFromTotals: false,
    scope: "Trading fees reported by the launchpad adapter.",
    notes: [
      "No direct volume series is claimed; fees are not inverted into volume in the canonical dataset.",
    ],
    sourceLinks: defaultLinks,
    metricPolicies: {
      fees_usd: reported("0.25% launchpad trade fees"),
      revenue_usd: reported("Reported retained revenue"),
      protocol_revenue_usd: reported("Reported protocol revenue"),
    },
  },
  {
    id: "sentry",
    name: "Sentry",
    aliases: ["Sentry", "Sentry.fun"],
    status: "tracked",
    comparability: "partial",
    excludeFromTotals: false,
    scope: "Router application fees plus launched-pool fees.",
    notes: ["Coverage depends on the router and pools indexed by the adapter."],
    sourceLinks: defaultLinks,
    metricPolicies: {
      fees_usd: partial("Router and pool fees", "Partial contract coverage."),
    },
  },
  {
    id: "noxa-fun",
    name: "NOXA Fun",
    aliases: ["NOXA Fun", "Noxa Fun", "Noxa.fun"],
    status: "activity_only",
    comparability: "partial",
    excludeFromTotals: false,
    scope: "Post-graduation Uniswap pools above the adapter TVL threshold.",
    notes: ["Fees cover selected post-graduation pools; no matching volume series is claimed."],
    sourceLinks: defaultLinks,
    metricPolicies: {
      fees_usd: partial("Post-graduation pool fees", "Only pools above the adapter TVL threshold."),
      revenue_usd: reported("Reported as zero when an explicit observation exists"),
      protocol_revenue_usd: reported("Reported as zero when an explicit observation exists"),
    },
  },
];

export function normalizePlatformName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const aliasIndex = new Map<string, PlatformConfig>();
for (const platform of PLATFORM_REGISTRY) {
  for (const alias of [platform.name, ...platform.aliases]) {
    aliasIndex.set(normalizePlatformName(alias), platform);
  }
}

export function findRegisteredPlatform(name: string): PlatformConfig | null {
  return aliasIndex.get(normalizePlatformName(name)) ?? null;
}

export function slugifyPlatform(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `unknown-${Buffer.from(name).toString("hex").slice(0, 12)}`;
}

export function dynamicPlatform(name: string): PlatformConfig {
  return {
    id: slugifyPlatform(name),
    name,
    aliases: [name],
    status: "tracked",
    comparability: "unknown",
    excludeFromTotals: false,
    scope: "Discovered from a DefiLlama Robinhood Chain Launchpad record.",
    notes: ["Metric scope has not yet received a manual adapter review."],
    sourceLinks: defaultLinks,
    metricPolicies: {},
  };
}

export function metricPolicyFor(platform: PlatformConfig, metric: MetricName): MetricPolicy {
  return (
    platform.metricPolicies[metric] ?? {
      quality: platform.comparability === "comparable" ? "reported" : platform.comparability,
      scope: platform.scope,
      note: "Defaulted from platform-level scope pending a metric-specific adapter review.",
    }
  );
}
