import type { BotConfig } from "./config.js";
import type { DeBoxInboundEvent, DeBoxTransport } from "./debox/types.js";
import { isSupportedInbound } from "./debox/types.js";
import { InMemoryIdempotencyStore } from "./debox/idempotency.js";
import { sendSegments } from "./debox/outbound.js";
import type { DomainResult } from "./domain/service.js";
import type { BotAnswer } from "./domain/types.js";
import { BotError, toBotError } from "./errors.js";
import {
  clarificationAnswer,
  errorAnswer,
  formatDomainResult,
  renderAnswer,
  unsupportedAnswer,
} from "./format/text.js";
import { platformCatalog, type PlatformAliasEntry } from "./intent/aliases.js";
import { parseInput } from "./intent/command-parser.js";
import { contextSessionKey, ConversationContextStore } from "./intent/context.js";
import type { LlmResolver } from "./intent/llm-resolver.js";
import type { QueryAction, QueryPlan } from "./intent/query-plan.js";
import type { BotHealthTracker } from "./health/state.js";
import { StructuredLogger, safeErrorCode } from "./privacy/logging.js";
import { ChatRateLimiter, TrySemaphore } from "./rate/limiter.js";
import { latencyBucket } from "./telemetry/aggregate.js";
import type { TelemetryStore } from "./telemetry/store.js";

export type ProcessOutcome = "sent" | "ignored" | "duplicate" | "rate_limited" | "send_failed";

export interface BotApplicationDependencies {
  config: BotConfig;
  transport: DeBoxTransport;
  domain: { execute(plan: QueryPlan): Promise<DomainResult> };
  resolver?: LlmResolver;
  telemetry?: TelemetryStore;
  health: BotHealthTracker;
  logger?: StructuredLogger;
  context?: ConversationContextStore;
  idempotency?: InMemoryIdempotencyStore;
  rateLimiter?: ChatRateLimiter;
  catalog?: PlatformAliasEntry[];
  now?: () => Date;
  monotonicNow?: () => number;
}

export class BotApplication {
  private readonly logger: StructuredLogger;
  private readonly context: ConversationContextStore;
  private readonly idempotency: InMemoryIdempotencyStore;
  private readonly rateLimiter: ChatRateLimiter;
  private readonly catalog: PlatformAliasEntry[];
  private readonly now: () => Date;
  private readonly monotonicNow: () => number;
  private readonly messageSemaphore: TrySemaphore;
  private readonly ledgerSemaphore: TrySemaphore;
  private readonly sendSemaphore: TrySemaphore;

  constructor(private readonly dependencies: BotApplicationDependencies) {
    this.now = dependencies.now ?? (() => new Date());
    this.monotonicNow = dependencies.monotonicNow ?? Date.now;
    this.logger = dependencies.logger ?? new StructuredLogger();
    this.context =
      dependencies.context ?? new ConversationContextStore(dependencies.config.contextTtlMs);
    this.idempotency = dependencies.idempotency ?? new InMemoryIdempotencyStore();
    this.rateLimiter = dependencies.rateLimiter ?? new ChatRateLimiter();
    this.catalog = dependencies.catalog ?? platformCatalog();
    this.messageSemaphore = new TrySemaphore(
      dependencies.config.messageConcurrency,
      "CHAT_RATE_LIMITED",
    );
    this.ledgerSemaphore = new TrySemaphore(
      dependencies.config.ledgerConcurrency,
      "LEDGER_UNAVAILABLE",
    );
    this.sendSemaphore = new TrySemaphore(
      dependencies.config.sendConcurrency,
      "DEBOX_RATE_LIMITED",
    );
  }

  async processEvent(event: DeBoxInboundEvent): Promise<ProcessOutcome> {
    if (!isSupportedInbound(event)) {
      this.logger.log({ stage: "pipeline", outcome: "ignored", latencyMs: 0, code: "IGNORED" });
      return "ignored";
    }
    try {
      return await this.messageSemaphore.run(() => this.processSupportedEvent(event));
    } catch (error) {
      const botError = toBotError(error, "CHAT_RATE_LIMITED");
      this.logger.log({
        stage: "pipeline",
        outcome: "degraded",
        latencyMs: 0,
        code: botError.code,
      });
      await this.sendRateLimitNotice(event);
      return "rate_limited";
    }
  }

  private async processSupportedEvent(event: DeBoxInboundEvent): Promise<ProcessOutcome> {
    const started = this.monotonicNow();
    const sessionKey = contextSessionKey(event.chatType, event.chatTarget);
    if (!this.rateLimiter.allow(sessionKey)) {
      this.logger.log({
        stage: "pipeline",
        outcome: "degraded",
        latencyMs: 0,
        code: "CHAT_RATE_LIMITED",
      });
      await this.sendRateLimitNotice(event);
      return "rate_limited";
    }

    const reservation = this.idempotency.reserve(event.updateToken);
    if (reservation === "sent" || reservation === "processing") return "duplicate";
    if (reservation === "resume_send") return this.resumeSend(event);

    let answer: BotAnswer;
    let action: QueryAction | "unsupported" = "unsupported";
    let usedLlm = false;
    try {
      const parsed = parseInput(event.text as string, {
        confirmedCurrentBotMention: event.explicitlyMentionsCurrentBot,
        ...(event.currentBotMentionText
          ? { currentBotMentionText: event.currentBotMentionText }
          : {}),
        catalog: this.catalog,
      });
      if (parsed.kind === "clarification") {
        answer = clarificationAnswer(parsed.question);
      } else if (parsed.kind === "unsupported") {
        answer = unsupportedAnswer();
      } else {
        let plan: QueryPlan;
        if (parsed.kind === "needs_llm") {
          usedLlm = true;
          if (!this.dependencies.resolver) {
            answer = clarificationAnswer("请改用 /rank、/platform、/why 或 /status 明确查询。");
            return await this.finish(event, answer, action, usedLlm, started);
          }
          try {
            plan = await this.dependencies.resolver.resolve(
              parsed.cleanedText,
              this.context.latest(sessionKey),
            );
          } catch (error) {
            this.logger.log({
              stage: "llm",
              outcome: "degraded",
              latencyMs: Math.max(0, this.monotonicNow() - started),
              code: safeErrorCode(error, "LLM_INVALID_OUTPUT"),
            });
            answer = clarificationAnswer("自然语言解析暂不可用，请改用明确命令。");
            return await this.finish(event, answer, action, usedLlm, started);
          }
        } else {
          plan = this.applyContext(
            parsed.plan,
            parsed.cleanedText,
            this.context.latest(sessionKey),
          );
        }
        action = plan.action;
        if (plan.needsClarification) {
          answer = clarificationAnswer(plan.clarificationReason ?? "请补充查询条件。");
        } else {
          const domainResult = await this.ledgerSemaphore.run(() =>
            this.dependencies.domain.execute(plan),
          );
          try {
            answer = formatDomainResult(domainResult, {
              detailBaseUrl: this.dependencies.config.detailBaseUrl,
            });
          } catch (error) {
            this.logger.log({
              stage: "formatter",
              outcome: "failed",
              latencyMs: Math.max(0, this.monotonicNow() - started),
              code: safeErrorCode(error, "USER_INPUT_INVALID"),
            });
            throw new BotError("USER_INPUT_INVALID");
          }
          this.context.add(sessionKey, plan);
          this.dependencies.health.update(
            domainResult.kind === "status"
              ? {
                  ledgerReachable: domainResult.result.ledgerReachable,
                  apiContractCompatible: domainResult.result.contractCompatible,
                }
              : {
                  ledgerReachable: true,
                  apiContractCompatible: true,
                },
          );
        }
      }
    } catch (error) {
      const botError = toBotError(error, "USER_INPUT_INVALID");
      const ledgerFailure =
        botError.code.startsWith("LEDGER_") ||
        botError.code === "CONTRACT_INCOMPATIBLE" ||
        botError.code === "VERSION_NOT_AVAILABLE";
      this.logger.log({
        stage: ledgerFailure ? "ledger" : "pipeline",
        outcome: "degraded",
        latencyMs: Math.max(0, this.monotonicNow() - started),
        code: botError.code,
      });
      answer = errorAnswer(botError.userMessage);
      if (botError.code === "CONTRACT_INCOMPATIBLE" || botError.code === "VERSION_NOT_AVAILABLE") {
        this.dependencies.health.update({ apiContractCompatible: false });
      }
      if (botError.code.startsWith("LEDGER_")) {
        this.dependencies.health.update({ ledgerReachable: false });
      }
    }
    return this.finish(event, answer, action, usedLlm, started);
  }

  private async finish(
    event: DeBoxInboundEvent,
    answer: BotAnswer,
    action: QueryAction | "unsupported",
    usedLlm: boolean,
    started: number,
  ): Promise<ProcessOutcome> {
    const segments = renderAnswer(answer);
    this.idempotency.setSegments(event.updateToken, segments);
    try {
      await this.sendSemaphore.run(() =>
        sendSegments(this.dependencies.transport, event, this.idempotency),
      );
      this.dependencies.health.markReplySuccess();
      const latencyMs = Math.max(0, this.monotonicNow() - started);
      this.dependencies.telemetry?.increment({
        date: this.now().toISOString().slice(0, 10),
        action,
        channel: event.chatType,
        outcome: answer.status,
        latencyBucket: latencyBucket(latencyMs),
        usedLlm,
        stale: answer.evidence?.stale ?? false,
        qualityCount: answer.warnings.length,
        sourceFailed: answer.warnings.some((item) => item.code === "SOURCE_FAILED") ? 1 : 0,
        sourceCount: 0,
      });
      this.logger.log({ stage: "pipeline", outcome: "ok", latencyMs, code: "OK" });
      return "sent";
    } catch (error) {
      const code = safeErrorCode(error, "DEBOX_SEND_FAILED");
      const latencyMs = Math.max(0, this.monotonicNow() - started);
      if (code === "DEBOX_AUTH_ERROR") {
        this.dependencies.health.update({ pollingStatus: "auth_failed" });
      }
      this.dependencies.telemetry?.increment({
        date: this.now().toISOString().slice(0, 10),
        action,
        channel: event.chatType,
        outcome: "failed",
        latencyBucket: latencyBucket(latencyMs),
        usedLlm,
        stale: answer.evidence?.stale ?? false,
        qualityCount: answer.warnings.length,
        sourceFailed: answer.warnings.some((item) => item.code === "SOURCE_FAILED") ? 1 : 0,
        sourceCount: 0,
      });
      this.logger.log({
        stage: "debox_send",
        outcome: "failed",
        latencyMs,
        code,
      });
      return "send_failed";
    }
  }

  private async resumeSend(event: DeBoxInboundEvent): Promise<ProcessOutcome> {
    try {
      await this.sendSemaphore.run(() =>
        sendSegments(this.dependencies.transport, event, this.idempotency),
      );
      this.dependencies.health.markReplySuccess();
      return "sent";
    } catch {
      return "send_failed";
    }
  }

  private async sendRateLimitNotice(event: DeBoxInboundEvent): Promise<void> {
    const reservation = this.idempotency.reserve(event.updateToken);
    if (reservation === "sent" || reservation === "processing") return;
    if (reservation === "new") {
      this.idempotency.setSegments(
        event.updateToken,
        renderAnswer(errorAnswer(toBotError(new Error(), "CHAT_RATE_LIMITED").userMessage)),
      );
    }
    try {
      await this.sendSemaphore.run(() =>
        sendSegments(this.dependencies.transport, event, this.idempotency),
      );
    } catch {
      // The original request is already being degraded; a saturated or failed outbound path
      // must not create a second unbounded retry queue.
    }
  }

  private applyContext(plan: QueryPlan, text: string, previous: QueryPlan | null): QueryPlan {
    if (
      previous &&
      plan.action === "platform" &&
      /呢[？?]?$/.test(text) &&
      previous.windowDays !== null
    ) {
      return { ...plan, windowDays: previous.windowDays };
    }
    return plan;
  }
}
