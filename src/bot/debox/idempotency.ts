export type Reservation = "new" | "processing" | "sent" | "resume_send";

interface DeliveryState {
  status: "processing" | "send_failed" | "sent";
  expiresAt: number;
  segments: string[];
  sentSegments: number;
}

export class InMemoryIdempotencyStore {
  private readonly states = new Map<string, DeliveryState>();

  constructor(
    private readonly ttlMs = 60 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  reserve(updateToken: string): Reservation {
    this.prune();
    const state = this.states.get(updateToken);
    if (!state) {
      this.states.set(updateToken, {
        status: "processing",
        expiresAt: this.now() + this.ttlMs,
        segments: [],
        sentSegments: 0,
      });
      return "new";
    }
    if (state.status === "sent") return "sent";
    if (state.status === "send_failed") return "resume_send";
    return "processing";
  }

  setSegments(updateToken: string, segments: string[]): void {
    const state = this.required(updateToken);
    state.segments = [...segments];
    state.expiresAt = this.now() + this.ttlMs;
  }

  delivery(updateToken: string): { segments: string[]; sentSegments: number } {
    const state = this.required(updateToken);
    return { segments: [...state.segments], sentSegments: state.sentSegments };
  }

  segmentSent(updateToken: string): void {
    const state = this.required(updateToken);
    state.sentSegments += 1;
  }

  sendFailed(updateToken: string): void {
    this.required(updateToken).status = "send_failed";
  }

  completed(updateToken: string): void {
    this.required(updateToken).status = "sent";
  }

  private required(updateToken: string): DeliveryState {
    const state = this.states.get(updateToken);
    if (!state) throw new Error("Idempotency reservation is missing");
    return state;
  }

  private prune(): void {
    const now = this.now();
    for (const [key, state] of this.states) {
      if (state.expiresAt <= now) this.states.delete(key);
    }
  }
}
