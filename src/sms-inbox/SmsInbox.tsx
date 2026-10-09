import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  BadgeCheck,
  CarFront,
  Check,
  CircleHelp,
  Clock3,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  UserRound,
  X,
} from "lucide-react";
import "./sms-inbox.css";

type ContactType = "CUSTOMER" | "DRIVER" | "UNKNOWN";
type Direction = "INBOUND" | "OUTBOUND";

type ThreadMessage = {
  id: string;
  direction: Direction;
  body: string;
  status: string;
  providerStatus: string | null;
  deliveryStatus: string | null;
  errorMessage: string | null;
  adminName: string | null;
  createdAt: string;
};

type ConversationSummary = {
  id: string;
  phone: string;
  contactType: ContactType;
  contactName: string | null;
  unreadCount: number;
  optedOutAt: string | null;
  lastMessageAt: string;
  lastMessage: { body: string; direction: Direction; status: string } | null;
};

type SmsConversation = Omit<ConversationSummary, "lastMessage">;
type SmsApi = (url: string, options?: RequestInit) => Promise<any>;
type SmsInboxProps = { api: SmsApi };
type FilterKey = "all" | "unread" | "customer" | "driver" | "unknown";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All threads" },
  { key: "unread", label: "Unread" },
  { key: "customer", label: "Customers" },
  { key: "driver", label: "Chauffeurs" },
  { key: "unknown", label: "Unknown" },
];

function safeDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatThreadTime(value?: string | null) {
  const date = safeDate(value);
  if (!date) return "—";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat("en-US", sameYear
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", year: "2-digit" }).format(date);
}

function formatMessageTime(value?: string | null) {
  const date = safeDate(value);
  return date
    ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date)
    : "Time unavailable";
}

function formatDay(value?: string | null) {
  const date = safeDate(value);
  if (!date) return "Date unavailable";
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(date);
}

function readableError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function contactName(conversation?: Pick<SmsConversation, "contactName" | "contactType"> | null) {
  if (!conversation?.contactName?.trim()) return "Unknown contact";
  return conversation.contactName.trim();
}

function isProviderPending(message: ThreadMessage) {
  if (message.direction !== "OUTBOUND") return false;
  return [message.status, message.providerStatus, message.deliveryStatus]
    .some((value) => value?.toLowerCase().replace(/[_\s]+/g, "-").includes("pending"));
}

function deliveryKind(message: ThreadMessage) {
  const value = [message.deliveryStatus, message.providerStatus, message.status]
    .find((status) => status?.trim())?.toLowerCase() || "";
  if (value.includes("fail") || value.includes("undeliver") || value === "canceled") return "failed";
  if (value === "delivered" || value === "read") return "delivered";
  if (value.includes("pending") || value.includes("queued") || value.includes("processing")) return "pending";
  return "neutral";
}

function deliveryLabel(message: ThreadMessage) {
  const value = [message.deliveryStatus, message.providerStatus, message.status]
    .find((status) => status?.trim());
  return value ? value.replace(/[_-]+/g, " ") : "Status unavailable";
}

function ContactMark({ type }: { type: ContactType }) {
  if (type === "DRIVER") return <span className="sms-contact-mark driver"><CarFront aria-hidden="true" /></span>;
  if (type === "UNKNOWN") return <span className="sms-contact-mark unknown"><CircleHelp aria-hidden="true" /></span>;
  return <span className="sms-contact-mark"><UserRound aria-hidden="true" /></span>;
}

function SmsSkeleton() {
  return (
    <div className="sms-skeleton-list" aria-label="Loading conversations">
      {Array.from({ length: 5 }, (_, index) => (
        <div className="sms-skeleton-row" key={index}>
          <span className="sms-skeleton-avatar" />
          <span className="sms-skeleton-lines"><i /><i /></span>
        </div>
      ))}
    </div>
  );
}

export default function SmsInbox({ api }: SmsInboxProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [thread, setThread] = useState<SmsConversation | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [listRefreshing, setListRefreshing] = useState(false);
  const [inboxError, setInboxError] = useState("");
  const [threadError, setThreadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState("");
  const [mobileThreadOpen, setMobileThreadOpen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [reconcileId, setReconcileId] = useState<string | null>(null);
  const [providerMessageId, setProviderMessageId] = useState("");
  const [reconcilingId, setReconcilingId] = useState<string | null>(null);
  const [reconcileError, setReconcileError] = useState("");
  const listRequest = useRef(false);
  const queuedRefresh = useRef(false);
  const threadRequest = useRef(0);
  const selectedThread = useRef<string | null>(null);
  const readRequests = useRef(new Set<string>());

  const refreshInbox = useCallback(async (quiet = false) => {
    if (listRequest.current) {
      queuedRefresh.current = true;
      return;
    }
    listRequest.current = true;
    if (quiet) setListRefreshing(true);
    else setInboxError("");
    try {
      const response = await api("/api/admin/sms/inbox");
      setConversations(Array.isArray(response?.conversations) ? response.conversations : []);
      setInboxError("");
      setLastUpdated(new Date());
    } catch (error) {
      if (!quiet || conversations.length === 0) {
        setInboxError(readableError(error, "The inbox could not be loaded."));
      }
    } finally {
      listRequest.current = false;
      setInitialLoading(false);
      setListRefreshing(false);
      if (queuedRefresh.current) {
        queuedRefresh.current = false;
        void refreshInbox(true);
      }
    }
  }, [api, conversations.length]);

  const loadThread = useCallback(async (id: string) => {
    const requestId = ++threadRequest.current;
    setThreadLoading(true);
    setThreadError("");
    setActionError("");
    setReconcileId(null);
    setReconcileError("");
    setThread(null);
    setMessages([]);
    try {
      const response = await api(`/api/admin/sms/inbox/${encodeURIComponent(id)}`);
      if (requestId !== threadRequest.current) return;
      setThread(response?.conversation || null);
      setMessages(Array.isArray(response?.messages) ? response.messages : []);
      if (response?.conversation?.unreadCount > 0) {
        await api(`/api/admin/sms/inbox/${encodeURIComponent(id)}/read`, { method: "POST" });
        if (requestId !== threadRequest.current) return;
        setThread((current) => current?.id === id ? { ...current, unreadCount: 0 } : current);
        setConversations((current) => current.map((item) => item.id === id ? { ...item, unreadCount: 0 } : item));
      }
    } catch (error) {
      if (requestId === threadRequest.current) {
        setThread(null);
        setMessages([]);
        setThreadError(readableError(error, "This conversation could not be opened."));
      }
    } finally {
      if (requestId === threadRequest.current) setThreadLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refreshInbox();
    const timer = window.setInterval(() => void refreshInbox(true), 20_000);
    return () => window.clearInterval(timer);
  }, [refreshInbox]);

  useEffect(() => {
    selectedThread.current = selectedId;
    if (selectedId) void loadThread(selectedId);
    else {
      setThread(null);
      setMessages([]);
    }
  }, [selectedId, loadThread]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await api(`/api/admin/sms/inbox/${encodeURIComponent(selectedId)}`);
        if (cancelled) return;
        setThread(response.conversation);
        setMessages(response.messages);
        setThreadError("");
        if (response.conversation.unreadCount > 0) {
          await api(`/api/admin/sms/inbox/${encodeURIComponent(selectedId)}/read`, { method: "POST" });
          if (!cancelled) setThread((current) => current?.id === selectedId ? { ...current, unreadCount: 0 } : current);
        }
      } catch (error) {
        if (!cancelled) setThreadError(readableError(error, "This conversation could not be refreshed."));
      }
    };
    const timer = window.setInterval(() => void refresh(), 20_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [api, selectedId]);

  const unreadTotal = useMemo(
    () => conversations.reduce((total, conversation) => total + Math.max(0, conversation.unreadCount || 0), 0),
    [conversations],
  );
  const visibleConversations = useMemo(() => {
    const query = search.trim().toLowerCase();
    return conversations.filter((conversation) => {
      if (filter === "unread" && conversation.unreadCount < 1) return false;
      if (filter === "customer" && conversation.contactType !== "CUSTOMER") return false;
      if (filter === "driver" && conversation.contactType !== "DRIVER") return false;
      if (filter === "unknown" && conversation.contactType !== "UNKNOWN") return false;
      if (!query) return true;
      const haystack = [
        conversation.contactName || "",
        conversation.phone,
        conversation.lastMessage?.body || "",
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }, [conversations, filter, search]);
  const selectedSummary = conversations.find((conversation) => conversation.id === selectedId) || null;
  const displayThread = thread || (selectedSummary ? {
    id: selectedSummary.id,
    phone: selectedSummary.phone,
    contactType: selectedSummary.contactType,
    contactName: selectedSummary.contactName,
    unreadCount: selectedSummary.unreadCount,
    optedOutAt: selectedSummary.optedOutAt,
    lastMessageAt: selectedSummary.lastMessageAt,
  } satisfies SmsConversation : null);
  const pendingMessage = messages.find(isProviderPending) || null;
  const selectedContactType = displayThread?.contactType || selectedSummary?.contactType || "UNKNOWN";
  const canReply = Boolean(thread && !threadLoading && !threadError && !thread.optedOutAt && !pendingMessage && !sending);

  const markRead = useCallback(async (id: string) => {
    if (readRequests.current.has(id)) return;
    readRequests.current.add(id);
    setConversations((current) => current.map((conversation) =>
      conversation.id === id ? { ...conversation, unreadCount: 0 } : conversation));
    if (thread?.id === id) setThread((current) => current ? { ...current, unreadCount: 0 } : current);
    try {
      await api(`/api/admin/sms/inbox/${encodeURIComponent(id)}/read`, { method: "POST" });
      setThread((current) => current?.id === id ? { ...current, unreadCount: 0 } : current);
      await refreshInbox(true);
    } catch (error) {
      setActionError(readableError(error, "Could not mark this conversation as read."));
      await refreshInbox(true);
    } finally {
      readRequests.current.delete(id);
    }
  }, [api, refreshInbox, thread?.id]);

  const openConversation = (conversation: ConversationSummary) => {
    setSelectedId(conversation.id);
    setMobileThreadOpen(true);
    setComposer("");
    setActionError("");
  };

  const handleMarkRead = () => {
    if (selectedId && (selectedSummary?.unreadCount || displayThread?.unreadCount || 0) > 0) {
      void markRead(selectedId);
    }
  };

  const sendReply = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedId || !canReply || !composer.trim()) return;
    setSending(true);
    setActionError("");
    try {
      await api(`/api/admin/sms/inbox/${encodeURIComponent(selectedId)}/messages`, {
        method: "POST",
        body: JSON.stringify({ body: composer.trim() }),
      });
      if (selectedThread.current === selectedId) {
        setComposer("");
        await Promise.all([loadThread(selectedId), refreshInbox(true)]);
      } else await refreshInbox(true);
    } catch (error) {
      const detail = readableError(error, "Your reply could not be sent.");
      if (selectedThread.current === selectedId) {
        await Promise.all([loadThread(selectedId), refreshInbox(true)]);
        setActionError(detail);
      } else await refreshInbox(true);
    } finally {
      setSending(false);
    }
  };

  const reconcile = async (message: ThreadMessage) => {
    if (!selectedId || reconcilingId) return;
    setReconcilingId(message.id);
    setReconcileError("");
    setActionError("");
    try {
      await api(
        `/api/admin/sms/inbox/${encodeURIComponent(selectedId)}/messages/${encodeURIComponent(message.id)}/reconcile`,
        {
          method: "POST",
          body: JSON.stringify({ ...(providerMessageId.trim() ? { providerMessageId: providerMessageId.trim() } : {}) }),
        },
      );
      setReconcileId(null);
      setProviderMessageId("");
      await Promise.all([loadThread(selectedId), refreshInbox(true)]);
    } catch (error) {
      setReconcileError(readableError(error, "Delivery status could not be reconciled."));
    } finally {
      setReconcilingId(null);
    }
  };

  const startReconcile = (messageId: string) => {
    setReconcileId((current) => current === messageId ? null : messageId);
    setProviderMessageId("");
    setReconcileError("");
  };

  return (
    <main className="sms-inbox">
      <header className="sms-heading">
        <div className="sms-heading-copy">
          <p className="sms-eyebrow"><i aria-hidden="true" /> Operations / Messaging</p>
          <h1>SMS inbox</h1>
          <p>Customer and chauffeur messages, in one accountable thread.</p>
        </div>
        <div className="sms-heading-tools">
          <span className="sms-refresh-meta">
            <Clock3 aria-hidden="true" />
            {listRefreshing ? "Updating" : lastUpdated
              ? `Updated ${formatMessageTime(lastUpdated.toISOString())}`
              : "Live inbox"}
          </span>
          <button
            className="sms-refresh-button"
            type="button"
            aria-label="Refresh inbox"
            title="Refresh inbox"
            onClick={() => void refreshInbox()}
          >
            <RefreshCw aria-hidden="true" />
          </button>
        </div>
      </header>

      <section className="sms-overview" aria-label="Inbox overview">
        <div className="sms-overview-item"><strong>{conversations.length}</strong><span>Conversation threads</span></div>
        <span className="sms-overview-rule" aria-hidden="true" />
        <div className="sms-overview-item"><strong>{unreadTotal}</strong><span>Unread messages</span></div>
        <p className="sms-overview-note">Chicago dispatch communications</p>
      </section>

      <section className={`sms-workspace${mobileThreadOpen && selectedId ? " thread-open" : ""}`} aria-label="SMS inbox workspace">
        <aside className={`sms-list-pane${mobileThreadOpen && selectedId ? " sms-mobile-hide" : ""}`} aria-label="Conversation list">
          <div className="sms-list-toolbar">
            <label className="sms-search">
              <Search aria-hidden="true" />
              <input
                type="search"
                aria-label="Search conversations"
                placeholder="Search name, number, or message"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <div className="sms-filter-row" role="tablist" aria-label="Filter conversations">
              {FILTERS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={filter === item.key}
                  className={`sms-filter${filter === item.key ? " active" : ""}`}
                  onClick={() => setFilter(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="sms-conversation-list">
            {initialLoading ? <SmsSkeleton /> : inboxError && conversations.length === 0 ? (
              <div className="sms-list-state" role="alert">
                <AlertTriangle aria-hidden="true" />
                <strong>Inbox unavailable</strong>
                <p>{inboxError}</p>
                <button type="button" onClick={() => void refreshInbox()}>Retry</button>
              </div>
            ) : visibleConversations.length === 0 ? (
              <div className="sms-list-state">
                {search || filter !== "all" ? <Search aria-hidden="true" /> : <MessageSquareText aria-hidden="true" />}
                <strong>{conversations.length === 0 ? "No conversations yet" : "No matching threads"}</strong>
                <p>{conversations.length === 0
                  ? "Incoming customer and chauffeur messages will appear here."
                  : "Adjust the search or filter to find another conversation."}</p>
                {(search || filter !== "all") && (
                  <button type="button" onClick={() => { setSearch(""); setFilter("all"); }}>Clear filters</button>
                )}
              </div>
            ) : visibleConversations.map((conversation) => {
              const name = contactName(conversation);
              const typeClass = conversation.contactType.toLowerCase();
              const preview = conversation.lastMessage
                ? `${conversation.lastMessage.direction === "OUTBOUND" ? "You: " : ""}${conversation.lastMessage.body}`
                : "No messages in this thread";
              return (
                <button
                  key={conversation.id}
                  type="button"
                  className={`sms-conversation${conversation.id === selectedId ? " selected" : ""}`}
                  aria-current={conversation.id === selectedId ? "true" : undefined}
                  onClick={() => openConversation(conversation)}
                >
                  <ContactMark type={conversation.contactType} />
                  <span className="sms-conversation-main">
                    <span className="sms-conversation-top">
                      <strong>{name}</strong>
                      <time dateTime={conversation.lastMessageAt}>{formatThreadTime(conversation.lastMessageAt)}</time>
                    </span>
                    <span className="sms-contact-phone">{conversation.phone}</span>
                    <span className="sms-conversation-bottom">
                      <span className="sms-preview">{preview}</span>
                      {conversation.unreadCount > 0
                        ? <span className="sms-unread-count" aria-label={`${conversation.unreadCount} unread`}>{conversation.unreadCount}</span>
                        : conversation.optedOutAt
                          ? <span className="sms-optout-mini">Opted out</span>
                          : <span className={`sms-type-label ${typeClass}`}><i />{conversation.contactType === "DRIVER" ? "Chauffeur" : conversation.contactType === "CUSTOMER" ? "Customer" : "Unverified"}</span>}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="sms-thread-pane" aria-label="Selected conversation">
          {!selectedId ? (
            <div className="sms-thread-empty">
              <MessageSquareText aria-hidden="true" />
              <strong>Choose a conversation</strong>
              <p>Open a thread to review its message history and reply to an existing contact.</p>
            </div>
          ) : (
            <>
              <header className="sms-thread-header">
                <div className="sms-thread-identity">
                  <button
                    className="sms-icon-action sms-back-button"
                    type="button"
                    aria-label="Back to conversations"
                    onClick={() => setMobileThreadOpen(false)}
                  >
                    <ArrowLeft aria-hidden="true" />
                  </button>
                  <ContactMark type={selectedContactType} />
                  <div>
                    <h2>{contactName(displayThread)}</h2>
                    <p>{displayThread?.phone || selectedSummary?.phone || "Phone number unavailable"}</p>
                  </div>
                </div>
                <div className="sms-thread-actions">
                  {(selectedSummary?.unreadCount || displayThread?.unreadCount || 0) > 0 && (
                    <button className="sms-icon-action" type="button" onClick={handleMarkRead}>
                      <Check aria-hidden="true" /><span className="sms-action-copy">Mark read</span>
                    </button>
                  )}
                  <button
                    className="sms-icon-action"
                    type="button"
                    aria-label="Refresh conversation"
                    title="Refresh conversation"
                    disabled={threadLoading}
                    onClick={() => selectedId && void loadThread(selectedId)}
                  >
                    <RefreshCw aria-hidden="true" /><span className="sms-action-copy">Refresh</span>
                  </button>
                </div>
              </header>
              <div className="sms-thread-meta">
                <span><Clock3 aria-hidden="true" />Thread activity {formatThreadTime(displayThread?.lastMessageAt || selectedSummary?.lastMessageAt)}</span>
                <span>{selectedContactType === "DRIVER" ? "Chauffeur" : selectedContactType === "CUSTOMER" ? "Customer" : "Unknown contact"}</span>
                {displayThread?.optedOutAt && <span className="sms-optout"><ShieldAlert aria-hidden="true" />SMS opted out</span>}
              </div>

              {threadError ? (
                <div className="sms-thread-empty" role="alert">
                  <AlertTriangle aria-hidden="true" />
                  <strong>Could not open thread</strong>
                  <p>{threadError}</p>
                  <button className="sms-icon-action" type="button" onClick={() => selectedId && void loadThread(selectedId)}>Try again</button>
                </div>
              ) : threadLoading && !thread ? (
                <div className="sms-thread-loading"><LoaderCircle aria-hidden="true" /><p>Loading message history</p></div>
              ) : messages.length === 0 ? (
                <div className="sms-thread-empty">
                  <MessageSquareText aria-hidden="true" />
                  <strong>No message history</strong>
                  <p>This existing thread has no messages to display.</p>
                </div>
              ) : (
                <div className="sms-thread-messages" aria-live="polite">
                  {messages.map((message, index) => {
                    const previous = index > 0 ? messages[index - 1] : null;
                    const showDate = !previous || formatDay(previous.createdAt) !== formatDay(message.createdAt);
                    const pending = isProviderPending(message);
                    const statusKind = deliveryKind(message);
                    const status = deliveryLabel(message);
                    const isReconcileOpen = reconcileId === message.id;
                    return (
                      <div className="sms-message-group" key={message.id}>
                        {showDate && <div className="sms-date-divider">{formatDay(message.createdAt)}</div>}
                        <article className={`sms-message-row ${message.direction.toLowerCase()}${pending ? " provider-pending" : ""}`}>
                          <div className="sms-message-bubble">
                            <p className="sms-message-body">{message.body || "No text content. Media attachments are not displayed in this SMS inbox."}</p>
                            <div className="sms-message-footer">
                              {message.direction === "INBOUND"
                                ? <span className="sms-message-sender">{selectedContactType === "DRIVER" ? "Chauffeur" : selectedContactType === "CUSTOMER" ? "Contact" : "Incoming"}</span>
                                : <span className="sms-message-sender">{message.adminName || "Allan staff"}</span>}
                              <time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
                              {message.direction === "INBOUND"
                                ? <ArrowDownLeft aria-label="Incoming message" />
                                : <ArrowUpRight aria-label="Outgoing message" />}
                              {message.direction === "OUTBOUND" && (
                                <span className={`sms-delivery-status ${statusKind}`}>
                                  {statusKind === "failed" ? <AlertTriangle aria-hidden="true" />
                                    : statusKind === "delivered" ? <BadgeCheck aria-hidden="true" />
                                      : statusKind === "pending" ? <Clock3 aria-hidden="true" /> : null}
                                  {status}
                                </span>
                              )}
                            </div>
                          </div>
                          {pending && (
                            <div className="sms-provider-pending-note">
                              <p>Provider status is still pending. Replying is paused until delivery is reconciled.</p>
                              <button type="button" onClick={() => startReconcile(message.id)}>
                                <RefreshCw aria-hidden="true" />{isReconcileOpen ? "Close reconcile" : "Reconcile"}
                              </button>
                            </div>
                          )}
                          {message.errorMessage && (
                            <p className="sms-message-error">Delivery detail: {message.errorMessage}</p>
                          )}
                          {isReconcileOpen && (
                            <form className="sms-reconcile-box" onSubmit={(event) => { event.preventDefault(); void reconcile(message); }}>
                              <label htmlFor={`provider-id-${message.id}`}>Provider message ID <span>(optional)</span></label>
                              <input
                                id={`provider-id-${message.id}`}
                                value={providerMessageId}
                                onChange={(event) => setProviderMessageId(event.target.value)}
                                placeholder="Enter an ID if available"
                                autoComplete="off"
                              />
                              {reconcileError && <p className="sms-action-error" role="alert">{reconcileError}</p>}
                              <div className="sms-reconcile-actions">
                                <button type="button" onClick={() => { setReconcileId(null); setReconcileError(""); }}>
                                  <X aria-hidden="true" />Cancel
                                </button>
                                <button className="primary" type="submit" disabled={reconcilingId === message.id}>
                                  {reconcilingId === message.id ? <LoaderCircle aria-hidden="true" /> : <Check aria-hidden="true" />}
                                  {reconcilingId === message.id ? "Checking" : "Check status"}
                                </button>
                              </div>
                            </form>
                          )}
                        </article>
                      </div>
                    );
                  })}
                </div>
              )}

              <footer className="sms-reply-area">
                {displayThread?.optedOutAt ? (
                  <div className="sms-reply-disabled opted-out">
                    <ShieldAlert aria-hidden="true" />
                    <span>This contact has opted out of SMS. Replies are disabled for this thread.</span>
                  </div>
                ) : pendingMessage ? (
                  <div className="sms-reply-disabled pending">
                    <Clock3 aria-hidden="true" />
                    <span>Reply is paused while an outgoing message awaits provider reconciliation.</span>
                  </div>
                ) : (
                  <form className="sms-reply-compose" onSubmit={sendReply}>
                    <p className="sms-compose-label">Reply in existing thread <span>Private staff workspace</span></p>
                    <div className="sms-compose-box">
                      <textarea
                        aria-label="Reply message"
                        value={composer}
                        onChange={(event) => setComposer(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                            event.preventDefault();
                            event.currentTarget.form?.requestSubmit();
                          }
                        }}
                        placeholder="Write a clear, concise reply…"
                        disabled={!canReply}
                      />
                      <div className="sms-compose-tools">
                        <small>Ctrl + Enter to send</small>
                        <button className="sms-send-button" type="submit" disabled={!canReply || !composer.trim()}>
                          {sending ? <LoaderCircle aria-hidden="true" /> : <Send aria-hidden="true" />}
                          {sending ? "Sending" : "Send reply"}
                        </button>
                      </div>
                    </div>
                    {actionError && <p className="sms-action-error" role="alert">{actionError}</p>}
                  </form>
                )}
                {displayThread?.optedOutAt && actionError && <p className="sms-action-error" role="alert">{actionError}</p>}
              </footer>
            </>
          )}
        </section>
      </section>
    </main>
  );
}
