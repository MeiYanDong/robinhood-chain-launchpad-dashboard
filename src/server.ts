import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DashboardService } from "./services/dashboard.js";
import { DashboardDatabase } from "./storage/database.js";
import type { WindowDays } from "./domain/types.js";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const publicDirectory = join(projectRoot, "public");
const dataDirectory = resolve(process.env.DATA_DIR ?? join(projectRoot, "data"));
const databasePath = join(dataDirectory, "launchpad-dashboard.sqlite");
const port = Number.parseInt(process.env.PORT ?? "4174", 10);
const host = process.env.HOST ?? "127.0.0.1";
const cacheTtlMinutes = Number.parseInt(process.env.CACHE_TTL_MINUTES ?? "15", 10);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`Invalid PORT: ${process.env.PORT ?? ""}`);
}
if (!Number.isFinite(cacheTtlMinutes) || cacheTtlMinutes < 1) {
  throw new Error(`Invalid CACHE_TTL_MINUTES: ${process.env.CACHE_TTL_MINUTES ?? ""}`);
}

const database = new DashboardDatabase(databasePath);
const dashboard = new DashboardService(database, cacheTtlMinutes);

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function sendError(response: ServerResponse, status: number, message: string): void {
  sendJson(response, status, { error: message });
}

function parseWindow(value: string | null): WindowDays | null {
  const parsed = Number(value ?? "1");
  return parsed === 1 || parsed === 7 || parsed === 30 ? parsed : null;
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

function serveStatic(request: IncomingMessage, response: ServerResponse, pathname: string): void {
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const normalized = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = resolve(publicDirectory, normalized);

  if (!filePath.startsWith(`${resolve(publicDirectory)}/`) && filePath !== resolve(publicDirectory, "index.html")) {
    sendError(response, 403, "Forbidden");
    return;
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    sendError(response, 404, "Not found");
    return;
  }

  const contentType = MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
  response.writeHead(200, {
    "content-type": contentType,
    "cache-control": extname(filePath) === ".html" ? "no-cache" : "public, max-age=300",
    "x-content-type-options": "nosniff",
    "content-security-policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(filePath).pipe(response);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const pathname = decodeURIComponent(url.pathname);

    if (request.method === "GET" && pathname === "/healthz") {
      const health = dashboard.health();
      sendJson(response, health.ok ? 200 : 503, health);
      return;
    }

    if (request.method === "GET" && pathname === "/api/overview") {
      const windowDays = parseWindow(url.searchParams.get("window"));
      if (!windowDays) {
        sendError(response, 400, "window must be 1, 7, or 30");
        return;
      }
      sendJson(response, 200, dashboard.overview(windowDays));
      return;
    }

    if (request.method === "GET" && pathname.startsWith("/api/platforms/")) {
      const platformId = pathname.slice("/api/platforms/".length);
      if (!/^[a-z0-9-]+$/.test(platformId)) {
        sendError(response, 400, "Invalid platform id");
        return;
      }
      const detail = dashboard.platformDetail(platformId);
      if (!detail) {
        sendError(response, 404, "Platform not found");
        return;
      }
      sendJson(response, 200, detail);
      return;
    }

    if (request.method === "GET" && pathname === "/api/coverage") {
      sendJson(response, 200, dashboard.coverage());
      return;
    }

    if (request.method === "GET" && pathname === "/api/sources") {
      sendJson(response, 200, dashboard.sources());
      return;
    }

    if (request.method === "POST" && pathname === "/api/refresh") {
      const result = await dashboard.refresh();
      sendJson(response, 200, result);
      return;
    }

    if ((request.method === "GET" || request.method === "HEAD") && !pathname.startsWith("/api/")) {
      serveStatic(request, response, pathname);
      return;
    }

    sendError(response, 404, "Not found");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(error);
    sendError(response, 500, message);
  }
});

await dashboard.ensureFresh();

server.listen(port, host, () => {
  console.log(`RHC Launch Ledger listening on http://${host}:${port}`);
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
