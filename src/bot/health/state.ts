import { APP_VERSION } from "../../config/app.js";

export type PollingStatus = "stopped" | "polling" | "backoff" | "auth_failed";

export interface BotHealthSnapshot {
  ok: boolean;
  live: true;
  ready: boolean;
  identityVerified: boolean;
  pollingStatus: PollingStatus;
  ledgerReachable: boolean;
  apiContractCompatible: boolean;
  lastSuccessfulPoll: string | null;
  lastSuccessfulReply: string | null;
  llmEnabled: boolean;
  llmBudgetFuseOpen: boolean;
  startedAt: string;
  appVersion: string;
}

export class BotHealthTracker {
  private configValid = false;
  private identityVerified = false;
  private pollingStatus: PollingStatus = "stopped";
  private ledgerReachable = false;
  private apiContractCompatible = false;
  private lastSuccessfulPoll: string | null = null;
  private lastSuccessfulReply: string | null = null;
  private llmEnabled = false;
  private llmBudgetFuseOpen = false;
  private readonly startedAt: string;

  constructor(private readonly now: () => Date = () => new Date()) {
    this.startedAt = now().toISOString();
  }

  update(
    patch: Partial<{
      configValid: boolean;
      identityVerified: boolean;
      pollingStatus: PollingStatus;
      ledgerReachable: boolean;
      apiContractCompatible: boolean;
      lastSuccessfulPoll: string | null;
      lastSuccessfulReply: string | null;
      llmEnabled: boolean;
      llmBudgetFuseOpen: boolean;
    }>,
  ): void {
    if (patch.configValid !== undefined) this.configValid = patch.configValid;
    if (patch.identityVerified !== undefined) this.identityVerified = patch.identityVerified;
    if (patch.pollingStatus !== undefined) this.pollingStatus = patch.pollingStatus;
    if (patch.ledgerReachable !== undefined) this.ledgerReachable = patch.ledgerReachable;
    if (patch.apiContractCompatible !== undefined)
      this.apiContractCompatible = patch.apiContractCompatible;
    if (patch.lastSuccessfulPoll !== undefined) this.lastSuccessfulPoll = patch.lastSuccessfulPoll;
    if (patch.lastSuccessfulReply !== undefined)
      this.lastSuccessfulReply = patch.lastSuccessfulReply;
    if (patch.llmEnabled !== undefined) this.llmEnabled = patch.llmEnabled;
    if (patch.llmBudgetFuseOpen !== undefined) this.llmBudgetFuseOpen = patch.llmBudgetFuseOpen;
  }

  markPollSuccess(): void {
    this.lastSuccessfulPoll = this.now().toISOString();
  }

  markReplySuccess(): void {
    this.lastSuccessfulReply = this.now().toISOString();
  }

  snapshot(): BotHealthSnapshot {
    const ready =
      this.configValid &&
      this.identityVerified &&
      (this.pollingStatus === "polling" || this.pollingStatus === "backoff") &&
      this.ledgerReachable &&
      this.apiContractCompatible;
    return {
      ok: ready,
      live: true,
      ready,
      identityVerified: this.identityVerified,
      pollingStatus: this.pollingStatus,
      ledgerReachable: this.ledgerReachable,
      apiContractCompatible: this.apiContractCompatible,
      lastSuccessfulPoll: this.lastSuccessfulPoll,
      lastSuccessfulReply: this.lastSuccessfulReply,
      llmEnabled: this.llmEnabled,
      llmBudgetFuseOpen: this.llmBudgetFuseOpen,
      startedAt: this.startedAt,
      appVersion: APP_VERSION,
    };
  }
}
