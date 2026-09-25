import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

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
  createdAt?: string;
  mentionedUserIds?: string[];
  status: "sending" | "sent" | "failed";
  replyToMessageId?: string | null;
  replyTo: ReplyTarget | null;
};

type ConversationReadState = {
  conversationId: string;
  lastReadMessageId: string | null;
  latestMessageId: string | null;
  latestMessage: LatestMessage | null;
  unreadCount: number;
  hiddenMessageIds: string[];
};

type LatestMessage = Pick<Message, "id" | "senderId" | "content" | "createdAt">;

const demoUsers: DemoUser[] = [
  { id: "demo-user-a", name: "User A", initials: "UA" },
  { id: "demo-user-b", name: "User B", initials: "UB" },
];
const currentConversationId = "share-your-story";
const selectedUserStorageKey = "gradual-chat-demo-user";
const activeConversationStorageKey = "gradual-chat-open-conversation";
const graphqlUrl = `${import.meta.env.VITE_SOCKET_URL ?? "http://localhost:4000"}/graphql`;
const maxMessageLength = 2000;
type HistoryStatus = "idle" | "loading" | "ready" | "error";

function App() {
  const [selectedUser, setSelectedUser] = useState<DemoUser | null>(
    getSavedUser,
  );
  const [activeConversation, setActiveConversation] = useState<string | null>(
    getSavedConversation,
  );
  const [inputText, setInputText] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [latestMessage, setLatestMessage] = useState<LatestMessage | null>(null);
  const [replyingTo, setReplyingTo] = useState<ReplyTarget | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>("idle");
  const [validationError, setValidationError] = useState("");
  const [cursorPosition, setCursorPosition] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [readError, setReadError] = useState(false);
  const [readStateError, setReadStateError] = useState(false);
  const [hiddenMessageIds, setHiddenMessageIds] = useState<string[]>([]);
  const [hideError, setHideError] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const avatarButtonRef = useRef<HTMLButtonElement>(null);
  const userOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionRef = useRef(0);
  const activeConversationRef = useRef(activeConversation === currentConversationId);
  const historyRequestRef = useRef(0);
  const submissionLockRef = useRef(false);
  const seenMessageIdsRef = useRef(new Set<string>());
  const unreadRefreshRef = useRef(0);
  const connectionTrackerRef = useRef({
    seenOnline: socket.connected,
    wasConnected: socket.connected,
  });
  const contact = selectedUser ? getContactFor(selectedUser) : null;
  const mentionMatch = mentionDismissed
    ? null
    : getMentionQuery(inputText, cursorPosition);
  const mentionSuggestions = mentionMatch && contact &&
    contact.name.toLowerCase().startsWith(mentionMatch.query.toLowerCase())
      ? [contact]
      : [];
  const conversationLatestMessage = messages
    .filter((message) => message.status !== "failed" && !hiddenMessageIds.includes(message.id))
    .reduce<LatestMessage | null>((current, message) => chooseLatestMessage(current, message, true),
      latestMessage && !hiddenMessageIds.includes(latestMessage.id) ? latestMessage : null);

  useEffect(() => {
    if (!isUserMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!userMenuRef.current?.contains(event.target as Node)) setIsUserMenuOpen(false);
    };
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsUserMenuOpen(false);
        avatarButtonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    userOptionRefs.current[demoUsers.findIndex((user) => user.id === selectedUser?.id)]?.focus();
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, [isUserMenuOpen, selectedUser]);

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
          setLatestMessage((current) => chooseLatestMessage(current, readState.latestMessage));
          setHiddenMessageIds((current) => [...new Set([...current, ...(readState.hiddenMessageIds ?? [])])]);
          if (!activeConversationRef.current) {
            setUnreadCount((count) => Math.max(count, readState.unreadCount));
          }
          setReadStateError(false);
        } else if (isCurrent && !readState) {
          setReadStateError(true);
        }
      })
      .catch(() => {
        if (isCurrent) setReadStateError(true);
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
    const effectSession = sessionRef.current;

    const updateReadPosition = (lastReadMessageId: string) => {
      readUpdateQueue = readUpdateQueue.then(async () => {
        try {
          const readState = await markConversationRead(
            selectedUser.id,
            lastReadMessageId,
          );

          if (isCurrent && effectSession === sessionRef.current && readState) {
            setUnreadCount(readState.unreadCount);
            setReadError(false);
            setReadStateError(false);
          }
        } catch {
          if (isCurrent && effectSession === sessionRef.current) {
            setReadError(true);
          }
        }
      });

      return readUpdateQueue;
    };

    const handleMessageCreated = (socketMessage: Message) => {
      if (
        effectSession !== sessionRef.current ||
        socketMessage.conversationId !== currentConversationId
      ) {
        return;
      }

      setLatestMessage((current) => chooseLatestMessage(current, socketMessage, true));

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
        if (seenMessageIdsRef.current.has(socketMessage.id)) return;
        seenMessageIdsRef.current.add(socketMessage.id);
        setUnreadCount((count) => count + 1);
        const refresh = ++unreadRefreshRef.current;
        void getConversationReadState(selectedUser.id)
          .then((state) => {
            if (
              isCurrent &&
              effectSession === sessionRef.current &&
              !activeConversationRef.current &&
              refresh === unreadRefreshRef.current &&
              state
            ) {
              setUnreadCount(state.unreadCount);
              setLatestMessage((current) => chooseLatestMessage(current, state.latestMessage));
              setHiddenMessageIds((current) => [...new Set([...current, ...(state.hiddenMessageIds ?? [])])]);
              setReadStateError(false);
            }
          })
          .catch(() => {
            if (isCurrent && effectSession === sessionRef.current) {
              setReadStateError(true);
            }
          });
      }
    };

    socket.on("messageCreated", handleMessageCreated);

    return () => {
      isCurrent = false;
      socket.off("messageCreated", handleMessageCreated);
    };
  }, [activeConversation, selectedUser]);

  const handleSelectUser = (user: DemoUser) => {
    try {
      sessionStorage.setItem(selectedUserStorageKey, user.id);
    } catch {
      // The demo remains usable when storage is unavailable.
    }
    sessionRef.current += 1;
    seenMessageIdsRef.current.clear();
    unreadRefreshRef.current += 1;
    setSelectedUser(user);
    setIsUserMenuOpen(false);
    resetConversationState();
  };

  const resetConversationState = () => {
    activeConversationRef.current = false;
    historyRequestRef.current += 1;
    setActiveConversation(null);
    setMessages([]);
    setLatestMessage(null);
    setHiddenMessageIds([]);
    setHideError(false);
    setReplyingTo(null);
    setInputText("");
    setUnreadCount(0);
    setHistoryStatus("idle");
    setReadError(false);
    setReadStateError(false);
    setValidationError("");
    setMentionDismissed(false);
    submissionLockRef.current = false;
  };

  const loadConversation = useCallback(async (user: DemoUser) => {
    const requestId = ++historyRequestRef.current;
    const session = sessionRef.current;
    setHistoryStatus("loading");

    try {
      const history = await getMessages(user.id);
      if (session !== sessionRef.current || requestId !== historyRequestRef.current) {
        return;
      }
      setMessages((realtimeMessages) =>
        mergeHistoryAndRealtime(history, realtimeMessages),
      );
      setLatestMessage((current) => chooseLatestMessage(current, history.at(-1) ?? null));
      setHistoryStatus("ready");

      const latestMessage = history.at(-1);
      if (latestMessage) {
        try {
          const readState = await markConversationRead(user.id, latestMessage.id);
          if (session === sessionRef.current && requestId === historyRequestRef.current && readState) {
            setUnreadCount(readState.unreadCount);
            setReadError(false);
            setReadStateError(false);
          }
        } catch {
          if (session === sessionRef.current) setReadError(true);
        }
      } else {
        setUnreadCount(0);
      }
    } catch {
      if (session === sessionRef.current && requestId === historyRequestRef.current) {
        setHistoryStatus("error");
      }
    }
  }, []);

  useEffect(() => {
    if (selectedUser && activeConversation === currentConversationId && historyStatus === "idle") {
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) void loadConversation(selectedUser);
      });
      return () => { cancelled = true; };
    }
  }, [activeConversation, historyStatus, loadConversation, selectedUser]);

  useEffect(() => {
    const tracker = connectionTrackerRef.current;
    const reconnected = isConnected && tracker.seenOnline && !tracker.wasConnected;
    if (isConnected) tracker.seenOnline = true;
    tracker.wasConnected = isConnected;
    if (!reconnected || !selectedUser) return;

    const session = sessionRef.current;
    queueMicrotask(() => {
      if (session !== sessionRef.current) return;
      if (activeConversationRef.current) {
        void loadConversation(selectedUser);
      } else {
        void getConversationReadState(selectedUser.id)
          .then((state) => {
            if (session !== sessionRef.current) return;
            if (state) {
              setUnreadCount(state.unreadCount);
              setLatestMessage((current) => chooseLatestMessage(current, state.latestMessage));
              setHiddenMessageIds((current) => [...new Set([...current, ...(state.hiddenMessageIds ?? [])])]);
              setReadStateError(false);
            }
          })
          .catch(() => {
            if (session === sessionRef.current) setReadStateError(true);
          });
      }
    });
  }, [isConnected, loadConversation, selectedUser]);

  const handleOpenConversation = () => {
    if (!selectedUser) {
      return;
    }
    if (activeConversationRef.current) return;
    activeConversationRef.current = true;
    try {
      sessionStorage.setItem(activeConversationStorageKey, currentConversationId);
    } catch {
      // The conversation still opens when storage is unavailable.
    }
    setActiveConversation(currentConversationId);
    setReplyingTo(null);
    void loadConversation(selectedUser);
  };

  const persistMessage = async (message: Message, session: number) => {
    try {
      const sentMessage = await sendMessage(message);
      if (session !== sessionRef.current) return;
      setMessages((previousMessages) =>
        upsertMessage(previousMessages, { ...message, ...sentMessage, status: "sent" }),
      );
      setLatestMessage((current) => chooseLatestMessage(current, sentMessage, true));
    } catch {
      if (session !== sessionRef.current) return;
      setMessages((previousMessages) =>
        previousMessages.map((candidate) =>
          candidate.id === message.id && candidate.status !== "sent"
            ? { ...candidate, status: "failed" }
            : candidate,
        ),
      );
    }
  };

  const handleSend = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedUser || activeConversation !== currentConversationId) {
      return;
    }
    if (submissionLockRef.current) return;

    const content = inputText.trim();
    if (!content) {
      setValidationError("Enter a message before sending.");
      inputRef.current?.focus();
      return;
    }
    if (content.length > maxMessageLength) {
      setValidationError(`Keep messages under ${maxMessageLength} characters.`);
      return;
    }
    submissionLockRef.current = true;

    const replyTarget = replyingTo;
    const newMessage: Message = {
      id: crypto.randomUUID(),
      conversationId: currentConversationId,
      senderId: selectedUser.id,
      content,
      createdAt: new Date().toISOString(),
      mentionedUserIds: getMentionedUserIds(content),
      status: "sending",
      replyToMessageId: replyTarget?.id ?? null,
      replyTo: replyTarget,
    };

    setMessages((previousMessages) => [...previousMessages, newMessage]);
    setInputText("");
    setCursorPosition(0);
    setValidationError("");
    setReplyingTo(null);
    void persistMessage(newMessage, sessionRef.current);
  };

  const handleRetrySend = (message: Message) => {
    setMessages((previousMessages) =>
      updateMessage(previousMessages, message.id, { status: "sending" }),
    );
    void persistMessage(message, sessionRef.current);
  };

  const handleHideMessage = async (message: Message) => {
    if (!selectedUser || message.senderId !== selectedUser.id || message.status !== "sent") return;
    const session = sessionRef.current;
    setHideError(false);
    try {
      const readState = await hideMessageForMe(selectedUser.id, message.id);
      if (session !== sessionRef.current) return;
      setHiddenMessageIds((current) => [...new Set([...current, ...(readState.hiddenMessageIds ?? []), message.id])]);
      setLatestMessage(readState.latestMessage);
      setReplyingTo((current) => current?.id === message.id ? null : current);
    } catch {
      if (session === sessionRef.current) setHideError(true);
    }
  };

  const handleUserMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = userOptionRefs.current.findIndex((option) => option === document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = (currentIndex + (event.key === "ArrowDown" ? 1 : -1) + demoUsers.length) % demoUsers.length;
      userOptionRefs.current[next]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      userOptionRefs.current[event.key === "Home" ? 0 : demoUsers.length - 1]?.focus();
    }
  };

  const selectMention = (user: DemoUser) => {
    if (!mentionMatch) return;
    const before = inputText.slice(0, mentionMatch.start);
    const after = inputText.slice(cursorPosition);
    const insertion = `@${user.name} `;
    const nextCursor = before.length + insertion.length;
    setInputText(before + insertion + after);
    setCursorPosition(nextCursor);
    setMentionDismissed(true);
    setValidationError("");
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      if (event.key === "Enter") event.preventDefault();
      return;
    }
    if (event.key === "Escape" && mentionSuggestions.length) {
      event.preventDefault();
      setMentionDismissed(true);
    } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && mentionSuggestions.length) {
      event.preventDefault();
      setActiveMentionIndex((index) =>
        (index + (event.key === "ArrowDown" ? 1 : -1) + mentionSuggestions.length) % mentionSuggestions.length,
      );
    } else if (event.key === "Enter" && mentionSuggestions.length) {
      event.preventDefault();
      selectMention(mentionSuggestions[activeMentionIndex] ?? mentionSuggestions[0]);
    }
  };

  return (
    <div className="community-app">
      <header className="global-header">
        <div className="brand">
          <img className="brand-mark" src="/gradual-green-icon.png" alt="" />
          <span className="brand-name">Gradual Community</span>
        </div>

        <div className="global-tools">
          <div className="global-reference-tools" aria-hidden="true">
            <span className="global-search"><span className="search-glyph" />Search</span>
            <span className="timezone"><span className="globe-glyph">⊕</span>{formatTimeZone()}</span>
            <span className="header-glyph"><svg viewBox="0 0 20 20" fill="none"><path d="M5 14h10l-1.5-2V8a3.5 3.5 0 0 0-7 0v4L5 14Zm3.4 2h3.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
            <span className="header-glyph"><svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.3" /><path d="M8.2 7.5a2 2 0 1 1 3 1.8c-.9.5-1.2.9-1.2 1.8M10 13.8h.01" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg></span>
          </div>
          <span
            className={`connection-status ${
              isConnected ? "connection-online" : "connection-offline"
            }`}
          >
            <span aria-hidden="true" />
            {isConnected ? "Connected" : "Disconnected"}
          </span>
          <div className="user-menu-anchor" ref={userMenuRef} onKeyDown={handleUserMenuKeyDown}>
            <button
              ref={avatarButtonRef}
              className="profile-avatar avatar-trigger"
              type="button"
              aria-label="Switch user"
              aria-haspopup="menu"
              aria-expanded={isUserMenuOpen}
              onClick={() => setIsUserMenuOpen((open) => !open)}
            >{selectedUser?.initials ?? "G"}</button>
            {isUserMenuOpen ? (
              <div className="user-menu" role="menu" aria-label="Choose user">
                {demoUsers.map((user, index) => (
                  <button
                    key={user.id}
                    ref={(element) => { userOptionRefs.current[index] = element; }}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selectedUser?.id === user.id}
                    onClick={() => {
                      if (selectedUser?.id === user.id) setIsUserMenuOpen(false);
                      else handleSelectUser(user);
                      avatarButtonRef.current?.focus();
                    }}
                  >
                    <span className="conversation-avatar avatar-violet">{user.initials}</span>
                    {user.name}
                    <span className="user-menu-check" aria-hidden="true">{selectedUser?.id === user.id ? "✓" : ""}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
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
          <aside className="primary-sidebar" aria-label="Community navigation">
            <div className="primary-nav">
              <p className="nav-section-label">Engage</p>
              <span className="nav-item"><span className="nav-icon nav-icon-forum" aria-hidden="true">●</span>Forum</span>
              <a className="nav-item nav-item-active" href="#chat"><span className="nav-icon nav-icon-chat" aria-hidden="true">◒</span>Chat</a>
              <span className="nav-item"><span className="nav-icon nav-icon-matches" aria-hidden="true">◆</span>Matches</span>
              <div className="nav-divider" />
              <p className="nav-section-label">People</p>
              <span className="nav-item"><span className="nav-icon nav-icon-members" aria-hidden="true">▣</span>Members</span>
              <span className="nav-item"><span className="nav-icon nav-icon-contributors" aria-hidden="true">✦</span>Contributors</span>
            </div>
            <span className="powered-by">Gradual Community</span>
          </aside>
          <aside className="conversation-sidebar" aria-label="Contacts">
            <div className="conversation-search" aria-hidden="true">
              <span className="search-glyph" />Search
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
                <span className="conversation-avatar avatar-violet">{contact.initials}</span>
                <span className="conversation-copy">
                   <span className="conversation-name">{contact.name}</span>
                  <span className="conversation-preview">
                    {conversationLatestMessage
                      ? `${conversationLatestMessage.senderId === selectedUser.id ? "You" : contact.name}: ${conversationLatestMessage.content.replace(/\s+/g, " ").trim()}`
                      : readStateError ? "Preview unavailable" : "Start the conversation"}
                  </span>
                </span>
                <span className="conversation-meta">
                  {conversationLatestMessage?.createdAt ? (
                    <time dateTime={conversationLatestMessage.createdAt} title={formatFullTime(conversationLatestMessage.createdAt)}>
                      {formatConversationTime(conversationLatestMessage.createdAt)}
                    </time>
                  ) : null}
                  {unreadCount > 0 ? <span className="unread-badge">{unreadCount}</span> : null}
                </span>
              </button>
            ) : null}
          </aside>

          {activeConversation && contact ? (
            <main className="chat-panel" id="chat">
              <header className="chat-header">
                 <h1>{contact.name}</h1>
                <span className="member-count" aria-label="2 participants"><svg aria-hidden="true" viewBox="0 0 20 20" fill="none"><circle cx="7" cy="7" r="2.1" stroke="currentColor" strokeWidth="1.4" /><circle cx="14" cy="7.5" r="1.7" stroke="currentColor" strokeWidth="1.3" /><path d="M2.7 15c.4-2.4 1.9-3.5 4.3-3.5s3.9 1.1 4.3 3.5H2.7Zm9.8-3.1c2.5-.4 4.2.8 4.6 3.1h-3.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg> 2</span>
              </header>

               {readError ? <div className="read-error" role="status">Could not update unread count. It will retry on the next message.</div> : null}
               {hideError ? <div className="read-error" role="alert">Could not hide the message. Please try again.</div> : null}
               <MessageFeed
                 messages={messages.filter((message) => !hiddenMessageIds.includes(message.id))}
                 hiddenMessageIds={hiddenMessageIds}
                 selectedUser={selectedUser}
                 onReply={setReplyingTo}
                 onHide={handleHideMessage}
                onRetrySend={handleRetrySend}
                historyStatus={historyStatus}
                onRetryHistory={() => void loadConversation(selectedUser)}
              />

              <footer className="composer-wrap">
                {mentionSuggestions.length > 0 ? (
                  <div className="mention-menu" id="mention-options" role="listbox" aria-label="Mention a user">
                    {mentionSuggestions.map((user, index) => (
                      <button
                        id={`mention-option-${user.id}`}
                        key={user.id}
                        type="button"
                        role="option"
                        aria-selected={index === activeMentionIndex}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectMention(user)}
                      >
                        <span className="conversation-avatar avatar-violet">{user.initials}</span>
                        {user.name}
                      </button>
                    ))}
                  </div>
                ) : null}
                <form className="composer" onSubmit={handleSend}>
                  <div className="composer-toolbar" aria-hidden="true">
                    <span><strong>B</strong></span><span><em>I</em></span><span>≡</span><span>☷</span><span>☺</span><span>▱</span><span>@</span>
                  </div>
                  <div className="composer-entry">
                    <input
                    ref={inputRef}
                    aria-label="Message"
                    aria-invalid={Boolean(validationError)}
                    aria-describedby={validationError ? "composer-error" : undefined}
                    aria-controls={mentionSuggestions.length ? "mention-options" : undefined}
                    aria-expanded={mentionSuggestions.length > 0}
                    aria-activedescendant={mentionSuggestions.length ? `mention-option-${(mentionSuggestions[activeMentionIndex] ?? mentionSuggestions[0]).id}` : undefined}
                    placeholder="Write a message…"
                    autoComplete="off"
                    maxLength={maxMessageLength}
                    value={inputText}
                    onChange={(event) => {
                      submissionLockRef.current = false;
                      setInputText(event.target.value);
                      setCursorPosition(event.target.selectionStart ?? event.target.value.length);
                      setMentionDismissed(false);
                      setActiveMentionIndex(0);
                      setValidationError("");
                    }}
                    onPaste={(event) => {
                      const selectedLength =
                        (event.currentTarget.selectionEnd ?? 0) -
                        (event.currentTarget.selectionStart ?? 0);
                      const pastedLength = event.clipboardData.getData("text").length;
                      if (inputText.length - selectedLength + pastedLength > maxMessageLength) {
                        event.preventDefault();
                        setValidationError(`Keep messages under ${maxMessageLength} characters.`);
                      }
                    }}
                    onClick={(event) => setCursorPosition(event.currentTarget.selectionStart ?? inputText.length)}
                    onKeyUp={(event) => setCursorPosition(event.currentTarget.selectionStart ?? inputText.length)}
                    onKeyDown={handleComposerKeyDown}
                    />
                    <button type="submit" aria-label="Send" className={inputText.trim() ? "send-ready" : ""}>
                      <span aria-hidden="true">➤</span>
                    </button>
                  </div>
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
                      >×</button>
                    </div>
                  ) : null}
                </form>
                {validationError ? <p className="composer-error" id="composer-error" role="alert">{validationError}</p> : null}
                <p className="composer-hint">
                  {inputText.length >= maxMessageLength - 100
                    ? `${inputText.length}/${maxMessageLength} characters`
                    : `Enter to send · Type @ to mention ${contact.name}`}
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
  hiddenMessageIds,
  selectedUser,
  onReply,
  onHide,
  onRetrySend,
  historyStatus,
  onRetryHistory,
}: {
  messages: Message[];
  hiddenMessageIds: string[];
  selectedUser: DemoUser;
  onReply: (message: ReplyTarget) => void;
  onHide: (message: Message) => void;
  onRetrySend: (message: Message) => void;
  historyStatus: HistoryStatus;
  onRetryHistory: () => void;
}) {
  const feedRef = useRef<HTMLElement>(null);
  const previousCountRef = useRef(0);

  useEffect(() => {
    const feed = feedRef.current;
    if (feed && messages.length > previousCountRef.current) {
      const distanceFromBottom = feed.scrollHeight - feed.clientHeight - feed.scrollTop;
      if (previousCountRef.current === 0 || distanceFromBottom < 140) {
        feed.scrollTop = feed.scrollHeight;
      }
    }
    previousCountRef.current = messages.length;
  }, [messages]);

  return (
    <section className="message-feed" aria-live="polite" aria-label="Messages" ref={feedRef}>
      {historyStatus === "loading" ? (
        <div className="feed-notice" role="status">Loading messages…</div>
      ) : null}
      {historyStatus === "error" ? (
        <div className="feed-error" role="alert">
          <span>Could not load message history.</span>
          <button type="button" onClick={onRetryHistory}>Retry loading</button>
        </div>
      ) : null}
      {messages.length === 0 && historyStatus === "ready" ? (
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
              tabIndex={0}
              aria-label={`${isOwnMessage ? "You" : getContactFor(selectedUser).name}: ${message.content}`}
            >
              {!isOwnMessage ? (
                <span className="message-avatar">
                  {getContactFor(selectedUser).initials}
                </span>
              ) : null}
              <div className="message-content">
                <div className="message-meta">
                  <span>{isOwnMessage ? "You" : getContactFor(selectedUser).name}</span>
                  <time dateTime={message.createdAt} title={formatFullTime(message.createdAt)}>
                    {formatMessageTime(message.createdAt)}
                  </time>
                </div>
                <div className="message-bubble">
                  {message.replyToMessageId ? (
                    <div className="quoted-message">
                      <span>Replying to</span>
                      <p>{hiddenMessageIds.includes(message.replyToMessageId) || !message.replyTo
                        ? "Message hidden"
                        : renderMessageContent(message.replyTo.content, getMentionedUserIds(message.replyTo.content))}</p>
                    </div>
                  ) : null}
                  <span>{renderMessageContent(message.content, message.mentionedUserIds ?? getMentionedUserIds(message.content))}</span>
                </div>
                <div className="message-actions">
                  {isOwnMessage ? <span className={`message-status status-${message.status}`} role="status">
                    {message.status === "sending"
                      ? "Sending…"
                      : message.status === "failed"
                        ? "Failed to send"
                        : "Sent"}
                  </span> : null}
                  {isOwnMessage && message.status === "failed" ? (
                    <button className="reply-button" type="button" onClick={() => onRetrySend(message)}>Retry send</button>
                  ) : null}
                  {message.status === "sent" ? (
                    <button
                      className="message-action-button"
                      type="button"
                      aria-label={`Quote message: ${message.content}`}
                      onClick={() =>
                        onReply({ id: message.id, content: message.content })
                      }
                    >
                      Quote
                    </button>
                  ) : null}
                  {isOwnMessage && message.status === "sent" ? (
                    <button className="message-action-button" type="button" onClick={() => onHide(message)}>
                      Hide for me
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
    const storedUserId = sessionStorage.getItem(selectedUserStorageKey);
    return demoUsers.find((user) => user.id === storedUserId) ?? null;
  } catch {
    return null;
  }
}

function getSavedConversation(): string | null {
  if (!getSavedUser()) return null;
  try {
    return sessionStorage.getItem(activeConversationStorageKey) === currentConversationId
      ? currentConversationId
      : null;
  } catch {
    return null;
  }
}

function getMentionQuery(text: string, cursor: number): { start: number; query: string } | null {
  const prefix = text.slice(0, cursor);
  const match = /(^|\s)@([^@]*)$/.exec(prefix);
  if (!match || match[2].length > 20) return null;
  return { start: prefix.length - match[2].length - 1, query: match[2] };
}

function getMentionedUserIds(content: string): string[] {
  const ids = new Set<string>();
  for (const match of content.matchAll(/(^|\s)@User ([AB])(?=$|[\s.,!?;:])/g)) {
    ids.add(match[2] === "A" ? "demo-user-a" : "demo-user-b");
  }
  return [...ids];
}

function renderMessageContent(content: string, mentionedUserIds: string[]) {
  const parts = [];
  let position = 0;
  for (const match of content.matchAll(/(^|\s)(@User ([AB]))(?=$|[\s.,!?;:])/g)) {
    const start = match.index + match[1].length;
    const end = start + match[2].length;
    const id = match[3] === "A" ? "demo-user-a" : "demo-user-b";
    if (!mentionedUserIds.includes(id)) continue;
    parts.push(content.slice(position, start));
    parts.push(<strong className="message-mention" key={`${start}-${id}`}>{match[2]}</strong>);
    position = end;
  }
  parts.push(content.slice(position));
  return parts;
}

function formatMessageTime(value?: string): string {
  if (!value || Number.isNaN(Date.parse(value))) return "Time unavailable";
  const date = new Date(value);
  const today = new Date();
  const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
  if (date.toDateString() === today.toDateString()) return time;
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatConversationTime(value?: string): string {
  return value && !Number.isNaN(Date.parse(value))
    ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(value))
    : "";
}

function formatTimeZone(): string {
  const offset = -new Date().getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "−";
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
  const minutes = String(Math.abs(offset) % 60).padStart(2, "0");
  const location = Intl.DateTimeFormat().resolvedOptions().timeZone.split("/").at(-1)?.replaceAll("_", " ") ?? "Local";
  return `UTC ${sign}${hours}:${minutes} ${location}`;
}

function formatFullTime(value?: string): string {
  return value && !Number.isNaN(Date.parse(value))
    ? new Date(value).toLocaleString()
    : "Time unavailable";
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

function chooseLatestMessage(current: LatestMessage | null, candidate: LatestMessage | null, preferCandidateOnTie = false): LatestMessage | null {
  if (!candidate) return current;
  if (!current || current.id === candidate.id) return candidate;
  const currentTime = Date.parse(current.createdAt ?? "");
  const candidateTime = Date.parse(candidate.createdAt ?? "");
  if (Number.isNaN(candidateTime)) return current;
  return Number.isNaN(currentTime) || candidateTime > currentTime || (preferCandidateOnTie && candidateTime === currentTime)
    ? candidate
    : current;
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
  const result = (await response.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };
  if (!response.ok || result.errors?.length || !result.data) {
    throw new Error(result.errors?.[0]?.message ?? "The server is unavailable.");
  }
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
          latestMessage { id senderId content createdAt }
          unreadCount
          hiddenMessageIds
        }
      }
    `,
    { userId, conversationId: currentConversationId },
  );
  return data?.conversationReadState;
}

async function getMessages(userId: string): Promise<Message[]> {
  const data = await postGraphQL<{ messages: Message[] }>(
    `
       query Messages($conversationId: ID!, $userId: ID!) {
         messages(conversationId: $conversationId, userId: $userId) {
          id
          conversationId
          senderId
          content
          createdAt
          mentionedUserIds
          status
          replyToMessageId
          replyTo {
            id
            content
          }
        }
      }
    `,
     { conversationId: currentConversationId, userId },
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
          createdAt
          mentionedUserIds
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
  if (!data?.sendMessage) throw new Error("The message was not saved.");
  return data.sendMessage;
}

async function hideMessageForMe(userId: string, messageId: string): Promise<ConversationReadState> {
  const data = await postGraphQL<{ hideMessageForMe: ConversationReadState }>(
    `mutation HideMessageForMe($userId: ID!, $conversationId: ID!, $messageId: ID!) {
      hideMessageForMe(userId: $userId, conversationId: $conversationId, messageId: $messageId) {
        conversationId latestMessageId latestMessage { id senderId content createdAt }
        unreadCount hiddenMessageIds
      }
    }`,
    { userId, conversationId: currentConversationId, messageId },
  );
  if (!data?.hideMessageForMe) throw new Error("The message could not be hidden.");
  return data.hideMessageForMe;
}

export default App;
