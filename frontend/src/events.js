/**
 * Tiny pub/sub for cross-feature flows.
 *
 * Used to break the import cycle between anchors, session, and chat.
 * Feature modules never import each other directly — they subscribe
 * to events here and emit them when their state changes.
 *
 * Events are typed loosely (string + arbitrary payload) for now;
 * tightening this with TypeScript is a future refactor.
 */

const listeners = new Map();

function on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => off(event, fn);
}

function off(event, fn) {
    const set = listeners.get(event);
    if (set) set.delete(fn);
}

function emit(event, payload) {
    const set = listeners.get(event);
    if (!set) return;
    for (const fn of set) {
        try {
            fn(payload);
        } catch (err) {
            // Don't let a broken subscriber break the chain
            console.error(`[events] listener for ${event} threw:`, err);
        }
    }
}

// Stable references so consumers can import the same fn across renders
const api = { on, off, emit };

export default api;
export const events = api;

/**
 * Event names (convention: lowercase, colon-separated).
 * Document them here so a new contributor knows what's available.
 *
 * pdf:loaded       — payload: { pdfInfo }  when a PDF finishes loading
 * pdf:switched     — payload: { pdfHash }   when the user picks from the library
 * session:created  — payload: { sessionId } when a new session is created
 * session:loaded   — payload: { sessionId, messages, anchor? } when an old session is loaded
 * anchor:set       — payload: { page, rect, thumbDataUrl } when the user finishes a drag
 * anchor:cleared   — payload: {} when the pending anchor is cleared
 * chat:sent        — payload: { messageId } when a user message is committed
 * chat:token       — payload: { text } when an assistant token streams in
 * chat:complete    — payload: { messageId } when the assistant finishes
 * chat:error       — payload: { error } when streaming fails
 */