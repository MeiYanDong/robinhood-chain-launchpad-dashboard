import {
  PAIR_TOKEN_METRICS,
  type PairMetricRanking,
  type PairRankingEntry,
  type PairTokenMetricName,
  type PairTokenSnapshot,
} from "./types.js";

const LABELS: Record<PairTokenMetricName, string> = {
  market_cap_usd: "市值",
  liquidity_depth_usd: "流动性池深度",
  volume_24h_usd: "24H 成交量",
  holder_count: "持币地址",
};

function metricValue(snapshot: PairTokenSnapshot, metric: PairTokenMetricName): number | null {
  if (metric === "market_cap_usd") return snapshot.marketCapUsd;
  if (metric === "liquidity_depth_usd") return snapshot.liquidityDepthUsd;
  if (metric === "volume_24h_usd") return snapshot.volume24hUsd;
  return snapshot.holderCount;
}

function ranked(
  snapshots: PairTokenSnapshot[],
  metric: PairTokenMetricName,
): Array<{ snapshot: PairTokenSnapshot; value: number }> {
  return snapshots
    .filter((snapshot) => snapshot.eligible)
    .flatMap((snapshot) => {
      const value = metricValue(snapshot, metric);
      return value === null || !Number.isFinite(value) || value < 0 ? [] : [{ snapshot, value }];
    })
    .sort(
      (left, right) =>
        right.value - left.value || left.snapshot.address.localeCompare(right.snapshot.address),
    );
}

function percentChange(current: number, previous: number | null): number | null {
  if (previous === null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export function buildPairRankings(
  current: PairTokenSnapshot[],
  previous: PairTokenSnapshot[] = [],
  limit = 5,
): Record<PairTokenMetricName, PairMetricRanking> {
  return Object.fromEntries(
    PAIR_TOKEN_METRICS.map((metric) => {
      const currentRows = ranked(current, metric);
      const previousRows = ranked(previous, metric);
      const previousRanks = new Map(
        previousRows.map((row, index) => [row.snapshot.address, index + 1]),
      );
      const previousValues = new Map(previousRows.map((row) => [row.snapshot.address, row.value]));
      const entries: PairRankingEntry[] = currentRows.slice(0, limit).map((row, index) => {
        const previousRank = previousRanks.get(row.snapshot.address) ?? null;
        const previousValue = previousValues.get(row.snapshot.address) ?? null;
        return {
          rank: index + 1,
          previousRank,
          rankChange: previousRank === null ? null : previousRank - (index + 1),
          address: row.snapshot.address,
          name: row.snapshot.name,
          symbol: row.snapshot.symbol,
          tokenUrl: row.snapshot.tokenUrl,
          graduated: row.snapshot.graduated,
          priceUsd: row.snapshot.priceUsd,
          quoteAssets: row.snapshot.quoteAssets ?? [],
          value: row.value,
          previousValue,
          valueChangePercent: percentChange(row.value, previousValue),
          observedAt:
            metric === "holder_count"
              ? (row.snapshot.holderObservedAt ?? row.snapshot.observedAt)
              : (row.snapshot.marketDataUpdatedAt ?? row.snapshot.observedAt),
        };
      });
      return [
        metric,
        {
          metric,
          label: LABELS[metric],
          unit: metric === "holder_count" ? "count" : "USD",
          observedCount: currentRows.length,
          entries,
        },
      ];
    }),
  ) as Record<PairTokenMetricName, PairMetricRanking>;
}

export function emptyPairRankings(): Record<PairTokenMetricName, PairMetricRanking> {
  const rankings = {} as Record<PairTokenMetricName, PairMetricRanking>;
  for (const metric of PAIR_TOKEN_METRICS) {
    rankings[metric] = {
      metric,
      label: LABELS[metric],
      unit: metric === "holder_count" ? "count" : "USD",
      observedCount: 0,
      entries: [],
    };
  }
  return rankings;
}
