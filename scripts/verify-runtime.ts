import { RuntimeVerificationError, verifyRuntime } from "../src/ops/runtime-verifier.js";

const baseUrl = process.env.RUNTIME_BASE_URL ?? "http://127.0.0.1:4174";

try {
  const result = await verifyRuntime(baseUrl);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const code = error instanceof RuntimeVerificationError ? error.code : "UNEXPECTED_ERROR";
  console.error(JSON.stringify({ ok: false, code }));
  process.exitCode = 1;
}
