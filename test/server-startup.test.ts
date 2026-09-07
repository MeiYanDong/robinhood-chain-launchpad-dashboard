import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("HTTP starts listening before slow upstream warm-up begins", async () => {
  const source = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");
  const listenAt = source.indexOf("server.listen(port, host");
  const warmAt = source.indexOf("void warmInitialData()");

  assert.notEqual(listenAt, -1);
  assert.notEqual(warmAt, -1);
  assert.ok(listenAt < warmAt);
  assert.doesNotMatch(source, /await dashboard\.ensureFresh\(\);/);
});
