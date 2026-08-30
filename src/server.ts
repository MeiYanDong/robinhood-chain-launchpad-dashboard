import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDashboardRequestHandler } from "./http/app.js";
import { DashboardService } from "./services/dashboard.js";
import { DashboardDatabase } from "./storage/database.js";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const publicDirectory = join(projectRoot, "public");
const dataDirectory = resolve(process.env.DATA_DIR ?? join(projectRoot, "data"));
const databasePath = join(dataDirectory, "launchpad-dashboard.sqlite");
const port = Number.parseInt(process.env.PORT ?? "4174", 10);
const host = process.env.HOST ?? "127.0.0.1";
const cacheTtlMinutes = Number.parseInt(process.env.CACHE_TTL_MINUTES ?? "15", 10);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}
if (!Number.isFinite(cacheTtlMinutes) || cacheTtlMinutes < 1) {
  throw new Error("CACHE_TTL_MINUTES must be a positive number");
}

const database = new DashboardDatabase(databasePath);
const dashboard = new DashboardService(database, cacheTtlMinutes);
const server = createServer(
  createDashboardRequestHandler({
    dashboard,
    publicDirectory,
  }),
);

await dashboard.ensureFresh();

server.listen(port, host, () => {
  console.log(`RHC Launch Ledger listening on http://${host}:${String(port)}`);
  console.log(`SQLite cache: ${databasePath}`);
});

function shutdown(signal: string): void {
  console.log(`Received ${signal}; shutting down.`);
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
