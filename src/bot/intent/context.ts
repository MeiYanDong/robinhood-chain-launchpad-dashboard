import type { QueryPlan } from "./query-plan.js";

interface ContextEntry {
  expiresAt: number;
  plans: QueryPlan[];
}

export class ConversationContextStore {
  private readonly entries = new Map<string, ContextEntry>();

  constructor(
    private readonly ttlMs = 15 * 60_000,
    private readonly maximumPlans = 3,
    private readonly now: () => number = Date.now,
  ) {}

  add(sessionKey: string, plan: QueryPlan): void {
    this.clearExpired();
    const existing = this.entries.get(sessionKey)?.plans ?? [];
    const plans = [...existing, structuredClone(plan)].slice(-this.maximumPlans);
    this.entries.set(sessionKey, { expiresAt: this.now() + this.ttlMs, plans });
  }

  recent(sessionKey: string): QueryPlan[] {
    this.clearExpired();
    return (this.entries.get(sessionKey)?.plans ?? []).map((plan) => structuredClone(plan));
  }

  latest(sessionKey: string): QueryPlan | null {
    return this.recent(sessionKey).at(-1) ?? null;
  }

  clearExpired(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

export function contextSessionKey(
  channel: "private" | "group",
  ephemeralChatTarget: string,
): string {
  return `${channel}:${ephemeralChatTarget}`;
}
