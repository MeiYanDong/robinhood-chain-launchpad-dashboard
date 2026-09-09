import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { devMonitorSettingsFromEnv } from "./dev-monitor/config.js";
import { DevMonitorDatabase } from "./dev-monitor/database.js";
import { DevMonitorService } from "./dev-monitor/service.js";
import { EconomicsCollector } from "./economics/collector.js";
import { economicsSettingsFromEnv } from "./economics/config.js";
import { EconomicsDatabase } from "./economics/database.js";
import { EconomicsService } from "./economics/service.js";
import { createDashboardRequestHandler } from "./http/app.js";
import { intelligenceSettingsFromEnv } from "./intelligence/config.js";
import { IntelligenceService } from "./intelligence/service.js";
import { LongTokenCollector } from "./long-tokens/collector.js";
import { longTokenSettingsFromEnv } from "./long-tokens/config.js";
import { LongTokenDatabase } from "./long-tokens/database.js";
import { LongTokenService } from "./long-tokens/service.js";
import { PairTokenCollector } from "./pair/collector.js";
import { pairTokenSettingsFromEnv } from "./pair/config.js";
import { PairTokenDatabase } from "./pair/database.js";
import { PairTokenService } from "./pair/service.js";
import { PairFlowCollector } from "./pair-flow/collector.js";
import { pairFlowSettingsFromEnv } from "./pair-flow/config.js";
import { PairFlowDatabase } from "./pair-flow/database.js";
import { PairFlowService } from "./pair-flow/service.js";
import { PairV2Collector } from "./pair-v2/collector.js";
import { pairV2SettingsFromEnv } from "./pair-v2/config.js";
import { PairV2Database } from "./pair-v2/database.js";
import { PairV2Service } from "./pair-v2/service.js";
import { ProductService } from "./product/service.js";
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
const pairSettings = pairTokenSettingsFromEnv();
const pairDatabase = new PairTokenDatabase(databasePath);
const pairCollector = new PairTokenCollector(pairSettings);
const pair = new PairTokenService(pairDatabase, pairSettings, pairCollector);
const pairFlowSettings = pairFlowSettingsFromEnv();
const pairFlowDatabase = new PairFlowDatabase(databasePath);
const pairFlowCollector = new PairFlowCollector(pairFlowSettings, {
  platformVolume: () => pair.platformLive(),
});
const pairFlow = new PairFlowService(pairFlowDatabase, pairFlowSettings, pairFlowCollector);
const pairV2Settings = pairV2SettingsFromEnv();
const monitorDatabasePath = process.env.MONITOR_DATABASE_PATH
  ? resolve(process.env.MONITOR_DATABASE_PATH)
  : databasePath;
const pairV2Database = new PairV2Database(monitorDatabasePath);
const pairV2Collector = new PairV2Collector(pairV2Settings);
const pairV2 = new PairV2Service(pairV2Database, pairV2Settings, pairV2Collector);
const devMonitorSettings = devMonitorSettingsFromEnv();
const devMonitorDatabase = new DevMonitorDatabase(monitorDatabasePath);
const devMonitor = new DevMonitorService(devMonitorDatabase, devMonitorSettings, pairV2, {
  pairTokens: pair,
});
const longSettings = longTokenSettingsFromEnv();
const longDatabase = new LongTokenDatabase(databasePath);
const longCollector = new LongTokenCollector(longSettings);
const long = new LongTokenService(longDatabase, longSettings, longCollector);
const economicsSettings = economicsSettingsFromEnv();
const economicsDatabase = new EconomicsDatabase(databasePath);
const economicsCollector = new EconomicsCollector(economicsSettings);
const economics = new EconomicsService(
  economicsDatabase,
  economicsSettings,
  { dashboard, pair, long },
  economicsCollector,
);
const intelligenceSettings = intelligenceSettingsFromEnv();
const intelligence = new IntelligenceService(intelligenceSettings, {
  economics,
  pair,
  long,
  dashboard,
});
const product = new ProductService(intelligenceSettings, { intelligence });
const server = createServer(
  createDashboardRequestHandler({
    dashboard,
    pair,
    pairFlow,
    pairV2,
    devMonitor,
    long,
    economics,
    intelligence,
    product,
    publicDirectory,
  }),
);

server.listen(port, host, () => {
  console.log(`RHC Launch Ledger listening on http://${host}:${String(port)}`);
  console.log(`SQLite cache: ${databasePath}`);
});

// Listening must not depend on slow or unavailable upstreams. Cached reads and
// explicit 503 responses remain available while each source warms in the
// background after a cold start.
pairV2.start();
void warmInitialData();

async function warmInitialData(): Promise<void> {
  const refresh = async (name: string, operation: () => Promise<unknown>): Promise<void> => {
    try {
      await operation();
    } catch (error) {
      console.warn(`${name}_initial_refresh_failed`, {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  };

  // Let the DEV monitor establish its PAIR source baseline from a ready snapshot.
  // This also avoids two cold RPC scanners competing for the public endpoint.
  await refresh("pair_v2", () => pairV2.ensureFresh());
  devMonitor.start();
  await refresh("dashboard", () => dashboard.ensureFresh());
  await refresh("pair", () => pair.ensureFresh());
  await refresh("long", () => long.ensureFresh());
  await refresh("economics", () => economics.ensureFresh());
  await refresh("pair_flow", () => pairFlow.ensureFresh());
  await refresh("intelligence", () => intelligence.ensureFresh());
  await refresh("product", () => product.ensureFresh());
}

function shutdown(signal: string): void {
  console.log(`Received ${signal}; shutting down.`);
  pairV2.stop();
  devMonitor.stop();
  server.close(() => {
    database.close();
    pairDatabase.close();
    longDatabase.close();
    economicsDatabase.close();
    pairFlowDatabase.close();
    pairV2Database.close();
    devMonitorDatabase.close();
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
