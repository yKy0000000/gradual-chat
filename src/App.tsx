import { useEffect, useState } from "react";

import "./App.css";
import { socket } from "./socket";

type Message = {
  id: string;
  content: string;
  status: "sending" | "sent" | "failed";
};

type SendMessageResponse = {
  data?: {
    sendMessage?: Message;
  };
};

const conversations = [
  {
    initials: "AN",
    name: "Announcements",
    preview: "Jerry: [File] Design Guideline.pdf",
    time: "20:34",
    unread: 3,
    tone: "amber",
  },
  {
    initials: "SY",
    name: "Share your story",
    preview: "Allen: [Photo]",
    time: "20:34",
    unread: 6,
    tone: "violet",
    active: true,
  },
  {
    initials: "GE",
    name: "General",
    preview: "Tim: If you want to learn more…",
    time: "20:34",
    tone: "slate",
  },
  {
    initials: "CH",
    name: "Courtney Henry",
    preview: "So, what's your plan this weekend?",
    time: "20:34",
    tone: "rose",
  },
  {
    initials: "AF",
    name: "Albert Flores",
    preview: "What's the progress on that task?",
    time: "20:34",
    tone: "blue",
  },
  {
    initials: "DR",
    name: "Darlene Robertson",
    preview: "Yeah! You're right.",
    time: "20:34",
    tone: "green",
  },
  {
    initials: "DP",
    name: "Design product",
    preview: "Eric: Yeah I know 🙂",
    time: "20:34",
    tone: "orange",
  },
  {
    initials: "PT",
    name: "Product team",
    preview: "Grace: Have time to huddle?",
    time: "20:34",
    tone: "indigo",
  },
];

function updateMessageStatus(
  messages: Message[],
  id: string,
  status: Message["status"],
): Message[] {
  return messages.map((message) =>
    message.id === id ? { ...message, status } : message,
  );
}

function App() {
  const [inputText, setInputText] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [ownMessageIds, setOwnMessageIds] = useState(
    () => new Set<string>(),
  );

  useEffect(() => {
    const handleMessageCreated = (socketMessage: Message) => {
      setMessages((previousMessages) => {
        const messageExists = previousMessages.some(
          (message) => message.id === socketMessage.id,
        );

        // The sender already has an optimistic copy, so update it in place.
        if (messageExists) {
          return updateMessageStatus(
            previousMessages,
            socketMessage.id,
            "sent",
          );
        }

        return [...previousMessages, { ...socketMessage, status: "sent" }];
      });
    };

    socket.connect();
    socket.on("messageCreated", handleMessageCreated);

    return () => {
      socket.off("messageCreated", handleMessageCreated);
      socket.disconnect();
    };
  }, []);

  const handleSend = async () => {
    const newMessage: Message = {
      id: crypto.randomUUID(),
      content: inputText,
      status: "sending",
    };

    setOwnMessageIds((previousIds) => {
      const nextIds = new Set(previousIds);
      nextIds.add(newMessage.id);
      return nextIds;
    });
    setMessages((previousMessages) => [...previousMessages, newMessage]);
    setInputText("");

    try {
      const response = await fetch("http://localhost:4000/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: `
            mutation SendMessage($id: ID!, $content: String!) {
              sendMessage(id: $id, content: $content) {
                id
                content
                status
              }
            }
          `,
          variables: {
            id: newMessage.id,
            content: newMessage.content,
          },
        }),
      });
      const result = (await response.json()) as SendMessageResponse;
      const status = result.data?.sendMessage ? "sent" : "failed";

      setMessages((previousMessages) =>
        updateMessageStatus(previousMessages, newMessage.id, status),
      );
    } catch {
      setMessages((previousMessages) =>
        updateMessageStatus(previousMessages, newMessage.id, "failed"),
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
          <span className="brand-name">Gradual Community</span>
        </div>

        <div className="global-tools" aria-label="Community tools">
          <div className="global-search">
            <span aria-hidden="true">⌕</span>
            <span>Search</span>
          </div>
          <span className="timezone">◎ UTC −05:00 Chicago</span>
          <span className="tool-icon" aria-label="Notifications">
            ♢
          </span>
          <span className="tool-icon" aria-label="Help">
            ?
          </span>
          <span className="profile-avatar" aria-label="Your profile">
            YU
          </span>
        </div>
      </header>

      <div className="workspace">
        <aside className="primary-sidebar" aria-label="Primary navigation">
          <nav>
            <p className="nav-section-label">Engage</p>
            <a className="nav-item" href="#forum">
              <span className="nav-icon nav-icon-forum" aria-hidden="true">
                ●
              </span>
              <span>Forum</span>
            </a>
            <a className="nav-item nav-item-active" href="#chat">
              <span className="nav-icon nav-icon-chat" aria-hidden="true">
                ◒
              </span>
              <span>Chat</span>
              <span className="nav-badge">25</span>
            </a>
            <a className="nav-item" href="#matches">
              <span className="nav-icon nav-icon-matches" aria-hidden="true">
                ◆
              </span>
              <span>Matches</span>
            </a>

            <div className="nav-divider" />

            <p className="nav-section-label">People</p>
            <a className="nav-item" href="#members">
              <span className="nav-icon nav-icon-members" aria-hidden="true">
                ▣
              </span>
              <span>Members</span>
            </a>
            <a className="nav-item" href="#contributors">
              <span className="nav-icon nav-icon-contributors" aria-hidden="true">
                ♟
              </span>
              <span>Contributors</span>
            </a>
          </nav>

          <div className="powered-by">
            <span className="powered-mark">◈</span>
            <span>
              Powered by <strong>Gradual</strong>
            </span>
          </div>
        </aside>

        <aside className="conversation-sidebar" aria-label="Conversations">
          <div className="conversation-search">
            <span aria-hidden="true">⌕</span>
            <span>Search conversations</span>
          </div>

          <div className="conversation-list">
            {conversations.map((conversation) => (
              <div
                className={`conversation-item${
                  conversation.active ? " conversation-item-active" : ""
                }`}
                key={conversation.name}
              >
                <span
                  className={`conversation-avatar avatar-${conversation.tone}`}
                >
                  {conversation.initials}
                </span>
                <span className="conversation-copy">
                  <span className="conversation-name">{conversation.name}</span>
                  <span className="conversation-preview">
                    {conversation.preview}
                  </span>
                </span>
                <span className="conversation-meta">
                  <span>{conversation.time}</span>
                  {conversation.unread ? (
                    <span className="unread-badge">{conversation.unread}</span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        </aside>

        <main className="chat-panel" id="chat">
          <header className="chat-header">
            <div>
              <p className="eyebrow">Community chat</p>
              <h1>Share Your Story</h1>
            </div>
            <div className="member-summary">
              <span className="mini-avatar mini-avatar-one">DL</span>
              <span className="mini-avatar mini-avatar-two">JW</span>
              <span className="member-count">♙ 4 members</span>
            </div>
          </header>

          <section className="message-feed" aria-live="polite">
            {messages.length === 0 ? (
              <div className="empty-chat">
                <span className="empty-chat-mark" aria-hidden="true">
                  ✦
                </span>
                <h2>Share something with the community</h2>
                <p>Your messages will appear here in real time.</p>
              </div>
            ) : (
              messages.map((message) => {
                const isOwnMessage = ownMessageIds.has(message.id);

                return (
                  <article
                    className={`message-row ${
                      isOwnMessage ? "message-own" : "message-received"
                    }`}
                    key={message.id}
                  >
                    {!isOwnMessage ? (
                      <span className="message-avatar">DL</span>
                    ) : null}
                    <div className="message-content">
                      <div className="message-meta">
                        <span>{isOwnMessage ? "You" : "Community member"}</span>
                        <span>now</span>
                      </div>
                      <div className="message-bubble">{message.content}</div>
                      <span
                        className={`message-status status-${message.status}`}
                      >
                        {message.status === "sending"
                          ? "Sending…"
                          : message.status === "failed"
                            ? "Failed to send"
                            : "Sent"}
                      </span>
                    </div>
                    {isOwnMessage ? (
                      <span className="message-avatar message-avatar-own">YU</span>
                    ) : null}
                  </article>
                );
              })
            )}
          </section>

          <footer className="composer-wrap">
            <div className="composer">
              <span className="composer-plus" aria-hidden="true">
                +
              </span>
              <input
                aria-label="Message"
                placeholder="Write a message…"
                value={inputText}
                onChange={(event) => {
                  setInputText(event.target.value);
                }}
              />
              <span className="composer-emoji" aria-hidden="true">
                ☺
              </span>
              <button type="button" onClick={handleSend}>
                Send <span aria-hidden="true">↗</span>
              </button>
            </div>
            <p className="composer-hint">Messages sync instantly with the community</p>
          </footer>
        </main>
      </div>
    </div>
  );
}

export default App;
