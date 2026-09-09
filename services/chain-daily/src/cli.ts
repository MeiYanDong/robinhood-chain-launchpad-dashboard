#!/usr/bin/env node
import { collect } from "./collector.js";
import { generateReport, writeReport } from "./report.js";
import { startServer } from "./server.js";
import { isIsoDate, previousUtcDate, sanitize } from "./utils.js";

interface Options {
  date?: string;
  host?: string;
  port?: number;
}

function parseOptions(args: string[]): Options {
  const options: Options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--date") {
      const date = args[index + 1];
      if (!date || !isIsoDate(date)) throw new Error("--date must be YYYY-MM-DD");
      options.date = date;
      index += 1;
    } else if (arg === "--host") {
      const host = args[index + 1];
      if (!host) throw new Error("--host requires a value");
      options.host = host;
      index += 1;
    } else if (arg === "--port") {
      const port = Number(args[index + 1]);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port must be 1-65535");
      options.port = port;
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function help(): void {
  console.log(`Robinhood Chain 日度雷达（只读）

用法：
  npm run collect -- [--date YYYY-MM-DD]
  npm run report  -- [--date YYYY-MM-DD]
  npm run daily   -- [--date YYYY-MM-DD]
  npm run serve   -- [--host 127.0.0.1] [--port 4173]

默认采集最后一个已结束的 UTC 自然日。`);
}

async function main(): Promise<void> {
  const [command = "help", ...args] = process.argv.slice(2);
  const options = parseOptions(args);
  if (command === "help" || command === "--help" || command === "-h") {
    help();
    return;
  }
  if (command === "serve") {
    const host = options.host ?? process.env.RADAR_HOST ?? "127.0.0.1";
    const port = options.port ?? Number(process.env.RADAR_PORT ?? 4173);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("RADAR_PORT must be 1-65535");
    await startServer(host, port);
    return;
  }

  const targetDate = options.date ?? previousUtcDate();
  if (command === "collect") {
    const snapshot = await collect(targetDate);
    console.log(`已采集 ${snapshot.targetDate}：${snapshot.quality.okMetrics} 正常，${snapshot.quality.staleMetrics} 延迟，${snapshot.quality.unavailableMetrics} UNKNOWN。`);
    return;
  }
  if (command === "report") {
    const { snapshot } = await generateReport(options.date);
    console.log(`已生成 reports/${snapshot.targetDate}.md`);
    return;
  }
  if (command === "daily") {
    const snapshot = await collect(targetDate);
    await writeReport(snapshot);
    console.log(`日报完成：${snapshot.targetDate}｜${snapshot.verdict}`);
    console.log(`看板数据：data/latest.json｜日报：reports/${snapshot.targetDate}.md`);
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(`失败：${sanitize(error instanceof Error ? error.message : String(error))}`);
  process.exitCode = 1;
});
