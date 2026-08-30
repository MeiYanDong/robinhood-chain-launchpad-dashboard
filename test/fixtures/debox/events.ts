import type {
  ChatType,
  DeBoxInboundEvent,
  InboundMessageType,
} from "../../../src/bot/debox/types.js";

export function fakeEvent(
  updateToken: string,
  text: string | null,
  overrides: Partial<{
    chatTarget: string;
    chatType: ChatType;
    messageType: InboundMessageType;
    explicitlyMentionsCurrentBot: boolean;
    currentBotMentionText: string;
  }> = {},
): DeBoxInboundEvent {
  return {
    updateToken,
    chatTarget: overrides.chatTarget ?? "fixture-chat",
    chatType: overrides.chatType ?? "private",
    messageType: overrides.messageType ?? "text",
    text,
    explicitlyMentionsCurrentBot: overrides.explicitlyMentionsCurrentBot ?? false,
    ...(overrides.currentBotMentionText
      ? { currentBotMentionText: overrides.currentBotMentionText }
      : {}),
  };
}
