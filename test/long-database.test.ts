import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LongTokenDatabase } from "../src/long-tokens/database.js";

const LEGACY_LONG_LAUNCHER = "0x22e99278308b393ea1260859b181ad7e78f5eeed";

test("Long SQLite keeps launcher attribution isolated and reusable", () => {
  const directory = mkdtempSync(join(tmpdir(), "long-db-"));
  const database = new LongTokenDatabase(join(directory, "test.sqlite"));
  const tokenAddress = `0x${"1".padStart(40, "0")}`;
  try {
    database.saveVerifiedMembership([
      {
        tokenAddress,
        launcherAddress: LEGACY_LONG_LAUNCHER,
        verifiedAt: "2026-09-01T00:00:00.000Z",
        blockNumber: "0x83c700",
        transactionHash: `0x${"a".repeat(64)}`,
      },
    ]);
    assert.deepEqual([...database.getVerifiedAddresses(LEGACY_LONG_LAUNCHER)], [tokenAddress]);
    assert.equal(database.getVerifiedAddresses(`0x${"2".repeat(40)}`).size, 0);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
