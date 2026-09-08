import type {
  DailyOhlc,
  PairRelativeValuationDailyPoint,
  PairRelativeValuationHistoryPoint,
  TokenDailyCandle,
} from "./types.js";

function finite(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function ohlc(values: number[]): DailyOhlc | null {
  if (values.length === 0) return null;
  return {
    openUsd: values[0] ?? 0,
    highUsd: Math.max(...values),
    lowUsd: Math.min(...values),
    closeUsd: values.at(-1) ?? 0,
  };
}

export function aggregateValuationDaily(input: {
  points: PairRelativeValuationHistoryPoint[];
  ponsCandles: TokenDailyCandle[];
  startDate: string;
  endDate: string;
}): PairRelativeValuationDailyPoint[] {
  const pointsByDate = new Map<string, PairRelativeValuationHistoryPoint[]>();
  for (const point of input.points) {
    const date = point.observedAt.slice(0, 10);
    if (date < input.startDate || date > input.endDate) continue;
    const points = pointsByDate.get(date) ?? [];
    points.push(point);
    pointsByDate.set(date, points);
  }
  const candlesByDate = new Map(
    input.ponsCandles
      .filter((candle) => candle.date >= input.startDate && candle.date <= input.endDate)
      .map((candle) => [candle.date, candle]),
  );
  const dates = [...new Set([...pointsByDate.keys(), ...candlesByDate.keys()])].sort();
  return dates.map((date) => {
    const points = (pointsByDate.get(date) ?? []).sort((left, right) =>
      left.observedAt.localeCompare(right.observedAt),
    );
    const latestWithRange = [...points]
      .reverse()
      .find((point) => finite(point.rangeLowUsd) && finite(point.rangeHighUsd));
    return {
      date,
      state: candlesByDate.get(date)?.state ?? (date === input.endDate ? "forming" : "closed"),
      pons: candlesByDate.get(date) ?? null,
      pairActual: ohlc(
        points
          .map((point) => point.actualPriceUsd)
          .filter((value): value is number => finite(value)),
      ),
      pairSpotAnchor: ohlc(
        points.map((point) => point.estimateUsd).filter((value): value is number => finite(value)),
      ),
      rangeLowUsd: latestWithRange?.rangeLowUsd ?? null,
      rangeHighUsd: latestWithRange?.rangeHighUsd ?? null,
      sampleCount: points.length,
      lastObservedAt: points.at(-1)?.observedAt ?? candlesByDate.get(date)?.observedAt ?? null,
    };
  });
}
