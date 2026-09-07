const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const HEX_PATTERN = /^0x(?:[0-9a-fA-F]{2})*$/;
const WORD_HEX_LENGTH = 64;

export interface Multicall3Call {
  target: string;
  allowFailure: boolean;
  callData: string;
}

export interface Multicall3Result {
  success: boolean;
  returnData: string;
}

function stripHex(value: string): string {
  if (!HEX_PATTERN.test(value)) throw new Error("ABI value is not byte-aligned hexadecimal");
  return value.slice(2).toLowerCase();
}

function word(value: bigint): string {
  if (value < 0n) throw new Error("ABI word cannot encode a negative integer");
  const encoded = value.toString(16);
  if (encoded.length > WORD_HEX_LENGTH) throw new Error("ABI integer exceeds one word");
  return encoded.padStart(WORD_HEX_LENGTH, "0");
}

function addressWord(address: string): string {
  if (!ADDRESS_PATTERN.test(address)) throw new Error("ABI address is invalid");
  return address.slice(2).toLowerCase().padStart(WORD_HEX_LENGTH, "0");
}

function paddedBytes(value: string): string {
  const encoded = stripHex(value);
  const padding = (WORD_HEX_LENGTH - (encoded.length % WORD_HEX_LENGTH)) % WORD_HEX_LENGTH;
  return `${word(BigInt(encoded.length / 2))}${encoded}${"0".repeat(padding)}`;
}

function dynamicTuple(call: Multicall3Call): string {
  return `${addressWord(call.target)}${word(call.allowFailure ? 1n : 0n)}${word(96n)}${paddedBytes(call.callData)}`;
}

export function encodeAggregate3(calls: Multicall3Call[]): string {
  if (calls.length === 0) throw new Error("Multicall requires at least one call");
  const tuples = calls.map(dynamicTuple);
  let offset = BigInt(calls.length * 32);
  const offsets = tuples.map((tuple) => {
    const current = word(offset);
    offset += BigInt(tuple.length / 2);
    return current;
  });
  const array = `${word(BigInt(calls.length))}${offsets.join("")}${tuples.join("")}`;
  return `0x82ad56cb${word(32n)}${array}`;
}

function readWord(encoded: string, byteOffset: number): bigint {
  if (!Number.isSafeInteger(byteOffset) || byteOffset < 0) {
    throw new Error("ABI byte offset is invalid");
  }
  const start = byteOffset * 2;
  const value = encoded.slice(start, start + WORD_HEX_LENGTH);
  if (value.length !== WORD_HEX_LENGTH) throw new Error("ABI response ended before a full word");
  return BigInt(`0x${value}`);
}

function safeOffset(value: bigint): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("ABI offset is out of range");
  return parsed;
}

export function decodeAggregate3(value: string): Multicall3Result[] {
  const encoded = stripHex(value);
  const arrayStart = safeOffset(readWord(encoded, 0));
  const count = safeOffset(readWord(encoded, arrayStart));
  if (count > 10_000) throw new Error("ABI result array exceeds safety cap");
  const headStart = arrayStart + 32;
  const results: Multicall3Result[] = [];
  for (let index = 0; index < count; index += 1) {
    const tupleOffset = safeOffset(readWord(encoded, headStart + index * 32));
    const tupleStart = headStart + tupleOffset;
    const success = readWord(encoded, tupleStart) !== 0n;
    const bytesOffset = safeOffset(readWord(encoded, tupleStart + 32));
    const bytesStart = tupleStart + bytesOffset;
    const length = safeOffset(readWord(encoded, bytesStart));
    const dataStart = (bytesStart + 32) * 2;
    const data = encoded.slice(dataStart, dataStart + length * 2);
    if (data.length !== length * 2) throw new Error("ABI result bytes are truncated");
    results.push({ success, returnData: `0x${data}` });
  }
  return results;
}

export function encodeClaimable(recipient: string, asset: string): string {
  return `0xd4570c1c${addressWord(recipient)}${addressWord(asset)}`;
}

export function encodeCollectFees(tokenId: string): string {
  if (!/^\d+$/.test(tokenId)) throw new Error("Position token id is invalid");
  return `0xb17acdcd${word(BigInt(tokenId))}`;
}

export function encodeBalanceOf(address: string): string {
  return `0x70a08231${addressWord(address)}`;
}

export function encodeTotalSupply(): string {
  return "0x18160ddd";
}

export function encodePriceOf(address: string): string {
  return `0xb95ed06f${addressWord(address)}`;
}

export function decodeUint(value: string, decimals = 0): number | null {
  try {
    const encoded = stripHex(value);
    const raw = readWord(encoded, 0);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
    const divisor = 10n ** BigInt(decimals);
    const whole = raw / divisor;
    const fraction = raw % divisor;
    const parsed = Number(whole) + Number(fraction) / Number(divisor);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function decodeOraclePrice(
  value: string,
): { priceUsd: number; updatedAt: string | null } | null {
  try {
    const encoded = stripHex(value);
    const price = readWord(encoded, 0);
    const updatedAt = readWord(encoded, 32);
    const priceUsd = Number(price) / 100_000_000;
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) return null;
    const timestampMs = Number(updatedAt) * 1_000;
    return {
      priceUsd,
      updatedAt:
        Number.isFinite(timestampMs) && timestampMs > 0
          ? new Date(timestampMs).toISOString()
          : null,
    };
  } catch {
    return null;
  }
}
