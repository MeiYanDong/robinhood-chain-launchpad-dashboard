import type { IntelligenceResponse } from "../intelligence/types.js";
import type { IntelligenceSettings } from "../intelligence/config.js";
import { buildProductWorkbench, type ProductExternalInput } from "./model.js";
import type { ProductWorkbenchResponse } from "./types.js";

export interface ProductIntelligenceProvider {
  ensureFresh(): Promise<unknown>;
}

export interface ProductServiceDependencies {
  intelligence: ProductIntelligenceProvider;
  fetcher?: typeof fetch;
  now?: () => Date;
  warn?: (event: string, context: Record<string, unknown>) => void;
}

async function fetchJson(
  url: string,
  timeoutMs: number,
  fetcher: typeof fetch,
): Promise<ProductExternalInput> {
  try {
    const response = await fetcher(url, {
      method: "GET",
      redirect: "error",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { payload: null, status: "failed" };
    const payload: unknown = await response.json();
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return { payload: null, status: "failed" };
    }
    return { payload, status: "ok" };
  } catch {
    return { payload: null, status: "failed" };
  }
}

export class ProductService {
  private cached: ProductWorkbenchResponse | null = null;
  private refreshedAt: number | null = null;
  private refreshPromise: Promise<ProductWorkbenchResponse> | null = null;
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;
  private readonly warn: (event: string, context: Record<string, unknown>) => void;

  constructor(
    private readonly settings: IntelligenceSettings,
    private readonly dependencies: ProductServiceDependencies,
  ) {
    this.fetcher = dependencies.fetcher ?? fetch;
    this.now = dependencies.now ?? (() => new Date());
    this.warn = dependencies.warn ?? ((event, context) => console.warn(event, context));
  }

  async ensureFresh(): Promise<ProductWorkbenchResponse> {
    const age =
      this.refreshedAt === null
        ? Number.POSITIVE_INFINITY
        : this.now().valueOf() - this.refreshedAt;
    if (this.cached && age < this.settings.refreshTtlMinutes * 60_000) return this.cached;
    return this.refresh();
  }

  refresh(): Promise<ProductWorkbenchResponse> {
    if (this.refreshPromise) return this.refreshPromise;
    const promise = this.refreshNow().finally(() => {
      this.refreshPromise = null;
    });
    this.refreshPromise = promise;
    return promise;
  }

  private async refreshNow(): Promise<ProductWorkbenchResponse> {
    const [chain, cashcat, intelligenceResult] = await Promise.all([
      fetchJson(this.settings.chainRadarUrl, this.settings.requestTimeoutMs, this.fetcher),
      fetchJson(this.settings.cashcatStatusUrl, this.settings.requestTimeoutMs, this.fetcher),
      this.dependencies.intelligence.ensureFresh().catch(() => null),
    ]);
    const now = this.now();
    try {
      const snapshot = buildProductWorkbench({
        now,
        chain,
        cashcat,
        intelligence: intelligenceResult as IntelligenceResponse | null,
      });
      this.cached = snapshot;
      this.refreshedAt = now.valueOf();
      return snapshot;
    } catch (error) {
      this.warn("product_workbench_refresh_failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      if (this.cached) return this.cached;
      throw error;
    }
  }

  snapshot(): ProductWorkbenchResponse | null {
    return this.cached;
  }

  health() {
    return {
      ok: Boolean(this.cached),
      service: "rhc-product-workbench" as const,
      status: this.cached?.status ?? "unavailable",
      generatedAt: this.cached?.generatedAt ?? null,
      refreshTtlMinutes: this.settings.refreshTtlMinutes,
    };
  }
}
