import { BotError, type BotErrorCode } from "../errors.js";
import { DeBoxTransportError } from "./errors.js";
import type { DeBoxInboundEvent, DeBoxTransport } from "./types.js";

export interface BackoffOptions {
  baseMs?: number;
  maximumMs?: number;
  random?: () => number;
}

export class BoundedBackoff {
  private failures = 0;
  private readonly baseMs: number;
  private readonly maximumMs: number;
  private readonly random: () => number;

  constructor(options: BackoffOptions = {}) {
    this.baseMs = options.baseMs ?? 250;
    this.maximumMs = options.maximumMs ?? 30_000;
    this.random = options.random ?? Math.random;
  }

  next(): number {
    const ceiling = Math.min(this.maximumMs, this.baseMs * 2 ** this.failures);
    this.failures += 1;
    return Math.round(ceiling * (0.5 + this.random() * 0.5));
  }

  reset(): void {
    this.failures = 0;
  }
}

export interface PollerOptions {
  timeoutSeconds?: number;
  backoff?: BoundedBackoff;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  onState?: (state: "polling" | "backoff" | "stopped" | "auth_failed") => void;
  onError?: (code: BotErrorCode) => void;
}

export class LongPollingController {
  private cursor: string | null = null;
  private controller: AbortController | null = null;
  private loopPromise: Promise<void> | null = null;
  private readonly timeoutSeconds: number;
  private readonly backoff: BoundedBackoff;
  private readonly sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;

  constructor(
    private readonly transport: DeBoxTransport,
    private readonly processEvent: (event: DeBoxInboundEvent) => Promise<void>,
    private readonly options: PollerOptions = {},
  ) {
    this.timeoutSeconds = options.timeoutSeconds ?? 30;
    this.backoff = options.backoff ?? new BoundedBackoff();
    this.sleep =
      options.sleep ??
      ((milliseconds, signal) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, milliseconds);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(new BotError("DEBOX_NETWORK_ERROR"));
            },
            { once: true },
          );
        }));
  }

  async runOnce(signal = new AbortController().signal): Promise<number> {
    const batch = await this.transport.poll(this.cursor, this.timeoutSeconds, signal);
    for (const event of batch.updates) await this.processEvent(event);
    this.cursor = batch.nextCursor;
    this.backoff.reset();
    return batch.updates.length;
  }

  start(): void {
    if (this.loopPromise) return;
    this.controller = new AbortController();
    this.loopPromise = this.loop(this.controller.signal).finally(() => {
      this.loopPromise = null;
      this.options.onState?.("stopped");
    });
  }

  async stop(timeoutMs = 5_000): Promise<void> {
    this.controller?.abort();
    if (!this.loopPromise) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        this.loopPromise.catch(() => undefined),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  currentCursor(): string | null {
    return this.cursor;
  }

  private async loop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        this.options.onState?.("polling");
        await this.runOnce(signal);
      } catch (error) {
        if (signal.aborted) return;
        this.options.onError?.(error instanceof BotError ? error.code : "DEBOX_NETWORK_ERROR");
        if (error instanceof DeBoxTransportError && error.code === "DEBOX_AUTH_ERROR") {
          this.options.onState?.("auth_failed");
          return;
        }
        this.options.onState?.("backoff");
        await this.sleep(this.backoff.next(), signal);
      }
    }
  }
}

// The cursor above is an explicit replaceable fake protocol. It does not claim to implement
// DeBox's official offset/ack semantics; those remain gated on reading a locked SDK in Phase 2.
