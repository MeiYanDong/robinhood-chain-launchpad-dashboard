import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_LONG_TOKEN_SETTINGS } from "../src/long-tokens/config.js";
import { LongTokenDatabase } from "../src/long-tokens/database.js";

test("Long SQLite keeps launcher attribution isolated and reusable", () => {
  const directory = mkdtempSync(join(tmpdir(), "long-db-"));
  const database = new LongTokenDatabase(join(directory, "test.sqlite"));
  const tokenAddress = `0x${"1".padStart(40, "0")}`;
  try {
    database.saveVerifiedMembership([
      {
        tokenAddress,
        launcherAddress: DEFAULT_LONG_TOKEN_SETTINGS.launcherAddress,
        verifiedAt: "2026-09-01T00:00:00.000Z",
        blockNumber: "0x83c700",
        transactionHash: `0x${"a".repeat(64)}`,
      },
    ]);
    assert.deepEqual(
      [...database.getVerifiedAddresses(DEFAULT_LONG_TOKEN_SETTINGS.launcherAddress)],
      [tokenAddress],
    );
    assert.equal(database.getVerifiedAddresses(`0x${"2".repeat(40)}`).size, 0);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
