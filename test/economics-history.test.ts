import assert from "node:assert/strict";
import test from "node:test";
import { aggregateValuationDaily } from "../src/economics/history.js";
import type {
  PairRelativeValuationHistoryPoint,
  TokenDailyCandle,
} from "../src/economics/types.js";

function point(
  observedAt: string,
  actualPriceUsd: number,
  estimateUsd: number,
): PairRelativeValuationHistoryPoint {
  return {
    modelVersion: "pons-volume-parity-v1",
    observedAt,
    state: "available",
    platformWindowEnd: "2026-09-01",
    estimateUsd,
    rangeLowUsd: estimateUsd * 0.8,
    rangeHighUsd: estimateUsd * 1.2,
    actualPriceUsd,
    actualDeviationPercent: 0,
    confidence: "low",
  };
}

const candle: TokenDailyCandle = {
  tokenAddress: "0x39dbed3a2bd333467115de45665cc57f813c4571",
  date: "2026-09-02",
  openedAt: "2026-09-02T00:00:00.000Z",
  openUsd: 0.6,
  highUsd: 0.8,
  lowUsd: 0.5,
  closeUsd: 0.7,
  volumeUsd: 5_000,
  amountTokens: 8_000,
  state: "forming",
  observedAt: "2026-09-02T12:00:00.000Z",
  source: "gmgn.tokenKline",
  quality: "third_party",
};

test("valuation history aggregates exact UTC-day OHLC without inventing missing values", () => {
  const daily = aggregateValuationDaily({
    points: [
      point("2026-09-02T01:00:00.000Z", 0.01, 0.02),
      point("2026-09-02T12:00:00.000Z", 0.012, 0.018),
    ],
    ponsCandles: [candle],
    startDate: "2026-08-27",
    endDate: "2026-09-02",
  });

  assert.equal(daily.length, 1);
  assert.deepEqual(daily[0]?.pairActual, {
    openUsd: 0.01,
    highUsd: 0.012,
    lowUsd: 0.01,
    closeUsd: 0.012,
  });
  assert.equal(daily[0]?.pairSpotAnchor?.closeUsd, 0.018);
  assert.equal(daily[0]?.pons?.volumeUsd, 5_000);
  assert.equal(daily[0]?.sampleCount, 2);
  assert.equal(daily[0]?.state, "forming");
});
