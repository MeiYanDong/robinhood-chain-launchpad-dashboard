export type ChatType = "private" | "group";
export type InboundMessageType = "text" | "image" | "video" | "card" | "market_card" | "attachment";

export interface DeBoxInboundEvent {
  updateToken: string;
  chatTarget: string;
  chatType: ChatType;
  messageType: InboundMessageType;
  text: string | null;
  explicitlyMentionsCurrentBot: boolean;
  currentBotMentionText?: string;
}

export interface DeBoxOutboundMessage {
  chatTarget: string;
  text: string;
  parseMode: "text";
  deliveryKey: string;
  segmentIndex: number;
}

export interface FakeCursorBatch {
  updates: DeBoxInboundEvent[];
  nextCursor: string;
}

export interface DeBoxTransport {
  poll(
    cursor: string | null,
    timeoutSeconds: number,
    signal: AbortSignal,
  ): Promise<FakeCursorBatch>;
  send(message: DeBoxOutboundMessage): Promise<void>;
}

export function isSupportedInbound(event: DeBoxInboundEvent): boolean {
  if (event.messageType !== "text" || event.text === null) return false;
  if (event.chatType === "private") return true;
  return event.explicitlyMentionsCurrentBot;
}
