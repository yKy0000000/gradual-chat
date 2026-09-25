import { describe, expect, it } from "vitest";

import {
  countUnreadMessages,
  getMentionedUserIds,
  isReplyTargetValid,
  normalizeMessageContent,
  shouldAdvanceReadCursor,
} from "./messageRules.js";

describe("Message input and mentions", () => {
  it("rejects empty and oversized messages while trimming valid text", () => {
    expect(normalizeMessageContent(" \n\t ")).toBeNull();
    expect(normalizeMessageContent(" x ")).toBe("x");
    expect(normalizeMessageContent("x".repeat(2001))).toBeNull();
  });

  it("recognizes complete demo-user mentions without matching email fragments", () => {
    expect(getMentionedUserIds("Hi @User B, and @User A! @User B")).toEqual([
      "demo-user-b",
      "demo-user-a",
    ]);
    expect(getMentionedUserIds("mail@User B or @User C or @User Bob")).toEqual([]);
  });
});

describe("Quote Reply validation", () => {
  it("accepts a reply target from the requested conversation", () => {
    expect(
      isReplyTargetValid(
        { conversationId: "share-your-story" },
        "share-your-story",
      ),
    ).toBe(true);
  });

  it("rejects a reply target that does not exist", () => {
    expect(isReplyTargetValid(null, "share-your-story")).toBe(false);
  });

  it("rejects a reply target from another conversation", () => {
    expect(
      isReplyTargetValid({ conversationId: "general" }, "share-your-story"),
    ).toBe(false);
  });
});

describe("Unread Count rules", () => {
  it("counts only messages after the cursor that other users sent", () => {
    const messages = [
      { position: "003", senderId: "another-user" },
      { position: "004", senderId: "another-user" },
      { position: "005", senderId: "a-third-user" },
      { position: "006", senderId: "current-user" },
    ];

    expect(countUnreadMessages(messages, "current-user", "003")).toBe(2);
  });

  it("does not allow an older mark-read request to move the cursor back", () => {
    expect(shouldAdvanceReadCursor("006", "004")).toBe(false);
    expect(shouldAdvanceReadCursor("006", "007")).toBe(true);
  });
});
