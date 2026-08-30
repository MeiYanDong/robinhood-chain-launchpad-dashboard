import { BotError, type BotErrorCode } from "../errors.js";

export type LogStage = "polling" | "debox_send" | "ledger" | "llm" | "formatter" | "pipeline";
export type LogOutcome = "ok" | "degraded" | "failed" | "ignored";

export interface SafeLogEvent {
  at: string;
  stage: LogStage;
  outcome: LogOutcome;
  latencyMs: number;
  code: BotErrorCode | "OK" | "IGNORED";
}

export class StructuredLogger {
  constructor(
    private readonly sink: (line: string) => void = (line) => console.log(line),
    private readonly now: () => Date = () => new Date(),
  ) {}

  log(event: Omit<SafeLogEvent, "at">): void {
    this.sink(
      JSON.stringify({
        at: this.now().toISOString(),
        stage: event.stage,
        outcome: event.outcome,
        latencyMs: event.latencyMs,
        code: event.code,
      }),
    );
  }
}

export function safeErrorCode(error: unknown, fallback: BotErrorCode): BotErrorCode {
  return error instanceof BotError ? error.code : fallback;
}
