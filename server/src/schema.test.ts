import { createYoga } from "graphql-yoga";
import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseState = vi.hoisted(() => {
  let saved: Record<string, unknown> | null = null;
  let hidden: Record<string, unknown>[] = [];
  return {
    reset: () => { saved = null; hidden = []; },
    getSaved: () => saved,
    collection: (name: string) => ({
      findOne: async ({ id, conversationId }: { id?: string | { $nin: string[] }; conversationId?: string }) =>
        name === "messages" && (saved?.id === id || (saved?.conversationId === conversationId && !(typeof id === "object" && id.$nin.includes(String(saved.id))))) ? saved : null,
      find: (filter: { userId?: string; conversationId?: string; id?: { $nin?: string[]; $in?: string[] } }) => {
        const result = name === "hiddenMessages"
          ? hidden.filter((item) => item.userId === filter.userId && item.conversationId === filter.conversationId)
          : saved && saved.conversationId === filter.conversationId && !filter.id?.$nin?.includes(String(saved.id))
            ? [saved] : [];
        const cursor = {
          sort: () => cursor,
          limit: () => cursor,
          toArray: async () => result,
        };
        return cursor;
      },
      countDocuments: async () => 0,
      updateOne: async (_filter: unknown, update: { $setOnInsert: Record<string, unknown> }) => {
        if (name === "hiddenMessages") {
          if (!hidden.some((item) => item.userId === update.$setOnInsert.userId && item.messageId === update.$setOnInsert.messageId)) hidden.push(update.$setOnInsert);
          return { upsertedCount: 1 };
        }
        if (saved) return { upsertedCount: 0 };
        saved = { ...update.$setOnInsert };
        return { upsertedCount: 1 };
      },
    }),
  };
});

vi.mock("./database.js", () => ({
  getDatabase: () => ({ collection: databaseState.collection }),
}));

import { schema } from "./schema.js";

const mutation = `
  mutation Send($id: ID!, $content: String!) {
    sendMessage(
      id: $id,
      conversationId: "share-your-story",
      senderId: "demo-user-a",
      content: $content
    ) {
      id content createdAt mentionedUserIds status
    }
  }
`;

beforeEach(() => databaseState.reset());

describe("sendMessage persistence", () => {
  it("persists a mention and broadcasts once for an idempotent retry", async () => {
    const emit = vi.fn();
    const yoga = createYoga({ schema, context: () => ({ io: { emit } }) });
    const first = await execute(yoga, "same-id", " Hi @User B! ");
    const retry = await execute(yoga, "same-id", " Hi @User B! ");

    expect(first.errors).toBeUndefined();
    expect(retry.errors).toBeUndefined();
    expect(first.data?.sendMessage).toEqual(retry.data?.sendMessage);
    expect(first.data?.sendMessage).toMatchObject({
      content: "Hi @User B!",
      mentionedUserIds: ["demo-user-b"],
      status: "sent",
    });
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("rejects blank input and ID reuse with different content", async () => {
    const emit = vi.fn();
    const yoga = createYoga({ schema, context: () => ({ io: { emit } }) });
    const blank = await execute(yoga, "x", "  ");
    expect(blank.errors).toHaveLength(1);
    expect(emit).not.toHaveBeenCalled();

    await execute(yoga, "x", "first");
    const conflict = await execute(yoga, "x", "second");
    expect(conflict.errors).toHaveLength(1);
    expect(emit).toHaveBeenCalledTimes(1);
  });
});

describe("conversation list summary", () => {
  it("returns the persisted latest message beside the read state", async () => {
    const yoga = createYoga({ schema, context: () => ({ io: { emit: vi.fn() } }) });
    await execute(yoga, "preview-id", "Real latest preview");
    const response = await yoga.fetch("http://localhost/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: `{
        conversationReadState(userId: "demo-user-b", conversationId: "share-your-story") {
          latestMessageId
          latestMessage { id senderId content createdAt }
        }
      }` }),
    });
    const result = await response.json() as { data?: { conversationReadState: { latestMessageId: string; latestMessage: Record<string, string> } }; errors?: unknown[] };
    expect(result.errors).toBeUndefined();
    expect(result.data?.conversationReadState.latestMessageId).toBe("preview-id");
    expect(result.data?.conversationReadState.latestMessage).toMatchObject({
      id: "preview-id",
      senderId: "demo-user-a",
      content: "Real latest preview",
    });
    expect(result.data?.conversationReadState.latestMessage.createdAt).toBeTruthy();
  });
});

describe("Hide for me", () => {
  it("keeps the original message while filtering only the current user's history and preview", async () => {
    const yoga = createYoga({ schema, context: () => ({ io: { emit: vi.fn() } }) });
    await execute(yoga, "hide-id", "Keep in MongoDB");
    const hide = await query(yoga, `mutation {
      hideMessageForMe(userId: "demo-user-a", conversationId: "share-your-story", messageId: "hide-id") {
        hiddenMessageIds latestMessage { id }
      }
    }`);
    expect(hide.errors).toBeUndefined();
    expect(hide.data?.hideMessageForMe).toMatchObject({ hiddenMessageIds: ["hide-id"], latestMessage: null });
    expect(databaseState.getSaved()).toMatchObject({ id: "hide-id", content: "Keep in MongoDB" });

    const own = await query(yoga, `{ messages(conversationId: "share-your-story", userId: "demo-user-a") { id } }`);
    const other = await query(yoga, `{ messages(conversationId: "share-your-story", userId: "demo-user-b") { id content } }`);
    expect(own.data?.messages).toEqual([]);
    expect(other.data?.messages).toEqual([{ id: "hide-id", content: "Keep in MongoDB" }]);
  });

  it("rejects hiding the other user's message", async () => {
    const yoga = createYoga({ schema, context: () => ({ io: { emit: vi.fn() } }) });
    await execute(yoga, "hide-id", "User A wrote this");
    const result = await query(yoga, `mutation {
      hideMessageForMe(userId: "demo-user-b", conversationId: "share-your-story", messageId: "hide-id") {
        hiddenMessageIds
      }
    }`);
    expect(result.errors).toHaveLength(1);
    expect(databaseState.getSaved()).toMatchObject({ id: "hide-id" });
  });
});

async function query(yoga: ReturnType<typeof createYoga>, document: string) {
  const response = await yoga.fetch("http://localhost/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: document }),
  });
  return response.json() as Promise<{ data?: Record<string, unknown>; errors?: unknown[] }>;
}

async function execute(yoga: ReturnType<typeof createYoga>, id: string, content: string) {
  const response = await yoga.fetch("http://localhost/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: mutation, variables: { id, content } }),
  });
  return response.json() as Promise<{
    data?: { sendMessage: Record<string, unknown> };
    errors?: Array<{ message: string }>;
  }>;
}
