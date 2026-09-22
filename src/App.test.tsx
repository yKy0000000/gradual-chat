import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const socketState = vi.hoisted(() => {
  type Handler = (payload: unknown) => void;
  const listeners = new Map<string, Set<Handler>>();
  const socket = {
    connected: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn((event: string, handler: Handler) => {
      const eventListeners = listeners.get(event) ?? new Set<Handler>();
      eventListeners.add(handler);
      listeners.set(event, eventListeners);
    }),
    off: vi.fn((event: string, handler: Handler) => {
      listeners.get(event)?.delete(handler);
    }),
  };

  return {
    emit(event: string, payload: unknown) {
      for (const handler of listeners.get(event) ?? []) {
        handler(payload);
      }
    },
    listeners,
    socket,
  };
});

vi.mock("./socket", () => ({ socket: socketState.socket }));

import App from "./App";

const baseMessage = {
  id: "message-1",
  conversationId: "share-your-story",
  senderId: "demo-user-b",
  content: "Original message",
  status: "sent",
  replyToMessageId: null,
  replyTo: null,
};

beforeEach(() => {
  localStorage.clear();
  socketState.listeners.clear();
  vi.clearAllMocks();
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Quote Reply", () => {
  it("shows a composer preview after Reply is selected", async () => {
    mockGraphQL({ history: [baseMessage] });
    render(<App />);
    await openChatAsUserA();

    await userEvent.click(screen.getByRole("button", { name: "Reply" }));

    expect(screen.getByText("Replying to message")).toBeVisible();
    expect(screen.getAllByText("Original message")).toHaveLength(2);
  });

  it("removes the composer preview when Cancel Reply is selected", async () => {
    mockGraphQL({ history: [baseMessage] });
    render(<App />);
    await openChatAsUserA();
    await userEvent.click(screen.getByRole("button", { name: "Reply" }));

    await userEvent.click(
      screen.getByRole("button", { name: "Cancel reply" }),
    );

    expect(screen.queryByText("Replying to message")).not.toBeInTheDocument();
    expect(screen.getAllByText("Original message")).toHaveLength(1);
  });

  it("renders quoted content returned in message history", async () => {
    mockGraphQL({
      history: [
        {
          ...baseMessage,
          id: "message-2",
          content: "My response",
          replyToMessageId: "message-1",
          replyTo: { id: "message-1", content: "Original question" },
        },
      ],
    });
    render(<App />);
    await openChatAsUserA("My response");

    expect(screen.getByText("Replying to")).toBeVisible();
    expect(screen.getByText("Original question")).toBeVisible();
    expect(screen.getByText("My response")).toBeVisible();
  });
});

describe("Demo conversation flow", () => {
  it("starts with no active conversation after User B is selected", async () => {
    mockGraphQL();
    render(<App />);

    await chooseUser("User B");

    expect(screen.getByText("Select a conversation")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Chat with User A" }),
    ).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
  });

  it("shows the persisted unread count on the contact", async () => {
    mockGraphQL({ unreadCount: 4 });
    render(<App />);

    await chooseUser("User B");

    expect(await screen.findByText("4")).toBeVisible();
  });

  it("increments unread without marking read while the contact list is open", async () => {
    const fetchMock = mockGraphQL();
    render(<App />);
    await chooseUser("User B");
    await waitFor(() => expect(operationCount(fetchMock, "ConversationReadState")).toBe(1));

    emitMessage({
      ...baseMessage,
      senderId: "demo-user-a",
      content: "Unread while closed",
    });

    expect(await screen.findByText("1")).toBeVisible();
    expect(screen.queryByText("Unread while closed")).not.toBeInTheDocument();
    expect(operationCount(fetchMock, "MarkConversationRead")).toBe(0);
  });

  it("loads history, marks the latest message read, and clears the badge", async () => {
    const history = [
      { ...baseMessage, id: "message-1", content: "First unread" },
      { ...baseMessage, id: "message-2", content: "Second unread" },
    ];
    const fetchMock = mockGraphQL({ unreadCount: 2, history });
    render(<App />);
    await chooseUser("User A");
    expect(await screen.findByText("2")).toBeVisible();

    await userEvent.click(
      screen.getByRole("button", { name: "Chat with User B" }),
    );

    expect(await screen.findByText("First unread")).toBeVisible();
    expect(screen.getByText("Second unread")).toBeVisible();
    await waitFor(() =>
      expect(operationCount(fetchMock, "MarkConversationRead")).toBe(1),
    );
    expect(screen.queryByText("2")).not.toBeInTheDocument();
  });

  it("deduplicates a realtime message that is already in history", async () => {
    mockGraphQL({ history: [baseMessage] });
    render(<App />);
    await openChatAsUserA();

    emitMessage(baseMessage);

    expect(screen.getAllByText("Original message")).toHaveLength(1);
  });

  it("resets the open conversation when switching users", async () => {
    mockGraphQL({ history: [baseMessage] });
    render(<App />);
    await openChatAsUserA();

    await userEvent.click(
      screen.getByRole("button", { name: "Switch User" }),
    );
    expect(screen.getByRole("heading", { name: "Choose user" })).toBeVisible();

    await chooseUser("User B");
    expect(screen.getByText("Select a conversation")).toBeVisible();
    expect(screen.queryByText("Original message")).not.toBeInTheDocument();
  });
});

async function chooseUser(name: "User A" | "User B") {
  await userEvent.click(screen.getByRole("button", { name }));
  const contactName = name === "User A" ? "User B" : "User A";
  await screen.findByRole("button", { name: `Chat with ${contactName}` });
}

async function openChatAsUserA(expectedMessage = baseMessage.content) {
  await chooseUser("User A");
  await userEvent.click(
    screen.getByRole("button", { name: "Chat with User B" }),
  );
  await screen.findByRole("textbox", { name: "Message" });
  await screen.findByText(expectedMessage);
}

function emitMessage(message: Record<string, unknown>) {
  act(() => {
    socketState.emit("messageCreated", message);
  });
}

function operationCount(fetchMock: ReturnType<typeof vi.fn>, name: string) {
  return fetchMock.mock.calls.filter((call) => {
    const request = call[1] as RequestInit | undefined;
    return String(request?.body).includes(name);
  }).length;
}

function mockGraphQL({
  unreadCount = 0,
  history = [],
}: {
  unreadCount?: number;
  history?: Array<Record<string, unknown>>;
} = {}) {
  const readState = {
    conversationId: "share-your-story",
    lastReadMessageId: null,
    latestMessageId: history.at(-1)?.id ?? null,
    unreadCount,
  };
  const markedReadState = {
    ...readState,
    lastReadMessageId: history.at(-1)?.id ?? null,
    unreadCount: 0,
  };
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string };

      if (body.query.includes("query ConversationReadState")) {
        return {
          json: async () => ({ data: { conversationReadState: readState } }),
        };
      }

      if (body.query.includes("query Messages")) {
        return { json: async () => ({ data: { messages: history } }) };
      }

      if (body.query.includes("mutation MarkConversationRead")) {
        return {
          json: async () => ({
            data: { markConversationRead: markedReadState },
          }),
        };
      }

      return { json: async () => ({ data: {} }) };
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
