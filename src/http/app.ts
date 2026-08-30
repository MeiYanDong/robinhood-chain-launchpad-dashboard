import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { WindowDays } from "../domain/types.js";

export interface DashboardHttpApi {
  health(): { ok: boolean; [key: string]: unknown };
  meta(): unknown;
  overview(windowDays: WindowDays): unknown;
  platformDetail(platformId: string): unknown | null;
  coverage(): unknown;
  sources(): unknown;
  refresh(): Promise<unknown>;
}

export interface SafeLogger {
  error(event: string, context: Record<string, unknown>): void;
}

export interface DashboardRequestHandlerOptions {
  dashboard: DashboardHttpApi;
  publicDirectory: string;
  logger?: SafeLogger;
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

const DEFAULT_LOGGER: SafeLogger = {
  error(event, context) {
    console.error(event, context);
  },
};

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

function sendError(response: ServerResponse, status: number, code: string, message: string): void {
  sendJson(response, status, { error: message, code });
}

function parseWindow(value: string | null): WindowDays | null {
  const parsed = Number(value ?? "1");
  return parsed === 1 || parsed === 7 || parsed === 30 ? parsed : null;
}

function isOutsideRoot(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot);
}

function serveStatic(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  publicDirectory: string,
  logger: SafeLogger,
): void {
  const publicRoot = resolve(publicDirectory);
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = resolve(publicRoot, requested);

  if (pathname.includes("\0") || isOutsideRoot(publicRoot, filePath)) {
    sendError(response, 403, "FORBIDDEN", "Forbidden");
    return;
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    sendError(response, 404, "NOT_FOUND", "Not found");
    return;
  }

  const extension = extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[extension] ?? "application/octet-stream";
  response.writeHead(200, {
    "content-type": contentType,
    "cache-control": extension === ".html" ? "no-cache" : "public, max-age=300",
    "x-content-type-options": "nosniff",
    "content-security-policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }

  const stream = createReadStream(filePath);
  stream.on("error", (error) => {
    logger.error("static_file_read_failed", {
      pathname,
      errorName: error.name,
    });
    response.destroy();
  });
  stream.pipe(response);
}

export function createDashboardRequestHandler(
  options: DashboardRequestHandlerOptions,
): RequestListener {
  const logger = options.logger ?? DEFAULT_LOGGER;

  return async (request, response) => {
    let pathname = "/";
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        sendError(response, 400, "INVALID_PATH", "Invalid request path");
        return;
      }

      if (request.method === "GET" && pathname === "/healthz") {
        const health = options.dashboard.health();
        sendJson(response, health.ok ? 200 : 503, health);
        return;
      }

      if (request.method === "GET" && pathname === "/api/meta") {
        sendJson(response, 200, options.dashboard.meta());
        return;
      }

      if (request.method === "GET" && pathname === "/api/overview") {
        const windowDays = parseWindow(url.searchParams.get("window"));
        if (!windowDays) {
          sendError(response, 400, "INVALID_WINDOW", "window must be 1, 7, or 30");
          return;
        }
        sendJson(response, 200, options.dashboard.overview(windowDays));
        return;
      }

      if (request.method === "GET" && pathname.startsWith("/api/platforms/")) {
        const platformId = pathname.slice("/api/platforms/".length);
        if (!/^[a-z0-9-]+$/.test(platformId)) {
          sendError(response, 400, "INVALID_PLATFORM_ID", "Invalid platform id");
          return;
        }
        const detail = options.dashboard.platformDetail(platformId);
        if (!detail) {
          sendError(response, 404, "PLATFORM_NOT_FOUND", "Platform not found");
          return;
        }
        sendJson(response, 200, detail);
        return;
      }

      if (request.method === "GET" && pathname === "/api/coverage") {
        sendJson(response, 200, options.dashboard.coverage());
        return;
      }

      if (request.method === "GET" && pathname === "/api/sources") {
        sendJson(response, 200, options.dashboard.sources());
        return;
      }

      if (request.method === "POST" && pathname === "/api/refresh") {
        sendJson(response, 200, await options.dashboard.refresh());
        return;
      }

      if (
        (request.method === "GET" || request.method === "HEAD") &&
        !pathname.startsWith("/api/")
      ) {
        serveStatic(request, response, pathname, options.publicDirectory, logger);
        return;
      }

      sendError(response, 404, "NOT_FOUND", "Not found");
    } catch (error) {
      logger.error("dashboard_request_failed", {
        method: request.method ?? "UNKNOWN",
        pathname,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      if (!response.headersSent) {
        sendError(response, 500, "INTERNAL_ERROR", "Internal server error");
      } else {
        response.destroy();
      }
    }
  };
}
