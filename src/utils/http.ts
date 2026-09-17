import { createHash } from "node:crypto";
import { withSession, type CreateSessionOptions, type Session } from "wreq-js";

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

const BROWSER_PROFILES = [
  { browser: "chrome_149", os: "windows" },
  { browser: "firefox_151", os: "linux" },
  { browser: "safari_18", os: "macos" },
] as const satisfies readonly Pick<CreateSessionOptions, "browser" | "os">[];

/**
 * Read-only JSON transport for public endpoints protected by TLS fingerprint checks.
 * It never solves interactive challenges and never carries authentication material.
 */
export async function fetchJsonBrowser(
  url: string,
  options: { timeoutMs?: number; retries?: number } = {},
): Promise<FetchedJson> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const retries = options.retries ?? 1;
  const failures: string[] = [];
  for (const profile of BROWSER_PROFILES) {
    try {
      return await withSession(
        async (session: Session) => {
          let lastError: Error | null = null;
          for (let attempt = 0; attempt <= retries; attempt += 1) {
            const started = performance.now();
            try {
              const response = await session.fetch(url, {
                timeout: timeoutMs,
                headers: {
                  accept: "application/json",
                },
              });
              const body = await response.text();
              if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
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
                await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
              }
            }
          }
          throw lastError ?? new Error("browser JSON request failed");
        },
        { ...profile, timeout: timeoutMs },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Public explorer limits are IP-wide. Switching TLS fingerprints cannot
      // fix a real 429 and only spends more of the shared quota.
      if (/^429\b/.test(message)) throw new Error("Public JSON endpoint rate limited");
      failures.push(`${profile.browser}/${profile.os}:${message}`);
    }
  }
  throw new Error(`Browser JSON profiles exhausted (${failures.join(" | ")})`);
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
