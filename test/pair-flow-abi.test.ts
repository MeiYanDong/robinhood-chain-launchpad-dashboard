import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeAggregate3,
  decodeOraclePrice,
  decodeUint,
  encodeAggregate3,
  encodeBalanceOf,
  encodeClaimable,
  encodeCollectFees,
  encodePriceOf,
  encodeTotalSupply,
} from "../src/pair-flow/abi.js";

const addressA = `0x${"1".repeat(40)}`;
const addressB = `0x${"2".repeat(40)}`;

function word(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function encodedBytes(value: string): string {
  const bytes = value.slice(2);
  const padding = (64 - (bytes.length % 64)) % 64;
  return `${word(BigInt(bytes.length / 2))}${bytes}${"0".repeat(padding)}`;
}

function aggregateResult(values: Array<{ success: boolean; data: string }>): string {
  const tuples = values.map(
    (value) => `${word(value.success ? 1n : 0n)}${word(64n)}${encodedBytes(value.data)}`,
  );
  let offset = BigInt(values.length * 32);
  const offsets = tuples.map((tuple) => {
    const current = word(offset);
    offset += BigInt(tuple.length / 2);
    return current;
  });
  return `0x${word(32n)}${word(BigInt(values.length))}${offsets.join("")}${tuples.join("")}`;
}

test("PAIR flow ABI encodes all read-only selectors and multicall tuples", () => {
  assert.equal(encodeTotalSupply(), "0x18160ddd");
  assert.match(encodeBalanceOf(addressA), /^0x70a08231[0-9a-f]{64}$/);
  assert.match(encodeClaimable(addressA, addressB), /^0xd4570c1c[0-9a-f]{128}$/);
  assert.match(encodeCollectFees("1152094"), /^0xb17acdcd[0-9a-f]{64}$/);
  assert.match(encodePriceOf(addressB), /^0xb95ed06f[0-9a-f]{64}$/);

  const encoded = encodeAggregate3([
    { target: addressA, allowFailure: true, callData: encodeTotalSupply() },
    { target: addressB, allowFailure: false, callData: encodeBalanceOf(addressA) },
  ]);
  assert.match(encoded, /^0x82ad56cb/);
  assert.ok(encoded.includes(addressA.slice(2)));
  assert.ok(encoded.includes(addressB.slice(2)));
});

test("PAIR flow ABI decodes partial multicall results and scaled values", () => {
  const encoded = aggregateResult([
    { success: true, data: `0x${word(1_250_000_000_000_000_000n)}` },
    { success: false, data: "0x" },
  ]);
  assert.deepEqual(decodeAggregate3(encoded), [
    { success: true, returnData: `0x${word(1_250_000_000_000_000_000n)}` },
    { success: false, returnData: "0x" },
  ]);
  assert.equal(decodeUint(`0x${word(1_250_000_000_000_000_000n)}`, 18), 1.25);
  assert.equal(decodeUint("0xbroken", 18), null);
});

test("PAIR flow ABI decodes the eight-decimal oracle price and timestamp", () => {
  const oracle = decodeOraclePrice(
    `0x${word(77_078_000_000n)}${word(BigInt(Date.parse("2026-09-04T16:25:14.000Z") / 1_000))}`,
  );
  assert.deepEqual(oracle, {
    priceUsd: 770.78,
    updatedAt: "2026-09-04T16:25:14.000Z",
  });
  assert.equal(decodeOraclePrice("0x00"), null);
});

test("PAIR flow ABI rejects unsafe call shapes", () => {
  assert.throws(() => encodeAggregate3([]), /at least one/);
  assert.throws(() => encodeBalanceOf("0x1234"), /address/);
  assert.throws(() => encodeCollectFees("1e3"), /token id/);
  assert.throws(
    () => decodeAggregate3("0x00"),
    /ended before a full word|byte-aligned hexadecimal/,
  );
});
