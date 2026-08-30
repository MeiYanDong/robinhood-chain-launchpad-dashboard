export type RuntimeVerificationCode =
  | "INVALID_BASE_URL"
  | "RUNTIME_UNREACHABLE"
  | "RUNTIME_HTTP_ERROR"
  | "RUNTIME_INVALID_JSON"
  | "RUNTIME_CONTRACT_ERROR"
  | "RUNTIME_NOT_READY";

export class RuntimeVerificationError extends Error {
  constructor(
    readonly code: RuntimeVerificationCode,
    message: string,
  ) {
    super(message);
    this.name = "RuntimeVerificationError";
  }
}

export interface RuntimeEndpointCheck {
  path: string;
  status: number;
  targetDate: string | null;
  itemCount: number | null;
}

export interface RuntimeVerificationResult {
  ok: true;
  checkedAt: string;
  checks: RuntimeEndpointCheck[];
}

export interface RuntimeVerifierOptions {
  fetcher?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeBaseUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new RuntimeVerificationError("INVALID_BASE_URL", "Base URL must be a valid URL");
  }
  if (!new Set(["http:", "https:"]).has(parsed.protocol) || parsed.username || parsed.password) {
    throw new RuntimeVerificationError(
      "INVALID_BASE_URL",
      "Base URL must use HTTP(S) without embedded credentials",
    );
  }
  return new URL("/", parsed);
}

async function readJson(
  baseUrl: URL,
  path: string,
  fetcher: typeof fetch,
  timeoutMs: number,
): Promise<{ status: number; payload: Record<string, unknown> }> {
  let response: Response;
  try {
    response = await fetcher(new URL(path, baseUrl), {
      method: "GET",
      redirect: "error",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new RuntimeVerificationError(
      "RUNTIME_UNREACHABLE",
      "Runtime endpoint could not be reached",
    );
  }
  if (!response.ok) {
    throw new RuntimeVerificationError(
      "RUNTIME_HTTP_ERROR",
      "Runtime endpoint returned a non-success status",
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new RuntimeVerificationError("RUNTIME_INVALID_JSON", "Runtime response was not JSON");
  }
  if (!isRecord(payload)) {
    throw new RuntimeVerificationError(
      "RUNTIME_CONTRACT_ERROR",
      "Runtime response did not match the expected object shape",
    );
  }
  return { status: response.status, payload };
}

function targetDate(payload: Record<string, unknown>): string | null {
  return typeof payload.targetDate === "string" ? payload.targetDate : null;
}

export async function verifyRuntime(
  baseUrl: string,
  options: RuntimeVerifierOptions = {},
): Promise<RuntimeVerificationResult> {
  const base = safeBaseUrl(baseUrl);
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const now = options.now ?? (() => new Date());
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new RuntimeVerificationError(
      "INVALID_BASE_URL",
      "Runtime timeout must be between 1 and 30000 milliseconds",
    );
  }

  const health = await readJson(base, "/healthz", fetcher, timeoutMs);
  if (health.payload.ok !== true || typeof health.payload.service !== "string") {
    throw new RuntimeVerificationError("RUNTIME_NOT_READY", "Runtime has no usable cache");
  }

  const overview = await readJson(base, "/api/overview?window=30", fetcher, timeoutMs);
  if (
    typeof overview.payload.targetDate !== "string" ||
    !Array.isArray(overview.payload.platforms)
  ) {
    throw new RuntimeVerificationError(
      "RUNTIME_CONTRACT_ERROR",
      "Overview response did not match the expected contract",
    );
  }

  const sources = await readJson(base, "/api/sources", fetcher, timeoutMs);
  if (!Array.isArray(sources.payload.sources)) {
    throw new RuntimeVerificationError(
      "RUNTIME_CONTRACT_ERROR",
      "Sources response did not match the expected contract",
    );
  }

  return {
    ok: true,
    checkedAt: now().toISOString(),
    checks: [
      {
        path: "/healthz",
        status: health.status,
        targetDate: targetDate(health.payload),
        itemCount: null,
      },
      {
        path: "/api/overview?window=30",
        status: overview.status,
        targetDate: targetDate(overview.payload),
        itemCount: overview.payload.platforms.length,
      },
      {
        path: "/api/sources",
        status: sources.status,
        targetDate: null,
        itemCount: sources.payload.sources.length,
      },
    ],
  };
}
