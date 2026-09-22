import { useEffect, useState } from "react";

import "./App.css";
import { socket } from "./socket";

type DemoUser = {
  id: "demo-user-a" | "demo-user-b";
  name: "User A" | "User B";
  initials: "UA" | "UB";
};

type ReplyTarget = {
  id: string;
  content: string;
};

type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  status: "sending" | "sent" | "failed";
  replyToMessageId?: string | null;
  replyTo: ReplyTarget | null;
};

type ConversationReadState = {
  conversationId: string;
  lastReadMessageId: string | null;
  latestMessageId: string | null;
  unreadCount: number;
};

const demoUsers: DemoUser[] = [
  { id: "demo-user-a", name: "User A", initials: "UA" },
  { id: "demo-user-b", name: "User B", initials: "UB" },
];
const currentConversationId = "share-your-story";
const selectedUserStorageKey = "gradual-chat-demo-user";
const graphqlUrl = "http://localhost:4000/graphql";

function App() {
  const [selectedUser, setSelectedUser] = useState<DemoUser | null>(
    getSavedUser,
  );
  const [activeConversation, setActiveConversation] = useState<string | null>(
    null,
  );
  const [inputText, setInputText] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [replyingTo, setReplyingTo] = useState<ReplyTarget | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isConnected, setIsConnected] = useState(socket.connected);
  const contact = selectedUser ? getContactFor(selectedUser) : null;

  useEffect(() => {
    const handleConnect = () => {
      setIsConnected(true);
    };
    const handleDisconnect = () => {
      setIsConnected(false);
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.connect();

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!selectedUser) {
      return;
    }

    let isCurrent = true;

    void getConversationReadState(selectedUser.id)
      .then((readState) => {
        if (isCurrent && readState) {
          setUnreadCount((count) => Math.max(count, readState.unreadCount));
        }
      })
      .catch(() => {
        // Messaging remains usable if read-state loading is unavailable.
      });

    return () => {
      isCurrent = false;
    };
  }, [selectedUser]);

  useEffect(() => {
    if (!selectedUser) {
      return;
    }

    let isCurrent = true;
    let readUpdateQueue = Promise.resolve();

    const updateReadPosition = (lastReadMessageId: string) => {
      readUpdateQueue = readUpdateQueue.then(async () => {
        try {
          const readState = await markConversationRead(
            selectedUser.id,
            lastReadMessageId,
          );

          if (isCurrent && readState) {
            setUnreadCount(readState.unreadCount);
          }
        } catch {
          // A transient read-state failure should not interrupt delivery.
        }
      });

      return readUpdateQueue;
    };

    const handleMessageCreated = (socketMessage: Message) => {
      if (socketMessage.conversationId !== currentConversationId) {
        return;
      }

      if (activeConversation === currentConversationId) {
        setMessages((previousMessages) =>
          upsertMessage(previousMessages, {
            ...socketMessage,
            status: "sent",
          }),
        );
        requestAnimationFrame(() => {
          void updateReadPosition(socketMessage.id);
        });
        return;
      }

      if (socketMessage.senderId !== selectedUser.id) {
        setUnreadCount((count) => count + 1);
      }
    };

    socket.on("messageCreated", handleMessageCreated);

    return () => {
      isCurrent = false;
      socket.off("messageCreated", handleMessageCreated);
    };
  }, [activeConversation, selectedUser]);

  const handleSelectUser = (user: DemoUser) => {
    localStorage.setItem(selectedUserStorageKey, user.id);
    setSelectedUser(user);
    resetConversationState();
  };

  const handleSwitchUser = () => {
    localStorage.removeItem(selectedUserStorageKey);
    setSelectedUser(null);
    resetConversationState();
  };

  const resetConversationState = () => {
    setActiveConversation(null);
    setMessages([]);
    setReplyingTo(null);
    setInputText("");
    setUnreadCount(0);
  };

  const handleOpenConversation = async () => {
    if (!selectedUser) {
      return;
    }

    setActiveConversation(currentConversationId);
    setMessages([]);
    setReplyingTo(null);

    try {
      const history = await getMessages();
      setMessages((realtimeMessages) =>
        mergeHistoryAndRealtime(history, realtimeMessages),
      );

      const latestMessage = history.at(-1);

      if (latestMessage) {
        const readState = await markConversationRead(
          selectedUser.id,
          latestMessage.id,
        );
        setUnreadCount(readState?.unreadCount ?? 0);
      } else {
        setUnreadCount(0);
      }
    } catch {
      // Keep the conversation open so new Socket messages can still arrive.
    }
  };

  const handleSend = async () => {
    if (!selectedUser || activeConversation !== currentConversationId) {
      return;
    }

    const replyTarget = replyingTo;
    const newMessage: Message = {
      id: crypto.randomUUID(),
      conversationId: currentConversationId,
      senderId: selectedUser.id,
      content: inputText,
      status: "sending",
      replyToMessageId: replyTarget?.id ?? null,
      replyTo: replyTarget,
    };

    setMessages((previousMessages) => [...previousMessages, newMessage]);
    setInputText("");
    setReplyingTo(null);

    try {
      const sentMessage = await sendMessage(newMessage);
      setMessages((previousMessages) =>
        updateMessage(
          previousMessages,
          newMessage.id,
          sentMessage ?? { status: "failed" },
        ),
      );
    } catch {
      setMessages((previousMessages) =>
        updateMessage(previousMessages, newMessage.id, { status: "failed" }),
      );
    }
  };

  return (
    <div className="community-app">
      <header className="global-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            G
          </span>
          <span className="brand-name">Gradual Chat</span>
        </div>

        <div className="global-tools" aria-label="Demo controls">
          <span
            className={`connection-status ${
              isConnected ? "connection-online" : "connection-offline"
            }`}
          >
            <span aria-hidden="true" />
            {isConnected ? "Connected" : "Disconnected"}
          </span>
          {selectedUser ? (
            <>
              <span className="current-user">{selectedUser.name}</span>
              <button
                className="switch-user-button"
                type="button"
                onClick={handleSwitchUser}
              >
                Switch User
              </button>
            </>
          ) : null}
        </div>
      </header>

      {!selectedUser ? (
        <main className="identity-stage">
          <div className="identity-picker">
            <p className="eyebrow">Demo identity</p>
            <h1>Choose user</h1>
            <p>Select one of the two fixed identities to enter the demo.</p>
            <div className="identity-actions">
              {demoUsers.map((user) => (
                <button
                  type="button"
                  key={user.id}
                  onClick={() => handleSelectUser(user)}
                >
                  {user.name}
                </button>
              ))}
            </div>
          </div>
        </main>
      ) : (
        <div className="workspace">
          <aside className="conversation-sidebar" aria-label="Contacts">
            <div className="contact-sidebar-header">
              <p className="eyebrow">Demo chat</p>
              <h2>Contacts</h2>
            </div>
            {contact ? (
              <button
                className={`conversation-item contact-item${
                  activeConversation ? " conversation-item-active" : ""
                }`}
                type="button"
                aria-label={`Chat with ${contact.name}`}
                onClick={handleOpenConversation}
              >
                <span className="conversation-avatar avatar-violet">
                  {contact.initials}
                </span>
                <span className="conversation-copy">
                  <span className="conversation-name">{contact.name}</span>
                  <span className="conversation-preview">
                    {activeConversation ? "Conversation open" : "Open chat"}
                  </span>
                </span>
                {unreadCount > 0 ? (
                  <span className="unread-badge">{unreadCount}</span>
                ) : null}
              </button>
            ) : null}
          </aside>

          {activeConversation && contact ? (
            <main className="chat-panel" id="chat">
              <header className="chat-header">
                <div>
                  <p className="eyebrow">{currentConversationId}</p>
                  <h1>{contact.name}</h1>
                </div>
                <span className="unread-summary">Unread: {unreadCount}</span>
              </header>

              <MessageFeed
                messages={messages}
                selectedUser={selectedUser}
                onReply={setReplyingTo}
              />

              <footer className="composer-wrap">
                {replyingTo ? (
                  <div className="reply-preview">
                    <div>
                      <span>Replying to message</span>
                      <p>{replyingTo.content}</p>
                    </div>
                    <button
                      type="button"
                      aria-label="Cancel reply"
                      onClick={() => setReplyingTo(null)}
                    >
                      ×
                    </button>
                  </div>
                ) : null}
                <div className="composer">
                  <span className="composer-plus" aria-hidden="true">
                    +
                  </span>
                  <input
                    aria-label="Message"
                    placeholder="Write a message…"
                    value={inputText}
                    onChange={(event) => setInputText(event.target.value)}
                  />
                  <span className="composer-emoji" aria-hidden="true">
                    ☺
                  </span>
                  <button type="button" onClick={handleSend}>
                    Send <span aria-hidden="true">↗</span>
                  </button>
                </div>
                <p className="composer-hint">
                  Messages sync instantly with the other demo user
                </p>
              </footer>
            </main>
          ) : (
            <main className="chat-panel chat-panel-empty">
              <div className="empty-chat">
                <span className="empty-chat-mark" aria-hidden="true">
                  ✦
                </span>
                <h2>Select a conversation</h2>
                <p>Choose your contact to load message history.</p>
              </div>
            </main>
          )}
        </div>
      )}
    </div>
  );
}

function MessageFeed({
  messages,
  selectedUser,
  onReply,
}: {
  messages: Message[];
  selectedUser: DemoUser;
  onReply: (message: ReplyTarget) => void;
}) {
  return (
    <section className="message-feed" aria-live="polite">
      {messages.length === 0 ? (
        <div className="empty-chat">
          <span className="empty-chat-mark" aria-hidden="true">
            ✦
          </span>
          <h2>No messages yet</h2>
          <p>Start the conversation with {getContactFor(selectedUser).name}.</p>
        </div>
      ) : (
        messages.map((message) => {
          const isOwnMessage = message.senderId === selectedUser.id;

          return (
            <article
              className={`message-row ${
                isOwnMessage ? "message-own" : "message-received"
              }`}
              key={message.id}
            >
              {!isOwnMessage ? (
                <span className="message-avatar">
                  {getContactFor(selectedUser).initials}
                </span>
              ) : null}
              <div className="message-content">
                <div className="message-meta">
                  <span>{isOwnMessage ? "You" : "Community member"}</span>
                  <span>now</span>
                </div>
                <div className="message-bubble">
                  {message.replyTo ? (
                    <div className="quoted-message">
                      <span>Replying to</span>
                      <p>{message.replyTo.content}</p>
                    </div>
                  ) : null}
                  <span>{message.content}</span>
                </div>
                <div className="message-actions">
                  <span className={`message-status status-${message.status}`}>
                    {message.status === "sending"
                      ? "Sending…"
                      : message.status === "failed"
                        ? "Failed to send"
                        : "Sent"}
                  </span>
                  {message.status === "sent" ? (
                    <button
                      className="reply-button"
                      type="button"
                      onClick={() =>
                        onReply({ id: message.id, content: message.content })
                      }
                    >
                      Reply
                    </button>
                  ) : null}
                </div>
              </div>
              {isOwnMessage ? (
                <span className="message-avatar message-avatar-own">
                  {selectedUser.initials}
                </span>
              ) : null}
            </article>
          );
        })
      )}
    </section>
  );
}

function getSavedUser(): DemoUser | null {
  try {
    const storedUserId = localStorage.getItem(selectedUserStorageKey);
    return demoUsers.find((user) => user.id === storedUserId) ?? null;
  } catch {
    return null;
  }
}

function getContactFor(user: DemoUser): DemoUser {
  return demoUsers.find((candidate) => candidate.id !== user.id) ?? demoUsers[0];
}

function updateMessage(
  messages: Message[],
  id: string,
  update: Partial<Message>,
): Message[] {
  return messages.map((message) =>
    message.id === id ? { ...message, ...update } : message,
  );
}

function upsertMessage(messages: Message[], incoming: Message): Message[] {
  return messages.some((message) => message.id === incoming.id)
    ? updateMessage(messages, incoming.id, incoming)
    : [...messages, incoming];
}

function mergeHistoryAndRealtime(
  history: Message[],
  realtimeMessages: Message[],
): Message[] {
  return realtimeMessages.reduce(upsertMessage, history);
}

async function postGraphQL<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T | undefined> {
  const response = await fetch(graphqlUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const result = (await response.json()) as { data?: T };
  return result.data;
}

async function getConversationReadState(userId: string) {
  const data = await postGraphQL<{
    conversationReadState: ConversationReadState;
  }>(
    `
      query ConversationReadState($userId: ID!, $conversationId: ID!) {
        conversationReadState(userId: $userId, conversationId: $conversationId) {
          conversationId
          lastReadMessageId
          latestMessageId
          unreadCount
        }
      }
    `,
    { userId, conversationId: currentConversationId },
  );
  return data?.conversationReadState;
}

async function getMessages(): Promise<Message[]> {
  const data = await postGraphQL<{ messages: Message[] }>(
    `
      query Messages($conversationId: ID!) {
        messages(conversationId: $conversationId) {
          id
          conversationId
          senderId
          content
          status
          replyToMessageId
          replyTo {
            id
            content
          }
        }
      }
    `,
    { conversationId: currentConversationId },
  );
  return data?.messages ?? [];
}

async function markConversationRead(
  userId: string,
  lastReadMessageId: string,
) {
  const data = await postGraphQL<{
    markConversationRead: ConversationReadState;
  }>(
    `
      mutation MarkConversationRead(
        $userId: ID!
        $conversationId: ID!
        $lastReadMessageId: ID!
      ) {
        markConversationRead(
          userId: $userId
          conversationId: $conversationId
          lastReadMessageId: $lastReadMessageId
        ) {
          conversationId
          lastReadMessageId
          latestMessageId
          unreadCount
        }
      }
    `,
    {
      userId,
      conversationId: currentConversationId,
      lastReadMessageId,
    },
  );
  return data?.markConversationRead;
}

async function sendMessage(message: Message) {
  const data = await postGraphQL<{ sendMessage: Message }>(
    `
      mutation SendMessage(
        $id: ID!
        $conversationId: ID!
        $senderId: ID!
        $content: String!
        $replyToMessageId: ID
      ) {
        sendMessage(
          id: $id
          conversationId: $conversationId
          senderId: $senderId
          content: $content
          replyToMessageId: $replyToMessageId
        ) {
          id
          conversationId
          senderId
          content
          status
          replyToMessageId
          replyTo {
            id
            content
          }
        }
      }
    `,
    {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      content: message.content,
      replyToMessageId: message.replyToMessageId ?? null,
    },
  );
  return data?.sendMessage;
}

export default App;
