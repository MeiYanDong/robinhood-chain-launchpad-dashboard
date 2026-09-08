import type { RequestListener, ServerResponse } from "node:http";
import { promisify } from "node:util";
import { gzip } from "node:zlib";

const compress = promisify(gzip);
export const QUERY_CACHE_PATHS = [
  "/healthz",
  "/api/meta",
  "/api/platform-activity",
  "/api/intelligence/health",
  "/api/intelligence",
  "/api/pair/alpha/health",
  "/api/pair/alpha",
  "/api/pair/v2/health",
  "/api/pair/v2",
  "/api/dev-monitor/health",
  "/api/dev-monitor/pair-team-launches?limit=5&offset=0",
  "/api/pair/flow",
  "/api/pair/flow/events?type=all&window=today&limit=50&offset=0",
  "/api/economics",
  "/api/economics/health",
  "/api/economics/valuation",
  "/api/economics/sources",
  "/api/sources",
  "/api/pair/health",
  "/api/pair/rankings",
  "/api/long/health",
  "/api/long/rankings",
] as const;
export const QUERY_UPSTREAM_TIMEOUT_MS = 15_000;
export const QUERY_CACHE_MAX_AGE_MS = 60_000;
interface CachedResponse {
  body: Buffer;
  status: number;
  refreshedAt: number;
}
interface GatewayOptions {
  upstream: string;
  staticHandler: RequestListener;
  fetcher?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  cacheMaxAgeMs?: number;
}

/** No database or upstream credentials in this process. Bounded immutable reads. */
export function createQueryGateway(options: GatewayOptions) {
  const upstream = new URL(options.upstream);
  if (
    upstream.protocol !== "http:" ||
    upstream.hostname !== "127.0.0.1" ||
    upstream.username ||
    upstream.password ||
    upstream.pathname !== "/"
  ) {
    throw new Error("Query upstream must be a loopback HTTP origin");
  }
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const cache = new Map<string, CachedResponse>();
  const pending = new Map<string, Promise<CachedResponse>>();
  let refreshRunning = false;
  const maxAge = options.cacheMaxAgeMs ?? QUERY_CACHE_MAX_AGE_MS;
  async function read(path: string, method = "GET"): Promise<CachedResponse> {
    const key = `${method} ${path}`;
    const existing = pending.get(key);
    if (existing) return existing;
    if (pending.size >= 6) throw new Error("Query capacity reached");
    const operation = (async () => {
      const response = await fetcher(new URL(path, upstream), {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(
          method === "GET" ? (options.timeoutMs ?? QUERY_UPSTREAM_TIMEOUT_MS) : 180_000,
        ),
      });
      // Stream with a bound rather than allocate an arbitrary upstream response.
      const reader = response.body?.getReader();
      const parts: Uint8Array[] = [];
      let length = 0;
      if (reader) {
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            length += chunk.value.byteLength;
            if (length > 8 * 1024 * 1024) throw new Error("Response too large");
            parts.push(chunk.value);
          }
        } finally {
          await reader.cancel();
        }
      }
      const body = Buffer.concat(parts);
      JSON.parse(body.toString("utf8"));
      const entry = { body, status: response.status, refreshedAt: now() };
      if (
        method === "GET" &&
        response.ok &&
        QUERY_CACHE_PATHS.includes(path as (typeof QUERY_CACHE_PATHS)[number])
      )
        cache.set(path, entry);
      return entry;
    })().finally(() => pending.delete(key));
    pending.set(key, operation);
    return operation;
  }
  async function refresh() {
    if (refreshRunning) return;
    refreshRunning = true;
    try {
      for (let i = 0; i < QUERY_CACHE_PATHS.length; i += 3) {
        await Promise.allSettled(QUERY_CACHE_PATHS.slice(i, i + 3).map((path) => read(path)));
      }
    } finally {
      refreshRunning = false;
    }
  }
  async function send(response: ServerResponse, entry: CachedResponse, encoding: string) {
    const zipped = /\bgzip\b/.test(encoding) && !/gzip\s*;\s*q=0(?:[.,\s]|$)/.test(encoding);
    const body = zipped ? await compress(entry.body) : entry.body;
    response.writeHead(entry.status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "content-length": body.length,
      "x-content-type-options": "nosniff",
      vary: "Accept-Encoding",
      "x-ledger-query-age-ms": String(Math.max(0, now() - entry.refreshedAt)),
      ...(zipped ? { "content-encoding": "gzip" } : {}),
    });
    response.end(body);
  }
  const handler: RequestListener = async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      let path = url.pathname;
      for (const prefix of ["/leaders", "/launchpads", "/pair-flow", "/pair-v2", "/pair-alpha"]) {
        if (path.startsWith(`${prefix}/api/`)) path = path.slice(prefix.length);
      }
      if (path === "/healthz/query") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            ok: true,
            service: "rhc-query",
            cacheEntries: cache.size,
            pending: pending.size,
          }),
        );
        return;
      }
      if (path !== "/healthz" && !path.startsWith("/api/")) {
        options.staticHandler(request, response);
        return;
      }
      if (!["GET", "POST"].includes(request.method ?? "")) {
        response.writeHead(405);
        response.end();
        return;
      }
      if (
        request.method === "POST" &&
        !/^\/api\/(?:refresh|(?:pair|long)\/(?:refresh|reports\/generate)|economics\/(?:refresh|rebuild)|intelligence\/refresh|pair\/(?:flow|v2|alpha)\/refresh)$/.test(
          path,
        )
      ) {
        response.writeHead(404);
        response.end();
        return;
      }
      const key = `${path}${url.search}`;
      const cached = request.method === "GET" ? cache.get(key) : null;
      const entry =
        cached && now() - cached.refreshedAt < maxAge ? cached : await read(key, request.method);
      await send(response, entry, request.headers["accept-encoding"] ?? "");
    } catch {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      response.writeHead(503, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(
        JSON.stringify({
          ok: false,
          code: "COLLECTOR_UNAVAILABLE",
          stale: true,
          error: "采集服务暂不可用；已停止提供超过查询缓存时限的数据。",
        }),
      );
    }
  };
  return { handler, refresh };
}
