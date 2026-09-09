import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import type {
  DevMonitorSnapshot,
  PairDevLaunchesQuery,
  PairDevLaunchesResponse,
  PairTeamLaunchesQuery,
  PairTeamLaunchesResponse,
} from "../dev-monitor/types.js";
import type { WindowDays } from "../domain/types.js";
import type { PairFlowEventsQuery } from "../pair-flow/types.js";
import type {
  PairAlphaRadarResponse,
  PairAlphaTokenView,
  PairV2ChainEvent,
  PairV2DashboardResponse,
  PairV2TokenView,
} from "../pair-v2/types.js";

export interface DashboardHttpApi {
  health(): { ok: boolean; [key: string]: unknown };
  meta(): unknown;
  overview(windowDays: WindowDays): unknown;
  platformActivity(): unknown;
  platformDetail(platformId: string): unknown | null;
  coverage(): unknown;
  sources(): unknown;
  refresh(): Promise<unknown>;
}

export interface PairTokenHttpApi {
  health(): { ok: boolean; [key: string]: unknown };
  rankings(): unknown;
  latestDailyReport(): unknown | null;
  sources(): unknown;
  refresh(): Promise<unknown>;
  generateDailyReport(): unknown;
}

export type LongTokenHttpApi = PairTokenHttpApi;

export interface PairFlowHttpApi {
  health(): { ok: boolean; [key: string]: unknown };
  ensureFresh(): Promise<unknown>;
  refresh(): Promise<unknown>;
  events(query: PairFlowEventsQuery): Promise<unknown>;
}

export interface PairV2HttpApi {
  health(): { ok: boolean; [key: string]: unknown };
  ensureFresh(): Promise<PairV2DashboardResponse>;
  refresh(kind?: "chain" | "full"): Promise<PairV2DashboardResponse>;
  token(address: string): PairV2TokenView | null;
  alpha(): PairAlphaRadarResponse | null;
  alphaToken(address: string): PairAlphaTokenView | null;
  events(limit?: number): { observedAt: string | null; items: PairV2ChainEvent[] };
}

export interface DevMonitorHttpApi {
  health(): DevMonitorSnapshot;
  pairLaunches(query: PairDevLaunchesQuery): PairDevLaunchesResponse;
  pairTeamLaunches(query: PairTeamLaunchesQuery): PairTeamLaunchesResponse;
}

export interface EconomicsHttpApi {
  health(): { ok: boolean; [key: string]: unknown };
  snapshot(): unknown | null;
  valuation(): unknown | null;
  valuationHistory(): unknown;
  sources(): unknown;
  refresh(): Promise<unknown>;
  refreshAll(): Promise<unknown>;
}

export interface IntelligenceHttpApi {
  health(): { ok: boolean; [key: string]: unknown };
  ensureFresh(): Promise<unknown>;
  refresh(): Promise<unknown>;
}

export interface ProductHttpApi {
  health(): { ok: boolean; [key: string]: unknown };
  ensureFresh(): Promise<unknown>;
  refresh(): Promise<unknown>;
}

export interface SafeLogger {
  error(event: string, context: Record<string, unknown>): void;
}

export interface DashboardRequestHandlerOptions {
  dashboard: DashboardHttpApi;
  pair?: PairTokenHttpApi;
  pairFlow?: PairFlowHttpApi;
  pairV2?: PairV2HttpApi;
  devMonitor?: DevMonitorHttpApi;
  long?: LongTokenHttpApi;
  economics?: EconomicsHttpApi;
  intelligence?: IntelligenceHttpApi;
  product?: ProductHttpApi;
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

function stripApplicationPrefix(pathname: string): string {
  for (const prefix of [
    "/assets/cashcat",
    "/leaders",
    "/launchpads",
    "/pair-flow",
    "/pair-v2",
    "/pair-alpha",
    "/market",
    "/alpha",
    "/assets",
  ]) {
    if (pathname === prefix || pathname === `${prefix}/`) return "/";
    if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length);
  }
  return pathname;
}

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function servesProductWorkbench(pathname: string, forwardedPrefix: string): boolean {
  if (pathname === "/") return true;
  return ["/market", "/alpha", "/assets"].some(
    (prefix) =>
      pathname === prefix ||
      pathname.startsWith(`${prefix}/`) ||
      forwardedPrefix === prefix ||
      forwardedPrefix.startsWith(`${prefix}/`),
  );
}

function parsePairFlowEventsQuery(url: URL): PairFlowEventsQuery | null {
  const type = url.searchParams.get("type") ?? "all";
  const window = url.searchParams.get("window") ?? "today";
  const limit = Number(url.searchParams.get("limit") ?? "100");
  const offset = Number(url.searchParams.get("offset") ?? "0");
  if (
    !["all", "buyback", "burn"].includes(type) ||
    !["today", "7d", "all"].includes(window) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 200 ||
    !Number.isInteger(offset) ||
    offset < 0
  ) {
    return null;
  }
  return {
    type: type as PairFlowEventsQuery["type"],
    window: window as PairFlowEventsQuery["window"],
    limit,
    offset,
  };
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
  entryDocument = "index.html",
): void {
  const publicRoot = resolve(publicDirectory);
  const requested = pathname === "/" ? entryDocument : pathname.replace(/^\/+/, "");
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
    let requestedPathname = "/";
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      try {
        requestedPathname = decodeURIComponent(url.pathname);
        pathname = stripApplicationPrefix(requestedPathname);
      } catch {
        sendError(response, 400, "INVALID_PATH", "Invalid request path");
        return;
      }

      if (request.method === "GET" && pathname === "/healthz") {
        const health = options.dashboard.health();
        sendJson(response, health.ok ? 200 : 503, health);
        return;
      }

      if (request.method === "GET" && pathname === "/api/dev-monitor/health") {
        if (!options.devMonitor) {
          sendError(response, 503, "DEV_MONITOR_UNAVAILABLE", "DEV monitor unavailable");
          return;
        }
        const health = options.devMonitor.health();
        sendJson(response, health.status === "failed" ? 503 : 200, health);
        return;
      }

      if (request.method === "GET" && pathname === "/api/dev-monitor/pair-launches") {
        if (!options.devMonitor) {
          sendError(response, 503, "DEV_MONITOR_UNAVAILABLE", "DEV monitor unavailable");
          return;
        }
        const tier = url.searchParams.get("tier") ?? "all";
        const limit = Number(url.searchParams.get("limit") ?? "20");
        const offset = Number(url.searchParams.get("offset") ?? "0");
        if (
          !["all", "watched", "candidate", "repeat", "proven"].includes(tier) ||
          !Number.isInteger(limit) ||
          limit < 1 ||
          limit > 500 ||
          !Number.isInteger(offset) ||
          offset < 0 ||
          offset > 10_000
        ) {
          sendError(
            response,
            400,
            "INVALID_PAIR_DEV_LAUNCH_QUERY",
            "tier, limit, or offset is invalid",
          );
          return;
        }
        sendJson(
          response,
          200,
          options.devMonitor.pairLaunches({
            tier: tier as PairDevLaunchesQuery["tier"],
            limit,
            offset,
          }),
        );
        return;
      }

      if (request.method === "GET" && pathname === "/api/dev-monitor/pair-team-launches") {
        if (!options.devMonitor) {
          sendError(response, 503, "DEV_MONITOR_UNAVAILABLE", "DEV monitor unavailable");
          return;
        }
        const limit = Number(url.searchParams.get("limit") ?? "20");
        const offset = Number(url.searchParams.get("offset") ?? "0");
        if (
          !Number.isInteger(limit) ||
          limit < 1 ||
          limit > 500 ||
          !Number.isInteger(offset) ||
          offset < 0 ||
          offset > 10_000
        ) {
          sendError(response, 400, "INVALID_PAIR_TEAM_LAUNCH_QUERY", "limit or offset is invalid");
          return;
        }
        sendJson(response, 200, options.devMonitor.pairTeamLaunches({ limit, offset }));
        return;
      }

      if (request.method === "GET" && pathname === "/api/meta") {
        sendJson(response, 200, options.dashboard.meta());
        return;
      }

      if (pathname.startsWith("/api/product")) {
        if (!options.product) {
          sendError(
            response,
            503,
            "PRODUCT_WORKBENCH_UNAVAILABLE",
            "Product workbench unavailable",
          );
          return;
        }
        if (request.method === "GET" && pathname === "/api/product/health") {
          const health = options.product.health();
          sendJson(response, health.ok ? 200 : 503, health);
          return;
        }
        if (request.method === "GET" && pathname === "/api/product/today") {
          sendJson(response, 200, await options.product.ensureFresh());
          return;
        }
        if (request.method === "POST" && pathname === "/api/product/refresh") {
          sendJson(response, 200, await options.product.refresh());
          return;
        }
      }

      if (pathname.startsWith("/api/intelligence")) {
        if (!options.intelligence) {
          sendError(
            response,
            503,
            "INTELLIGENCE_MODULE_UNAVAILABLE",
            "Market intelligence module unavailable",
          );
          return;
        }
        if (request.method === "GET" && pathname === "/api/intelligence/health") {
          const health = options.intelligence.health();
          sendJson(response, health.ok ? 200 : 503, health);
          return;
        }
        if (request.method === "GET" && pathname === "/api/intelligence") {
          sendJson(response, 200, await options.intelligence.ensureFresh());
          return;
        }
        if (request.method === "POST" && pathname === "/api/intelligence/refresh") {
          sendJson(response, 200, await options.intelligence.refresh());
          return;
        }
      }

      if (pathname.startsWith("/api/economics")) {
        if (!options.economics) {
          sendError(response, 503, "ECONOMICS_MODULE_UNAVAILABLE", "Economics module unavailable");
          return;
        }
        if (request.method === "GET" && pathname === "/api/economics/health") {
          const health = options.economics.health();
          sendJson(response, health.ok ? 200 : 503, health);
          return;
        }
        if (request.method === "GET" && pathname === "/api/economics/valuation/history") {
          sendJson(response, 200, options.economics.valuationHistory());
          return;
        }
        if (request.method === "GET" && pathname === "/api/economics/valuation") {
          const valuation = options.economics.valuation();
          if (!valuation) {
            sendError(response, 503, "VALUATION_NOT_READY", "Valuation data is not ready");
            return;
          }
          sendJson(response, 200, valuation);
          return;
        }
        if (request.method === "GET" && pathname === "/api/economics") {
          const snapshot = options.economics.snapshot();
          if (!snapshot) {
            sendError(response, 503, "ECONOMICS_NOT_READY", "Economics data is not ready");
            return;
          }
          sendJson(response, 200, snapshot);
          return;
        }
        if (request.method === "GET" && pathname === "/api/economics/sources") {
          sendJson(response, 200, options.economics.sources());
          return;
        }
        if (request.method === "POST" && pathname === "/api/economics/refresh") {
          sendJson(response, 200, await options.economics.refreshAll());
          return;
        }
        if (request.method === "POST" && pathname === "/api/economics/rebuild") {
          sendJson(response, 200, await options.economics.refresh());
          return;
        }
      }

      if (pathname.startsWith("/api/pair/")) {
        if (pathname.startsWith("/api/pair/alpha")) {
          if (!options.pairV2) {
            sendError(
              response,
              503,
              "PAIR_ALPHA_MODULE_UNAVAILABLE",
              "PAIR Alpha module unavailable",
            );
            return;
          }
          if (request.method === "GET" && pathname === "/api/pair/alpha/health") {
            const health = options.pairV2.health();
            sendJson(response, health.ok ? 200 : 503, {
              ...health,
              service: "rhc-pair-alpha-radar",
            });
            return;
          }
          if (request.method === "GET" && pathname.startsWith("/api/pair/alpha/tokens/")) {
            const address = pathname.slice("/api/pair/alpha/tokens/".length).toLowerCase();
            if (!/^0x[0-9a-f]{40}$/.test(address)) {
              sendError(response, 400, "INVALID_PAIR_ALPHA_TOKEN", "token address is invalid");
              return;
            }
            await options.pairV2.ensureFresh();
            const token = options.pairV2.alphaToken(address);
            if (!token) {
              sendError(response, 404, "PAIR_ALPHA_TOKEN_NOT_FOUND", "PAIR token not found");
              return;
            }
            sendJson(response, 200, token);
            return;
          }
          if (request.method === "GET" && pathname === "/api/pair/alpha") {
            await options.pairV2.ensureFresh();
            const alpha = options.pairV2.alpha();
            if (!alpha) {
              sendError(response, 503, "PAIR_ALPHA_NOT_READY", "PAIR Alpha radar is not ready");
              return;
            }
            sendJson(response, 200, alpha);
            return;
          }
          if (request.method === "POST" && pathname === "/api/pair/alpha/refresh") {
            await options.pairV2.refresh("full");
            const alpha = options.pairV2.alpha();
            if (!alpha) {
              sendError(response, 503, "PAIR_ALPHA_NOT_READY", "PAIR Alpha radar is not ready");
              return;
            }
            sendJson(response, 200, alpha);
            return;
          }
        }
        if (pathname.startsWith("/api/pair/v2")) {
          if (!options.pairV2) {
            sendError(response, 503, "PAIR_V2_MODULE_UNAVAILABLE", "PAIR V2 module unavailable");
            return;
          }
          if (request.method === "GET" && pathname === "/api/pair/v2/health") {
            const health = options.pairV2.health();
            sendJson(response, health.ok ? 200 : 503, health);
            return;
          }
          if (request.method === "GET" && pathname === "/api/pair/v2/events") {
            const limit = Number(url.searchParams.get("limit") ?? "100");
            if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
              sendError(response, 400, "INVALID_PAIR_V2_EVENT_LIMIT", "limit must be 1 to 200");
              return;
            }
            sendJson(response, 200, options.pairV2.events(limit));
            return;
          }
          if (request.method === "GET" && pathname.startsWith("/api/pair/v2/tokens/")) {
            const address = pathname.slice("/api/pair/v2/tokens/".length).toLowerCase();
            if (!/^0x[0-9a-f]{40}$/.test(address)) {
              sendError(response, 400, "INVALID_PAIR_V2_TOKEN", "token address is invalid");
              return;
            }
            const token = options.pairV2.token(address);
            if (!token) {
              sendError(response, 404, "PAIR_V2_TOKEN_NOT_FOUND", "PAIR V2 token not found");
              return;
            }
            sendJson(response, 200, token);
            return;
          }
          if (request.method === "GET" && pathname === "/api/pair/v2") {
            sendJson(response, 200, await options.pairV2.ensureFresh());
            return;
          }
          if (request.method === "POST" && pathname === "/api/pair/v2/refresh") {
            sendJson(response, 200, await options.pairV2.refresh("full"));
            return;
          }
        }
        if (pathname.startsWith("/api/pair/flow")) {
          if (!options.pairFlow) {
            sendError(
              response,
              503,
              "PAIR_FLOW_MODULE_UNAVAILABLE",
              "PAIR flow module unavailable",
            );
            return;
          }
          if (request.method === "GET" && pathname === "/api/pair/flow/health") {
            const health = options.pairFlow.health();
            sendJson(response, health.ok ? 200 : 503, health);
            return;
          }
          if (request.method === "GET" && pathname === "/api/pair/flow/events") {
            const query = parsePairFlowEventsQuery(url);
            if (!query) {
              sendError(
                response,
                400,
                "INVALID_PAIR_FLOW_EVENTS_QUERY",
                "type, window, limit, or offset is invalid",
              );
              return;
            }
            sendJson(response, 200, await options.pairFlow.events(query));
            return;
          }
          if (request.method === "GET" && pathname === "/api/pair/flow") {
            sendJson(response, 200, await options.pairFlow.ensureFresh());
            return;
          }
          if (request.method === "POST" && pathname === "/api/pair/flow/refresh") {
            sendJson(response, 200, await options.pairFlow.refresh());
            return;
          }
        }
        if (!options.pair) {
          sendError(response, 503, "PAIR_MODULE_UNAVAILABLE", "PAIR module unavailable");
          return;
        }
        if (request.method === "GET" && pathname === "/api/pair/health") {
          const health = options.pair.health();
          sendJson(response, health.ok ? 200 : 503, health);
          return;
        }
        if (request.method === "GET" && pathname === "/api/pair/rankings") {
          sendJson(response, 200, options.pair.rankings());
          return;
        }
        if (request.method === "GET" && pathname === "/api/pair/reports/latest") {
          const report = options.pair.latestDailyReport();
          if (!report) {
            sendError(response, 404, "PAIR_REPORT_NOT_FOUND", "PAIR daily report not found");
            return;
          }
          sendJson(response, 200, report);
          return;
        }
        if (request.method === "GET" && pathname === "/api/pair/sources") {
          sendJson(response, 200, options.pair.sources());
          return;
        }
        if (request.method === "POST" && pathname === "/api/pair/refresh") {
          sendJson(response, 200, await options.pair.refresh());
          return;
        }
        if (request.method === "POST" && pathname === "/api/pair/reports/generate") {
          sendJson(response, 200, options.pair.generateDailyReport());
          return;
        }
      }

      if (pathname.startsWith("/api/long/")) {
        if (!options.long) {
          sendError(response, 503, "LONG_MODULE_UNAVAILABLE", "Long module unavailable");
          return;
        }
        if (request.method === "GET" && pathname === "/api/long/health") {
          const health = options.long.health();
          sendJson(response, health.ok ? 200 : 503, health);
          return;
        }
        if (request.method === "GET" && pathname === "/api/long/rankings") {
          sendJson(response, 200, options.long.rankings());
          return;
        }
        if (request.method === "GET" && pathname === "/api/long/reports/latest") {
          const report = options.long.latestDailyReport();
          if (!report) {
            sendError(response, 404, "LONG_REPORT_NOT_FOUND", "Long daily report not found");
            return;
          }
          sendJson(response, 200, report);
          return;
        }
        if (request.method === "GET" && pathname === "/api/long/sources") {
          sendJson(response, 200, options.long.sources());
          return;
        }
        if (request.method === "POST" && pathname === "/api/long/refresh") {
          sendJson(response, 200, await options.long.refresh());
          return;
        }
        if (request.method === "POST" && pathname === "/api/long/reports/generate") {
          sendJson(response, 200, options.long.generateDailyReport());
          return;
        }
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

      if (request.method === "GET" && pathname === "/api/platform-activity") {
        sendJson(response, 200, options.dashboard.platformActivity());
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
        const productSurface = servesProductWorkbench(
          requestedPathname,
          headerValue(request.headers["x-forwarded-prefix"]),
        );
        serveStatic(
          request,
          response,
          pathname,
          options.publicDirectory,
          logger,
          productSurface ? "product.html" : "index.html",
        );
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
