import { rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

await rm(resolve(process.cwd(), "dist"), { recursive: true, force: true });

const tsc = spawn(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], {
  stdio: "inherit",
});

const exitCode = await new Promise((resolveExit) => {
  tsc.once("exit", (code) => resolveExit(code ?? 1));
  tsc.once("error", () => resolveExit(1));
});

process.exitCode = exitCode;
