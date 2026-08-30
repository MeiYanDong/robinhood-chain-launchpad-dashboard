import { BotError, type BotErrorCode } from "../errors.js";

export class DeBoxTransportError extends BotError {
  constructor(
    code: Extract<
      BotErrorCode,
      "DEBOX_AUTH_ERROR" | "DEBOX_RATE_LIMITED" | "DEBOX_NETWORK_ERROR" | "DEBOX_SEND_FAILED"
    >,
    readonly retryAfterMs = 0,
  ) {
    super(code, code === "DEBOX_RATE_LIMITED" || code === "DEBOX_NETWORK_ERROR");
  }
}
