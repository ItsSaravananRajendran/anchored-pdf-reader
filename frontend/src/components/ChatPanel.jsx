/**
 * ChatPanel — anchors list at the top, messages in the middle, composer at the bottom.
 *
 * Composer is disabled until a pending anchor is set (handled by parent).
 * Auto-scrolls to bottom on new messages unless user has scrolled up.
 *
 * The anchors section is a collapsible disclosure: a <button> header with
 * aria-expanded toggles a height-transition wrapper around <AnchorsList>.
 * The list is keyed on pdfHash so it remounts (and resets to expanded) on
 * PDF change — the local useState for the expanded/collapsed flag would
 * otherwise survive across documents.
 */

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
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
    pdfHash,
    onAnchorClick,
    onAnchorDelete,
    onSend,
    onNewSession,
    viewingOldSession,
    sessionLabel,
}) {
    const [text, setText] = useState("");
    const [expanded, setExpanded] = useState(true);
    const messagesRef = useRef(null);
    const [pinnedToBottom, setPinnedToBottom] = useState(true);

    // The grouped row in AnchorsList only carries userMessageId/sessionId/etc.
    // The original onClick / onDelete handlers expect the raw book-anchor
    // (with message_id, role, etc.) so we look the user message back up by id
    // before forwarding. This keeps AnchorChip + AnchorsList generic and
    // avoids changing the existing handler signatures.
    const anchorByMessageId = useMemo(() => {
        const m = new Map();
        for (const a of anchors || []) m.set(a.message_id, a);
        return m;
    }, [anchors]);

    const handleAnchorClick = useCallback(
        (row) => {
            if (!onAnchorClick) return;
            const userAnchor = anchorByMessageId.get(row.userMessageId);
            // No fallback to the grouped row: it carries camelCase fields
            // (userMessageId, anchorPage, ...) that the downstream handler
            // doesn't understand. If the user message vanished from
            // bookAnchors (e.g. just deleted), the click is a no-op.
            if (!userAnchor) return;
            onAnchorClick(userAnchor);
        },
        [onAnchorClick, anchorByMessageId],
    );

    const handleAnchorDelete = useCallback(
        (row) => {
            if (!onAnchorDelete) return;
            const userAnchor = anchorByMessageId.get(row.userMessageId);
            if (!userAnchor) return;
            onAnchorDelete(userAnchor);
        },
        [onAnchorDelete, anchorByMessageId],
    );

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

    const headerId = `anchors-header-${pdfHash || "none"}`;
    const listId = `anchors-list-${pdfHash || "none"}`;
    const count = (anchors || []).length;
    // Reserve a fixed height when expanded; the inner <ul> scrolls.
    // 0 when collapsed; the transition handles the animation.
    const collapseMaxHeight = expanded ? 280 : 0;

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

            <section className="anchors-section" aria-labelledby={headerId}>
                <button
                    type="button"
                    id={headerId}
                    className="anchors-toggle"
                    aria-expanded={expanded}
                    aria-controls={listId}
                    onClick={() => setExpanded((v) => !v)}
                >
                    <span className="anchors-toggle-label">
                        Anchors in this book ({count})
                    </span>
                    <span className="anchors-toggle-chevron" aria-hidden="true">
                        {expanded ? "▾" : "▸"}
                    </span>
                </button>
                <div
                    className="anchors-collapse"
                    id={listId}
                    role="region"
                    aria-hidden={!expanded}
                    style={{ maxHeight: collapseMaxHeight }}
                >
                    <AnchorsList
                        key={pdfHash || "none"}
                        anchors={anchors}
                        onClick={handleAnchorClick}
                        onDelete={handleAnchorDelete}
                    />
                </div>
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