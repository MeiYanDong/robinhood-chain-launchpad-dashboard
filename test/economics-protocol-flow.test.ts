import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_ECONOMICS_SETTINGS } from "../src/economics/config.js";
import {
  aggregateProtocolBurnDays,
  parseProtocolBurnTransfers,
} from "../src/economics/protocol-flow.js";

const settings = DEFAULT_ECONOMICS_SETTINGS;
const buybackWallet = "0x1111111111111111111111111111111111111111";

function row(input: { hash: string; timestamp: number; from: string; value: string; to?: string }) {
  return {
    contractAddress: settings.ponsTokenAddress,
    from: input.from,
    to: input.to ?? settings.deadAddress,
    hash: input.hash,
    blockNumber: "123",
    timeStamp: String(input.timestamp),
    tokenDecimal: "18",
    value: input.value,
  };
}

test("Blockscout burn transfers keep only the selected token and attribute the known wallet", () => {
  const first = row({
    hash: `0x${"a".repeat(64)}`,
    timestamp: Date.parse("2026-09-01T01:00:00.000Z") / 1_000,
    from: buybackWallet,
    value: "2500000000000000000",
  });
  const second = row({
    hash: `0x${"b".repeat(64)}`,
    timestamp: Date.parse("2026-09-02T01:00:00.000Z") / 1_000,
    from: "0x2222222222222222222222222222222222222222",
    value: "1000000000000000000",
  });
  const transfers = parseProtocolBurnTransfers(
    { status: "1", result: [first, first, second, { ...second, to: buybackWallet }] },
    settings.ponsTokenAddress,
    settings.deadAddress,
    [buybackWallet],
  );

  assert.equal(transfers.length, 2);
  assert.equal(transfers[0]?.amountTokens, 2.5);
  assert.equal(transfers[0]?.inferredBuyback, true);
  assert.equal(transfers[1]?.amountTokens, 1);
  assert.equal(transfers[1]?.inferredBuyback, false);
});

test("burn aggregation zero-fills covered UTC days and marks a truncated first day incomplete", () => {
  const transfers = parseProtocolBurnTransfers(
    {
      status: "1",
      result: [
        row({
          hash: `0x${"a".repeat(64)}`,
          timestamp: Date.parse("2026-09-01T01:00:00.000Z") / 1_000,
          from: buybackWallet,
          value: "2500000000000000000",
        }),
        row({
          hash: `0x${"b".repeat(64)}`,
          timestamp: Date.parse("2026-09-02T01:00:00.000Z") / 1_000,
          from: "0x2222222222222222222222222222222222222222",
          value: "1000000000000000000",
        }),
      ],
    },
    settings.ponsTokenAddress,
    settings.deadAddress,
    [buybackWallet],
  );
  const days = aggregateProtocolBurnDays({
    tokenAddress: settings.ponsTokenAddress,
    transfers,
    observedAt: "2026-09-03T12:00:00.000Z",
    completeHistory: false,
  });

  assert.deepEqual(
    days.map((day) => ({
      date: day.date,
      burned: day.burnedTokens,
      buyback: day.inferredBuybackTokens,
      complete: day.complete,
    })),
    [
      { date: "2026-09-01", burned: 2.5, buyback: 2.5, complete: false },
      { date: "2026-09-02", burned: 1, buyback: 0, complete: true },
      { date: "2026-09-03", burned: 0, buyback: 0, complete: true },
    ],
  );
});
