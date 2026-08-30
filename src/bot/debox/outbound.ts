import { BotError } from "../errors.js";
import type { InMemoryIdempotencyStore } from "./idempotency.js";
import { DeBoxTransportError } from "./errors.js";
import type { DeBoxInboundEvent, DeBoxTransport } from "./types.js";

export interface OutboundOptions {
  maximumAttempts?: number;
  maximumRetryDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export async function sendSegments(
  transport: DeBoxTransport,
  event: DeBoxInboundEvent,
  idempotency: InMemoryIdempotencyStore,
  options: OutboundOptions = {},
): Promise<void> {
  const maximumAttempts = options.maximumAttempts ?? 2;
  const maximumRetryDelayMs = options.maximumRetryDelayMs ?? 5_000;
  const sleep =
    options.sleep ??
    ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const delivery = idempotency.delivery(event.updateToken);

  for (let index = delivery.sentSegments; index < delivery.segments.length; index += 1) {
    let sent = false;
    for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
      try {
        await transport.send({
          chatTarget: event.chatTarget,
          text: delivery.segments[index] as string,
          parseMode: "text",
          deliveryKey: event.updateToken,
          segmentIndex: index,
        });
        sent = true;
        idempotency.segmentSent(event.updateToken);
        break;
      } catch (error) {
        if (error instanceof DeBoxTransportError && error.code === "DEBOX_AUTH_ERROR") {
          idempotency.sendFailed(event.updateToken);
          throw error;
        }
        const retryable = error instanceof BotError && error.retryable;
        if (!retryable || attempt + 1 >= maximumAttempts) {
          idempotency.sendFailed(event.updateToken);
          throw error instanceof BotError ? error : new BotError("DEBOX_SEND_FAILED");
        }
        const delay =
          error instanceof DeBoxTransportError && error.retryAfterMs > 0
            ? Math.min(error.retryAfterMs, maximumRetryDelayMs)
            : Math.min(100 * 2 ** attempt, maximumRetryDelayMs);
        await sleep(delay);
      }
    }
    if (!sent) {
      idempotency.sendFailed(event.updateToken);
      throw new BotError("DEBOX_SEND_FAILED");
    }
  }
  idempotency.completed(event.updateToken);
}
