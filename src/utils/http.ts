import { createHash } from "node:crypto";

export interface FetchedJson {
  payload: unknown;
  fetchedAt: string;
  latencyMs: number;
  sha256: string;
}

export async function fetchJson(
  url: string,
  options: { timeoutMs?: number; retries?: number } = {},
): Promise<FetchedJson> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const retries = options.retries ?? 1;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const started = performance.now();

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "user-agent": "rhc-launch-ledger/0.2 (+read-only research dashboard)",
        },
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      const body = await response.text();
      const payload: unknown = JSON.parse(body);
      return {
        payload,
        fetchedAt: new Date().toISOString(),
        latencyMs: Math.round(performance.now() - started),
        sha256: createHash("sha256").update(body).digest("hex"),
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`Failed to fetch ${url}: ${lastError?.message ?? "unknown error"}`);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
