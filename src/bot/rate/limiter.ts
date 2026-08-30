import { BotError, type BotErrorCode } from "../errors.js";

interface ChatBucket {
  tokens: number;
  refilledAt: number;
}

export class ChatRateLimiter {
  private readonly buckets = new Map<string, ChatBucket>();

  constructor(
    private readonly capacity = 5,
    private readonly refillEveryMs = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  allow(ephemeralChatKey: string): boolean {
    const now = this.now();
    const bucket = this.buckets.get(ephemeralChatKey) ?? { tokens: this.capacity, refilledAt: now };
    const replenished = Math.floor((now - bucket.refilledAt) / this.refillEveryMs);
    if (replenished > 0) {
      bucket.tokens = Math.min(this.capacity, bucket.tokens + replenished);
      bucket.refilledAt += replenished * this.refillEveryMs;
    }
    if (bucket.tokens < 1) {
      this.buckets.set(ephemeralChatKey, bucket);
      return false;
    }
    bucket.tokens -= 1;
    this.buckets.set(ephemeralChatKey, bucket);
    return true;
  }
}

export class TrySemaphore {
  private active = 0;

  constructor(
    readonly limit: number,
    private readonly rejectionCode: BotErrorCode,
  ) {
    if (!Number.isInteger(limit) || limit < 1) throw new BotError("CONFIG_INVALID");
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) throw new BotError(this.rejectionCode);
    this.active += 1;
    try {
      return await operation();
    } finally {
      this.active -= 1;
    }
  }

  activeCount(): number {
    return this.active;
  }
}
