import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createDashboardRequestHandler } from "./http/app.js";
import { createQueryGateway } from "./http/query-gateway.js";

const staticHandler = createDashboardRequestHandler({
  publicDirectory: fileURLToPath(new URL("../public", import.meta.url)),
  dashboard: {
    health: () => ({ ok: false }),
    meta: () => null,
    overview: () => null,
    platformDetail: () => null,
    coverage: () => null,
    sources: () => null,
    refresh: async () => null,
  },
});
const gateway = createQueryGateway({
  upstream: process.env.COLLECTOR_ORIGIN ?? "http://127.0.0.1:4176",
  staticHandler,
});
const server = createServer(gateway.handler);
server.listen(Number(process.env.QUERY_PORT ?? "4175"), "127.0.0.1");
void gateway.refresh();
const timer = setInterval(() => {
  void gateway.refresh();
}, 5_000);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    clearInterval(timer);
    server.close(() => process.exit(0));
  });
