import { DeBoxTransportError } from "./errors.js";
import type {
  DeBoxInboundEvent,
  DeBoxOutboundMessage,
  DeBoxTransport,
  FakeCursorBatch,
} from "./types.js";

export class FakeDeBoxTransport implements DeBoxTransport {
  readonly sent: DeBoxOutboundMessage[] = [];
  readonly pollCursors: Array<string | null> = [];
  private readonly batches: FakeCursorBatch[] = [];
  private readonly sendFaults: Array<DeBoxTransportError | null> = [];
  private pollFault: DeBoxTransportError | null = null;

  enqueue(updates: DeBoxInboundEvent[]): void {
    const nextCursor = `fake-cursor-${String(this.batches.length + 1)}`;
    this.batches.push({ updates: structuredClone(updates), nextCursor });
  }

  failNextSend(error: DeBoxTransportError): void {
    this.sendFaults.push(error);
  }

  allowNextSend(): void {
    this.sendFaults.push(null);
  }

  failNextPoll(error: DeBoxTransportError): void {
    this.pollFault = error;
  }

  async poll(
    cursor: string | null,
    _timeoutSeconds: number,
    signal: AbortSignal,
  ): Promise<FakeCursorBatch> {
    this.pollCursors.push(cursor);
    if (signal.aborted) throw new DeBoxTransportError("DEBOX_NETWORK_ERROR");
    if (this.pollFault) {
      const error = this.pollFault;
      this.pollFault = null;
      throw error;
    }
    return this.batches.shift() ?? { updates: [], nextCursor: cursor ?? "fake-cursor-0" };
  }

  async send(message: DeBoxOutboundMessage): Promise<void> {
    const fault = this.sendFaults.shift();
    if (fault) throw fault;
    this.sent.push(structuredClone(message));
  }
}
