/**
 * State shape + initial value.
 *
 * This module is the *only* place that defines the shape. Mutations
 * happen in reducer.js; consumers read via the context (AppContext.jsx).
 *
 * Anything that lives in here is "application state" — UI is owned by
 * components, render caches are owned by useVirtualPages, transient
 * drag/markdown/panel state is owned by hooks.
 */

// Initial empty PDF state — a user opens the page, types a URL, hits Load.
const initialState = () => ({
    // What PDF is loaded
    pdfInfo: null,         // { hash, title, page_count, url, bytes }
    pdfDoc: null,          // PDF.js document (lazy-loaded)

    // Session
    sessionId: null,       // current chat session
    viewingOldSession: false,  // true after session:loaded; first send starts a new session

    // Pending anchor (user is composing a question)
    pendingAnchor: null,   // { page, rect: {x,y,w,h}, rotation, thumbDataUrl }

    // Anchors in the current PDF, across all sessions
    bookAnchors: [],       // [{ message_id, session_id, anchor_page, anchor_rect, role, text, created_at }]

    // Anchors visible in the chat panel (subset of bookAnchors for the current session)
    visibleAnchors: [],    // subset of bookAnchors filtered by current sessionId

    // Library list
    library: [],           // [{ hash, title, page_count, last_seen, message_count }]

    // Status
    status: "idle",        // "idle" | "loading" | "ready" | "error"
    errorMessage: null,
});

export { initialState };
export default initialState;