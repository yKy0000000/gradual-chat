export type ReplyTarget = {
  conversationId: string;
};

export type OrderedMessage = {
  position: string;
  senderId: string;
};

export const maxMessageLength = 2000;

export function normalizeMessageContent(content: string): string | null {
  const trimmed = content.trim();
  return trimmed.length > 0 && trimmed.length <= maxMessageLength
    ? trimmed
    : null;
}

export function getMentionedUserIds(content: string): string[] {
  const mentions = new Set<string>();
  const pattern = /(^|\s)@User ([AB])(?=$|[\s.,!?;:])/g;
  for (const match of content.matchAll(pattern)) {
    mentions.add(match[2] === "A" ? "demo-user-a" : "demo-user-b");
  }
  return [...mentions];
}

export function isReplyTargetValid(
  replyTarget: unknown,
  conversationId: string,
): replyTarget is ReplyTarget {
  return (
    typeof replyTarget === "object" &&
    replyTarget !== null &&
    "conversationId" in replyTarget &&
    replyTarget.conversationId === conversationId
  );
}

export function countUnreadMessages(
  messages: OrderedMessage[],
  currentUserId: string,
  lastReadPosition: string | null,
): number {
  return messages.filter(
    (message) =>
      message.senderId !== currentUserId &&
      (lastReadPosition === null || message.position > lastReadPosition),
  ).length;
}

export function shouldAdvanceReadCursor(
  currentPosition: string | null,
  requestedPosition: string,
): boolean {
  return currentPosition === null || requestedPosition >= currentPosition;
}
