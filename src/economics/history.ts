import type {
  DailyOhlc,
  PairRelativeValuationDailyPoint,
  PairRelativeValuationHistoryPoint,
  TokenDailyCandle,
} from "./types.js";

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sevenDayReference(point: PairRelativeValuationHistoryPoint): number | null {
  if (finite(point.sevenDayReferenceUsd)) return point.sevenDayReferenceUsd;
  if (
    point.modelVersion === "pons-latest-day-volume-parity-v2" &&
    finite(point.sevenDayEstimateUsd)
  ) {
    return point.sevenDayEstimateUsd;
  }
  if (point.modelVersion === "pons-volume-parity-v1" && finite(point.estimateUsd)) {
    return point.estimateUsd;
  }
  return null;
}

function latestDayReference(point: PairRelativeValuationHistoryPoint): number | null {
  if (finite(point.latestDayReferenceUsd)) return point.latestDayReferenceUsd;
  if (point.modelVersion === "pons-latest-day-volume-parity-v2" && finite(point.estimateUsd)) {
    return point.estimateUsd;
  }
  return null;
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
    return {
      date,
      state: candlesByDate.get(date)?.state ?? (date === input.endDate ? "forming" : "closed"),
      pons: candlesByDate.get(date) ?? null,
      pairActual: ohlc(
        points
          .map((point) => point.actualPriceUsd)
          .filter((value): value is number => finite(value)),
      ),
      pairSevenDayReference: ohlc(
        points.map(sevenDayReference).filter((value): value is number => finite(value)),
      ),
      pairLatestDayReference: ohlc(
        points.map(latestDayReference).filter((value): value is number => finite(value)),
      ),
      sampleCount: points.length,
      lastObservedAt: points.at(-1)?.observedAt ?? candlesByDate.get(date)?.observedAt ?? null,
    };
  });
}
