export interface ChainDailySettings {
  url: string;
  requestTimeoutMs: number;
  refreshTtlMinutes: number;
}

export interface ChainDailyServiceDependencies {
  fetcher?: typeof fetch;
  now?: () => Date;
}

function isSnapshot(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;
  return (
    typeof snapshot.targetDate === "string" &&
    typeof snapshot.generatedAt === "string" &&
    Array.isArray(snapshot.metrics)
  );
}

export class ChainDailyService {
  private cached: Record<string, unknown> | null = null;
  private refreshedAt: number | null = null;
  private refreshPromise: Promise<Record<string, unknown>> | null = null;
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;

  constructor(
    private readonly settings: ChainDailySettings,
    dependencies: ChainDailyServiceDependencies = {},
  ) {
    this.fetcher = dependencies.fetcher ?? fetch;
    this.now = dependencies.now ?? (() => new Date());
  }

  async latest(): Promise<Record<string, unknown>> {
    const age =
      this.refreshedAt === null
        ? Number.POSITIVE_INFINITY
        : this.now().valueOf() - this.refreshedAt;
    if (this.cached && age < this.settings.refreshTtlMinutes * 60_000) return this.cached;
    return this.refresh();
  }

  refresh(): Promise<Record<string, unknown>> {
    if (this.refreshPromise) return this.refreshPromise;
    const operation = this.fetchLatest().finally(() => {
      this.refreshPromise = null;
    });
    this.refreshPromise = operation;
    return operation;
  }

  private async fetchLatest(): Promise<Record<string, unknown>> {
    try {
      const response = await this.fetcher(this.settings.url, {
        method: "GET",
        redirect: "error",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(this.settings.requestTimeoutMs),
      });
      if (!response.ok) throw new Error("Chain daily source returned a non-success status");
      const payload: unknown = await response.json();
      if (!isSnapshot(payload)) throw new Error("Chain daily source returned an invalid snapshot");
      this.cached = payload;
      this.refreshedAt = this.now().valueOf();
      return payload;
    } catch (error) {
      if (this.cached) return this.cached;
      throw error;
    }
  }
}
