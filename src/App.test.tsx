import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  sessionStorage.clear();
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
  it("shows a composer preview after Quote is selected", async () => {
    mockGraphQL({ history: [baseMessage] });
    render(<App />);
    await openChatAsUserA();

    await userEvent.click(screen.getByRole("button", { name: "Quote message: Original message" }));

    expect(screen.getByText("Replying to message")).toBeVisible();
    expect(screen.getAllByText("Original message")).toHaveLength(2);
  });

  it("removes the composer preview when Cancel Reply is selected", async () => {
    mockGraphQL({ history: [baseMessage] });
    render(<App />);
    await openChatAsUserA();
    await userEvent.click(screen.getByRole("button", { name: "Quote message: Original message" }));

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

describe("Message actions and identity menu", () => {
  it("hides only an own sent message, preserves the quoted fallback after refresh, and keeps the real preview", async () => {
    const own = { ...baseMessage, id: "own-1", senderId: "demo-user-a", content: "Hide this", createdAt: "2026-09-24T10:00:00.000Z" };
    const reply = { ...baseMessage, id: "reply-1", content: "I saw it", createdAt: "2026-09-24T10:01:00.000Z", replyToMessageId: "own-1", replyTo: { id: "own-1", content: "Hide this" } };
    const fetchMock = mockGraphQL({ history: [own, reply] });
    const first = render(<App />);
    await openChatAsUserA("I saw it");
    expect(screen.getAllByRole("button", { name: "Hide for me" })).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Hide for me" }));
    await waitFor(() => expect(screen.queryByRole("article", { name: /Hide this/ })).not.toBeInTheDocument());
    expect(screen.getByText("Message hidden")).toBeVisible();
    expect(screen.getByRole("button", { name: "Chat with User B" })).toHaveTextContent("User B: I saw it");
    expect(operationCount(fetchMock, "mutation HideMessageForMe")).toBe(1);
    first.unmount();

    render(<App />);
    await screen.findByText("Message hidden");
    expect(screen.queryByRole("article", { name: /Hide this/ })).not.toBeInTheDocument();
  });

  it("falls back to the latest visible message when the latest own message is hidden", async () => {
    const older = { ...baseMessage, content: "Visible from B", createdAt: "2026-09-24T10:00:00.000Z" };
    const own = { ...baseMessage, id: "own-latest", senderId: "demo-user-a", content: "Hide latest", createdAt: "2026-09-24T10:01:00.000Z" };
    mockGraphQL({ history: [older, own] });
    render(<App />);
    await openChatAsUserA("Hide latest");
    await userEvent.click(screen.getByRole("button", { name: "Hide for me" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Chat with User B" })).toHaveTextContent("User B: Visible from B"));
  });

  it("moves identity switching to a keyboard accessible avatar menu", async () => {
    mockGraphQL();
    render(<App />);
    await chooseUser("User A");
    const trigger = screen.getByRole("button", { name: "Switch user" });
    await userEvent.click(trigger);
    expect(screen.getByRole("menuitemradio", { name: /User A/ })).toHaveAttribute("aria-checked", "true");
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitemradio", { name: /User B/ })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await userEvent.click(trigger);
    await userEvent.click(screen.getByText("Gradual Community", { selector: ".brand-name" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await switchUserFromAvatar("User B");
    expect(sessionStorage.getItem("gradual-chat-demo-user")).toBe("demo-user-b");
    await userEvent.click(screen.getByRole("button", { name: "Chat with User A" }));
    expect(screen.getByRole("heading", { name: "User A" })).toBeVisible();
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
    const fetchMock = mockGraphQL({ unreadCounts: [0, 1] });
    render(<App />);
    await chooseUser("User B");
    await waitFor(() => expect(operationCount(fetchMock, "ConversationReadState")).toBe(1));

    emitMessage({
      ...baseMessage,
      senderId: "demo-user-a",
      content: "Unread while closed",
    });

    expect(await screen.findByText("1")).toBeVisible();
    emitMessage({ ...baseMessage, senderId: "demo-user-a", content: "Unread while closed" });
    expect(screen.getByText("1")).toBeVisible();
    expect(operationCount(fetchMock, "ConversationReadState")).toBe(2);
    expect(screen.getByText("User A: Unread while closed")).toBeVisible();
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
    expect(document.querySelector(".unread-badge")).not.toBeInTheDocument();
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

    await switchUserFromAvatar("User B");
    expect(screen.getByText("Select a conversation")).toBeVisible();
    expect(screen.queryByText("Original message")).not.toBeInTheDocument();
  });
});

describe("Conversation list preview", () => {
  it("keeps the conversation title and restores the latest message and timestamp while closed", async () => {
    const createdAt = "2026-09-24T12:55:00.000Z";
    mockGraphQL({ history: [{ ...baseMessage, content: "Sounds good!", createdAt }] });
    render(<App />);
    await chooseUser("User A");

    const row = screen.getByRole("button", { name: "Chat with User B" });
    expect(row.querySelector(".conversation-name")).toHaveTextContent("User B");
    await waitFor(() => expect(row).toHaveTextContent("User B: Sounds good!"));
    expect(row.querySelector("time")).toHaveAttribute("datetime", createdAt);
  });

  it("updates the closed list from Socket.IO without marking the message read", async () => {
    const fetchMock = mockGraphQL({ history: [{ ...baseMessage, createdAt: "2026-09-24T10:00:00.000Z" }] });
    render(<App />);
    await chooseUser("User A");
    const row = screen.getByRole("button", { name: "Chat with User B" });
    await waitFor(() => expect(row).toHaveTextContent("User B: Original message"));

    emitMessage({ ...baseMessage, id: "message-2", content: "New @User A reply", createdAt: "2026-09-24T11:00:00.000Z", senderId: "demo-user-b" });
    expect(row.querySelector(".conversation-name")).toHaveTextContent("User B");
    expect(row).toHaveTextContent("User B: New @User A reply");
    expect(row.querySelector("time")).toHaveAttribute("datetime", "2026-09-24T11:00:00.000Z");
    expect(operationCount(fetchMock, "mutation MarkConversationRead")).toBe(0);
  });

  it("uses message content for a quoted mention and switches to You after sending", async () => {
    const fetchMock = mockGraphQL({ history: [{
      ...baseMessage,
      content: "Thanks @User A",
      createdAt: "2026-09-24T10:00:00.000Z",
      replyTo: { id: "older", content: "Older quoted text" },
    }] });
    render(<App />);
    await chooseUser("User A");
    const row = screen.getByRole("button", { name: "Chat with User B" });
    await waitFor(() => expect(row).toHaveTextContent("User B: Thanks @User A"));
    expect(row).not.toHaveTextContent("Older quoted text");
    await userEvent.click(row);
    await waitFor(() => expect(document.querySelector(".message-bubble")).toHaveTextContent("Thanks @User A"));
    await userEvent.type(screen.getByRole("textbox", { name: "Message" }), "Many thanks!{Enter}");
    await waitFor(() => expect(row).toHaveTextContent("You: Many thanks!"));
    expect(operationCount(fetchMock, "mutation SendMessage")).toBe(1);
    expect(row.querySelector(".conversation-name")).toHaveTextContent("User B");
    expect(row.querySelector("time")?.getAttribute("datetime")).toBeTruthy();
  });

  it("does not leave a failed optimistic message as the latest real preview", async () => {
    mockGraphQL({ history: [{ ...baseMessage, createdAt: "2026-09-24T10:00:00.000Z" }], sendFailures: 1 });
    render(<App />);
    await openChatAsUserA();
    await userEvent.type(screen.getByRole("textbox", { name: "Message" }), "will fail{Enter}");
    const row = screen.getByRole("button", { name: "Chat with User B" });
    await waitFor(() => expect(screen.getByText("Failed to send")).toBeVisible());
    expect(row).toHaveTextContent("User B: Original message");
  });
});

describe("V2 messaging basics", () => {
  it("rejects empty and whitespace messages in the composer", async () => {
    const fetchMock = mockGraphQL();
    render(<App />);
    await chooseUser("User A");
    await userEvent.click(screen.getByRole("button", { name: "Chat with User B" }));
    await screen.findByText("No messages yet");

    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a message");
    const input = screen.getByRole("textbox", { name: "Message" });
    await userEvent.type(input, "   {Enter}");
    expect(operationCount(fetchMock, "mutation SendMessage")).toBe(0);
    expect(screen.queryByText("Failed to send")).not.toBeInTheDocument();
  });

  it("explains the length limit instead of silently truncating a large paste", async () => {
    const fetchMock = mockGraphQL();
    render(<App />);
    await chooseUser("User A");
    await userEvent.click(screen.getByRole("button", { name: "Chat with User B" }));
    await screen.findByText("No messages yet");
    const input = screen.getByRole("textbox", { name: "Message" });
    fireEvent.paste(input, { clipboardData: { getData: () => "x".repeat(2001) } });
    expect(screen.getByRole("alert")).toHaveTextContent("under 2000 characters");
    expect(input).toHaveValue("");
    expect(operationCount(fetchMock, "mutation SendMessage")).toBe(0);
  });

  it("sends trimmed text with Enter once and shows a real timestamp", async () => {
    const fetchMock = mockGraphQL();
    render(<App />);
    await chooseUser("User A");
    await userEvent.click(screen.getByRole("button", { name: "Chat with User B" }));
    await screen.findByText("No messages yet");
    await userEvent.type(screen.getByRole("textbox", { name: "Message" }), "  hello  {Enter}");
    await screen.findByText("hello");
    await waitFor(() => expect(screen.getByText("Sent")).toBeVisible());
    expect(operationCount(fetchMock, "mutation SendMessage")).toBe(1);
    expect(operationVariables(fetchMock, "mutation SendMessage")[0].content).toBe("hello");
    expect(screen.queryByText("now")).not.toBeInTheDocument();
    expect(document.querySelector("time")?.dateTime).toBeTruthy();
  });

  it("guards against two submits in the same interaction", async () => {
    const fetchMock = mockGraphQL();
    render(<App />);
    await chooseUser("User A");
    await userEvent.click(screen.getByRole("button", { name: "Chat with User B" }));
    await screen.findByText("No messages yet");
    const input = screen.getByRole("textbox", { name: "Message" });
    await userEvent.type(input, "once");
    const form = input.closest("form");
    expect(form).not.toBeNull();
    act(() => {
      fireEvent.submit(form!);
      fireEvent.submit(form!);
    });
    expect(operationCount(fetchMock, "mutation SendMessage")).toBe(1);
    expect(screen.getAllByText("once")).toHaveLength(1);
  });

  it("ignores repeated Enter after sending until the draft changes", async () => {
    const fetchMock = mockGraphQL();
    render(<App />);
    await chooseUser("User A");
    await userEvent.click(screen.getByRole("button", { name: "Chat with User B" }));
    await screen.findByText("No messages yet");
    const input = screen.getByRole("textbox", { name: "Message" });

    await userEvent.type(input, "first{Enter}{Enter}");
    expect(operationCount(fetchMock, "mutation SendMessage")).toBe(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await userEvent.type(input, "second{Enter}");
    expect(operationCount(fetchMock, "mutation SendMessage")).toBe(2);
  });

  it("renders the timestamp and mention identity from loaded history", async () => {
    mockGraphQL({ history: [{
      ...baseMessage,
      content: "Hello @User A!",
      createdAt: "2024-01-02T03:04:00.000Z",
      mentionedUserIds: ["demo-user-a"],
    }] });
    render(<App />);
    await chooseUser("User A");
    await userEvent.click(screen.getByRole("button", { name: "Chat with User B" }));
    expect(await screen.findByText("@User A")).toHaveClass("message-mention");
    expect(document.querySelector("time")?.dateTime).toBe("2024-01-02T03:04:00.000Z");
    expect(screen.queryByText("now")).not.toBeInTheDocument();
  });

  it("selects a mention with Enter and sends its persisted identity", async () => {
    const fetchMock = mockGraphQL();
    render(<App />);
    await chooseUser("User A");
    await userEvent.click(screen.getByRole("button", { name: "Chat with User B" }));
    await screen.findByText("No messages yet");
    const input = screen.getByRole("textbox", { name: "Message" });
    await userEvent.type(input, "@");
    expect(screen.getByRole("listbox", { name: "Mention a user" })).toBeVisible();
    await userEvent.keyboard("{Enter}");
    expect(input).toHaveValue("@User B ");
    expect(operationCount(fetchMock, "mutation SendMessage")).toBe(0);
    await userEvent.type(input, "hello{Enter}");
    await waitFor(() => expect(screen.getByText("Sent")).toBeVisible());
    expect(operationVariables(fetchMock, "mutation SendMessage")[0].content).toBe("@User B hello");
    expect(screen.getByText("@User B")).toHaveClass("message-mention");
  });

  it("keeps IME confirmation from submitting a message", async () => {
    const fetchMock = mockGraphQL();
    render(<App />);
    await chooseUser("User A");
    await userEvent.click(screen.getByRole("button", { name: "Chat with User B" }));
    await screen.findByText("No messages yet");
    const input = screen.getByRole("textbox", { name: "Message" });
    await userEvent.type(input, "draft");
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(operationCount(fetchMock, "mutation SendMessage")).toBe(0);
    expect(input).toHaveValue("draft");
  });

  it("shows a history error and recovers through Retry loading", async () => {
    const fetchMock = mockGraphQL({ historyFailures: 1, history: [baseMessage] });
    render(<App />);
    await chooseUser("User A");
    await userEvent.click(screen.getByRole("button", { name: "Chat with User B" }));
    expect(await screen.findByText("Could not load message history.")).toBeVisible();
    expect(screen.queryByText("No messages yet")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry loading" }));
    expect(await screen.findByText("Original message")).toBeVisible();
    expect(operationCount(fetchMock, "query Messages")).toBe(2);
  });

  it("retries a failed message with the same ID and does not create two bubbles", async () => {
    const fetchMock = mockGraphQL({ sendFailures: 1 });
    render(<App />);
    await chooseUser("User A");
    await userEvent.click(screen.getByRole("button", { name: "Chat with User B" }));
    await screen.findByText("No messages yet");
    await userEvent.type(screen.getByRole("textbox", { name: "Message" }), "Retry me{Enter}");
    expect(await screen.findByText("Failed to send")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Retry send" }));
    await waitFor(() => expect(screen.getByText("Sent")).toBeVisible());
    const sends = operationVariables(fetchMock, "mutation SendMessage");
    expect(sends).toHaveLength(2);
    expect(sends[0].id).toBe(sends[1].id);
    expect(screen.getAllByText("Retry me")).toHaveLength(1);
  });

  it("deduplicates a socket echo that arrives before the send response", async () => {
    let releaseSend!: () => void;
    const firstSendGate = new Promise<void>((resolve) => { releaseSend = resolve; });
    const fetchMock = mockGraphQL({ firstSendGate });
    render(<App />);
    await chooseUser("User A");
    await userEvent.click(screen.getByRole("button", { name: "Chat with User B" }));
    await screen.findByText("No messages yet");
    await userEvent.type(screen.getByRole("textbox", { name: "Message" }), "one bubble{Enter}");
    const id = String(operationVariables(fetchMock, "mutation SendMessage")[0].id);
    emitMessage({ ...baseMessage, id, senderId: "demo-user-a", content: "one bubble", createdAt: new Date().toISOString() });
    await act(async () => { releaseSend(); });
    expect(screen.getAllByText("one bubble")).toHaveLength(1);
    expect(screen.getByText("Sent")).toBeVisible();
  });

  it("does not reset loaded history when the open contact is clicked again", async () => {
    const fetchMock = mockGraphQL({ history: [baseMessage] });
    render(<App />);
    await openChatAsUserA();
    await userEvent.click(screen.getByRole("button", { name: "Chat with User B" }));
    expect(screen.getByText("Original message")).toBeVisible();
    expect(operationCount(fetchMock, "query Messages")).toBe(1);
  });

  it("restores the selected identity and open conversation after a refresh", async () => {
    const fetchMock = mockGraphQL({ history: [baseMessage] });
    const first = render(<App />);
    await openChatAsUserA();
    first.unmount();

    render(<App />);
    expect(screen.queryByRole("heading", { name: "Choose user" })).not.toBeInTheDocument();
    expect(await screen.findByText("Original message")).toBeVisible();
    expect(operationCount(fetchMock, "query Messages")).toBe(2);
  });

  it("keeps demo identity in tab session storage rather than shared local storage", async () => {
    localStorage.setItem("gradual-chat-demo-user", "demo-user-b");
    mockGraphQL();
    const first = render(<App />);
    expect(screen.getByRole("heading", { name: "Choose user" })).toBeVisible();

    await chooseUser("User A");
    expect(sessionStorage.getItem("gradual-chat-demo-user")).toBe("demo-user-a");
    first.unmount();

    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Switch user" }));
    expect(screen.getByRole("menuitemradio", { name: /User A/ })).toHaveAttribute("aria-checked", "true");
  });

  it("ignores a history response from the previous identity", async () => {
    let releaseHistory!: () => void;
    const firstHistoryGate = new Promise<void>((resolve) => { releaseHistory = resolve; });
    const fetchMock = mockGraphQL({ history: [baseMessage], firstHistoryGate });
    render(<App />);
    await chooseUser("User A");
    await userEvent.click(screen.getByRole("button", { name: "Chat with User B" }));
    await waitFor(() => expect(operationCount(fetchMock, "query Messages")).toBe(1));
    await switchUserFromAvatar("User B");
    await userEvent.click(screen.getByRole("button", { name: "Chat with User A" }));
    expect(await screen.findByText("Original message")).toBeVisible();
    await act(async () => { releaseHistory(); });
    expect(screen.getAllByText("Original message")).toHaveLength(1);
  });

  it("reloads history after a socket reconnect to recover missed messages", async () => {
    const fetchMock = mockGraphQL({ history: [baseMessage] });
    render(<App />);
    await openChatAsUserA();
    act(() => { socketState.emit("connect", undefined); });
    act(() => { socketState.emit("disconnect", undefined); });
    act(() => { socketState.emit("connect", undefined); });
    await waitFor(() => expect(operationCount(fetchMock, "query Messages")).toBe(2));
    expect(screen.getAllByText("Original message")).toHaveLength(1);
  });
});

async function chooseUser(name: "User A" | "User B") {
  await userEvent.click(screen.getByRole("button", { name }));
  const contactName = name === "User A" ? "User B" : "User A";
  await screen.findByRole("button", { name: `Chat with ${contactName}` });
}

async function switchUserFromAvatar(name: "User A" | "User B") {
  await userEvent.click(screen.getByRole("button", { name: "Switch user" }));
  await userEvent.click(screen.getByRole("menuitemradio", { name: new RegExp(name) }));
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

function operationVariables(fetchMock: ReturnType<typeof vi.fn>, name: string) {
  return fetchMock.mock.calls
    .map((call) => JSON.parse(String((call[1] as RequestInit).body)) as { query: string; variables: Record<string, unknown> })
    .filter((body) => body.query.includes(name))
    .map((body) => body.variables);
}

function mockGraphQL({
  unreadCount = 0,
  unreadCounts,
  history = [],
  historyFailures = 0,
  sendFailures = 0,
  firstHistoryGate,
  firstSendGate,
}: {
  unreadCount?: number;
  unreadCounts?: number[];
  history?: Array<Record<string, unknown>>;
  historyFailures?: number;
  sendFailures?: number;
  firstHistoryGate?: Promise<void>;
  firstSendGate?: Promise<void>;
} = {}) {
  const readState = {
    conversationId: "share-your-story",
    lastReadMessageId: null,
    latestMessageId: history.at(-1)?.id ?? null,
    latestMessage: history.at(-1) ?? null,
    unreadCount,
    hiddenMessageIds: [],
  };
  const markedReadState = {
    ...readState,
    lastReadMessageId: history.at(-1)?.id ?? null,
    unreadCount: 0,
  };
  let readQueryIndex = 0;
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };

      if (body.query.includes("query ConversationReadState")) {
        return {
          ok: true,
          json: async () => ({ data: { conversationReadState: {
            ...readState,
            unreadCount: unreadCounts?.[Math.min(readQueryIndex++, unreadCounts.length - 1)] ?? unreadCount,
          } } }),
        };
      }

      if (body.query.includes("query Messages")) {
        if (firstHistoryGate) {
          const gate = firstHistoryGate;
          firstHistoryGate = undefined;
          await gate;
        }
        if (historyFailures-- > 0) {
          return { ok: true, json: async () => ({ errors: [{ message: "History failed" }] }) };
        }
        return { ok: true, json: async () => ({ data: { messages: history } }) };
      }

      if (body.query.includes("mutation MarkConversationRead")) {
        return {
          ok: true,
          json: async () => ({
            data: { markConversationRead: markedReadState },
          }),
        };
      }

      if (body.query.includes("mutation SendMessage")) {
        if (firstSendGate) {
          const gate = firstSendGate;
          firstSendGate = undefined;
          await gate;
        }
        if (sendFailures-- > 0) {
          return { ok: true, json: async () => ({ errors: [{ message: "Send failed" }] }) };
        }
        return {
          ok: true,
          json: async () => ({ data: { sendMessage: {
            ...body.variables,
            status: "sent",
            createdAt: new Date().toISOString(),
            mentionedUserIds: String(body.variables.content).includes("@User B") ? ["demo-user-b"] : [],
            replyTo: null,
          } } }),
        };
      }

      if (body.query.includes("mutation HideMessageForMe")) {
        const messageId = String(body.variables.messageId);
        readState.hiddenMessageIds.push(messageId);
        const visibleLatest = [...history].reverse().find((message) => !readState.hiddenMessageIds.includes(String(message.id))) ?? null;
        readState.latestMessage = visibleLatest;
        readState.latestMessageId = visibleLatest?.id ?? null;
        return { ok: true, json: async () => ({ data: { hideMessageForMe: readState } }) };
      }

      return { ok: true, json: async () => ({ data: {} }) };
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
