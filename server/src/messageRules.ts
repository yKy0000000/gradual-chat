export type ReplyTarget = {
  conversationId: string;
};

export type OrderedMessage = {
  position: string;
  senderId: string;
};

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
