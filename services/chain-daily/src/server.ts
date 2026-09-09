import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { extname, resolve } from "node:path";
import type { DashboardSnapshot } from "./types.js";
import { isIsoDate, readJson, sanitize } from "./utils.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function headers(contentType: string): Record<string, string> {
  return {
    "content-type": contentType,
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'",
  };
}

async function history(): Promise<Array<Pick<DashboardSnapshot, "targetDate" | "generatedAt" | "verdict" | "quality">>> {
  let files: string[] = [];
  try {
    files = (await readdir(resolve("data/snapshots"))).filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file)).sort().reverse();
  } catch {
    return [];
  }
  const snapshots = await Promise.all(files.slice(0, 90).map((file) => readJson<DashboardSnapshot>(`data/snapshots/${file}`)));
  return snapshots.map(({ targetDate, generatedAt, verdict, quality }) => ({ targetDate, generatedAt, verdict, quality }));
}

export async function startServer(host: string, port: number): Promise<void> {
  const staticFiles: Record<string, string> = {
    "/": "web/index.html",
    "/index.html": "web/index.html",
    "/styles.css": "web/styles.css",
    "/app.js": "web/app.js",
    "/favicon.svg": "web/favicon.svg",
  };

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      if (request.method !== "GET") {
        response.writeHead(405, headers("application/json"));
        response.end(JSON.stringify({ error: "method_not_allowed" }));
        return;
      }
      if (url.pathname === "/api/latest") {
        const data = await readFile(resolve("data/latest.json"));
        response.writeHead(200, { ...headers("application/json; charset=utf-8"), "cache-control": "no-store" });
        response.end(data);
        return;
      }
      if (url.pathname === "/api/snapshot") {
        const date = url.searchParams.get("date") ?? "";
        if (!isIsoDate(date)) throw new Error("Invalid snapshot date");
        const data = await readFile(resolve(`data/snapshots/${date}.json`));
        response.writeHead(200, { ...headers("application/json; charset=utf-8"), "cache-control": "no-store" });
        response.end(data);
        return;
      }
      if (url.pathname === "/api/history") {
        response.writeHead(200, { ...headers("application/json; charset=utf-8"), "cache-control": "no-store" });
        response.end(JSON.stringify(await history()));
        return;
      }
      const file = staticFiles[url.pathname];
      if (!file) {
        response.writeHead(404, headers("text/plain; charset=utf-8"));
        response.end("Not found");
        return;
      }
      const data = await readFile(resolve(file));
      response.writeHead(200, { ...headers(MIME[extname(file)] ?? "application/octet-stream"), "cache-control": "no-cache" });
      response.end(data);
    } catch (error) {
      response.writeHead(500, headers("application/json; charset=utf-8"));
      response.end(JSON.stringify({ error: sanitize(error instanceof Error ? error.message : String(error)) }));
    }
  });

  await new Promise<void>((resolveStart, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolveStart());
  });
  console.log(`Robinhood Chain 日度雷达：http://${host}:${port}`);
}
