import { createServer, type RequestListener, type Server } from "node:http";
import type { BotHealthTracker } from "./state.js";

function send(response: Parameters<RequestListener>[1], status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

export function createBotHealthHandler(tracker: BotHealthTracker): RequestListener {
  return (request, response) => {
    if (request.method !== "GET") {
      send(response, 404, { error: "Not found", code: "NOT_FOUND" });
      return;
    }
    const snapshot = tracker.snapshot();
    if (request.url === "/livez") {
      send(response, 200, {
        live: true,
        startedAt: snapshot.startedAt,
        appVersion: snapshot.appVersion,
      });
      return;
    }
    if (request.url === "/readyz") {
      send(response, snapshot.ready ? 200 : 503, snapshot);
      return;
    }
    if (request.url === "/healthz") {
      send(response, snapshot.ok ? 200 : 503, snapshot);
      return;
    }
    send(response, 404, { error: "Not found", code: "NOT_FOUND" });
  };
}

export function startBotHealthServer(
  tracker: BotHealthTracker,
  port: number,
  host: "127.0.0.1" = "127.0.0.1",
): Server {
  const server = createServer(createBotHealthHandler(tracker));
  server.listen(port, host);
  return server;
}
