/**
 * ChatPanel — anchors list at the top, messages in the middle, composer at the bottom.
 *
 * Composer is disabled until a pending anchor is set (handled by parent).
 * Auto-scrolls to bottom on new messages unless user has scrolled up.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import MessageBubble from "./MessageBubble";
import AnchorsList from "./AnchorsList";

// Throttle scroll-handler to 100ms so we don't re-render the chat panel
// on every wheel tick. The pinning decision doesn't need to be
// millisecond-accurate — it's only used to suppress auto-scroll when the
// user has scrolled up.
function useThrottle(fn, ms) {
    const lastRef = useRef(0);
    return useCallback((...args) => {
        const now = Date.now();
        if (now - lastRef.current >= ms) {
            lastRef.current = now;
            fn(...args);
        }
    }, [fn, ms]);
}

export default function ChatPanel({
    anchors,
    messages,
    pendingAnchor,
    onAnchorClick,
    onAnchorDelete,
    onSend,
    onNewSession,
    viewingOldSession,
    sessionLabel,
}) {
    const [text, setText] = useState("");
    const messagesRef = useRef(null);
    const [pinnedToBottom, setPinnedToBottom] = useState(true);

    // Auto-scroll on new content when user is pinned to bottom
    useEffect(() => {
        if (!pinnedToBottom || !messagesRef.current) return;
        messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }, [messages, pendingAnchor, pinnedToBottom]);

    function _onScroll() {
        if (!messagesRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = messagesRef.current;
        const atBottom = scrollTop + clientHeight >= scrollHeight - 24;
        setPinnedToBottom(atBottom);
    }
    const onScroll = useThrottle(_onScroll, 100);

    function doSend() {
        const t = text.trim();
        if (!t || !pendingAnchor) return;
        onSend(t);
        setText("");
    }

    return (
        <aside className="chat-panel">
            <header className="chat-header">
                <button
                    className="btn ghost"
                    onClick={onNewSession}
                    title="Start a new session (Ctrl+Shift+N)"
                >
                    ↻ New session
                </button>
                <span className={`session-label ${viewingOldSession ? "viewing-old" : ""}`}>
                    {sessionLabel || (viewingOldSession ? "viewing old session" : "new session")}
                </span>
            </header>

            <section className="anchors-section" aria-label="Anchors in this book">
                <h3 className="anchors-title">Anchors in this book ({anchors.length})</h3>
                <AnchorsList anchors={anchors} onClick={onAnchorClick} onDelete={onAnchorDelete} />
            </section>

            <section className="messages-section" ref={messagesRef} onScroll={onScroll}>
                {messages.length === 0 && (
                    <div className="messages-empty">No messages yet.</div>
                )}
                {messages.map((m) => (
                    <MessageBubble
                        key={m.id}
                        message={m}
                        onAnchorClick={onAnchorClick}
                    />
                ))}
            </section>

            <footer className="composer">
                {pendingAnchor ? (
                    <div className="pending-preview">
                        Anchor on p.{pendingAnchor.page}:&nbsp;
                        {(pendingAnchor.rect.w * 100).toFixed(0)}% × {(pendingAnchor.rect.h * 100).toFixed(0)}%
                    </div>
                ) : (
                    <div className="pending-empty">Drag on a page to set an anchor.</div>
                )}
                <textarea
                    className="composer-input"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            doSend();
                        }
                    }}
                    placeholder={pendingAnchor ? "Ask about this region…" : "Drag on a page first."}
                    rows={3}
                    disabled={!pendingAnchor}
                />
                <button
                    className="btn primary"
                    onClick={doSend}
                    disabled={!pendingAnchor || !text.trim()}
                >
                    Send
                </button>
            </footer>
        </aside>
    );
}