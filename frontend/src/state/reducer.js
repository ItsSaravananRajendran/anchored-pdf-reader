/**
 * Pure reducer. The ONLY module that mutates state.
 *
 * Actions are plain objects: { type, payload }.
 * Reducer is a pure function — no side effects, no async.
 * Async work happens in actions.js (which dispatches these actions).
 */

import { initialState } from "./initialState";

export function reduce(state, action) {
    switch (action.type) {
        case "STATUS":
            return {
                ...state,
                status: action.payload.status,
                errorMessage: action.payload.errorMessage ?? null,
            };

        case "PDF_LOADED":
            return {
                ...state,
                pdfInfo: action.payload.pdfInfo,
                status: "ready",
                errorMessage: null,
            };

        case "PDF_DOC_READY":
            return { ...state, pdfDoc: action.payload.pdfDoc };

        case "PDF_CLEAR":
            return {
                ...state,
                pdfInfo: null,
                pdfDoc: null,
                sessionId: null,
                viewingOldSession: false,
                pendingAnchor: null,
                visibleAnchors: [],
                bookAnchors: [],
                status: "idle",
                errorMessage: null,
            };

        case "LIBRARY_SET":
            return { ...state, library: action.payload.library };

        case "BOOK_ANCHORS_SET":
            return { ...state, bookAnchors: action.payload.bookAnchors };

        case "SESSION_CREATED":
            return {
                ...state,
                sessionId: action.payload.sessionId,
                viewingOldSession: false,
            };

        case "SESSION_LOADED":
            return {
                ...state,
                sessionId: action.payload.sessionId,
                viewingOldSession: true,
                visibleAnchors: action.payload.anchors ?? [],
            };

        case "SESSION_VIEWING_RESET":
            return { ...state, viewingOldSession: false };

        case "PENDING_ANCHOR_SET":
            return { ...state, pendingAnchor: action.payload.anchor };

        case "PENDING_ANCHOR_CLEAR":
            return { ...state, pendingAnchor: null };

        case "VISIBLE_ANCHORS_SET":
            return { ...state, visibleAnchors: action.payload.anchors };

        default:
            return state;
    }
}

export default reduce;